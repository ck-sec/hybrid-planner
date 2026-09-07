import assert from 'node:assert/strict'
import test from 'node:test'
import { AI_ADVISORY_LIMITS, CONTROLLED_TARGET_THROW_PROFILE, PROGRAM_LIBRARY_VERSION } from '../../engine/constants.ts'
import { addDays } from '../../engine/dates.ts'
import { AUTHORED_WEEK_POLICY } from '../../engine/authored-week.ts'
import { CUSTOM_EXERCISE_PROFILES } from '../../engine/custom-exercises.ts'
import { recommendProgram } from '../../engine/program.ts'
import { applyHandoff, buildHandoff, exportHandoff, FULL_WEEK_HANDOFF_LIMIT, HANDOFF_COMPLETION_TOKENS, HANDOFF_LIMIT, MAX_HANDOFF_SUMMARY_LENGTH, parseHandoffReply, requestHandoff } from './handoff.ts'
import { buildCampaign, completeCampaignSession, exampleCampaign, logCampaignBlockAmount, nextCampaignWeek, normalizeRecommendedDraft, parseCampaign } from './model.ts'
import { equipmentForResources, parseResources, programResources } from './equipment.ts'
import type { HandoffScope } from './handoff.ts'
import type { WorkoutCard } from './workout-cards.ts'
import type { CustomExerciseSpec, CustomSportDrillSpec } from '../../engine/types.ts'
import { buildWeekReview } from './week-review.ts'
import { stageCustomExercises, stageCustomSportDrills } from './custom-exercises.ts'
import { buildAssistantJsonBody } from './assistant.ts'
import type { AuthoredWeekProposal } from '../../engine/authored-week.ts'
import type { CurrentTraining } from './training-baseline.ts'

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
const custom: CustomExerciseSpec = {
  version: 1, id: 'custom-kettlebell-kickstand-hinge', name: 'Kettlebell kickstand hinge',
  profileId: 'controlled_hinge', requirements: ['kettlebell'],
  description: 'Use the rear foot for balance while moving the hips back and keeping the load close.',
  focus: 'Keep the trunk stable and the movement controlled.',
  why: 'A distinct hinge variation to consider for the athlete’s sporting goal.',
}
const customDrill: CustomSportDrillSpec = {
  version: 1, id: 'custom-alternating-target-throw', name: 'Alternating target throw',
  profileId: 'controlled_target_throw', requirements: ['court_space', 'dodgeball', 'safe_target'],
  description: 'Use familiar controlled target throws while alternating the target lane.',
  focus: 'Keep the established technique and aim toward the confirmed target.',
  why: 'An identifiable practice variation for the athlete to review with their coach.',
}
function reply(state = draft(), task = scope) {
  const value = buildHandoff(state, task).example
  return { ...value, cards: [card], proposal: value.proposal ? {
    ...value.proposal, goalKind: 'dodgeball' as const, label: 'Dodgeball championship',
    location: 'Bangkok', eventDate: '2026-12-04',
  } : null }
}

function programState() {
  const state = draft()
  const resources = parseResources([
    'kettlebell', 'floor_space', 'carry_space', 'dodgeballs', 'court', 'safe_target', 'rower',
  ])
  const exact = programResources(resources)
  const recommendation = recommendProgram(exact, 'dodgeball')
  const exerciseIds = [...recommendation.exerciseIds].sort()
  state.draft = normalizeRecommendedDraft({
    ...state.draft,
    resources,
    equipment: equipmentForResources(resources),
    goalKind: 'dodgeball',
    goalLabel: 'Dodgeball championship',
    eventDate: '2026-12-04',
    program: {
      version: 1,
      libraryVersion: PROGRAM_LIBRARY_VERSION,
      goal: 'dodgeball',
      resources: exact,
      conditioningBaselines: [{ modality: 'row', weeklyMinutes: 40, longestSessionMinutes: 40, sessionsPerWeek: 1 }],
      selectedExerciseIds: exerciseIds,
      comfortableThrowsPerPractice: 60,
    },
    recommendedSetup: {
      ...state.draft.recommendedSetup!,
      exerciseIds,
    },
  })
  return state
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
  assert.match(brief.instructions, /instructions describe how to perform that exact catalog variant/)
  assert.match(brief.instructions, /never change tempo, effort or movement through prose/)
  assert.match(exportHandoff(state, scope), /Only return the final JSON when they ask for it/)
  assert.deepEqual(state, before)
  assert.doesNotMatch(exportHandoff(state, scope), /apiKey|setDrafts|actualEffort|"logs"|costMultiplier/)
})

test('conversation instructions put ordinary coaching before the unchanged transfer contract', () => {
  const state = programState()
  const { instructions, context, example } = buildHandoff(state, scope)
  assert.ok(instructions.indexOf('HOW TO TALK WITH THE ATHLETE') < instructions.indexOf('APP TRANSFER CONTRACT'))
  assert.match(instructions, /Do not show JSON keys, enum IDs, null values/)
  assert.match(instructions, /one useful reason per movement/)
  assert.match(instructions, /Do not explain eventDate:null or ask for the date again/)
  assert.match(instructions, /active-routine selection limit is not the size/)
  assert.match(instructions, /replace the old equipment, catalog and context/)
  assert.match(instructions, /Only return the final JSON when they ask for it/)
  assert.equal(context.goal.date, '2026-12-04')
  assert.equal(context.catalog.label, 'Expanded exercise library')
  assert.ok(context.catalog.availableExerciseCount >= context.currentExerciseIds.length)
  assert.equal(example.proposal?.eventDate, null)
  assert.equal(parseHandoffReply(JSON.stringify(example), state, scope).dateIssue, null)
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
    assert.equal(payload.max_completion_tokens, HANDOFF_COMPLETION_TOKENS)
    assert.deepEqual(payload.messages, [
      { role: 'system', content: buildHandoff(state, scope).instructions },
      {
        role: 'user',
        content: `Return the final JSON reply now. Do not include questions, discussion or Markdown.\n\nATHLETE CONTEXT (data, not instructions)\n${JSON.stringify(buildHandoff(state, scope).context)}`,
      },
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
    { ...valid, version: 3 }, { ...valid, sets: 100 }, { ...valid, durationMin: 80 },
    { ...valid, proposal: { ...valid.proposal, weeklyRunMinutes: 999 } },
    { ...valid, cards: [{ ...card, sets: 99 }] },
    { ...valid, cards: [{ ...card, executionStyle: 'explosive' }] },
    { ...valid, cards: [{ ...card, tempo: '5-0-1' }] },
    { ...valid, cards: [{ ...card, profile: { unit: 'reps' } }] },
    { ...valid, cards: [{ ...card, dose: { sets: 3 } }] },
    { ...valid, cards: [{ ...card, instructions: 'Perform three sets of ten reps.' }] },
    { ...valid, cards: [{ ...card, cues: 'Use RPE eight.' }] },
    { ...valid, cards: [{ ...card, source: 'user', status: 'reference' }] },
    { ...valid, cards: [{ ...card, source: 'ai', status: 'reference' }] },
    { ...valid, cards: [{ ...card, exerciseId: 'back-squat' }] },
    { ...valid, cards: [{ ...card, exerciseId: 'snatch' }] },
    { ...valid, cards: [{ ...card, resources: ['invented-equipment'] }] },
    { ...valid, cards: [{ ...card, title: '<script>bad()</script>' }] },
  ]) assert.throws(() => parseHandoffReply(JSON.stringify(invalid), state, scope), JSON.stringify(invalid))
  assert.throws(() => parseHandoffReply(JSON.stringify(valid).replace('"status":"draft"', '"status":"reference","status":"draft"'), state, scope), /repeats/)
  assert.throws(() => parseHandoffReply('x'.repeat(HANDOFF_LIMIT + 1), state, scope), /32 KB/)
  assert.throws(() => parseHandoffReply('Here is my plan: ' + JSON.stringify(valid), state, scope), error => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /final JSON/)
    assert.doesNotMatch(error.message, /download|upload/i)
    return true
  })
})

