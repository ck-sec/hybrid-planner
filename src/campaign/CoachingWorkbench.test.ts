import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { confirmSetupEquipment, exampleCampaign } from './model.ts'
import { moveWorkoutCard } from './workout-cards.ts'
import type { WorkoutCard } from './workout-cards.ts'

test('workspace offers a key-free chat roundtrip and does not connect on render', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Opening the workspace cannot connect'))
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
    const { default: CoachingWorkbench } = await import('./CoachingWorkbench.tsx')
    const props = {
      state: confirmSetupEquipment(exampleCampaign('2026-09-07'), ['floor_space', 'dumbbell']), scope: { purpose: 'interpret_goal' as const },
      onConnect() { assert.fail('Rendering cannot connect') }, onApply() { assert.fail('Rendering cannot apply'); return false },
      onCards() {}, onClose() {}, onConfirmEquipment() { assert.fail('Rendering cannot confirm equipment') },
    }
    const chat = renderToStaticMarkup(createElement(CoachingWorkbench, props))
    assert.match(chat, /Copy coaching brief/)
    assert.match(chat, /Download brief/)
    assert.match(chat, /Paste final AI reply/)
    assert.match(chat, /Or upload reply/)
    assert.match(chat, /Review reply/)
    assert.match(chat, /Built-in/)
    assert.doesNotMatch(chat, /type="password"/)
    const api = renderToStaticMarkup(createElement(CoachingWorkbench, { ...props, config: {
      endpoint: 'https://fake.invalid/chat/completions', model: 'fake-model', apiKey: 'FAKE-NOT-A-SECRET',
    } }))
    assert.match(api, /including after setup/)
    assert.match(api, /Connection: fake-model/)
    assert.match(api, /type="password"/)
    assert.doesNotMatch(api, /type="checkbox"[^>]*checked/ )
    assert.match(api, /disabled=""[^>]*>Request suggestions/)
  } finally { hooks.deregister() }
})

test('notebook order is editable without modifying any card identity or dose', () => {
  const first: WorkoutCard = {
    id: 'first', exerciseId: null, title: 'First idea', purpose: '', instructions: '', cues: '', resources: [], source: 'user', status: 'draft',
  }
  const cards = [first, { ...first, id: 'second', title: 'Second idea' }]
  const before = structuredClone(cards)
  assert.deepEqual(moveWorkoutCard(cards, 'second', -1).map(card => card.id), ['second', 'first'])
  assert.deepEqual(cards, before)
  assert.throws(() => moveWorkoutCard(cards, 'first', -1), /cannot move/)
})
