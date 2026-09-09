import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseWeekPlan, parseWorkout } from '../src/domain/contracts.ts'
import { buildWorkoutReviewLog, createWorkoutLogScreenProps, createWorkoutReviewState, reduceInlineWorkoutReviewState } from '../src/app/state/review.ts'
import { InlineWorkoutLog } from '../src/app/features/inlineWorkoutLog.ts'
import { WorkoutLogScreen } from '../src/app/features/workoutLogScreen.ts'
import { JsonHandoffScreen, type JsonHandoffScreenProps } from '../src/app/features/jsonHandoffScreen.ts'

const noop = () => undefined
const workout = parseWorkout({
  version: 1, id: 'lift-a', athleteId: 'athlete', weekPlanId: 'week',
  scheduledDate: '2026-09-07', category: 'strength', source: 'ai',
  title: 'Strength A', purpose: 'Build lower-body strength.', expectedDurationMin: 45,
  warmup: [{ id: 'warm', title: 'Warm-up squat', target: { sets: 1, reps: 10, loadKg: 0 } }],
  main: [{ id: 'squat', title: 'Back squat', detail: 'Controlled depth. Rest 120 seconds.', target: { sets: 3, reps: 5, loadKg: 60 } }],
  cooldown: [{ id: 'cool', title: 'Hip mobility', target: { minutes: 5 } }],
})
const week = parseWeekPlan({
  version: 1, id: 'week', athleteId: 'athlete', weekStart: '2026-09-07',
  title: 'Training week', goal: 'Build strength', workouts: [workout],
})

