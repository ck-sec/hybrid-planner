import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateWeek, safetyViolations, scorePlacement, SAFETY_RULES } from './planner.ts'
import { InputError, parseBaseline, parsePlannerInput } from './validation.ts'
import type { Day, PlannerInput, ScheduledSession } from './types.ts'

function example(): PlannerInput {
  return {
    baseline: {
      weeklyRunMinutes: 92,
      longestRunMinutes: 40,
      runsPerWeek: 3,
      liftsPerWeek: 2,
      availableDays: [0, 1, 2, 3, 4, 5, 6],
      exercises: [
        { name: 'Squat', sets: 3, reps: 5, loadKg: 40 },
        { name: 'Row', sets: 3, reps: 8, loadKg: 20 },
      ],
    },
    boundary: { previousSundayLift: false, nextMondayLift: false },
  }
}

test('same inputs produce the same complete result without mutating the input', () => {
  const input = example()
  const snapshot = structuredClone(input)
  const first = generateWeek(input)
  assert.deepEqual(generateWeek(input), first)
  assert.deepEqual(input, snapshot)
  first.input.baseline.exercises[0].loadKg = 999
  assert.deepEqual(input, snapshot)
})

test('availability order cannot change the deterministic result', () => {
  const input = example()
  const reversed = structuredClone(input)
  reversed.baseline.availableDays.reverse()
  assert.deepEqual(generateWeek(reversed), generateWeek(input))
})

test('maintains running minutes, easy effort, and exact lifting template', () => {
  const input = example()
  const plan = generateWeek(input)
  assert.equal(plan.sessions.length, 5)
  assert.equal(plan.omitted.length, 0)
  const runs = plan.sessions.filter(session => session.kind === 'run')
  assert.deepEqual(runs.map(session => session.minutes).sort((a, b) => a - b), [30, 31, 31])
  assert.equal(runs.reduce((sum, session) => sum + session.minutes, 0), 92)
  for (const run of runs) assert.equal(run.effort, 'easy')
  for (const lift of plan.sessions.filter(session => session.kind === 'lift')) {
    assert.deepEqual(lift.exercises, input.baseline.exercises)
    assert.notEqual(lift.exercises, input.baseline.exercises)
  }
})

test('full-body lifting respects saved weeks on either boundary', () => {
  const input = example()
  input.boundary = { previousSundayLift: true, nextMondayLift: true }
  const plan = generateWeek(input)
  assert.equal(plan.omitted.length, 0)
  for (const lift of plan.sessions.filter(session => session.kind === 'lift')) {
    assert.notEqual(lift.day, 0)
    assert.notEqual(lift.day, 6)
  }
  assert.deepEqual(safetyViolations(input, plan.sessions), [])
})

test('a seven-session request loses work rather than its rest day', () => {
  const input = example()
  input.baseline.runsPerWeek = 4
  input.baseline.liftsPerWeek = 3
  const plan = generateWeek(input)
  assert.equal(plan.sessions.length, 6)
  assert.equal(plan.omitted.length, 1)
  assert.ok(plan.audit.rejectedCandidateCount > 0)
  assert.ok(plan.notes.some(note => note.includes('not moved into other sessions')))
  assert.deepEqual(safetyViolations(input, plan.sessions), [])
})

test('limited availability gives an explicit partial week, never redistributed minutes', () => {
  const input = example()
  input.baseline.availableDays = [1]
  const plan = generateWeek(input)
  assert.equal(plan.sessions.length, 1)
  assert.equal(plan.omitted.length, 4)
  const allSessions = [...plan.sessions, ...plan.omitted]
  assert.equal(allSessions.filter(session => session.kind === 'run')
    .reduce((sum, session) => sum + session.minutes, 0), 92)
  assert.deepEqual(safetyViolations(input, plan.sessions), [])
})

test('every non-empty availability mask and both boundary flags produce safe, deterministic weeks', () => {
  const allDays: Day[] = [0, 1, 2, 3, 4, 5, 6]
  for (let mask = 1; mask < 128; mask++) {
    for (const previousSundayLift of [false, true]) {
      for (const nextMondayLift of [false, true]) {
        const input = example()
        input.baseline.availableDays = allDays.filter(day => (mask & (1 << day)) !== 0)
        input.boundary = { previousSundayLift, nextMondayLift }
        const plan = generateWeek(input)
        assert.deepEqual(safetyViolations(input, plan.sessions), [], `mask=${mask}`)
        assert.ok(plan.sessions.length <= 6)
        assert.equal(plan.sessions.length + plan.omitted.length, 5)
        assert.equal(new Set(plan.sessions.map(session => session.id)).size, plan.sessions.length)
        assert.deepEqual(generateWeek(input), plan)
      }
    }
  }
})

