import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import {
  adaptCampaign, buildCampaign, campaignSessionOnHold, completeCampaignSession, confirmSetupEquipment, emptyCampaign, exampleCampaign,
  logCampaignSet, nextCampaignWeek, normalizeRecommendedDraft, parseCampaign, prepareRecommendedSetup, workoutContent,
} from './model.ts'
import type { CampaignState, SetDraft } from './types.ts'
import type { Session } from '../../engine/types.ts'
import { addDays, dateForWeekday, dayOfWeek } from '../../engine/dates.ts'
import { AI_ADVISORY_POLICY_VERSION } from '../../engine/constants.ts'
import { proposalForSessions } from './authored-calendar.ts'
import { buildWeekReview } from './week-review.ts'
import { startNewPlan } from './plan-history.ts'

const start = '2026-09-07'
function configured(startDate = start): CampaignState {
  const state = exampleCampaign(startDate)
  const draft = { ...state.draft, equipment: ['dumbbell', 'bodyweight', 'bands'] as CampaignState['draft']['equipment'], confirmed: true }
  delete draft.recommendedSetup
  draft.exercises = [['goblet-squat', 16], ['dumbbell-row', 12], ['push-up', 0], ['band-rotation', 0]].map(([exerciseId, weightKg]) => ({
    exerciseId: String(exerciseId), weightKg: Number(weightKg), date: '2026-08-31', sets: 3, reps: 8, actualRPE: 7, experienceMonths: 12,
  }))
  return { ...state, draft }
}
function recommendedFixture(): CampaignState {
  const state = exampleCampaign(start)
  return buildCampaign({ ...state, draft: { ...state.draft, confirmed: true } })
}
function fixture(): CampaignState { return buildCampaign(configured()) }
function strength(state: CampaignState) {
  const session = state.weeks[state.selectedWeek]!.plan.sessions.find(session => session.kind === 'strength')
  assert.ok(session && session.kind === 'strength')
  return session
}
const set: SetDraft = { weight: '12.5', reps: '8', effort: '7' }

test('manual defaults contain no invented baseline observations and cannot build', () => {
  const state = emptyCampaign(start)
  assert.equal(state.draft.weeklyRunMinutes, 0)
  assert.equal(state.draft.runsPerWeek, 0)
  assert.equal(state.draft.liftsPerWeek, 0)
  assert.deepEqual(state.draft.exercises, [])
  assert.deepEqual(parseCampaign(state), state)
  assert.throws(() => buildCampaign(state), /Confirm/)
  assert.throws(() => buildCampaign({ ...state, draft: { ...state.draft, goalLabel: 'Goal', confirmed: true } }), /Usual run duration|Unknown zero/)
})

test('sample is labelled, needs confirmation and yields a deterministic safe calendar', () => {
  const sample = exampleCampaign(start)
  assert.equal(sample.sample, true)
  assert.match(sample.draft.goalLabel, /Sample.*Bangkok/)
  assert.equal(sample.draft.confirmed, false)
  assert.equal(sample.step, 1)
  assert.equal(sample.setupComplete, false)
  assert.deepEqual(sample.weeks, [])
  assert.deepEqual(sample.draft.exercises, [])
  assert.equal(sample.draft.recommendedSetup?.mode, 'assisted')
  assert.match(sample.draft.recommendedSetup!.goalText, /World Championships in Bangkok/)
  assert.deepEqual(sample.draft.practiceDays, [1, 3])
  assert.throws(() => buildCampaign(sample), /Confirm/)
  const state = recommendedFixture()
  assert.deepEqual(recommendedFixture(), state)
  assert.equal(state.weeks[0]!.plan.safety.passed, true)
  assert.ok(state.weeks[0]!.plan.warnings.some(warning => /heuristic/.test(warning)))
  assert.deepEqual(state.weeks[0]!.logs, {})
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(state))), state)
})

