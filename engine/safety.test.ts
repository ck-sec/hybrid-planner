import assert from 'node:assert/strict'
import test from 'node:test'
import { checkSafety } from './safety.ts'
import type { CommitmentSession, PlanWeekInput, RunSession, Session, StrengthSession } from './types.ts'

function fixture(): PlanWeekInput {
  return {
    athlete: {
      baseline: { asOf: '2026-09-06', weeklyRunMinutes: 120, longestRunMinutes: 60, runsPerWeek: 3,
        liftsPerWeek: 2, liftDurationMin: 45, exercises: [{
          exerciseId: 'squat', date: '2026-09-01', weightKg: 0, sets: 3, reps: 10, actualRPE: 7, experienceMonths: 24,
        }] },
      calibration: { version: 1, costMultiplier: 1, observationCount: 0 },
      availableDays: [0, 1, 2, 3, 4, 5, 6], equipment: ['bodyweight'], weeklyTimeBudgetMin: 500,
      defaultStartTime: '08:00', aggressiveness: 'standard',
      residual: { asOfDate: '2026-09-06', asOfTime: '00:00', load: { systemic: 0, structural: 0 } }, safetyHold: null,
    },
    block: { id: 'block', engineVersion: '0.2.0', policyVersion: 'baseline-bounded-1',
      libraryVersion: 'test', startDate: '2026-09-07', totalWeeks: 4,
      goal: { label: 'Run and lift', peakDate: '2026-10-04', qualityBias: ['aerobic_base'],
        protectedExerciseIds: ['squat'], fixedCommitments: [] },
      phases: [{ kind: 'base', startWeekIndex: 0, endWeekIndex: 3, volumeFraction: 1 }],
      anchors: [{ exerciseId: 'squat', pattern: 'knee_dominant', sets: 3, reps: 10, targetRPE: 7, role: 'anchor' }],
    },
    weekIndex: 0,
    library: { version: 'test', exercises: [{ id: 'squat', name: 'Squat', pattern: 'knee_dominant',
      equipment: ['bodyweight'], coefficients: { systemic: 20, structural: 40 }, competesWithRunning: true, highSkill: false }] },
    context: { recentSessions: [], completedWeeks: [], neighboringSessions: [], pinnedSessions: [] },
  }
}

function run(id = 'run', date = '2026-09-07', startTime: string | null = '08:00', durationMin = 30): RunSession {
  return { id, kind: 'run', discipline: 'run', modality: 'run_road', date, startTime, durationMin,
    predictedLoad: { systemic: 90, structural: 60 }, reason: '', pinned: false, isCalibration: false,
    endurancePrescription: { intent: 'easy', effort: 'conversational' } }
}

function strength(id = 'lift', date = '2026-09-07', startTime: string | null = '08:00'): StrengthSession {
  return { id, kind: 'strength', discipline: 'strength', modality: 'lifting', date, startTime,
    durationMin: 45, predictedLoad: { systemic: 60, structural: 120 }, reason: '', pinned: false, isCalibration: false,
    strengthPrescription: [{ exerciseId: 'squat', sets: 3, reps: 10, targetRPE: 7, role: 'anchor', suggestedWeightKg: 0 }] }
}

function commitment(id = 'fixed-1-2026-09-07', date = '2026-09-07', startTime: string | null = '18:00'): CommitmentSession {
  return { id, kind: 'commitment', discipline: 'sport', modality: 'court_sport', label: 'Practice', date, startTime,
    durationMin: 60, predictedLoad: { systemic: 320, structural: 100 }, pinned: true, isCalibration: false, reason: '' }
}

function establishCommitment(input: PlanWeekInput): CommitmentSession {
  const session = commitment()
  input.block.goal.fixedCommitments = [{ id: 'practice', label: session.label, dayOfWeek: 0,
    startTime: session.startTime!, durationMin: session.durationMin, discipline: session.discipline,
    modality: session.modality, estimatedLoad: { ...session.predictedLoad } }]
  return session
}

function rules(input: PlanWeekInput, sessions: readonly Session[]): string[] {
  return checkSafety(input, sessions).violations.map(violation => violation.rule)
}

test('independent safety accepts an observed bounded week and never mutates its inputs', () => {
  const input = fixture()
  const sessions = [strength(), run('run', '2026-09-08'), strength('lift2', '2026-09-10')]
  const before = JSON.stringify({ input, sessions })
  assert.deepEqual(checkSafety(input, sessions), { passed: true, violations: [] })
  assert.equal(JSON.stringify({ input, sessions }), before)
})

