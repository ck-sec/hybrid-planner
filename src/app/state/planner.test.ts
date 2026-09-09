import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PlannerValidationError,
  addPlannerWorkout,
  createBlankPlannerState,
  createPlannerStateFromWeekPlan,
  deletePlannerWorkout,
  duplicatePlannerWorkout,
  listPlannerWorkoutsForDate,
  mapPlannerStateToWeekBoardProps,
  movePlannerWorkout,
  plannerStateToWeekPlan,
  redoPlannerState,
  reorderPlannerWorkout,
  undoPlannerState,
  updatePlannerWorkout,
} from './planner.ts'

function buildWorkout(title: string, scheduledDate: string, category: 'aerobic' | 'mobility' | 'strength', overrides: {
  expectedDurationMin?: number
  notes?: string
  purpose?: string
  source?: 'ai' | 'club' | 'manual'
  startTime?: string
} = {}) {
  return {
    scheduledDate,
    startTime: overrides.startTime,
    category,
    source: overrides.source ?? 'manual',
    title,
    purpose: overrides.purpose ?? `${title} purpose`,
    expectedDurationMin: overrides.expectedDurationMin ?? 45,
    warmup: [],
    main: [{ title: `${title} main set`, target: { minutes: 20 } }],
    cooldown: [],
    notes: overrides.notes,
  } as const
}

function assertPlannerError(
  execute: () => unknown,
  code: PlannerValidationError['code'],
  message: RegExp,
) {
  let thrown: unknown
  try {
    execute()
  } catch (error) {
    thrown = error
  }

  assert.ok(thrown instanceof PlannerValidationError)
  assert.equal(thrown.code, code)
  assert.match(thrown.message, message)
}

test('blank weeks accept multiple daily sessions and map into WeekBoard props', () => {
  const blank = createBlankPlannerState({
    athleteId: 'athlete-amy',
    weekStart: '2026-09-07',
    title: 'Base week',
    goal: 'Build consistency.',
    notes: 'Keep one full rest day.',
  })

  assert.deepEqual(plannerStateToWeekPlan(blank).workouts, [])

  const withRun = addPlannerWorkout(blank, buildWorkout('Easy run', '2026-09-08', 'aerobic', { expectedDurationMin: 40, startTime: '06:30' }))
  const withTwoSessions = addPlannerWorkout(withRun, buildWorkout('Lower body', '2026-09-08', 'strength', {
    expectedDurationMin: 60,
    startTime: '18:00',
    source: 'ai',
  }))

  const weekPlan = plannerStateToWeekPlan(withTwoSessions)
  assert.equal(weekPlan.workouts.length, 2)
  assert.equal(weekPlan.workouts[0]!.scheduledDate, '2026-09-08')
  assert.equal(weekPlan.workouts[1]!.scheduledDate, '2026-09-08')

  const board = mapPlannerStateToWeekBoardProps(withTwoSessions)
  const tuesday = board.days[1]!
  assert.equal(tuesday.label, 'Tue')
  assert.equal(tuesday.dateLabel, '8 Sept')
  assert.equal(tuesday.summary, '2 sessions · 100 min')
  assert.deepEqual(tuesday.cards?.map(card => card.title), ['Easy run', 'Lower body'])

  const roundTrip = createPlannerStateFromWeekPlan(weekPlan)
  assert.equal(roundTrip.present.week.workouts.length, 2)
  assert.deepEqual(roundTrip.present.week.workouts.map(entry => entry.localId), weekPlan.workouts.map(workout => `planner-local-${workout.id}`))
})

