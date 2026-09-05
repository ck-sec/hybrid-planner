import assert from 'node:assert/strict'
import test from 'node:test'
import { scoreSessions } from './scoring.ts'
import type { PlanWeekInput, RunSession, Session, StrengthSession } from './types.ts'

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
    strengthPrescription: [{ exerciseId: 'squat', sets: 3, reps: 10, targetRPE: 7, role: 'anchor' }] }
}

test('every returned term is finite, normalized and explicitly separate from measured recovery', () => {
  const input = fixture()
  input.athlete.residual.load = { systemic: 1000, structural: 1000 }
  const long = run('long', undefined, '09:00', 60)
  long.endurancePrescription.intent = 'long'
  const scores = scoreSessions(input, [strength(), long])
  assert.ok(scores.length)
  for (const score of scores) {
    assert.ok(Number.isFinite(score.weight))
    assert.ok(Number.isFinite(score.score))
    assert.ok(score.magnitude > 0 && score.magnitude <= 1)
    assert.equal(score.score, score.weight * score.magnitude)
  }
  assert.ok(scores.some(score => score.rule === 'longRunClearance'))
  assert.ok(scores.find(score => score.rule === 'structuralCollision')?.explanation.includes('AU'))
})

test('same-day spacing uses preceding end, not preceding start', () => {
  const input = fixture()
  const a = run('a', undefined, '08:00', 60)
  const penalties = scoreSessions(input, [a, run('b', undefined, '11:00')])
  const spacing = penalties.find(item => item.rule === 'sameDaySeparation')
  assert.ok(spacing)
  assert.equal(spacing.magnitude, 1 / 3)
  assert.equal(scoreSessions(input, [a, run('b', undefined, '12:00')]).some(item => item.rule === 'sameDaySeparation'), false)
})

test('estimated high AU triggers six-hour spacing; overlapping and unknown times stay bounded', () => {
  const input = fixture()
  const hard: Session = { id: 'sport', kind: 'commitment', discipline: 'sport', modality: 'court_sport',
    date: '2026-09-07', startTime: '08:00', durationMin: 60, predictedLoad: { systemic: 300, structural: 0 },
    label: 'Practice', pinned: true, isCalibration: false, reason: '' }
  const separated = scoreSessions(input, [hard, run('later', undefined, '13:00')])
  assert.equal(separated.find(item => item.rule === 'sameDaySeparation')?.magnitude, 1 / 3)
  assert.equal(scoreSessions(input, [hard, run('overlap', undefined, '08:30')])
    .find(item => item.rule === 'sameDaySeparation')?.magnitude, 1)
  assert.equal(scoreSessions(input, [hard, run('unknown', undefined, null)])
    .find(item => item.rule === 'sameDaySeparation')?.magnitude, 1)
})

test('running-competing lifts attract collision estimates while upper-only lifts do not', () => {
  const input = fixture()
  input.athlete.residual.load.structural = 100
  assert.ok(scoreSessions(input, [strength()]).some(item => item.rule === 'structuralCollision'))
  input.library.exercises[0]!.competesWithRunning = false
  assert.equal(scoreSessions(input, [strength()]).some(item => item.rule === 'structuralCollision'), false)
  assert.ok(scoreSessions(input, [run()]).some(item => item.rule === 'structuralCollision'))
})

test('goal collision penalty is attached to lower-priority work without changing prescriptions', () => {
  const input = fixture()
  const sessions = [strength(), run('later', undefined, '09:00')]
  const before = JSON.stringify(sessions)
  assert.deepEqual(scoreSessions(input, sessions).find(item => item.rule === 'goalPriority')?.affectedSessionIds, ['lift'])
  input.block.goal.qualityBias = ['max_strength']
  assert.deepEqual(scoreSessions(input, sessions).find(item => item.rule === 'goalPriority')?.affectedSessionIds, ['later'])
  input.block.goal.qualityBias = ['aerobic_base', 'max_strength']
  assert.equal(scoreSessions(input, sessions).some(item => item.rule === 'goalPriority'), false)
  assert.equal(JSON.stringify(sessions), before)
})

test('hard-day penalties include near neighboring dates, not distant sessions', () => {
  const input = fixture()
  const hard = run('hard', undefined, '08:00', 100)
  input.context.neighboringSessions = [run('prior', '2026-09-06', '08:00', 100)]
  assert.ok(scoreSessions(input, [hard]).some(item => item.rule === 'hardDaysAdjacent'))
  input.context.neighboringSessions = [run('distant', '2026-10-01', '08:00', 100)]
  assert.equal(scoreSessions(input, [hard]).some(item => item.rule === 'hardDaysAdjacent'), false)
})

test('skipped and partial actual neighbors are not counted as full planned hard days', () => {
  const input = fixture()
  const prior = run('prior', '2026-09-06', '08:00', 100)
  const next = run('next', undefined, undefined, 100)
  input.context.neighboringSessions = [prior]
  input.context.recentSessions = [{ session: prior,
    log: { sessionId: prior.id, status: 'skipped', painFlag: false, notes: '' } }]
  assert.equal(scoreSessions(input, [next]).some(item => item.rule === 'hardDaysAdjacent'), false)
  input.context.recentSessions = [{ session: prior,
    log: { sessionId: prior.id, status: 'partial', actualDurationMin: 20, painFlag: false, notes: '' } }]
  assert.equal(scoreSessions(input, [next]).some(item => item.rule === 'hardDaysAdjacent'), false)
  input.context.recentSessions = [{ session: prior,
    log: { sessionId: prior.id, status: 'partial', painFlag: false, notes: '' } }]
  assert.equal(scoreSessions(input, [next]).some(item => item.rule === 'hardDaysAdjacent'), true)
})

test('scores do not use future actual logs to penalize an earlier session', () => {
  const input = fixture()
  const earlier = run()
  const initial = scoreSessions(input, [earlier])
  const future = run('future', '2026-09-08', '08:00', 120)
  input.context.recentSessions = [{ session: future,
    log: { sessionId: future.id, status: 'completed', painFlag: false, notes: '', actualDurationMin: 120, actualEffort: 10 } }]
  assert.deepEqual(scoreSessions(input, [earlier]), initial)
})

test('an unknown same-day competing session cannot give a long run residual clearance', () => {
  const input = fixture()
  input.library.exercises[0]!.coefficients.structural = 100
  const long = run('long')
  long.endurancePrescription.intent = 'long'
  const scores = scoreSessions(input, [long, strength('unknown', undefined, null)])
  assert.ok(scores.some(item => item.rule === 'longRunClearance' && item.affectedSessionIds.includes('long')))
})

test('nonfinite costs are rejected rather than converted into penalties or infinite scores', () => {
  const input = fixture()
  input.athlete.residual.load.structural = NaN
  assert.throws(() => scoreSessions(input, [run()]), RangeError)
  input.athlete.residual.load.structural = 0
  const invalid = run()
  invalid.durationMin = Infinity
  assert.throws(() => scoreSessions(input, [invalid]), RangeError)
})