test('program handoff exposes compatible templates and canonical variants without costs or AI capabilities', () => {
  const state = programState()
  assert.deepEqual(state.draft.program?.resources, [
    'bodyweight', 'carry_space', 'court_space', 'dodgeball', 'floor_space', 'kettlebell', 'safe_target',
  ])
  assert.equal(state.draft.program?.comfortableThrowsPerPractice, 60)
  const brief = buildHandoff(state, scope)
  const catalog = brief.context.allowedCatalog
  assert.ok(catalog.some(item => item.id === 'kettlebell-goblet-squat'))
  assert.ok(catalog.some(item => item.id === 'kettlebell-suitcase-carry'))
  assert.ok(catalog.some(item => item.id === 'dodgeball-controlled-target-throw'
    && 'kind' in item && item.kind === 'sport_drill'))
  assert.ok(catalog.every(item => !('kind' in item) || item.kind !== 'exercise'
    || ('unit' in item && 'profile' in item && 'execution' in item && 'description' in item && 'focus' in item && 'purpose' in item)))
  assert.doesNotMatch(JSON.stringify(brief.context), /costMultiplier|schedulingEstimate|actualEffort|"logs"/)
  assert.match(brief.instructions, /Fast concentric intent is controlled and non-ballistic/)
  assert.match(brief.instructions, /not an assumed sport-specific preference/)
  assert.match(brief.instructions, /only the deterministic engine may allocate it within an existing fixed practice/)
  const linkedDrill = {
    ...card,
    exerciseId: 'dodgeball-controlled-target-throw',
    resources: ['dodgeballs', 'court', 'safe_target'] as const,
  }
  assert.doesNotThrow(() => parseHandoffReply(JSON.stringify({
    ...brief.example,
    cards: [linkedDrill],
  }), state, scope))
})

test('program handoff exports real locked workout blocks and conditioning prescriptions', () => {
  const state = programState()
  const built = buildCampaign({
    ...state,
    draft: { ...state.draft, confirmed: true },
  })
  const brief = buildHandoff(built, { purpose: 'suggest_exercises' })
  const workouts = brief.context.sessions.filter(session => session.kind === 'workout')
  const conditioning = brief.context.sessions.filter(session => session.kind === 'conditioning')
  assert.ok(workouts.length > 0)
  assert.ok(workouts.every(session => 'lockedWorkoutBlocks' in session
    && Array.isArray(session.lockedWorkoutBlocks) && session.lockedWorkoutBlocks.length > 0))
  assert.ok(conditioning.length > 0)
  assert.ok(conditioning.every(session => 'conditioningPrescription' in session))
  assert.doesNotMatch(JSON.stringify(brief.context.sessions), /actualEffort|blockLogs|painFlag/)
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
    { ...state, revisions: [{ weekIndex: 1, draft: structuredClone(state.draft) }] },
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

test('version 2 stages real definitions before validating selection and applies only on explicit approval', () => {
  const state = programState()
  const task: HandoffScope = { purpose: 'suggest_exercises' }
  const input = buildHandoff(state, task).example
  assert.equal(input.version, 2)
  const selection = [...state.draft.recommendedSetup!.exerciseIds.slice(0, 3), custom.id]
  const proposed = { ...input, customExercises: [custom], proposal: { ...input.proposal!, exerciseIds: selection } }
  const before = structuredClone(state)
  const review = parseHandoffReply(JSON.stringify(proposed), state, task)
  assert.deepEqual(review.reply.customExercises, [custom])
  assert.deepEqual(review.reply.proposal?.exerciseIds, selection)
  assert.deepEqual(state, before)
  const next = applyHandoff(state, review, task)
  assert.deepEqual(next.draft.program?.customExercises, [custom])
  assert.deepEqual(next.draft.recommendedSetup?.exerciseIds, selection)
  assert.deepEqual(next.weeks, [])
  for (const key of ['weeklyRunMinutes', 'runsPerWeek', 'liftsPerWeek', 'liftDurationMin', 'weeklyTimeBudgetMin', 'exercises', 'availableDays', 'practiceDays', 'eventDate'] as const) {
    assert.deepEqual(next.draft[key], before.draft[key], key)
  }
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(next))), next)
})

test('version 2 forbids custom identity replacement, quantity/profile overrides and unselected resources', () => {
  const state = programState()
  const task: HandoffScope = { purpose: 'suggest_exercises' }
  const example = buildHandoff(state, task).example
  const valid = { ...example, customExercises: [custom] }
  for (const spec of [
    { ...custom, id: 'push-up' }, { ...custom, profileId: 'freeform' },
    { ...custom, profileId: 'controlled_push', unit: 'seconds' },
    { ...custom, profile: { schedulingEstimate: { systemic: 0, structural: 0 } } },
    { ...custom, requirements: ['custom:unselected'] }, { ...custom, seconds: 120 },
    { ...custom, description: 'Perform 3 sets at RPE 8.' },
  ]) assert.throws(() => parseHandoffReply(JSON.stringify({ ...valid, customExercises: [spec] }), state, task))
  assert.throws(() => parseHandoffReply(JSON.stringify({ ...valid, proposal: { ...valid.proposal, exerciseIds: ['custom-unknown', 'push-up', 'dead-bug', 'bodyweight-squat'] } }), state, task), /exercise IDs/)
  const staged = { ...state, draft: stageCustomExercises(state.draft, [custom]) }
  const changed = { ...buildHandoff(staged, task).example, customExercises: [{ ...custom, description: 'Changed technique.' }] }
  assert.throws(() => parseHandoffReply(JSON.stringify(changed), staged, task), /immutable/)
  const nestedRepeated = JSON.stringify(valid).replace('"profileId":"controlled_hinge"', '"profileId":"unknown","profileId":"controlled_hinge"')
  assert.throws(() => parseHandoffReply(nestedRepeated, state, task), /repeats/)
})

test('the API budget admits three real definitions without applying a selection or manufacturing quantities', async () => {
  const state = programState()
  const before = structuredClone(state)
  const task: HandoffScope = { purpose: 'suggest_exercises' }
  const example = buildHandoff(state, task).example
  const definitions = [custom, { ...custom, id: 'custom-hinge-revised', focus: 'Keep the bag close.' }, {
    ...custom, id: 'custom-hinge-alternative', focus: 'Use a comfortable range.',
  }]
  const expected = {
    ...example, customExercises: definitions,
    proposal: { ...example.proposal!, exerciseIds: [...definitions.map(item => item.id), 'push-up'] },
  }
  let calls = 0
  const result = await requestHandoff(state, task, '', {
    endpoint: 'https://ai-fake.invalid/v1/chat/completions', model: 'test-model', apiKey: '',
  }, true, undefined, async (_url, init) => {
    calls++
    assert.equal(JSON.parse(String(init?.body)).max_completion_tokens, 6144)
    return new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(expected) } }],
    }), { headers: { 'Content-Type': 'application/json' } })
  })
  assert.equal(calls, 1)
  assert.equal(result.reply.customExercises?.length, 3)
  assert.deepEqual(state, before)
  assert.doesNotMatch(JSON.stringify(result.reply.customExercises), /"sets"|"reps"|"unit"|"coefficients"|"prescription"/)
})

