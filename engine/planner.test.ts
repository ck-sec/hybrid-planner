import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateBlock } from './block.ts'
import { ENGINE_VERSION, LIBRARY_VERSION, LIMITS, POLICY_VERSION } from './constants.ts'
import { addDays, dateForWeekday, dayOfWeek } from './dates.ts'
import { DEFAULT_LIBRARY } from './library.ts'
import { fixedSessions, planWeek, requestedSessions } from './planner.ts'
import { checkSafety } from './safety.ts'
import type { AthleteState, Day, Goal, PlanWeekInput, Session } from './types.ts'

function athlete(): AthleteState {
  return {
    baseline: {
      asOf: '2026-09-01', weeklyRunMinutes: 90, longestRunMinutes: 40, runsPerWeek: 3,
      liftsPerWeek: 2, liftDurationMin: 45,
      exercises: [{ exerciseId: 'back-squat', date: '2026-09-01', weightKg: 40, sets: 3, reps: 5, actualRPE: 8, experienceMonths: 24 }],
    },
    calibration: { version: 1, costMultiplier: 1, observationCount: 0 },
    availableDays: [0, 1, 2, 3, 4, 5, 6], equipment: ['barbell'],
    weeklyTimeBudgetMin: 300, defaultStartTime: '18:00', aggressiveness: 'standard',
    residual: { asOfDate: '2026-09-01', asOfTime: '00:00', load: { systemic: 0, structural: 0 } },
    safetyHold: null,
  }
}

function input(): PlanWeekInput {
  const person = athlete()
  const goal: Goal = {
    label: 'A balanced autumn', peakDate: '2026-11-01', qualityBias: ['aerobic_base', 'max_strength'],
    protectedExerciseIds: ['back-squat'], fixedCommitments: [],
  }
  return {
    athlete: person, block: generateBlock(person, goal, '2026-09-07', DEFAULT_LIBRARY),
    weekIndex: 0, library: DEFAULT_LIBRARY,
    context: { recentSessions: [], completedWeeks: [], neighboringSessions: [], pinnedSessions: [] },
  }
}

test('block is a versioned skeleton, anchors are frozen, and no weeks are materialized upfront', () => {
  const request = input()
  assert.equal(request.block.engineVersion, ENGINE_VERSION)
  assert.equal(request.block.policyVersion, POLICY_VERSION)
  assert.equal(request.block.libraryVersion, LIBRARY_VERSION)
  assert.equal(request.block.totalWeeks, 8)
  assert.equal('sessions' in request.block, false)
  assert.equal(request.block.anchors[0].exerciseId, 'back-squat')
  assert.equal(request.block.phases.at(-1)?.kind, 'taper')
  assert.deepEqual(generateBlock(request.athlete, request.block.goal, '2026-09-07', request.library), request.block)
})

test('same frozen input gives same entire week and does not mutate it', () => {
  const request = input()
  const before = JSON.stringify(request)
  const first = planWeek(request)
  const second = planWeek(JSON.parse(before))
  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(request), before)
  assert.equal(first.safety.passed, true)
  assert.equal(first.sessions.filter(session => session.kind === 'run').reduce((sum, session) => sum + session.durationMin, 0), 54)
  assert.equal(first.sessions.filter(session => session.kind === 'strength').length, 2)
  assert.ok(first.sessions.every(session => session.reason.length > 0))
  assert.ok(Number.isFinite(first.totalScore))
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first)
})

