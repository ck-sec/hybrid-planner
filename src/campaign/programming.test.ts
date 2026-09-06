import assert from 'node:assert/strict'
import test from 'node:test'
import { requestedSessions } from '../../engine/planner.ts'
import { hasCleanBlockObservation } from '../../engine/observations.ts'
import { PROGRAM_POLICY } from '../../engine/constants.ts'
import { equipmentForResources } from './equipment.ts'
import type { ResourceId } from './equipment.ts'
import { enableTemplateProgramming, programmingChoices, selectProgramExercises } from './programming.ts'
import { adaptCampaign, buildCampaign, completeCampaignSession, exampleCampaign, logCampaignBlockAmount, logCampaignBlockSet, nextCampaignWeek, normalizeRecommendedDraft, parseCampaign } from './model.ts'
import type { CampaignState } from './types.ts'

function prepared(resources: ResourceId[] = ['kettlebell', 'floor_space', 'carry_space']): CampaignState {
  const source = exampleCampaign('2026-09-07')
  const draft = enableTemplateProgramming({ ...source.draft, resources, equipment: equipmentForResources(resources) })
  return { ...source, sample: false, draft: normalizeRecommendedDraft({ ...draft, confirmed: true }) }
}
function built(resources?: ResourceId[]): CampaignState { return buildCampaign(prepared(resources)) }

test('equipment-aware templates are opt-in, deterministic and retain the confirmed running baseline', () => {
  const old = exampleCampaign('2026-09-07')
  assert.equal(old.draft.program, undefined)
  const state = prepared()
  assert.deepEqual(parseCampaign(state), state)
  const first = buildCampaign(state)
  const second = buildCampaign(state)
  assert.deepEqual(first, second)
  const input = first.weeks[0].input
  const requested = requestedSessions(input)
  assert.equal(requested.filter(session => session.discipline === 'run').length, state.draft.runsPerWeek)
  assert.ok(first.weeks[0].plan.sessions.some(session => session.discipline === 'run'))
  const workouts = requested.filter(session => session.kind === 'workout')
  assert.equal(workouts.length, 2)
  assert.notDeepEqual(workouts[0].blocks, workouts[1].blocks)
  assert.ok(workouts.some(session => session.blocks.some(block => block.unit !== 'throws' && block.exerciseId.startsWith('kettlebell-'))))
  assert.ok(workouts.some(session => session.blocks.some(block => block.unit === 'seconds')))
  const allSelected = new Set(workouts.flatMap(session => session.blocks.flatMap(block => block.unit === 'throws' ? [] : [block.exerciseId])))
  assert.deepEqual([...allSelected].sort(), [...state.draft.recommendedSetup!.exerciseIds].sort())
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(first))), first)
})

test('weighted timed work and repetition blocks have distinct durable logs', () => {
  let state = built()
  const session = state.weeks[0].plan.sessions.find(item => item.kind === 'workout' && item.blocks.some(block => block.unit === 'seconds' && block.role === 'carry'))
  assert.ok(session && session.kind === 'workout')
  const timed = session.blocks.findIndex(block => block.unit === 'seconds')
  const reps = session.blocks.findIndex(block => block.unit === 'reps')
  assert.ok(reps >= 0)
  state = logCampaignBlockSet(state, session.id, reps, 0, { weight: '0', reps: '6', effort: '6' })
  state = logCampaignBlockAmount(state, session.id, timed, '20', '12')
  assert.deepEqual(parseCampaign(state), state)
  const logs = state.weeks[0].logs[session.id].blockLogs!
  assert.ok(logs.some(log => log.unit === 'seconds' && log.seconds === 20 && log.weightKg === 12))
  assert.ok(logs.some(log => log.unit === 'reps' && log.sets[0].reps === 6))
  assert.throws(() => logCampaignBlockSet(state, session.id, timed, 0, { weight: '12', reps: '20', effort: '6' }), /repetition block/)
  assert.throws(() => logCampaignBlockAmount(state, session.id, reps, '20'), /timed or throwing/)
  state = completeCampaignSession(state, session.id, session.durationMin, 4, false)
  const next = nextCampaignWeek(state)
  assert.deepEqual(next.weeks[0], state.weeks[0])
  assert.deepEqual(parseCampaign(next), next)
})

