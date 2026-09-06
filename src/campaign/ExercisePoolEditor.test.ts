import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type { ExerciseChoice } from './ExercisePoolEditor.tsx'

test('exercise pool exposes meaningful execution variants and guidance without editable dose fields', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Choosing exercises must work offline'))
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
    const { default: ExercisePoolEditor } = await import('./ExercisePoolEditor.tsx')
    const choices: ExerciseChoice[] = ['controlled', 'slow'].map(execution => ({
      family: 'test-squat', execution: execution === 'slow' ? 'Slow lowering' : 'Controlled',
      prescription: 'Engine-owned starting ceiling',
      exercise: {
        id: `test-squat-${execution}`, name: `Test squat ${execution}`, pattern: 'knee_dominant',
        equipment: ['bodyweight'], coefficients: { systemic: 1, structural: 1 }, competesWithRunning: true, highSkill: false,
      },
    }))
    const html = renderToStaticMarkup(createElement(ExercisePoolEditor, {
      choices, selected: ['test-squat-controlled'], maxExercises: 16, goal: 'Dodgeball', resources: [], cards: [],
      onChange() { assert.fail('Rendering cannot select exercises') }, onCards() { assert.fail('Rendering cannot save notes') },
    }))
    assert.match(html, /Execution style/)
    assert.match(html, /Slow lowering/)
    assert.match(html, /Description/)
    assert.match(html, /What to focus on/)
    assert.match(html, /Why this exercise/)
    assert.match(html, /Loads are never copied from another variant/)
    assert.match(html, /not one repeated list/)
    assert.match(html, /Edit description &amp; notes/)
    assert.doesNotMatch(html, /type="number"|type="password"/)
  } finally { hooks.deregister() }
})
