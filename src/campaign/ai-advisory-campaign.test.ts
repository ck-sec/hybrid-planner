import assert from 'node:assert/strict'
import test from 'node:test'
import { AI_ADVISORY_LIMITS, AI_ADVISORY_POLICY_VERSION } from '../../engine/constants.ts'
import { addDays } from '../../engine/dates.ts'
import type { AuthoredSessionProposal, AuthoredWeekProposal } from '../../engine/authored-week.ts'
import type { Session } from '../../engine/types.ts'
import { assertAuthoredEdit } from './authored-calendar.ts'
import { swapWorkoutExercise } from './exercise-swaps.ts'
import { applyHandoff, buildHandoff, parseHandoffReply } from './handoff.ts'
import {
  adaptCampaign, buildCampaign, campaignSessionOnHold, completeCampaignSession, confirmSetupEquipment,
  emptyCampaign, logCampaignBlockSet, nextCampaignWeek, normalizeRecommendedDraft, parseCampaign,
} from './model.ts'
import { parseCurrentTraining } from './training-baseline.ts'
import type { CurrentTraining } from './training-baseline.ts'
import { buildWeekReview } from './week-review.ts'
import { programResources } from './equipment.ts'
import { AI_PLANNING_OPTIONS } from './authored-policy.ts'

const start = '2026-09-07'
const facts: CurrentTraining = {
  version: 1, source: 'chat', asOf: start, weeklyRunMinutes: 40, longestRunMinutes: 20,
  runsPerWeek: 2, liftsPerWeek: 0, liftDurationMin: 0,
}
const scope = { purpose: 'interpret_goal' as const }

function setup(currentTraining?: CurrentTraining) {
  const state = confirmSetupEquipment(emptyCampaign(start), ['floor_space', 'dumbbell'])
  return { ...state, draft: normalizeRecommendedDraft({
    ...state.draft, confirmed: currentTraining !== undefined,
    trainingPreferences: { version: 1, runsPerWeek: 14, runDurationMin: 30, liftsPerWeek: 1, liftDurationMin: 45 },
    ...(currentTraining ? { currentTraining } : {}),
  }) }
}

function fourteenRuns(weekStart = start): AuthoredWeekProposal {
  return { version: 1, weekStart, sessions: Array.from({ length: 14 }, (_, index): AuthoredSessionProposal => ({
    id: `run-${index}-${weekStart}`, kind: 'run', label: index === 4 ? 'Long run' : 'Easy run',
    date: addDays(weekStart, Math.floor(index / 2)), startTime: index % 2 ? '18:00' : '07:00',
    durationMin: index === 4 ? 60 : 25, modality: 'run_road', intent: index === 4 ? 'long' : 'easy',
  })) }
}

const lift: AuthoredSessionProposal = {
  id: 'reviewed-lifting', kind: 'workout', label: 'Familiar lifting', date: start, startTime: '12:00', durationMin: 45,
  blocks: [{ unit: 'reps', exerciseId: 'goblet-squat', sets: 6, reps: 12, targetRPE: 8 }],
}

