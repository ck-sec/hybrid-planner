import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { DEFAULT_LIBRARY } from '../../engine/library.ts'
import { confirmSetupEquipment, emptyCampaign } from './model.ts'
import { addOnboardingCustomExercise, advanceOnboarding, patchOnboardingDraft } from './onboarding.ts'
import type { CampaignState } from './types.ts'
import { parseWorkoutCards } from './workout-cards.ts'

test('onboarding presents three sport-neutral stages with optional AI only at the end', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Onboarding must not contact a model without consent'))
  const directory = new URL('./', import.meta.url).href
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (url.startsWith(directory) && url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' }
      if (!url.startsWith(directory) || !url.endsWith('.tsx')) return nextLoad(url, context)
      return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
      }).outputText }
    },
  })
  try {
    const { default: CampaignSetup } = await import('./CampaignSetup.tsx')
    const render = (state: CampaignState) => renderToStaticMarkup(createElement(CampaignSetup, {
      state, update() { assert.fail('Rendering cannot rewrite saved answers') },
      onAI() { assert.fail('Rendering cannot call AI') }, connected: false, onDisconnect() {},
    }))
    const base = emptyCampaign('2026-09-07')
    const routine = advanceOnboarding({ ...base, draft: patchOnboardingDraft(base.draft, {}, { goalText: 'Feel stronger for the activities I enjoy' }) })
    const review = advanceOnboarding({
      ...routine, draft: patchOnboardingDraft(routine.draft, {
        resources: ['floor_space'], runsPerWeek: 3, liftsPerWeek: 2, liftDurationMin: 45,
      }, { typicalRunMinutes: 30 }),
    })

    await t.test('welcome and goal are one stage with ordinary text and an optional date', () => {
      for (const step of [0, 1]) {
        const html = render({ ...base, step })
        assert.match(html, /<textarea[^>]*required=""/)
        assert.match(html, /Your goal/)
        assert.match(html, /Event date \(optional\)/)
        assert.match(html, /12-week progress review on 2026-11-29/)
        assert.match(html, /<input type="date"[^>]*min="2026-09-07"[^>]*max="2027-09-05"/)
        assert.doesNotMatch(html, /<input type="date"[^>]*required=/)
        assert.match(html, /never infer dates/)
        assert.doesNotMatch(html, /Classic run|Build around my goal|Goal focus|Training priorities|Shape my goal|Set this goal without AI|Bangkok|Dodgeball/i)
        assert.doesNotMatch(html, /cf-ai-teaser|What can you train with|A usual easy run|type="password"/)
      }
    })
    await t.test('routine collects session answers once, with simple gear and collapsed extras', () => {
      const html = render(routine)
      assert.match(html, /A usual easy run lasts about/)
      assert.match(html, /Runs in a normal week/)
      assert.match(html, /A usual lifting session lasts about/)
      assert.match(html, /Lifts in a normal week/)
      for (const label of ['No kit', 'Home', 'Gym', 'Equipment name']) assert.ok(html.includes(label))
      assert.match(html, /<summary>Availability &amp; fixed sessions \(optional\)<\/summary>/)
      assert.doesNotMatch(html, /<details[^>]*\bopen=|<textarea|cf-ai-teaser|Total time|weekly budget|Roughly \d|Dodgeball|Dodgeballs|Safe throwing|Court</i)
    })
    await t.test('final review has a condensed lineup, a single optional AI action and required confirmation', () => {
      const html = render(review)
      assert.match(html, /A COMPLETE PLAN, WITHOUT AI/)
      assert.match(html, /cf-onboarding-lineup/)
      assert.match(html, /Edit the lineup or add notes \(optional\)/)
      assert.equal((html.match(/class="cf-ai-teaser"/g) ?? []).length, 1)
      assert.match(html, /Optional: refine with AI or chat/)
      assert.match(html, /Create an exercise/)
      assert.match(html, /<input type="checkbox" required=""\/>/)
      assert.match(html, /Build my week/)
      assert.doesNotMatch(html, /Dodgeball|Dodgeballs|Bangkok|Goal focus|Training priorities|throwing-technique|throw count/i)
      assert.equal(review.draft.exercises.length, 0)
      for (const id of review.draft.recommendedSetup!.exerciseIds) {
        const name = DEFAULT_LIBRARY.exercises.find(item => item.id === id)!.name
        assert.ok(html.includes(name))
      }
    })
    await t.test('custom exercises appear by their human name in the final lineup', () => {
      const result = addOnboardingCustomExercise(review.draft, {
        version: 1, id: 'custom-comfortable-squat', name: 'Comfortable stance squat', profileId: 'controlled_squat',
        requirements: ['bodyweight', 'floor_space'],
        description: 'Squat through a comfortable range with control.', focus: 'Keep a steady stance.',
        why: 'A familiar controlled movement for the goal.',
      })
      const cards = parseWorkoutCards([{
        id: 'my-custom-squat-note', exerciseId: 'custom-comfortable-squat', title: 'My custom setup note',
        purpose: '', instructions: 'Keep the movement controlled.', cues: '', resources: ['floor_space'],
        source: 'user', status: 'reference',
      }], result.draft.program)
      assert.throws(() => parseWorkoutCards(cards), /unknown|supported|exercise/i)
      const html = render({ ...review, draft: result.draft, cards })
      assert.match(html, /<li>Comfortable stance squat<\/li>/)
      assert.match(html, /Revise a custom exercise/)
      assert.match(html, /My custom setup note/)
    })
    await t.test('exactly three named steps and one active section render at every stage', () => {
      for (const state of [base, routine, review]) {
        const html = render(state)
        const steps = html.match(/<ol>(.*?)<\/ol>/)?.[1] ?? ''
        assert.equal((steps.match(/<li\b/g) ?? []).length, 3)
        for (const name of ['Goal', 'Routine', 'Review &amp; build']) assert.ok(steps.includes(name))
        assert.match(html, /\/ 03/)
        assert.doesNotMatch(html, /\/ 06/)
        assert.equal((html.match(/<section class="cf-stack" aria-label=/g) ?? []).length, 1)
      }
    })
    await t.test('older numeric steps resume without mutation or a missing panel', () => {
      for (const [oldStep, label] of [[6, 'Routine'], [4, 'Routine'], [3, 'Review &amp; build']] as const) {
        const state = { ...review, step: oldStep }
        const before = structuredClone(state)
        assert.ok(render(state).includes(`<section class="cf-stack" aria-label="${label}">`))
        assert.deepEqual(state, before)
      }
    })
    await t.test('invalid saved start dates show actionable guidance instead of crashing', () => {
      for (const startDate of ['', '2026-09', '2026-02-31']) {
        assert.match(render({ ...routine, step: 1, draft: { ...routine.draft, startDate } }), /Choose a complete Monday start date/)
      }
    })
    await t.test('legacy programming is an explicit upgrade and an existing practice ceiling is read-only', async () => {
      const { ProgrammingChoice, PracticeBlockOptions } = await import('./ProgrammingOptions.tsx')
      const old = { ...base.draft }
      const oldHtml = renderToStaticMarkup(createElement(ProgrammingChoice, { draft: old, onChange() { assert.fail('No hidden upgrade') } }))
      assert.match(oldHtml, /Upgrade this draft/)
      assert.match(oldHtml, /unless you choose to upgrade/)
      assert.equal(renderToStaticMarkup(createElement(PracticeBlockOptions, { draft: old, onChange() {} })), '')
      const saved = confirmSetupEquipment(routine, ['floor_space'])
      saved.draft = { ...saved.draft, goalKind: 'dodgeball', practiceDays: [1], program: { ...saved.draft.program!, goal: 'dodgeball', comfortableThrowsPerPractice: 20 } }
      const before = structuredClone(saved)
      const html = renderToStaticMarkup(createElement(PracticeBlockOptions, { draft: saved.draft, onChange() { assert.fail('No hidden deletion') } }))
      assert.match(html, /Saved legacy practice ceiling: 20 throws per practice/)
      assert.doesNotMatch(html, /<input|<button|Dodgeball/i)
      assert.deepEqual(saved, before)
    })
  } finally { hooks.deregister() }
})