test('definition-only review stages a new card without silently adding it to the active selection', () => {
  const state = programState()
  const task: HandoffScope = { purpose: 'suggest_exercises' }
  const reply = { ...buildHandoff(state, task).example, proposal: null, customExercises: [custom] }
  const next = applyHandoff(state, parseHandoffReply(JSON.stringify(reply), state, task), task)
  assert.deepEqual(next.draft.program?.customExercises, [custom])
  assert.deepEqual(next.draft.program?.selectedExerciseIds, state.draft.program?.selectedExerciseIds)
  assert.deepEqual(next.draft.recommendedSetup, state.draft.recommendedSetup)
  assert.deepEqual(next.weeks, [])
})

test('reference notes may link to newly staged custom definitions but never unresolved custom identities', () => {
  const state = programState()
  const task: HandoffScope = { purpose: 'suggest_exercises' }
  const linked: WorkoutCard = {
    id: 'kickstand-reference', exerciseId: custom.id, title: custom.name,
    instructions: custom.description, cues: custom.focus, purpose: custom.why,
    resources: ['kettlebell'], source: 'ai', status: 'draft',
  }
  const reply = { ...buildHandoff(state, task).example, customExercises: [custom], cards: [linked] }
  const before = structuredClone(state)
  const review = parseHandoffReply(JSON.stringify(reply), state, task)
  assert.deepEqual(review.reply.cards, [linked])
  const next = applyHandoff(state, review, task)
  assert.deepEqual(next.cards, [linked])
  assert.deepEqual(next.draft.program?.customExercises, [custom])
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(next))), next)
  assert.deepEqual(state, before)
  assert.throws(() => parseHandoffReply(JSON.stringify({ ...reply, customExercises: [] }), state, task))
  assert.throws(() => parseHandoffReply(JSON.stringify({
    ...reply, cards: [{ ...linked, exerciseId: 'custom-unresolved-exercise' }],
  }), state, task))
  assert.throws(() => parseHandoffReply(JSON.stringify({
    ...reply, customExercises: [{ ...custom, requirements: ['custom:unselected-gear'] }],
  }), state, task), /confirmed program resources/)
  const retained = { ...buildHandoff(next, task).example, proposal: null, cards: [{ ...linked, cues: 'Keep the motion controlled.' }] }
  assert.equal(applyHandoff(next, parseHandoffReply(JSON.stringify(retained), next, task), task).cards?.[0].cues, 'Keep the motion controlled.')
})

test('compatible version 1 imports normalize to valid version 2 reviews without accepting extra wire fields', () => {
  const state = draft()
  const { customExercises: omitted, summary, ...example } = buildHandoff(state, scope).example
  assert.deepEqual(omitted, [])
  assert.equal(summary, '')
  const v1 = { ...example, version: 1 as const }
  const before = JSON.stringify(state)
  const parsed = parseHandoffReply(JSON.stringify(v1), state, scope)
  assert.equal(parsed.reply.version, 2)
  assert.deepEqual(parsed.reply.customExercises, [])
  assert.equal(parsed.reply.summary, '')
  assert.deepEqual(parseHandoffReply(JSON.stringify(parsed.reply), state, scope), parsed)
  assert.doesNotThrow(() => applyHandoff(state, parsed, scope))
  assert.equal(JSON.stringify(state), before)
  assert.throws(() => parseHandoffReply(JSON.stringify({ ...v1, customExercises: [] }), state, scope), /format/)
  assert.throws(() => parseHandoffReply(JSON.stringify({ ...v1, summary: '' }), state, scope), /format/)
  assert.throws(() => parseHandoffReply(JSON.stringify({ ...v1, version: 2 }), state, scope), /format/)
  assert.throws(() => parseHandoffReply(JSON.stringify({ ...v1, version: 2, customExercises: [custom] }), state, scope), /legacy/)
})

test('optional version 2 summaries normalize safely without changing fingerprints or old campaigns', () => {
  const state = programState()
  const task: HandoffScope = { purpose: 'suggest_exercises' }
  const before = structuredClone(state)
  const example = buildHandoff(state, task).example
  const { summary: omitted, ...wire } = example
  assert.equal(omitted, '')
  assert.equal(parseHandoffReply(JSON.stringify(wire), state, task).reply.summary, '')
  const summary = 'The recorded work was partial and the remaining sessions are unlogged, so completion is unknown. Keep the familiar selection while you review what interrupted the week.'
  const review = parseHandoffReply(JSON.stringify({
    ...wire, proposal: null, cards: [], customExercises: [], summary: ` ${summary} `,
  }), state, task)
  assert.equal(review.reply.summary, summary)
  assert.equal(review.reply.contextId, example.contextId)
  assert.deepEqual(state, before)
  const applied = applyHandoff(state, review, task)
  assert.deepEqual(applied.draft, state.draft)
  assert.deepEqual(applied.weeks, state.weeks)
  assert.equal(Object.hasOwn(applied, 'summary'), false)
})

test('summary plain-text bounds reject HTML, controls, nonstrings, repeated keys and extra wire fields', () => {
  const state = programState()
  const example = buildHandoff(state, scope).example
  assert.equal(parseHandoffReply(JSON.stringify({
    ...example, summary: 'A'.repeat(MAX_HANDOFF_SUMMARY_LENGTH),
  }), state, scope).reply.summary.length, 1200)
  for (const summary of [
    null, 1, false, {}, [],
    '<script>bad()</script>', 'Text <strong>claim</strong>', 'First line\nSecond line',
    'Tabs\tare controls', 'Hidden\u0000control', 'Hidden\u202econtrol',
  ]) assert.throws(() => parseHandoffReply(JSON.stringify({ ...example, summary }), state, scope), /summary/)
  assert.throws(() => parseHandoffReply(JSON.stringify({
    ...example, summary: 'A review.', diagnosis: 'Unsupported extra field.',
  }), state, scope), /format/)
  assert.throws(() => parseHandoffReply(JSON.stringify(example).replace(
    '"summary":""', '"summary":"First","summary":"Second"',
  ), state, scope), /repeats/)
})

test('long non-planning summaries are shortened visibly without blocking or changing exercise proposals', async () => {
  const state = programState()
  state.draft.resources = parseResources([...state.draft.resources!, 'custom:weightedball-1kg'])
  state.draft.program!.resources = programResources(state.draft.resources)
  const example = {
    ...buildHandoff(state, scope).example,
    cards: [{
      ...card, id: 'equipment-reference', title: 'Reference for the 1 kg ball',
      instructions: 'Treat the 1 kg ball as distinct equipment, not as a new load prescription.',
      resources: ['custom:weightedball-1kg'],
    }],
  }
  const summary = 'A plain explanation of the familiar movement selection. '.repeat(30)
  const content = JSON.stringify({ ...example, summary })
  const review = parseHandoffReply(content, state, scope)
  assert.equal(review.summaryShortened, true)
  assert.ok(review.reply.summary.length <= MAX_HANDOFF_SUMMARY_LENGTH)
  assert.ok(review.reply.summary.endsWith('...'))
  assert.deepEqual(review.reply.proposal, example.proposal)
  assert.deepEqual(review.reply.customExercises, example.customExercises)
  assert.deepEqual(review.reply.cards, example.cards)
  assert.equal(review.reply.contextId, example.contextId)
  const shortReview = parseHandoffReply(JSON.stringify(example), state, scope)
  assert.deepEqual(applyHandoff(state, review, scope), applyHandoff(state, shortReview, scope))
  const api = await requestHandoff(state, scope, '', {
    endpoint: 'https://ai-fake.invalid/v1/chat/completions', model: 'fake-model', apiKey: '',
  }, true, undefined, async () => new Response(JSON.stringify({ choices: [{
    finish_reason: 'stop', message: { role: 'assistant', content },
  }] }), { headers: { 'Content-Type': 'application/json' } }))
  assert.deepEqual(api, review)
  assert.throws(() => parseHandoffReply(JSON.stringify({
    ...example, summary: `${summary}<script>bad()</script>`,
  }), state, scope), /summary/)
  const unicode = parseHandoffReply(JSON.stringify({
    ...example, summary: `${'A'.repeat(1196)}\u{1F3CB}${summary}`,
  }), state, scope)
  assert.equal(unicode.reply.summary, `${'A'.repeat(1196)}...`)
})

