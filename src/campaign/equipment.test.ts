import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement, isValidElement } from 'react'
import type { ChangeEvent, ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { RECOMMENDATION_POLICY } from '../../engine/constants.ts'
import { DEFAULT_LIBRARY } from '../../engine/library.ts'
import { recommendationForExercise } from '../../engine/recommendations.ts'
import type { Equipment } from '../../engine/types.ts'
import {
  equipmentForResources, exerciseAvailable, parseResources, recommendForResources,
  RESOURCE_CATALOG, RESOURCE_PRESETS, resourceLabels, resourcesForEquipment,
} from './equipment.ts'
import type { ResourceId } from './equipment.ts'

test('resource catalog covers explicit strength, cardio and sport capabilities, not implicit bodyweight', () => {
  assert.deepEqual(RESOURCE_CATALOG.map(resource => resource.id).sort(), [
    'bands', 'barbell', 'bench', 'bike', 'cable', 'cones', 'court', 'dodgeballs', 'dumbbell',
    'kettlebell', 'machine', 'open_space', 'partner', 'pull_up_bar', 'rack', 'rower', 'ski_erg', 'treadmill', 'wall',
  ])
  assert.deepEqual([...new Set(RESOURCE_CATALOG.map(resource => resource.group))], ['strength', 'cardio', 'sport'])
  assert.equal(new Set(RESOURCE_CATALOG.map(resource => resource.label)).size, RESOURCE_CATALOG.length)
})

test('resource parsing is bounded, canonical and non-mutating', () => {
  const input = Object.freeze(['ski_erg', 'barbell', 'rower'])
  const parsed = parseResources(input)
  assert.deepEqual(parsed, ['barbell', 'rower', 'ski_erg'])
  assert.deepEqual(input, ['ski_erg', 'barbell', 'rower'])
  assert.notEqual(parsed, input)
  assert.deepEqual(parseResources([]), [])
  const all = RESOURCE_CATALOG.map(resource => resource.id)
  assert.deepEqual(parseResources(all), [...all].sort())
  assert.deepEqual(parseResources(parsed), parsed)
})

test('resource parsing rejects unknown, duplicate and malformed values rather than silently repairing them', () => {
  for (const invalid of [
    undefined, null, false, 1, 'dumbbell', {}, new Set(['dumbbell']),
    ['unknown'], ['Dumbbell'], ['dumbbell '], ['bodyweight'], ['none'],
    ['constructor'], ['__proto__'], [1], [null], [['dumbbell']], [{ id: 'dumbbell' }],
    Array(1), ['rower', 'rower'], ['barbell', 'dumbbell', 'barbell'],
  ]) assert.throws(() => parseResources(invalid), /resource|duplicate/i)
  assert.throws(() => parseResources(Array(RESOURCE_CATALOG.length + 1).fill('dumbbell')), /at most/)
})

test('legacy inference keeps broad gear without assuming supports, space or cardio machines', () => {
  assert.deepEqual(resourcesForEquipment([]), [])
  assert.deepEqual(resourcesForEquipment(['bodyweight', 'none']), [])
  assert.deepEqual(resourcesForEquipment(['barbell']), ['barbell'])
  assert.deepEqual(resourcesForEquipment(['machine']), ['machine'])
  const legacy: readonly Equipment[] = Object.freeze([
    'machine', 'dumbbell', 'bodyweight', 'barbell', 'bands', 'cable', 'kettlebell', 'none', 'dumbbell',
  ])
  assert.deepEqual(resourcesForEquipment(legacy), ['bands', 'barbell', 'cable', 'dumbbell', 'kettlebell', 'machine'])
  assert.deepEqual(resourcesForEquipment([...legacy].reverse()), resourcesForEquipment(legacy))
  for (const id of ['rack', 'bench', 'pull_up_bar'] as const) assert.ok(!resourcesForEquipment(legacy).includes(id))
})

test('engine projection is deterministic and always includes bodyweight, never cardio modalities', () => {
  assert.deepEqual(equipmentForResources([]), ['bodyweight'])
  for (const resource of RESOURCE_CATALOG.filter(resource => resource.group !== 'strength')) {
    assert.deepEqual(equipmentForResources([resource.id]), ['bodyweight'])
  }
  assert.deepEqual(equipmentForResources(['rack', 'bench', 'pull_up_bar']), ['bodyweight'])
  const resources = Object.freeze(RESOURCE_CATALOG.map(resource => resource.id))
  const expected = ['bodyweight', 'bands', 'barbell', 'cable', 'dumbbell', 'kettlebell', 'machine']
  assert.deepEqual(equipmentForResources(resources), expected)
  assert.deepEqual(equipmentForResources([...resources].reverse()), expected)
  assert.deepEqual(equipmentForResources(['dumbbell', 'rower', 'dumbbell']), ['bodyweight', 'dumbbell'])
  assert.deepEqual(equipmentForResources(resourcesForEquipment(equipmentForResources(resources))), expected)
})

test('resource labels describe only explicit selections, including rower and SkiErg', () => {
  assert.deepEqual(resourceLabels([]), [])
  assert.deepEqual(resourceLabels(['ski_erg', 'rower', 'dumbbell']), ['Dumbbells', 'Rower', 'SkiErg'])
  assert.deepEqual(resourceLabels(['rower', 'rower']), ['Rower'])
  const all = RESOURCE_CATALOG.map(resource => resource.id)
  assert.deepEqual(resourceLabels(all), resourceLabels([...all].reverse()))
})

test('no-kit, home and gym presets are explicit canonical selections, with supports selected separately', () => {
  assert.deepEqual(RESOURCE_PRESETS.map(preset => preset.label), ['No kit', 'Home', 'Gym'])
  assert.deepEqual(RESOURCE_PRESETS[0].resources, [])
  assert.deepEqual(RESOURCE_PRESETS[1].resources, ['bands', 'dumbbell'])
  assert.ok(RESOURCE_PRESETS[2].resources.includes('barbell'))
  for (const preset of RESOURCE_PRESETS) {
    const resources: readonly ResourceId[] = preset.resources
    assert.deepEqual(parseResources(resources), resources)
    for (const id of ['rack', 'bench', 'pull_up_bar', 'rower', 'ski_erg'] as const) assert.ok(!resources.includes(id))
    assert.ok(recommendForResources(resources).every(id => exerciseAvailable(id, resources)))
  }
})

test('specific supports must be selected as well as each exercise’s broad gear', () => {
  for (const [id, support] of [
    ['back-squat', 'rack'], ['bench-press', 'bench'], ['hip-thrust', 'bench'],
  ] as const) {
    assert.equal(exerciseAvailable(id, []), false)
    assert.equal(exerciseAvailable(id, ['barbell']), false)
    assert.equal(exerciseAvailable(id, [support]), false)
    assert.equal(exerciseAvailable(id, ['barbell', support]), true)
  }
  assert.equal(exerciseAvailable('back-squat', ['barbell', 'bench']), false)
  assert.equal(exerciseAvailable('bench-press', ['barbell', 'rack']), false)
  assert.equal(exerciseAvailable('pull-up', []), false)
  assert.equal(exerciseAvailable('pull-up', ['barbell', 'rack', 'bench']), false)
  assert.equal(exerciseAvailable('pull-up', ['pull_up_bar']), true)
})

test('availability follows the checked library, without inferred substitutions or unknown exercises', () => {
  for (const id of ['bodyweight-squat', 'push-up', 'dead-bug']) assert.equal(exerciseAvailable(id, []), true)
  for (const id of ['deadlift', 'romanian-deadlift', 'overhead-press']) {
    assert.equal(exerciseAvailable(id, []), false)
    assert.equal(exerciseAvailable(id, ['barbell']), true)
  }
  for (const id of ['goblet-squat', 'dumbbell-row', 'split-squat']) {
    assert.equal(exerciseAvailable(id, ['dumbbell']), true)
    assert.equal(exerciseAvailable(id, ['kettlebell']), false)
  }
  assert.equal(exerciseAvailable('band-rotation', ['bands']), true)
  assert.equal(exerciseAvailable('band-rotation', ['cable']), false)
  assert.equal(exerciseAvailable('dumbbell-row', ['rower']), false)
  for (const id of ['', 'constructor', '__proto__', 'made-up-exercise']) {
    assert.equal(exerciseAvailable(id, RESOURCE_CATALOG.map(resource => resource.id)), false)
  }
})

test('recommendations preserve the routine with equipped or bodyweight fallbacks for unavailable movements', () => {
  const bodyweight = ['bodyweight-squat', 'push-up', 'dead-bug']
  assert.deepEqual(recommendForResources([]), bodyweight)
  assert.deepEqual(recommendForResources(['rower', 'ski_erg', 'bike', 'treadmill', 'court', 'partner']), bodyweight)
  assert.deepEqual(recommendForResources(['kettlebell', 'cable', 'machine']), bodyweight)
  assert.deepEqual(recommendForResources(['dumbbell']), ['goblet-squat', 'dumbbell-row', 'push-up', 'dead-bug'])
  assert.deepEqual(recommendForResources(['barbell']), ['bodyweight-squat', 'romanian-deadlift', 'push-up', 'dead-bug'])
  assert.deepEqual(recommendForResources(['barbell', 'dumbbell']),
    ['goblet-squat', 'romanian-deadlift', 'push-up', 'dumbbell-row', 'dead-bug'])
  assert.deepEqual(recommendForResources(['barbell', 'rack', 'bench', 'dumbbell']),
    ['back-squat', 'romanian-deadlift', 'bench-press', 'dumbbell-row', 'dead-bug'])
})

test('every strength-capability combination produces deterministic, supported and available recommendations', () => {
  const capabilities = RESOURCE_CATALOG.filter(resource => resource.group === 'strength').map(resource => resource.id)
  const libraryBefore = JSON.stringify(DEFAULT_LIBRARY)
  for (let mask = 0; mask < 2 ** capabilities.length; mask += 1) {
    const resources = Object.freeze(capabilities.filter((_, bit) => mask & (1 << bit)))
    const before = [...resources]
    const ids = recommendForResources(resources)
    assert.ok(ids.length > 0 && ids.length <= RECOMMENDATION_POLICY.maxExercises)
    assert.equal(new Set(ids).size, ids.length)
    assert.deepEqual(recommendForResources([...resources].reverse()), ids)
    assert.deepEqual(resources, before)
    for (const id of ids) {
      assert.ok(exerciseAvailable(id, resources), `${id} requires unavailable resources: ${resources.join(', ')}`)
      assert.equal(DEFAULT_LIBRARY.exercises.find(exercise => exercise.id === id)?.highSkill, false)
      assert.doesNotThrow(() => recommendationForExercise(id))
    }
  }
  assert.equal(JSON.stringify(DEFAULT_LIBRARY), libraryBefore)
})

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}

