import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { buildAuthoredWeek } from '../../engine/authored-week.ts'
import { proposalForSessions } from './authored-calendar.ts'
import { buildCampaign, confirmSetupEquipment, exampleCampaign, logCampaignBlockSet, parseCampaign } from './model.ts'
import { swapChoices, swapWorkoutExercise, SWAP_REASONS } from './exercise-swaps.ts'
import { buildWeekReview } from './week-review.ts'
import { stageCustomExercises } from './custom-exercises.ts'

function fixture(partial = false) {
  const initial = confirmSetupEquipment(exampleCampaign('2026-09-07'), ['dumbbell', 'floor_space', 'bench'])
  const draft = stageCustomExercises(initial.draft, [{
    version: 1, id: 'custom-steady-lunge', name: 'My steady lunge', profileId: 'controlled_unilateral',
    requirements: ['bodyweight', 'floor_space'], description: 'An approved familiar lunge.',
    focus: 'Keep a steady stance.', why: 'A familiar unilateral movement.',
  }])
  let state = buildCampaign({ ...initial, draft: { ...draft, confirmed: true } })
  const week = state.weeks[0]
  const session = week.plan.sessions.find(item => item.kind === 'workout' && item.discipline === 'strength')!
  assert.ok(session.kind === 'workout')
  const blockIndex = session.blocks.findIndex(block => block.unit === 'reps' && swapChoices(state, session.id, session.blocks.indexOf(block)).length > 0)
  assert.notEqual(blockIndex, -1)
  const replacementId = swapChoices(state, session.id, blockIndex)[0].id
  if (partial) {
    const authored = proposalForSessions(week.plan.weekStart, week.plan.sessions)
    const planned = authored.sessions.find(item => item.id === session.id)!
    assert.ok(planned.kind === 'workout')
    const block = planned.blocks[blockIndex]
    assert.ok(block.unit === 'reps')
    block.sets = 2
    const plan = buildAuthoredWeek(week.input, authored)
    assert.equal(plan.safety.passed, true)
    state = parseCampaign({ ...state, weeks: [{ ...week, authored, plan }] })
    state = logCampaignBlockSet(state, session.id, blockIndex, 0, { weight: '12', reps: '5', effort: '6.5' })
  }
  return { state, sessionId: session.id, blockIndex, replacementId }
}

test('swap preview and apply preserve actual sets and make the reason available to the next review', () => {
  const { state, sessionId, blockIndex, replacementId } = fixture(true)
  const before = structuredClone(state)
  const preview = swapWorkoutExercise(state, sessionId, blockIndex, replacementId, 'difficulty', true)
  assert.deepEqual(state, before)
  assert.deepEqual(preview.weeks[0].logs, state.weeks[0].logs)
  assert.deepEqual(preview.weeks[0].feedback, state.weeks[0].feedback)
  const changedSession = preview.weeks[0].plan.sessions.find(item => item.id === sessionId)!
  assert.ok(changedSession.kind === 'workout')
  assert.equal(changedSession.blocks[blockIndex].unit, 'reps')
  const replacement = changedSession.blocks.at(-1)!
  assert.ok(replacement.unit === 'reps')
  assert.equal(replacement.exerciseId, replacementId)
  assert.equal(replacement.sets, 1)
  assert.equal(replacement.suggestedWeightKg, undefined)
  const latest = { ...state, setDrafts: { ...state.setDrafts, 'unrelated-draft': { weight: '7', reps: '5', effort: '6' } } }
  const applied = swapWorkoutExercise(latest, sessionId, blockIndex, replacementId, 'difficulty', true)
  assert.deepEqual(applied.setDrafts['unrelated-draft'], latest.setDrafts['unrelated-draft'])
  assert.deepEqual(applied.weeks[0].logs, state.weeks[0].logs)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(applied))), applied)
  const changes = buildWeekReview(applied)!.changes!
  assert.match(changes.at(-1)!.message, /too difficult/)
  assert.match(changes.at(-1)!.message, /Prefer this replacement in future proposals/)
  assert.match(changes.at(-1)!.message, /Logged work is unchanged/)
})

test('this-session-only swaps do not record a future preference and cannot bypass a health hold', () => {
  const { state, sessionId, blockIndex, replacementId } = fixture()
  state.setDrafts[`${sessionId}:block-${blockIndex}:0`] = { weight: '99', reps: '10', effort: '8' }
  const swapped = swapWorkoutExercise(state, sessionId, blockIndex, replacementId, 'equipment', false)
  assert.equal(swapped.setDrafts[`${sessionId}:block-${blockIndex}:0`], undefined)
  assert.match(swapped.weeks[0].changes.at(-1)!.message, /Equipment unavailable today\. This session only/)
  assert.equal(Object.hasOwn(SWAP_REASONS, 'pain'), false)
  const held = structuredClone(state)
  held.weeks[0].input.athlete.safetyHold = { reason: 'pain', since: held.weeks[0].plan.weekStart }
  assert.throws(() => swapWorkoutExercise(held, sessionId, blockIndex, replacementId, 'difficulty', false), /pain or health hold/)
  assert.deepEqual(state.weeks[0].logs, {})
})