test('all weekday starts build, review, advance and restore without changing earlier legacy dates or policies', () => {
  for (let offset = 0; offset < 7; offset++) {
    const startDate = addDays(start, offset)
    let state = buildCampaign(configured(startDate))
    const first = state.weeks[0]
    assert.equal(first.plan.weekStart, startDate)
    assert.deepEqual(first.plan.sessions.filter(session => session.kind === 'commitment').map(session => session.date).sort(),
      [dateForWeekday(startDate, 1), dateForWeekday(startDate, 3)].sort())
    for (const session of first.plan.sessions) {
      state = completeCampaignSession(state, session.id, session.durationMin, 4, false)
    }
    const recorded = structuredClone(state)
    const review = buildWeekReview(state)!
    assert.equal(review.weekStart, startDate)
    assert.equal(review.counts.completed, first.plan.sessions.length)
    assert.deepEqual(review.sessions.map(session => session.date), state.weeks[0].plan.sessions.map(session => session.date))
    const next = nextCampaignWeek(state)
    assert.equal(next.weeks[1].plan.weekStart, addDays(startDate, 7))
    assert.equal(next.weeks[1].input.context.completedWeeks[0].weekStart, startDate)
    assert.equal(next.weeks[1].plan.policyVersion, first.plan.policyVersion)
    assert.deepEqual(next.weeks[0], recorded.weeks[0])
    assert.deepEqual(state, recorded)
    assert.deepEqual(next.weeks[1].input.athlete.availableDays, state.draft.availableDays)
    assert.deepEqual(next.weeks[1].plan.sessions.filter(session => session.kind === 'commitment').map(session => dayOfWeek(session.date)).sort(), [1, 3])
    assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(next))), next)
    const forged = structuredClone(next)
    forged.weeks[1].plan.weekStart = addDays(startDate, 8)
    assert.throws(() => parseCampaign(forged), /Week start/)
  }
})

test('all weekday starts preserve authored dates and repeat the approved pattern by seven days after a one-week skip', () => {
  for (let offset = 0; offset < 7; offset++) {
    const startDate = addDays(start, offset)
    const initial = confirmSetupEquipment(exampleCampaign(startDate), ['floor_space', 'dumbbell', 'bench'])
    const ready = { ...initial, draft: { ...initial.draft, confirmed: true } }
    const fallback = buildCampaign(ready)
    assert.equal(fallback.weeks[0].plan.weekStart, startDate)
    assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(fallback))), fallback)
    const pendingWeek = proposalForSessions(startDate, fallback.weeks[0].plan.sessions)
    let approved = buildCampaign({ ...ready, pendingWeek })
    const source = structuredClone(approved.weeks[0])
    assert.equal(source.plan.policyVersion, AI_ADVISORY_POLICY_VERSION)
    assert.deepEqual(source.authored, pendingWeek)
    const run = source.plan.sessions.find(session => session.discipline === 'run')!
    approved = adaptCampaign(approved, { type: 'skip', sessionId: run.id, reason: 'life' })
    const before = structuredClone(approved)
    const next = nextCampaignWeek(approved)
    const repeated = next.weeks[1]
    assert.equal(repeated.plan.weekStart, addDays(startDate, 7))
    assert.equal(repeated.plan.policyVersion, source.plan.policyVersion)
    assert.deepEqual(repeated.authored!.sessions.map(({ id, ...session }) => { void id; return session }),
      pendingWeek.sessions.map(({ id, ...session }) => { void id; return { ...session, date: addDays(session.date, 7) } }))
    assert.ok(repeated.plan.sessions.every(session => !source.plan.sessions.some(previous => previous.id === session.id)))
    assert.deepEqual(repeated.plan.sessions.filter(session => session.kind === 'commitment').map(session => session.date).sort(),
      [dateForWeekday(addDays(startDate, 7), 1), dateForWeekday(addDays(startDate, 7), 3)].sort())
    assert.deepEqual(next.weeks[0], before.weeks[0])
    assert.deepEqual(approved, before)
    assert.equal(buildWeekReview(next, 0)!.weekStart, startDate)
    assert.equal(buildWeekReview(next, 0)!.counts.skipped, 1)
    assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(next))), next)
  }
})

test('a new plan can start on each weekday without rebasing saved training or weekday choices', () => {
  const built = buildCampaign({ ...configured(), sample: false })
  const session = built.weeks[0].plan.sessions[0]
  const original = completeCampaignSession(built, session.id, session.durationMin, 4, false)
  const before = structuredClone(original)
  for (let offset = 0; offset < 7; offset++) {
    const startDate = addDays('2026-09-14', offset)
    const next = startNewPlan(original, startDate)
    assert.equal(next.draft.startDate, startDate)
    assert.deepEqual(next.draft.availableDays, original.draft.availableDays)
    assert.deepEqual(next.draft.practiceDays, original.draft.practiceDays)
    assert.deepEqual(next.pastPlans, [before])
    assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(next))), next)
  }
  assert.deepEqual(original, before)
})