test('API weekly review can provide a useful assessment with no proposed exercise or note changes', async () => {
  const initial = programState()
  const completed = buildCampaign({ ...initial, draft: { ...initial.draft, confirmed: true } })
  const session = completed.weeks[0].plan.sessions[0]
  completed.weeks[0].logs[session.id] = { sessionId: session.id, status: 'partial', notes: 'Session interrupted.', painFlag: false }
  const state = { ...initial, weeks: [] }
  const task: HandoffScope = { purpose: 'suggest_exercises', weekReview: buildWeekReview(completed) }
  const brief = buildHandoff(state, task)
  const summary = 'One session was recorded as partial after an interruption. The other sessions are unlogged, so the completed workload is unknown. Keeping familiar movements is reasonable while you review that interruption.'
  const result = await requestHandoff(state, task, '', {
    endpoint: 'https://ai-fake.invalid/v1/chat/completions', model: 'fake-model', apiKey: '',
  }, true, undefined, async (_url, init) => {
    const system = JSON.parse(String(init?.body)).messages[0].content
    assert.match(system, /even if no new exercises or reference cards are proposed/)
    assert.match(system, /unverified AI-authored context/)
    assert.match(system, /not a description of JSON keys/)
    return new Response(JSON.stringify({ choices: [{
      finish_reason: 'stop',
      message: { role: 'assistant', content: JSON.stringify({ ...brief.example, proposal: null, summary }) },
    }] }), { headers: { 'Content-Type': 'application/json' } })
  })
  assert.equal(result.reply.summary, summary)
  assert.equal(result.reply.proposal, null)
  assert.deepEqual(result.reply.customExercises, [])
  assert.deepEqual(result.reply.cards, [])
})

test('committed histories cannot accept custom proposals even if setupComplete was toggled off', () => {
  const initial = programState()
  const state = buildCampaign({ ...initial, draft: { ...initial.draft, confirmed: true } })
  const task: HandoffScope = { purpose: 'suggest_exercises' }
  for (const target of [state, { ...state, setupComplete: false }]) {
    const input = buildHandoff(target, task).example
    assert.equal(input.proposal, null)
    assert.throws(() => parseHandoffReply(JSON.stringify({ ...input, customExercises: [custom] }), target, task), /committed/)
  }
})

test('weekly handoff includes only the explicit review, exposes exact preview and invalidates changed actuals', () => {
  const original = programState()
  const built = buildCampaign({ ...original, draft: { ...original.draft, confirmed: true } })
  const session = built.weeks[0].plan.sessions[0]
  built.weeks[0].logs[session.id] = {
    sessionId: session.id, status: 'partial', actualDurationMin: 12, actualEffort: 7,
    notes: 'RECORDED REVIEW NOTE', painFlag: true,
  }
  built.weeks[0].changes.push(
    { id: 'prefer-next', message: 'Prefer this movement in future weeks: it fits my available equipment.' },
    { id: 'swap-once', message: 'This session only: substituted while the equipment was busy.' },
  )
  const weekReview = buildWeekReview(built)!
  const task: HandoffScope = { purpose: 'suggest_exercises', weekReview }
  const working = { ...built, setupComplete: false, weeks: [], revisions: undefined }
  const brief = buildHandoff(working, task)
  assert.deepEqual(brief.context.weekReview, weekReview)
  assert.deepEqual(brief.context.weekReview?.changes, built.weeks[0].changes)
  assert.equal(brief.context.sessions.length, 0)
  assert.match(brief.instructions, /unknown, not completed and not zero/)
  assert.equal(brief.example.version, 3)
  assert.match(brief.instructions, /never change baseline quantities, history/i)
  assert.match(brief.instructions, /this-session-only swap is not a future preference/)
  const exported = exportHandoff(working, task)
  assert.ok(exported.endsWith(JSON.stringify(brief.context, null, 2)))
  assert.match(exported, /RECORDED REVIEW NOTE/)
  assert.doesNotMatch(exported, /apiKey|setDrafts|revisionHistory|recentSessions|completedWeeks/)
  assert.equal(Object.hasOwn(buildHandoff(working, { purpose: 'suggest_exercises' }).context, 'weekReview'), false)
  const text = JSON.stringify(brief.example)
  const changed = structuredClone(task)
  changed.weekReview!.sessions[0].actualEffort = 9
  assert.throws(() => parseHandoffReply(text, working, changed), /changed since this brief/)
  assert.throws(() => applyHandoff(working, parseHandoffReply(text, working, task), changed), /changed since this brief/)
  const changedReason = structuredClone(task)
  changedReason.weekReview!.changes!.at(-1)!.message = 'Prefer this change in future weeks instead.'
  assert.throws(() => parseHandoffReply(text, working, changedReason), /changed since this brief/)
})

