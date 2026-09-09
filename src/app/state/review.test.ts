/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'

import type { LoggedWorkoutStep } from '../../ai/index.ts'
import { parseWeekPlan, parseWorkout, parseWorkoutLog } from '../../domain/contracts.ts'
import { parseLocalDate } from '../../domain/local-date.ts'
import {
  buildWorkoutReviewLog,
  buildWorkoutReviewLogs,
  buildWorkoutReviewPayload,
  createWeeklyReviewScreenProps,
  createWorkoutLogScreenProps,
  createWorkoutReviewState,
  getDirtyWorkoutReviewIds,
  mergeSavedWorkoutReviewLogs,
  reduceInlineWorkoutReviewState,
  reduceWorkoutReviewState,
  setWorkoutReviewEffortRating,
  setWorkoutReviewMetrics,
  setWorkoutReviewNotes,
  setWorkoutReviewStepActualValues,
  setWorkoutReviewStepEffortRating,
  setWorkoutReviewStepNotes,
  setWorkoutReviewStepStatus,
  startWorkoutReviewLog,
  validateWorkoutReviewState,
  WorkoutReviewError,
  type WorkoutReviewAction,
  type WorkoutReviewState,
} from './review.ts'
import type { TrackedWorkoutChange } from './ai-handoff.ts'

function createWeekPlan() {
  return parseWeekPlan({
    version: 1,
    id: 'week-2026-09-07-athlete-amy',
    athleteId: 'athlete-amy',
    weekStart: '2026-09-07',
    title: 'Week of 2026-09-07',
    goal: 'Keep the week consistent while work is busy.',
    workouts: [
      {
        version: 1,
        id: 'run-easy',
        athleteId: 'athlete-amy',
        weekPlanId: 'week-2026-09-07-athlete-amy',
        scheduledDate: '2026-09-09',
        startTime: '07:00',
        category: 'aerobic',
        source: 'manual',
        title: 'Easy run',
        purpose: 'Maintain aerobic frequency without digging a hole.',
        expectedDurationMin: 40,
        warmup: [{ id: 'run-easy-warm', title: 'Jog', target: { minutes: 8 } }],
        main: [{ id: 'run-easy-main', title: 'Easy aerobic block', detail: 'Stay relaxed.', target: { minutes: 27, effort: 'easy' } }],
        cooldown: [{ id: 'run-easy-cool', title: 'Walk', target: { minutes: 5 } }],
      },
      {
        version: 1,
        id: 'strength-lift',
        athleteId: 'athlete-amy',
        weekPlanId: 'week-2026-09-07-athlete-amy',
        scheduledDate: '2026-09-11',
        startTime: '18:00',
        category: 'strength',
        source: 'ai',
        title: 'Strength lift',
        purpose: 'Keep lower-body strength progressing.',
        expectedDurationMin: 45,
        warmup: [{ id: 'strength-warm', title: 'Dynamic warm-up', target: { minutes: 8 } }],
        main: [{ id: 'strength-main', title: 'Squat', detail: 'Work up to crisp sets.', target: { sets: 4, reps: 5, loadKg: 62.5, effort: 'steady' } }],
        cooldown: [{ id: 'strength-cool', title: 'Breathing reset', target: { minutes: 4 } }],
      },
    ],
  })
}

function createDeletedWorkout(weekPlanId: string) {
  return parseWorkout({
    version: 1,
    id: 'mobility-deleted',
    athleteId: 'athlete-amy',
    weekPlanId,
    scheduledDate: '2026-09-12',
    startTime: '20:00',
    category: 'mobility',
    source: 'manual',
    title: 'Mobility reset',
    purpose: 'Originally planned after travel.',
    expectedDurationMin: 20,
    warmup: [{ id: 'mobility-warm', title: 'Breathing', target: { minutes: 4 } }],
    main: [{ id: 'mobility-main', title: 'Flow work', target: { minutes: 12 } }],
    cooldown: [{ id: 'mobility-cool', title: 'Reset', target: { minutes: 4 } }],
  })
}

function createInitialState(): WorkoutReviewState {
  const weekPlan = createWeekPlan()
  const workoutLogs = [
    parseWorkoutLog({
      version: 1,
      id: 'run-log-old',
      athleteId: 'athlete-amy',
      weekPlanId: weekPlan.id,
      workoutId: 'run-easy',
      loggedOn: '2026-09-08',
      outcome: 'completed',
      effortRating: 5,
      steps: [{
        stepId: 'run-easy-main',
        completedMinutes: 25,
        notes: 'Step status: done\nStep effort RPE: 5/10\nFelt smooth.',
      }],
      notes: 'Good easy run.',
    }),
    parseWorkoutLog({
      version: 1,
      id: 'run-log-latest',
      athleteId: 'athlete-amy',
      weekPlanId: weekPlan.id,
      workoutId: 'run-easy',
      loggedOn: '2026-09-09',
      outcome: 'partial',
      effortRating: 7,
      metrics: {
        durationMin: 34,
        paceSecondsPerKm: 300,
        averageHeartRate: 152,
      },
      steps: [{
        stepId: 'run-easy-main',
        completedMinutes: 18,
        completedPaceSecondsPerKm: 290,
        notes: 'Felt decent after the first few minutes.',
      }],
      notes: 'Cut the run short because work ran over.',
    }),
  ]
  const trackedChanges: TrackedWorkoutChange[] = [
    {
      workoutId: 'run-easy',
      type: 'moved',
      fromDate: parseLocalDate('2026-09-08'),
      toDate: parseLocalDate('2026-09-09'),
      note: 'Morning meeting pushed the run back a day.',
    },
    {
      workoutId: 'mobility-deleted',
      type: 'deleted',
      fromDate: parseLocalDate('2026-09-12'),
      note: 'Removed once travel changed.',
      workoutSnapshot: createDeletedWorkout(weekPlan.id),
    },
  ]
  return createWorkoutReviewState({ weekPlan, workoutLogs, trackedChanges })
}

