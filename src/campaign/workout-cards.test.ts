import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { PROGRAM_LIBRARY_VERSION } from '../../engine/constants.ts'
import { DEFAULT_LIBRARY } from '../../engine/library.ts'
import { SUPPORTED_SPORT_DRILLS } from '../../engine/program.ts'
import type { ProgramConfigV1 } from '../../engine/types.ts'
import { MAX_RESOURCES, RESOURCE_CATALOG, parseResources } from './equipment.ts'
import type { ResourceId } from './equipment.ts'
import {
  MAX_WORKOUT_CARDS, WORKOUT_CARD_LIMITS, moveWorkoutCard, parseWorkoutCards, saveWorkoutCard,
  workoutCardAvailable, workoutCardCatalog, workoutCardMissingResources, workoutCardResourceOptions,
} from './workout-cards.ts'
import type { WorkoutCard } from './workout-cards.ts'

function card(change: Partial<WorkoutCard> = {}): WorkoutCard {
  return {
    id: 'my-note', exerciseId: 'bodyweight-squat', title: 'My movement note',
    purpose: '', instructions: '', cues: '', resources: [], source: 'user', status: 'draft',
    ...change,
  }
}

function customProgram(): ProgramConfigV1 {
  return {
    version: 1, libraryVersion: PROGRAM_LIBRARY_VERSION, goal: 'balanced',
    resources: ['bodyweight', 'floor_space', 'custom:rowing-handles'],
    conditioningBaselines: [],
    customExercises: [{
      version: 1, id: 'custom-supported-handle-row', name: 'Supported handle row',
      profileId: 'controlled_pull', requirements: ['custom:rowing-handles'],
      description: 'A reviewed controlled pulling variation.',
      focus: 'Move without momentum.', why: 'A pulling option using the confirmed handles.',
    }],
  }
}

function throwingProgram(): ProgramConfigV1 {
  return {
    version: 1, libraryVersion: PROGRAM_LIBRARY_VERSION, goal: 'dodgeball',
    resources: ['bodyweight', 'floor_space', 'dodgeball', 'court_space', 'safe_target'], conditioningBaselines: [],
    customSportDrills: [{
      version: 1, id: 'custom-standing-target', name: 'My standing target throw', profileId: 'controlled_target_throw',
      requirements: ['dodgeball', 'court_space', 'safe_target'], description: 'A confirmed familiar throwing drill.',
      focus: 'Aim at the established target.', why: 'Controlled technique within practice.',
    }],
  }
}

test('saved custom throwing identities remain linkable without extending the exercise library or prescribing throws', () => {
  const program = throwingProgram()
  const before = structuredClone(program)
  const linked = card({ exerciseId: 'custom-standing-target', title: 'My target setup' })
  const catalog = workoutCardCatalog(program)
  const entry = catalog.find(item => item.id === linked.exerciseId)!
  assert.deepEqual(entry, {
    id: linked.exerciseId, name: 'My standing target throw', kind: 'sport_drill',
    requirements: ['dodgeball', 'court_space', 'safe_target'],
  })
  assert.ok(Object.isFrozen(catalog))
  assert.ok(Object.isFrozen(entry))
  assert.ok(Object.isFrozen(entry.requirements))
  assert.equal(DEFAULT_LIBRARY.exercises.some(item => item.id === linked.exerciseId), false)
  assert.deepEqual(parseWorkoutCards([linked], program), [linked])
  const saved = saveWorkoutCard([], linked, null, program)
  const edited = saveWorkoutCard(saved, { ...linked, cues: 'Keep the saved setup.' }, linked, program)
  assert.equal(edited[0].exerciseId, linked.exerciseId)
  const other = card({ id: 'other-note' })
  assert.equal(moveWorkoutCard([...edited, other], linked.id, 1, program)[1].exerciseId, linked.exerciseId)
  assert.throws(() => parseWorkoutCards([{ ...linked, throws: 20 }], program), /extra fields/)
  assert.deepEqual(program, before)
})