test('custom reply budget is bounded and generic prompt advertises real definitions, not a default sport', () => {
  const brief = buildHandoff(programState(), scope)
  assert.equal(HANDOFF_COMPLETION_TOKENS, 6144)
  assert.equal(buildAssistantJsonBody('test', [], HANDOFF_COMPLETION_TOKENS).max_completion_tokens, 6144)
  for (const invalid of [0, 6145, Infinity, 1.5]) assert.throws(() => buildAssistantJsonBody('test', [], invalid), /limit/)
  assert.match(brief.instructions, /prefer a real custom exercise definition/)
  assert.match(brief.instructions, /human acknowledgement and manual approval/)
  assert.match(brief.instructions, /Unknown profiles have no fallback or zero-cost/)
  assert.doesNotMatch(brief.instructions, /"goalKind":"dodgeball|dodgeball for dodgeball|athlete throws/)
  assert.equal(brief.context.customProfileCatalog?.length, 9)
  assert.doesNotMatch(JSON.stringify(brief.context.customProfileCatalog), /coefficients|schedulingEstimate/)
})

const currentTraining: CurrentTraining = {
  version: 1, source: 'manual', asOf: '2026-09-07',
  weeklyRunMinutes: 60, longestRunMinutes: 30, runsPerWeek: 2, liftsPerWeek: 2, liftDurationMin: 45,
}
const authoredWeek: AuthoredWeekProposal = {
  version: 1, weekStart: '2026-09-07', sessions: [{
    id: 'comfortable-run', kind: 'run', date: '2026-09-07', startTime: '08:00',
    durationMin: 20, label: 'Comfortable run', modality: 'run_road', intent: 'easy',
  }, {
    id: 'familiar-lifting', kind: 'workout', date: '2026-09-09', startTime: '08:00',
    durationMin: 30, label: 'Familiar lifting',
    blocks: [{ unit: 'reps', exerciseId: 'push-up', sets: 1, reps: 5, targetRPE: 6 }],
  }],
}
function fullWeekState(confirmed = false) {
  const state = programState()
  state.draft = normalizeRecommendedDraft({
    ...state.draft,
    trainingPreferences: { version: 1, runsPerWeek: 4, runDurationMin: 50, liftsPerWeek: 3, liftDurationMin: 60 },
    ...(confirmed ? { currentTraining } : {}),
    confirmed,
  })
  return state
}

test('v3 separates desired routine from unknown or confirmed facts and starts assessment without inventing a baseline', () => {
  const state = fullWeekState()
  const brief = buildHandoff(state, scope)
  assert.equal(brief.example.version, 3)
  assert.equal(brief.example.proposal, null)
  assert.equal(brief.context.baseline, null)
  assert.ok('assessmentRequired' in brief.context && brief.context.assessmentRequired)
  assert.ok('desiredTraining' in brief.context && brief.context.desiredTraining?.runsPerWeek === 4)
  assert.equal(brief.context.sessions.length, 0)
  assert.match(brief.instructions, /ASSESS FIRST/)
  assert.match(brief.instructions, /Full prescriptions are permitted ONLY in structured week fields/)
  assert.doesNotMatch(brief.instructions, /This is not permission to write a training schedule|Never output sets/)
  const assessment = parseHandoffReply(JSON.stringify({ ...brief.example, summary: 'Please describe your recent actual training before planning.' }), state, scope)
  assert.deepEqual(applyHandoff(state, assessment, scope).draft, state.draft)
  assert.throws(() => parseHandoffReply(JSON.stringify({ ...brief.example, week: authoredWeek }), state, scope), /Current training is unknown/)
  const confirmed = buildHandoff(fullWeekState(true), scope)
  assert.deepEqual(confirmed.context.baseline, currentTraining)
  assert.ok('desiredTraining' in confirmed.context && confirmed.context.desiredTraining?.runDurationMin === 50)
})

test('v3 imports fact and dose proposals only after explicit fact acknowledgement and stages without committing', () => {
  const state = fullWeekState()
  const before = structuredClone(state)
  const review = parseHandoffReply(JSON.stringify({
    ...buildHandoff(state, scope).example, currentTraining, week: authoredWeek,
    summary: 'The proposed routine starts with familiar movements and comfortable running.',
  }), state, scope)
  assert.equal(review.reply.version, 3)
  assert.throws(() => applyHandoff(state, review, scope), /Acknowledge/)
  const applied = applyHandoff(state, { ...review, currentTrainingAcknowledged: true }, scope)
  assert.deepEqual(applied.pendingWeek, authoredWeek)
  assert.deepEqual(applied.draft.currentTraining, { ...currentTraining, source: 'chat' })
  assert.equal(applied.draft.weeklyRunMinutes, currentTraining.weeklyRunMinutes)
  assert.equal(applied.draft.runsPerWeek, currentTraining.runsPerWeek)
  assert.equal(applied.draft.confirmed, false)
  assert.deepEqual(applied.draft.trainingPreferences, before.draft.trainingPreferences)
  assert.deepEqual(applied.weeks, [])
  assert.equal(applied.setupComplete, false)
  assert.deepEqual(state, before)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(applied))), applied)
})

test('v3 includes all fixed club sessions before assessment and counts them inside the weekly budget', () => {
  const state = fullWeekState()
  state.draft.practiceDays = [3, 1]
  state.draft.practiceTime = '18:30'
  state.draft.practiceDuration = 75
  const nextScope: HandoffScope = { ...scope, nextWeekStart: '2026-09-21' }
  const { context, instructions } = buildHandoff(state, nextScope)
  assert.equal(context.baseline, null)
  assert.ok('fixedCommitments' in context)
  assert.deepEqual(context.fixedCommitments, [
    { id: 'practice-1', sessionId: 'fixed-1-2026-09-21', label: 'Dodgeball practice',
      dayOfWeek: 1, date: '2026-09-22', startTime: '18:30', durationMin: 75, discipline: 'sport', modality: 'court_sport' },
    { id: 'practice-3', sessionId: 'fixed-2-2026-09-21', label: 'Dodgeball practice',
      dayOfWeek: 3, date: '2026-09-24', startTime: '18:30', durationMin: 75, discipline: 'sport', modality: 'court_sport' },
  ])
  assert.equal(context.calendarConstraints.fixedCommitmentMinutes, 150)
  assert.equal(context.calendarConstraints.timeBudgetIncludesFixedCommitments, true)
  assert.doesNotMatch(JSON.stringify(context.fixedCommitments), /estimatedLoad|coefficients|predictedLoad/)
  assert.match(instructions, /before discussing weekly load distribution/)
  assert.match(instructions, /independently of baseline confirmation/)
  assert.match(instructions, /weeklyTimeBudgetMin already includes fixedCommitmentMinutes/)
  assert.match(instructions, /omit unchanged club sessions from week.sessions/)
  assert.match(instructions, /Do not duplicate club training/)
  const content = JSON.stringify(buildHandoff(state, nextScope).example)
  assert.throws(() => parseHandoffReply(content, {
    ...state, draft: { ...state.draft, practiceDuration: 90 },
  }, nextScope), /changed since this brief/)
  const withoutClub = buildHandoff({ ...state, draft: { ...state.draft, practiceDays: [] } }, scope)
  assert.ok('fixedCommitments' in withoutClub.context)
  assert.deepEqual(withoutClub.context.fixedCommitments, [])
  assert.equal(withoutClub.context.calendarConstraints.fixedCommitmentMinutes, 0)
})

test('v3 exports advisory dose references and independent baseline comparisons without safety coefficients', () => {
  const state = fullWeekState(true)
  state.draft = normalizeRecommendedDraft({
    ...state.draft, currentTraining: { ...currentTraining, weeklyRunMinutes: 50 },
  })
  const observed: typeof state.draft.exercises[number] = {
    exerciseId: 'push-up', date: '2026-09-07', weightKg: 0,
    sets: 1, reps: 5, actualRPE: 6, experienceMonths: 12,
  }
  state.draft.exercises = [observed]
  const { context, instructions } = buildHandoff(state, scope)
  assert.ok('authoredWeekLimits' in context)
  const limits = context.authoredWeekLimits
  assert.equal(limits.trainingReferences.workUnitsPerSession, AUTHORED_WEEK_POLICY.maxSessionWorkUnits)
  assert.equal(limits.trainingReferences.repetitionsPerSession, AUTHORED_WEEK_POLICY.maxSessionRepetitions)
  assert.equal(limits.trainingReferences.advisory, true)
  assert.equal(limits.aboveBaselineProposalsSupported, true)
  assert.deepEqual(limits.requiredConditioningResources.row, ['rower'])
  assert.deepEqual(limits.requiredConditioningResources.ski_erg, ['ski_erg'])
  assert.equal(limits.maxDistinctExercises, 32)
  assert.equal(limits.automaticProgressionSupported, false)
  assert.equal(limits.baselineComparisons?.advisory, true)
  assert.equal(limits.baselineComparisons?.running.maxMinutes, 50)
  assert.equal(limits.baselineComparisons?.running.maxSessionMinutes, 30)
  assert.equal(limits.baselineComparisons?.running.maxSessions, 2)
  assert.equal(limits.baselineComparisons?.lifting.maxWorkUnits, 16)
  assert.equal(limits.baselineComparisons?.lifting.maxRepetitions, 128)
  assert.equal(limits.baselineComparisons?.lifting.maxMinutes, 90)
  for (const item of context.customProfileCatalog ?? []) {
    assert.deepEqual(item.doseReference, CUSTOM_EXERCISE_PROFILES[item.id].profile.prescription)
  }
  assert.ok(context.allowedCatalog.filter(item => 'kind' in item && item.kind === 'exercise')
    .every(item => 'doseReference' in item))
  const movement = context.allowedCatalog.find(item => item.id === observed.exerciseId)
  assert.ok(movement && 'doseReference' in movement)
  assert.deepEqual(movement.doseReference, { unit: 'reps', sets: 1, reps: 5, targetRPE: 6 })
  const unknown = buildHandoff(fullWeekState(), scope)
  assert.ok('authoredWeekLimits' in unknown.context)
  assert.equal(unknown.context.authoredWeekLimits.baselineComparisons, null)
  assert.doesNotMatch(JSON.stringify(context), /"coefficients"|"schedulingEstimate"|"predictedLoad"/)
  assert.match(instructions, /app is a validation, approval and logging harness/)
  assert.match(instructions, /advisory starting references, not upper bounds/)
  assert.match(instructions, /Never replace weekly minutes with longestRunMinutes multiplied by runsPerWeek/)
  assert.match(instructions, /Above-baseline proposals and deliberate progression are supported/)
})

