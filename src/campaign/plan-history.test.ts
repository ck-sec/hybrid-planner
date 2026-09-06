import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { addDays } from '../../engine/dates.ts'
import { RECOMMENDATION_POLICY } from '../../engine/constants.ts'
import { stageCustomExercises } from './custom-exercises.ts'
import { buildHandoff } from './handoff.ts'
import {
  adaptCampaign, buildCampaign, completeCampaignSession, confirmSetupEquipment,
  emptyCampaign, exampleCampaign, logCampaignBlockSet, MAX_PAST_PLANS,
  nextCampaignWeek, normalizeRecommendedDraft, parseCampaign,
} from './model.ts'
import { startNewPlan, trainingRecords } from './plan-history.ts'
import { selectProgramExercises } from './programming.ts'
import { buildWeekReview } from './week-review.ts'
import type { CampaignState } from './types.ts'

function planned(): CampaignState {
  const source = exampleCampaign('2026-09-07')
  const equipped = confirmSetupEquipment({
    ...source, sample: false, draft: {
      ...source.draft, goalKind: 'custom', goalLabel: 'Original fitness plan',
      location: '', eventDate: '2026-12-04', practiceDays: [], priorities: ['aerobic_base', 'max_strength'],
      recommendedSetup: { ...source.draft.recommendedSetup!, goalText: 'Build balanced fitness' },
    },
  }, ['kettlebell', 'floor_space', 'carry_space'])
  const custom = {
    version: 1, id: 'custom-floor-core', name: 'My floor core', profileId: 'controlled_core',
    requirements: ['bodyweight', 'floor_space'], description: 'Move an arm with a steady trunk.',
    focus: 'Keep a comfortable range.', why: 'A familiar trunk-control movement.',
  }
  const draft = selectProgramExercises(stageCustomExercises(equipped.draft, [custom]), [
    'kettlebell-goblet-squat', 'push-up', 'custom-floor-core', 'kettlebell-suitcase-carry',
  ])
  return buildCampaign({ ...equipped, draft: normalizeRecommendedDraft({ ...draft, confirmed: true }) })
}

function recorded(): CampaignState {
  let state = planned()
  const workout = state.weeks[0].plan.sessions.find(session => session.kind === 'workout'
    && session.blocks.some(block => block.unit === 'reps' && block.exerciseId === 'custom-floor-core'))
  assert.ok(workout?.kind === 'workout')
  const index = workout.blocks.findIndex(block => block.unit === 'reps' && block.exerciseId === 'custom-floor-core')
  state = logCampaignBlockSet(state, workout.id, index, 0, { weight: '2', reps: '6', effort: '6' })
  state = completeCampaignSession(state, workout.id, workout.durationMin, 4, false)
  state.weeks[0].logs[workout.id].notes = 'PRIVATE-PREVIOUS-PLAN-NOTE'
  const run = state.weeks[0].plan.sessions.find(session => session.discipline === 'run')!
  return adaptCampaign(state, { type: 'skip', sessionId: run.id, reason: 'life' })
}

test('restart scraps the active calendar but preserves exact workouts, custom identities and skips', t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Starting a new plan is local'))
  const state = recorded()
  state.setDrafts['unsaved-entry'] = { weight: '12', reps: '8', effort: '' }
  const before = structuredClone(state)
  const next = startNewPlan(state, '2026-09-14')
  assert.deepEqual(state, before)
  assert.deepEqual(next.pastPlans, [before])
  assert.deepEqual(next.weeks, [])
  assert.deepEqual(next.setDrafts, {})
  assert.equal(next.revisions, undefined)
  assert.equal(next.selectedWeek, 0)
  assert.equal(next.setupComplete, false)
  assert.equal(next.step, 1)
  assert.equal(next.draft.confirmed, false)
  assert.deepEqual(next.draft.exercises, [])
  assert.deepEqual(next.draft.program, state.draft.program)
  assert.equal(next.draft.goalLabel, state.draft.goalLabel)
  assert.equal(next.draft.weeklyRunMinutes, state.draft.weeklyRunMinutes)
  assert.throws(() => buildCampaign(next), /Confirm/)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(next))), next)
  const records = trainingRecords(next)
  assert.equal(records.length, 2)
  assert.ok(records.every(record => record.previousPlan))
  assert.ok(records.some(record => record.log.status === 'skipped' && record.log.skipReason === 'life'))
  assert.ok(records.some(record => record.library.exercises.some(exercise => exercise.name === 'My floor core')))
  assert.equal(records.some(record => record.log.status === 'completed' && !Object.hasOwn(before.weeks[0].logs, record.session.id)), false)
})

test('rebuilding and restarting repeatedly retains read-only history without nested plans or reused records', () => {
  const first = recorded()
  const draft = startNewPlan(first, '2026-09-07')
  let second = buildCampaign({ ...draft, draft: { ...draft.draft, confirmed: true } })
  const duplicate = second.weeks[0].plan.sessions.find(session => first.weeks[0].logs[session.id]?.status === 'completed')!
  assert.ok(duplicate)
  second = completeCampaignSession(second, duplicate.id, duplicate.durationMin, 3, false)
  const records = trainingRecords(second)
  assert.equal(new Set(records.map(record => record.key)).size, records.length)
  assert.equal(records.filter(record => record.session.id === duplicate.id).length, 2)
  const third = startNewPlan(second, '2026-09-21')
  assert.equal(third.pastPlans?.length, 2)
  assert.ok(third.pastPlans?.every(plan => !Object.hasOwn(plan, 'pastPlans')))
  assert.deepEqual(third.pastPlans?.[0], first)
  const built = buildCampaign({ ...third, draft: { ...third.draft, confirmed: true } })
  assert.deepEqual(nextCampaignWeek(built).pastPlans, third.pastPlans)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(third))), third)
})

