import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateBlock } from './block.ts'
import { RECOMMENDATION_POLICY } from './constants.ts'
import { DEFAULT_LIBRARY } from './library.ts'
import { planWeek, requestedSessions } from './planner.ts'
import { recommendationForExercise, recommendedExercises } from './recommendations.ts'
import { checkSafety } from './safety.ts'
import type { AthleteState, Equipment, PlanWeekInput, SessionLog } from './types.ts'
import { parseAthlete, parsePlanWeekInput } from './validation.ts'

function fixture(equipment: readonly Equipment[] = ['bodyweight']): PlanWeekInput {
  const athlete: AthleteState = {
    baseline: { asOf: '2026-09-07', weeklyRunMinutes: 90, longestRunMinutes: 30, runsPerWeek: 3,
      liftsPerWeek: 2, liftDurationMin: 45, exercises: [] },
    recommendedExerciseIds: recommendedExercises(equipment),
    equipment, availableDays: [0, 1, 2, 3, 4, 5, 6], weeklyTimeBudgetMin: 180,
    defaultStartTime: '07:00', aggressiveness: 'conservative',
    calibration: { version: 1, costMultiplier: 1, observationCount: 0 },
    residual: { asOfDate: '2026-09-07', asOfTime: '00:00', load: { systemic: 0, structural: 0 } }, safetyHold: null,
  }
  const block = generateBlock(athlete, {
    label: 'Run + lift', peakDate: '2026-11-29', qualityBias: ['aerobic_base', 'max_strength'],
    protectedExerciseIds: [], fixedCommitments: [],
  }, '2026-09-07', DEFAULT_LIBRARY)
  return parsePlanWeekInput({ athlete, block, weekIndex: 0, library: DEFAULT_LIBRARY,
    context: { recentSessions: [], completedWeeks: [], neighboringSessions: [], pinnedSessions: [] } })
}

test('curated routines use only available equipment and supported non-high-skill exercises', () => {
  assert.deepEqual(recommendedExercises([]), ['bodyweight-squat', 'push-up', 'dead-bug'])
  assert.deepEqual(recommendedExercises(['dumbbell', 'bodyweight']), ['goblet-squat', 'dumbbell-row', 'push-up', 'dead-bug'])
  for (const equipment of [['bodyweight'], ['dumbbell'], ['barbell', 'dumbbell', 'bodyweight']] as const) {
    const ids = recommendedExercises(equipment)
    assert.ok(ids.length <= RECOMMENDATION_POLICY.maxExercises)
    for (const id of ids) {
      const exercise = DEFAULT_LIBRARY.exercises.find(item => item.id === id)!
      assert.equal(exercise.highSkill, false)
      assert.ok(exercise.equipment.every(item => item === 'none' || (equipment as readonly Equipment[]).includes(item)))
      assert.deepEqual(recommendationForExercise(id), { sets: 2, reps: 8, targetRPE: 6 })
    }
  }
  assert.throws(() => recommendationForExercise('snatch'), /supported/)
  assert.throws(() => recommendationForExercise('made-up-ai-exercise'), /supported/)
})

test('recommended engine plans are deterministic without any invented observations or starting weights', () => {
  const input = fixture()
  const before = JSON.stringify(input)
  const first = planWeek(input)
  assert.deepEqual(planWeek(input), first)
  assert.equal(JSON.stringify(input), before)
  assert.deepEqual(input.athlete.baseline.exercises, [])
  assert.equal(first.safety.passed, true)
  for (const anchor of input.block.anchors) {
    assert.deepEqual(anchor.provenance, { kind: 'recommended', policyVersion: RECOMMENDATION_POLICY.version })
    assert.ok(anchor.sets <= 2)
    assert.equal(anchor.reps, 8)
    assert.equal(anchor.targetRPE, 6)
  }
  const lifts = first.sessions.filter(session => session.kind === 'strength')
  assert.equal(lifts.length, 2)
  for (const lift of lifts) {
    assert.equal(lift.isCalibration, true)
    assert.ok(lift.strengthPrescription.every(item => item.suggestedWeightKg === undefined && item.sets <= 2 && item.targetRPE === 6))
  }
  const later = requestedSessions({ ...input, weekIndex: 1 }).filter(session => session.kind === 'strength')
  assert.ok(later.every(session => session.isCalibration), 'Unobserved exposures remain calibration beyond week one')
})

test('only own clean completed matching sets supply later starting weights; observations remain empty', () => {
  const input = fixture()
  const previous = planWeek(input).sessions.find(session => session.kind === 'strength')!
  const log: SessionLog = {
    sessionId: previous.id, status: 'completed', actualDurationMin: 25, actualEffort: 4, painFlag: false, notes: '',
    sets: input.block.anchors.map((anchor, index) => ({ exerciseId: anchor.exerciseId, weightKg: index === 0 ? 0 : 5,
      reps: anchor.reps, actualRPE: anchor.targetRPE })),
  }
  const next = { ...input, weekIndex: 1, context: { ...input.context, recentSessions: [{ session: previous, log }] } }
  const session = requestedSessions(next).find(session => session.kind === 'strength')!
  assert.equal(session.isCalibration, false)
  for (const item of session.strengthPrescription) {
    assert.equal(item.suggestedWeightKg, log.sets!.find(set => set.exerciseId === item.exerciseId)!.weightKg)
  }
  assert.equal(planWeek(next).safety.passed, true)
  assert.deepEqual(next.athlete.baseline.exercises, [])
  for (const ineligible of [{ ...log, status: 'partial' as const }, { ...log, painFlag: true },
    { ...log, sets: log.sets!.map(set => ({ ...set, actualRPE: 7 as const })) }]) {
    const candidate = requestedSessions({ ...next, context: { ...next.context, recentSessions: [{ session: previous, log: ineligible }] } })
    assert.ok(candidate.filter(session => session.kind === 'strength').every(session =>
      session.strengthPrescription.every(item => item.suggestedWeightKg === undefined)))
  }
})

