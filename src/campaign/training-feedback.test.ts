import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type { WorkoutSession } from '../../engine/types.ts'
import {
  adaptCampaign, buildCampaign, campaignSessionOnHold, confirmSetupEquipment, exampleCampaign,
  logCampaignBlockSet, nextCampaignWeek, parseCampaign,
} from './model.ts'
import { finishWithFeedback, formatSessionPace, parseSessionFeedback, sessionPaceMinPerKm } from './training-feedback.ts'
import type { SessionFeedback } from './training-feedback.ts'

const feedback: SessionFeedback = { version: 1, feeling: 'as_expected', outcome: 'finished' }

function planned() {
  const initial = confirmSetupEquipment(exampleCampaign('2026-09-07'), ['dumbbell', 'floor_space', 'bench'])
  return buildCampaign({ ...initial, draft: { ...initial.draft, confirmed: true } })
}

test('feedback parsing preserves explicit values and unknown feeling without inventing optional observations', () => {
  for (const feeling of [null, 'easier', 'as_expected', 'harder'] as const) {
    const input = { ...feedback, feeling }
    assert.deepEqual(parseSessionFeedback(input), input)
    assert.notEqual(parseSessionFeedback(input), input)
    assert.deepEqual(Object.keys(parseSessionFeedback(input)), ['version', 'feeling', 'outcome'])
  }
  const full = { ...feedback, outcome: 'finished_early' as const, distanceKm: 5.25, averageHr: 143.5, note: 'Easy pace; stopped for a meeting.\nNo pain.' }
  assert.deepEqual(parseSessionFeedback(full), full)
  assert.equal(parseSessionFeedback({ ...feedback, note: 'x'.repeat(500) }).note?.length, 500)
  assert.equal(parseSessionFeedback({ ...feedback, note: '' }).note, '')
  assert.deepEqual(parseSessionFeedback(Object.assign(Object.create(null), feedback)), feedback)
})

test('malformed feedback is rejected, not coerced, trimmed, partially kept or silently discarded', () => {
  for (const value of [undefined, null, [], 'harder', 1, true, new Date(), Object.create(feedback)]) {
    assert.throws(() => parseSessionFeedback(value))
  }
  for (const field of ['version', 'feeling', 'outcome']) {
    const missing = { ...feedback } as Record<string, unknown>
    delete missing[field]
    assert.throws(() => parseSessionFeedback(missing))
  }
  for (const patch of [
    { version: 2 }, { version: '1' }, { feeling: 'easy' }, { feeling: undefined }, { outcome: 'partial' },
    { outcome: undefined }, { effort: 7 }, { pace: 6 },
    ...[0, -1, Infinity, NaN, '5', null, undefined].map(distanceKm => ({ distanceKm })),
    ...[0, -1, 301, Infinity, NaN, '140', null, undefined].map(averageHr => ({ averageHr })),
    ...['x'.repeat(501), 5, null, undefined].map(note => ({ note })),
  ]) assert.throws(() => parseSessionFeedback({ ...feedback, ...patch }), JSON.stringify(patch))
  const getter = Object.defineProperty({ ...feedback }, 'note', { enumerable: true, get() { assert.fail('Must not invoke untrusted accessors') } })
  assert.throws(() => parseSessionFeedback(getter), /unsupported/)
  assert.throws(() => parseSessionFeedback({ ...feedback, [Symbol('hidden')]: 1 }), /unsupported/)
  assert.throws(() => parseSessionFeedback(Object.defineProperty({ ...feedback }, 'note', { value: 'hidden' })), /unsupported/)
  assert.throws(() => parseSessionFeedback(JSON.parse('{"version":1,"feeling":null,"outcome":"finished","__proto__":{}}')), /unsupported/)
})

test('pace derives only from actual duration and distance with stable minute-second rounding', () => {
  assert.equal(sessionPaceMinPerKm(30, 5), 6)
  assert.equal(formatSessionPace(30, 5), '6:00 min/km')
  assert.equal(formatSessionPace(29.999, 5), '6:00 min/km')
  assert.equal(formatSessionPace(20, 3), '6:40 min/km')
  for (const [duration, distance] of [[undefined, 5], [30, undefined], [null, 5], [30, 0], [30, -5], [NaN, 5], [30, Infinity]] as const) {
    assert.equal(sessionPaceMinPerKm(duration, distance), null)
    assert.equal(formatSessionPace(duration, distance), null)
  }
  assert.equal(formatSessionPace(1440, Number.MIN_VALUE), null)
})