test('restart preserves partial work and pain records without confirming a new healthy baseline', () => {
  let state = planned()
  const workout = state.weeks[0].plan.sessions.find(session => session.kind === 'workout')!
  assert.ok(workout.kind === 'workout')
  const index = workout.blocks.findIndex(block => block.unit === 'reps')
  state = logCampaignBlockSet(state, workout.id, index, 0, { weight: '0', reps: '6', effort: '6' })
  const partial = startNewPlan(state, '2026-09-14')
  assert.equal(trainingRecords(partial)[0].log.status, 'partial')
  state = completeCampaignSession(state, workout.id, workout.durationMin, 5, true)
  const next = startNewPlan(state, '2026-09-14')
  assert.equal(trainingRecords(next)[0].log.painFlag, true)
  assert.equal(next.draft.confirmed, false)
  assert.throws(() => buildCampaign(next), /Confirm/)
  assert.deepEqual(parseCampaign(next), next)
})

test('restart rebases review dates, preserves future events and rejects invalid or unfinished starts', () => {
  const state = planned()
  const reviewDate = addDays(state.draft.startDate, RECOMMENDATION_POLICY.classicReviewOffsetDays)
  const withReview = buildCampaign({ ...emptyCampaign(state.draft.startDate), draft: { ...state.draft, eventDate: reviewDate } })
  assert.equal(startNewPlan(withReview, '2026-09-14').draft.eventDate, addDays('2026-09-14', RECOMMENDATION_POLICY.classicReviewOffsetDays))
  assert.equal(startNewPlan(state, '2026-09-14').draft.eventDate, state.draft.eventDate)
  assert.equal(startNewPlan(state, '2027-01-04').draft.eventDate, addDays('2027-01-04', RECOMMENDATION_POLICY.classicReviewOffsetDays))
  assert.throws(() => startNewPlan(state, '2026-09-15'), /Monday/)
  assert.throws(() => startNewPlan(emptyCampaign('2026-09-14'), '2026-09-14'), /already have a new plan/)
})

test('history restores strictly without changing older backup shape or accepting nested/forged plans', () => {
  const original = recorded()
  assert.deepEqual(parseCampaign(original), original)
  assert.equal(Object.hasOwn(parseCampaign(original), 'pastPlans'), false)
  const next = startNewPlan(original, '2026-09-14')
  assert.throws(() => parseCampaign({ ...next, pastPlans: [next] }), /unsupported fields/)
  assert.throws(() => parseCampaign({ ...next, pastPlans: [emptyCampaign('2026-09-14')] }), /saved calendar/)
  assert.throws(() => parseCampaign({ ...next, pastPlans: Array(MAX_PAST_PLANS + 1).fill(original) }), /bounded array/)
  const forged = structuredClone(next)
  forged.pastPlans![0].weeks[0].plan.sessions[0].durationMin += 100
  assert.throws(() => parseCampaign(forged))
})

test('new-plan AI briefs and weekly reviews do not silently share previous-plan records', () => {
  const next = startNewPlan(recorded(), '2026-09-14')
  const brief = buildHandoff(next, { purpose: 'interpret_goal' })
  assert.equal(brief.context.planLocked, false)
  assert.doesNotMatch(JSON.stringify(brief), /PRIVATE-PREVIOUS-PLAN-NOTE|pastPlans/)
  assert.equal(buildWeekReview(next), undefined)
})

test('confirmation and training history render without mutating data or hiding prior custom workout names', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('History and restart render offline'))
  const directory = new URL('../', import.meta.url).href
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
    const { default: NewPlanConfirmation } = await import('./NewPlanConfirmation.tsx')
    const { History } = await import('./CampaignApp.tsx')
    const state = recorded()
    const props = { state, ready: true, onBackup() {}, onCancel() {}, onConfirm() { assert.fail('Rendering cannot restart') } }
    const confirmation = renderToStaticMarkup(createElement(NewPlanConfirmation, props))
    assert.match(confirmation, /Replace this plan\?/)
    assert.match(confirmation, /Start new plan &amp; keep history/)
    assert.match(confirmation, /Keep current plan/)
    assert.match(confirmation, /Export backup first/)
    assert.match(confirmation, /Unlogged workouts are not marked completed/)
    assert.match(renderToStaticMarkup(createElement(NewPlanConfirmation, { ...props, ready: false })), /disabled=""/)
    const history = renderToStaticMarkup(createElement(History, { state: startNewPlan(state, '2026-09-14') }))
    assert.match(history, /My floor core/)
    assert.match(history, /Previous plan:.*Original fitness plan/)
    assert.match(history, /Time skip/)
    assert.match(history, /PRIVATE-PREVIOUS-PLAN-NOTE/)
    assert.doesNotMatch(history, /<input|<button/)
  } finally { hooks.deregister() }
})