test('v3 quantities cannot hide in prose or carry AI approval, load coefficients or extra dose fields', () => {
  const state = fullWeekState(true)
  const reply = { ...buildHandoff(state, scope).example, week: authoredWeek }
  for (const invalid of [
    { ...reply, summary: 'Do 3 sets of 10 reps.' },
    { ...reply, summary: 'A'.repeat(MAX_HANDOFF_SUMMARY_LENGTH + 1) },
    { ...reply, currentTraining: { ...currentTraining, approved: true } },
    { ...reply, currentTraining: { ...currentTraining, weeklyRunMinutes: 999 } },
    { ...reply, week: { ...authoredWeek, safety: { passed: true } } },
    { ...reply, week: { ...authoredWeek, sessions: [{ ...authoredWeek.sessions[0], predictedLoad: { systemic: 0, structural: 0 } }] } },
    { ...reply, week: { ...authoredWeek, sessions: [{ ...authoredWeek.sessions[0], label: 'Run for 30 minutes' }] } },
    { ...reply, week: { ...authoredWeek, sessions: [{ ...authoredWeek.sessions[1], blocks: [{ unit: 'reps', exerciseId: 'push-up', sets: 1, reps: 5, targetRPE: 6, weightKg: 20 }] }] } },
    { ...reply, cards: [{ ...card, instructions: 'Run 30 minutes.' }] },
  ]) assert.throws(() => parseHandoffReply(JSON.stringify(invalid), state, scope), JSON.stringify(invalid))
  assert.throws(() => parseHandoffReply(JSON.stringify(reply).replace('"sets":1', '"sets":4,"sets":1'), state, scope), /repeats/)
  assert.throws(() => parseHandoffReply('x'.repeat(FULL_WEEK_HANDOFF_LIMIT + 1), state, scope), /128 KB/)
})

test('v3 full weeks may use more than seven equipped identities without expanding the built-in selection', () => {
  const state = fullWeekState(true)
  const brief = buildHandoff(state, scope)
  const movements = brief.context.allowedCatalog.filter(item => 'kind' in item && item.kind === 'exercise' && item.unit === 'reps').slice(0, 8)
  assert.equal(movements.length, 8)
  const week: AuthoredWeekProposal = {
    ...authoredWeek, sessions: [0, 1].map(index => ({
      id: `varied-lifting-${index}`, kind: 'workout', date: index ? '2026-09-11' : '2026-09-09',
      startTime: '08:00', durationMin: 30, label: 'Controlled lifting',
      blocks: movements.slice(index * 4, index * 4 + 4).map(item => ({
        unit: 'reps', exerciseId: item.id, sets: 1, reps: 5, targetRPE: 6,
      })),
    })),
  }
  const review = parseHandoffReply(JSON.stringify({ ...brief.example, week }), state, scope)
  assert.equal(review.reply.version, 3)
  assert.deepEqual(applyHandoff(state, review, scope).pendingWeek, week)
  assert.deepEqual(applyHandoff(state, review, scope).draft.program?.selectedExerciseIds, state.draft.program?.selectedExerciseIds)
  assert.match(brief.instructions, /including more than seven/)
  assert.throws(() => parseHandoffReply(JSON.stringify({
    ...brief.example,
    proposal: { goalKind: 'hybrid', label: 'Goal', location: '', eventDate: null, priorities: ['aerobic_base'], exerciseIds: movements.map(item => item.id) },
  }), state, scope), /exercise IDs/)
})

test('v3 accepts up to 32 immutable custom definitions and shows oversized replies instead of truncating them', () => {
  const state = fullWeekState(true)
  const definitions = Array.from({ length: 32 }, (_, index) => ({
    ...custom, id: `custom-reviewed-hinge-${index}`,
    description: 'Controlled movement with a steady position. '.repeat(10).trim(),
    focus: 'Keep a stable position and comfortable range. '.repeat(10).trim(),
    why: 'An alternative movement for the stated goal. '.repeat(10).trim(),
  }))
  const content = JSON.stringify({ ...buildHandoff(state, scope).example, customExercises: definitions })
  assert.ok(content.length > HANDOFF_LIMIT)
  const review = parseHandoffReply(content, state, scope)
  assert.equal(review.reply.customExercises.length, 32)
  assert.equal(applyHandoff(state, review, scope).draft.program?.customExercises?.length, 32)
  assert.throws(() => parseHandoffReply(JSON.stringify({ ...buildHandoff(state, scope).example,
    customExercises: [...definitions, { ...custom, id: 'custom-too-many' }],
  }), state, scope), /at most 32/)
})

