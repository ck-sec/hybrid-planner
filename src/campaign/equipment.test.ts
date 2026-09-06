import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement, isValidElement } from 'react'
import type { ChangeEvent, ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { PROGRAM_LIBRARY_VERSION, PROGRAM_POLICY, RECOMMENDATION_POLICY } from '../../engine/constants.ts'
import { DEFAULT_LIBRARY } from '../../engine/library.ts'
import { recommendationForExercise } from '../../engine/recommendations.ts'
import type { Equipment, ProgramConfigV1 } from '../../engine/types.ts'
import {
  availableProgramExercises, customResourceId, equipmentAvailable, equipmentForResources, exerciseAvailable,
  MAX_CUSTOM_RESOURCES, MAX_CUSTOM_RESOURCE_SLUG_LENGTH, MAX_RESOURCES,
  maxExerciseSelection, parseResources, programResources, recommendForResources,
  RESOURCE_CATALOG, RESOURCE_PRESETS, resourceLabels, resourcesForEquipment,
} from './equipment.ts'
import type { ResourceId } from './equipment.ts'

test('fresh resource catalog covers strength and cardio without a prescribed sport', () => {
  assert.deepEqual(RESOURCE_CATALOG.map(resource => resource.id).sort(), [
    'anchor_point', 'bands', 'barbell', 'bench', 'bike', 'cable', 'carry_space',
    'dumbbell', 'floor_space', 'kettlebell', 'machine',
    'pull_up_bar', 'rack', 'rower', 'ski_erg', 'stable_step', 'treadmill',
  ])
  assert.deepEqual([...new Set(RESOURCE_CATALOG.map(resource => resource.group))], ['strength', 'cardio'])
  assert.equal(new Set(RESOURCE_CATALOG.map(resource => resource.label)).size, RESOURCE_CATALOG.length)
  assert.doesNotMatch(JSON.stringify(RESOURCE_CATALOG), /dodgeball|court|safe_target/i)
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
  assert.throws(() => parseResources(Array(MAX_RESOURCES + 1).fill('dumbbell')), /at most/)
})

test('custom gear is canonical, bounded, labelled and never aliases known strength equipment', () => {
  assert.equal(customResourceId('  Exercise   Mat  '), 'custom:exercise-mat')
  assert.equal(customResourceId('Medicine--Ball'), 'custom:medicine-ball')
  assert.equal(customResourceId('Ball'), 'custom:ball')
  const resources = parseResources(['floor_space', customResourceId('Mat'), customResourceId('Ball')])
  assert.deepEqual(resources, ['custom:ball', 'custom:mat', 'floor_space'])
  assert.deepEqual(resourceLabels(resources), ['Ball', 'Mat', 'Floor space'])
  assert.deepEqual(parseResources(JSON.parse(JSON.stringify(resources))), resources)
  assert.deepEqual(equipmentForResources(['custom:dumbbell', 'custom:ball']), ['bodyweight'])
  assert.deepEqual(programResources(['custom:mat', 'rower', 'custom:ball']), ['bodyweight', 'custom:ball', 'custom:mat'])
  assert.equal(customResourceId('a'.repeat(MAX_CUSTOM_RESOURCE_SLUG_LENGTH)), `custom:${'a'.repeat(48)}`)
  const all = Array.from({ length: MAX_CUSTOM_RESOURCES }, (_, i) => customResourceId(`Item ${i}`))
  assert.equal(parseResources(all).length, 16)
  assert.throws(() => parseResources([...all, 'custom:extra']), /at most 16/)
})

test('custom gear rejects malformed, ambiguous and duplicate resource IDs', () => {
  for (const name of ['', ' ', '-', 'Ball!', '<script>', '../mat', 'custom:mat', 'a\nb', 'a'.repeat(49), 'a'.repeat(121)]) {
    assert.throws(() => customResourceId(name), /name|resource/i)
  }
  for (const id of ['custom:', 'custom:Ball', 'custom:two words', 'custom:a--b', 'custom:-mat', 'custom:mat-', 'custom:__proto__', `custom:${'a'.repeat(49)}`]) {
    assert.throws(() => parseResources([id]), /resource/i)
  }
  assert.throws(() => parseResources([customResourceId('Ball'), customResourceId(' BALL ')]), /duplicate/)
})

test('legacy sport resource IDs still roundtrip and map to exact engine aliases', () => {
  const saved = ['dodgeballs', 'court', 'safe_target', 'partner', 'cones', 'wall', 'open_space']
  assert.deepEqual(parseResources(saved), [...saved].sort())
  assert.deepEqual(programResources(parseResources(saved)), ['bodyweight', 'court_space', 'dodgeball', 'safe_target'])
  assert.doesNotMatch(resourceLabels(parseResources(saved)).join(', '), /dodgeball/i)
  const full = [...RESOURCE_CATALOG.map(resource => resource.id), ...saved,
    ...Array.from({ length: MAX_CUSTOM_RESOURCES }, (_, i) => customResourceId(`Gear ${i}`))]
  assert.equal(full.length, MAX_RESOURCES)
  assert.equal(parseResources(full).length, MAX_RESOURCES)
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
  assert.deepEqual(RESOURCE_PRESETS[0].resources, ['floor_space'])
  assert.deepEqual(RESOURCE_PRESETS[1].resources, ['bands', 'dumbbell', 'floor_space'])
  assert.ok(RESOURCE_PRESETS[2].resources.includes('barbell'))
  for (const preset of RESOURCE_PRESETS) {
    const resources: readonly ResourceId[] = preset.resources
    assert.deepEqual(parseResources(resources), resources)
    for (const id of ['rack', 'bench', 'pull_up_bar', 'rower', 'ski_erg'] as const) assert.ok(!resources.includes(id))
    assert.ok(recommendForResources(resources).every(id => exerciseAvailable(id, resources)))
  }
})

test('legacy support guards remain exact while program mode follows stricter profile requirements', () => {
  for (const [id, support] of [
    ['back-squat', 'rack'], ['bench-press', 'bench'], ['hip-thrust', 'bench'],
  ] as const) {
    assert.equal(exerciseAvailable(id, []), false)
    assert.equal(exerciseAvailable(id, ['barbell']), false)
    assert.equal(exerciseAvailable(id, [support]), false)
    assert.equal(exerciseAvailable(id, ['barbell', support]), true)
    assert.equal(exerciseAvailable(id, ['barbell'], true), false)
  }
  assert.equal(exerciseAvailable('back-squat', ['barbell', 'rack'], true), true)
  assert.equal(exerciseAvailable('hip-thrust', ['barbell', 'bench'], true), true)
  assert.equal(exerciseAvailable('bench-press', ['barbell', 'bench'], true), false)
  assert.equal(exerciseAvailable('bench-press', ['barbell', 'bench', 'rack'], true), true)
  assert.equal(exerciseAvailable('back-squat', ['barbell', 'bench']), false)
  assert.equal(exerciseAvailable('bench-press', ['barbell', 'rack']), false)
  assert.equal(exerciseAvailable('pull-up', []), false)
  assert.equal(exerciseAvailable('pull-up', ['barbell', 'rack', 'bench']), false)
  assert.equal(exerciseAvailable('pull-up', ['pull_up_bar']), true)
  assert.equal(exerciseAvailable('back-squat', ['barbell', 'bench'], true), false)
  assert.equal(exerciseAvailable('bench-press', ['barbell', 'rack'], true), false)
  assert.equal(exerciseAvailable('pull-up', [], true), false)
  assert.equal(exerciseAvailable('pull-up', ['pull_up_bar'], true), true)
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

test('program helpers use exact engine resources, profiles and the program exercise ceiling without AI', t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Resource capability helpers must never contact AI'))
  assert.deepEqual(programResources(['rower', 'kettlebell', 'floor_space', 'carry_space']), [
    'bodyweight', 'carry_space', 'floor_space', 'kettlebell',
  ])
  assert.deepEqual(programResources(['dodgeballs', 'court', 'open_space', 'rower']), [
    'bodyweight', 'court_space', 'dodgeball',
  ])
  assert.equal(equipmentAvailable(['kettlebell', 'floor_space'], ['bodyweight', 'kettlebell']), false)
  assert.equal(equipmentAvailable(['kettlebell', 'floor_space'], ['bodyweight', 'kettlebell', 'floor_space']), true)
  assert.equal(exerciseAvailable('dodgeball-controlled-target-throw', ['dodgeballs', 'court']), false)
  assert.equal(exerciseAvailable('dodgeball-controlled-target-throw', ['dodgeballs', 'court', 'safe_target']), true)
  const program: ProgramConfigV1 = {
    version: 1 as const,
    libraryVersion: PROGRAM_LIBRARY_VERSION,
    goal: 'dodgeball' as const,
    resources: ['bodyweight', 'floor_space', 'kettlebell', 'carry_space'] as const,
    conditioningBaselines: [],
  }
  const metadata = availableProgramExercises([], program)
  const exact = new Set(program.resources)
  assert.ok(metadata.some(item => item.id === 'kettlebell-goblet-squat'))
  assert.ok(metadata.some(item => item.template === 'carry' && item.unit === 'seconds'))
  assert.ok(metadata.every(item => item.requirements.every(resource => exact.has(resource))))
  const ids = recommendForResources([], program)
  assert.ok(ids.some(id => id.startsWith('kettlebell-')))
  assert.ok(ids.every(id => metadata.some(item => item.id === id)))
  assert.equal(maxExerciseSelection(), RECOMMENDATION_POLICY.maxExercises)
  assert.equal(maxExerciseSelection(program), PROGRAM_POLICY.maxSelectedExercises)
})

test('program capability helpers resolve custom definitions and preserve explicit custom selections', () => {
  const resources: ResourceId[] = ['floor_space', 'custom:mat']
  const program: ProgramConfigV1 = {
    version: 1, libraryVersion: PROGRAM_LIBRARY_VERSION, goal: 'balanced',
    resources: programResources(resources), conditioningBaselines: [],
    customExercises: [{
      version: 1, id: 'custom-mat-squat', name: 'Mat stance squat', profileId: 'controlled_squat',
      requirements: ['bodyweight', 'custom:mat', 'floor_space'],
      description: 'Stand on a flat mat and squat with control.', focus: 'Use a comfortable range.',
      why: 'A familiar controlled movement for this goal.',
    }],
  }
  const before = JSON.stringify(DEFAULT_LIBRARY)
  assert.equal(exerciseAvailable('custom-mat-squat', resources), false)
  assert.equal(exerciseAvailable('custom-mat-squat', [], program), true)
  assert.equal(exerciseAvailable('custom-unreviewed', resources, program), false)
  const metadata = availableProgramExercises([], program)
  assert.ok(metadata.some(item => item.id === 'custom-mat-squat'))
  const initial = recommendForResources([], program)
  const selected = [...initial.slice(0, PROGRAM_POLICY.minSelectedExercises - 1), 'custom-mat-squat']
  assert.deepEqual(recommendForResources([], { ...program, selectedExerciseIds: selected }).toSorted(), selected.toSorted())
  assert.ok(!availableProgramExercises(resources).some(item => item.id === 'custom-mat-squat'))
  const archived: ProgramConfigV1 = { ...program, resources: ['bodyweight', 'floor_space'], selectedExerciseIds: initial }
  const archivedBefore = structuredClone(archived)
  assert.equal(exerciseAvailable('custom-mat-squat', resources, archived), false)
  assert.ok(!availableProgramExercises(resources, archived).some(item => item.id === 'custom-mat-squat'))
  assert.deepEqual(recommendForResources([], archived).toSorted(), initial.toSorted())
  assert.throws(() => recommendForResources([], { ...archived, selectedExerciseIds: selected }), /resources/)
  assert.deepEqual(archived, archivedBefore)
  assert.equal(JSON.stringify(DEFAULT_LIBRARY), before)
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
    assert.match(html, /<summary>Adjust strength &amp; cardio equipment \(optional\)<\/summary>/)
    assert.match(html, /<summary>Add other gear \(optional\)<\/summary>/)
    assert.match(html, /<p[^>]*role="status"[^>]*>.*Bodyweight · Rower · SkiErg<\/p>/)
    assert.match(html, /Presets replace your selection/)
    for (const group of ['Strength equipment', 'Cardio equipment']) {
      assert.ok(html.includes(`<legend>${group}</legend>`))
    }
    const renderedButtons = html.match(/<button\b[^>]*>/g) ?? []
    assert.equal(renderedButtons.length, RESOURCE_PRESETS.length + 1)
    assert.ok(renderedButtons.every(button => button.includes('type="button"')))
    assert.equal((html.match(/<label\b/g) ?? []).length, RESOURCE_CATALOG.length + 1)
    assert.doesNotMatch(html, /Dodgeball|Safe throwing|Court<|throw count/i)
    const customHtml = renderToStaticMarkup(createElement(EquipmentPicker, {
      value: ['custom:ball', 'dodgeballs'], onChange() { assert.fail('Saved resources must not be rewritten on render') },
    }))
    assert.match(customHtml, /Remove Ball/)
    assert.match(customHtml, /saved equipment/)
    assert.doesNotMatch(customHtml, /Dodgeball/i)
    const limitHtml = renderToStaticMarkup(createElement(EquipmentPicker, {
      value: Array.from({ length: MAX_CUSTOM_RESOURCES }, (_, i) => customResourceId(`Gear ${i}`)), onChange() {},
    }))
    assert.match(limitHtml, /Up to 16 custom items/)
    assert.match(limitHtml, /<button[^>]*disabled=""[^>]*>Add equipment<\/button>/)

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

    const savedTree = EquipmentPicker({ value: ['custom:ball', 'dodgeballs'], onChange: next => changes.push(next) })
    const savedRower = elements(savedTree).find(element => element.type === 'input' && element.props.value === 'rower')!
    change(savedRower, true)
    assert.deepEqual(changes.pop(), ['custom:ball', 'dodgeballs', 'rower'])
    const removeCustom = elements(savedTree).find(element => element.type === 'button' && element.props['aria-label'] === 'Remove Ball')!
    ;(removeCustom.props.onClick as () => void)()
    assert.deepEqual(changes.pop(), ['dodgeballs'])

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