test('fourteen above-baseline runs with two-a-days and no rest day stage, approve and restore without averaging away a long run', () => {
  const initial = setup()
  const brief = buildHandoff(initial, scope)
  assert.ok('desiredTraining' in brief.context)
  assert.equal(brief.context.desiredTraining?.weeklyRunMinutes, 420)
  assert.equal(brief.context.desiredTraining?.weeklyLiftMinutes, 45)
  assert.match(brief.context.desiredTraining!.durationMeaning, /not a cap/)
  assert.match(brief.instructions, /no weekend placement is mandatory/)
  const review = parseHandoffReply(JSON.stringify({ ...brief.example, currentTraining: facts, week: fourteenRuns() }), initial, scope)
  assert.throws(() => applyHandoff(initial, review, scope), /Acknowledge/)
  const staged = applyHandoff(initial, { ...review, currentTrainingAcknowledged: true }, scope)
  assert.equal(staged.setupComplete, false)
  assert.equal(staged.draft.confirmed, false)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(staged))), staged)
  assert.throws(() => buildCampaign(staged), /Confirm/)
  const approved = buildCampaign({ ...staged, draft: { ...staged.draft, confirmed: true } })
  const week = approved.weeks[0]!
  assert.equal(week.plan.policyVersion, AI_ADVISORY_POLICY_VERSION)
  assert.equal(week.plan.safety.passed, true)
  assert.equal(week.plan.sessions.length, 14)
  assert.equal(new Set(week.plan.sessions.map(session => session.date)).size, 7)
  assert.equal(week.plan.sessions.find(session => session.id === `run-4-${start}`)!.durationMin, 60)
  assert.deepEqual(approved.draft.currentTraining, facts)
  assert.ok(week.plan.warnings.some(warning => /advisory/i.test(warning)))
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(approved))), approved)
  const hidden = structuredClone(approved)
  hidden.weeks[0]!.plan.warnings = []
  assert.throws(() => parseCampaign(hidden), /independently checked/)
  assert.equal(initial.weeks.length, 0)
  const notes = buildHandoff(approved, { purpose: 'suggest_exercises' })
  assert.equal(notes.example.version, 2)
  assert.equal(notes.context.planLocked, true)
  assert.doesNotThrow(() => parseHandoffReply(JSON.stringify(notes.example), approved, { purpose: 'suggest_exercises' }))
})

test('truthful zero and high-frequency current training persist without forcing a built-in plan or inventing capacity', () => {
  for (const current of [
    { ...facts, runsPerWeek: 0, weeklyRunMinutes: 0, longestRunMinutes: 0 },
    { ...facts, runsPerWeek: 14, liftsPerWeek: 14, weeklyRunMinutes: 420, longestRunMinutes: 45, liftDurationMin: 30 },
  ]) {
    assert.deepEqual(parseCurrentTraining(current), current)
    const initial = setup(current)
    assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(initial))).draft.currentTraining, current)
    assert.throws(() => buildCampaign(initial), /built-in planner/)
    const approved = buildCampaign({ ...initial, pendingWeek: fourteenRuns() })
    assert.equal(approved.weeks[0]!.plan.sessions.length, 14)
    assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(approved))), approved)
    assert.deepEqual(approved.weeks[0]!.input.athlete.baseline.weeklyRunMinutes, current.weeklyRunMinutes)
  }
  assert.throws(() => parseCurrentTraining({ ...facts, runsPerWeek: AI_ADVISORY_LIMITS.maxRuns + 1 }), /Reported runs/)
  assert.throws(() => parseCurrentTraining({ ...facts, runsPerWeek: 0 }), /conflict/)
})

test('advisory actual overruns and pain stay visible through review, next-week approval and reload without vetoing actual logging', () => {
  let approved = buildCampaign({ ...setup(facts), pendingWeek: fourteenRuns() })
  const first = approved.weeks[0]!.plan.sessions[0]!
  approved = completeCampaignSession(approved, first.id, 90, 7, true)
  const second = approved.weeks[0]!.plan.sessions[1]!
  assert.equal(campaignSessionOnHold(approved, second), false)
  approved = completeCampaignSession(approved, second.id, 35, 5, false)
  assert.equal(approved.weeks[0]!.logs[first.id]!.painFlag, true)
  assert.ok(approved.weeks[0]!.plan.warnings.some(warning => /pain/i.test(warning)))
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(approved))), approved)
  const scratch = { ...setup(facts), draft: { ...approved.draft, confirmed: false } }
  const weeklyScope = { purpose: 'suggest_exercises' as const, weekReview: buildWeekReview(approved), nextWeekStart: addDays(start, 7) }
  const brief = buildHandoff(scratch, weeklyScope)
  assert.deepEqual(brief.context.baseline, facts)
  assert.ok(brief.context.weekReview?.sessions.some(session => session.painFlag && session.actualDurationMin === 90))
  const reviewed = parseHandoffReply(JSON.stringify({ ...brief.example, currentTraining: null, week: fourteenRuns(addDays(start, 7)) }), scratch, weeklyScope)
  const staged = applyHandoff(scratch, reviewed, weeklyScope)
  assert.equal(staged.draft.confirmed, false)
  assert.deepEqual(staged.draft.currentTraining, facts)
  const next = nextCampaignWeek(approved, undefined, staged.pendingWeek)
  assert.equal(next.weeks[1]!.plan.policyVersion, AI_ADVISORY_POLICY_VERSION)
  assert.ok(next.weeks[1]!.input.athlete.safetyHold)
  assert.deepEqual(next.weeks[0], approved.weeks[0])
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(next))), next)
  const later = buildWeekReview(next)
  assert.ok(later)
  assert.ok(later.healthHold)
})