function exerciseCard(html: string, stepId: string): string {
  const match = [...html.matchAll(/<article[^>]*data-step-id="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)].find(card => card[1] === stepId)
  assert.ok(match?.[2], `Missing exercise card ${stepId}`)
  return match[2]
}

test('workout cards expose instructions for all steps and logging for the main exercises', () => {
  const review = createWorkoutReviewState({ weekPlan: week })
  const log = createWorkoutLogScreenProps(review, workout.id)
  const html = renderToStaticMarkup(createElement(InlineWorkoutLog, { workout, log, hasLog: false, dirty: false, onSave: noop }))
  assert.match(html, /Warm-up/)
  assert.match(html, /Main work/)
  assert.match(html, /Cool-down/)
  assert.match(html, /3 sets.*5 reps.*60 kg/)
  assert.match(html, /0 kg/)
  assert.match(html, /Controlled depth\. Rest 120 seconds\./)
  assert.match(html, /Nothing logged yet/)
  assert.doesNotMatch(html, /Workout details/)
  for (const stepId of ['warm', 'cool']) {
    const card = exerciseCard(html, stepId)
    assert.doesNotMatch(card, /<(input|textarea|select|button)\b/)
    assert.doesNotMatch(card, /You did|More measurements|Exercise status/)
  }
  const main = exerciseCard(html, 'squat').split('<details')[0]!
  assert.match(main, /Weight \(kg\)/)
  assert.match(main, />Comments</)
  assert.match(main, /value="unrecorded" selected/)
  assert.match(main, /inputMode="decimal"/)
  assert.match(html, /id="workout-lift-a-main-squat-loadKg"[^>]*value=""/)
})

test('jogging warm-up and cool-down have no data-entry fields in either logging view', () => {
  const run = parseWorkout({
    ...workout, category: 'aerobic', title: 'Easy run',
    warmup: [{ id: 'warm', title: 'Easy jogging', detail: 'Start gently.', target: { minutes: 5 } }],
    main: [{ id: 'steady', title: 'Steady running', target: { minutes: 25 } }],
    cooldown: [{ id: 'cool', title: 'Walk to cool down', target: { minutes: 5 } }],
  })
  const review = createWorkoutReviewState({ weekPlan: parseWeekPlan({ ...week, workouts: [run] }) })
  const log = createWorkoutLogScreenProps(review, run.id)
  const views = [
    renderToStaticMarkup(createElement(InlineWorkoutLog, { workout: run, log, hasLog: false, dirty: false, onSave: noop })),
    renderToStaticMarkup(createElement(WorkoutLogScreen, log)),
  ]
  for (const html of views) {
    for (const stepId of ['warm', 'cool']) {
      const card = exerciseCard(html, stepId)
      assert.match(card, /5 min/)
      assert.doesNotMatch(card, /<(input|textarea|select|button|details)\b/)
    }
    assert.match(exerciseCard(html, 'warm'), /Easy jogging|Start gently/)
    assert.match(exerciseCard(html, 'steady'), /Time \(min\)|>Comments</)
  }
})

test('existing warm-up and cool-down results remain readable and survive main-exercise edits', () => {
  let review = createWorkoutReviewState({ weekPlan: week })
  for (const [stepId, field, value] of [
    ['warm', 'actualResult', 'loadKg: 0\nsets: 1'],
    ['warm', 'notes', 'Kept the warm-up light.'],
    ['cool', 'actualResult', 'minutes: 5'],
    ['cool', 'notes', 'Breathing settled.'],
  ] as const) {
    review = reduceInlineWorkoutReviewState(review, { type: 'setWorkoutStepResultField', workoutId: workout.id, stepId, field, value })
  }
  const saved = buildWorkoutReviewLog(review, workout.id)
  const restored = createWorkoutReviewState({ weekPlan: week, workoutLogs: [saved] })
  const log = createWorkoutLogScreenProps(restored, workout.id)
  const html = renderToStaticMarkup(createElement(InlineWorkoutLog, { workout, log, hasLog: true, dirty: false, onSave: noop }))
  assert.match(exerciseCard(html, 'warm'), /Previously recorded/)
  assert.match(exerciseCard(html, 'warm'), /Weight \(kg\): 0/)
  assert.match(exerciseCard(html, 'warm'), /Kept the warm-up light\./)
  assert.match(exerciseCard(html, 'cool'), /Breathing settled\./)
  for (const stepId of ['warm', 'cool']) assert.doesNotMatch(exerciseCard(html, stepId), /<(input|textarea|select|button)\b/)
  const edited = reduceInlineWorkoutReviewState(restored, {
    type: 'setWorkoutStepResultField', workoutId: workout.id, stepId: 'squat', field: 'actualResult', value: 'loadKg: 55',
  })
  const updated = buildWorkoutReviewLog(edited, workout.id)
  for (const stepId of ['warm', 'cool']) {
    assert.deepEqual(updated.steps.find(step => step.stepId === stepId), saved.steps.find(step => step.stepId === stepId))
  }
})

test('actuals are separate from prescriptions and restored on their own exercise cards', () => {
  let review = createWorkoutReviewState({ weekPlan: week })
  review = reduceInlineWorkoutReviewState(review, {
    type: 'setWorkoutStepResultField', workoutId: workout.id, stepId: 'squat',
    field: 'actualResult', value: 'loadKg: 42.5\nsets: 2\nreps: 5',
  })
  review = reduceInlineWorkoutReviewState(review, {
    type: 'setWorkoutStepResultField', workoutId: workout.id, stepId: 'squat',
    field: 'notes', value: 'Last set was hard. Keep the same weight next week.',
  })
  const log = createWorkoutLogScreenProps(review, workout.id)
  const html = renderToStaticMarkup(createElement(InlineWorkoutLog, { workout, log, hasLog: true, dirty: true, onSave: noop }))
  assert.match(html, /60 kg/)
  assert.match(html, /id="workout-lift-a-main-squat-loadKg"[^>]*value="42.5"/)
  assert.match(html, /Last set was hard\. Keep the same weight next week\./)
  assert.match(html, /Unsaved changes/)
  assert.match(html, /value="partial" selected/)
  assert.match(html, /aria-label="Save log for Strength A"/)
})

test('workouts can reuse exercise ids without duplicate input ids or label targets', () => {
  const other = parseWorkout({ ...workout, id: 'lift-b', title: 'Strength B' })
  const html = renderToStaticMarkup(createElement('div', null, ...[workout, other].map(item =>
    createElement(InlineWorkoutLog, { key: item.id, workout: item, hasLog: false, dirty: false, onSave: noop }),
  )))
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1])
  assert.equal(new Set(ids).size, ids.length)
  for (const [, target] of html.matchAll(/for="([^"]+)"/g)) assert.ok(ids.includes(target))
})

test('AI approval is explicit, follows the preview, and cannot run without a valid preview', () => {
  const props: JsonHandoffScreenProps = {
    jsonText: '{}', preview: null, issues: [], canApply: false,
    onJsonTextChange: noop, onCopyTemplate: noop, onPreviewImport: noop, onApplyImport: noop, onClear: noop,
  }
  const empty = renderToStaticMarkup(createElement(JsonHandoffScreen, props))
  assert.doesNotMatch(empty, /Looks good - take me to my week/)
  const ready = renderToStaticMarkup(createElement(JsonHandoffScreen, {
    ...props, preview: { title: 'Your week preview', summary: ['One workout'], groups: [] }, canApply: true,
  }))
  assert.ok(ready.indexOf('Looks good - take me to my week') > ready.indexOf('Your week preview'))
  assert.match(ready, /json-handoff__approval/)
  assert.doesNotMatch(ready, /Add to planner/)
})
