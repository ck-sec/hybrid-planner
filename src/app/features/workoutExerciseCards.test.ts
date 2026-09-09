/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Workout, WorkoutLogStep, WorkoutStep, WorkoutStepTarget } from '../../domain/contracts.ts'
import { parseLocalDate } from '../../domain/local-date.ts'
import { buildWorkoutReviewLog, createWorkoutLogScreenProps, createWorkoutReviewState } from '../state/review.ts'
import { InlineWorkoutLog } from './inlineWorkoutLog.ts'
import type { WorkoutLogStepResultDraft } from './models.ts'
import { WorkoutExerciseCards } from './workoutExerciseCards.ts'
import { WorkoutLogScreen } from './workoutLogScreen.ts'

function workout(main: WorkoutStep[], overrides: Partial<Workout> = {}): Workout {
  return {
    version: 1,
    id: 'strength',
    athleteId: 'athlete',
    weekPlanId: 'week',
    scheduledDate: parseLocalDate('2026-09-07'),
    category: 'strength',
    source: 'ai',
    title: 'Strength',
    purpose: 'Practice the main lifts.',
    expectedDurationMin: 45,
    warmup: [],
    main,
    cooldown: [],
    ...overrides,
  }
}

function result(id: string, actualResult = ''): WorkoutLogStepResultDraft {
  return { id, title: id, status: 'done', actualResult, effort: '', notes: '' }
}

function render(prescription: Workout, stepResults: WorkoutLogStepResultDraft[] = [], recordedSteps?: readonly WorkoutLogStep[]) {
  return renderToStaticMarkup(createElement(WorkoutExerciseCards, {
    idPrefix: 'test',
    workout: prescription,
    stepResults,
    recordedSteps,
    onStepResultChange() {},
  }))
}

const loadCases: [WorkoutStepTarget['loadBasis'], string, string][] = [
  ['per_implement', 'Weight (kg each)', '20 kg each'],
  ['total', 'Weight (kg total)', '20 kg total'],
  ['added', 'Weight (added kg)', '20 kg added'],
  ['assistance', 'Weight (assistance kg)', '20 kg assistance'],
  [undefined, 'Weight (kg)', '20 kg'],
]

for (const [loadBasis, label, planned] of loadCases) {
  test(`planned and actual weight labels preserve ${loadBasis ?? 'legacy unspecified'} basis`, () => {
    const html = render(workout([{ id: 'lift', title: 'Lift', target: { sets: 3, reps: 8, loadKg: 20, loadBasis } }]), [
      result('lift', 'loadKg: 12.5\nreps: 8'),
    ])
    assert.ok(html.includes(planned))
    assert.ok(html.includes(`>${label}</label>`))
    assert.match(html, /id="test-main-lift-loadKg"[^>]*value="12.5"/)
    if (!loadBasis) assert.doesNotMatch(html, /kg each|kg total|kg added|kg assistance/)
  })
}

for (const [repBasis, planned, label] of [
  ['per_side', '8 reps each side', 'Reps each side'],
  ['total', '8 reps total', 'Reps (total)'],
  [undefined, '8 reps', 'Reps'],
] as const) {
  test(`rep targets and actual labels preserve ${repBasis ?? 'legacy unspecified'} basis`, () => {
    const html = render(workout([{ id: 'split-squat', title: 'Split squat', target: { reps: 8, repBasis } }]), [
      result('split-squat', 'reps: 6'),
    ])
    assert.ok(html.includes(planned))
    assert.ok(html.includes(`>${label}</label>`))
    assert.match(html, /id="test-main-split-squat-reps"[^>]*value="6"/)
    if (!repBasis) assert.doesNotMatch(html, /reps each side|reps total|Reps \(total\)/)
  })
}

test('estimated block time is separate from work-duration targets and does not create a logging field', () => {
  const html = render(workout([{
    id: 'carry',
    title: 'Carry',
    target: { sets: 3, seconds: 45, minutes: 2, loadKg: 16, loadBasis: 'per_implement' },
    estimatedTotalMin: 12,
  }]))
  assert.match(html, /45 sec work/)
  assert.match(html, /2 min work/)
  assert.match(html, /<p class="workout-exercise__block-time"><strong>Estimated block time: <\/strong>12 min<\/p>/)
  assert.doesNotMatch(html, /<input[^>]*estimatedTotalMin/)
  assert.doesNotMatch(render(workout([{ id: 'lift', title: 'Lift' }])), /Estimated block time/)
})