test('swap UI previews locally, explains the exact retained work, and surfaces unavailable choices', async () => {
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
    const { default: SwapExercise, SwapExercisePreview } = await import('./SwapExercise.tsx')
    const { Workout } = await import('./CampaignApp.tsx')
    const { state, sessionId, blockIndex, replacementId } = fixture(true)
    const before = structuredClone(state)
    const props = {
      state, sessionId, blockIndex,
      update: () => assert.fail('Rendering cannot save a swap'),
      onClose: () => assert.fail('Rendering cannot close a swap'),
      onReportPain: () => assert.fail('Rendering cannot report pain'),
    }
    const html = renderToStaticMarkup(createElement(SwapExercise, props))
    assert.match(html, /Preview swap/)
    assert.match(html, /My steady lunge/)
    assert.match(html, /This workout only/)
    assert.match(html, /Prefer in future proposals/)
    assert.match(html, /Report pain via Finish workout/)
    assert.match(html, /A swap cannot clear a pain or health hold/)
    assert.doesNotMatch(html, /<form|Apply swap|type="checkbox"[^>]*checked|<option value="pain"/)
    for (const label of Object.values(SWAP_REASONS)) assert.ok(html.includes(label))
    assert.match(html, /disabled=""[^>]*>Preview swap/)
    assert.deepEqual(state, before)
    const candidate = swapWorkoutExercise(state, sessionId, blockIndex, replacementId, 'difficulty', true)
    const preview = renderToStaticMarkup(createElement(SwapExercisePreview, { source: state, candidate, sessionId, blockIndex, replacementId }))
    assert.match(preview, /Preview — not saved/)
    assert.match(preview, /1 remaining set × 6 reps · target RPE 6/)
    assert.match(preview, /1 logged set preserved under the original exercise/)
    assert.match(preview, /12 kg × 5 reps · recorded RPE 6.5/)
    assert.match(preview, /No weight copied; no new work logged/)
    assert.match(preview, /Prefer this replacement in future proposals/)
    assert.match(preview, /<details class="cf-details"><summary>Swap details<\/summary>/)
    assert.deepEqual(state, before)
    const invalid = renderToStaticMarkup(createElement(SwapExercise, { ...props, blockIndex: -1 }))
    assert.match(invalid, /role="alert"/)
    assert.match(invalid, /reviewed practice proposal/)
    const session = state.weeks[0].plan.sessions.find(item => item.id === sessionId)!
    assert.ok(session.kind === 'workout')
    const unavailableIndex = session.blocks.findIndex((block, index) => block.unit !== 'throws' && swapChoices(state, sessionId, index).length === 0)
    assert.notEqual(unavailableIndex, -1)
    const unavailable = renderToStaticMarkup(createElement(SwapExercise, { ...props, blockIndex: unavailableIndex }))
    assert.match(unavailable, /No compatible alternatives with your saved equipment/)
    assert.doesNotMatch(unavailable, /Preview swap|Apply swap/)
    const workout = renderToStaticMarkup(createElement(Workout, {
      state, session, update: props.update, onBack() {}, onAction() {}, onAI() {},
    }))
    assert.match(workout, /Swap remaining work/)
    assert.match(workout, /Advice only\. Exercise swaps require preview and approval/)
    assert.equal(workout.match(/Ask AI \(optional\)/g)?.length, 1)
    assert.doesNotMatch(workout, /cf-ai-teaser/)
    assert.doesNotMatch(workout, /Same locked prescription/)
  } finally { hooks.deregister() }
})

test('Apply recomputes against latest previous state, requires a preview and catches errors without saved-candidate overwrite', () => {
  const source = readFileSync(new URL('./SwapExercise.tsx', import.meta.url), 'utf8')
  assert.match(source, /useState\(false\)/)
  assert.match(source, /const candidate = swapWorkoutExercise\(state,/)
  assert.match(source, /setPreview\(\{ source: state, sourceKey: swapSourceKey\(state, sessionId, blockIndex\), candidate \}\)/)
  assert.match(source, /const applied = update\(previous => \{/)
  assert.match(source, /return swapWorkoutExercise\(previous, sessionId, blockIndex, replacementId, reason, preferInFuture\)/)
  assert.doesNotMatch(source, /update\([^]*?=>\s*(?:preview|candidate)[.)}]/)
  assert.match(source, /if \(applied\) onClose\(\)/)
  assert.match(source, /setIssue\(applyIssue \|\|/)
  assert.match(source, /preview\.sourceKey !== swapSourceKey\(state, sessionId, blockIndex\)/)
  assert.match(source, /if \(swapSourceKey\(previous, sessionId, blockIndex\) !== preview\.sourceKey\)/)
  assert.match(source, /selectedWeek: state\.selectedWeek, weekStart: week\?\.plan\.weekStart, sessionId, blockIndex/)
  assert.match(source, /session: week\?\.plan\.sessions\.find\(item => item\.id === sessionId\)/)
  assert.match(source, /log: week\?\.logs\[sessionId\], library: week\?\.input\.library/)
  assert.match(source, /This workout changed after the preview/)
  assert.match(source, /setPreview\(null\); setIssue\(messageFor\(error\)\)/)
  assert.match(source, /Only unlogged timed blocks can be swapped/)
  const workout = readFileSync(new URL('./CampaignApp.tsx', import.meta.url), 'utf8')
  assert.match(workout, /onSwap=\{!readOnly && !session.sourceCommitmentId/)
  assert.match(workout, /<SwapExercise key=\{`\$\{session.id\}:\$\{swapBlock\}`\}/)
  assert.match(workout, /onReportPain=\{\(\) => \{ setSwapBlock\(null\); setFinishOutcome\('finished'\) \}\}/)
})