test('classic setup derives weekly totals from normal sessions and builds without exercise observations or AI', () => {
  const state = emptyCampaign(start)
  assert.equal(state.draft.goalLabel, 'Run + lift')
  assert.equal(state.draft.recommendedSetup?.mode, 'classic')
  const draft = normalizeRecommendedDraft({
    ...state.draft, runsPerWeek: 3, liftsPerWeek: 2, liftDurationMin: 45, confirmed: true,
    recommendedSetup: { ...state.draft.recommendedSetup!, typicalRunMinutes: 30 },
  })
  assert.equal(draft.weeklyRunMinutes, 90)
  assert.equal(draft.weeklyTimeBudgetMin, 180)
  const built = buildCampaign({ ...state, draft: { ...draft, weeklyRunMinutes: 123, weeklyTimeBudgetMin: 456 } })
  assert.equal(built.draft.weeklyRunMinutes, 90)
  assert.equal(built.draft.weeklyTimeBudgetMin, 180)
  assert.equal(built.weeks[0]!.input.athlete.baseline.longestRunMinutes, 30)
  assert.deepEqual(built.weeks[0]!.input.athlete.baseline.exercises, [])
  assert.deepEqual(built.draft.exercises, [])
  assert.ok(built.weeks[0]!.input.block.anchors.every(anchor => anchor.provenance?.kind === 'recommended'))
  assert.ok(strength(built).strengthPrescription.every(item => item.suggestedWeightKg === undefined))
  assert.deepEqual(parseCampaign(built), built)
})

test('classic normalization locks hybrid priorities while assisted choices and legacy drafts are preserved', () => {
  const state = emptyCampaign(start)
  const input = { ...state.draft, goalKind: 'dodgeball' as const, priorities: ['power', 'repeat_sprint'] as CampaignState['draft']['priorities'] }
  const normalized = normalizeRecommendedDraft(input)
  assert.equal(normalized.goalKind, 'hybrid')
  assert.deepEqual(normalized.priorities, ['aerobic_base', 'max_strength'])
  assert.equal(input.goalKind, 'dodgeball')
  assert.deepEqual(input.priorities, ['power', 'repeat_sprint'])
  const assisted = exampleCampaign(start).draft
  assert.equal(normalizeRecommendedDraft(assisted).goalKind, 'dodgeball')
  assert.deepEqual(normalizeRecommendedDraft(assisted).priorities, assisted.priorities)
  const legacy = configured().draft
  assert.equal(normalizeRecommendedDraft(legacy), legacy)
})

test('classic review date follows the block start while assisted dates stay explicit and unfinished dates persist', () => {
  const state = emptyCampaign(start)
  const draft = normalizeRecommendedDraft({
    ...state.draft, startDate: '2027-02-01', runsPerWeek: 3, liftsPerWeek: 2, liftDurationMin: 45, confirmed: true,
    recommendedSetup: { ...state.draft.recommendedSetup!, typicalRunMinutes: 30 },
  })
  assert.equal(draft.eventDate, '2027-04-25')
  const built = buildCampaign({ ...state, draft })
  assert.equal(built.weeks[0]!.plan.weekStart, '2027-02-01')
  assert.equal(built.weeks[0]!.input.block.totalWeeks, 12)
  assert.deepEqual(parseCampaign(built), built)
  const assisted = exampleCampaign(start).draft
  assert.equal(normalizeRecommendedDraft({ ...assisted, startDate: '2027-02-01' }).eventDate, assisted.eventDate)
  for (const value of ['', '2027-02-']) {
    const unfinished = normalizeRecommendedDraft({ ...state.draft, startDate: value })
    assert.equal(unfinished.eventDate, '')
    assert.deepEqual(parseCampaign({ ...state, draft: unfinished }).draft, unfinished)
  }
})