test('all seven start weekdays schedule real availability and preserve fixed weekdays without rotating inputs', () => {
  for (let offset = 0; offset < 7; offset++) {
    const request = input()
    const start = addDays('2026-09-07', offset)
    request.athlete.availableDays = [1, 3, 5]
    request.athlete.baseline.runsPerWeek = 1
    request.athlete.baseline.weeklyRunMinutes = 30
    request.athlete.baseline.longestRunMinutes = 30
    request.athlete.baseline.liftsPerWeek = 1
    request.block = generateBlock(request.athlete, { ...request.block.goal, peakDate: addDays(start, 55), fixedCommitments: [{
      id: 'club-thursday', label: 'Thursday club', dayOfWeek: 3, startTime: '19:00', durationMin: 30,
      discipline: 'sport', modality: 'court_sport', estimatedLoad: { systemic: 60, structural: 30 },
    }] }, start, request.library)
    const before = structuredClone(request)
    const plan = planWeek(request)
    assert.equal(plan.weekStart, start)
    assert.equal(plan.safety.passed, true, JSON.stringify(plan.safety))
    assert.equal(plan.sessions.length, 3)
    assert.ok(plan.sessions.every(session => request.athlete.availableDays.includes(dayOfWeek(session.date))))
    const fixed = plan.sessions.find(session => session.kind === 'commitment')!
    assert.equal(fixed.date, dateForWeekday(start, 3))
    assert.equal(fixed.startTime, '19:00')
    assert.equal(fixed.durationMin, 30)
    assert.deepEqual(planWeek(request), plan)
    assert.deepEqual(request, before)
    const moved = plan.sessions.map(session => session.id === fixed.id ? { ...session, date: addDays(session.date, -1) } : session)
    assert.ok(checkSafety(request, moved).violations.some(item => item.rule === 'fixedCommitmentPreserved'))
    const next = fixedSessions({ ...request, weekIndex: 1 })[0]!
    assert.equal(next.date, addDays(fixed.date, 7))
    assert.equal(next.id, `fixed-1-${addDays(start, 7)}`)
  }
})

test('a midweek goal limits optional dates but never hides or shifts established commitments', () => {
  const request = input()
  request.athlete.availableDays = [0, 1, 2, 3, 4, 5, 6]
  request.block = generateBlock(request.athlete, { ...request.block.goal, peakDate: '2026-09-11', fixedCommitments: [{
    id: 'club-tuesday', label: 'Tuesday club', dayOfWeek: 1, startTime: '19:00', durationMin: 30,
    discipline: 'sport', modality: 'court_sport', estimatedLoad: { systemic: 60, structural: 30 },
  }] }, '2026-09-09', request.library)
  const plan = planWeek(request)
  assert.equal(request.block.totalWeeks, 1)
  assert.equal(plan.safety.passed, true)
  assert.equal(plan.sessions.find(session => session.kind === 'commitment')!.date, '2026-09-15')
  assert.ok(plan.sessions.filter(session => session.kind !== 'commitment').every(session => session.date <= '2026-09-11'))
})

test('RPE and suggested weights use only matching same-exercise observations', () => {
  const request = input()
  const sessions = requestedSessions(request).filter(session => session.kind === 'strength')
  assert.equal(sessions[0].strengthPrescription[0].targetRPE, 8)
  assert.equal(sessions[0].strengthPrescription[0].suggestedWeightKg, 40)
  const novice = athlete()
  novice.baseline = { ...novice.baseline, exercises: [{ ...novice.baseline.exercises[0], experienceMonths: 2 }] }
  const block = generateBlock(novice, request.block.goal, '2026-09-07', request.library)
  const noviceSessions = requestedSessions({ ...request, athlete: novice, block }).filter(session => session.kind === 'strength')
  assert.equal(noviceSessions[0].strengthPrescription[0].targetRPE, 7)
  assert.equal(noviceSessions[0].strengthPrescription[0].suggestedWeightKg, undefined)
})