test('advisory block corrections, partial swaps, moves and removals preserve performed identities, weights and history', () => {
  let state = buildCampaign({ ...setup(facts), pendingWeek: { ...fourteenRuns(), sessions: [...fourteenRuns().sessions, lift] } })
  state = logCampaignBlockSet(state, lift.id, 0, 0, { weight: '10', reps: '13', effort: '8' })
  state = logCampaignBlockSet(state, lift.id, 0, 0, { weight: '12', reps: '12', effort: '7' })
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(state))), state)
  const before = structuredClone(state.weeks[0]!)
  state = swapWorkoutExercise(state, lift.id, 0, 'bodyweight-squat', 'preference', true)
  const changed = state.weeks[0]!.plan.sessions.find(session => session.id === lift.id)!
  assert.equal(changed.kind, 'workout')
  assert.equal(changed.blocks[0]!.unit, 'reps')
  assert.equal(changed.blocks[0]!.exerciseId, 'goblet-squat')
  assert.equal(changed.blocks[1]!.unit, 'reps')
  assert.equal(changed.blocks[1]!.suggestedWeightKg, undefined)
  assert.deepEqual(state.weeks[0]!.logs, before.logs)
  const corrupt = structuredClone(state.weeks[0]!)
  corrupt.plan.sessions.find(session => session.id === lift.id)!.durationMin++
  assert.throws(() => assertAuthoredEdit(before, corrupt), /recorded|Partial|identity/i)
  assert.throws(() => parseCampaign({ ...state, weeks: [corrupt] }), /prescription/i)
  const unsupported = structuredClone(state.weeks[0]!)
  const candidate = unsupported.plan.sessions.find(session => session.id === lift.id)!
  assert.equal(candidate.kind, 'workout')
  const unperformed = candidate.blocks[1]!
  assert.equal(unperformed.unit, 'reps')
  unperformed.exerciseId = 'back-squat'
  assert.throws(() => assertAuthoredEdit(before, unsupported), /equipment|resource/i)
  const removed = state.weeks[0]!.plan.sessions.find(session => session.discipline === 'run')!
  state = adaptCampaign(state, { type: 'delete', sessionId: removed.id })
  const remaining = state.weeks[0]!.plan.sessions.find(session => session.discipline === 'run')!
  state = adaptCampaign(state, { type: 'move', sessionId: remaining.id, date: removed.date, startTime: removed.startTime! })
  assert.deepEqual(state.weeks[0]!.removed, [removed])
  assert.deepEqual(state.weeks[0]!.logs, before.logs)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(state))), state)
  const lost = structuredClone(state)
  lost.weeks[0]!.removed = []
  assert.throws(() => parseCampaign(lost), /retain every approved identity/)
})