test('finishing preserves only actual logged work and never maps a feeling to effort or RPE', () => {
  let state = planned()
  const workout = state.weeks[0].plan.sessions.find(item => item.kind === 'workout' && item.discipline === 'strength')!
  assert.ok(workout.kind === 'workout')
  const blockIndex = workout.blocks.findIndex(block => block.unit === 'reps')
  state = logCampaignBlockSet(state, workout.id, blockIndex, 0, { weight: '12', reps: '5', effort: '6.5' })
  state.setDrafts['unconfirmed-set'] = { weight: '20', reps: '10', effort: '8' }
  const before = structuredClone(state)
  for (const feeling of ['easier', 'as_expected', 'harder', null] as const) {
    const result = finishWithFeedback(state, workout.id, 17, 0, false, { ...feedback, feeling })
    const week = result.weeks[0]
    assert.equal(week.logs[workout.id].status, 'completed')
    assert.equal(week.logs[workout.id].actualDurationMin, 17)
    assert.equal(week.logs[workout.id].actualEffort, 0)
    assert.deepEqual(week.logs[workout.id].blockLogs, state.weeks[0].logs[workout.id].blockLogs)
    assert.deepEqual(week.plan, state.weeks[0].plan)
    assert.deepEqual(week.input, state.weeks[0].input)
    assert.deepEqual(result.setDrafts, state.setDrafts)
    assert.deepEqual(week.feedback?.[workout.id], { ...feedback, feeling })
    assert.deepEqual(state, before)
  }
})

test('early finish is terminal but distinct, preserves the supplied metrics, and does not assume fatigue', () => {
  const state = planned()
  const run = state.weeks[0].plan.sessions.find(item => item.discipline === 'run')!
  const input: SessionFeedback = { version: 1, feeling: 'harder', outcome: 'finished_early', distanceKm: 2.5, note: 'A meeting cut this short.' }
  const result = finishWithFeedback(state, run.id, 16, 7, false, input)
  assert.equal(result.weeks[0].logs[run.id].status, 'completed')
  assert.equal(result.weeks[0].logs[run.id].skipReason, undefined)
  assert.deepEqual(result.weeks[0].feedback?.[run.id], input)
  assert.deepEqual(result.weeks[0].plan, state.weeks[0].plan)
  assert.match(result.weeks[0].changes.at(-1)!.message, /^Stopped early:/)
  assert.notEqual(result.weeks[0].feedback?.[run.id], input)
  assert.throws(() => finishWithFeedback(result, run.id, 16, 7, false, input), /already completed/)
  assert.equal(result.weeks[0].feedback?.[run.id].averageHr, undefined)
})

test('feedback survives strict backup restore and week archival without rewriting older records', () => {
  const state = planned()
  const run = state.weeks[0].plan.sessions.find(item => item.discipline === 'run')!
  const completed = finishWithFeedback(state, run.id, 18, 6, false, {
    ...feedback, outcome: 'finished_early', distanceKm: 3, averageHr: 142, note: 'Stopped for time.',
  })
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(completed))), completed)
  const advanced = parseCampaign(nextCampaignWeek(completed))
  assert.deepEqual(advanced.weeks[0], completed.weeks[0])
  const nextRun = advanced.weeks[1].plan.sessions.find(item => item.discipline === 'run')!
  const nextFinished = finishWithFeedback(advanced, nextRun.id, 20, 4, false, { ...feedback, feeling: null })
  assert.deepEqual(nextFinished.weeks[0], completed.weeks[0])
  assert.deepEqual(nextFinished.weeks[1].feedback?.[nextRun.id], { ...feedback, feeling: null })
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(nextFinished))), nextFinished)
  const orphan = structuredClone(completed)
  orphan.weeks[0].feedback!['unknown-session'] = feedback
  assert.throws(() => parseCampaign(orphan), /finished session/)
  const malformed = structuredClone(completed)
  malformed.weeks[0].feedback![run.id].note = 'x'.repeat(501)
  assert.throws(() => parseCampaign(malformed), /500/)
})