test('unobserved legacy anchors remain forbidden; recommended provenance cannot be forged into a global bypass', () => {
  const input = fixture()
  const legacy = { ...input.athlete }
  delete legacy.recommendedExerciseIds
  assert.throws(() => parseAthlete(legacy), /exercises/)
  const missing = structuredClone(input)
  delete missing.block.anchors[0]!.provenance
  assert.throws(() => parsePlanWeekInput(missing), /provenance/)
  assert.equal(checkSafety(missing, requestedSessions(input)).passed, false)
  const forged = structuredClone(input)
  forged.block.anchors[0]!.provenance!.policyVersion = 'unbounded-ai-policy'
  assert.throws(() => parsePlanWeekInput(forged), /policyVersion/)
  assert.equal(checkSafety(forged, requestedSessions(input)).passed, false)
})

test('safety independently vetoes increased recommendation doses, invented weights and missing calibration flags', () => {
  const input = fixture()
  const original = planWeek(input).sessions
  for (const mutate of [
    (session: Extract<typeof original[number], { kind: 'strength' }>) => { session.strengthPrescription[0]!.sets = 3 },
    (session: Extract<typeof original[number], { kind: 'strength' }>) => { session.strengthPrescription[0]!.targetRPE = 8 },
    (session: Extract<typeof original[number], { kind: 'strength' }>) => { session.strengthPrescription[0]!.suggestedWeightKg = 0 },
    (session: Extract<typeof original[number], { kind: 'strength' }>) => { session.isCalibration = false },
  ]) {
    const sessions = structuredClone(original)
    mutate(sessions.find(session => session.kind === 'strength')!)
    assert.equal(checkSafety(input, sessions).passed, false)
  }
  const excessive = structuredClone(input)
  excessive.block.anchors[0]!.sets = 3
  assert.throws(() => planWeek(excessive), /first-exposure/)
})

test('adding the maximum cards cannot bypass the independent total session-work cap', () => {
  const input = fixture(['barbell', 'dumbbell', 'bodyweight'])
  const athlete: AthleteState = { ...input.athlete, aggressiveness: 'aggressive', recommendedExerciseIds: [
    'back-squat', 'goblet-squat', 'bodyweight-squat', 'romanian-deadlift',
    'bench-press', 'dumbbell-row', 'push-up', 'dead-bug',
  ] }
  const block = generateBlock(athlete, input.block.goal, input.block.startDate, input.library)
  const request = { ...input, athlete, block, weekIndex: 1 }
  const plan = planWeek(request)
  assert.equal(plan.safety.passed, true)
  const session = plan.sessions.find(session => session.kind === 'strength')!
  assert.equal(session.strengthPrescription.length, RECOMMENDATION_POLICY.maxExercises)
  assert.equal(session.strengthPrescription.reduce((sum, item) => sum + item.sets, 0), RECOMMENDATION_POLICY.maxSessionSets)
  assert.equal(session.strengthPrescription.reduce((sum, item) => sum + item.sets * item.reps, 0), RECOMMENDATION_POLICY.maxSessionReps)
  const excessive = structuredClone(plan.sessions)
  const changed = excessive.find(session => session.kind === 'strength')!
  changed.strengthPrescription[0]!.sets = 2
  assert.ok(changed.strengthPrescription.every(item => item.sets <= RECOMMENDATION_POLICY.sets),
    'Every individual exercise still obeys its own ceiling')
  const safety = checkSafety(request, excessive)
  assert.equal(safety.passed, false)
  assert.ok(safety.violations.some(item => item.rule === 'recommendedSessionWork'))
})

test('AI-selected incompatible equipment and high-skill choices are rejected before planning', () => {
  const input = fixture()
  assert.throws(() => generateBlock({ ...input.athlete, recommendedExerciseIds: ['bench-press'] },
    input.block.goal, input.block.startDate, input.library), /equipment/)
  assert.throws(() => generateBlock({ ...input.athlete, recommendedExerciseIds: ['snatch'] },
    input.block.goal, input.block.startDate, input.library), /recommendedExerciseIds/)
  const selected = { ...input.athlete, recommendedExerciseIds: ['bodyweight-squat', 'push-up'] }
  const block = generateBlock(selected, input.block.goal, input.block.startDate, input.library)
  assert.deepEqual(block.anchors.map(anchor => anchor.exerciseId), ['bodyweight-squat', 'push-up'])
})

test('recommended plans keep the same availability, time-budget and pain safety floor', () => {
  const input = fixture()
  const hold = planWeek({ ...input, athlete: { ...input.athlete, safetyHold: { reason: 'pain', since: '2026-09-07' } } })
  assert.equal(hold.sessions.length, 0)
  assert.equal(hold.feasibility.fits, false)
  const tight = planWeek({ ...input, athlete: { ...input.athlete, weeklyTimeBudgetMin: 20 } })
  assert.equal(tight.safety.passed, true)
  assert.equal(tight.feasibility.fits, false)
  assert.ok(tight.sessions.reduce((sum, session) => sum + session.durationMin, 0) <= 20)
})
