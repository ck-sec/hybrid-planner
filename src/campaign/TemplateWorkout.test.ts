import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement, isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type { WorkoutSession } from '../../engine/types.ts'
import {
  buildCampaign, completeCampaignSession, confirmSetupEquipment, exampleCampaign,
  logCampaignBlockSet, nextCampaignWeek,
} from './model.ts'
import { lastRecordedBlockSet } from './training-feedback.ts'

function fixture() {
  const initial = confirmSetupEquipment(exampleCampaign('2026-09-07'), ['dumbbell', 'floor_space', 'bench'])
  let state = buildCampaign({ ...initial, draft: { ...initial.draft, confirmed: true } })
  const previous = state.weeks[0].plan.sessions.find(item => item.kind === 'workout' && item.discipline === 'strength')!
  assert.ok(previous.kind === 'workout')
  const blockIndex = previous.blocks.findIndex(block => block.unit === 'reps')
  state = logCampaignBlockSet(state, previous.id, blockIndex, 0, { weight: '12', reps: '6', effort: '6.5' })
  state = completeCampaignSession(state, previous.id, 20, 4, false)
  state = nextCampaignWeek(state)
  const session = state.weeks[1].plan.sessions.find(item => item.kind === 'workout' && item.label === previous.label)!
  assert.ok(session.kind === 'workout')
  const block = session.blocks[blockIndex]
  assert.ok(block.unit === 'reps')
  return { state, session, blockIndex, block, previous }
}

type Element = ReactElement<{
  children?: ReactNode
  onClick?: () => void
  onSubmit?: (event: { preventDefault: () => void }) => void
  'aria-label'?: string
}>

function findElement(node: ReactNode, predicate: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate)
      if (found) return found
    }
  } else if (isValidElement<Element['props']>(node)) {
    return predicate(node) ? node : findElement(node.props.children, predicate)
  }
  return undefined
}