test('assisted card additions and swaps stay pre-commit, equipment checked and engine dosed', () => {
  const state = exampleCampaign(start)
  const draft = normalizeRecommendedDraft({ ...state.draft, confirmed: true,
    recommendedSetup: { ...state.draft.recommendedSetup!, exerciseIds: ['split-squat', 'dumbbell-row', 'push-up', 'dead-bug'] } })
  const built = buildCampaign({ ...state, draft })
  assert.ok(built.weeks[0]!.input.block.anchors.some(anchor => anchor.exerciseId === 'split-squat'))
  assert.ok(!built.weeks[0]!.input.block.anchors.some(anchor => anchor.exerciseId === 'goblet-squat'))
  assert.deepEqual(built.draft.exercises, [])
  assert.throws(() => buildCampaign(built), /cannot be overwritten/)
  for (const id of ['snatch', 'invented-ai-exercise', 'bench-press']) {
    assert.throws(() => buildCampaign({ ...state, draft: {
      ...state.draft, confirmed: true, recommendedSetup: { ...state.draft.recommendedSetup!, exerciseIds: [id] },
    } }), /supported|equipment/)
  }
})

test('recommended matching completed set logs supply next-week weights without becoming fabricated observations', () => {
  let state = recommendedFixture()
  const session = strength(state)
  const exercise = session.strengthPrescription[0]!
  assert.equal(exercise.suggestedWeightKg, undefined)
  assert.equal(session.isCalibration, true)
  state = logCampaignSet(state, session.id, exercise.exerciseId, 0, { weight: '0', reps: String(exercise.reps), effort: String(exercise.targetRPE) })
  state = completeCampaignSession(state, session.id, 25, 4, false)
  const next = nextCampaignWeek(state)
  assert.equal(strength(next).strengthPrescription.find(item => item.exerciseId === exercise.exerciseId)?.suggestedWeightKg, 0)
  assert.deepEqual(next.weeks[1]!.input.athlete.baseline.exercises, [])
  assert.deepEqual(next.draft.exercises, [])
  assert.deepEqual(parseCampaign(next), next)
})

test('legacy observed campaign fingerprints and stored contracts remain unchanged', () => {
  const state = fixture()
  assert.equal(Object.hasOwn(state.draft, 'recommendedSetup'), false)
  assert.equal(Object.hasOwn(state.weeks[0]!.input.athlete, 'recommendedExerciseIds'), false)
  assert.equal(createHash('sha256').update(JSON.stringify(state.weeks[0]!.input)).digest('hex'),
    'c8f6f49bcf2ba2600f9d8950d6df9b8416f5d8b45cc16fae9caceb848fa24fd4')
  assert.equal(createHash('sha256').update(JSON.stringify(state.weeks[0]!.plan)).digest('hex'),
    'e281ef2c690bd23b5498ce45fa1a521ae0225a39b737eb9de57e699c27944f51')
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(state))), state)
  assert.equal(prepareRecommendedSetup(state), state)
  assert.equal(normalizeRecommendedDraft(state.draft), state.draft)
})

test('only unfinished legacy drafts can be prepared, retaining actual applicable observations without inventing placeholders', () => {
  const legacy = configured()
  const before = JSON.stringify(legacy)
  const prepared = prepareRecommendedSetup(legacy)
  assert.equal(JSON.stringify(legacy), before)
  assert.equal(prepared.draft.recommendedSetup?.typicalRunMinutes, 30)
  assert.deepEqual(prepared.draft.exercises, legacy.draft.exercises)
  assert.equal(prepared.draft.confirmed, false)
  assert.equal(prepared.weeks.length, 0)
  const built = buildCampaign({ ...prepared, draft: { ...prepared.draft, confirmed: true } })
  assert.ok(built.weeks[0]!.input.block.anchors.every(anchor => anchor.provenance === undefined))
  const unfinished = configured()
  unfinished.draft.exercises[0]!.date = ''
  unfinished.draft.exercises[0]!.sets = 0
  const cleaned = prepareRecommendedSetup(unfinished)
  assert.ok(!cleaned.draft.exercises.some(item => item.exerciseId === unfinished.draft.exercises[0]!.exerciseId))
  assert.ok(cleaned.draft.recommendedSetup!.exerciseIds.includes(unfinished.draft.exercises[0]!.exerciseId))
  assert.deepEqual(parseCampaign(cleaned), cleaned)
})