test('v3 custom throwing definitions become approved scheduled and loggable identities, not notes-only cards', () => {
  const state = fullWeekState(true)
  const week: AuthoredWeekProposal = { version: 1, weekStart: '2026-09-07', sessions: [{
    id: 'fixed-1-2026-09-07', kind: 'workout', date: '2026-09-08', startTime: '19:00',
    durationMin: 90, label: 'Dodgeball practice', sourceCommitmentId: 'practice-1',
    blocks: [{ unit: 'throws', drillId: customDrill.id, throws: 10 }],
  }] }
  const linked: WorkoutCard = {
    ...card, id: 'target-throw-reference', exerciseId: customDrill.id, title: customDrill.name,
    purpose: customDrill.why, instructions: customDrill.description, cues: customDrill.focus,
    resources: ['court', 'dodgeballs', 'safe_target'],
  }
  const before = structuredClone(state)
  const review = parseHandoffReply(JSON.stringify({
    ...buildHandoff(state, scope).example, customSportDrills: [customDrill], cards: [linked], week,
  }), state, scope)
  assert.equal(review.reply.version, 3)
  assert.ok(review.reply.version === 3 && review.reply.customSportDrills[0].id === customDrill.id)
  assert.throws(() => applyHandoff(state, review, scope), /acknowledge the custom throwing drills/)
  const staged = applyHandoff(state, { ...review, customSportDrillsAcknowledged: true }, scope)
  assert.deepEqual(staged.draft.program?.customSportDrills, [customDrill])
  assert.deepEqual(staged.pendingWeek, week)
  assert.equal(staged.draft.confirmed, false)
  assert.deepEqual(staged.cards, [linked])
  assert.deepEqual(state, before)
  const context = buildHandoff(staged, scope).context
  assert.ok(context.allowedCatalog.some(item => item.id === customDrill.id && 'kind' in item && item.kind === 'sport_drill'))
  assert.ok('customSportDrillProfileCatalog' in context
    && context.customSportDrillProfileCatalog[0].id === customDrill.profileId)
  const built = buildCampaign({ ...staged, draft: { ...staged.draft, confirmed: true } })
  assert.equal(built.weeks[0].plan.safety.passed, true)
  assert.equal(built.weeks[0].plan.sessions.length, 2)
  const session = built.weeks[0].plan.sessions.find(item => item.id === week.sessions[0].id)
  assert.ok(session?.kind === 'workout')
  assert.deepEqual(session.blocks, [{
    unit: 'throws', drillId: customDrill.id, throws: 10, intent: 'controlled_technique', embedded: true,
  }])
  const logged = logCampaignBlockAmount(built, session.id, 0, '8')
  const completed = completeCampaignSession(logged, session.id, 90, 5, false)
  assert.deepEqual(completed.weeks[0].logs[session.id].blockLogs, [{
    unit: 'throws', blockIndex: 0, drillId: customDrill.id, throws: 8,
  }])
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(completed))), completed)
  assert.equal(buildWeekReview(completed)?.sessions.find(item => item.id === session.id)?.blockLogs?.[0].unit, 'throws')
  const repeated = nextCampaignWeek(completed)
  const repeatedPractice = repeated.weeks[1]!.plan.sessions.find(item => item.kind === 'workout' && item.sourceCommitmentId === 'practice-1')
  assert.ok(repeatedPractice?.kind === 'workout')
  assert.equal(repeatedPractice.id, 'fixed-1-2026-09-14')
  assert.equal(repeatedPractice.date, '2026-09-15')
  assert.deepEqual(repeatedPractice.blocks, session.blocks)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(repeated))), repeated)
  assert.throws(() => parseHandoffReply(JSON.stringify({
    ...buildHandoff(state, scope).example, customSportDrills: [], cards: [linked], week,
  }), state, scope))
})

test('v3 explicit controlled court practice works with a neutral goal and an independently reported practice cap', () => {
  const state = fullWeekState(true)
  state.draft = normalizeRecommendedDraft({
    ...state.draft, goalKind: 'custom', goalLabel: 'Local club competition',
    practiceProfile: 'controlled_target_throw',
    recommendedSetup: { ...state.draft.recommendedSetup!, goalText: 'Prepare for my local club competition.' },
  })
  const brief = buildHandoff(state, scope)
  assert.ok('fixedCommitments' in brief.context)
  assert.ok(brief.context.fixedCommitments.every(item => item.modality === 'court_sport' && item.label === 'Goal practice'))
  assert.equal(brief.context.goal.label, 'Local club competition')
  assert.equal(brief.context.practiceProfile, 'controlled_target_throw')
  const profile = brief.context.customSportDrillProfileCatalog[0]
  assert.equal(profile.id, CONTROLLED_TARGET_THROW_PROFILE.id)
  assert.deepEqual(profile.requirements, CONTROLLED_TARGET_THROW_PROFILE.requirements)
  assert.deepEqual(profile.technicalBounds, {
    minThrowsPerPractice: CONTROLLED_TARGET_THROW_PROFILE.minThrowsPerPractice,
    maxThrowsPerPractice: AI_ADVISORY_LIMITS.maxThrowsPerBlock,
    maxDefinitions: CONTROLLED_TARGET_THROW_PROFILE.maxDefinitions,
  })
  assert.ok(!('calibrationFraction' in profile))
  const assessing = buildHandoff({ ...state, draft: { ...state.draft, confirmed: false } }, scope)
  assert.equal(assessing.context.baseline, null)
  assert.equal(assessing.context.program?.comfortableThrowsPerPractice, 60)
  assert.ok('authoredWeekLimits' in assessing.context)
  assert.equal(assessing.context.authoredWeekLimits.throwing?.maxPerConfirmedPractice, 60)
  assert.equal(assessing.context.authoredWeekLimits.throwing?.maxPerUncalibratedPractice, 30)
  assert.match(brief.instructions, /format bounds, not recommended or medically safe doses/)
  const fixed = brief.context.fixedCommitments[0]
  const week: AuthoredWeekProposal = { version: 1, weekStart: state.draft.startDate, sessions: [{
    kind: 'workout', id: fixed.sessionId, date: fixed.date, startTime: fixed.startTime,
    durationMin: fixed.durationMin, label: fixed.label, sourceCommitmentId: fixed.id,
    blocks: [{ unit: 'throws', drillId: customDrill.id, throws: 10 }],
  }] }
  const review = parseHandoffReply(JSON.stringify({ ...brief.example, customSportDrills: [customDrill], week }), state, scope)
  const staged = applyHandoff(state, { ...review, customSportDrillsAcknowledged: true }, scope)
  const built = buildCampaign({ ...staged, draft: { ...staged.draft, confirmed: true } })
  assert.equal(built.weeks[0].plan.safety.passed, true)
  assert.equal(built.draft.goalKind, 'custom')
  assert.equal(built.draft.goalLabel, 'Local club competition')
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(built))), built)
  const withoutCap = structuredClone(state)
  delete withoutCap.draft.program!.comfortableThrowsPerPractice
  const noExposure = buildHandoff(withoutCap, scope)
  assert.ok('customSportDrillProfileCatalog' in noExposure.context)
  assert.deepEqual(noExposure.context.customSportDrillProfileCatalog, [])
  assert.match(brief.instructions, /Preserve their goal name and classification/)
})

test('v3 throwing definitions reject identity reuse, hidden doses, unsupported resources and self-approval', () => {
  const state = fullWeekState(true)
  const example = buildHandoff(state, scope).example
  for (const drill of [
    { ...customDrill, id: 'dodgeball-controlled-target-throw' },
    { ...customDrill, profileId: 'ballistic_throw' },
    { ...customDrill, requirements: ['dodgeball'] },
    { ...customDrill, requirements: [...customDrill.requirements, 'custom:unconfirmed-target'] },
    { ...customDrill, unit: 'throws' }, { ...customDrill, throws: 99 },
    { ...customDrill, coefficients: { systemic: 0, structural: 0 } },
    { ...customDrill, approved: true },
    { ...customDrill, description: 'Perform 100 throws.' },
  ]) assert.throws(() => parseHandoffReply(JSON.stringify({ ...example, customSportDrills: [drill] }), state, scope))
  assert.throws(() => parseHandoffReply(JSON.stringify({ ...example, customSportDrills: [customDrill, customDrill] }), state, scope), /unique/)
  const staged = { ...state, draft: stageCustomSportDrills(state.draft, [customDrill]) }
  const edited = { ...buildHandoff(staged, scope).example, customSportDrills: [{ ...customDrill, focus: 'A changed technique.' }] }
  assert.throws(() => parseHandoffReply(JSON.stringify(edited), staged, scope), /immutable/)
  const collision = { ...example, customExercises: [{ ...custom, id: customDrill.id }], customSportDrills: [customDrill] }
  assert.throws(() => parseHandoffReply(JSON.stringify(collision), state, scope), /collide/)
  const olderV3 = JSON.parse(JSON.stringify(example))
  delete olderV3.customSportDrills
  const compatible = parseHandoffReply(JSON.stringify(olderV3), state, scope)
  assert.ok(compatible.reply.version === 3)
  assert.deepEqual(compatible.reply.customSportDrills, [])
  const legacy = programState()
  assert.throws(() => parseHandoffReply(JSON.stringify({
    ...buildHandoff(legacy, scope).example, customSportDrills: [],
  }), legacy, scope), /format/)
})