test('equipment picker is accessible, controlled and changes resources only on explicit enabled edits', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Equipment selection must never contact a network'))
  const pickerUrl = new URL('./EquipmentPicker.tsx', import.meta.url).href
  const cssUrl = new URL('./equipment.css', import.meta.url).href
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (url === cssUrl) return { format: 'module', shortCircuit: true, source: '' }
      if (url !== pickerUrl) return nextLoad(url, context)
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
        }).outputText,
      }
    },
  })
  try {
    const { default: EquipmentPicker } = await import('./EquipmentPicker.tsx')
    const value = Object.freeze(['ski_erg', 'rower'] as const)
    const html = renderToStaticMarkup(createElement(EquipmentPicker, {
      value, onChange: () => assert.fail('Rendering must not change a selection'),
    }))
    assert.doesNotMatch(html, /<form|<details[^>]*\bopen=/)
    assert.match(html, /<legend>What can you train with\?<\/legend>/)
    assert.match(html, /<summary>Choose individual equipment &amp; spaces<\/summary>/)
    assert.match(html, /<p[^>]*role="status"[^>]*>.*Bodyweight · Rower · SkiErg<\/p>/)
    assert.match(html, /Presets replace your selection/)
    for (const group of ['Strength equipment', 'Cardio equipment', 'Sport, space &amp; partners']) {
      assert.ok(html.includes(`<legend>${group}</legend>`))
    }
    const renderedButtons = html.match(/<button\b[^>]*>/g) ?? []
    assert.equal(renderedButtons.length, RESOURCE_PRESETS.length)
    assert.ok(renderedButtons.every(button => button.includes('type="button"')))
    assert.equal((html.match(/<label\b/g) ?? []).length, RESOURCE_CATALOG.length)

    const changes: ResourceId[][] = []
    const tree = EquipmentPicker({ value, onChange: next => changes.push(next) })
    const checkbox = (id: ResourceId) => {
      const input = elements(tree).find(element => element.type === 'input' && element.props.value === id)
      assert.ok(input)
      return input
    }
    assert.equal(checkbox('rower').props.checked, true)
    assert.equal(checkbox('ski_erg').props.checked, true)
    assert.equal(checkbox('rack').props.checked, false)
    const change = (input: ReactElement<Record<string, unknown>>, checked: boolean) =>
      (input.props.onChange as (event: ChangeEvent<HTMLInputElement>) => void)(
        { currentTarget: { checked } } as ChangeEvent<HTMLInputElement>)
    change(checkbox('barbell'), true)
    assert.deepEqual(changes.pop(), ['barbell', 'rower', 'ski_erg'])
    change(checkbox('rower'), false)
    assert.deepEqual(changes.pop(), ['ski_erg'])
    assert.deepEqual(value, ['ski_erg', 'rower'])

    const buttons = elements(tree).filter(element => element.type === 'button')
    for (const [index, button] of buttons.entries()) {
      (button.props.onClick as () => void)()
      const next = changes.pop()
      assert.deepEqual(next, RESOURCE_PRESETS[index]!.resources)
      assert.notEqual(next, RESOURCE_PRESETS[index]!.resources)
    }
    assert.equal(changes.length, 0)

    const disabledProps = { value, disabled: true, onChange: () => assert.fail('Disabled controls must not change resources') }
    assert.match(renderToStaticMarkup(createElement(EquipmentPicker, disabledProps)), /<fieldset[^>]*disabled=""/)
    const disabledTree = EquipmentPicker(disabledProps)
    for (const element of elements(disabledTree)) {
      if (element.type === 'button') {
        assert.equal(element.props.disabled, true)
        ;(element.props.onClick as () => void)()
      }
      if (element.type === 'input') {
        assert.equal(element.props.disabled, true)
        change(element, true)
      }
    }
  } finally {
    hooks.deregister()
  }
})