test('updates duplication deletion and undo redo keep planner history immutable', () => {
  const initial = addPlannerWorkout(
    createBlankPlannerState({
      athleteId: 'athlete-amy',
      weekStart: '2026-09-07',
      title: 'Strength focus',
      goal: 'Lift twice and keep recovery easy.',
    }),
    buildWorkout('Upper body', '2026-09-09', 'strength', { startTime: '07:00' }),
  )

  const localId = initial.present.week.workouts[0]!.localId
  const updated = updatePlannerWorkout(initial, {
    localId,
    changes: {
      title: 'Upper body + trunk',
      notes: 'Keep two reps in reserve.',
    },
  })

  assert.equal(initial.present.week.workouts[0]!.workout.title, 'Upper body')
  assert.equal(updated.present.week.workouts[0]!.workout.title, 'Upper body + trunk')
  assert.equal(updated.present.week.workouts[0]!.localId, localId)
  assert.ok(Object.isFrozen(updated.present.week))
  assert.ok(Object.isFrozen(updated.present.week.workouts))

  const duplicated = duplicatePlannerWorkout(updated, { localId })
  assert.equal(duplicated.present.week.workouts.length, 2)
  assert.equal(duplicated.present.week.workouts[0]!.localId, localId)
  assert.notEqual(duplicated.present.week.workouts[1]!.localId, localId)
  assert.notEqual(
    duplicated.present.week.workouts[0]!.workout.main[0]!.id,
    duplicated.present.week.workouts[1]!.workout.main[0]!.id,
  )

  const deleted = deletePlannerWorkout(duplicated, localId)
  assert.equal(deleted.present.week.workouts.length, 1)

  const undone = undoPlannerState(deleted)
  assert.equal(undone.present.week.workouts.length, 2)
  assert.equal(undone.present.week.workouts[0]!.localId, localId)

  const redone = redoPlannerState(undone)
  assert.equal(redone.present.week.workouts.length, 1)
  assert.notEqual(redone.present.week.workouts[0]!.localId, localId)
})

test('move and reorder support desktop drag and drop ordering across the week', () => {
  let state = createBlankPlannerState({
    athleteId: 'athlete-amy',
    weekStart: '2026-09-07',
    title: 'Board week',
    goal: 'Keep the board sortable.',
  })

  state = addPlannerWorkout(state, buildWorkout('Morning run', '2026-09-08', 'aerobic', { startTime: '06:30' }))
  state = addPlannerWorkout(state, buildWorkout('Evening lift', '2026-09-08', 'strength', { startTime: '18:30' }))
  state = addPlannerWorkout(state, buildWorkout('Mobility flow', '2026-09-10', 'mobility', { startTime: '12:00', expectedDurationMin: 20 }))

  const runId = state.present.week.workouts[0]!.localId
  const liftId = state.present.week.workouts[1]!.localId
  const mobilityId = state.present.week.workouts[2]!.localId

  state = reorderPlannerWorkout(state, { localId: liftId, targetDate: '2026-09-08', targetIndex: 0 })
  assert.deepEqual(listPlannerWorkoutsForDate(state, '2026-09-08').map(entry => entry.workout.title), ['Evening lift', 'Morning run'])

  state = reorderPlannerWorkout(state, { localId: mobilityId, targetDate: '2026-09-08', targetIndex: 1 })
  assert.deepEqual(
    listPlannerWorkoutsForDate(state, '2026-09-08').map(entry => entry.workout.title),
    ['Evening lift', 'Mobility flow', 'Morning run'],
  )

  state = movePlannerWorkout(state, { localId: runId, scheduledDate: '2026-09-09', insertAt: 0 })
  assert.deepEqual(listPlannerWorkoutsForDate(state, '2026-09-08').map(entry => entry.workout.title), ['Evening lift', 'Mobility flow'])
  assert.deepEqual(listPlannerWorkoutsForDate(state, '2026-09-09').map(entry => entry.workout.title), ['Morning run'])
})