test('a matching logged set becomes the same-exercise starting suggestion, not a volume increase', () => {
  const request = input()
  const initial = planWeek(request)
  const previous = initial.sessions.find(session => session.kind === 'strength')
  assert.ok(previous)
  request.weekIndex = 1
  request.context = {
    ...request.context,
    recentSessions: [{
      session: previous,
      log: { sessionId: previous.id, status: 'completed', painFlag: false, notes: '',
        sets: [{ exerciseId: 'back-squat', weightKg: 42.5, reps: 5, actualRPE: 8 }] },
    }],
  }
  const session = requestedSessions(request).find(item => item.kind === 'strength')
  assert.ok(session)
  assert.equal(session.strengthPrescription[0].suggestedWeightKg, 42.5)
  assert.ok(session.strengthPrescription[0].sets <= request.athlete.baseline.exercises[0].sets)
  const output = planWeek(request)
  assert.equal(output.safety.passed, true)
  assert.ok(output.sessions.some(item => item.kind === 'strength' && item.strengthPrescription[0].suggestedWeightKg === 42.5))
})

test('pins preserve workload and position, while changed prescriptions are rejected', () => {
  const request = input()
  const initial = planWeek(request)
  const session = initial.sessions.find(item => item.kind === 'run')
  assert.ok(session)
  const pin: Session = { ...session, pinned: true }
  const pinnedInput = { ...request, context: { ...request.context, pinnedSessions: [pin] } }
  const replanned = planWeek(pinnedInput)
  assert.equal(replanned.safety.passed, true)
  assert.equal(replanned.sessions.find(item => item.id === pin.id)?.date, pin.date)
  assert.equal(replanned.sessions.find(item => item.id === pin.id)?.startTime, pin.startTime)
  assert.throws(() => planWeek({
    ...request, context: { ...request.context, pinnedSessions: [{ ...pin, durationMin: pin.durationMin + 10 }] },
  }), /preserve/)
})

test('impossible fixed commitments are visible conflicts, never silently moved or hidden', () => {
  const request = input()
  request.athlete.availableDays = [1, 2, 3]
  request.block = generateBlock(request.athlete, {
    ...request.block.goal,
    fixedCommitments: [{ id: 'practice', label: 'Court practice', dayOfWeek: 0, startTime: '18:00', durationMin: 60,
      discipline: 'sport', modality: 'court_sport', estimatedLoad: { systemic: 250, structural: 200 } }],
  }, request.block.startDate, request.library)
  const plan = planWeek(request)
  assert.equal(plan.safety.passed, false)
  assert.equal(plan.feasibility.fits, false)
  assert.equal(plan.sessions.length, 1)
  assert.equal(plan.sessions[0].date, '2026-09-07')
  assert.ok(plan.warnings.some(warning => warning.includes('not as a training recommendation')))
})

test('an active pain hold stops generated training, not just progression', () => {
  const request = input()
  request.athlete.safetyHold = { reason: 'pain', since: '2026-09-02' }
  const plan = planWeek(request)
  assert.equal(plan.sessions.filter(session => session.kind !== 'commitment').length, 0)
  assert.equal(plan.feasibility.fits, false)
  assert.ok(plan.warnings.some(warning => /pain|hold/i.test(warning)))
})

test('all aggressiveness settings retain the safety floor and never exceed baseline work', () => {
  for (const aggressiveness of ['conservative', 'standard', 'aggressive'] as const) {
    const request = input()
    request.weekIndex = 1
    request.athlete.aggressiveness = aggressiveness
    const plan = planWeek(request)
    assert.equal(plan.safety.passed, true)
    assert.equal(checkSafety(request, plan.sessions).passed, true)
    assert.ok(plan.sessions.filter(session => session.kind === 'run')
      .reduce((sum, session) => sum + session.durationMin, 0) <= request.athlete.baseline.weeklyRunMinutes)
  }
})