test('review state hydrates latest logs, preserves prescriptions, and builds continuation-ready payload', () => {
  let state = createInitialState()
  const workoutProps = createWorkoutLogScreenProps(state, 'run-easy')

  assert.equal(workoutProps.hasLog, true)
  assert.equal(workoutProps.historyCount, 2)
  assert.match(workoutProps.actualSummary, /durationMin: 34/)
  assert.match(workoutProps.actualSummary, /pace: 5:00\/km/)
  assert.match(workoutProps.stepResults[1]?.actualResult ?? '', /minutes: 18/)
  assert.match(workoutProps.stepResults[1]?.actualResult ?? '', /pace: 4:50\/km/)
  assert.match((workoutProps.messages ?? []).map(message => message.text).join('\n'), /Loaded the latest of 2 saved logs/)
  assert.match((workoutProps.messages ?? []).map(message => message.text).join('\n'), /had no structured status; inferred "done"/)

  state = reduceWorkoutReviewState(state, { type: 'setWeeklyReviewField', field: 'reflection', value: 'Busy week but still hit the key run.' })
  state = reduceWorkoutReviewState(state, { type: 'setWeeklyReviewField', field: 'energy', value: '3' })
  state = reduceWorkoutReviewState(state, { type: 'setWeeklyReviewField', field: 'nextFocus', value: 'Protect the strength session and restore the deleted mobility slot.' })

  const payload = buildWorkoutReviewPayload(state)
  assert.equal(payload.summary.total, 3)
  assert.equal(payload.summary.logged, 1)
  assert.equal(payload.summary.partial, 1)
  assert.equal(payload.summary.unlogged, 2)
  assert.equal(payload.summary.changes.deleted, 1)
  assert.equal(payload.previousWeek.workouts.length, 3)
  assert.equal(payload.previousWeek.workouts.find(workout => workout.original.id === 'run-easy')?.original.title, 'Easy run')
  assert.equal(payload.previousWeek.workouts.find(workout => workout.original.id === 'mobility-deleted')?.changes?.[0]?.type, 'deleted')
  assert.match(payload.previousWeek.summary ?? '', /Busy week but still hit the key run\./)
  assert.match(payload.previousWeek.summary ?? '', /0 completed, 1 partial, 0 skipped, 2 unlogged/)
})

test('typed helpers create structured logs and preserve older history entries', () => {
  let state = createInitialState()
  state = startWorkoutReviewLog(state, 'strength-lift', 'completed')
  state = setWorkoutReviewEffortRating(state, 'strength-lift', 8)
  state = setWorkoutReviewMetrics(state, 'strength-lift', { durationMin: 46, averageHeartRate: 128 })
  state = setWorkoutReviewNotes(state, 'strength-lift', 'Strong session even after a long workday.')
  state = setWorkoutReviewStepStatus(state, 'strength-lift', 'strength-main', 'trimmed')
  state = setWorkoutReviewStepEffortRating(state, 'strength-lift', 'strength-main', 6)
  state = setWorkoutReviewStepActualValues(state, 'strength-lift', 'strength-main', { sets: 3, reps: 5, loadKg: 60 })
  state = setWorkoutReviewStepNotes(state, 'strength-lift', 'strength-main', 'Dropped the final set to keep bar speed crisp.')

  const newLog = buildWorkoutReviewLog(state, 'strength-lift')
  assert.equal(newLog.outcome, 'completed')
  assert.equal(newLog.effortRating, 8)
  assert.equal(newLog.metrics?.durationMin, 46)
  assert.equal(newLog.steps[1]?.completedSets, 3)
  assert.equal(newLog.steps[1]?.completedReps, 5)
  assert.equal(newLog.steps[1]?.loadKg, 60)
  assert.match(newLog.steps[1]?.notes ?? '', /Step status: trimmed/)
  assert.match(newLog.steps[1]?.notes ?? '', /Step effort RPE: 6\/10/)

  const allLogs = buildWorkoutReviewLogs(state)
  assert.equal(allLogs.length, 3)
  assert.equal(allLogs.filter(log => log.id === 'run-log-old').length, 1)
  assert.equal(allLogs.filter(log => log.id === 'run-log-latest').length, 1)
  assert.equal(allLogs.find(log => log.workoutId === 'strength-lift')?.id, 'log-strength-lift')
})

test('screen adapters expose controlled callbacks for workout and weekly review screens', () => {
  const state = createInitialState()
  let dispatched: WorkoutReviewAction | undefined

  createWorkoutLogScreenProps(state, 'run-easy', action => { dispatched = action }).onNotesChange('Example note')
  assert.deepEqual(dispatched, {
    type: 'setWorkoutNotes',
    workoutId: 'run-easy',
    value: 'Example note',
  })

  createWeeklyReviewScreenProps(state, action => { dispatched = action }).onMetricChange('completed-workouts', 'note', 'Protected the key sessions.')
  assert.deepEqual(dispatched, {
    type: 'setWeeklyMetricField',
    metricId: 'completed-workouts',
    field: 'note',
    value: 'Protected the key sessions.',
  })
})