test('recommended stored plans reject corrupted provenance, selections, derived totals and made-up starting weights', () => {
  const state = recommendedFixture()
  for (const mutate of [
    (copy: CampaignState) => { copy.weeks[0]!.input.block.anchors[0]!.provenance!.policyVersion = 'AI-unbounded' },
    (copy: CampaignState) => { copy.draft.recommendedSetup!.exerciseIds = ['snatch'] },
    (copy: CampaignState) => { copy.draft.weeklyRunMinutes++ },
    (copy: CampaignState) => { copy.draft.weeklyTimeBudgetMin++ },
    (copy: CampaignState) => { strength(copy).strengthPrescription[0]!.suggestedWeightKg = 0 },
  ]) {
    const copy = structuredClone(state)
    mutate(copy)
    assert.throws(() => parseCampaign(copy))
  }
})

test('unfinished onboarding accepts cleared dates, exercise rows and numeric fields without treating them as observations', () => {
  const draft = exampleCampaign(start)
  draft.draft.startDate = ''
  draft.draft.eventDate = ''
  draft.draft.practiceTime = ''
  draft.draft.goalLabel = ''
  draft.draft.weeklyRunMinutes = 0
  draft.draft.runsPerWeek = 0
  draft.draft.liftsPerWeek = 0
  draft.draft.liftDurationMin = 0
  draft.draft.weeklyTimeBudgetMin = 0
  draft.draft.practiceDuration = 0
  draft.draft.exercises = [{
    exerciseId: 'back-squat', date: '', weightKg: 0, sets: 0, reps: 0, actualRPE: 0 as 7, experienceMonths: 0,
  }]
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(draft))), draft)
  assert.throws(() => buildCampaign({ ...draft, draft: { ...draft.draft, confirmed: true } }))
  const typing = configured()
  typing.draft.startDate = '2026-09-08'
  typing.draft.exercises[0]!.reps = -1
  typing.draft.weeklyRunMinutes = 5000
  assert.deepEqual(parseCampaign(typing), typing)
  assert.throws(() => buildCampaign({ ...typing, draft: { ...typing.draft, confirmed: true } }))
  assert.throws(() => parseCampaign({ ...typing, draft: { ...typing.draft, weeklyRunMinutes: Number.NaN } }), /finite/)
})

test('stale/maximal baselines and unsafe commitments cannot silently save', () => {
  const state = configured()
  const stale = structuredClone(state)
  stale.draft.exercises[0]!.date = '2026-01-01'
  assert.throws(() => buildCampaign(stale), /42 days/)
  const maximal = structuredClone(state)
  maximal.draft.exercises[0]!.actualRPE = 9
  assert.throws(() => buildCampaign(maximal), /comfortable/)
  const unsafe = structuredClone(state)
  unsafe.draft.weeklyTimeBudgetMin = 100
  assert.throws(() => buildCampaign(unsafe), /No safe calendar/)
  const omissions = structuredClone(state)
  omissions.draft.weeklyTimeBudgetMin = 190
  const result = buildCampaign(omissions)
  assert.equal(result.weeks[0]!.plan.safety.passed, true)
  assert.equal(result.weeks[0]!.plan.feasibility.fits, false)
  assert.ok(result.weeks[0]!.plan.warnings.some(warning => /omits work/.test(warning)))
})

test('goal kinds and selected priorities change content and supplied scoring priorities, not numeric invention', () => {
  const results: string[] = []
  for (const kind of ['dodgeball', 'running', 'hybrid', 'custom'] as const) {
    const draft = configured()
    draft.draft.goalKind = kind
    draft.draft.goalLabel = 'Arbitrary location-independent label'
    draft.draft.priorities = kind === 'running' ? ['aerobic_base', 'threshold'] : ['power', 'shoulder_durability']
    const state = buildCampaign(draft)
    const session = strength(state)
    const before = JSON.stringify(session)
    const content = workoutContent(state, session)
    results.push(content.focus)
    assert.equal(JSON.stringify(session), before)
    assert.deepEqual(state.weeks[0]!.input.block.goal.qualityBias, draft.draft.priorities)
    assert.ok(!content.focus.includes('Bangkok'))
  }
  assert.equal(new Set(results).size, 4)
})

