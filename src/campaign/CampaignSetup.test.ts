import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { DEFAULT_LIBRARY } from '../../engine/library.ts'
import { recommendedExercises } from '../../engine/recommendations.ts'
import { emptyCampaign, normalizeRecommendedDraft } from './model.ts'
import type { CampaignState } from './types.ts'

test('recommended onboarding offers a complete classic path and an explicit AI brief', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Setup must not contact a model without consent'))
  const directory = new URL('./', import.meta.url).href
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith(directory) || !url.endsWith('.tsx')) return nextLoad(url, context)
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
    const { default: CampaignSetup } = await import('./CampaignSetup.tsx')
    const render = (state: CampaignState) => renderToStaticMarkup(createElement(CampaignSetup, {
      state, update() {}, onAI() {}, connected: false, onDisconnect() {},
    }))
    await t.test('classic direction needs no free-text goal or API key', () => {
      const state = { ...emptyCampaign('2026-09-07'), step: 1 }
      const html = render(state)
      assert.match(html, /Classic run \+ lift/)
      assert.match(html, /Build around my goal with AI/)
      assert.doesNotMatch(html, /<textarea|type="password"|Give your goal a name|Event \/ review date/)
      assert.equal(state.draft.exercises.length, 0)
    })
    await t.test('assisted direction starts with a free-text brief, not a sport menu', () => {
      const state = { ...emptyCampaign('2026-09-07'), step: 1 }
      assert.ok(state.draft.recommendedSetup)
      state.draft.recommendedSetup.mode = 'assisted'
      state.draft.goalLabel = ''
      state.draft.eventDate = ''
      const html = render(state)
      assert.match(html, /<textarea/)
      assert.match(html, /What are you building toward/)
      assert.match(html, /Connect AI &amp; shape my goal/)
      assert.doesNotMatch(html, /cf-goal-grid|Give your goal a name/)
    })
    await t.test('rhythm asks about sessions, not calculated weekly totals', () => {
      const html = render({ ...emptyCampaign('2026-09-07'), step: 2 })
      assert.match(html, /A usual easy run lasts about/)
      assert.match(html, /How many runs in a normal week/)
      assert.doesNotMatch(html, /Total time per week|Total time available/)
      assert.doesNotMatch(html, /<input[^>]*required/)
    })
    await t.test('revisiting a reviewed goal with an incomplete start date shows guidance rather than crashing', () => {
      for (const startDate of ['', '2026-09', '2026-02-31']) {
        const state = { ...emptyCampaign('2026-09-07'), step: 1 }
        assert.ok(state.draft.recommendedSetup)
        state.draft.recommendedSetup.mode = 'assisted'
        state.draft.goalLabel = 'Reviewed goal'
        state.draft.startDate = startDate
        assert.match(render(state), /Confirm your block start in Your week/)
      }
    })
    await t.test('equipped exercise cards are populated without fake observations or weight inputs', () => {
      const state = { ...emptyCampaign('2026-09-07'), step: 3 }
      assert.ok(state.draft.recommendedSetup)
      state.draft.equipment = ['bodyweight', 'dumbbell']
      state.draft.recommendedSetup.exerciseIds = [...recommendedExercises(state.draft.equipment)]
      state.draft = normalizeRecommendedDraft(state.draft)
      assert.ok(state.draft.recommendedSetup)
      const html = render(state)
      assert.equal(state.draft.exercises.length, 0)
      assert.ok(state.draft.recommendedSetup.exerciseIds.length > 0)
      for (const id of state.draft.recommendedSetup.exerciseIds) {
        const exercise = DEFAULT_LIBRARY.exercises.find(entry => entry.id === id)
        assert.ok(exercise)
        assert.ok(html.includes(exercise.name))
      }
      assert.match(html, /cf-recommendation-card/)
      assert.match(html, /Add or change exercises with AI/)
      assert.doesNotMatch(html, /<input|Add a familiar exercise|Last working weight|When was that session/)
    })
  } finally {
    hooks.deregister()
  }
})