test('an empty optional week remains safe even during a hold, without minimum workout counts', () => {
  const input = fixture()
  assert.equal(checkSafety(input, []).passed, true)
  input.athlete.safetyHold = { since: '2026-09-06', reason: 'illness' }
  assert.equal(checkSafety(input, []).passed, true)
})

test('unique IDs, requested week and available days are independent vetoes', () => {
  const input = fixture()
  assert.ok(rules(input, [run(), run()]).includes('uniqueSessionIds'))
  assert.ok(rules(input, [run('past', '2026-09-06')]).includes('requestedWeek'))
  input.athlete.availableDays = [1, 2, 3]
  assert.ok(rules(input, [run()]).includes('availableDays'))
})

test('pins cannot bypass the peak-date boundary, while later fixed obligations remain visible', () => {
  const input = fixture()
  input.weekIndex = 3
  input.block.goal.peakDate = '2026-10-01'
  const pin = { ...run('pin', '2026-10-02'), pinned: true }
  input.context.pinnedSessions = [pin]
  assert.ok(rules(input, [pin]).includes('goalDateBoundary'))
  input.context.pinnedSessions = []
  const fixed = commitment('fixed-1-2026-09-28', '2026-10-02')
  input.block.goal.fixedCommitments = [{ id: 'practice', label: fixed.label, dayOfWeek: 4,
    startTime: fixed.startTime!, durationMin: fixed.durationMin, discipline: fixed.discipline,
    modality: fixed.modality, estimatedLoad: { ...fixed.predictedLoad } }]
  assert.equal(checkSafety(input, [fixed]).passed, true)
})

test('at most two sessions per day and a genuine session-free rest day are required', () => {
  const input = fixture()
  assert.ok(rules(input, [run('a', undefined, '08:00'), run('b', undefined, '12:00'), run('c', undefined, '18:00')])
    .includes('sessionsPerDay'))
  const week = Array.from({ length: 7 }, (_, index) => run(`r${index}`, `2026-09-${String(7 + index).padStart(2, '0')}`, '08:00', 10))
  assert.ok(rules(input, week).includes('restDay'))
})

test('known overlaps are rejected and touching intervals do not overlap', () => {
  const input = fixture()
  assert.ok(rules(input, [run('a'), run('b', undefined, '08:15')]).includes('overlappingSessions'))
  assert.equal(checkSafety(input, [run('a'), run('b', undefined, '08:30')]).passed, true)
})

test('overlap checks cross midnight and unknown same-day time never establishes safety', () => {
  const input = fixture()
  input.context.neighboringSessions = [run('prior', '2026-09-06', '23:45', 60)]
  assert.ok(rules(input, [run('a', undefined, '00:30')]).includes('overlappingSessions'))
  input.context.neighboringSessions = []
  assert.ok(rules(input, [run('a', undefined, null), run('b', undefined, '19:00')]).includes('unknownSameDayTime'))
})

test('lower/full-body lift gaps are exact end-to-start elapsed hours, not calendar-day differences', () => {
  const input = fixture()
  assert.ok(rules(input, [strength(), strength('next', '2026-09-08', '08:00')]).includes('minimumLiftGap'))
  assert.equal(checkSafety(input, [strength(), strength('next', '2026-09-08', '08:45')]).passed, true)
  assert.ok(rules(input, [strength('late', '2026-09-07', '23:00'), strength('early', '2026-09-08', '22:00')])
    .includes('minimumLiftGap'))
  assert.ok(rules(input, [strength('unknown', undefined, null), strength('next', '2026-09-08')])
    .includes('minimumLiftGap'))
})

test('neighboring lifts constrain requested-week boundaries; distant neighbors do not', () => {
  const input = fixture()
  input.context.neighboringSessions = [strength('prior', '2026-09-06', '18:00')]
  assert.ok(rules(input, [strength()]).includes('minimumLiftGap'))
  input.context.neighboringSessions = [strength('future', '2026-09-14', '08:00')]
  assert.ok(rules(input, [strength('last', '2026-09-13', '18:00')]).includes('minimumLiftGap'))
  input.context.neighboringSessions = [strength('distant', '2026-10-01', null)]
  assert.equal(checkSafety(input, [strength()]).passed, true)
})

test('legacy strength commitments constrain lower-body spacing without inventing exercise prescriptions', () => {
  const input = fixture()
  const legacy: CommitmentSession = { ...commitment('legacy', '2026-09-06', null),
    discipline: 'strength', modality: 'lifting', durationMin: 60,
    predictedLoad: { systemic: 300, structural: 250 }, label: 'Legacy full-body lift (time unknown)' }
  input.context.neighboringSessions = [legacy]
  assert.ok(rules(input, [strength()]).includes('minimumLiftGap'))
  legacy.date = '2026-09-05'
  assert.ok(rules(input, [strength('early', undefined, '00:00')]).includes('minimumLiftGap'))
  assert.equal(checkSafety(input, [strength('later', undefined, '08:00')]).passed, true)
})

