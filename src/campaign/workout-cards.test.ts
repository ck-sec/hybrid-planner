import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { DEFAULT_LIBRARY } from '../../engine/library.ts'
import { recommendationForExercise } from '../../engine/recommendations.ts'
import { RESOURCE_CATALOG, parseResources } from './equipment.ts'
import type { ResourceId } from './equipment.ts'
import {
  MAX_WORKOUT_CARDS, WORKOUT_CARD_LIMITS, parseWorkoutCards, saveWorkoutCard,
} from './workout-cards.ts'
import type { WorkoutCard } from './workout-cards.ts'

function card(change: Partial<WorkoutCard> = {}): WorkoutCard {
  return {
    id: 'my-note', exerciseId: 'bodyweight-squat', title: 'My movement note',
    purpose: '', instructions: '', cues: '', resources: [], source: 'user', status: 'draft',
    ...change,
  }
}

test('concurrent editors cannot overwrite a newer saved card or resurrect a removed card', () => {
  const original = card()
  const first = saveWorkoutCard([original], { ...original, title: 'Saved title' }, original)
  const snapshot = structuredClone(first)
  assert.throws(() => saveWorkoutCard(first, { ...original, instructions: 'Stale editor' }, original), /changed while the editor was open/)
  assert.deepEqual(first, snapshot)
  assert.throws(() => saveWorkoutCard([], { ...original, instructions: 'Deleted elsewhere' }, original), /changed/)
  assert.throws(() => saveWorkoutCard(first, original, null), /changed/)
  assert.equal(saveWorkoutCard(first, { ...first[0], instructions: 'Reopened editor' }, first[0])[0].title, 'Saved title')
  const unrelated = card({ id: 'another-note' })
  assert.deepEqual(saveWorkoutCard([original, unrelated], { ...original, title: 'Updated' }, original)[1], unrelated)
})

test('reference cards have exactly the notebook schema and clone every mutable value', () => {
  const input = [card()]
  const before = structuredClone(input)
  Object.freeze(input[0].resources)
  Object.freeze(input[0])
  Object.freeze(input)
  const output = parseWorkoutCards(input)
  assert.deepEqual(output, before)
  assert.notEqual(output, input)
  assert.notEqual(output[0], input[0])
  assert.notEqual(output[0].resources, input[0].resources)
  output[0].title = 'Another note'
  assert.deepEqual(input, before)
  assert.deepEqual(parseWorkoutCards([]), [])
})

test('reference card parser rejects missing, extra, prescription and prototype fields', () => {
  for (const key of Object.keys(card())) {
    const incomplete: Record<string, unknown> = { ...card() }
    delete incomplete[key]
    assert.throws(() => parseWorkoutCards([incomplete]), /exactly/i, key)
  }
  for (const key of [
    'sets', 'reps', 'weight', 'load', 'rpe', 'duration', 'durationMin', 'quantity',
    'placement', 'day', 'date', 'time', 'startAt', 'cost', 'coefficients', 'exercise',
    'approved', 'safe', '__proto__', 'constructor', 'prototype',
  ]) {
    assert.throws(() => parseWorkoutCards([{ ...card(), [key]: 1 }]), /extra fields/i, key)
  }
  const inherited = Object.assign(Object.create({ sets: 50 }), card())
  assert.throws(() => parseWorkoutCards([inherited]), /exactly/i)
  const symbol = { ...card(), [Symbol('extra')]: true }
  assert.throws(() => parseWorkoutCards([symbol]), /exactly/i)
  const getter = { ...card() }
  Object.defineProperty(getter, 'title', { enumerable: true, get: () => assert.fail('Do not execute imported accessors') })
  assert.throws(() => parseWorkoutCards([getter]), /exactly/i)
  assert.deepEqual(parseWorkoutCards([Object.assign(Object.create(null), card())]), [card()])
})

test('reference card IDs are bounded, unique slugs rather than object keys or paths', () => {
  for (const id of ['', ' ', '__proto__', 'constructor', 'prototype', 'Upper-case', '../note', 'a/b', 'a\\b', 'a_b', '-note', 'note-', 'two--hyphens', 'a'.repeat(65)]) {
    assert.throws(() => parseWorkoutCards([card({ id })]), /slug|reserved/i, id)
  }
  assert.equal(parseWorkoutCards([card({ id: 'a'.repeat(WORKOUT_CARD_LIMITS.id) })])[0].id.length, WORKOUT_CARD_LIMITS.id)
  assert.throws(() => parseWorkoutCards([card(), card()]), /unique/i)
})

