/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { Children, createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkoutStepDraft } from './models.ts'
import { WorkoutEditorScreen, type WorkoutEditorScreenProps } from './workoutEditorScreen.ts'

function step(overrides: Partial<WorkoutStepDraft> = {}): WorkoutStepDraft {
  return {
    id: 'lift',
    title: 'Dumbbell lift',
    instructions: 'Keep the movement controlled.',
    target: 'loadKg: 20',
    duration: '45 sec',
    rest: '',
    notes: '',
    ...overrides,
  }
}

function props(
  draftStep = step(),
  overrides: Partial<WorkoutEditorScreenProps> = {},
): WorkoutEditorScreenProps {
  return {
    draft: {
      workoutTitle: 'Strength',
      category: 'strength',
      scheduledDate: '2026-09-07',
      scheduledTime: '',
      purpose: '',
      expectedDuration: '45 min',
      modality: '',
      source: 'manual',
      fixedClubSessionId: '',
      notes: '',
    },
    sections: [{ id: 'main', label: 'Main work', steps: [draftStep] }],
    categoryOptions: [{ value: 'strength', label: 'Strength' }],
    modalityOptions: [{ value: '', label: 'None' }],
    sourceOptions: [{ value: 'manual', label: 'Manual' }],
    onWorkoutFieldChange() {},
    onStepChange() {},
    onAddStep() {},
    onMoveStep() {},
    onRemoveStep() {},
    onSave() {},
    ...overrides,
  }
}

function render(draftStep = step(), overrides: Partial<WorkoutEditorScreenProps> = {}) {
  return renderToStaticMarkup(createElement(WorkoutEditorScreen, props(draftStep, overrides)))
}

test('legacy drafts keep optional conventions folded, unknown, and never required', () => {
  const html = render()
  const details = html.match(/<details[^>]*><summary[^>]*>Optional step details<\/summary>[\s\S]*?<\/details>/)?.[0]
  assert.ok(details)
  assert.doesNotMatch(details, /^<details[^>]*open=/)
  assert.match(details, /<select[^>]*id="lift-load-basis"/)
  assert.match(details, /<select[^>]*id="lift-rep-basis"/)
  assert.match(details, /<input[^>]*id="lift-block-time"[^>]*value=""/)
  assert.equal(details.split('<option value="" selected="">Unknown / not specified</option>').length - 1, 2)
  assert.doesNotMatch(details, /required=/)
  assert.match(html, />Work duration<\/label>/)
  assert.match(details, />Estimated block time \(min\)<\/label>/)
  assert.match(details, /0.1-1440 minutes, including rests and transitions; not just work duration./)
  assert.match(details, /Labels the existing kg value; no weight conversion./)
})

for (const [loadBasis, label] of [
  ['total', 'Weight (kg total)'],
  ['per_implement', 'Weight (kg each)'],
  ['added', 'Weight (added kg)'],
  ['assistance', 'Weight (assistance kg)'],
] as const) {
  test(`manual editor shows the explicit ${loadBasis} weight convention without converting kg`, () => {
    const html = render(step({ loadBasis }))
    assert.ok(html.includes(`<option value="${loadBasis}" selected="">${label}</option>`))
    assert.match(html, /id="lift-target"[^>]*value="loadKg: 20"/)
    assert.match(html, /<details open=""[^>]*><summary[^>]*>Optional step details<\/summary>/)
  })
}

for (const [repBasis, label] of [['total', 'Reps (total)'], ['per_side', 'Reps each side']] as const) {
  test(`manual editor shows ${repBasis} reps and a separate fractional block estimate`, () => {
    const html = render(step({ repBasis, estimatedTotalMin: '12.5' }))
    assert.ok(html.includes(`<option value="${repBasis}" selected="">${label}</option>`))
    assert.match(html, /id="lift-block-time"[^>]*inputMode="decimal"[^>]*value="12.5"/)
    assert.match(html, /id="lift-duration"[^>]*value="45 sec"/)
  })
}

test('explicitly cleared fields render as unknown rather than defaulting to a convention', () => {
  const html = render(step({ loadBasis: '', repBasis: '', estimatedTotalMin: '' }))
  assert.equal(html.split('<option value="" selected="">Unknown / not specified</option>').length - 1, 2)
  assert.doesNotMatch(html, /<option value="(?:total|per_side|per_implement)" selected=/)
})

type ChangeHandler = (event: { target: { value: string } }) => void

function findFieldChange(node: ReactNode, id: string): ChangeHandler | undefined {
  if (!isValidElement<{ children?: ReactNode; id?: string; onChange?: ChangeHandler }>(node)) return undefined
  if (node.props.id === id) return node.props.onChange
  for (const child of Children.toArray(node.props.children)) {
    const callback = findFieldChange(child, id)
    if (callback) return callback
  }
  return undefined
}

test('editing conventions sends only explicit values through the shared step callback', () => {
  const draft = step()
  const changes: Parameters<WorkoutEditorScreenProps['onStepChange']>[] = []
  const tree = WorkoutEditorScreen(props(draft, {
    onStepChange: (...args) => { changes.push(args) },
  }))
  assert.deepEqual(changes, [])
  for (const [id, value] of [
    ['lift-load-basis', 'per_implement'],
    ['lift-rep-basis', 'per_side'],
    ['lift-block-time', '12.5'],
    ['lift-load-basis', ''],
    ['lift-rep-basis', ''],
    ['lift-block-time', ''],
  ] as const) {
    const change = findFieldChange(tree, id)
    assert.ok(change)
    change({ target: { value } })
  }
  assert.deepEqual(changes, [
    ['main', 'lift', 'loadBasis', 'per_implement'],
    ['main', 'lift', 'repBasis', 'per_side'],
    ['main', 'lift', 'estimatedTotalMin', '12.5'],
    ['main', 'lift', 'loadBasis', ''],
    ['main', 'lift', 'repBasis', ''],
    ['main', 'lift', 'estimatedTotalMin', ''],
  ])
  assert.equal(draft.target, 'loadKg: 20')
  assert.equal(draft.loadBasis, undefined)
  assert.equal(draft.repBasis, undefined)
  assert.equal(draft.estimatedTotalMin, undefined)
})

test('block-time input preserves range endpoints and fractional precision', () => {
  for (const estimatedTotalMin of ['0.1', '0.25', '1440']) {
    const html = render(step({ estimatedTotalMin }))
    assert.match(html, new RegExp(`id="lift-block-time"[^>]*type="text"[^>]*inputMode="decimal"[^>]*value="${estimatedTotalMin.replace('.', '\\.')}"`))
    assert.doesNotMatch(html, /Whole minutes|1-720/)
  }
})

test('field validation messages supplied by the draft parser remain visible', () => {
  const html = render(step({ estimatedTotalMin: 'invalid' }), {
    messages: [{ id: 'invalid-estimate', tone: 'error', text: 'Main work step 1: Estimated block time must be a positive number.' }],
  })
  assert.match(html, /Error: Main work step 1: Estimated block time must be a positive number./)
  assert.match(html, /id="lift-block-time"[^>]*value="invalid"/)
})