test('workout screen adapters reuse supplied board validation and retain three-argument behavior', () => {
  const state = reduceWorkoutReviewState(createInitialState(), { type: 'setWorkoutActualSummary', workoutId: 'run-easy', value: 'pace: invalid' })
  const validation = validateWorkoutReviewState(state)
  let weeklyReviewReads = 0
  const observedState: WorkoutReviewState = {
    ...state,
    get weeklyReview() {
      weeklyReviewReads += 1
      return state.weeklyReview
    },
  }
  let dispatched: WorkoutReviewAction | undefined
  const dispatch = (action: WorkoutReviewAction) => { dispatched = action }
  for (const workout of state.workouts) {
    const props = createWorkoutLogScreenProps(observedState, workout.workout.id, dispatch, validation)
    const defaultProps = createWorkoutLogScreenProps(state, workout.workout.id, dispatch)
    assert.deepEqual(props.messages, defaultProps.messages)
    assert.strictEqual(props.stepResults, workout.draft.stepResults)
    props.onNotesChange('Cached validation still dispatches.')
    assert.deepEqual(dispatched, { type: 'setWorkoutNotes', workoutId: workout.workout.id, value: 'Cached validation still dispatches.' })
  }
  assert.equal(weeklyReviewReads, 0)
  const defaultProps = createWorkoutLogScreenProps(observedState, 'run-easy', dispatch)
  assert.ok(weeklyReviewReads > 0)
  assert.match(defaultProps.messages?.find(message => message.tone === 'error')?.text ?? '', /pace format/)
})

test('invalid structured text reports explicit issues and blocks payload creation', () => {
  let state = createWorkoutReviewState({ weekPlan: createWeekPlan() })
  state = startWorkoutReviewLog(state, 'run-easy', 'partial')
  state = reduceWorkoutReviewState(state, {
    type: 'setWorkoutActualSummary',
    workoutId: 'run-easy',
    value: 'pace: fast',
  })

  const validation = validateWorkoutReviewState(state)
  assert.equal(validation.issues.length > 0, true)
  assert.match(validation.issues[0]?.message ?? '', /M:SS\/km or H:MM:SS\/km/)
  assert.throws(() => buildWorkoutReviewPayload(state), /M:SS\/km or H:MM:SS\/km/)
})

function createInlineState(): WorkoutReviewState {
  const weekPlan = createWeekPlan()
  return createWorkoutReviewState({
    weekPlan: parseWeekPlan({
      ...weekPlan,
      workouts: weekPlan.workouts.map(workout => workout.id !== 'strength-lift' ? workout : {
        ...workout,
        main: [
          ...workout.main,
          { id: 'strength-row', title: 'Row', target: { sets: 3, reps: 8, loadKg: 20 } },
        ],
      }),
    }),
  })
}

function createThreeWorkoutState(): WorkoutReviewState {
  const weekPlan = createWeekPlan()
  return createWorkoutReviewState({
    weekPlan: {
      ...weekPlan,
      workouts: [...weekPlan.workouts, createDeletedWorkout(weekPlan.id)],
    },
  })
}

function editInlineStep(
  state: WorkoutReviewState,
  stepId: string,
  field: 'actualResult' | 'effort' | 'notes' | 'status',
  value: string,
): WorkoutReviewState {
  return reduceInlineWorkoutReviewState(state, {
    type: 'setWorkoutStepResultField',
    workoutId: 'strength-lift',
    stepId,
    field,
    value,
  })
}

test('inline edits start only their workout with blank actuals and unrecorded steps', () => {
  const initial = createInlineState()
  let state = editInlineStep(initial, 'strength-main', 'notes', 'Trying a lighter warm-up first.')
  const workout = state.workouts[1]!

  assert.equal(workout.isLogged, true)
  assert.equal(workout.draft.completionStatus, 'partial')
  assert.equal(workout.draft.actualSummary, '')
  assert.equal(workout.draft.sessionRpe, '')
  assert.deepEqual(workout.draft.stepResults.map(step => step.status), Array(4).fill('unrecorded'))
  assert.ok(workout.draft.stepResults.every(step => step.actualResult === '' && step.effort === ''))
  assert.strictEqual(state.workouts[0], initial.workouts[0])
  assert.strictEqual(state.weeklyReview.draft, initial.weeklyReview.draft)
  assert.deepEqual(getDirtyWorkoutReviewIds(state), ['strength-lift'])

  const log = buildWorkoutReviewLog(state, 'strength-lift')
  assert.equal(log.outcome, 'partial')
  assert.equal(log.metrics, undefined)
  assert.equal(log.effortRating, undefined)
  for (const step of log.steps) {
    assert.equal(step.completedSets, undefined)
    assert.equal(step.completedReps, undefined)
    assert.equal(step.completedMinutes, undefined)
    assert.equal(step.loadKg, undefined)
    assert.match(step.notes ?? '', /^Step status: unrecorded/)
  }
  assert.equal(buildWorkoutReviewLogs(state).length, 1)
  const payload = buildWorkoutReviewPayload(state)
  assert.equal(payload.summary.completed, 0)
  assert.equal(payload.summary.partial, 1)
  assert.equal(payload.summary.unlogged, 1)
  assert.equal(payload.previousWeek.workouts.find(entry => entry.original.id === 'run-easy')?.actualLog, undefined)

  state = editInlineStep(state, 'strength-main', 'actualResult', 'loadKg: 0')
  assert.equal(buildWorkoutReviewLog(state, 'strength-lift').steps[1]?.loadKg, 0)
  state = editInlineStep(state, 'strength-main', 'actualResult', '')
  assert.equal(buildWorkoutReviewLog(state, 'strength-lift').steps[1]?.loadKg, undefined)
  assert.equal(state.workouts[1]?.workout.main[0]?.target?.loadKg, 62.5)
})