test('three consecutive hard days veto both preceding and following boundary collisions', () => {
  const input = fixture()
  const fixed = establishCommitment(input)
  input.context.neighboringSessions = [commitment('sat', '2026-09-05'), commitment('sun', '2026-09-06')]
  assert.ok(rules(input, [fixed]).includes('consecutiveHardDays'))
  input.context.neighboringSessions = [commitment('tue', '2026-09-08'), commitment('wed', '2026-09-09')]
  assert.ok(rules(input, [fixed]).includes('consecutiveHardDays'))
  input.context.neighboringSessions = [commitment('sat', '2026-09-05')]
  assert.equal(checkSafety(input, [fixed]).passed, true)
})

test('identical logged neighbors use actual work: skipped costs nothing and known partial duration controls gaps', () => {
  const input = fixture()
  const prior = strength('prior', '2026-09-06', '08:00')
  input.context.neighboringSessions = [prior]
  input.context.recentSessions = [{ session: prior,
    log: { sessionId: prior.id, status: 'skipped', painFlag: false, notes: '' } }]
  assert.equal(checkSafety(input, [strength()]).passed, true)
  input.context.recentSessions = [{ session: prior,
    log: { sessionId: prior.id, status: 'partial', actualDurationMin: 15, painFlag: false, notes: '' } }]
  assert.equal(checkSafety(input, [strength('next', undefined, '08:15')]).passed, true)
  assert.ok(rules(input, [strength('next', undefined, '08:00')]).includes('minimumLiftGap'))
  input.context.recentSessions = [{ session: prior,
    log: { sessionId: prior.id, status: 'partial', painFlag: false, notes: '' } }]
  assert.ok(rules(input, [strength('next', undefined, '08:15')]).includes('minimumLiftGap'))
})

test('fixed commitments retain date, time, duration and supplied load, even on unavailable days', () => {
  const input = fixture()
  const fixed = establishCommitment(input)
  assert.equal(checkSafety(input, [fixed]).passed, true)
  assert.ok(rules(input, []).includes('fixedCommitmentPreserved'))
  for (const changed of [
    { ...fixed, date: '2026-09-08' }, { ...fixed, startTime: '19:00' },
    { ...fixed, durationMin: 59 }, { ...fixed, predictedLoad: { systemic: 319, structural: 100 } },
  ]) assert.ok(rules(input, [changed]).includes('fixedCommitmentPreserved'))
  input.athlete.availableDays = [1]
  assert.ok(rules(input, [fixed]).includes('availableDays'))
})

test('pins preserve every prescription field and may change explanations only', () => {
  const input = fixture()
  const pin = { ...strength(), pinned: true }
  input.context.pinnedSessions = [pin]
  assert.equal(checkSafety(input, [{ ...pin, reason: 'Updated explanation' }]).passed, true)
  assert.ok(rules(input, []).includes('pinnedSessionPreserved'))
  assert.ok(rules(input, [{ ...pin, date: '2026-09-08' }]).includes('pinnedSessionPreserved'))
  assert.ok(rules(input, [{ ...pin, predictedLoad: { systemic: 0, structural: 0 } }]).includes('pinnedSessionPreserved'))
  assert.ok(rules(input, [{ ...pin, strengthPrescription: [{ ...pin.strengthPrescription[0]!, sets: 2 }] }])
    .includes('pinnedSessionPreserved'))
})

test('baseline run total, longest run, frequencies and weekly time remain hard ceilings', () => {
  const input = fixture()
  assert.ok(rules(input, [run('long', undefined, undefined, 61)]).includes('longestRun'))
  assert.ok(rules(input, [run('a', undefined, undefined, 60), run('b', '2026-09-09', undefined, 60), run('c', '2026-09-11')])
    .includes('weeklyRunVolume'))
  assert.ok(rules(input, [strength(), strength('b', '2026-09-09'), strength('c', '2026-09-11')]).includes('liftFrequency'))
  input.athlete.weeklyTimeBudgetMin = 20
  assert.ok(rules(input, [run()]).includes('weeklyTimeBudget'))
})