test('custom throwing links need approved definitions while historical missing equipment stays visible', () => {
  const program = throwingProgram()
  const linked = card({ exerciseId: 'custom-standing-target' })
  for (const missing of [undefined, { ...program, customSportDrills: [] }]) {
    assert.throws(() => parseWorkoutCards([linked], missing), /supported/)
    assert.equal(workoutCardAvailable(linked.exerciseId!, ['dodgeballs', 'court', 'safe_target'], missing), false)
  }
  assert.throws(() => workoutCardCatalog({
    ...program, customSportDrills: [{ ...program.customSportDrills![0], profileId: 'unreviewed_ballistic_throw' }],
  } as never), /profileId/)
  assert.equal(workoutCardAvailable(linked.exerciseId!, ['dodgeballs', 'court', 'safe_target'], program), true)
  const historical: ProgramConfigV1 = { ...program, goal: 'balanced', resources: ['bodyweight', 'floor_space'] }
  assert.equal(workoutCardCatalog(historical).find(item => item.id === linked.exerciseId)?.name, 'My standing target throw')
  assert.deepEqual(parseWorkoutCards([linked], historical), [linked])
  assert.equal(workoutCardAvailable(linked.exerciseId!, ['dodgeballs', 'court', 'safe_target'], historical), false)
  assert.deepEqual(workoutCardMissingResources(linked, [], historical), ['court', 'dodgeballs', 'safe_target'])
  const both = { ...customProgram(), customSportDrills: program.customSportDrills }
  assert.ok(workoutCardCatalog(both).some(item => item.id === 'custom-supported-handle-row'))
  assert.ok(workoutCardCatalog(both).some(item => item.id === linked.exerciseId))
})

test('approved custom exercise links round-trip, save edits, and reorder without becoming unlinked notes', () => {
  const program = customProgram()
  const linked = card({ exerciseId: 'custom-supported-handle-row', resources: ['custom:rowing-handles'] })
  const before = structuredClone(program)
  assert.deepEqual(parseWorkoutCards([linked], program), [linked])
  const saved = saveWorkoutCard([], linked, null, program)
  const edited = saveWorkoutCard(saved, { ...linked, title: 'My handle setup', cues: 'Keep a steady position.' }, linked, program)
  assert.equal(edited[0].exerciseId, linked.exerciseId)
  assert.equal(edited[0].title, 'My handle setup')
  assert.equal(edited.filter(note => note.exerciseId === linked.exerciseId).length, 1)
  const all = saveWorkoutCard(edited, card({ id: 'other-note' }), null, program)
  assert.equal(moveWorkoutCard(all, linked.id, 1, program)[1].exerciseId, linked.exerciseId)
  assert.deepEqual(program, before)
  assert.throws(() => saveWorkoutCard(edited, { ...linked, title: 'Stale editor' }, linked, program), /changed/)
})

test('custom note links require approved definitions on every parse, save and move boundary', () => {
  const program = customProgram()
  const linked = card({ exerciseId: 'custom-supported-handle-row' })
  const other = card({ id: 'other-note' })
  for (const scope of [undefined, { ...program, customExercises: [] }]) {
    assert.throws(() => parseWorkoutCards([linked], scope), /supported/)
    assert.throws(() => saveWorkoutCard([], linked, null, scope), /supported/)
    assert.throws(() => moveWorkoutCard([linked, other], linked.id, 1, scope), /supported/)
  }
  assert.throws(() => parseWorkoutCards([card({ exerciseId: 'custom-unapproved' })], program), /supported/)
  for (const field of ['profileId', 'profile', 'executionStyle', 'sets', 'load', 'durationMin']) {
    assert.throws(() => parseWorkoutCards([{ ...linked, [field]: 1 }], program), /extra fields/)
  }
  const forgedProfile = structuredClone(program)
  forgedProfile.customExercises![0]!.profileId = 'snatch' as never
  assert.throws(() => parseWorkoutCards([linked], forgedProfile), /profileId/)
  assert.throws(() => parseWorkoutCards([], { ...program, version: 2 } as never), /version/)
  assert.throws(() => parseWorkoutCards([linked], {
    ...program, customExercises: [{ ...program.customExercises![0], prescription: { sets: 100 } }],
  } as never), /unknown field/)
})