test('per-exercise loads, comments, and unrecorded steps round-trip into week-2 context', () => {
  let state = createInlineState()
  state = editInlineStep(state, 'strength-main', 'actualResult', 'sets: 3\nreps: 5\nloadKg: 60')
  state = editInlineStep(state, 'strength-main', 'notes', 'Stopped one set early; left knee felt stiff.')
  state = editInlineStep(state, 'strength-main', 'effort', '7')
  state = editInlineStep(state, 'strength-main', 'status', 'trimmed')
  state = editInlineStep(state, 'strength-row', 'actualResult', 'sets: 3\nreps: 8\nloadKg: 0')
  state = editInlineStep(state, 'strength-row', 'notes', 'Used bodyweight instead of dumbbells.')
  state = editInlineStep(state, 'strength-row', 'status', 'done')

  const logs = buildWorkoutReviewLogs(state).map(log => parseWorkoutLog(JSON.parse(JSON.stringify(log))))
  const reloaded = createWorkoutReviewState({ weekPlan: state.weekPlan, workoutLogs: logs })
  assert.deepEqual(reloaded.workouts[1]?.draft, state.workouts[1]?.draft)
  assert.deepEqual(getDirtyWorkoutReviewIds(reloaded), [])
  assert.deepEqual(validateWorkoutReviewState(reloaded).issues, [])
  assert.deepEqual(buildWorkoutReviewLogs(reloaded), logs)
  assert.ok(reloaded.workouts[1]?.hydrationMessages.every(message => message.tone !== 'error'))

  const payload = buildWorkoutReviewPayload(reloaded)
  const context = payload.previousWeek.workouts.find(entry => entry.original.id === 'strength-lift')!
  assert.equal(payload.previousWeek.weekStart, '2026-09-07')
  assert.equal(payload.previousWeek.weekEnd, '2026-09-13')
  assert.equal(context.actualLog?.completionStatus, 'partial')
  assert.equal(context.actualLog?.steps?.[1]?.loadKg, 60)
  assert.match(context.actualLog?.steps?.[1]?.note ?? '', /Step status: trimmed\nStep effort RPE: 7\/10\nStopped one set early; left knee felt stiff\./)
  assert.equal(context.actualLog?.steps?.[2]?.loadKg, 0)
  assert.match(context.actualLog?.steps?.[2]?.note ?? '', /Used bodyweight instead of dumbbells\./)
  for (const index of [0, 3]) {
    const step: LoggedWorkoutStep | undefined = context.actualLog?.steps?.[index]
    assert.ok(step)
    assert.equal(step.note, 'Step status: unrecorded')
    assert.equal(step.completedDurationMin, undefined)
    assert.equal(step.completedSets, undefined)
    assert.equal(step.loadKg, undefined)
  }
  assert.equal(context.original.main[0]?.loadKg, 62.5)
  assert.equal(payload.summary.completed, 0)
  assert.equal(payload.summary.unlogged, 1)
})

test('inline reducer preserves explicit starts and existing workout outcomes', () => {
  for (const [outcome, status] of [
    ['completed', 'done'],
    ['partial', 'trimmed'],
    ['skipped', 'skipped'],
  ] as const) {
    let state = reduceInlineWorkoutReviewState(createInlineState(), { type: 'startWorkoutLog', workoutId: 'strength-lift', outcome })
    assert.ok(state.workouts[1]?.draft.stepResults.every(step => step.status === status))
    state = editInlineStep(state, 'strength-main', 'notes', 'Explicitly started.')
    assert.equal(state.workouts[1]?.draft.completionStatus, outcome)
    assert.ok(state.workouts[1]?.draft.stepResults.every(step => step.status === status && step.actualResult === ''))
    assert.equal(buildWorkoutReviewLog(state, 'strength-lift').outcome, outcome)
  }
  const defaultStart = startWorkoutReviewLog(createInlineState(), 'strength-lift')
  assert.equal(defaultStart.workouts[1]?.draft.completionStatus, 'completed')
  assert.ok(defaultStart.workouts[1]?.draft.stepResults.every(step => step.status === 'done'))

  let state = createInitialState()
  const initialDraft = state.workouts[0]!.draft
  state = reduceInlineWorkoutReviewState(state, { type: 'setWorkoutNotes', workoutId: 'run-easy', value: 'Edited a persisted log.' })
  assert.equal(state.workouts[0]?.draft.completionStatus, 'partial')
  assert.strictEqual(state.workouts[0]?.draft.stepResults, initialDraft.stepResults)
  assert.equal(state.workouts[0]?.draft.actualSummary, initialDraft.actualSummary)

  for (const [outcome, status] of [
    ['completed', 'done'],
    ['skipped', 'skipped'],
    ['partial', 'unrecorded'],
  ] as const) {
    const initial = createInlineState()
    const updated = reduceInlineWorkoutReviewState(initial, { type: 'setWorkoutCompletionStatus', workoutId: 'strength-lift', value: outcome })
    assert.equal(updated.workouts[1]?.draft.completionStatus, outcome)
    assert.ok(updated.workouts[1]?.draft.stepResults.every(step => step.status === status && step.actualResult === ''))
    assert.strictEqual(updated.workouts[0], initial.workouts[0])
    assert.equal(updated.workouts[0]?.isLogged, false)
    assert.deepEqual(getDirtyWorkoutReviewIds(updated), ['strength-lift'])
    assert.equal(buildWorkoutReviewLogs(updated).length, 1)
  }
})

