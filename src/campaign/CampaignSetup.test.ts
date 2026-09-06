import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { DEFAULT_LIBRARY } from '../../engine/library.ts'
import { recommendedExercises } from '../../engine/recommendations.ts'
import { buildCampaign, confirmSetupEquipment, emptyCampaign, exampleCampaign, normalizeRecommendedDraft } from './model.ts'
import type { CampaignState } from './types.ts'

test('recommended onboarding offers a complete classic path and an explicit AI brief', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Setup must not contact a model without consent'))
  const directory = new URL('./', import.meta.url).href
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (url.startsWith(directory) && url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' }
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
      assert.match(html, /Build around my goal/)
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
      assert.match(html, /Shape my goal/)
      assert.match(html, /Set this goal without AI/)
      assert.match(html, /Goal focus/)
      assert.match(html, /Training priorities/)
      assert.match(html, /Event \/ review date \(required before continuing\)/)
      assert.match(html, /<input type="date"[^>]*min="2026-09-07"[^>]*max="2027-09-05"[^>]*required=""/)
      assert.match(html, /including the year/)
      assert.match(html, /You can ask AI first, but a date is required to continue/)
      assert.match(html, /For a later event, choose an earlier review date/)
      assert.match(html, /Editing the brief clears this choice/)
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
      assert.match(html, /Shape sessions with my AI/)
      assert.match(html, /Customise Goblet squat/)
      assert.match(html, /Personal notes &amp; unscheduled drill ideas/)
      assert.doesNotMatch(html, /Last working weight|When was that session|type="number"/)
    })
    await t.test('equipment is an early step with cardio and sport resources, not invented exercise availability', () => {
      const html = render({ ...emptyCampaign('2026-09-07'), step: 6 })
      assert.match(html, /Your equipment/)
      assert.match(html, /Rower/)
      assert.match(html, /SkiErg/)
      assert.match(html, /Dodgeballs/)
      assert.match(html, /Every recommendation and AI brief uses this selection/)
      assert.match(html, /expanded exercise library is included/)
      assert.doesNotMatch(html, /Use template-based sessions/)
      assert.doesNotMatch(html, /type="password"|<textarea/)
    })
    const { default: CoachingWorkbench } = await import('./CoachingWorkbench.tsx')
    const workspace = (state: CampaignState) => renderToStaticMarkup(createElement(CoachingWorkbench, {
      state, scope: { purpose: 'interpret_goal' }, onConnect() {}, onApply: () => true,
      onCards() {}, onClose() {}, onConfirmEquipment: () => true, onRevise() {},
    }))
    await t.test('old unfinished drafts cannot silently export the small catalog', () => {
      const html = workspace(exampleCampaign('2026-09-07'))
      assert.match(html, /Use the expanded exercise library/)
      assert.match(html, /Use this equipment &amp; continue/)
      assert.doesNotMatch(html, /Copy coaching brief|Download brief|Paste final AI reply|Request suggestions/)
    })
    await t.test('the normal confirmed equipment path exposes an expanded, clearly labelled brief', () => {
      const state = confirmSetupEquipment(exampleCampaign('2026-09-07'), ['kettlebell', 'floor_space', 'carry_space'])
      const html = workspace(state)
      assert.match(html, /Expanded exercise library/)
      assert.match(html, /equipped movements/)
      assert.match(html, /not the library size/)
      assert.match(html, /Copy coaching brief/)
      assert.match(html, /older brief/)
      assert.doesNotMatch(html, /Use this equipment &amp; continue/)
    })
    await t.test('existing plans keep their library and offer a direct future-week revision', () => {
      const sample = exampleCampaign('2026-09-07')
      const state = buildCampaign({ ...sample, draft: { ...sample.draft, confirmed: true } })
      const before = structuredClone(state)
      const html = workspace(state)
      assert.match(html, /plan still uses the original exercise library/)
      assert.match(html, /Change next week&#x27;s exercises/)
      assert.deepEqual(state, before)
    })
  } finally {
    hooks.deregister()
  }
})
