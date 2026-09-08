import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { buildCampaign, confirmSetupEquipment, exampleCampaign } from './model.ts'
import { buildWeekReview } from './week-review.ts'
import { moveWorkoutCard } from './workout-cards.ts'
import type { WorkoutCard } from './workout-cards.ts'
import type { AuthoredWeekProposal } from '../../engine/authored-week.ts'

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
    assert.match(chat, />Copy brief<\/button>/)
    assert.match(chat, /Paste final reply/)
    assert.doesNotMatch(chat, /Download brief|upload reply|type="file"/i)
    assert.match(chat, /select this preview and copy it manually/)
    assert.match(chat, /aria-label="Coaching brief preview"[^>]*readonly/i)
    assert.ok(chat.indexOf('aria-label="Coaching brief preview"') < chat.indexOf('>Copy brief</button>'))
    assert.match(chat, /<details class="cf-details"><summary>Add a request<\/summary>/)
    assert.match(chat, /Your request \(optional\)<textarea maxlength="500"/i)
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
    const fullWeek = renderToStaticMarkup(createElement(CoachingWorkbench, {
      ...props,
      state: { ...props.state, draft: { ...props.state.draft,
        trainingPreferences: { version: 1, runsPerWeek: 3, runDurationMin: 45, liftsPerWeek: 2, liftDurationMin: 45 },
        trainingHistory: { version: 1, units: 'metric', confirmed: true, activities: [{
          source: 'garmin_csv', localTimestamp: '2026-09-06T08:00:00', type: 'running', durationMin: 30,
        }] },
      } },
      config: { endpoint: 'https://fake.invalid/chat/completions', model: 'fake-model', apiKey: 'FAKE-NOT-A-SECRET' },
    }))
    assert.match(fullWeek, /Plan your week with AI/)
    assert.match(fullWeek, /AI chat is recommended/)
    assert.match(fullWeek, /1\. Copy brief/)
    assert.match(fullWeek, /2\. Discuss in chat/)
    assert.match(fullWeek, /3\. Paste final reply/)
    assert.match(fullWeek, />Copy brief<\/button>/)
    assert.doesNotMatch(fullWeek, /Download brief|upload reply|type="file"/i)
    assert.doesNotMatch(fullWeek, /type="password"/)
    for (const url of ['https://chatgpt.com', 'https://claude.ai', 'https://duck.ai']) assert.ok(fullWeek.includes(`href="${url}"`))
    assert.match(fullWeek, /Free limits, account requirements and privacy policies vary/)
    const sharing = fullWeek.match(/<details class="cf-details"><summary>What I&#x27;m sharing<\/summary>(.*?)<\/details>/s)?.[1]
    assert.ok(sharing)
    assert.match(sharing, /full exercise library is not shared/)
    assert.match(sharing, /not a required menu/)
    assert.match(sharing, /No original files, activity titles, locations, prior plan records, credentials or full backup/)
    assert.match(fullWeek, /Confirm recent training—not just your desired routine/)
    assert.match(fullWeek, /Include a summary of my reviewed activity history/)
    assert.match(fullWeek, /No individual rows, titles, locations or original file\. Gaps remain unknown/)
    assert.match(fullWeek, /Coaching brief character count/)
    assert.match(fullWeek, /15,999 characters/)
    assert.doesNotMatch(fullWeek, /type="checkbox"[^>]*checked/)
    assert.doesNotMatch(fullWeek, /2026-09-06T08:00:00/)
    assert.doesNotMatch(fullWeek, /maxlength="131072"/)
    const committed = buildCampaign({ ...props.state, draft: { ...props.state.draft, confirmed: true } })
    const weekly = renderToStaticMarkup(createElement(CoachingWorkbench, {
      ...props,
      state: { ...props.state, draft: { ...committed.draft, confirmed: false } },
      scope: { purpose: 'suggest_exercises', weekReview: buildWeekReview(committed), nextWeekStart: '2026-09-14' },
    }))
    assert.match(weekly, /Uses your confirmed training baseline; approving a week does not replace it/)
    assert.doesNotMatch(weekly, /Confirm recent training—not just your desired routine/)
    assert.match(weekly, />Copy brief<\/button>/)

    const { default: FullWeekProposalReview, AuthoredWeekPreview } = await import('./full-week-handoff.tsx')
    const preview = renderToStaticMarkup(createElement(FullWeekProposalReview, {
      acknowledged: false, onAcknowledge() { assert.fail('Rendering cannot acknowledge current training') },
      exerciseNames: { 'push-up': 'Push-up', 'custom-target-lanes': 'Target lanes' },
      drillsAcknowledged: false,
      onAcknowledgeDrills() { assert.fail('Rendering cannot approve a throwing drill') },
      reply: {
        format: 'hybrid-coach-reply', version: 3, contextId: 'review-only',
        summary: '', proposal: null, customExercises: [], customSportDrills: [{
          version: 1, id: 'custom-target-lanes', name: 'Target lanes', profileId: 'controlled_target_throw',
          requirements: ['court_space', 'dodgeball', 'safe_target'],
          description: 'Use familiar controlled throws toward the established target.',
          focus: 'Keep the movement controlled.', why: 'A distinct familiar practice variation.',
        }, {
          version: 1, id: 'custom-target-rings', name: 'Target rings', profileId: 'controlled_target_throw',
          requirements: ['court_space', 'dodgeball', 'safe_target'],
          description: 'Use familiar controlled throws toward established target rings.',
          focus: 'Keep each throw controlled.', why: 'Another distinct familiar practice variation.',
        }], cards: [],
        currentTraining: { version: 1, source: 'chat', asOf: '2026-09-07',
          weeklyRunMinutes: 60, longestRunMinutes: 30, runsPerWeek: 2, liftsPerWeek: 2, liftDurationMin: 45 },
        week: { version: 1, weekStart: '2026-09-07', sessions: [{
          id: 'controlled-lifting', kind: 'workout', date: '2026-09-09', startTime: '08:00', durationMin: 30,
          label: 'Controlled lifting', blocks: [{ unit: 'reps', exerciseId: 'push-up', sets: 1, reps: 5, targetRPE: 6 }],
        }, {
          id: 'fixed-1-2026-09-07', kind: 'workout', date: '2026-09-08', startTime: '19:00', durationMin: 90,
          label: 'Target practice', sourceCommitmentId: 'practice-1',
          blocks: [{ unit: 'throws', drillId: 'custom-target-lanes', throws: 10 }],
        }] },
      },
    }))
    assert.match(preview, /Review reported current training/)
    assert.match(preview, /60 minutes across 2 runs/)
    assert.match(preview, /Longest comfortable run/)
    assert.match(preview, /I have checked these current-training facts/)
    assert.doesNotMatch(preview, /type="checkbox"[^>]*checked/)
    assert.match(preview, /Not checked or saved yet/)
    assert.match(preview, /Continue stages this proposal/)
    assert.match(preview, /2026-09-09 at 08:00/)
    assert.match(preview, /Push-up: 1 sets × 5 reps, target RPE 6/)
    assert.match(preview, /Review custom throwing drills/)
    assert.match(preview, /I have reviewed these throwing techniques/)
    assert.match(preview, /Target rings/)
    assert.match(preview, /toward established target rings/)
    assert.equal((preview.match(/Each drill keeps separate records and needs its own calibration/g) ?? []).length, 1)
    assert.equal((preview.match(/type="checkbox"/g) ?? []).length, 2)
    assert.match(preview, /Target lanes: 10 controlled throws/)
    assert.match(preview, /Inside fixed practice: practice-1/)
    assert.match(preview, /time skip is not fatigue/)
    const week: AuthoredWeekProposal = {
      version: 1, weekStart: '2026-09-07',
      sessions: Array.from({ length: 2 }, (_, group) => ({
        id: `session-${group}`, kind: 'workout', date: group ? '2026-09-11' : '2026-09-09',
        startTime: '08:00', durationMin: 30, label: `Reviewed session ${group}`,
        blocks: Array.from({ length: 4 }, (_, item) => ({
          unit: 'reps', exerciseId: `custom-movement-${group * 4 + item}`, sets: 1, reps: 5, targetRPE: 6,
        })),
      })),
    }
    const exerciseNames = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`custom-movement-${index}`, `Movement ${index}`]))
    const pending = renderToStaticMarkup(createElement(AuthoredWeekPreview, {
      week, exerciseNames, warnings: ['An actual-history check needs review.', 'Fixed practice stays unchanged.'],
    }))
    for (let index = 0; index < 8; index++) assert.ok(pending.includes(`Movement ${index}: 1 sets × 5 reps`))
    assert.match(pending, /Reviewed session 0/)
    assert.match(pending, /Reviewed session 1/)
    assert.match(pending, /An actual-history check needs review/)
    assert.match(pending, /Fixed practice stays unchanged/)
    assert.doesNotMatch(pending, /Review reported current training|Not checked or saved yet|Apply reviewed|I have reviewed/)
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