test('explicit inline session outcomes update only unrecorded steps and preserve actuals and comments', () => {
  let state = createInlineState()
  state = editInlineStep(state, 'strength-warm', 'status', 'done')
  state = editInlineStep(state, 'strength-main', 'status', 'trimmed')
  state = editInlineStep(state, 'strength-row', 'status', 'skipped')
  for (const stepId of ['strength-warm', 'strength-main', 'strength-row', 'strength-cool']) {
    state = editInlineStep(state, stepId, 'actualResult', 'loadKg: 0')
    state = editInlineStep(state, stepId, 'effort', '6')
    state = editInlineStep(state, stepId, 'notes', `Keep the ${stepId} comment.`)
  }
  state = reduceInlineWorkoutReviewState(state, { type: 'setWorkoutSessionRpe', workoutId: 'strength-lift', value: '7' })
  state = reduceInlineWorkoutReviewState(state, { type: 'setWorkoutActualSummary', workoutId: 'strength-lift', value: 'durationMin: 25' })
  state = reduceInlineWorkoutReviewState(state, { type: 'setWorkoutNotes', workoutId: 'strength-lift', value: 'Preserve the session notes.' })
  const original = state.workouts[1]!.draft

  for (const [outcome, status] of [
    ['completed', 'done'],
    ['skipped', 'skipped'],
    ['partial', 'unrecorded'],
  ] as const) {
    const updated = reduceInlineWorkoutReviewState(state, { type: 'setWorkoutCompletionStatus', workoutId: 'strength-lift', value: outcome })
    assert.deepEqual(updated.workouts[1]?.draft, {
      ...original,
      completionStatus: outcome,
      stepResults: original.stepResults.map(step => step.status === 'unrecorded' ? { ...step, status } : step),
    })
    for (const index of [0, 1, 2]) assert.strictEqual(updated.workouts[1]?.draft.stepResults[index], original.stepResults[index])
    assert.strictEqual(updated.workouts[0], state.workouts[0])
    assert.strictEqual(updated.weeklyReview.draft, state.weeklyReview.draft)
    const log = buildWorkoutReviewLog(updated, 'strength-lift')
    assert.equal(log.outcome, outcome)
    assert.deepEqual(log.steps.map(step => step.notes?.split('\n')[0]), [
      'Step status: done',
      'Step status: trimmed',
      'Step status: skipped',
      `Step status: ${status}`,
    ])
    assert.ok(log.steps.every(step => step.loadKg === 0))
  }
})

test('dirty tracking compares raw persisted hydration, including invalid edits and reversions', () => {
  const initial = createInitialState()
  assert.deepEqual(getDirtyWorkoutReviewIds(initial), [])
  let state = reduceInlineWorkoutReviewState(initial, { type: 'setWeeklyReviewField', field: 'energy', value: 'invalid weekly rating' })
  state = reduceInlineWorkoutReviewState(state, { type: 'setWeeklyMetricField', metricId: 'completed-workouts', field: 'note', value: 'Weekly-only feedback.' })
  assert.deepEqual(getDirtyWorkoutReviewIds(state), [])
  assert.strictEqual(state.workouts, initial.workouts)

  const original = initial.workouts[0]!.draft
  const edits: WorkoutReviewAction[] = [
    { type: 'setWorkoutSessionRpe', workoutId: 'run-easy', value: 'not a rating' },
    { type: 'setWorkoutActualSummary', workoutId: 'run-easy', value: 'pace: fast' },
    { type: 'setWorkoutNotes', workoutId: 'run-easy', value: 'Different note.' },
    { type: 'setWorkoutCompletionStatus', workoutId: 'run-easy', value: 'skipped' },
    { type: 'setWorkoutStepResultField', workoutId: 'run-easy', stepId: 'run-easy-main', field: 'actualResult', value: 'loadKg: not a number' },
    { type: 'setWorkoutStepResultField', workoutId: 'run-easy', stepId: 'run-easy-main', field: 'effort', value: 'invalid step RPE' },
    { type: 'setWorkoutStepResultField', workoutId: 'run-easy', stepId: 'run-easy-main', field: 'notes', value: 'New step comment.' },
    { type: 'setWorkoutStepResultField', workoutId: 'run-easy', stepId: 'run-easy-main', field: 'status', value: 'unrecorded' },
  ]
  for (const action of edits) {
    const edited = reduceInlineWorkoutReviewState(state, action)
    assert.deepEqual(getDirtyWorkoutReviewIds(edited), ['run-easy'], action.type)
  }
  state = reduceInlineWorkoutReviewState(state, { type: 'setWorkoutActualSummary', workoutId: 'run-easy', value: 'invalid' })
  state = reduceInlineWorkoutReviewState(state, { type: 'setWorkoutActualSummary', workoutId: 'run-easy', value: original.actualSummary })
  state = reduceInlineWorkoutReviewState(state, { type: 'setWorkoutNotes', workoutId: 'run-easy', value: original.notes })
  assert.notStrictEqual(state.workouts[0]?.draft, original)
  assert.deepEqual(getDirtyWorkoutReviewIds(state), [])
  state = startWorkoutReviewLog(state, 'strength-lift')
  assert.deepEqual(getDirtyWorkoutReviewIds(state), ['strength-lift'])
})