test('actual overruns and extra performed sets remain truthful records, not new prescriptions', () => {
  let state = built()
  const session = state.weeks[0].plan.sessions.find(item => item.kind === 'workout' && item.blocks.some(block => block.unit === 'seconds'))
  assert.ok(session?.kind === 'workout')
  const repsIndex = session.blocks.findIndex(block => block.unit === 'reps')
  const timedIndex = session.blocks.findIndex(block => block.unit === 'seconds')
  const reps = session.blocks[repsIndex]
  const timed = session.blocks[timedIndex]
  assert.ok(reps.unit === 'reps' && timed.unit === 'seconds')
  const prescription = structuredClone(session)
  for (let index = 0; index <= reps.sets; index++) {
    state = logCampaignBlockSet(state, session.id, repsIndex, index, {
      weight: '12', reps: String(reps.reps + 1), effort: '6',
    })
  }
  state = logCampaignBlockAmount(state, session.id, timedIndex, String(timed.sets * timed.seconds + 1), '12')
  assert.deepEqual(state.weeks[0].plan.sessions.find(item => item.id === session.id), prescription)
  assert.deepEqual(parseCampaign(state), state)
  state = completeCampaignSession(state, session.id, session.durationMin, 5, false)
  const next = nextCampaignWeek(state)
  assert.deepEqual(next.weeks[0], state.weeks[0])
  assert.deepEqual(parseCampaign(next), next)
  const nextBlock = next.weeks[1].plan.sessions.flatMap(item => item.kind === 'workout' ? item.blocks : [])
    .find(block => block.unit === 'reps' && block.exerciseId === reps.exerciseId)
  assert.ok(nextBlock?.unit === 'reps')
  assert.equal(nextBlock.suggestedWeightKg, undefined)
  assert.ok(nextBlock.sets <= reps.sets && nextBlock.reps <= reps.reps)
})

test('recording zero timed work does not fabricate a completed calibration exposure', () => {
  let state = built()
  const session = state.weeks[0].plan.sessions.find(item => item.kind === 'workout' && item.blocks.some(block => block.unit === 'seconds'))
  assert.ok(session?.kind === 'workout')
  const index = session.blocks.findIndex(block => block.unit === 'seconds')
  const block = session.blocks[index]
  assert.ok(block.unit === 'seconds')
  state = logCampaignBlockAmount(state, session.id, index, '0')
  state = completeCampaignSession(state, session.id, session.durationMin, 5, false)
  const next = nextCampaignWeek(state)
  assert.equal(hasCleanBlockObservation(next.weeks[1].input, block.exerciseId, 'seconds'), false)
  assert.deepEqual(parseCampaign(next), next)
})

test('total practice throws above the generated block can be logged without increasing its next dose', () => {
  const preparedState = prepared(['kettlebell', 'floor_space', 'carry_space', 'dodgeballs', 'court', 'safe_target'])
  let state = buildCampaign({ ...preparedState, draft: normalizeRecommendedDraft({
    ...preparedState.draft, program: { ...preparedState.draft.program!, comfortableThrowsPerPractice: 60 },
  }) })
  const practice = state.weeks[0].plan.sessions.find(session => session.kind === 'workout' && session.sourceCommitmentId)
  assert.ok(practice?.kind === 'workout' && practice.blocks[0].unit === 'throws')
  const plannedThrows = practice.blocks[0].throws
  assert.ok(plannedThrows < 60)
  state = logCampaignBlockAmount(state, practice.id, 0, '60')
  assert.deepEqual(parseCampaign(state), state)
  state = completeCampaignSession(state, practice.id, practice.durationMin, 5, false)
  const next = nextCampaignWeek(state)
  const nextPractice = next.weeks[1].plan.sessions.find(session => session.kind === 'workout' && session.sourceCommitmentId === practice.sourceCommitmentId)
  assert.ok(nextPractice?.kind === 'workout' && nextPractice.blocks[0].unit === 'throws')
  assert.equal(nextPractice.blocks[0].throws, plannedThrows)
  assert.deepEqual(next.weeks[0], state.weeks[0])
  assert.deepEqual(parseCampaign(next), next)
})

