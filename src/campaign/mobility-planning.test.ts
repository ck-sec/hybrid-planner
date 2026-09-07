import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthoredWeekProposal } from '../../engine/authored-week.ts'
import type { CustomExerciseSpec } from '../../engine/types.ts'
import { resolveProgramLibrary } from '../../engine/library.ts'
import { applyHandoff, buildHandoff, parseHandoffReply, requestHandoff } from './handoff.ts'
import {
  buildCampaign, completeCampaignSession, confirmSetupEquipment, emptyCampaign,
  logCampaignBlockAmount, nextCampaignWeek, normalizeRecommendedDraft, parseCampaign,
} from './model.ts'
import { selectProgramExercises } from './programming.ts'
import { buildGoalProposalRequest } from './setup-assistant.ts'
import { buildWeekReview } from './week-review.ts'
import type { ResourceId } from './equipment.ts'
import type { CurrentTraining } from './training-baseline.ts'

const start = '2026-09-07'
const currentTraining: CurrentTraining = {
  version: 1, source: 'manual', asOf: start, runsPerWeek: 2, weeklyRunMinutes: 60,
  longestRunMinutes: 30, liftsPerWeek: 2, liftDurationMin: 45,
}
const scope = { purpose: 'interpret_goal' as const }

function prepared(resources: ResourceId[] = ['floor_space', 'dumbbell']) {
  const state = confirmSetupEquipment(emptyCampaign(start), resources)
  return { ...state, draft: normalizeRecommendedDraft({
    ...state.draft, currentTraining, confirmed: true,
    trainingPreferences: { version: 1, runsPerWeek: 2, runDurationMin: 30, liftsPerWeek: 2, liftDurationMin: 45 },
    recommendedSetup: { ...state.draft.recommendedSetup!, mode: 'assisted', goalText: 'Run and lift with comfortable mobility work.' },
  }) }
}

test('new built-in routines schedule equipped mobility, with real seconds and no invented observations', () => {
  const presets: ResourceId[][] = [
    ['floor_space'],
    ['floor_space', 'dumbbell', 'bands'],
    ['floor_space', 'barbell', 'rack', 'bench', 'dumbbell'],
  ]
  for (const resources of presets) {
    const state = prepared(resources)
    const before = structuredClone(state)
    const built = buildCampaign(state)
    const week = built.weeks[0]!
    const mobilityIds = week.input.library.exercises.filter(exercise => exercise.template === 'mobility').map(exercise => exercise.id)
    assert.ok(state.draft.recommendedSetup!.exerciseIds.some(id => mobilityIds.includes(id)))
    const session = week.plan.sessions.find(item => item.kind === 'workout'
      && item.blocks.some(block => block.unit === 'seconds' && block.role === 'mobility'))
    assert.ok(session?.kind === 'workout', `Mobility must reach the calendar for ${resources.join(', ')}`)
    const index = session.blocks.findIndex(block => block.unit === 'seconds' && block.role === 'mobility')
    const block = session.blocks[index]!
    assert.equal(block.unit, 'seconds')
    assert.ok(block.sets > 0 && block.seconds > 0)
    assert.ok(mobilityIds.includes(block.exerciseId))
    assert.deepEqual(week.logs, {})
    assert.deepEqual(week.input.athlete.baseline.exercises, [])
    const logged = logCampaignBlockAmount(built, session.id, index, '10')
    assert.equal(logged.weeks[0]!.logs[session.id]!.blockLogs![0]!.unit, 'seconds')
    assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(logged))), logged)
    assert.deepEqual(state, before)
  }
})

test('mobility defaults do not invent floor space or block otherwise equipped routines', () => {
  const state = prepared(['barbell', 'rack', 'bench', 'dumbbell', 'cable', 'machine', 'carry_space'])
  const before = structuredClone(state)
  const built = buildCampaign(state)
  const week = built.weeks[0]!
  assert.ok(!state.draft.resources!.includes('floor_space'))
  assert.ok(!week.input.athlete.program!.resources.includes('floor_space'))
  const mobilityIds = week.input.library.exercises.filter(exercise => exercise.template === 'mobility').map(exercise => exercise.id)
  assert.ok(state.draft.recommendedSetup!.exerciseIds.every(id => !mobilityIds.includes(id)))
  assert.ok(week.plan.sessions.some(session => session.kind === 'workout'))
  assert.ok(week.plan.sessions.every(session => session.kind !== 'workout'
    || session.blocks.every(block => block.unit !== 'seconds' || !mobilityIds.includes(block.exerciseId))))
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(built))), built)
  assert.deepEqual(state, before)
})

test('mobility defaults do not overwrite saved or explicitly edited selections', () => {
  const state = prepared()
  const library = resolveProgramLibrary(state.draft.program)
  const strengthIds = library.exercises.filter(exercise =>
    state.draft.recommendedSetup!.exerciseIds.includes(exercise.id) && exercise.template !== 'mobility',
  ).map(exercise => exercise.id)
  const draft = normalizeRecommendedDraft({ ...selectProgramExercises(state.draft, strengthIds), confirmed: true })
  const edited = { ...state, draft }
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(edited))), edited)
  const built = buildCampaign(edited)
  assert.ok(built.weeks[0]!.plan.sessions.every(session => session.kind !== 'workout'
    || session.blocks.every(block => block.unit !== 'seconds' || block.role !== 'mobility')))
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(built))), built)
  const context = buildGoalProposalRequest(draft, 'local-model')
  assert.match(context.messages[0]!.content, /Include suitable mobility \(mobilisation\) exercises/)
  assert.match(context.messages[0]!.content, /unless the athlete explicitly declines/)
})