test('logging one set stays partial, never logs suggestions or overwrites a different exercise', () => {
  const initial = fixture()
  const session = strength(initial)
  assert.equal(initial.weeks[0]!.logs[session.id], undefined)
  const last = session.strengthPrescription.at(-1)!
  const first = session.strengthPrescription[0]!
  let state = logCampaignSet(initial, session.id, last.exerciseId, 0, set)
  state = logCampaignSet(state, session.id, first.exerciseId, 0, { weight: '0', reps: '5', effort: '6.5' })
  const log = state.weeks[0]!.logs[session.id]!
  assert.equal(log.status, 'partial')
  assert.equal(log.actualDurationMin, undefined)
  assert.equal(log.sets?.length, 2)
  assert.equal(log.sets?.[0]?.exerciseId, first.exerciseId)
  assert.equal(log.sets?.[1]?.exerciseId, last.exerciseId)
  assert.equal(log.sets?.[1]?.weightKg, 12.5)
  state = logCampaignSet(state, session.id, first.exerciseId, 0, { ...set, weight: '1' })
  assert.equal(state.weeks[0]!.logs[session.id]!.sets?.length, 2)
  assert.equal(state.weeks[0]!.logs[session.id]!.sets?.[1]?.weightKg, 12.5)
  assert.deepEqual(parseCampaign(state), state)
  assert.equal(initial.weeks[0]!.logs[session.id], undefined)
})

test('submitting a set clears only that input draft and zero whole-session effort is valid', () => {
  const state = fixture()
  const session = strength(state)
  const exercise = session.strengthPrescription[0]!.exerciseId
  const key = `${session.id}:${exercise}:0`
  const otherKey = `${session.id}:${session.strengthPrescription[1]!.exerciseId}:0`
  state.setDrafts = { [key]: set, [otherKey]: { ...set, weight: '20' } }
  const logged = logCampaignSet(state, session.id, exercise, 0, set)
  assert.equal(Object.hasOwn(logged.setDrafts, key), false)
  assert.deepEqual(logged.setDrafts[otherKey], state.setDrafts[otherKey])
  assert.equal(state.setDrafts[key], set)
  const completed = completeCampaignSession(logged, session.id, 20, 0, false)
  assert.equal(completed.weeks[0]!.logs[session.id]!.actualEffort, 0)
  assert.deepEqual(parseCampaign(completed), completed)
})

test('set order and numeric validations reject blanks, invalid RPE, nonfinite values and nonexistent exercises', () => {
  const state = fixture()
  const session = strength(state)
  const exercise = session.strengthPrescription[0]!.exerciseId
  for (const value of [
    { ...set, weight: '' }, { ...set, weight: '-1' }, { ...set, weight: 'Infinity' }, { ...set, weight: '501' },
    { ...set, reps: '0' }, { ...set, reps: '1.5' }, { ...set, effort: '7.2' }, { ...set, effort: '11' },
  ]) assert.throws(() => logCampaignSet(state, session.id, exercise, 0, value))
  assert.throws(() => logCampaignSet(state, session.id, exercise, 99, set), /index/)
  assert.throws(() => logCampaignSet(state, session.id, 'unknown', 0, set), /not prescribed/)
  const configuredState = configured()
  configuredState.draft.exercises.forEach(observation => { observation.sets = 5 })
  const multi = buildCampaign(configuredState)
  const multiSession = strength(multi)
  assert.throws(() => logCampaignSet(multi, multiSession.id, multiSession.strengthPrescription[0]!.exerciseId, 1, set), /in order/)
})

test('completion is explicit, retains partial set logs, and locks the session against later edits', () => {
  const initial = fixture()
  const session = strength(initial)
  const exercise = session.strengthPrescription[0]!.exerciseId
  const partial = logCampaignSet(initial, session.id, exercise, 0, set)
  assert.throws(() => completeCampaignSession(partial, session.id, 0, 5, false), /Actual duration/)
  assert.throws(() => completeCampaignSession(partial, session.id, 30, Number.NaN, false), /effort/)
  const completed = completeCampaignSession(partial, session.id, 30, 5, false)
  assert.deepEqual(completed.weeks[0]!.logs[session.id]!.sets, partial.weeks[0]!.logs[session.id]!.sets)
  assert.equal(completed.weeks[0]!.logs[session.id]!.status, 'completed')
  assert.throws(() => adaptCampaign(completed, { type: 'delete', sessionId: session.id }), /partially logged/)
  assert.throws(() => logCampaignSet(completed, session.id, exercise, 0, set), /not-yet-completed/)
  assert.deepEqual(parseCampaign(completed), completed)
})