test('recent completed normal weeks cap increases at ten percent, with baseline fallback', () => {
  const input = fixture()
  input.context.completedWeeks = [{ weekStart: '2026-08-31', runMinutes: 100, plannedDeload: false, disrupted: false }]
  const within = [run('a', undefined, undefined, 55), run('b', '2026-09-09', undefined, 55)]
  assert.equal(checkSafety(input, within).passed, true)
  assert.ok(rules(input, [within[0]!, { ...within[1]!, durationMin: 56 }]).includes('weeklyRunVolume'))
  input.context.completedWeeks = []
  assert.equal(checkSafety(input, [run('a', undefined, undefined, 60), run('b', '2026-09-09', undefined, 60)]).passed, true)
})

test('normal weeks before a superseding baseline cannot cap it, while newer comparable weeks still do', () => {
  const input = fixture()
  input.weekIndex = 2
  input.athlete.baseline.asOf = '2026-09-07'
  input.context.completedWeeks = [{ weekStart: '2026-08-31', runMinutes: 10, plannedDeload: false, disrupted: false }]
  const sessions = [run('a', '2026-09-21', undefined, 60), run('b', '2026-09-23', undefined, 60)]
  assert.equal(checkSafety(input, sessions).passed, true)
  input.context.completedWeeks = [...input.context.completedWeeks,
    { weekStart: '2026-09-14', runMinutes: 100, plannedDeload: false, disrupted: false }]
  assert.ok(rules(input, sessions).includes('weeklyRunVolume'))
  assert.equal(checkSafety(input, sessions.map(session => ({ ...session, durationMin: 55 }))).passed, true)
  assert.equal(input.context.completedWeeks[0]!.runMinutes, 10)
})

test('planned deloads do not become normal-week references or authorize baseline growth', () => {
  const input = fixture()
  input.context.completedWeeks = [
    { weekStart: '2026-08-24', runMinutes: 100, plannedDeload: false, disrupted: false },
    { weekStart: '2026-08-31', runMinutes: 60, plannedDeload: true, disrupted: false },
  ]
  assert.equal(checkSafety(input, [run('a', undefined, undefined, 55), run('b', '2026-09-09', undefined, 55)]).passed, true)
  input.context.completedWeeks = [{ weekStart: '2026-08-31', runMinutes: 200, plannedDeload: false, disrupted: false }]
  assert.ok(rules(input, [run('a', undefined, undefined, 60), run('b', '2026-09-09', undefined, 60), run('c', '2026-09-11')])
    .includes('weeklyRunVolume'))
})

test('the block calibration week is excluded from normal-week comparisons even in an unmarked summary', () => {
  const input = fixture()
  input.weekIndex = 1
  input.context.completedWeeks = [{ weekStart: input.block.startDate, runMinutes: 72, plannedDeload: false, disrupted: false }]
  assert.equal(checkSafety(input, [
    run('a', '2026-09-14', undefined, 60), run('b', '2026-09-16', undefined, 60),
  ]).passed, true)
})

test('latest disruption or unresolved pain/illness holds optional work without inventing a return plan', () => {
  const input = fixture()
  const fixed = establishCommitment(input)
  input.context.completedWeeks = [{ weekStart: '2026-08-31', runMinutes: 0, plannedDeload: false, disrupted: true }]
  assert.ok(rules(input, [fixed, strength('lift', '2026-09-09')]).includes('safetyHold'))
  assert.equal(checkSafety(input, [fixed]).passed, true)
  input.context.completedWeeks = []
  for (const skipReason of ['pain', 'illness'] as const) {
    input.context.recentSessions = [{ session: run('previous', '2026-09-06'),
      log: { sessionId: 'previous', status: 'skipped', skipReason, painFlag: false, notes: '' } }]
    assert.ok(rules(input, [fixed, run('next', '2026-09-09')]).includes('safetyHold'))
  }
  input.context.recentSessions = []
  input.athlete.safetyHold = { since: '2026-09-06', reason: 'return_from_break' }
  assert.ok(rules(input, [fixed, strength('lift', '2026-09-09')]).includes('safetyHold'))
  assert.equal(checkSafety(input, [fixed]).passed, true)
})

test('only a strictly later rebaseline resolves historical pain or illness; active holds always remain', () => {
  const input = fixture()
  const previous = run('flagged', '2026-09-05')
  input.context.recentSessions = [{ session: previous,
    log: { sessionId: previous.id, status: 'completed', painFlag: true, notes: '' } }]
  assert.equal(checkSafety(input, [run()]).passed, true)
  previous.date = input.athlete.baseline.asOf
  assert.ok(rules(input, [run()]).includes('safetyHold'))
  input.athlete.baseline.asOf = '2026-09-07'
  assert.equal(checkSafety(input, [run()]).passed, true)
  input.athlete.safetyHold = { since: '2026-09-05', reason: 'pain' }
  assert.ok(rules(input, [run()]).includes('safetyHold'))
})