test('fixed club workouts preserve identity unless explicitly changed', () => {
  const fixedState = addPlannerWorkout(
    createBlankPlannerState({
      athleteId: 'athlete-amy',
      weekStart: '2026-09-07',
      title: 'Club week',
      goal: 'Protect the anchored session.',
    }),
    {
      ...buildWorkout('Track club', '2026-09-08', 'aerobic', {
        expectedDurationMin: 75,
        source: 'club',
        startTime: '19:00',
      }),
      fixedClubSession: {
        recurringSessionId: 'club-track',
        title: 'Track club',
        scope: 'Primary run session',
        category: 'aerobic',
        dayOfWeek: 2,
        startTime: '19:00',
        durationMin: 75,
      },
    },
  )

  const localId = fixedState.present.week.workouts[0]!.localId

  assertPlannerError(
    () => movePlannerWorkout(fixedState, { localId, scheduledDate: '2026-09-09' }),
    'fixed-club-edit-required',
    /requires an explicit fixed club replacement/,
  )

  assertPlannerError(
    () => updatePlannerWorkout(fixedState, { localId, changes: { source: 'manual' } }),
    'fixed-club-edit-required',
    /requires an explicit fixed club clear action/,
  )

  const movedClub = reorderPlannerWorkout(fixedState, {
    localId,
    targetDate: '2026-09-10',
    targetIndex: 0,
    fixedClubSession: {
      kind: 'replace',
      value: {
        recurringSessionId: 'club-track-thu',
        title: 'Track club',
        scope: 'Primary run session',
        category: 'aerobic',
        dayOfWeek: 4,
        startTime: '19:00',
        durationMin: 75,
      },
    },
  })
  assert.equal(movedClub.present.week.workouts[0]!.workout.scheduledDate, '2026-09-10')
  assert.equal(movedClub.present.week.workouts[0]!.workout.fixedClubSession?.recurringSessionId, 'club-track-thu')

  const convertedToManual = updatePlannerWorkout(fixedState, {
    localId,
    changes: { source: 'manual' },
    fixedClubSession: { kind: 'clear' },
  })
  assert.equal(convertedToManual.present.week.workouts[0]!.workout.source, 'manual')
  assert.equal(convertedToManual.present.week.workouts[0]!.workout.fixedClubSession, undefined)
})

test('validation failures surface explicit planner errors', () => {
  const blank = createBlankPlannerState({
    athleteId: 'athlete-amy',
    weekStart: '2026-09-07',
    title: 'Validation week',
    goal: 'Exercise the error paths.',
  })

  assertPlannerError(
    () => addPlannerWorkout(blank, buildWorkout('Far future run', '2026-09-20', 'aerobic')),
    'date-out-of-range',
    /must stay inside the active seven-day week/,
  )

  const withOneWorkout = addPlannerWorkout(blank, buildWorkout('Tempo run', '2026-09-07', 'aerobic'))
  const localId = withOneWorkout.present.week.workouts[0]!.localId

  assertPlannerError(
    () => reorderPlannerWorkout(withOneWorkout, { localId, targetDate: '2026-09-07', targetIndex: 2 }),
    'invalid-target-index',
    /outside the 2026-09-07 workout list/,
  )

  assertPlannerError(
    () => deletePlannerWorkout(withOneWorkout, 'planner-local-missing-workout'),
    'missing-workout',
    /was not found/,
  )
})

test('week context and review survive edits, duplication, undo and deleting the last card', () => {
  const initial = addPlannerWorkout(createBlankPlannerState({ athleteId: 'athlete-amy', weekStart: '2026-09-07' }), {
    ...buildWorkout('Press', '2026-09-07', 'strength'),
    main: [{ title: 'Dumbbell press', estimatedTotalMin: 12, target: { sets: 2, reps: 8, loadKg: 12, loadBasis: 'per_implement', repBasis: 'total' } }],
  })
  const original = plannerStateToWeekPlan(initial)
  original.planningContext = { asOf: '2026-09-07', benchmarks: ['12 kg per dumbbell'] }
  original.goalAssessment = { status: 'conditional', rationale: 'Progress gradually.', unknowns: [], nextMilestone: 'Review next week.' }
  original.review = { reflection: 'Good session', metrics: [] }
  const loaded = createPlannerStateFromWeekPlan(original)
  const id = loaded.present.week.workouts[0]!.localId
  const changed = updatePlannerWorkout(loaded, { localId: id, changes: { title: 'Renamed press' } })
  const copied = duplicatePlannerWorkout(changed, { localId: id })
  const saved = plannerStateToWeekPlan(copied)
  assert.deepEqual(saved.planningContext, original.planningContext)
  assert.deepEqual(saved.goalAssessment, original.goalAssessment)
  assert.deepEqual(saved.review, plannerStateToWeekPlan(loaded).review)
  assert.equal(saved.workouts[1]?.main[0]?.estimatedTotalMin, 12)
  assert.equal(saved.workouts[1]?.main[0]?.target?.loadBasis, 'per_implement')
  const undone = undoPlannerState(copied)
  const empty = plannerStateToWeekPlan(deletePlannerWorkout(undone, id))
  assert.equal(empty.workouts.length, 0)
  assert.equal(empty.review?.reflection, 'Good session')
})