test('the safety veto rejects an unsafe candidate even when its placement score is higher', () => {
  const input = example()
  input.baseline.runsPerWeek = 4
  input.baseline.liftsPerWeek = 3
  const candidate: ScheduledSession[] = [
    { id: 'run-1', kind: 'run', minutes: 23, effort: 'easy', day: 0 },
    { id: 'lift-1', kind: 'lift', exercises: input.baseline.exercises, day: 1 },
    { id: 'run-2', kind: 'run', minutes: 23, effort: 'easy', day: 2 },
    { id: 'lift-2', kind: 'lift', exercises: input.baseline.exercises, day: 3 },
    { id: 'run-3', kind: 'run', minutes: 23, effort: 'easy', day: 4 },
    { id: 'lift-3', kind: 'lift', exercises: input.baseline.exercises, day: 5 },
    { id: 'run-4', kind: 'run', minutes: 23, effort: 'easy', day: 6 },
  ]
  const safe = candidate.slice(0, 6)
  assert.ok(scorePlacement(candidate) > scorePlacement(safe))
  assert.deepEqual(safetyViolations(input, safe), [])
  assert.ok(safetyViolations(input, candidate).includes(SAFETY_RULES[1]))
  assert.equal(generateWeek(input).sessions.length, 6)
})

test('the independent safety check catches mutations of workload, effort, identity, and placement', () => {
  const input = example()
  const plan = generateWeek(input)
  const run = plan.sessions.find(session => session.kind === 'run')
  const lift = plan.sessions.find(session => session.kind === 'lift')
  assert.ok(run && lift)
  assert.ok(safetyViolations(input, [{ ...run, minutes: 41 }]).includes(SAFETY_RULES[4]))
  assert.ok(safetyViolations(input, [{ ...run, minutes: 29 }]).includes(SAFETY_RULES[5]))
  assert.ok(safetyViolations(input, [{ ...run, minutes: Number.NaN }]).length)
  assert.ok(safetyViolations(input, [run, { ...run, day: ((run.day + 1) % 7) as Day }]).length)
  assert.ok(safetyViolations(input, [run, { ...lift, day: run.day }]).includes(SAFETY_RULES[0]))
  assert.ok(safetyViolations(input, [{
    ...lift, exercises: lift.exercises.map(exercise => ({ ...exercise, loadKg: exercise.loadKg + 1 })),
  }]).includes(SAFETY_RULES[6]))
  assert.ok(safetyViolations(input, [{ ...run, id: 'invented' }]).length)
  assert.ok(safetyViolations(input, [{ ...lift, day: 0 }, { ...lift, id: 'lift-2', day: 6 }])
    .includes(SAFETY_RULES[2]))
})

test('input validation rejects invalid, impossible, or incomplete baselines', () => {
  const baseline = example().baseline
  for (const invalid of [
    null,
    {},
    { ...baseline, weeklyRunMinutes: -1 },
    { ...baseline, weeklyRunMinutes: Number.NaN },
    { ...baseline, weeklyRunMinutes: Infinity },
    { ...baseline, weeklyRunMinutes: '90' },
    { ...baseline, weeklyRunMinutes: 1 },
    { ...baseline, longestRunMinutes: 20 },
    { ...baseline, runsPerWeek: 1.5 },
    { ...baseline, runsPerWeek: 5 },
    { ...baseline, liftsPerWeek: 4 },
    { ...baseline, availableDays: [] },
    { ...baseline, availableDays: [0, 0] },
    { ...baseline, availableDays: [7] },
    { ...baseline, exercises: [] },
    { ...baseline, exercises: [null] },
    { ...baseline, exercises: [{ ...baseline.exercises[0], name: '   ' }] },
    { ...baseline, exercises: [{ ...baseline.exercises[0], sets: 0 }] },
    { ...baseline, exercises: [{ ...baseline.exercises[0], loadKg: -1 }] },
  ]) assert.throws(() => parseBaseline(invalid), InputError)
  assert.throws(() => parsePlannerInput({ baseline, boundary: {} }), InputError)
})

test('zero added load and fractional kilogram loads are preserved', () => {
  const input = example()
  input.baseline.exercises[0].loadKg = 0
  input.baseline.exercises[1].loadKg = 12.5
  const lifts = generateWeek(input).sessions.filter(session => session.kind === 'lift')
  assert.equal(lifts[0].exercises[0].loadKg, 0)
  assert.equal(lifts[0].exercises[1].loadKg, 12.5)
})