test('high-skill anchors, unavailable equipment and unsupported protected exercises fail explicitly', () => {
  const request = input()
  assert.throws(() => generateBlock({ ...request.athlete, equipment: ['bodyweight'] }, request.block.goal, '2026-09-07', request.library), /equipment/)
  assert.throws(() => generateBlock(request.athlete, { ...request.block.goal, protectedExerciseIds: ['deadlift'] }, '2026-09-07', request.library), /Protected/)
  const person = athlete()
  person.baseline = { ...person.baseline, exercises: [{ ...person.baseline.exercises[0], exerciseId: 'snatch' }] }
  assert.throws(() => generateBlock(person, { ...request.block.goal, protectedExerciseIds: [] }, '2026-09-07', request.library), /not prescribed/)
  person.baseline = { ...person.baseline, exercises: [...person.baseline.exercises, request.athlete.baseline.exercises[0]] }
  const supportedBlock = generateBlock(person, request.block.goal, '2026-09-07', request.library)
  assert.deepEqual(supportedBlock.anchors.map(anchor => anchor.exerciseId), ['back-squat'])
  const supportedPlan = planWeek({ ...request, athlete: person, block: supportedBlock })
  assert.ok(supportedPlan.warnings.some(warning => warning.includes('not prescribed: snatch')))
})

test('the final week does not invent optional workouts after the peak date', () => {
  const request = input()
  request.block = generateBlock(request.athlete, { ...request.block.goal, peakDate: '2026-09-09' }, '2026-09-07', request.library)
  const result = planWeek(request)
  assert.ok(result.sessions.every(session => session.kind === 'commitment' || session.date <= '2026-09-09'))
  assert.ok(result.omitted.length > 0)
})

test('every availability mask returns only independently safe optional work', () => {
  const allDays: Day[] = [0, 1, 2, 3, 4, 5, 6]
  for (let mask = 1; mask < 128; mask++) {
    const request = input()
    request.athlete.availableDays = allDays.filter(day => (mask & (1 << day)) !== 0)
    const plan = planWeek(request)
    assert.equal(plan.safety.passed, true, `mask=${mask}`)
    assert.equal(checkSafety(request, plan.sessions).passed, true)
    assert.equal(plan.sessions.length + plan.omitted.length, 5)
    assert.ok(plan.audit.candidatesScored <= LIMITS.maxCandidates)
  }
})

test('unknown imported lifting dates influence candidate selection without invented costs', () => {
  const request = input()
  request.context = { ...request.context, untimedStrengthDates: ['2026-09-06'] }
  const result = planWeek(request)
  assert.equal(result.safety.passed, true)
  assert.equal(result.sessions.filter(session => session.kind === 'strength').length, 2)
  assert.ok(result.sessions.filter(session => session.kind === 'strength').every(session => session.date !== '2026-09-07'))
  assert.throws(() => planWeek({ ...request, context: { ...request.context, untimedStrengthDates: ['2026-02-30'] } }), /date/i)
  assert.throws(() => planWeek({ ...request, context: { ...request.context, untimedStrengthDates: ['2026-01-01'] } }), /neighboring/i)
  assert.throws(() => planWeek({ ...request, context: { ...request.context, untimedStrengthDates: ['2026-09-06', '2026-09-06'] } }), /duplicate/i)
})

test('maximum frequency plus fixed commitments stays bounded and serializable', () => {
  const request = input()
  request.athlete.baseline = { ...request.athlete.baseline, weeklyRunMinutes: 240, longestRunMinutes: 90, runsPerWeek: 4, liftsPerWeek: 3 }
  request.athlete.weeklyTimeBudgetMin = 600
  request.block = generateBlock(request.athlete, {
    ...request.block.goal,
    fixedCommitments: ([0, 1, 2, 3] as Day[]).map(day => ({
      id: `practice-${day}`, label: 'Established practice', dayOfWeek: day,
      startTime: '06:00', durationMin: 30, discipline: 'sport', modality: 'court_sport',
      estimatedLoad: { systemic: 30, structural: 30 },
    })),
  }, request.block.startDate, request.library)
  const plan = planWeek(request)
  assert.equal(plan.safety.passed, true)
  assert.ok(plan.audit.candidatesScored <= LIMITS.maxCandidates)
  assert.equal(plan.sessions.filter(session => session.kind === 'commitment').length, 4)
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan)
})