test('feedback retains completion validation, archived read-only behavior and health holds', () => {
  const state = planned()
  const session = state.weeks[0].plan.sessions[0]
  for (const [duration, effort] of [[0, 5], [NaN, 5], [10, -1], [10, 11], [10, Infinity]]) {
    assert.throws(() => finishWithFeedback(state, session.id, duration, effort, false, feedback))
  }
  assert.throws(() => finishWithFeedback(state, 'missing', 10, 5, false, feedback), /visible/)
  const strength = state.weeks[0].plan.sessions.find(item => item.discipline === 'strength')!
  assert.throws(() => finishWithFeedback(state, strength.id, 10, 5, false, { ...feedback, distanceKm: 2 }), /running sessions/)
  const removed = adaptCampaign(state, { type: 'delete', sessionId: strength.id })
  assert.throws(() => finishWithFeedback(removed, strength.id, 10, 5, false, feedback), /visible/)
  const next = nextCampaignWeek(state)
  assert.throws(() => finishWithFeedback({ ...next, selectedWeek: 0 }, session.id, 10, 5, false, feedback), /archived/)
  const pain = finishWithFeedback(state, session.id, 10, 5, true, { ...feedback, outcome: 'finished_early' })
  assert.equal(pain.weeks[0].logs[session.id].painFlag, true)
  assert.equal(pain.weeks[0].feedback?.[session.id].outcome, 'finished_early')
  assert.equal(campaignSessionOnHold(pain, session), true)
  assert.throws(() => nextCampaignWeek(pain), /hold|pain/i)
})

