import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type { ExerciseChoice } from './ExercisePoolEditor.tsx'
import type { CustomExerciseSpec } from '../../engine/types.ts'

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
    assert.match(html, /Each style has its own weight history/)
    assert.match(html, /Your plan spreads these across workouts/)
    assert.match(html, /<details class="cf-details"><summary>Edit Test squat controlled<\/summary>/)
    assert.match(html, />Notes<\/button>/)
    assert.doesNotMatch(html, /<details[^>]*\bopen=/)
    assert.doesNotMatch(html, /type="number"|type="password"/)
    await t.test('custom definitions keep their review details but share one technique notice', async () => {
      const { default: CustomExerciseCards } = await import('./CustomExerciseCards.tsx')
      const exercises = ['First familiar squat', 'Second familiar squat'].map((name, index): CustomExerciseSpec => ({
        version: 1, id: `custom-squat-${index}`, name, profileId: 'controlled_squat', requirements: ['bodyweight'],
        description: 'A familiar controlled squat.', focus: 'Maintain balance.', why: 'A lower-body exercise.',
      }))
      const cards = renderToStaticMarkup(createElement(CustomExerciseCards, { exercises }))
      for (const exercise of exercises) assert.ok(cards.includes(exercise.name))
      assert.equal((cards.match(/App checks do not assess technique/g) ?? []).length, 1)
      assert.equal((cards.match(/<dl>/g) ?? []).length, exercises.length)
      assert.doesNotMatch(cards, /<details/)
    })
  } finally { hooks.deregister() }
})
