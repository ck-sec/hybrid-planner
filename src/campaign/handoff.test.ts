import assert from 'node:assert/strict'
import test from 'node:test'
import { applyHandoff, buildHandoff, exportHandoff, HANDOFF_LIMIT, parseHandoffReply, requestHandoff } from './handoff.ts'
import { buildCampaign, exampleCampaign, normalizeRecommendedDraft, parseCampaign } from './model.ts'
import { equipmentForResources, parseResources } from './equipment.ts'
import type { HandoffScope } from './handoff.ts'
import type { WorkoutCard } from './workout-cards.ts'

const scope: HandoffScope = { purpose: 'interpret_goal' }
function draft() {
  const state = exampleCampaign('2026-09-07')
  state.sample = false
  state.draft.resources = parseResources(['dumbbell', 'dodgeballs', 'court', 'partner', 'rower', 'ski_erg'])
  state.draft.equipment = equipmentForResources(state.draft.resources)
  state.draft.goalLabel = ''
  state.draft.eventDate = ''
  state.draft.recommendedSetup!.goalText = 'dodgeball world championship 4. dec bangkok'
  return state
}
const card: WorkoutCard = {
  id: 'throwing-idea', exerciseId: null, title: 'Target-lane throwing', purpose: 'A court drill idea to discuss',
  instructions: 'Describe the target layout with your coach before deciding whether to use it.',
  cues: 'Notice the intended lane.', resources: ['dodgeballs', 'court', 'partner'], source: 'ai', status: 'draft',
}
function reply(state = draft(), task = scope) {
  const value = buildHandoff(state, task).example
  return { ...value, cards: [card], proposal: value.proposal ? {
    ...value.proposal, goalKind: 'dodgeball' as const, label: 'Dodgeball championship',
    location: 'Bangkok', eventDate: '2026-12-04',
  } : null }
}

test('brief is deterministic, equipment-aware and excludes logs, secrets and unrelated profile data', () => {
  const state = draft()
  const before = structuredClone(state)
  const brief = buildHandoff(state, scope)
  assert.equal(exportHandoff(state, scope), exportHandoff(state, scope))
  assert.ok(brief.context.resources.includes('rower'))
  assert.ok(brief.context.resources.includes('ski_erg'))
  assert.equal(brief.context.resourcesConfirmed, true)
  assert.ok(brief.context.allowedCatalog.every(item => !['back-squat', 'bench-press', 'pull-up'].includes(item.id)))
  assert.match(brief.instructions, /quantities, loads, effort, placement and safety/)
  assert.match(brief.instructions, /unverified, unscheduled drafts/)
  assert.match(brief.instructions, /No AI-generated drill is automatically scheduled/)
  assert.deepEqual(state, before)
  assert.doesNotMatch(exportHandoff(state, scope), /apiKey|setDrafts|actualEffort|"logs"|costMultiplier/)
})

test('chat reply accepts JSON fences, salvages the missing year, and imports cards without inventing a calendar', () => {
  const state = draft()
  const before = structuredClone(state)
  const review = parseHandoffReply(`\`\`\`json\n${JSON.stringify(reply(state))}\n\`\`\``, state, scope)
  assert.equal(review.dateIssue, 'not_explicit')
  assert.equal(review.reply.proposal?.eventDate, null)
  const next = applyHandoff(state, review, scope, '', '2026-12-04')
  assert.equal(next.draft.eventDate, '2026-12-04')
  assert.equal(next.draft.goalKind, 'dodgeball')
  assert.equal(next.draft.goalLabel, 'Dodgeball championship')
  assert.equal(next.cards?.[0].title, card.title)
  assert.equal(next.cards?.[0].status, 'draft')
  assert.deepEqual(next.weeks, [])
  assert.deepEqual(next.draft.exercises, before.draft.exercises)
  assert.equal(next.draft.weeklyRunMinutes, before.draft.weeklyRunMinutes)
  assert.equal(next.draft.confirmed, false)
  assert.deepEqual(state, before)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(next))), next)
})

test('API and external chat use the same contract, review and deterministic engine result', async () => {
  const state = draft()
  const expected = reply(state)
  const before = structuredClone(state)
  let calls = 0
  const api = await requestHandoff(state, scope, '', {
    endpoint: 'https://ai-fake.invalid/v1/chat/completions', model: 'fake-model', apiKey: 'FAKE-KEY',
  }, true, undefined, async (url, init) => {
    calls++
    assert.equal(url, 'https://ai-fake.invalid/v1/chat/completions')
    assert.equal(init?.credentials, 'omit')
    assert.equal(init?.redirect, 'error')
    assert.equal(init?.cache, 'no-store')
    const payload = JSON.parse(String(init?.body))
    assert.equal(payload.max_completion_tokens, 2048)
    assert.deepEqual(payload.messages.map((message: { content: string }) => message.content), [
      buildHandoff(state, scope).instructions, JSON.stringify(buildHandoff(state, scope).context),
    ])
    assert.equal(String(init?.body).includes('FAKE-KEY'), false)
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(expected) } }] }), { headers: { 'Content-Type': 'application/json' } })
  })
  assert.equal(calls, 1)
  const chat = parseHandoffReply(JSON.stringify(expected), state, scope)
  assert.deepEqual(api, chat)
  assert.deepEqual(state, before)
  const approved = applyHandoff(state, chat, scope, '', '2026-12-04')
  const built = buildCampaign({ ...approved, draft: { ...approved.draft, confirmed: true } })
  const withoutCards = buildCampaign({ ...approved, cards: [], draft: { ...approved.draft, confirmed: true } })
  assert.deepEqual(built.weeks, withoutCards.weeks)
  assert.equal(built.weeks[0].plan.safety.passed, true)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(built))), built)
})