test('warm-up and cool-down stay instruction-only while main exercises keep logging controls', () => {
  const html = render(workout([{ id: 'lift', title: 'Main lift' }], {
    warmup: [{ id: 'prep', title: 'Prepare', detail: 'Move gently.', target: { minutes: 5 }, estimatedTotalMin: 6 }],
    cooldown: [{ id: 'ease', title: 'Ease down', detail: 'Walk and breathe.', target: { minutes: 3 } }],
  }))
  assert.match(html, /Move gently./)
  assert.match(html, /Walk and breathe./)
  assert.match(html, /Estimated block time:/)
  assert.doesNotMatch(html, /<(?:input|textarea|select)[^>]*id="test-(?:warmup|cooldown)-/)
  assert.match(html, /<input[^>]*id="test-main-lift-loadKg"/)
  assert.match(html, /<textarea[^>]*id="test-main-lift-notes"/)
  assert.match(html, /<select[^>]*id="test-main-lift-status"/)
})

test('historical warm-up results remain visible with basis labels but no new logging controls', () => {
  const html = render(workout([], {
    warmup: [{
      id: 'prep',
      title: 'Warm-up lunge',
      target: { reps: 5, repBasis: 'per_side', loadKg: 4, loadBasis: 'per_implement' },
    }],
  }), [result('prep', 'reps: 5\nloadKg: 4')])
  assert.match(html, /Previously recorded/)
  assert.match(html, /Reps each side: 5/)
  assert.match(html, /Weight \(kg each\): 4/)
  assert.doesNotMatch(html, /<input|<select|<textarea/)
})

test('missing workout prescriptions retain legacy actual labels and values', () => {
  const html = renderToStaticMarkup(createElement(WorkoutExerciseCards, {
    idPrefix: 'legacy',
    stepResults: [result('lift', 'loadKg: 30\nreps: 10')],
    onStepResultChange() {},
  }))
  assert.match(html, />Weight \(kg\)<\/label>/)
  assert.match(html, />Reps<\/label>/)
  assert.match(html, /id="legacy-exercises-lift-loadKg"[^>]*value="30"/)
  assert.doesNotMatch(html, /kg each|kg total|Reps each side|Estimated block time/)
})

test('saved actual conventions remain distinct after changing prescribed weight and rep bases', () => {
  const html = render(workout([{
    id: 'lift', title: 'Lift', target: { loadKg: 40, loadBasis: 'total', reps: 16, repBasis: 'total' },
  }]), [result('lift', 'loadKg: 20\nreps: 8')], [
    { stepId: 'lift', loadKg: 20, loadBasis: 'per_implement', completedReps: 8, repBasis: 'per_side' },
  ])
  assert.match(html, /40 kg total/)
  assert.match(html, /16 reps total/)
  assert.match(html, />Weight \(kg each\)<\/label>/)
  assert.match(html, />Reps each side<\/label>/)
  assert.match(html, /id="test-main-lift-loadKg"[^>]*value="20"/)
  assert.match(html, /id="test-main-lift-reps"[^>]*value="8"/)
})

test('legacy actuals do not inherit newly specified prescription conventions', () => {
  const html = render(workout([{
    id: 'lift', title: 'Lift', target: { loadBasis: 'per_implement', repBasis: 'per_side' },
  }]), [result('lift', 'loadKg: 20\nreps: 8')], [
    { stepId: 'lift', loadKg: 20, completedReps: 8 },
  ])
  assert.match(html, />Weight \(kg\)<\/label>/)
  assert.match(html, />Reps<\/label>/)
  assert.doesNotMatch(html, /kg each|Reps each side/)
})

test('historical guidance uses saved conventions rather than edited targets', () => {
  const html = render(workout([], {
    warmup: [{ id: 'prep', title: 'Warm-up', target: { loadKg: 8, loadBasis: 'total' } }],
  }), [result('prep', 'loadKg: 4')], [
    { stepId: 'prep', loadKg: 4, loadBasis: 'per_implement' },
  ])
  assert.match(html, /8 kg total/)
  assert.match(html, /Weight \(kg each\): 4/)
  assert.doesNotMatch(html, /<input|<select|<textarea/)
})

test('review adapters forward saved conventions through both logging screens without converting values', () => {
  const prescription = workout([{
    id: 'lift', title: 'Lift', target: { loadKg: 40, loadBasis: 'total', reps: 16, repBasis: 'total' },
  }])
  const review = createWorkoutReviewState({
    weekPlan: {
      version: 1, id: 'week', athleteId: 'athlete', weekStart: prescription.scheduledDate,
      title: 'Week', goal: 'Practice', workouts: [prescription],
    },
    workoutLogs: [{
      version: 1, id: 'log', athleteId: 'athlete', weekPlanId: 'week', workoutId: prescription.id,
      loggedOn: prescription.scheduledDate, outcome: 'completed',
      steps: [{ stepId: 'lift', loadKg: 20, loadBasis: 'per_implement', completedReps: 8, repBasis: 'per_side' }],
    }],
  })
  const log = createWorkoutLogScreenProps(review, prescription.id)
  for (const component of [
    createElement(WorkoutLogScreen, log),
    createElement(InlineWorkoutLog, { workout: prescription, log, hasLog: true, dirty: false, onSave() {} }),
  ]) {
    const html = renderToStaticMarkup(component)
    assert.match(html, />Weight \(kg each\)<\/label>/)
    assert.match(html, />Reps each side<\/label>/)
    assert.doesNotMatch(html, />Weight \(kg total\)<\/label>|>Reps \(total\)<\/label>/)
  }
  const saved = buildWorkoutReviewLog(review, prescription.id).steps[0]
  assert.ok(saved)
  assert.equal(saved.loadKg, 20)
  assert.equal(saved.loadBasis, 'per_implement')
  assert.equal(saved.completedReps, 8)
  assert.equal(saved.repBasis, 'per_side')
})