test('dodgeball throwing is optional and counted within a real existing practice', () => {
  const resources: ResourceId[] = ['kettlebell', 'floor_space', 'carry_space', 'dodgeballs', 'court', 'safe_target']
  const state = prepared(resources)
  const without = buildCampaign(state)
  assert.equal(without.weeks[0].plan.sessions.filter(session => session.kind === 'workout' && session.sourceCommitmentId).length, 0)
  const withThrows = buildCampaign({ ...state, draft: normalizeRecommendedDraft({
    ...state.draft, program: { ...state.draft.program!, comfortableThrowsPerPractice: 60 },
  }) })
  const practice = withThrows.weeks[0].plan.sessions.find(session => session.kind === 'workout' && session.sourceCommitmentId)
  assert.ok(practice && practice.kind === 'workout')
  assert.equal(practice.durationMin, state.draft.practiceDuration)
  assert.equal(practice.blocks[0].unit, 'throws')
  if (practice.blocks[0].unit === 'throws') assert.ok(practice.blocks[0].throws <= 60)
  const logged = logCampaignBlockAmount(withThrows, practice.id, 0, '10')
  assert.deepEqual(parseCampaign(logged), logged)
  assert.equal(logged.weeks[0].input.athlete.program?.comfortableThrowsPerPractice, 60)
  const held = completeCampaignSession(logged, practice.id, practice.durationMin, 5, true)
  assert.throws(() => nextCampaignWeek(held), /Pain|health hold/)
})

test('supported execution variants change the real block, and forged tempo or quantities cannot be restored', () => {
  const state = prepared(['barbell', 'rack', 'bench', 'dumbbell', 'floor_space', 'carry_space'])
  const draft = selectProgramExercises(state.draft, ['back-squat-slow-lowering', 'dumbbell-row', 'push-up', 'dead-bug'])
  const planned = buildCampaign({ ...state, draft: normalizeRecommendedDraft({ ...draft, confirmed: true }) })
  const session = planned.weeks[0].plan.sessions.find(item => item.kind === 'workout')
  assert.ok(session && session.kind === 'workout')
  const squat = session.blocks.find(block => block.unit === 'reps' && block.exerciseId === 'back-squat-slow-lowering')
  assert.ok(squat && squat.unit === 'reps')
  assert.equal(squat.executionStyle, 'slow_lowering')
  assert.equal(squat.suggestedWeightKg, undefined)
  assert.ok(programmingChoices(state.draft).some(item => item.exercise.id === 'goblet-squat-fast-concentric'))
  const forged = structuredClone(planned)
  const changed = forged.weeks[0].plan.sessions.find(item => item.id === session.id)
  assert.ok(changed && changed.kind === 'workout')
  const block = changed.blocks.find(item => item.unit === 'reps')
  assert.ok(block && block.unit === 'reps')
  block.executionStyle = 'fast_concentric_intent'
  assert.throws(() => parseCampaign(forged))
  assert.throws(() => selectProgramExercises(state.draft, Array(PROGRAM_POLICY.maxSelectedExercises + 1).fill('back-squat')), /distinct/)
})

test('legacy-to-template revisions preserve fatigue ceilings and completed history', () => {
  const source = exampleCampaign('2026-09-07')
  const old = buildCampaign({ ...source, sample: false, draft: { ...source.draft, confirmed: true } })
  const session = old.weeks[0].plan.sessions.find(item => item.kind === 'strength')!
  const tired = adaptCampaign(old, { type: 'skip', sessionId: session.id, reason: 'too_tired' })
  const resources: ResourceId[] = ['kettlebell', 'floor_space', 'carry_space']
  const upgraded = enableTemplateProgramming({ ...tired.draft, resources, equipment: equipmentForResources(resources) })
  const ordinary = nextCampaignWeek(tired)
  const revised = nextCampaignWeek(tired, { ...upgraded, confirmed: true })
  assert.deepEqual(revised.weeks[0], tired.weeks[0])
  assert.deepEqual(revised.weeks[1].input.block.phases, ordinary.weeks[1].input.block.phases)
  assert.deepEqual(revised.weeks[1].input.athlete.residual, ordinary.weeks[1].input.athlete.residual)
  assert.ok(revised.weeks[1].plan.sessions.some(item => item.kind === 'workout'))
  assert.deepEqual(parseCampaign(revised), revised)
})