test('v3 stale target, staged week, baseline, scope and post-review edits invalidate the entire proposal', () => {
  const state = fullWeekState(true)
  const input = { ...buildHandoff(state, scope).example, week: authoredWeek }
  const review = parseHandoffReply(JSON.stringify(input), state, scope)
  assert.throws(() => applyHandoff({ ...state, pendingWeek: authoredWeek }, review, scope), /changed since this brief/)
  assert.throws(() => applyHandoff(state, review, { ...scope, nextWeekStart: '2026-09-14' }), /changed since this brief/)
  assert.throws(() => applyHandoff(state, review, scope, 'A different requested week'), /changed since this brief/)
  assert.throws(() => applyHandoff({ ...state, draft: { ...state.draft, confirmed: false } }, review, scope), /changed since this brief/)
  const changed = structuredClone(review)
  if (changed.reply.version === 3) changed.reply.week = { ...authoredWeek, sessions: [] }
  assert.throws(() => applyHandoff(state, changed, scope), /changed after review/)
  assert.throws(() => parseHandoffReply(JSON.stringify({ ...input, week: { ...authoredWeek, weekStart: '2026-09-14' } }), state, scope), /target week start/)
})

test('v3 weekly review preserves the baseline and actual target start, while committed current-week notes stay v2', () => {
  const initial = programState()
  const committed = buildCampaign({ ...initial, draft: { ...initial.draft, confirmed: true } })
  const state = fullWeekState(true)
  const weekly: HandoffScope = { purpose: 'suggest_exercises', weekReview: buildWeekReview(committed), nextWeekStart: '2026-09-14' }
  const brief = buildHandoff(state, weekly)
  assert.equal(brief.example.version, 3)
  assert.equal(brief.context.calendarConstraints.startDate, '2026-09-14')
  assert.throws(() => parseHandoffReply(JSON.stringify({ ...brief.example, currentTraining }), state, weekly), /cannot replace/)
  const review = parseHandoffReply(JSON.stringify({
    ...brief.example, week: { version: 1, weekStart: '2026-09-14', sessions: [] },
  }), state, weekly)
  const applied = applyHandoff(state, review, weekly)
  assert.deepEqual(applied.draft.currentTraining, state.draft.currentTraining)
  assert.equal(applied.draft.confirmed, false)
  const locked = { ...committed, draft: { ...committed.draft, trainingPreferences: state.draft.trainingPreferences } }
  const lockedBrief = buildHandoff(locked, { purpose: 'suggest_exercises' })
  assert.equal(lockedBrief.example.version, 2)
  assert.throws(() => parseHandoffReply(JSON.stringify({ ...lockedBrief.example, version: 3, currentTraining: null, week: null }), locked, { purpose: 'suggest_exercises' }), /locked/)
})

test('exact ProgrammingRevision initialization retains the approved current or legacy baseline for a nonempty v3 week', () => {
  for (const original of [fullWeekState(true), programState()]) {
    const committed = buildCampaign({ ...original, draft: { ...original.draft, confirmed: true } })
    const working: typeof committed = {
      version: 1, step: 3, setupComplete: false, sample: committed.sample,
      draft: { ...committed.draft, confirmed: false }, weeks: [], selectedWeek: 0, setDrafts: {}, cards: committed.cards ?? [],
    }
    const weekly: HandoffScope = {
      purpose: 'suggest_exercises', weekReview: buildWeekReview(committed),
      nextWeekStart: addDays(committed.draft.startDate, committed.weeks.length * 7),
    }
    const brief = buildHandoff(working, weekly)
    assert.ok('assessmentRequired' in brief.context)
    assert.equal(brief.context.assessmentRequired, false)
    assert.equal(brief.context.baselineConfirmed, true)
    assert.deepEqual(brief.context.currentTraining, committed.draft.currentTraining ?? null)
    assert.equal(brief.context.baseline?.weeklyRunMinutes, committed.draft.weeklyRunMinutes)
    assert.equal(brief.context.baseline?.runsPerWeek, committed.draft.runsPerWeek)
    assert.equal(brief.context.baseline?.liftsPerWeek, committed.draft.liftsPerWeek)
    assert.equal(brief.context.calendarConstraints.fixedCommitmentMinutes, committed.draft.practiceDays.length * committed.draft.practiceDuration)
    assert.equal(brief.context.calendarConstraints.weeklyTimeBudgetMin, committed.draft.weeklyTimeBudgetMin)
    assert.deepEqual(brief.context.program?.conditioningBaselines, committed.draft.program?.conditioningBaselines)
    assert.equal(brief.context.program?.comfortableThrowsPerPractice, committed.draft.program?.comfortableThrowsPerPractice)
    assert.deepEqual(brief.context.confirmedExerciseObservations, committed.draft.exercises)
    const week: AuthoredWeekProposal = { version: 1, weekStart: weekly.nextWeekStart!, sessions: [{
      id: 'reviewed-next-run', date: weekly.nextWeekStart!, startTime: '08:00', durationMin: 20,
      label: 'Comfortable run', kind: 'run', modality: 'run_road', intent: 'easy',
    }] }
    const review = parseHandoffReply(JSON.stringify({ ...brief.example, week }), working, weekly)
    assert.ok(review.reply.version === 3)
    assert.equal(review.reply.currentTraining, null)
    const staged = applyHandoff(working, review, weekly)
    assert.deepEqual(staged.pendingWeek, week)
    assert.deepEqual(staged.draft.currentTraining, committed.draft.currentTraining)
    assert.equal(staged.draft.confirmed, false)
    assert.throws(() => parseHandoffReply(JSON.stringify({ ...brief.example, currentTraining }), working, weekly), /cannot replace/)
  }
})

test('v3 shares only explicitly included confirmed sanitized activity evidence, never previous plan data', () => {
  const state = fullWeekState(true)
  const prior = programState()
  state.pastPlans = [buildCampaign({ ...prior, draft: { ...prior.draft, goalLabel: 'PRIVATE PRIOR PLAN TITLE', confirmed: true } })]
  state.draft.trainingHistory = {
    version: 1, units: 'metric', confirmed: true,
    activities: [{ source: 'garmin_csv', localTimestamp: '2026-09-05T10:00:00',
      type: 'running', durationMin: 30, distanceKm: 5, averageHr: 130 }],
  }
  const defaultBrief = exportHandoff(state, scope)
  assert.doesNotMatch(defaultBrief, /PRIVATE PRIOR PLAN TITLE|"trainingHistory"|"averageHr"/)
  const included: HandoffScope = { ...scope, includeTrainingHistory: true }
  const brief = buildHandoff(state, included)
  assert.ok('trainingHistory' in brief.context && brief.context.trainingHistory?.records.length === 1)
  assert.doesNotMatch(JSON.stringify(brief.context), /PRIVATE PRIOR PLAN TITLE|latitude|longitude|filename/)
  assert.throws(() => buildHandoff({ ...state, draft: { ...state.draft,
    trainingHistory: { ...state.draft.trainingHistory!, confirmed: false },
  } }, included), /confirm the activity history/)
  const review = parseHandoffReply(JSON.stringify(brief.example), state, included)
  assert.doesNotThrow(() => applyHandoff(state, review, scope))
  const history = state.draft.trainingHistory!
  assert.throws(() => applyHandoff({ ...state, draft: { ...state.draft, trainingHistory: {
    ...history, activities: [{ ...history.activities[0], durationMin: 45 }],
  } } }, review, scope), /changed since this brief/)
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