test('template last-record helpers only reuse exact immutable identities and require explicit set logging', async t => {
  const directory = new URL('./', import.meta.url).href
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith(directory)) return nextLoad(url, context)
      if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' }
      if (!url.endsWith('.tsx')) return nextLoad(url, context)
      return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
      }).outputText }
    },
  })
  try {
    const { default: TemplateWorkout } = await import('./TemplateWorkout.tsx')
    const { state, session, blockIndex, block, previous } = fixture()
    const actual = { exerciseId: block.exerciseId, weightKg: 12, reps: 6, actualRPE: 6.5 }
    await t.test('same-identity history is a reference, never an automatically completed set', () => {
      assert.deepEqual(lastRecordedBlockSet(state, session, blockIndex), actual)
      const before = structuredClone(state)
      const html = renderToStaticMarkup(createElement(TemplateWorkout, {
        state, session, readOnly: false, update: () => assert.fail('Rendering must not log or fill anything'),
      }))
      assert.match(html, /Last logged: 12 kg/)
      assert.match(html, /same variant/)
      assert.match(html, /Fill next set from last record/)
      assert.equal(html.match(/Suggestions and filled rows stay unlogged until you press Log/g)?.length, 1)
      assert.doesNotMatch(html, /No starting weight invented|Filling a row never logs it/)
      assert.match(html, /kilograms"[^>]*value=""/)
      assert.deepEqual(state, before)
      const archived = renderToStaticMarkup(createElement(TemplateWorkout, {
        state, session, readOnly: true, update: () => assert.fail('Archived rendering must not log'),
      }))
      assert.doesNotMatch(archived, /Fill next set from last record|Last logged:|Suggestions and filled rows/)
      assert.match(archived, /kilograms"[^>]*disabled=""/)
      assert.match(archived, /Exercise notes/)
    })
    await t.test('suggested weights remain labelled suggestions, including zero, with empty actual fields', () => {
      const suggested = structuredClone(session)
      const first = suggested.blocks[blockIndex]
      assert.ok(first.unit === 'reps')
      first.suggestedWeightKg = 0
      const html = renderToStaticMarkup(createElement(TemplateWorkout, {
        state, session: suggested, readOnly: false, update: () => assert.fail('Suggestions cannot log work'),
      }))
      assert.match(html, /Suggested weight: 0 kg · same variant/)
      assert.match(html, /kilograms"(?=[^>]*value="")(?=[^>]*placeholder="0")/)
      assert.equal(html.match(/Suggestions and filled rows stay unlogged/g)?.length, 1)
      assert.doesNotMatch(html, /No previous record|No starting weight invented/)
    })
    await t.test('filling copies only draft values; pressing the set log button records the actual set', () => {
      let working = structuredClone(state)
      const render = () => TemplateWorkout({
        state: working, session, readOnly: false, update(change) { working = change(working); return true },
      })
      const fill = findElement(render(), element => element.type === 'button'
        && Array.isArray(element.props.children) && element.props.children.includes('Fill next set from last record '))
      assert.ok(fill?.props.onClick)
      fill.props.onClick()
      assert.deepEqual(working.weeks[1].logs, state.weeks[1].logs)
      assert.deepEqual(working.setDrafts[`${session.id}:block-${blockIndex}:0`], { weight: '12', reps: '6', effort: '6.5' })
      const name = state.weeks[1].input.library.exercises.find(item => item.id === block.exerciseId)!.name
      const form = findElement(render(), element => element.type === 'form'
        && Boolean(findElement(element.props.children, child => child.props['aria-label'] === `Log ${name} set 1`)))
      assert.ok(form?.props.onSubmit)
      form.props.onSubmit({ preventDefault() {} })
      const log = working.weeks[1].logs[session.id]
      assert.equal(log.status, 'partial')
      assert.deepEqual(log.blockLogs?.[0], { unit: 'reps', blockIndex, exerciseId: block.exerciseId, sets: [actual] })
      assert.equal(working.setDrafts[`${session.id}:block-${blockIndex}:0`], undefined)
      assert.equal(log.actualDurationMin, undefined)
      assert.deepEqual(working.weeks[0], state.weeks[0])
    })
    await t.test('variants, changed definitions, different execution, pain and unrelated plans cannot lend weights', () => {
      const variant = structuredClone(state)
      const prior = variant.weeks[0].logs[previous.id].blockLogs![0]
      assert.ok(prior.unit === 'reps')
      prior.exerciseId = `${block.exerciseId}-slow-lowering`
      assert.equal(lastRecordedBlockSet(variant, session, blockIndex), undefined)
      const changed = structuredClone(state)
      changed.weeks[0].input.library.exercises.find(item => item.id === block.exerciseId)!.name = 'Changed identity'
      assert.equal(lastRecordedBlockSet(changed, session, blockIndex), undefined)
      const execution = structuredClone(state)
      const oldSession = execution.weeks[0].plan.sessions.find(item => item.id === previous.id)!
      assert.ok(oldSession.kind === 'workout')
      const oldBlock = oldSession.blocks[blockIndex]
      assert.ok(oldBlock.unit === 'reps')
      oldBlock.executionStyle = block.executionStyle === 'slow_lowering' ? 'controlled' : 'slow_lowering'
      assert.equal(lastRecordedBlockSet(execution, session, blockIndex), undefined)
      const pain = structuredClone(state)
      pain.weeks[0].logs[previous.id].painFlag = true
      assert.equal(lastRecordedBlockSet(pain, session, blockIndex), undefined)
      const otherPlan = { ...structuredClone(state), weeks: [structuredClone(state.weeks[1])], selectedWeek: 0, pastPlans: [state] }
      assert.equal(lastRecordedBlockSet(otherPlan, session, blockIndex), undefined)
    })
    await t.test('future and unsubmitted values cannot become last records', () => {
      const missing = structuredClone(state)
      missing.weeks[0].logs = {}
      missing.setDrafts[`${session.id}:block-${blockIndex}:0`] = { weight: '99', reps: '10', effort: '9' }
      assert.equal(lastRecordedBlockSet(missing, session, blockIndex), undefined)
      const future = structuredClone(state)
      const earlier = future.weeks[0].plan.sessions.find(item => item.id === previous.id)!
      earlier.date = '2026-12-01'
      assert.equal(lastRecordedBlockSet(future, session, blockIndex), undefined)
    })
    await t.test('swap controls only notify the parent for remaining non-throw work', () => {
      const requested: number[] = []
      const name = state.weeks[1].input.library.exercises.find(item => item.id === block.exerciseId)!.name
      const props = {
        state, session, readOnly: false, update: () => assert.fail('A swap control must not change training'),
        onSwap: (index: number) => { requested.push(index) },
      }
      const findSwap = (tree: ReactNode) => findElement(tree, element => element.props['aria-label'] === `Swap remaining work for ${name}`)
      const before = structuredClone(state)
      assert.equal(requested.length, 0)
      const swap = findSwap(TemplateWorkout(props))
      assert.ok(swap?.props.onClick)
      swap.props.onClick()
      assert.deepEqual(requested, [blockIndex])
      assert.deepEqual(state, before)
      assert.equal(findSwap(TemplateWorkout({ ...props, onSwap: undefined })), undefined)
      assert.equal(findSwap(TemplateWorkout({ ...props, readOnly: true })), undefined)
      const logged = structuredClone(state)
      logged.weeks[1].logs[session.id] = {
        sessionId: session.id, status: 'partial', painFlag: false, notes: '',
        blockLogs: [{ unit: 'reps', blockIndex, exerciseId: block.exerciseId,
          sets: Array.from({ length: block.sets }, () => ({ ...actual, actualRPE: 6.5 as const })) }],
      }
      assert.equal(findSwap(TemplateWorkout({ ...props, state: logged })), undefined)
      const record = logged.weeks[1].logs[session.id].blockLogs![0]
      assert.ok(record.unit === 'reps')
      record.sets = record.sets.slice(0, -1)
      assert.ok(findSwap(TemplateWorkout({ ...props, state: logged })))
      const timedExercise = state.weeks[1].input.library.exercises.find(item => item.template === 'mobility')!
      assert.ok(timedExercise)
      const timed: WorkoutSession = {
        ...session, blocks: [{ unit: 'seconds', exerciseId: timedExercise.id, sets: 2, seconds: 20, role: 'mobility', executionStyle: 'controlled' }],
      }
      const hasAnySwap = (tree: ReactNode) => Boolean(findElement(tree, element => element.type === 'button' && element.props.children === 'Swap remaining work'))
      assert.equal(hasAnySwap(TemplateWorkout({ ...props, session: timed })), true)
      logged.weeks[1].logs[session.id].blockLogs = [{ unit: 'seconds', blockIndex: 0, exerciseId: timedExercise.id, seconds: 40 }]
      assert.equal(hasAnySwap(TemplateWorkout({ ...props, state: logged, session: timed })), false)
      logged.weeks[1].logs[session.id].blockLogs = [{ unit: 'seconds', blockIndex: 0, exerciseId: timedExercise.id, seconds: 15 }]
      assert.equal(hasAnySwap(TemplateWorkout({ ...props, state: logged, session: timed })), true)
      const throwing: WorkoutSession = {
        ...session, discipline: 'sport', modality: 'court_sport',
        blocks: [{ unit: 'throws', drillId: 'dodgeball-controlled-target-throw', throws: 20, intent: 'controlled_technique', embedded: true }],
      }
      assert.equal(hasAnySwap(TemplateWorkout({ ...props, session: throwing })), false)
    })
    await t.test('throwing blocks use saved custom identities and library names, not generic drill labels', () => {
      const custom = structuredClone(state)
      custom.weeks[1].input.athlete.program!.customSportDrills = [{
        version: 1, id: 'custom-standing-target', name: 'My standing target throw', profileId: 'controlled_target_throw',
        requirements: ['dodgeball', 'court_space', 'safe_target'], description: 'My saved target setup.',
        focus: 'Aim at the established target.', why: 'A familiar practice movement.',
      }]
      const throwing: WorkoutSession = {
        ...session, discipline: 'sport', modality: 'court_sport',
        blocks: [{ unit: 'throws', drillId: 'custom-standing-target', throws: 20, intent: 'controlled_technique', embedded: true }],
      }
      const render = () => renderToStaticMarkup(createElement(TemplateWorkout, {
        state: custom, session: throwing, readOnly: true, update: () => assert.fail('Rendering must not change training'),
      }))
      const html = render()
      assert.match(html, /<h2>My standing target throw<\/h2>/)
      assert.match(html, /My saved target setup/)
      assert.match(html, /stop when technique deteriorates or pain appears/)
      assert.doesNotMatch(html, /<h2>Controlled target throws<\/h2>/)
      custom.weeks[1].input.library.exercises = [...custom.weeks[1].input.library.exercises, {
        ...custom.weeks[1].input.library.exercises[0], id: 'custom-standing-target', name: 'Frozen library throwing name',
      }]
      assert.match(render(), /<h2>Frozen library throwing name<\/h2>/)
    })
  } finally { hooks.deregister() }
})