test('custom catalog identity and exact resource availability survive absent historical gear', () => {
  const program = customProgram()
  const linked = card({ exerciseId: 'custom-supported-handle-row' })
  const entry = workoutCardCatalog(program).find(item => item.id === linked.exerciseId)!
  assert.equal(entry.name, 'Supported handle row')
  assert.deepEqual(entry.requirements, ['custom:rowing-handles'])
  assert.ok(Object.isFrozen(entry.requirements))
  assert.equal(workoutCardCatalog().some(item => item.id === linked.exerciseId), false)
  assert.equal(workoutCardAvailable(linked.exerciseId!, ['custom:rowing-handles']), false)
  assert.equal(workoutCardAvailable(linked.exerciseId!, ['custom:rowing-handles'], program), true)
  assert.deepEqual(workoutCardMissingResources(linked, ['custom:rowing-handles'], program), [])
  const removedGear = { ...program, resources: ['bodyweight', 'floor_space'] as const }
  assert.equal(workoutCardAvailable(linked.exerciseId!, ['custom:rowing-handles'], removedGear), false,
    'A broad UI list cannot override exact confirmed program resources')
  assert.deepEqual(workoutCardMissingResources(linked, [], removedGear), ['custom:rowing-handles'])
  assert.equal(parseWorkoutCards([linked], removedGear)[0].exerciseId, linked.exerciseId)
  assert.equal(saveWorkoutCard([linked], { ...linked, title: 'Keep for later' }, linked, removedGear)[0].exerciseId, linked.exerciseId)
  assert.equal(workoutCardCatalog(removedGear).find(item => item.id === linked.exerciseId)?.name, entry.name)
})

test('resource options include confirmed custom gear without offering retired sport resources on fresh notes', () => {
  assert.ok(workoutCardCatalog().every(item => item.kind === 'exercise'))
  assert.ok(workoutCardCatalog(customProgram()).every(item => item.kind === 'exercise'))
  assert.ok(workoutCardCatalog({ ...customProgram(), goal: 'dodgeball' }).some(item => item.kind === 'sport_drill'))
  const fresh = workoutCardResourceOptions(['floor_space', 'custom:rowing-handles', 'dodgeballs'])
  assert.ok(fresh.includes('custom:rowing-handles'))
  assert.ok(fresh.includes('floor_space'))
  assert.equal(fresh.includes('dodgeballs'), false)
  assert.equal(fresh.includes('court'), false)
  assert.equal(fresh.includes('safe_target'), false)
  const saved = workoutCardResourceOptions([], ['custom:old-handles', 'dodgeballs', 'safe_target'])
  assert.ok(saved.includes('custom:old-handles'))
  assert.ok(saved.includes('dodgeballs'))
  assert.ok(saved.includes('safe_target'))
  const current = Array.from({ length: 16 }, (_, index) => `custom:new-${index}` as const)
  const historical = Array.from({ length: 16 }, (_, index) => `custom:old-${index}` as const)
  assert.equal(workoutCardResourceOptions(current, historical).filter(id => id.startsWith('custom:')).length, 32)
})