test('extra actual sets preserve the original prescription while an unrelated unlogged block is swapped and restored', () => {
  const workout: AuthoredSessionProposal = {
    ...lift, blocks: [
      { unit: 'reps', exerciseId: 'push-up', sets: 5, reps: 10, targetRPE: 7 },
      { unit: 'reps', exerciseId: 'goblet-squat', sets: 1, reps: 6, targetRPE: 7 },
    ],
  }
  let state = buildCampaign({ ...setup(facts), pendingWeek: {
    ...fourteenRuns(), sessions: [...fourteenRuns().sessions, workout],
  } })
  for (let setIndex = 0; setIndex < 6; setIndex++) {
    state = logCampaignBlockSet(state, workout.id, 0, setIndex, { weight: '0', reps: '10', effort: '7' })
  }
  const before = structuredClone(state.weeks[0]!)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(state))), state)
  state = swapWorkoutExercise(state, workout.id, 1, 'bodyweight-squat', 'preference', false)
  const changed = state.weeks[0]!.plan.sessions.find(session => session.id === workout.id)!
  const original = before.plan.sessions.find(session => session.id === workout.id)!
  assert.equal(changed.kind, 'workout')
  assert.equal(original.kind, 'workout')
  assert.deepEqual(changed.blocks[0], original.blocks[0])
  assert.equal(changed.blocks[0]!.unit, 'reps')
  assert.equal(changed.blocks[0]!.sets, 5)
  assert.equal(changed.blocks[1]!.unit, 'reps')
  assert.equal(changed.blocks[1]!.exerciseId, 'bodyweight-squat')
  assert.equal(changed.blocks[1]!.suggestedWeightKg, undefined)
  assert.deepEqual(state.weeks[0]!.logs, before.logs)
  const actual = state.weeks[0]!.logs[workout.id]!.blockLogs![0]!
  assert.equal(actual.unit, 'reps')
  assert.equal(actual.sets.length, 6)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(state))), state)
  for (const sets of [4, 6]) {
    const corrupt = structuredClone(state.weeks[0]!)
    const session: Session | undefined = corrupt.plan.sessions.find(candidate => candidate.id === workout.id)
    assert.ok(session)
    assert.equal(session.kind, 'workout')
    assert.equal(session.blocks[0]!.unit, 'reps')
    session.blocks[0]!.sets = sets
    assert.throws(() => assertAuthoredEdit(before, corrupt))
  }
  const rewritten = structuredClone(state.weeks[0]!)
  const rewrittenSession = rewritten.plan.sessions.find(session => session.id === workout.id)!
  assert.equal(rewrittenSession.kind, 'workout')
  assert.equal(rewrittenSession.blocks[0]!.unit, 'reps')
  rewrittenSession.blocks[0]!.exerciseId = 'bodyweight-squat'
  assert.throws(() => assertAuthoredEdit(before, rewritten))
  state = completeCampaignSession(state, workout.id, 55, 7, false)
  const next = nextCampaignWeek(state)
  const repeated = next.weeks[1]!.authored!.sessions.find(session => session.kind === 'workout')!
  assert.equal(repeated.kind, 'workout')
  assert.deepEqual(repeated.blocks, workout.blocks)
  assert.deepEqual(next.weeks[0]!.logs, state.weeks[0]!.logs)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(next))), next)
})