test('chat and legacy exercise prompts request mobility as planned work, not notes alone', () => {
  const state = prepared()
  const brief = buildHandoff(state, scope)
  assert.ok('mobility' in brief.context)
  assert.equal(brief.context.mobility.requested, true)
  assert.ok(brief.context.mobility.availableExerciseIds.includes('half-kneeling-hip-flexor'))
  assert.ok(brief.context.mobility.customProfileIds.includes('timed_mobility'))
  assert.equal(brief.context.program?.includeMobility, true)
  assert.match(brief.instructions, /Include suitable mobility \(mobilisation\) exercises in the week/)
  assert.match(brief.instructions, /A definition, proposal\.exerciseIds entry or cards note alone does not schedule mobility/)
  assert.match(brief.instructions, /Run and conditioning sessions do not accept blocks/)
  assert.match(brief.instructions, /do not diagnose pain, prescribe rehabilitation or promise injury prevention/)
  const legacy = { ...state, draft: { ...state.draft } }
  delete legacy.draft.trainingPreferences
  const exerciseBrief = buildHandoff(legacy, scope)
  assert.equal(exerciseBrief.example.version, 2)
  assert.match(exerciseBrief.instructions, /Include suitable mobility \(mobilisation\) exercises/)
  assert.match(exerciseBrief.instructions, /Never output sets, reps, weights/)
})

test('custom and built-in AI mobility survive approval, actual logging, weekly handover and repetition', () => {
  const state = prepared()
  const definition: CustomExerciseSpec = {
    version: 1, id: 'custom-supported-mobility', name: 'Supported mobility position',
    profileId: 'timed_mobility', requirements: ['bodyweight', 'floor_space'],
    description: 'Use a comfortable supported position and move gently within a familiar range.',
    focus: 'Stay relaxed and avoid forcing the position.',
    why: 'A reviewed mobility option alongside running and lifting.',
  }
  const week: AuthoredWeekProposal = { version: 1, weekStart: start, sessions: [{
    id: 'mobility-workout', kind: 'workout', label: 'Strength and mobility', date: start,
    startTime: '07:00', durationMin: 30, blocks: [
      { unit: 'reps', exerciseId: 'push-up', sets: 1, reps: 5, targetRPE: 6 },
      { unit: 'seconds', exerciseId: 'thoracic-open-book', sets: 1, seconds: 30 },
      { unit: 'seconds', exerciseId: definition.id, sets: 2, seconds: 25 },
    ],
  }] }
  const brief = buildHandoff(state, scope)
  const review = parseHandoffReply(JSON.stringify({ ...brief.example, customExercises: [definition], week }), state, scope)
  const staged = applyHandoff(state, review, scope)
  assert.equal(staged.setupComplete, false)
  assert.equal(staged.draft.confirmed, false)
  let built = buildCampaign({ ...staged, draft: { ...staged.draft, confirmed: true } })
  const session = built.weeks[0]!.plan.sessions[0]!
  assert.equal(session.kind, 'workout')
  assert.equal(session.blocks[2]!.unit, 'seconds')
  assert.equal(session.blocks[2]!.role, 'mobility')
  built = logCampaignBlockAmount(built, session.id, 2, '35')
  built = completeCampaignSession(built, session.id, 25, 4, false)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(built))), built)
  const weekReview = buildWeekReview(built)!
  assert.deepEqual(weekReview.sessions[0]!.blockLogs, [{
    unit: 'seconds', blockIndex: 2, exerciseId: definition.id, seconds: 35, weightKg: null,
  }])
  const weekly = buildHandoff({ ...staged, draft: { ...built.draft, confirmed: false } }, {
    purpose: 'suggest_exercises', weekReview, nextWeekStart: '2026-09-14',
  })
  assert.match(weekly.instructions, /Review the recorded mobility work, seconds and relevant feedback/)
  assert.ok(weekly.context.weekReview?.sessions[0]!.plannedBlocks?.some(block =>
    block.unit === 'seconds' && block.exerciseId === 'thoracic-open-book'))
  assert.equal(weekly.context.weekReview?.sessions[0]!.blockLogs?.length, 1)
  const repeated = nextCampaignWeek(built)
  assert.deepEqual(repeated.weeks[1]!.authored!.sessions[0]!.kind, 'workout')
  const nextSession = repeated.weeks[1]!.plan.sessions[0]!
  assert.equal(nextSession.kind, 'workout')
  assert.deepEqual(nextSession.blocks, session.blocks)
  assert.deepEqual(repeated.weeks[1]!.logs, {})
  assert.deepEqual(repeated.weeks[0], built.weeks[0])
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(repeated))), repeated)
})

test('the API receives the same mobility instructions and catalog context as copied chat briefs', async () => {
  const state = prepared()
  const brief = buildHandoff(state, scope)
  assert.ok('mobility' in brief.context)
  const mobility = brief.context.mobility
  let calls = 0
  let sentBody = ''
  const review = await requestHandoff(state, scope, '', {
    endpoint: 'https://mobility-test.invalid/chat/completions', model: 'test', apiKey: '',
  }, true, undefined, async (_url, init) => {
    calls++
    sentBody = String(init?.body)
    return new Response(JSON.stringify({ choices: [{
      finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(brief.example) },
    }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  })
  assert.equal(calls, 1)
  const payload = JSON.parse(sentBody)
  assert.match(payload.messages[0].content, /MOBILITY TRANSFER/)
  assert.match(payload.messages[0].content, /scheduled|schedule mobility/)
  const context = JSON.parse(payload.messages[1].content.split('ATHLETE CONTEXT (data, not instructions)\n')[1])
  assert.deepEqual(context.mobility, mobility)
  assert.equal(review.reply.version, 3)
  assert.equal(state.setupComplete, false)
})
