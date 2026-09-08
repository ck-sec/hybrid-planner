import assert from 'node:assert/strict'
import test from 'node:test'
import { addDays, dayNumber, dayOfWeek } from '../../engine/dates.ts'
import { LIMITS } from '../../engine/constants.ts'
import type { AuthoredWeekProposal } from '../../engine/authored-week.ts'
import type { CustomExerciseSpec } from '../../engine/types.ts'
import { CHAT_BRIEF_LIMIT } from './compact-handoff.ts'
import { applyHandoff, buildChatHandoff, buildHandoff, exportHandoff, parseHandoffReply, requestHandoff } from './handoff.ts'
import type { HandoffScope } from './handoff.ts'
import { buildCampaign, confirmSetupEquipment, emptyCampaign, logCampaignBlockAmount, normalizeRecommendedDraft, parseCampaign } from './model.ts'
import { stageCustomExercises } from './custom-exercises.ts'
import { selectProgramExercises } from './programming.ts'
import { buildWeekReview } from './week-review.ts'

const scope: HandoffScope = { purpose: 'interpret_goal' }
const start = '2026-09-07'
function prepared() {
  const state = confirmSetupEquipment(emptyCampaign(start), [
    'floor_space', 'carry_space', 'barbell', 'rack', 'bench', 'dumbbell', 'kettlebell',
    'bands', 'cable', 'machine', 'pull_up_bar', 'bike', 'rower', 'ski_erg',
  ])
  return { ...state, draft: normalizeRecommendedDraft({
    ...state.draft, confirmed: true,
    currentTraining: { version: 1, source: 'manual', asOf: start, runsPerWeek: 2,
      weeklyRunMinutes: 60, longestRunMinutes: 40, liftsPerWeek: 2, liftDurationMin: 45 },
    trainingPreferences: { version: 1, runsPerWeek: 2, runDurationMin: 45, liftsPerWeek: 2, liftDurationMin: 45 },
    recommendedSetup: { ...state.draft.recommendedSetup!, mode: 'assisted', goalText: 'Run and lift with suitable mobility.' },
  }) }
}

function definition(index: number): CustomExerciseSpec {
  return { version: 1, id: `custom-comfortable-mobility-${index}`, name: `Comfortable mobility position ${index}`,
    profileId: 'timed_mobility', requirements: ['bodyweight', 'floor_space'],
    description: 'Hold a familiar comfortable position without forcing the range.',
    focus: 'Stay relaxed.', why: 'An athlete-chosen mobility option.' }
}

test('the exact copied brief omits the library and stays below 16000 characters for an equipped setup', () => {
  const state = prepared()
  const before = structuredClone(state)
  const internal = buildHandoff(state, scope)
  const brief = buildChatHandoff(state, scope)
  assert.equal(exportHandoff(state, scope), brief.text)
  assert.ok(brief.text.length <= CHAT_BRIEF_LIMIT, `Copied ${brief.text.length} chars`)
  assert.ok(brief.instructions.length + brief.user.length <= CHAT_BRIEF_LIMIT)
  assert.ok(internal.context.allowedCatalog.length > brief.context.exerciseReferences.length)
  assert.doesNotMatch(brief.text, /"allowedCatalog"|"customProfileCatalog"|"doseReference"|"schedulingEstimate"|"customSportDrillProfileCatalog"/)
  assert.match(brief.text, /Choose exercises freely/)
  assert.match(brief.text, /define a new custom exercise/)
  assert.match(brief.text, /timed_mobility/)
  assert.match(brief.text, /two-a-days/)
  assert.equal(brief.context.currentTraining?.weeklyRunMinutes, 60)
  assert.equal(brief.context.currentTraining?.longestRunMinutes, 40)
  assert.deepEqual(state, before)
})