test('reference notebook rejects invalid containers, sparse entries and excess cards', () => {
  for (const value of [undefined, null, {}, '[]', 0, [null], [true], [[]], Array(1)]) {
    assert.throws(() => parseWorkoutCards(value))
  }
  const polluted = Object.assign([card()], { sets: 100 })
  assert.throws(() => parseWorkoutCards(polluted))
  const accessor = [card()]
  Object.defineProperty(accessor, '0', { get: () => assert.fail('Do not execute imported accessors') })
  assert.throws(() => parseWorkoutCards(accessor))
  const maximum = Array.from({ length: MAX_WORKOUT_CARDS }, (_, index) => card({ id: `note-${index}` }))
  assert.equal(parseWorkoutCards(maximum).length, 24)
  assert.throws(() => parseWorkoutCards([...maximum, card({ id: 'one-too-many' })]), /at most 24/i)
})

test('card text is bounded plain text without HTML, control characters or silent coercion', () => {
  for (const field of ['title', 'purpose', 'instructions', 'cues'] as const) {
    const max = WORKOUT_CARD_LIMITS[field]
    assert.equal(parseWorkoutCards([{ ...card(), [field]: 'x'.repeat(max) }])[0][field].length, max)
    for (const value of [
      'x'.repeat(max + 1), 42, null, {}, ['note'], 'note\u0000',
      '\u007f', '\u0085', '\u202e', '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>', '<b>bold</b>', '<!-- hidden -->', '<svg/onload=alert(1)>',
    ]) {
      assert.throws(() => parseWorkoutCards([{ ...card(), [field]: value }]), /plain text/i, `${field}: ${String(value)}`)
    }
  }
  assert.throws(() => parseWorkoutCards([card({ title: '   ' })]), /plain text/i)
  assert.throws(() => parseWorkoutCards([card({ title: 'Title\nnext' })]), /plain text/i)
  assert.equal(parseWorkoutCards([card({ instructions: 'Setup\nA second paragraph.\r\nAnother line.' })])[0].instructions, 'Setup\nA second paragraph.\r\nAnother line.')
  const text = 'My "quotes", apostrophe\'s & encoded &lt;script&gt; stay text.'
  assert.equal(parseWorkoutCards([card({ instructions: text })])[0].instructions, text)
})

test('only supported non-high-skill exercise identities or null can be linked', () => {
  for (const exercise of DEFAULT_LIBRARY.exercises) {
    let supported = true
    try { recommendationForExercise(exercise.id) } catch { supported = false }
    if (supported && !exercise.highSkill) {
      assert.equal(parseWorkoutCards([card({ exerciseId: exercise.id })])[0].exerciseId, exercise.id)
    } else {
      assert.throws(() => parseWorkoutCards([card({ exerciseId: exercise.id })]), /supported/i)
    }
  }
  for (const exerciseId of ['invented-drill', 'snatch', '__proto__', 'constructor', '', 4, {}, ['push-up']]) {
    assert.throws(() => parseWorkoutCards([{ ...card(), exerciseId }]), /supported/i)
  }
  const idea = card({ exerciseId: null, title: 'Target-lane throwing' })
  assert.deepEqual(parseWorkoutCards([idea]), [idea])
  assert.equal(parseWorkoutCards([card({ title: 'Target-lane throwing' })])[0].exerciseId, 'bodyweight-squat')
})

test('unknown equipment and malformed resource lists cannot enter the notebook', () => {
  for (const resources of [
    undefined, null, 'bodyweight', {}, ['invented-resource'], ['constructor'], ['__proto__'], [1],
    ['rower', 'rower'], Array(1), Array(RESOURCE_CATALOG.length + 1).fill('rower'),
    Object.assign(['rower'], { sets: 100 }), Object.assign(['rower'], { [Symbol('extra')]: 100 }),
  ]) {
    assert.throws(() => parseWorkoutCards([{ ...card(), resources }]))
  }
  const accessor = ['rower']
  Object.defineProperty(accessor, '0', { get: () => assert.fail('Do not execute imported resource accessors') })
  assert.throws(() => parseWorkoutCards([{ ...card(), resources: accessor }]))
  const all = Object.freeze(RESOURCE_CATALOG.map(resource => resource.id))
  const parsed = parseWorkoutCards([{ ...card(), resources: all }])
  assert.deepEqual(parsed[0].resources, parseResources(all))
  assert.notEqual(parsed[0].resources, all)
  assert.equal(all.length, RESOURCE_CATALOG.length)
})

test('AI prose stays a draft; reference claims are rejected rather than normalized', () => {
  const original = card({
    source: 'ai', status: 'draft',
    instructions: 'This text claims to be approved. A schema parser cannot verify this claim.',
  })
  const before = structuredClone(original)
  assert.equal(parseWorkoutCards([original])[0].status, 'draft')
  assert.equal(parseWorkoutCards([original])[0].source, 'ai')
  assert.deepEqual(original, before)
  const edited = { ...parseWorkoutCards([original])[0], title: 'Edited locally' }
  assert.equal(parseWorkoutCards([edited])[0].status, 'draft')
  assert.equal(parseWorkoutCards([edited])[0].source, 'ai')
  const claimed = { ...original, status: 'reference' }
  const claimedBefore = structuredClone(claimed)
  assert.throws(() => parseWorkoutCards([claimed]), /AI-authored cards must remain drafts/i)
  assert.deepEqual(claimed, claimedBefore)
  assert.equal(parseWorkoutCards([card({ status: 'reference' })])[0].status, 'reference')
  for (const [field, value] of [['source', 'engine'], ['source', null], ['status', 'approved'], ['status', null]]) {
    assert.throws(() => parseWorkoutCards([{ ...card(), [String(field)]: value }]))
  }
})