test('saved merge refreshes only successful workouts and preserves another dirty draft and weekly review', () => {
  let submitted = createInitialState()
  submitted = reduceInlineWorkoutReviewState(submitted, { type: 'setWorkoutNotes', workoutId: 'run-easy', value: 'Saved run update.' })
  submitted = editInlineStep(submitted, 'strength-main', 'actualResult', 'loadKg: unfinished')
  submitted = reduceWorkoutReviewState(submitted, { type: 'setWeeklyReviewField', field: 'reflection', value: 'Do not discard this reflection.' })
  submitted = reduceWorkoutReviewState(submitted, { type: 'setWeeklyMetricField', metricId: 'completed-workouts', field: 'note', value: 'Custom weekly metric.' })
  const saved = buildWorkoutReviewLog(submitted, 'run-easy')
  const merged = mergeSavedWorkoutReviewLogs(submitted, submitted, [saved], ['run-easy'])

  assert.strictEqual(merged.workouts[1], submitted.workouts[1])
  assert.strictEqual(merged.weeklyReview, submitted.weeklyReview)
  assert.strictEqual(merged.weekPlan, submitted.weekPlan)
  assert.strictEqual(merged.trackedChanges, submitted.trackedChanges)
  assert.equal(merged.sourceLogs.length, 2)
  assert.strictEqual(merged.sourceLogs.find(log => log.id === 'run-log-old'), submitted.sourceLogs.find(log => log.id === 'run-log-old'))
  assert.equal(merged.workouts[0]?.logHistory.length, 2)
  assert.equal(merged.workouts[0]?.logHistory[0]?.notes, 'Saved run update.')
  assert.notStrictEqual(merged.workouts[0]?.draft, submitted.workouts[0]?.draft)
  assert.deepEqual(getDirtyWorkoutReviewIds(merged), ['strength-lift'])
})

test('saved merge preserves same-card and other-card edits made while saving and advances the saved baseline', () => {
  const initial = createInlineState()
  const submitted = editInlineStep(initial, 'strength-main', 'actualResult', 'loadKg: 55')
  const saved = buildWorkoutReviewLog(submitted, 'strength-lift')
  let current = editInlineStep(submitted, 'strength-main', 'actualResult', 'loadKg: still typing')
  current = editInlineStep(current, 'strength-main', 'notes', 'Added during the save.')
  current = reduceInlineWorkoutReviewState(current, { type: 'setWorkoutNotes', workoutId: 'run-easy', value: 'Another card was edited.' })
  current = reduceWorkoutReviewState(current, { type: 'setWeeklyReviewField', field: 'nextFocus', value: 'Written during the save.' })

  const merged = mergeSavedWorkoutReviewLogs(current, submitted, [saved], ['strength-lift'])
  assert.strictEqual(merged.workouts[1]?.draft, current.workouts[1]?.draft)
  assert.strictEqual(merged.workouts[0], current.workouts[0])
  assert.strictEqual(merged.weeklyReview, current.weeklyReview)
  assert.equal(merged.workouts[1]?.logHistory[0]?.steps[1]?.loadKg, 55)
  assert.equal(merged.sourceLogs.find(log => log.workoutId === 'strength-lift')?.steps[1]?.loadKg, 55)
  assert.deepEqual(getDirtyWorkoutReviewIds(merged), ['run-easy', 'strength-lift'])

  let reverted = editInlineStep(merged, 'strength-main', 'actualResult', 'loadKg: 55')
  reverted = editInlineStep(reverted, 'strength-main', 'notes', '')
  assert.deepEqual(getDirtyWorkoutReviewIds(reverted), ['run-easy'])
  const runLog = buildWorkoutReviewLog(reverted, 'run-easy')
  const savedBoth = mergeSavedWorkoutReviewLogs(reverted, reverted, [runLog], ['run-easy'])
  assert.deepEqual(getDirtyWorkoutReviewIds(savedBoth), [])
  assert.strictEqual(savedBoth.workouts[1], reverted.workouts[1])
})

test('a stale save response never rolls back another workout saved since submission', () => {
  let submitted = createInitialState()
  submitted = editInlineStep(submitted, 'strength-main', 'notes', 'Save the strength workout.')
  const strengthLog = buildWorkoutReviewLog(submitted, 'strength-lift')
  const staleResponse = [...submitted.sourceLogs, strengthLog]

  let current = reduceInlineWorkoutReviewState(submitted, { type: 'setWorkoutNotes', workoutId: 'run-easy', value: 'Newer saved run notes.' })
  const runLog = buildWorkoutReviewLog(current, 'run-easy')
  current = mergeSavedWorkoutReviewLogs(current, current, [runLog], ['run-easy'])
  const merged = mergeSavedWorkoutReviewLogs(current, submitted, staleResponse, ['strength-lift'])
  assert.strictEqual(merged.workouts[0], current.workouts[0])
  assert.strictEqual(merged.sourceLogs.find(log => log.id === runLog.id), current.sourceLogs.find(log => log.id === runLog.id))
  assert.equal(merged.workouts[0]?.draft.notes, 'Newer saved run notes.')
  assert.equal(merged.workouts[1]?.logHistory.length, 1)
  assert.deepEqual(getDirtyWorkoutReviewIds(merged), [])
})

test('saved merge uses draft identity even when in-flight edits return to the submitted values', () => {
  let submitted = createInlineState()
  submitted = editInlineStep(submitted, 'strength-main', 'notes', 'Keep this draft reference.')
  submitted = reduceInlineWorkoutReviewState(submitted, { type: 'setWorkoutNotes', workoutId: 'run-easy', value: 'Also save this workout.' })
  const logs = buildWorkoutReviewLogs(submitted)
  let current = editInlineStep(submitted, 'strength-main', 'notes', 'Changed during the save.')
  current = editInlineStep(current, 'strength-main', 'notes', 'Keep this draft reference.')

  assert.deepEqual(current.workouts[1]?.draft, submitted.workouts[1]?.draft)
  assert.notStrictEqual(current.workouts[1]?.draft, submitted.workouts[1]?.draft)
  const merged = mergeSavedWorkoutReviewLogs(current, submitted, logs, ['run-easy', 'strength-lift'])
  assert.strictEqual(merged.workouts[1]?.draft, current.workouts[1]?.draft)
  assert.notStrictEqual(merged.workouts[0]?.draft, current.workouts[0]?.draft)
  assert.deepEqual(getDirtyWorkoutReviewIds(merged), [])
})