test('model adaptations preserve immutable weeks and never restore skip/delete tombstones', () => {
  const original = fixture()
  const run = original.weeks[0]!.plan.sessions.find(session => session.kind === 'run')!
  let adapted = adaptCampaign(original, { type: 'skip', sessionId: run.id, reason: 'life' })
  const nextRun = adapted.weeks[0]!.plan.sessions.find(session => session.kind === 'run')!
  adapted = adaptCampaign(adapted, { type: 'delete', sessionId: nextRun.id })
  assert.equal(original.weeks[0]!.removed.length, 0)
  assert.ok(adapted.weeks[0]!.removed.some(session => session.id === run.id))
  assert.deepEqual(parseCampaign(adapted), adapted)
  const advanced = nextCampaignWeek(adapted)
  assert.deepEqual(advanced.weeks[0], adapted.weeks[0])
  assert.deepEqual(parseCampaign(advanced), advanced)
  assert.throws(() => adaptCampaign({ ...advanced, selectedWeek: 0 }, { type: 'delete', sessionId: strength(adapted).id }), /archived/)
})

test('campaign wrapper forwards the current-date boundary while permitting earlier future moves', () => {
  const state = fixture()
  const target = strength(state)
  const action = { type: 'move' as const, sessionId: target.id, date: start, startTime: '08:00' }
  const moved = adaptCampaign(state, action, start)
  assert.equal(moved.weeks[0]!.plan.sessions.find(session => session.id === target.id)?.date, start)
  assert.deepEqual(parseCampaign(moved), moved)
  assert.throws(() => adaptCampaign(state, action, '2026-09-09'), /past-date boundary/)
  assert.throws(() => adaptCampaign(state, { type: 'delete', sessionId: state.weeks[0]!.plan.sessions[0]!.id }, '2026-09-09'), /Past sessions/)
})

test('an in-progress session blocks week advancement until explicitly finished, without freezing its set logs', () => {
  const state = fixture()
  const session = strength(state)
  const exercise = session.strengthPrescription[0]!.exerciseId
  const partial = logCampaignSet(state, session.id, exercise, 0, set)
  const before = JSON.stringify(partial)
  assert.throws(() => nextCampaignWeek(partial), /Finish each in-progress session.*logged sets remain saved and editable/)
  assert.equal(JSON.stringify(partial), before)
  assert.equal(partial.weeks.length, 1)
  const corrected = logCampaignSet(partial, session.id, exercise, 0, { ...set, reps: '7' })
  const completed = completeCampaignSession(corrected, session.id, 25, 5, false)
  const next = nextCampaignWeek(completed)
  assert.equal(next.weeks.length, 2)
  assert.equal(next.weeks[0]!.logs[session.id]!.status, 'completed')
  assert.equal(next.weeks[0]!.logs[session.id]!.sets?.[0]?.reps, 7)
  assert.deepEqual(parseCampaign(next), next)
})
test('fatigue carries conservatively across multiple weeks; time skips are not health holds', () => {
  const state = fixture()
  const target = state.weeks[0]!.plan.sessions.find(session => session.kind === 'run')!
  const tired = nextCampaignWeek(adaptCampaign(state, { type: 'skip', sessionId: target.id, reason: 'too_tired' }))
  const time = nextCampaignWeek(adaptCampaign(state, { type: 'skip', sessionId: target.id, reason: 'life' }))
  const runMinutes = (sessions: readonly Session[]) => sessions.filter(session => session.kind === 'run').reduce((sum, session) => sum + session.durationMin, 0)
  assert.ok(runMinutes(tired.weeks[1]!.plan.sessions) < runMinutes(time.weeks[1]!.plan.sessions))
  assert.equal(time.weeks[1]!.input.athlete.safetyHold, null)
  const future = nextCampaignWeek(tired)
  assert.ok(runMinutes(future.weeks[2]!.plan.sessions) <= runMinutes(tired.weeks[1]!.plan.sessions))
  assert.deepEqual(parseCampaign(future), future)
})

test('pain completion holds future optional work, keeps logged sets and carries health context', () => {
  let state = fixture()
  const first = state.weeks[0]!.plan.sessions[0]!
  state = completeCampaignSession(state, first.id, 15, 4, true)
  assert.ok(state.weeks[0]!.plan.sessions.every(session => session.id === first.id || session.kind === 'commitment'))
  assert.equal(state.weeks[0]!.logs[first.id]!.status, 'completed')
  assert.deepEqual(parseCampaign(state), state)
  assert.throws(() => nextCampaignWeek(state), /hold blocks the next week/)
  assert.equal(state.weeks.length, 1)
  for (const session of state.weeks[0]!.plan.sessions.filter(session => session.id !== first.id)) {
    assert.equal(campaignSessionOnHold(state, session), true)
    assert.throws(() => completeCampaignSession(state, session.id, 60, 5, false), /on hold/)
  }
  assert.equal(state.weeks[0]!.plan.feasibility.fits, false)
  assert.ok(state.weeks[0]!.plan.safety.violations.some(item => item.rule === 'calendarPainHold'))
})