test('schema normalization does not certify, reinterpret or remove prose claims', () => {
  const instructions = 'A note claims "increase to 100 reps" and calls itself safe; neither claim is verified.'
  for (const source of ['user', 'ai'] as const) {
    const parsed = parseWorkoutCards([card({ source, instructions })])[0]
    assert.equal(parsed.instructions, instructions)
    assert.equal(parsed.status, 'draft')
    assert.deepEqual(Object.keys(parsed), Object.keys(card()))
  }
})

test('native notebook renders identity and provenance separately without form or prescription controls', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('A local reference notebook must not contact a model'))
  const directory = new URL('./', import.meta.url).href
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith(directory)) return nextLoad(url, context)
      if (url.endsWith('workout-cards.css')) return { format: 'module', shortCircuit: true, source: '' }
      if (!url.endsWith('.tsx')) return nextLoad(url, context)
      return {
        format: 'module', shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
        }).outputText,
      }
    },
  })
  try {
    const { default: WorkoutCards } = await import('./WorkoutCards.tsx')
    const render = (cards: WorkoutCard[], options: { exerciseId?: string; readOnly?: boolean; resources?: ResourceId[] } = {}) => renderToStaticMarkup(createElement(WorkoutCards, {
      cards, resources: [], onChange() { assert.fail('Rendering must not change cards') }, ...options,
    }))
    await t.test('custom title cannot replace the canonical exercise identity', () => {
      const html = render([card({ title: 'My custom nickname' })])
      assert.match(html, /My custom nickname/)
      assert.match(html, /Catalog exercise/)
      assert.match(html, /Bodyweight squat/)
      assert.match(html, /User/)
      assert.match(html, /Draft/)
      assert.match(html, /not engine-approved instructions/)
      assert.match(html, /do not add work/)
      assert.match(html, /Edit/)
      assert.match(html, /Delete/)
      assert.match(html, /Add note or drill/)
      assert.doesNotMatch(html, /<form|<input|<textarea|<select|dangerouslySetInnerHTML/)
      for (const button of html.matchAll(/<button\b[^>]*>/g)) assert.match(button[0], /type="button"/)
    })
    await t.test('AI reference claims are rendered as drafts and sport ideas remain unscheduled', () => {
      const html = render([card({ exerciseId: null, title: 'Target-lane throwing', source: 'ai', status: 'reference' })])
      assert.match(html, /Unscheduled drill idea/)
      assert.match(html, /AI/)
      assert.match(html, /Draft/)
      assert.doesNotMatch(html, /Personal reference|Approved|Schedule drill|Use drill/)
    })
    await t.test('plain text never becomes an executable link or markup', () => {
      const html = render([card({ title: 'Notes &lt;script&gt;', instructions: 'javascript:alert("not a link") & <script>alert(1)</script>' })])
      assert.match(html, /&amp;lt;script&amp;gt;/)
      assert.match(html, /&lt;script&gt;/)
      assert.doesNotMatch(html, /<script|href="javascript:|<img/)
    })
    await t.test('filtering does not expose unrelated cards and read-only removes editing controls', () => {
      const cards = [card(), card({ id: 'another-note', exerciseId: 'push-up', title: 'Other exercise note' })]
      const before = structuredClone(cards)
      const html = render(cards, { exerciseId: 'bodyweight-squat', readOnly: true })
      assert.match(html, /My movement note/)
      assert.doesNotMatch(html, /Other exercise note|<button|<input|<textarea|<select/)
      assert.deepEqual(cards, before)
    })
    await t.test('missing explicit and exercise-specific resources are named, without hiding the draft', () => {
      const note = card({ exerciseId: 'bench-press', resources: ['rower', 'cones'] })
      const html = render([note], { resources: ['barbell', 'rower'] })
      assert.match(html, /Bench press/)
      assert.match(html, /Unavailable for use/)
      assert.match(html, /Missing: Bench, Cones/)
      assert.match(html, /keep and edit this as a draft/)
      assert.match(html, /Edit/)
      assert.doesNotMatch(html, /Use note|Use drill|Add to plan/)
      assert.doesNotMatch(render([note], { resources: ['barbell', 'bench', 'rower', 'cones'] }), /Unavailable for use/)
      assert.match(render([card({ exerciseId: 'pull-up' })]), /Missing: Pull-up bar/)
      assert.match(render([card({ exerciseId: 'back-squat' })]), /Missing: Barbell &amp; plates, Squat rack/)
    })
  } finally {
    hooks.deregister()
  }
})