test('ordinary life, weather and other skips never establish a health hold', () => {
  const input = fixture()
  const previous = run('missed', input.athlete.baseline.asOf)
  for (const skipReason of ['life', 'weather', 'other'] as const) {
    input.context.recentSessions = [{ session: previous,
      log: { sessionId: previous.id, status: 'skipped', skipReason, actualDurationMin: 0, painFlag: false, notes: '' } }]
    assert.equal(checkSafety(input, [run()]).passed, true)
  }
})

test('an explicit rebaseline after a disrupted week resolves its hold without scrubbing history', () => {
  const input = fixture()
  input.context.completedWeeks = [{ weekStart: '2026-08-31', runMinutes: 0, plannedDeload: false, disrupted: true }]
  assert.ok(rules(input, [run()]).includes('safetyHold'))
  input.athlete.baseline.asOf = '2026-09-07'
  assert.equal(checkSafety(input, [run()]).passed, true)
  assert.equal(input.context.completedWeeks[0]!.disrupted, true)
})

test('strength never increases observed sets or invents exercise/reps; high-skill generation is vetoed', () => {
  const input = fixture()
  const lift = strength()
  lift.strengthPrescription = [{ ...lift.strengthPrescription[0]!, sets: 4 }]
  assert.ok(rules(input, [lift]).includes('observedStrengthPrescription'))
  lift.strengthPrescription = [{ ...lift.strengthPrescription[0]!, sets: 3, reps: 11 }]
  assert.ok(rules(input, [lift]).includes('observedStrengthPrescription'))
  input.library.exercises[0]!.highSkill = true
  assert.ok(rules(input, [strength()]).includes('observedStrengthPrescription'))
})

test('novice target effort and own exact observed weight are independently bounded', () => {
  const input = fixture()
  input.athlete.baseline.exercises[0]!.experienceMonths = 1
  input.block.anchors[0]!.targetRPE = 8
  const lift = strength()
  lift.strengthPrescription = [{ ...lift.strengthPrescription[0]!, targetRPE: 8 }]
  assert.ok(rules(input, [lift]).includes('observedStrengthPrescription'))
  assert.ok(rules(input, [lift]).includes('observedWeightOnly'))
  lift.strengthPrescription = [{ ...lift.strengthPrescription[0]!, targetRPE: 7, suggestedWeightKg: 1 }]
  assert.ok(rules(input, [lift]).includes('observedWeightOnly'))
  lift.strengthPrescription = [{ ...lift.strengthPrescription[0]!, suggestedWeightKg: 0 }]
  assert.equal(checkSafety(input, [lift]).passed, true)
})

test('suggested weights follow the latest eligible own-exercise log without changing baseline volume ceilings', () => {
  const input = fixture()
  const prior = strength('previous', input.athlete.baseline.asOf)
  input.context.recentSessions = [{ session: prior,
    log: { sessionId: prior.id, status: 'completed', actualDurationMin: 45, painFlag: false, notes: '',
      sets: [{ exerciseId: 'squat', weightKg: 25, reps: 10, actualRPE: 7 }] } }]
  const lift = strength()
  lift.strengthPrescription[0]!.suggestedWeightKg = 25
  assert.equal(checkSafety(input, [lift]).passed, true)
  lift.strengthPrescription[0]!.suggestedWeightKg = 0
  assert.ok(rules(input, [lift]).includes('observedWeightOnly'))
  lift.strengthPrescription[0]!.suggestedWeightKg = 25
  lift.strengthPrescription[0]!.sets = 4
  assert.ok(rules(input, [lift]).includes('observedStrengthPrescription'))
  lift.strengthPrescription[0]!.sets = 3
  input.context.recentSessions[0]!.log!.sets = [{ exerciseId: 'squat', weightKg: 25, reps: 8, actualRPE: 7 }]
  assert.ok(rules(input, [lift]).includes('observedWeightOnly'))
  input.context.recentSessions[0]!.log!.sets = [{ exerciseId: 'squat', weightKg: 25, reps: 10, actualRPE: 8 }]
  assert.ok(rules(input, [lift]).includes('observedWeightOnly'))
})

test('direct nonfinite input is a finite failed result, never Infinity or a silent pass', () => {
  const input = fixture()
  const session = run()
  session.durationMin = NaN
  assert.ok(rules(input, [session]).includes('invalidSafetyInput'))
  input.athlete.baseline.weeklyRunMinutes = Infinity
  assert.ok(rules(input, []).includes('invalidSafetyInput'))
})