test('automatic weekly metrics follow inline drafts and saved logs in state, screen, and week-2 payload', () => {
  const assertCounts = (state: WorkoutReviewState, expected: Readonly<Record<string, string>>) => {
    const screen = createWeeklyReviewScreenProps(state)
    const payload = buildWorkoutReviewPayload(state)
    assert.deepEqual(screen.summary, payload.summary)
    for (const metrics of [state.weeklyReview.metrics, screen.metrics, payload.review.metrics]) {
      assert.deepEqual(Object.fromEntries(metrics.map(metric => [metric.id, metric.completed])), expected)
      assert.ok(metrics.every(metric => metric.planned === '3'))
    }
  }
  let state = createThreeWorkoutState()
  assertCounts(state, {
    'total-workouts': '0',
    'completed-workouts': '0',
    'partial-workouts': '0',
    'skipped-workouts': '0',
    'unlogged-workouts': '3',
  })
  state = reduceWorkoutReviewState(state, { type: 'setWeeklyReviewField', field: 'reflection', value: 'Training is still in progress.' })
  const feedback = state.weeklyReview.draft
  state = editInlineStep(state, 'strength-main', 'actualResult', 'loadKg: 0')
  state = reduceInlineWorkoutReviewState(state, { type: 'setWorkoutNotes', workoutId: 'run-easy', value: 'First running block finished.' })
  assert.equal(state.sourceLogs.length, 0)
  const partialCounts = {
    'total-workouts': '2',
    'completed-workouts': '0',
    'partial-workouts': '2',
    'skipped-workouts': '0',
    'unlogged-workouts': '1',
  }
  assertCounts(state, partialCounts)

  const submitted = state
  state = mergeSavedWorkoutReviewLogs(state, submitted, buildWorkoutReviewLogs(submitted), getDirtyWorkoutReviewIds(submitted))
  assertCounts(state, partialCounts)
  assert.deepEqual(getDirtyWorkoutReviewIds(state), [])
  assert.strictEqual(state.weeklyReview.draft, feedback)
  assert.equal(state.workouts[2]?.isLogged, false)
  const payload = buildWorkoutReviewPayload(state)
  assert.equal(payload.summary.partial, 2)
  assert.equal(payload.summary.unlogged, 1)
  assert.match(payload.previousWeek.summary ?? '', /0 completed, 2 partial, 0 skipped, 1 unlogged/)
  assert.match(payload.previousWeek.summary ?? '', /Partial workouts \| planned 3 \| completed 2/)
  assert.match(payload.previousWeek.summary ?? '', /Unlogged workouts \| planned 3 \| completed 1/)
  assert.match(payload.previousWeek.summary ?? '', /Training is still in progress\./)

  state = reduceInlineWorkoutReviewState(state, { type: 'setWorkoutCompletionStatus', workoutId: 'run-easy', value: 'completed' })
  assertCounts(state, { ...partialCounts, 'completed-workouts': '1', 'partial-workouts': '1' })
  state = reduceWorkoutReviewState(state, { type: 'setWorkoutCompletionStatus', workoutId: 'run-easy', value: 'skipped' })
  assertCounts(state, { ...partialCounts, 'partial-workouts': '1', 'skipped-workouts': '1' })
  state = startWorkoutReviewLog(state, 'mobility-deleted')
  assertCounts(state, {
    'total-workouts': '3',
    'completed-workouts': '1',
    'partial-workouts': '1',
    'skipped-workouts': '1',
    'unlogged-workouts': '0',
  })
})