test('pain retains exact future strength pins but blocks new sets and completion', () => {
  let state = fixture()
  const session = strength(state)
  state = adaptCampaign(state, { type: 'move', sessionId: session.id, date: session.date, startTime: '08:00' })
  const pinned = state.weeks[0]!.plan.sessions.find(item => item.id === session.id)!
  const first = state.weeks[0]!.plan.sessions[0]!
  state = completeCampaignSession(state, first.id, 15, 4, true)
  assert.deepEqual(state.weeks[0]!.plan.sessions.find(item => item.id === session.id), pinned)
  assert.equal(campaignSessionOnHold(state, pinned), true)
  assert.throws(() => logCampaignSet(state, pinned.id, session.strengthPrescription[0]!.exerciseId, 0, set), /on hold/)
  assert.throws(() => completeCampaignSession(state, pinned.id, 20, 5, false), /on hold/)
  assert.deepEqual(parseCampaign(state), state)
})

test('strict parser rejects corrupted plans, derived safety, impossible logs, unknown properties and nonfinite numbers', () => {
  const original = fixture()
  const corruptions: ((state: CampaignState) => void)[] = [
    state => { state.version = 2 as 1 },
    state => { state.weeks[0]!.plan.totalScore = Number.NaN },
    state => { state.weeks[0]!.plan.safety = { passed: false, violations: [] } },
    state => { state.weeks[0]!.plan.sessions[0]!.predictedLoad.systemic = 999 },
    state => { state.weeks[0]!.plan.sessions[0]!.durationMin = 999 },
    state => { state.weeks[0]!.plan = { ...state.weeks[0]!.plan, sessions: state.weeks[0]!.plan.sessions.slice(1) } },
    state => { state.weeks[0]!.input.athlete.baseline.weeklyRunMinutes = 999 },
    state => { state.weeks[0]!.input.athlete.calibration.costMultiplier = 1.2 },
    state => { state.weeks[0]!.input.athlete.residual.load.systemic = 100 },
    state => { state.weeks[0]!.logs.bad = { sessionId: 'bad', status: 'completed', painFlag: false, notes: '' } },
  ]
  for (const corrupt of corruptions) {
    const state = structuredClone(original)
    corrupt(state)
    assert.throws(() => parseCampaign(state))
  }
  assert.throws(() => parseCampaign({ ...original, unsupported: true }), /unsupported/)
  for (const value of [null, {}, [], { version: 1 }]) assert.throws(() => parseCampaign(value))
})

test('stored log ordering and following-week recovery context cannot be corrupted', () => {
  const state = fixture()
  const session = strength(state)
  const first = session.strengthPrescription[0]!
  const last = session.strengthPrescription.at(-1)!
  const logged = logCampaignSet(logCampaignSet(state, session.id, last.exerciseId, 0, set), session.id, first.exerciseId, 0, set)
  const reversed = structuredClone(logged)
  reversed.weeks[0]!.logs[session.id]!.sets = [...reversed.weeks[0]!.logs[session.id]!.sets!].reverse()
  assert.throws(() => parseCampaign(reversed), /prescription exercise order/)
  const excess = structuredClone(logged)
  excess.weeks[0]!.logs[session.id]!.sets = Array.from({ length: first.sets + 1 }, () => ({
    exerciseId: first.exerciseId, weightKg: 10, reps: 8, actualRPE: 7,
  }))
  assert.throws(() => parseCampaign(excess), /set count/)
  const completed = completeCampaignSession(logged, session.id, session.durationMin, 5, false)
  const next = nextCampaignWeek(completed)
  const corrupt = structuredClone(next)
  corrupt.weeks[1]!.input.context.recentSessions = []
  assert.throws(() => parseCampaign(corrupt), /derived values|history|context/)
  assert.deepEqual(parseCampaign(next), next)
})
