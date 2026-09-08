import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { AI_ADVISORY_POLICY_VERSION } from '../../engine/constants.ts'
import { addDays } from '../../engine/dates.ts'
import { DEFAULT_LIBRARY } from '../../engine/library.ts'
import { buildCampaign, confirmSetupEquipment, emptyCampaign } from './model.ts'
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
      assert.match(html, /preferred week/)
      assert.match(html, /not your current training/)
      for (const label of ['Average minutes per run', 'Runs per week', 'Average minutes per lift', 'Lifts per week']) assert.ok(html.includes(label))
      assert.equal((html.match(/type="range"/g) ?? []).length, 4)
      assert.equal((html.match(/type="range"[^>]*max="14"/g) ?? []).length, 2)
      assert.equal((html.match(/type="range"[^>]*max="180"/g) ?? []).length, 2)
      assert.match(html, /An average, not a long-run limit/)
      assert.doesNotMatch(html, /cf-quick-choice|Other session lengths|Preferred run length|Preferred lifting length/)
      assert.match(html, /Import Garmin history \(optional\)/)
      for (const label of ['No kit', 'Home', 'Gym', 'Equipment name']) assert.ok(html.includes(label))
      assert.match(html, /<summary>Availability &amp; start date \(optional\)<\/summary>/)
      assert.match(html, /Club training &amp; fixed sessions/)
      assert.doesNotMatch(html, /<details[^>]*\bopen=|<textarea|cf-ai-teaser|Total time|weekly budget|Roughly \d|Dodgeball|Dodgeballs|Safe throwing|Court</i)
    })
    await t.test('sliders show weekly averages above an hour and retain exact existing preferences', () => {
      const state = { ...routine, draft: patchOnboardingDraft(routine.draft, {
        trainingPreferences: { version: 1, runsPerWeek: 14, runDurationMin: 90, liftsPerWeek: 2, liftDurationMin: 37 },
      }) }
      const before = structuredClone(state)
      const html = render(state)
      assert.match(html, /90 min × 14 = 1260 min\/week/)
      assert.match(html, /37 min × 2 = 74 min\/week/)
      assert.match(html, /value="90"/)
      assert.match(html, /value="37"/)
      assert.equal((html.match(/aria-valuetext=/g) ?? []).length, 4)
      assert.deepEqual(state, before)
      const standard = render({ ...state, draft: patchOnboardingDraft(state.draft, {
        trainingPreferences: { ...state.draft.trainingPreferences!, runsPerWeek: 2, runDurationMin: 30 },
      }) })
      assert.match(standard, /30 min × 2 = 60 min\/week/)
      const noRunning = render({ ...state, draft: patchOnboardingDraft(state.draft, {
        trainingPreferences: { ...state.draft.trainingPreferences!, runsPerWeek: 0 },
      }) })
      assert.match(noRunning, /No running requested/)
    })
    await t.test('final review has a condensed lineup, a single optional AI action and required confirmation', () => {
      const html = render(review)
      assert.match(html, /REVIEW YOUR WEEK/)
      assert.match(html, /cf-onboarding-lineup/)
      assert.match(html, /Exercises &amp; notes \(optional\)/)
      assert.equal((html.match(/class="cf-ai-teaser"/g) ?? []).length, 1)
      assert.match(html, /Discuss in AI chat · Recommended/)
      assert.match(html, /Enter current training without AI/)
      assert.match(html, /Create an exercise/)
      assert.match(html, /<input type="checkbox" required=""\/>/)
      assert.match(html, /Build my week/)
      assert.doesNotMatch(html, />Approve week</)
      const unassessed = render({ ...review, draft: { ...review.draft,
        trainingPreferences: { version: 1, runsPerWeek: 3, runDurationMin: 30, liftsPerWeek: 2, liftDurationMin: 45 },
      } })
      assert.doesNotMatch(unassessed, />Preview week<\/button>|>Approve week</)
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
    await t.test('staged weeks remain unchecked until preview and retain current-training confirmation', () => {
      const draft = patchOnboardingDraft(review.draft, { currentTraining: {
        version: 1, source: 'manual', asOf: '2026-09-07',
        runsPerWeek: 2, weeklyRunMinutes: 60, longestRunMinutes: 30, liftsPerWeek: 2, liftDurationMin: 45,
      } })
      const html = render({ ...review, draft, pendingWeek: { version: 1, weekStart: '2026-09-07', sessions: [] } })
      assert.match(html, /Week staged, not checked or saved/)
      assert.match(html, />Preview week<\/button>/)
      assert.match(html, /<input type="checkbox" required=""\/>/)
      assert.match(html, /I confirm the reported current training, not just my desired routine/)
      assert.match(html, /Build my week/)
      assert.doesNotMatch(html, />Approve week</)
    })
    await t.test('local assessment keeps actual-training fields and limitations explicit', async () => {
      const { default: CurrentTrainingForm } = await import('./CurrentTrainingForm.tsx')
      const html = renderToStaticMarkup(createElement(CurrentTrainingForm, {
        draft: review.draft, onChange() { assert.fail('Rendering cannot save training facts') },
      }))
      assert.match(html, /comfortable training—not your target/)
      assert.match(html, /cannot establish comfort, missing activities or working weights/)
      assert.match(html, /Zero activity and frequent training are valid reports/)
      assert.match(html, /built-in planner has narrower baseline limits/)
      assert.equal((html.match(/type="number"/g) ?? []).length, 5)
      assert.match(html, /type="date"/)
      assert.match(html, />Add to review<\/button>/)
    })
    await t.test('Garmin help is optional and only pending history offers a consent-gated save', async () => {
      const { default: TrainingHistoryImport } = await import('./TrainingHistoryImport.tsx')
      const props = { asOfDate: '2026-09-07', onChange() { assert.fail('Rendering cannot import history') } }
      const empty = renderToStaticMarkup(createElement(TrainingHistoryImport, props))
      assert.match(empty, /read on this device—not uploaded/)
      assert.match(empty, /Titles and locations are removed/)
      assert.match(empty, /does not set your baseline or mark workouts complete/)
      assert.match(empty, /<details class="cf-details"><summary>CSV help<\/summary>/)
      assert.match(empty, /not your preferred display units/)
      assert.match(empty, /type="file"[^>]*disabled=""/)
      assert.doesNotMatch(empty, /Save training history/)
      const history = {
        version: 1 as const, units: 'metric' as const, confirmed: true,
        activities: [{ source: 'garmin_csv' as const, localTimestamp: '2026-09-06T08:00:00', type: 'running' as const, durationMin: 30 }],
      }
      const saved = renderToStaticMarkup(createElement(TrainingHistoryImport, { ...props, value: history }))
      assert.match(saved, /Saved and reviewed for the period shown/)
      assert.match(saved, /Missing training remains unknown/)
      assert.match(saved, /Remove imported history/)
      assert.doesNotMatch(saved, /Save training history|type="checkbox"/)
      const pending = renderToStaticMarkup(createElement(TrainingHistoryImport, { ...props, value: { ...history, confirmed: false } }))
      assert.match(pending, /These records represent the period shown; any missing training still needs discussion/)
      assert.match(pending, /type="checkbox" required=""/)
      assert.doesNotMatch(pending, /type="checkbox"[^>]*checked/)
      assert.match(pending, /disabled=""[^>]*>Save training history/)
    })
    await t.test('checked previews keep prescriptions, warnings and omissions visible without claiming completion', async () => {
      const { default: WeekPlanPreview } = await import('./WeekPlanPreview.tsx')
      const draft = patchOnboardingDraft(review.draft, { currentTraining: {
        version: 1, source: 'manual', asOf: '2026-09-07',
        runsPerWeek: 2, weeklyRunMinutes: 60, longestRunMinutes: 30, liftsPerWeek: 2, liftDurationMin: 45,
      } })
      const week = buildCampaign({ ...review, draft: { ...draft, confirmed: true } }).weeks[0]!
      const html = renderToStaticMarkup(createElement(WeekPlanPreview, {
        plan: { ...week.plan, warnings: ['Synthetic check note'], omitted: [{ sessionId: 'synthetic-omission', reason: 'Synthetic omitted work' }] },
        library: week.input.library, program: week.input.athlete.program,
      }))
      assert.match(html, /App checks passed—not medical clearance or a technique assessment/)
      assert.match(html, /Nothing is logged until you record it/)
      assert.match(html, /<details class="cf-details" open=""><summary>App checks and assumptions<\/summary>/)
      assert.match(html, /Synthetic check note/)
      assert.match(html, /role="status"[^>]*>Synthetic omitted work/)
      assert.match(html, /reps, RPE/)
      assert.match(html, /2026-09-/)
      const longWeek = buildCampaign({
        ...review, draft: { ...draft, confirmed: true },
        pendingWeek: { version: 1, weekStart: draft.startDate, sessions: [{
          id: 'preview-long-run', kind: 'run', label: 'Long run', date: draft.startDate,
          startTime: '07:00', durationMin: 95, modality: 'run_road', intent: 'long',
        }] },
      }).weeks[0]!
      const originalWarnings = [
        '[longestRun] run-a: Advisory only: A run exceeds your reported longest run.',
        '[longestRun] run-b: Advisory only: A run exceeds your reported longest run.',
        'A reported pain concern remains unresolved.',
      ]
      const longPreview = renderToStaticMarkup(createElement(WeekPlanPreview, {
        plan: { ...longWeek.plan, warnings: originalWarnings },
        library: longWeek.input.library, program: longWeek.input.athlete.program,
      }))
      assert.match(longPreview, /<h4>Long easy run<\/h4>/)
      assert.match(longPreview, /95 min/)
      assert.equal((longPreview.match(/A run exceeds your reported longest run/g) ?? []).length, 1)
      assert.match(longPreview, /A reported pain concern remains unresolved/)
      assert.doesNotMatch(longPreview, /run-a|run-b/)
      assert.equal(originalWarnings.length, 3)
      const advisory = renderToStaticMarkup(createElement(WeekPlanPreview, {
        plan: { ...week.plan, policyVersion: AI_ADVISORY_POLICY_VERSION },
        library: week.input.library, program: week.input.athlete.program,
      }))
      assert.match(advisory, /Hard data and equipment checks passed/)
      assert.match(advisory, /warnings are advisory, not failed data checks/)
      assert.match(advisory, /Training advisories and assumptions/)
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
        assert.match(render({ ...routine, step: 1, draft: { ...routine.draft, startDate } }), /Choose a complete start date/)
      }
    })
    await t.test('the start picker preserves any chosen weekday and explains rolling weeks', () => {
      for (let day = 0; day < 7; day++) {
        const startDate = addDays('2026-09-07', day)
        const state = { ...routine, draft: patchOnboardingDraft(routine.draft, { startDate }) }
        const before = structuredClone(state)
        const html = render(state)
        assert.ok(html.includes(`Plan starts<input type="date" value="${startDate}"`))
        assert.match(html, /Each week runs for seven days from your start date/)
        assert.match(html, /Club sessions stay on their chosen weekdays/)
        assert.doesNotMatch(html, /Block starts \(Monday\)|Choose a (?:complete )?Monday/)
        assert.deepEqual(state, before)
      }
    })
    await t.test('fresh and saved setup keep generic club options without exposing throwing controls', async () => {
      const { ProgrammingChoice } = await import('./ProgrammingOptions.tsx')
      const old = { ...base.draft }
      const oldHtml = renderToStaticMarkup(createElement(ProgrammingChoice, { draft: old, onChange() { assert.fail('No hidden upgrade') } }))
      assert.match(oldHtml, /Upgrade this draft/)
      assert.match(oldHtml, /unless you choose to upgrade/)
      const saved = confirmSetupEquipment(routine, ['floor_space', 'dodgeballs', 'court', 'safe_target'])
      saved.draft = { ...saved.draft, goalKind: 'dodgeball', practiceDays: [1], program: { ...saved.draft.program!, goal: 'dodgeball', comfortableThrowsPerPractice: 20 } }
      for (const candidate of [routine, saved]) {
        const before = structuredClone(candidate)
        const html = render(candidate)
        assert.match(html, /Club training &amp; fixed sessions/)
        assert.match(html, /Club training or fixed activity days/)
        assert.doesNotMatch(html, /Saved legacy practice ceiling|throws per practice|Practice throwing baseline|Target throw/i)
        if (candidate.draft.practiceDays.length) {
          assert.match(html, /Club session starts at<input type="time"/)
          assert.match(html, /Club session duration/)
        }
        assert.deepEqual(candidate, before)
      }
      assert.equal(saved.draft.program!.comfortableThrowsPerPractice, 20)
    })
  } finally { hooks.deregister() }
})