test('weekly metric field overrides and custom rows survive live counts and in-flight save merges', () => {
  const customMetric = {
    id: 'custom-distance',
    label: 'Distance goal',
    planned: '20 km',
    completed: '12 km',
    note: 'Keep this independently entered metric.',
  }
  let state = createThreeWorkoutState()
  state = {
    ...state,
    weeklyReview: {
      ...state.weeklyReview,
      metrics: [...state.weeklyReview.metrics, customMetric],
    },
  }
  state = reduceWorkoutReviewState(state, { type: 'setWeeklyMetricField', metricId: 'partial-workouts', field: 'completed', value: '0' })
  state = reduceWorkoutReviewState(state, { type: 'setWeeklyMetricField', metricId: 'completed-workouts', field: 'planned', value: '' })
  state = reduceWorkoutReviewState(state, { type: 'setWeeklyMetricField', metricId: 'completed-workouts', field: 'note', value: 'Count only finished workouts.' })
  assert.deepEqual(getDirtyWorkoutReviewIds(state), [])
  state = editInlineStep(state, 'strength-main', 'notes', 'Strength is underway.')
  state = reduceInlineWorkoutReviewState(state, { type: 'setWorkoutNotes', workoutId: 'run-easy', value: 'Run is underway.' })
  const submitted = state
  const logs = buildWorkoutReviewLogs(submitted)

  state = reduceWorkoutReviewState(state, { type: 'setWeeklyMetricField', metricId: 'total-workouts', field: 'planned', value: '5' })
  state = reduceWorkoutReviewState(state, { type: 'setWeeklyReviewField', field: 'nextFocus', value: 'Weekly feedback entered during save.' })
  state = reduceInlineWorkoutReviewState(state, { type: 'setWorkoutCompletionStatus', workoutId: 'run-easy', value: 'completed' })
  const current = state
  const merged = mergeSavedWorkoutReviewLogs(current, submitted, logs, ['run-easy', 'strength-lift'])
  assert.strictEqual(merged.weeklyReview, current.weeklyReview)
  assert.strictEqual(merged.workouts[0]?.draft, current.workouts[0]?.draft)
  assert.deepEqual(getDirtyWorkoutReviewIds(merged), ['run-easy'])
  assert.strictEqual(merged.weeklyReview.metrics.find(metric => metric.id === customMetric.id), customMetric)

  const screen = createWeeklyReviewScreenProps(merged)
  const payload = buildWorkoutReviewPayload(merged)
  assert.equal(payload.summary.completed, 1)
  assert.equal(payload.summary.partial, 1)
  assert.deepEqual(screen.summary, payload.summary)
  for (const metrics of [merged.weeklyReview.metrics, screen.metrics]) {
    assert.deepEqual(metrics.find(metric => metric.id === 'partial-workouts'), {
      id: 'partial-workouts', label: 'Partial workouts', planned: '3', completed: '0', note: '',
    })
    assert.deepEqual(metrics.find(metric => metric.id === 'completed-workouts'), {
      id: 'completed-workouts', label: 'Completed workouts', planned: '', completed: '1', note: 'Count only finished workouts.',
    })
    assert.equal(metrics.find(metric => metric.id === 'total-workouts')?.planned, '5')
    assert.equal(metrics.find(metric => metric.id === 'total-workouts')?.completed, '2')
    assert.equal(metrics.find(metric => metric.id === 'unlogged-workouts')?.completed, '1')
    assert.strictEqual(metrics.find(metric => metric.id === customMetric.id), customMetric)
  }
  assert.equal(payload.review.metrics.find(metric => metric.id === 'partial-workouts')?.completed, '0')
  assert.deepEqual(payload.review.metrics.find(metric => metric.id === 'completed-workouts'), {
    id: 'completed-workouts', label: 'Completed workouts', completed: '1', note: 'Count only finished workouts.',
  })
  assert.equal(payload.review.metrics.find(metric => metric.id === 'total-workouts')?.planned, '5')
  assert.deepEqual(payload.review.metrics.find(metric => metric.id === customMetric.id), customMetric)
  assert.equal(payload.review.nextFocus, 'Weekly feedback entered during save.')
  assert.match(payload.previousWeek.summary ?? '', /Partial workouts \| planned 3 \| completed 0/)
  assert.match(payload.previousWeek.summary ?? '', /Completed workouts \| completed 1 \| note Count only finished workouts\./)

  const invalid = reduceWorkoutReviewState(merged, { type: 'setWeeklyMetricField', metricId: 'partial-workouts', field: 'completed', value: 'x'.repeat(121) })
  assert.ok(validateWorkoutReviewState(invalid).weeklyReviewIssues.some(issue => issue.field === 'partial-workouts.completed'))
  assert.throws(() => buildWorkoutReviewPayload(invalid), /120 characters or fewer/)
})

test('inline edits and saved merges reject missing workouts and inconsistent saved logs', () => {
  const initial = createInlineState()
  const submitted = editInlineStep(initial, 'strength-main', 'notes', 'Started.')
  const saved = buildWorkoutReviewLog(submitted, 'strength-lift')
  const missingWorkout = { name: 'WorkoutReviewError', code: 'missing-workout', path: 'workoutId' }
  assert.throws(() => reduceInlineWorkoutReviewState(initial, { type: 'setWorkoutNotes', workoutId: 'unknown-workout', value: 'Wrong card.' }), missingWorkout)
  assert.throws(() => editInlineStep(initial, 'unknown-step', 'notes', 'Wrong step.'), { name: 'WorkoutReviewError', code: 'invalid-workout-log' })
  assert.throws(() => mergeSavedWorkoutReviewLogs(submitted, submitted, [saved], ['unknown-workout']), missingWorkout)
  assert.throws(() => mergeSavedWorkoutReviewLogs({ ...submitted, workouts: submitted.workouts.slice(0, 1) }, submitted, [saved], ['strength-lift']), missingWorkout)
  assert.throws(() => mergeSavedWorkoutReviewLogs(submitted, { ...submitted, workouts: submitted.workouts.slice(0, 1) }, [saved], ['strength-lift']), missingWorkout)
  assert.throws(() => mergeSavedWorkoutReviewLogs(submitted, initial, [saved], ['strength-lift']), { name: 'WorkoutReviewError', code: 'missing-log' })
  assert.throws(() => mergeSavedWorkoutReviewLogs(submitted, submitted, [], ['strength-lift']), { name: 'WorkoutReviewError', code: 'missing-log' })
  assert.throws(() => mergeSavedWorkoutReviewLogs(submitted, submitted, [{ ...saved, id: 'wrong-log' }], ['strength-lift']), { name: 'WorkoutReviewError', code: 'missing-log' })
  for (const wrongLog of [
    { ...saved, workoutId: 'unknown-workout' },
    { ...saved, workoutId: 'run-easy' },
    { ...saved, weekPlanId: 'wrong-week' },
    { ...saved, athleteId: 'wrong-athlete' },
  ]) {
    assert.throws(() => mergeSavedWorkoutReviewLogs(submitted, submitted, [wrongLog], ['strength-lift']), WorkoutReviewError)
  }
  assert.throws(() => mergeSavedWorkoutReviewLogs(submitted, { ...submitted, weekPlan: { ...submitted.weekPlan, id: 'other-week' } }, [saved], ['strength-lift']), { name: 'WorkoutReviewError', code: 'invalid-review' })
  assert.strictEqual(mergeSavedWorkoutReviewLogs(submitted, submitted, [], []), submitted)
  assert.deepEqual(initial.sourceLogs, [])
  assert.equal(initial.workouts[1]?.isLogged, false)
})
