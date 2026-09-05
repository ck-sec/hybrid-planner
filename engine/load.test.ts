import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateSessionTrainingLoad, calibrateCost, decayLoad, predictSessionLoad, residualBefore } from './load.ts'
import type { PlanWeekInput, RecentSession, Session } from './types.ts'

function fixture(): PlanWeekInput {
  return {
    athlete: {
      baseline: { asOf: '2026-09-06', weeklyRunMinutes: 120, longestRunMinutes: 60, runsPerWeek: 3,
        liftsPerWeek: 2, liftDurationMin: 45, exercises: [{
          exerciseId: 'squat', date: '2026-09-01', weightKg: 0, sets: 3, reps: 10, actualRPE: 7, experienceMonths: 24,
        }] },
      calibration: { version: 1, costMultiplier: 1, observationCount: 0 },
      availableDays: [0, 1, 2, 3, 4, 5, 6], equipment: ['bodyweight'], weeklyTimeBudgetMin: 400,
      defaultStartTime: '08:00', aggressiveness: 'standard',
      residual: { asOfDate: '2026-09-05', asOfTime: '00:00', load: { systemic: 0, structural: 0 } },
      safetyHold: null,
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

function run(id = 'run', date = '2026-09-07', startTime: string | null = '08:00', durationMin = 30): Session {
  return { id, kind: 'run', discipline: 'run', modality: 'run_road', date, startTime, durationMin,
    predictedLoad: { systemic: 999, structural: 999 }, reason: '', pinned: false, isCalibration: false,
    endurancePrescription: { intent: 'easy', effort: 'conversational' } }
}

function strength(): Session {
  return { id: 'lift', kind: 'strength', discipline: 'strength', modality: 'lifting',
    date: '2026-09-07', startTime: '08:00', durationMin: 45, predictedLoad: { systemic: 999, structural: 999 },
    reason: '', pinned: false, isCalibration: false,
    strengthPrescription: [{ exerciseId: 'squat', sets: 3, reps: 10, targetRPE: 7, role: 'anchor', suggestedWeightKg: 0 }] }
}

function actual(session: Session, changes: Partial<NonNullable<RecentSession['log']>> = {}): RecentSession {
  return { session, log: { sessionId: session.id, status: 'completed', painFlag: false, notes: '', ...changes } }
}

function close(actualValue: number, expected: number): void {
  assert.ok(Math.abs(actualValue - expected) < 1e-9, `${actualValue} != ${expected}`)
}

test('generated costs ignore cached AU and use per-ten-rep coefficients without weight division', () => {
  const input = fixture()
  assert.deepEqual(predictSessionLoad(run(), input.athlete, input.library), { systemic: 90, structural: 60 })
  const lift = strength()
  assert.equal(lift.kind, 'strength')
  if (lift.kind !== 'strength') return
  assert.deepEqual(predictSessionLoad(lift, input.athlete, input.library), { systemic: 60, structural: 120 })
  lift.strengthPrescription = [{ ...lift.strengthPrescription[0]!, reps: 5, suggestedWeightKg: 100 }]
  assert.deepEqual(predictSessionLoad(lift, input.athlete, input.library), { systemic: 30, structural: 60 })
})

test('trail and common multipliers are explicit while commitments retain supplied estimated load', () => {
  const input = fixture()
  input.athlete.calibration.costMultiplier = 1.2
  const road = run()
  assert.equal(road.kind, 'run')
  if (road.kind !== 'run') return
  road.modality = 'run_trail'
  assert.deepEqual(predictSessionLoad(road, input.athlete, input.library), { systemic: 108, structural: 90 })
  const commitment: Session = { ...road, kind: 'commitment', discipline: 'sport', modality: 'court_sport',
    label: 'Practice', predictedLoad: { systemic: 123, structural: 45 } }
  assert.deepEqual(predictSessionLoad(commitment, input.athlete, input.library), { systemic: 123, structural: 45 })
})

test('novice and missing same-exercise exposure increase costs, never borrowing another exercise weight', () => {
  const input = fixture()
  input.athlete.baseline.exercises[0]!.experienceMonths = 0
  const novice = predictSessionLoad(strength(), input.athlete, input.library)
  close(novice.systemic, 72)
  close(novice.structural, 144)
  input.athlete.baseline.exercises = []
  assert.deepEqual(predictSessionLoad(strength(), input.athlete, input.library), novice)
})

test('fixed half-life decay keeps both axes finite and rejects invalid numeric inputs', () => {
  close(decayLoad({ systemic: 100, structural: 100 }, 24).systemic, 50)
  close(decayLoad({ systemic: 100, structural: 100 }, 60).structural, 50)
  assert.deepEqual(decayLoad({ systemic: 100, structural: 100 }, Number.MAX_VALUE), { systemic: 0, structural: 0 })
  for (const bad of [NaN, Infinity, -1]) {
    assert.throws(() => decayLoad({ systemic: 100, structural: 100 }, bad), RangeError)
    assert.throws(() => decayLoad({ systemic: bad, structural: 100 }, 0), RangeError)
    assert.throws(() => calculateSessionTrainingLoad(bad, 30), RangeError)
  }
  assert.throws(() => calculateSessionTrainingLoad(11, 30), RangeError)
  assert.throws(() => calculateSessionTrainingLoad(10, Number.MAX_VALUE), RangeError)
  assert.equal(calculateSessionTrainingLoad(7, 45), 315)
  assert.equal(calculateSessionTrainingLoad(0, 45), 0)
})

test('nonfinite generated costs, exercise coefficients and weights are rejected', () => {
  const input = fixture()
  const session = run()
  session.durationMin = NaN
  assert.throws(() => predictSessionLoad(session, input.athlete, input.library), RangeError)
  input.library.exercises[0]!.coefficients.systemic = Infinity
  assert.throws(() => predictSessionLoad(strength(), input.athlete, input.library), RangeError)
  input.library.exercises[0]!.coefficients.systemic = 20
  const lift = strength()
  if (lift.kind === 'strength') lift.strengthPrescription[0]!.suggestedWeightKg = NaN
  assert.throws(() => predictSessionLoad(lift, input.athlete, input.library), RangeError)
})

test('residual snapshot excludes already incorporated history and all future actual logs', () => {
  const input = fixture()
  input.athlete.residual = { asOfDate: '2026-09-06', asOfTime: '08:30', load: { systemic: 100, structural: 80 } }
  input.context.recentSessions = [
    actual(run('incorporated', '2026-09-06', '08:00')),
    actual(run('future', '2026-09-08', '08:00')),
  ]
  assert.deepEqual(residualBefore(run('next', '2026-09-07', '08:30'), input, []),
    decayLoad({ systemic: 100, structural: 80 }, 24))
})

test('actual costs enter at end and partials scale only with known actual duration', () => {
  const input = fixture()
  const prior = run('prior', '2026-09-06', '08:00', 60)
  const next = run('next', '2026-09-06', '09:00')
  input.context.recentSessions = [actual(prior, { status: 'partial', actualDurationMin: 30 })]
  assert.deepEqual(residualBefore(next, input, []), decayLoad({ systemic: 90, structural: 60 }, 0.5))
  input.context.recentSessions = [actual(prior, { status: 'partial' })]
  assert.deepEqual(residualBefore(next, input, []), { systemic: 180, structural: 120 })
  input.context.recentSessions = [actual(prior, { status: 'skipped' })]
  assert.deepEqual(residualBefore(next, input, [prior]), { systemic: 0, structural: 0 })
})

test('in-progress/future logs cannot leak into earlier sessions; null logs are not actual history', () => {
  const input = fixture()
  const next = run('next', '2026-09-06', '08:30')
  input.context.recentSessions = [
    actual(run('not-ended', '2026-09-06', '08:00', 60)),
    actual(run('later', '2026-09-06', '09:00')),
    { session: run('unlogged', '2026-09-05', '08:00'), log: null },
  ]
  assert.deepEqual(residualBefore(next, input, []), { systemic: 0, structural: 0 })
})

test('history and candidate session with the same ID are not double counted', () => {
  const input = fixture()
  const prior = run('prior', '2026-09-06', '08:00')
  input.context.recentSessions = [actual(prior)]
  const next = run('next', '2026-09-06', '08:30')
  assert.deepEqual(residualBefore(next, input, [prior]), { systemic: 90, structural: 60 })
  assert.deepEqual(residualBefore(next, input, [run('future', '2026-09-07')]), { systemic: 90, structural: 60 })
})

test('residual decay uses exact end-to-start local time across midnight', () => {
  const input = fixture()
  const prior = run('late', '2026-09-06', '23:30', 60)
  assert.deepEqual(residualBefore(run('early', '2026-09-07', '01:30'), input, [prior]),
    decayLoad({ systemic: 180, structural: 120 }, 1))
})

test('unknown earlier planned times receive conservative residual without claiming clearance', () => {
  const input = fixture()
  const prior = run('unknown', '2026-09-06', null, 60)
  assert.deepEqual(residualBefore(run('next', '2026-09-07', '00:30'), input, [prior]),
    { systemic: 180, structural: 120 })
  assert.deepEqual(residualBefore(run('next', '2026-09-06', '08:00'), input, [prior]),
    { systemic: 180, structural: 120 })
})

test('valid pre-epoch local timestamps are supported without interpreting them as negative loads', () => {
  const input = fixture()
  input.athlete.residual.asOfDate = '1960-01-01'
  const prior = run('prior', '1960-01-02', '08:00', 30)
  input.context.recentSessions = [actual(prior)]
  assert.deepEqual(residualBefore(run('next', '1960-01-02', '08:30'), input, []),
    { systemic: 90, structural: 60 })
})

test('unknown-time actual work after a midnight snapshot retains conservatively timed cost', () => {
  const input = fixture()
  input.athlete.residual.asOfDate = '2026-09-06'
  input.context.recentSessions = [actual(run('unknown', '2026-09-06', null, 60))]
  assert.deepEqual(residualBefore(run('next', '2026-09-07', '08:00'), input, []),
    decayLoad({ systemic: 180, structural: 120 }, 7))
})

test('calibration is an explicit no-op without predicted session-effort evidence', () => {
  const input = fixture()
  const current = { version: 1 as const, costMultiplier: 1.2, observationCount: 4 }
  const observations = [
    actual({ ...run(), isCalibration: true }, { actualEffort: 10, actualDurationMin: 30 }),
    actual(run(), { status: 'partial', actualEffort: 10 }),
    actual(run(), { status: 'skipped', skipReason: 'illness' }),
    actual(run(), { painFlag: true }),
    actual(run(), { actualEffort: 10, actualDurationMin: 30 }),
  ]
  assert.strictEqual(calibrateCost(current, observations), current)
  assert.deepEqual(calibrateCost(input.athlete.calibration, []), input.athlete.calibration)
  assert.throws(() => calibrateCost({ ...current, costMultiplier: Infinity }, []), RangeError)
})