test('AI advisory transfer still rejects malformed data, unknown profiles, unavailable equipment and altered committed work', () => {
  const initial = setup(facts)
  const brief = buildHandoff(initial, scope)
  const reply = { ...brief.example, currentTraining: null, week: fourteenRuns() }
  for (const week of [
    { ...fourteenRuns(), sessions: [fourteenRuns().sessions[0], fourteenRuns().sessions[0]] },
    { ...fourteenRuns(), sessions: [{ ...lift, blocks: [{ unit: 'reps', exerciseId: 'goblet-squat', sets: 1, reps: 8, targetRPE: 7, weightKg: 12 }] }] },
    { ...fourteenRuns(), sessions: [{ ...lift, blocks: [{ unit: 'reps', exerciseId: 'invented-lift', sets: 1, reps: 8, targetRPE: 7 }] }] },
  ]) assert.throws(() => parseHandoffReply(JSON.stringify({ ...reply, week }), initial, scope))
  assert.throws(() => parseHandoffReply(JSON.stringify({ ...reply, customExercises: [{
    version: 1, id: 'custom-unknown', name: 'Test movement', profileId: 'unknown-profile', requirements: ['floor_space'],
    description: 'Controlled movement', focus: 'Movement control', why: 'Movement practice',
  }] }), initial, scope), /profile/i)
  assert.throws(() => buildCampaign({ ...initial, pendingWeek: {
    version: 1, weekStart: start, sessions: [{
      id: 'unequipped-row', kind: 'conditioning', modality: 'row', label: 'Rowing', date: start, startTime: '07:00', durationMin: 30,
    }],
  } }), /equipment|resource/i)
  const approved = buildCampaign({ ...initial, pendingWeek: fourteenRuns() })
  const session = approved.weeks[0]!.plan.sessions[0]!
  const logged = completeCampaignSession(approved, session.id, 25, 5, false)
  assert.throws(() => adaptCampaign(logged, { type: 'delete', sessionId: session.id }), /Started|finished/)
})

test('advisory weeks preserve original fixed commitments through moves, revisions and canonical restore', () => {
  const initial = setup(facts)
  initial.draft = normalizeRecommendedDraft({ ...initial.draft, practiceDays: [1], practiceDuration: 60, practiceTime: '19:00' })
  const approved = buildCampaign({ ...initial, pendingWeek: fourteenRuns() })
  const fixed = approved.weeks[0]!.plan.sessions.find(session => session.kind === 'commitment')!
  assert.ok(fixed)
  assert.throws(() => adaptCampaign(approved, { type: 'move', sessionId: fixed.id, date: addDays(start, 2), startTime: '19:00' }), /fixed commitment/i)
  const corrupt = structuredClone(approved)
  corrupt.weeks[0]!.plan.sessions.find(session => session.id === fixed.id)!.durationMin++
  assert.throws(() => parseCampaign(corrupt), /prescription|commitment/i)
  const changed = normalizeRecommendedDraft({ ...approved.draft, practiceDuration: 61 })
  assert.throws(() => nextCampaignWeek(approved, changed, fourteenRuns(addDays(start, 7))), /Revision practiceDuration/)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(approved))), approved)
})

test('without another AI reply, next-week approval repeats the approved pattern instead of the strict generator or fatigue reductions', t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Repeating a reviewed week must not contact AI'))
  const initial = setup(facts)
  const source = { ...fourteenRuns(), sessions: [...fourteenRuns().sessions, lift] }
  let state = buildCampaign({ ...initial, pendingWeek: source })
  const original = structuredClone(state.weeks[0]!)
  state = logCampaignBlockSet(state, lift.id, 0, 0, { weight: '10', reps: '14', effort: '8' })
  state = completeCampaignSession(state, lift.id, 80, 8, true)
  assert.deepEqual(state.weeks[0]!.plan.sessions, original.plan.sessions)
  const skip = state.weeks[0]!.plan.sessions.find(session => session.discipline === 'run')!
  state = adaptCampaign(state, { type: 'skip', sessionId: skip.id, reason: 'too_tired' })
  assert.deepEqual(state.weeks[0]!.plan.sessions, original.plan.sessions.filter(session => session.id !== skip.id))
  const recorded = structuredClone(state)
  const next = nextCampaignWeek(state)
  assert.deepEqual(state, recorded)
  assert.deepEqual(next.weeks[0], recorded.weeks[0])
  const repeated = next.weeks[1]!
  assert.equal(repeated.plan.policyVersion, AI_ADVISORY_POLICY_VERSION)
  assert.equal(repeated.plan.safety.passed, true)
  assert.equal(repeated.plan.sessions.filter(session => session.discipline === 'run').length, 14)
  assert.equal(repeated.plan.sessions.length, 15)
  assert.equal(new Set(repeated.plan.sessions.map(session => session.date)).size, 7)
  assert.ok(repeated.input.athlete.safetyHold)
  assert.deepEqual(repeated.logs, {})
  assert.deepEqual(repeated.input.athlete.baseline, original.input.athlete.baseline)
  const comparable = (proposal: AuthoredWeekProposal) => proposal.sessions.map(({ id, date, ...session }) => {
    void id; void date
    return session
  })
  assert.deepEqual(comparable(repeated.authored!), comparable(source))
  assert.ok(repeated.plan.warnings.some(warning => /unchanged quantities/.test(warning)))
  assert.ok(repeated.plan.sessions.every(session => !original.plan.sessions.some(previous => previous.id === session.id)))
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(next))), next)
  const third = nextCampaignWeek(next)
  assert.deepEqual(comparable(third.weeks[2]!.authored!), comparable(source))
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(third))), third)
})