test('AI-chosen exercises absent from the library can be reviewed, scheduled, logged and restored', () => {
  const state = prepared()
  const customExercises = Array.from({ length: 12 }, (_, index) => definition(index))
  const sessions: AuthoredWeekProposal['sessions'] = [0, 1].map(day => ({
    id: `mobility-${day}`, kind: 'workout', date: addDays(start, day), startTime: '07:00',
    durationMin: 20, label: 'Mobility',
    blocks: customExercises.slice(day * 6, day * 6 + 6).map(exercise => ({
      unit: 'seconds', exerciseId: exercise.id, sets: 1, seconds: 30,
    })),
  }))
  const week: AuthoredWeekProposal = { version: 1, weekStart: start, sessions }
  const internal = buildHandoff(state, scope)
  assert.ok(customExercises.every(exercise => !internal.context.allowedCatalog.some(item => item.id === exercise.id)))
  const review = parseHandoffReply(JSON.stringify({ ...internal.example, customExercises, week }), state, scope)
  const staged = applyHandoff(state, review, scope)
  assert.equal(staged.setupComplete, false)
  assert.equal(staged.weeks.length, 0)
  const built = buildCampaign({ ...staged, draft: { ...staged.draft, confirmed: true } })
  assert.equal(built.weeks[0]!.plan.sessions.length, 2)
  const logged = logCampaignBlockAmount(built, built.weeks[0]!.plan.sessions[0]!.id, 0, '35')
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(logged))), logged)
  assert.equal(logged.draft.program!.customExercises!.length, 12)
  assert.equal(logged.weeks[0]!.logs[built.weeks[0]!.plan.sessions[0]!.id]!.blockLogs![0]!.unit, 'seconds')
})

test('maximum-size definitions, history, notes and recorded weeks never produce oversized outgoing messages', t => {
  let state = prepared()
  const definitions = Array.from({ length: LIMITS.maxCustomExercises }, (_, index) => ({
    ...definition(index), id: `custom-${String(index).padStart(2, '0')}-${'a'.repeat(68)}`,
    name: 'N'.repeat(80), description: 'D'.repeat(600), focus: 'F'.repeat(600), why: 'W'.repeat(600),
  }))
  state = { ...state, draft: selectProgramExercises(stageCustomExercises(state.draft, definitions), definitions.slice(0, 7).map(exercise => exercise.id)) }
  state.draft.recommendedSetup!.goalText = 'G'.repeat(LIMITS.maxNotesLength)
  state.draft.trainingHistory = {
    version: 1, units: 'metric', confirmed: true,
    activities: Array.from({ length: 5000 }, (_, index) => ({
      source: 'garmin_csv' as const, localTimestamp: `${addDays(start, index - 4999)}T07:00:00`,
      type: 'running' as const, durationMin: 30, distanceKm: 5, averageHr: 130,
    })),
  }
  const built = buildCampaign({ ...state, draft: { ...state.draft, confirmed: true } })
  const weekReview = buildWeekReview(built)!
  const session = weekReview.sessions[0]!
  weekReview.sessions = Array.from({ length: 56 }, (_, index) => ({
    ...session, id: `session-${index}`, date: addDays(start, index % 7),
    status: 'partial', notes: 'PRIVATE NOTE '.repeat(160), painFlag: index % 3 === 0,
    actualDurationMin: 12, actualEffort: 5,
    feedback: { version: 1, feeling: 'harder', outcome: 'finished_early', note: 'FEEDBACK '.repeat(55) },
  }))
  weekReview.changes = Array.from({ length: 100 }, (_, index) => ({ id: `change-${index}`, message: 'Future preference '.repeat(100) }))
  const task: HandoffScope = { purpose: 'suggest_exercises', weekReview, nextWeekStart: addDays(start, 7), includeTrainingHistory: true }
  const before = structuredClone(state)
  for (const selectedScope of [{ ...scope, includeTrainingHistory: true }, task]) {
    const brief = buildChatHandoff(state, selectedScope, 'R'.repeat(500))
    assert.ok(brief.text.length <= CHAT_BRIEF_LIMIT, `Copied ${brief.text.length} chars`)
    assert.ok(brief.instructions.length + brief.user.length <= CHAT_BRIEF_LIMIT)
    assert.match(brief.text, /omitted|summar/i)
    assert.doesNotMatch(brief.text, /D{600}|F{600}|W{600}/)
    assert.equal(brief.context.trainingHistory?.recordCount, 5000)
    assert.ok(definitions.every(exercise => !exercise.id.startsWith(brief.context.newCustomIdPrefix)))
    t.diagnostic(`${selectedScope.weekReview ? 'Large weekly review' : 'Large setup'}: ${brief.text.length} copied chars; ${brief.instructions.length + brief.user.length} API content chars`)
  }
  assert.deepEqual(state, before)
})