test('workout feedback UI requires actuals, keeps run metrics optional, and displays early finish history', async () => {
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
    const { WorkoutFeedbackForm, Workout, History } = await import('./CampaignApp.tsx')
    const state = planned()
    const run = state.weeks[0].plan.sessions.find(item => item.discipline === 'run')!
    const props = {
      session: run, outcome: 'finished' as const,
      onFinish: () => assert.fail('Rendering cannot complete a workout'), onCancel() {},
    }
    const html = renderToStaticMarkup(createElement(WorkoutFeedbackForm, props))
    for (const label of ['Easier than expected', 'As expected', 'Harder than expected']) assert.ok(html.includes(label))
    assert.equal(html.match(/aria-pressed="false"/g)?.length, 3)
    assert.match(html, /Actual duration \(minutes\)<input[^>]*required=""[^>]*value=""/)
    assert.match(html, /Whole-session effort \(0–10\)<input[^>]*required=""[^>]*value=""/)
    assert.doesNotMatch(html.match(/Average heart rate \(bpm, optional\)<input([^>]*)>/)![1], /required/)
    assert.doesNotMatch(html.match(/Distance \(km, optional\)<input([^>]*)>/)![1], /required/)
    assert.match(html, /<textarea[^>]*maxLength="500"/)
    assert.match(html, /Feeling not recorded/)
    assert.match(html, /No watch or heart-rate reading is required/)
    assert.match(renderToStaticMarkup(createElement(WorkoutFeedbackForm, { ...props, outcome: 'finished_early' })), /Confirm stopped early/)
    const strength = state.weeks[0].plan.sessions.find(item => item.discipline === 'strength')!
    const strengthHtml = renderToStaticMarkup(createElement(WorkoutFeedbackForm, { ...props, session: strength }))
    assert.doesNotMatch(strengthHtml, /Distance \(km|Average heart rate/)
    const finished = finishWithFeedback(state, run.id, 20, 7, false, {
      ...feedback, outcome: 'finished_early', feeling: 'harder', distanceKm: 3, note: 'RAN-OUT-OF-TIME',
    })
    const workout = renderToStaticMarkup(createElement(Workout, {
      state: finished, session: run, update: () => assert.fail('Rendering cannot log'), onBack() {}, onAction() {}, onAI() {},
    }))
    assert.match(workout, /STOPPED EARLY/)
    assert.match(workout, /Recorded feedback/)
    assert.match(workout, /6:40 min\/km/)
    assert.match(workout, /Harder than expected/)
    assert.match(workout, /RAN-OUT-OF-TIME/)
    assert.doesNotMatch(workout, />Finish workout|WORKOUT COMPLETE/)
    const repeated = structuredClone(finished)
    repeated.weeks[0].feedback![run.id] = { ...feedback, note: 'OTHER-PLAN-NOTE' }
    const history = renderToStaticMarkup(createElement(History, { state: { ...repeated, pastPlans: [finished] } }))
    assert.equal(history.match(/class="cf-tag">Stopped early/g)?.length, 1)
    assert.doesNotMatch(history, /Stopped early · not full completion/)
    assert.match(history, /RAN-OUT-OF-TIME/)
    assert.match(history, /OTHER-PLAN-NOTE/)
    assert.match(history, /6:40 min\/km/)
    assert.doesNotMatch(history, /Average heart rate:/)
    const duplicateNote = structuredClone(finished)
    duplicateNote.weeks[0].logs[run.id].notes = 'RAN-OUT-OF-TIME'
    const single = renderToStaticMarkup(createElement(History, { state: duplicateNote }))
    const singleRecord = single.match(/<article\b[^]*?<\/article>/)![0]
    assert.equal(singleRecord.match(/RAN-OUT-OF-TIME/g)?.length, 1)
    assert.equal(singleRecord.match(/20 min recorded/g)?.length, 1)
    assert.equal(singleRecord.match(/Effort 7\/10/g)?.length, 1)
    assert.equal(singleRecord.match(/Stopped early/g)?.length, 1)
    duplicateNote.weeks[0].logs[run.id].notes = 'A DIFFERENT LEGACY NOTE'
    const different = renderToStaticMarkup(createElement(History, { state: duplicateNote }))
    assert.match(different, /RAN-OUT-OF-TIME/)
    assert.match(different, /A DIFFERENT LEGACY NOTE/)
    delete duplicateNote.weeks[0].logs[run.id].actualDurationMin
    duplicateNote.weeks[0].logs[run.id].actualEffort = 0
    const unknown = renderToStaticMarkup(createElement(History, { state: duplicateNote }))
    assert.match(unknown, /Actual duration unknown · Effort 0\/10/)
    assert.doesNotMatch(unknown, /min recorded|6:40 min\/km/)
    assert.equal(finished.weeks[0].logs[run.id].actualDurationMin, 20)
    const throwingHistory = structuredClone(state)
    const throwSession: WorkoutSession = {
      ...run, id: 'saved-custom-throwing', kind: 'workout', discipline: 'sport', modality: 'court_sport', label: 'Practice',
      blocks: [{ unit: 'throws', drillId: 'custom-standing-target', throws: 20, intent: 'controlled_technique', embedded: true }],
    }
    throwingHistory.weeks[0].plan.sessions = [throwSession]
    throwingHistory.weeks[0].input.athlete.program!.customSportDrills = [{
      version: 1, id: 'custom-standing-target', name: 'My saved target throwing', profileId: 'controlled_target_throw',
      requirements: ['dodgeball', 'court_space', 'safe_target'], description: 'A saved practice drill.',
      focus: 'Use the established target.', why: 'Familiar technique inside practice.',
    }]
    throwingHistory.weeks[0].logs = {
      [throwSession.id]: {
        sessionId: throwSession.id, status: 'partial', painFlag: false, notes: '',
        blockLogs: [{ unit: 'throws', blockIndex: 0, drillId: 'custom-standing-target', throws: 8 }],
      },
    }
    const archivedThrows = renderToStaticMarkup(createElement(History, { state: { ...state, pastPlans: [throwingHistory] } }))
    assert.match(archivedThrows, /My saved target throwing/)
    assert.match(archivedThrows, /8 throws/)
    assert.doesNotMatch(archivedThrows, /Practice throwing exposure/)
    throwingHistory.weeks[0].input.library.exercises = [...throwingHistory.weeks[0].input.library.exercises, {
      ...throwingHistory.weeks[0].input.library.exercises[0], id: 'custom-standing-target', name: 'Original library throwing identity',
    }]
    assert.match(renderToStaticMarkup(createElement(History, { state: throwingHistory })), /Original library throwing identity/)
  } finally { hooks.deregister() }
})