test('repeating an AI week supports zero and high-frequency baseline facts without rewriting them', () => {
  for (const currentTraining of [
    { ...facts, runsPerWeek: 0, weeklyRunMinutes: 0, longestRunMinutes: 0 },
    { ...facts, runsPerWeek: 14, liftsPerWeek: 14, weeklyRunMinutes: 420, longestRunMinutes: 45, liftDurationMin: 30 },
  ]) {
    const approved = buildCampaign({ ...setup(currentTraining), pendingWeek: fourteenRuns() })
    const next = nextCampaignWeek(approved)
    assert.deepEqual(next.draft.currentTraining, currentTraining)
    assert.equal(next.weeks[1]!.plan.sessions.length, 14)
    assert.ok(next.weeks[1]!.plan.sessions.some(session => session.durationMin === 60))
    assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(next))), next)
  }
})

test('explicit cardio devices reach new AI inputs, prompts and repeats without changing legacy resource projection', () => {
  for (const [modality, device] of [['row', 'rower'], ['ski_erg', 'ski_erg'], ['bike_road', 'bike'], ['bike_gravel', 'bike']] as const) {
    const initial = confirmSetupEquipment(emptyCampaign(start), ['floor_space', device])
    initial.draft = normalizeRecommendedDraft({
      ...initial.draft, currentTraining: { ...facts, liftsPerWeek: 2, liftDurationMin: 45 }, confirmed: true,
      trainingPreferences: { version: 1, runsPerWeek: 2, runDurationMin: 30, liftsPerWeek: 2, liftDurationMin: 45 },
    })
    assert.ok(!programResources(initial.draft.resources!).includes(device))
    assert.ok(programResources(initial.draft.resources!, AI_PLANNING_OPTIONS).includes(device))
    const brief = buildHandoff(initial, scope)
    assert.ok(brief.context.program?.resources.includes(device))
    const proposal = (weekStart: string): AuthoredWeekProposal => ({
      version: 1, weekStart, sessions: [{
        id: `conditioning-${weekStart}`, kind: 'conditioning', modality, date: weekStart,
        startTime: '07:00', durationMin: 30, label: 'Easy conditioning',
      }],
    })
    const approved = buildCampaign({ ...initial, pendingWeek: proposal(start) })
    assert.ok(approved.weeks[0]!.input.athlete.program!.resources.includes(device))
    assert.deepEqual(approved.draft.program, initial.draft.program)
    assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(approved))), approved)
    const repeated = nextCampaignWeek(approved)
    assert.equal(repeated.weeks[1]!.plan.sessions[0]!.modality, modality)
    assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(repeated))), repeated)
    const strict = buildCampaign(initial)
    assert.ok(!strict.weeks[0]!.input.athlete.program!.resources.includes(device))
    assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(strict))), strict)
    const transition = nextCampaignWeek(strict, undefined, proposal(addDays(start, 7)))
    assert.ok(transition.weeks[1]!.input.athlete.program!.resources.includes(device))
    assert.deepEqual(transition.weeks[0], strict.weeks[0])
    assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(transition))), transition)
  }
})
