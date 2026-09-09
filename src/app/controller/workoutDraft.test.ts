import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseWorkout } from '../../domain/contracts.ts'
import type { WorkoutStepDraft } from '../features/models.ts'
import { appReducer, createInitialAppState } from './state.ts'
import { buildWorkoutDefinition, createBlankWorkoutEditorState, workoutToEditorState } from './workoutDraft.ts'

const workout = parseWorkout({
  version: 1,
  id: 'strength-session',
  athleteId: 'athlete-local',
  weekPlanId: 'week-local',
  scheduledDate: '2026-09-09',
  category: 'strength',
  source: 'manual',
  title: 'Strength session',
  purpose: 'Maintain strength.',
  expectedDurationMin: 45,
  warmup: [],
  main: [{
    id: 'squat-step',
    title: 'Squat',
    equipment: ['Dumbbells'],
    target: { sets: 3, reps: 8, minutes: 2, loadKg: 20, effort: 'steady', loadBasis: 'per_implement', repBasis: 'per_side' },
    estimatedTotalMin: 12.5,
  }],
  cooldown: [],
})

function editStep(field: Exclude<keyof WorkoutStepDraft, 'id' | 'title'>, value: string) {
  const state = appReducer({
    ...createInitialAppState(),
    editor: { mode: 'edit', existing: workout, state: workoutToEditorState(workout), messages: [] },
  }, { type: 'editorStepField', sectionId: 'main', stepId: 'squat-step', field, value })
  assert.ok(state.editor)
  return state.editor.state
}

test('step editor hydrates conventions and fractional block total separately from work duration', () => {
  const draft = workoutToEditorState(workout).sections[1]!.steps[0]!
  assert.equal(draft.loadBasis, 'per_implement')
  assert.equal(draft.repBasis, 'per_side')
  assert.equal(draft.duration, '2 min')
  assert.equal(draft.estimatedTotalMin, '12.5')
  const blank = createBlankWorkoutEditorState(workout.scheduledDate).sections[1]!.steps[0]!
  assert.equal(blank.loadBasis, '')
  assert.equal(blank.repBasis, '')
  assert.equal(blank.estimatedTotalMin, '')
})

test('legacy step drafts with omitted metadata preserve original conventions and block total', () => {
  const editor = workoutToEditorState(workout)
  const legacy = {
    ...editor,
    sections: editor.sections.map(section => ({
      ...section,
      steps: section.steps.map(({ loadBasis: _load, repBasis: _rep, estimatedTotalMin: _total, ...step }) => step),
    })),
  }
  const result = buildWorkoutDefinition(legacy, { existing: workout })
  assert.ok(result.ok)
  assert.deepEqual(parseWorkout({ ...workout, ...result.definition }).main[0], workout.main[0])
})

test('explicit blank metadata clears it without changing numeric load or work duration', () => {
  const editor = workoutToEditorState(workout)
  const cleared = {
    ...editor,
    sections: editor.sections.map(section => ({
      ...section,
      steps: section.steps.map(step => ({ ...step, loadBasis: '' as const, repBasis: '' as const, estimatedTotalMin: '' })),
    })),
  }
  const result = buildWorkoutDefinition(cleared, { existing: workout })
  assert.ok(result.ok)
  const step = result.definition.main[0]!
  assert.equal(Object.hasOwn(step, 'estimatedTotalMin'), false)
  assert.equal(Object.hasOwn(step.target!, 'loadBasis'), false)
  assert.equal(Object.hasOwn(step.target!, 'repBasis'), false)
  assert.equal(step.target!.loadKg, 20)
  assert.equal(step.target!.minutes, 2)
  assert.equal(step.target!.sets, 3)
  assert.equal(step.target!.reps, 8)
  assert.deepEqual(step.equipment, ['Dumbbells'])
})

test('explicit convention changes never convert existing kilograms', () => {
  for (const value of ['total', 'per_implement', 'added', 'assistance']) {
    const result = buildWorkoutDefinition(editStep('loadBasis', value), { existing: workout })
    assert.ok(result.ok)
    assert.equal(result.definition.main[0]!.target!.loadBasis, value)
    assert.equal(result.definition.main[0]!.target!.loadKg, 20)
    assert.equal(result.definition.main[0]!.target!.repBasis, 'per_side')
  }
  const result = buildWorkoutDefinition(editStep('repBasis', 'total'), { existing: workout })
  assert.ok(result.ok)
  assert.equal(result.definition.main[0]!.target!.repBasis, 'total')
  assert.equal(result.definition.main[0]!.target!.reps, 8)
})

test('new steps can carry metadata-only targets and never infer numeric loads', () => {
  const blank = createBlankWorkoutEditorState(workout.scheduledDate)
  const editor = {
    ...blank,
    draft: { ...blank.draft, workoutTitle: 'New session', purpose: 'Practice movements.' },
    sections: blank.sections.map(section => ({
      ...section,
      steps: section.steps.map(step => ({
        ...step, title: 'Bodyweight step', loadBasis: 'added' as const, repBasis: 'per_side' as const, estimatedTotalMin: '6.5',
      })),
    })),
  }
  const result = buildWorkoutDefinition(editor)
  assert.ok(result.ok)
  assert.deepEqual(result.definition.main[0]!.target, { loadBasis: 'added', repBasis: 'per_side' })
  assert.equal(result.definition.main[0]!.estimatedTotalMin, 6.5)
  assert.doesNotThrow(() => parseWorkout({ ...workout, ...result.definition }))
})

test('block total editing accepts the domain range without changing work duration', () => {
  for (const [input, expected] of [['0.1', 0.1], ['.5', 0.5], [' 12.5 ', 12.5], ['1440', 1440]] as const) {
    const result = buildWorkoutDefinition(editStep('estimatedTotalMin', input), { existing: workout })
    assert.ok(result.ok)
    assert.equal(result.definition.main[0]!.estimatedTotalMin, expected)
    assert.equal(result.definition.main[0]!.target!.minutes, 2)
    assert.equal(result.definition.main[0]!.target!.loadKg, 20)
  }
})

test('invalid advanced step fields surface the field and step instead of silently dropping them', () => {
  const invalidFields = [
    ['loadBasis', 'each', /Load basis: Expected/],
    ['repBasis', 'each', /Rep basis: Expected/],
    ...['0', '-1', '0.05', '1440.1', 'NaN', 'Infinity', '12 minutes', 'bad']
      .map(value => ['estimatedTotalMin', value, /Estimated block total/] as const),
  ] as const
  for (const [field, value, expected] of invalidFields) {
    const result = buildWorkoutDefinition(editStep(field, value), { existing: workout })
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('Invalid metadata must not produce a workout.')
    const issue = result.messages.find(message => message.id === 'workout-main-squat-step')
    assert.ok(issue)
    assert.match(issue.text, /Main: "Squat"/)
    assert.match(issue.text, expected)
  }
})

test('untitled advanced metadata cannot be silently discarded from an otherwise valid session', () => {
  const editor = workoutToEditorState(workout)
  const result = buildWorkoutDefinition({
    ...editor,
    sections: editor.sections.map(section => section.id === 'main' ? {
      ...section,
      steps: [...section.steps, { ...section.steps[0]!, id: 'untitled-step', title: '', estimatedTotalMin: '10' }],
    } : section),
  }, { existing: workout })
  assert.equal(result.ok, false)
  if (result.ok) throw new Error('An untitled step with metadata must not be dropped.')
  assert.ok(result.messages.some(message => message.id === 'workout-step-title'))
})