test('invalid schemas and hidden prescriptions cannot enter through either reply or card fields', () => {
  const state = draft()
  const valid = reply(state)
  for (const invalid of [
    { ...valid, version: 2 }, { ...valid, sets: 100 }, { ...valid, durationMin: 80 },
    { ...valid, proposal: { ...valid.proposal, weeklyRunMinutes: 999 } },
    { ...valid, cards: [{ ...card, sets: 99 }] },
    { ...valid, cards: [{ ...card, source: 'user', status: 'reference' }] },
    { ...valid, cards: [{ ...card, source: 'ai', status: 'reference' }] },
    { ...valid, cards: [{ ...card, exerciseId: 'back-squat' }] },
    { ...valid, cards: [{ ...card, exerciseId: 'snatch' }] },
    { ...valid, cards: [{ ...card, resources: ['invented-equipment'] }] },
    { ...valid, cards: [{ ...card, title: '<script>bad()</script>' }] },
  ]) assert.throws(() => parseHandoffReply(JSON.stringify(invalid), state, scope), JSON.stringify(invalid))
  assert.throws(() => parseHandoffReply(JSON.stringify(valid).replace('"status":"draft"', '"status":"reference","status":"draft"'), state, scope), /repeats/)
  assert.throws(() => parseHandoffReply('x'.repeat(HANDOFF_LIMIT + 1), state, scope), /32 KB/)
  assert.throws(() => parseHandoffReply('Here is my plan: ' + JSON.stringify(valid), state, scope), /final JSON/)
})

test('stale equipment, goal, baseline, calendar and card context require a refreshed brief', () => {
  const state = draft()
  const text = JSON.stringify(reply(state))
  const changedStates = [
    { ...state, draft: { ...state.draft, resources: parseResources(['dumbbell']) } },
    { ...state, draft: { ...state.draft, eventDate: '2026-12-06' } },
    { ...state, draft: { ...state.draft, liftDurationMin: 30 } },
    { ...state, draft: { ...state.draft, availableDays: [1, 3] as typeof state.draft.availableDays } },
    { ...state, cards: [card] },
  ]
  for (const changed of changedStates) assert.throws(() => parseHandoffReply(text, changed, scope), /changed since this brief/)
  assert.doesNotThrow(() => parseHandoffReply(text, state, scope, 'An externally refined request'))
  assert.throws(() => parseHandoffReply(text, state, { purpose: 'suggest_exercises' }), /changed since this brief/)
  const review = parseHandoffReply(text, state, scope)
  assert.throws(() => applyHandoff(changedStates[1], review, scope), /changed since this brief/)
})

test('a reply remains importable after reloading, closing the workspace or changing setup steps', () => {
  const state = draft()
  const restored = parseCampaign(JSON.parse(JSON.stringify(state)))
  const input = reply(state)
  assert.equal(buildHandoff(state, scope, 'Some optional refinements').contextId, input.contextId)
  assert.doesNotThrow(() => parseHandoffReply(JSON.stringify(input), { ...restored, step: 3 }, scope))
})
test('committed plans accept reference cards only, without changing prescriptions, logs, costs or scheduling', () => {
  const state = exampleCampaign('2026-09-07')
  const built = buildCampaign({ ...state, draft: { ...state.draft, confirmed: true } })
  const task: HandoffScope = { purpose: 'suggest_exercises', sessionId: built.weeks[0].plan.sessions[0].id }
  const input = reply(built, task)
  const next = applyHandoff(built, parseHandoffReply(JSON.stringify(input), built, task), task)
  assert.deepEqual(next.weeks, built.weeks)
  assert.deepEqual(next.draft, built.draft)
  assert.deepEqual(next.setDrafts, built.setDrafts)
  assert.equal(next.cards?.length, 1)
  assert.throws(() => parseHandoffReply(JSON.stringify({ ...input, proposal: reply().proposal }), built, task), /committed/)
  assert.throws(() => buildHandoff(built, { ...task, sessionId: 'unknown' }), /no longer/)
})

test('card edits replace only explicit IDs and backups preserve personal edits without changing planning', () => {
  const state = draft()
  state.cards = [{ ...card, id: 'kept-card', source: 'user', status: 'reference' }, card]
  const input = reply(state)
  input.cards = [{ ...card, title: 'Revised drill draft' }]
  const next = applyHandoff(state, parseHandoffReply(JSON.stringify(input), state, scope), scope)
  assert.equal(next.cards?.length, 2)
  assert.equal(next.cards?.[0].source, 'user')
  assert.equal(next.cards?.[1].title, 'Revised drill draft')
})

test('consent is required before any API request and malformed replies do not mutate state', async () => {
  const state = draft()
  let calls = 0
  await assert.rejects(requestHandoff(state, scope, '', { endpoint: 'https://ai-fake.invalid/chat/completions', model: 'mock', apiKey: '' }, false, undefined, async () => { calls++; return new Response() }), /consent/)
  assert.equal(calls, 0)
})

test('detailed equipment cannot be omitted from engine eligibility checks or forged in a backup', () => {
  const state = draft()
  assert.throws(() => parseCampaign({ ...state, draft: { ...state.draft, equipment: ['barbell'] } }), /Equipment capabilities/)
  const inappropriate = normalizeRecommendedDraft({
    ...state.draft, goalLabel: 'Test goal', eventDate: '2026-12-04', resources: ['barbell'],
    equipment: equipmentForResources(['barbell']), confirmed: true,
    recommendedSetup: { ...state.draft.recommendedSetup!, exerciseIds: ['back-squat'] },
  })
  assert.throws(() => buildCampaign({ ...state, draft: inappropriate }), /equipment or space/)
  const old = exampleCampaign('2026-09-07')
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(old))), old)
})