test('API sends precisely the bounded compact contract, not the internal library or credentials', async () => {
  const state = prepared()
  const compact = buildChatHandoff(state, scope)
  let body = ''
  let calls = 0
  await requestHandoff(state, scope, '', {
    endpoint: 'https://example.invalid/chat/completions', model: 'fake', apiKey: 'SYNTHETIC-KEY',
  }, true, undefined, async (_url, init) => {
    calls++
    body = String(init?.body)
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop',
      message: { role: 'assistant', content: JSON.stringify(buildHandoff(state, scope).example) },
    }] }), { headers: { 'Content-Type': 'application/json' } })
  })
  const payload = JSON.parse(body)
  assert.equal(calls, 1)
  assert.deepEqual(payload.messages, [
    { role: 'system', content: compact.instructions }, { role: 'user', content: compact.user },
  ])
  assert.ok(payload.messages.reduce((sum: number, message: { content: string }) => sum + message.content.length, 0) < 16000)
  assert.doesNotMatch(body, /SYNTHETIC-KEY|"allowedCatalog"/)
})

test('compact planning keeps generic club commitments but cannot import practice replacements', () => {
  const state = prepared()
  state.draft.practiceDays = [1, 3]
  state.draft.practiceTime = '19:00'
  state.draft.practiceDuration = 90
  state.draft = normalizeRecommendedDraft(state.draft)
  const brief = buildChatHandoff(state, scope)
  assert.ok('fixedCommitments' in brief.context)
  assert.equal(brief.context.fixedCommitments?.length, 2)
  assert.ok(brief.context.fixedCommitments?.every(session => session.durationMin === 90))
  assert.doesNotMatch(brief.text, /controlled_target_throw|comfortableThrowsPerPractice|customSportDrillProfileCatalog/)
  const proposal = { ...buildHandoff(state, scope).example, week: { version: 1, weekStart: start, sessions: [{
    id: 'club-replacement', kind: 'workout', date: addDays(start, 1), startTime: '19:00', durationMin: 90,
    label: 'Club practice', sourceCommitmentId: 'practice-1',
    blocks: [{ unit: 'throws', drillId: 'dodgeball-controlled-target-throw', throws: 10 }],
  }] } }
  assert.throws(() => parseHandoffReply(JSON.stringify(proposal), state, scope), /Do not replace club practice/)
})

test('setup and next-week briefs keep club weekdays inside every possible rolling start', () => {
  const original = prepared()
  const weekReview = buildWeekReview(buildCampaign(original))!
  for (let offset = 0; offset < 7; offset++) {
    const target = addDays(start, offset)
    const state = { ...original, draft: normalizeRecommendedDraft({
      ...original.draft, startDate: target, practiceDays: [1, 3], practiceTime: '19:00', practiceDuration: 60,
    }) }
    for (const selectedScope of [scope, { purpose: 'suggest_exercises' as const, weekReview, nextWeekStart: addDays(target, 7) }]) {
      const brief = buildChatHandoff(state, selectedScope)
      assert.ok('fixedCommitments' in brief.context)
      const expectedStart = selectedScope.nextWeekStart ?? target
      assert.equal(brief.context.targetWeekStart, expectedStart)
      assert.equal(brief.context.fixedCommitments.length, 2)
      for (const commitment of brief.context.fixedCommitments) {
        assert.equal(dayOfWeek(commitment.date), commitment.id === 'practice-1' ? 1 : 3)
        assert.ok(dayNumber(commitment.date) >= dayNumber(expectedStart))
        assert.ok(dayNumber(commitment.date) < dayNumber(expectedStart) + 7)
      }
    }
  }
})