test('card availability preserves legacy support guards and uses exact metadata in program mode', () => {
  assert.equal(workoutCardAvailable('back-squat', ['barbell']), false)
  assert.equal(workoutCardAvailable('back-squat', ['barbell', 'rack']), true)
  assert.equal(workoutCardAvailable('bench-press', ['barbell']), false)
  assert.equal(workoutCardAvailable('bench-press', ['barbell', 'bench']), true)
  assert.equal(workoutCardAvailable('hip-thrust', ['barbell']), false)
  assert.equal(workoutCardAvailable('hip-thrust', ['barbell', 'bench']), true)
  assert.equal(workoutCardAvailable('pull-up', []), false)
  assert.equal(workoutCardAvailable('pull-up', ['pull_up_bar']), true)
  assert.equal(workoutCardAvailable('dumbbell-row', ['dumbbell']), true)
  const program: ProgramConfigV1 = {
    version: 1,
    libraryVersion: PROGRAM_LIBRARY_VERSION,
    goal: 'strength',
    resources: ['bodyweight', 'barbell', 'bench'],
    conditioningBaselines: [],
  }
  assert.equal(workoutCardAvailable('bench-press', ['barbell', 'bench'], program), false)
  assert.equal(workoutCardAvailable('bodyweight-squat', [], program), false)
  assert.equal(workoutCardAvailable('dumbbell-row', ['dumbbell'], {
    ...program, resources: ['bodyweight', 'dumbbell'],
  }), false)
  assert.equal(workoutCardAvailable('dumbbell-row', ['dumbbell', 'bench'], {
    ...program, resources: ['bodyweight', 'bench', 'dumbbell'],
  }), true)
})

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
    'approved', 'safe', 'tempo', 'executionStyle', 'profile', 'profileId', 'prescription', 'dose',
    'targetRPE', '__proto__', 'constructor', 'prototype',
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
    const supported = !exercise.highSkill && exercise.template && exercise.profile && exercise.requirements
    if (supported) {
      assert.equal(parseWorkoutCards([card({ exerciseId: exercise.id })])[0].exerciseId, exercise.id)
    } else {
      assert.throws(() => parseWorkoutCards([card({ exerciseId: exercise.id })]), /supported/i)
    }
  }
  for (const drill of SUPPORTED_SPORT_DRILLS) {
    assert.equal(parseWorkoutCards([card({ exerciseId: drill.id })])[0].exerciseId, drill.id)
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
  const legacy: ResourceId[] = ['dodgeballs', 'cones', 'wall', 'court', 'partner', 'open_space', 'safe_target']
  const expanded: ResourceId[] = [...all, ...legacy,
    ...Array.from({ length: 16 }, (_, index) => `custom:kit-${index}` as const)]
  assert.equal(expanded.length, MAX_RESOURCES)
  assert.deepEqual(parseWorkoutCards([{ ...card(), resources: expanded }])[0].resources, parseResources(expanded))
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
    const render = (cards: WorkoutCard[], options: { exerciseId?: string; readOnly?: boolean; resources?: ResourceId[]; program?: ProgramConfigV1 } = {}) => renderToStaticMarkup(createElement(WorkoutCards, {
      cards, resources: [], onChange() { assert.fail('Rendering must not change cards') }, ...options,
    }))
    await t.test('custom title cannot replace the canonical exercise identity', () => {
      const html = render([card({ title: 'My custom nickname' })])
      assert.match(html, /My custom nickname/)
      assert.match(html, /Exercise: /)
      assert.match(html, /Bodyweight squat/)
      assert.match(html, /User/)
      assert.match(html, /Draft/)
      assert.match(html, /Reference only/)
      assert.match(html, /do not add work/)
      assert.match(html, /Edit/)
      assert.match(html, /Delete/)
      assert.match(html, /Add note/)
      assert.match(html, /<details class="cf-notebook-text"><summary aria-label="Manage My custom nickname">Manage note<\/summary>/)
      assert.doesNotMatch(html, /<details[^>]*\bopen=/)
      assert.doesNotMatch(html, /<form|<input|<textarea|<select|dangerouslySetInnerHTML/)
      for (const button of html.matchAll(/<button\b[^>]*>/g)) assert.match(button[0], /type="button"/)
    })
    await t.test('saved custom throwing notes show their canonical identity without adding a workout', () => {
      const program = throwingProgram()
      const linked = card({ exerciseId: 'custom-standing-target', title: 'My target setup' })
      const html = render([linked], { exerciseId: linked.exerciseId!, program, resources: ['dodgeballs', 'court', 'safe_target'], readOnly: true })
      assert.match(html, /My standing target throw/)
      assert.match(html, /My target setup/)
      assert.match(html, /do not add work/)
      assert.doesNotMatch(html, /Unscheduled drill idea|Unavailable for use|<button|<input|<select/)
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
    await t.test('description, focus and purpose remain readable personal content', () => {
      const html = render([card({
        instructions: 'Use the execution shown in the prescription.',
        cues: 'Keep a balanced stance.',
        purpose: 'This is my strength-support movement.',
      })])
      assert.match(html, /Description/)
      assert.match(html, /What to focus on/)
      assert.match(html, /Why this exercise/)
      assert.match(html, /Use the execution shown in the prescription/)
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
      const note = card({ exerciseId: 'dumbbell-bench-press-fast-concentric', resources: ['rower', 'cones'] })
      const html = render([note], { resources: ['dumbbell', 'rower'] })
      assert.match(html, /Fast-intent DB bench press/)
      assert.match(html, /Unavailable for use/)
      assert.match(html, /Missing: Bench, Cones/)
      assert.match(html, /Kept as a draft/)
      assert.match(html, /Edit/)
      assert.doesNotMatch(html, /Use note|Use drill|Add to plan/)
      assert.doesNotMatch(render([note], { resources: ['dumbbell', 'bench', 'rower', 'cones'] }), /Unavailable for use/)
      assert.match(render([card({ exerciseId: 'pull-up' })]), /Missing: Pull-up bar/)
      assert.match(render([card({ exerciseId: 'back-squat' })]), /Missing: Barbell &amp; plates, Squat rack/)
    })
    await t.test('custom filtered notes keep their real identity and show only genuinely missing custom gear', () => {
      const program = customProgram()
      const note = card({ exerciseId: 'custom-supported-handle-row', title: 'My own setup' })
      const html = render([note], { program, resources: ['floor_space', 'custom:rowing-handles'], exerciseId: note.exerciseId! })
      assert.match(html, /Notes for Supported handle row/)
      assert.match(html, /Exercise: .*Supported handle row/)
      assert.match(html, /My own setup/)
      assert.doesNotMatch(html, /Unavailable for use|Unscheduled drill idea/)
      const edited = saveWorkoutCard([note], { ...note, instructions: 'My saved setup detail.' }, note, program)
      assert.match(render(edited, { program, exerciseId: note.exerciseId! }), /My saved setup detail/)
      const missing = render(edited, {
        program: { ...program, resources: ['bodyweight', 'floor_space'] }, exerciseId: note.exerciseId!,
      })
      assert.match(missing, /Missing: Rowing Handles/)
      assert.doesNotMatch(missing, /Missing: .*Barbell|Missing: .*Dumbbell|Missing: .*Bench|Missing: .*Dodgeball/)
    })
    await t.test('stored sport-linked notes remain readable while fresh generic notebooks show no sport catalog', () => {
      const old = card({ exerciseId: 'dodgeball-controlled-target-throw', resources: ['dodgeballs', 'court', 'safe_target'] })
      assert.equal(parseWorkoutCards([old])[0].exerciseId, old.exerciseId)
      const saved = render([old])
      assert.match(saved, /Controlled target throws/)
      assert.match(saved, /Ball \(saved equipment\)/)
      assert.doesNotMatch(render([]), /Controlled target throws|Dodgeball|dodgeballs|Practice target/)
    })
  } finally {
    hooks.deregister()
  }
})
