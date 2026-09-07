import assert from 'node:assert/strict'
import test from 'node:test'
import { assertCurrentTrainingDate, parseCurrentTraining, parseTrainingPreferences } from './training-baseline.ts'
import { budgetBuiltInSessions, buildCampaign, confirmSetupEquipment, emptyCampaign, normalizeRecommendedDraft, parseCampaign } from './model.ts'
import { patchOnboardingDraft, validateOnboardingRoutine } from './onboarding.ts'

const current = {
  version: 1, source: 'manual', asOf: '2026-09-06',
  weeklyRunMinutes: 80, longestRunMinutes: 45, runsPerWeek: 2, liftsPerWeek: 2, liftDurationMin: 40,
} as const

test('desired routine can be prepared without inventing a current baseline', () => {
  const state = emptyCampaign('2026-09-07')
  const draft = patchOnboardingDraft(state.draft, {
    trainingPreferences: { version: 1, runsPerWeek: 4, runDurationMin: 60, liftsPerWeek: 3, liftDurationMin: 60 },
  }, { goalText: 'Run and lift consistently' })
  validateOnboardingRoutine(draft)
  assert.equal(draft.weeklyRunMinutes, 0)
  assert.equal(draft.runsPerWeek, 0)
  assert.equal(draft.currentTraining, undefined)
  assert.throws(() => buildCampaign({ ...state, draft: { ...draft, confirmed: true } }), /baseline|duration|training/i)
})

test('explicit baseline preserves weekly total and longest run independently of desired amounts', () => {
  const state = confirmSetupEquipment(emptyCampaign('2026-09-07'), ['floor_space'])
  const draft = normalizeRecommendedDraft({
    ...state.draft, currentTraining: current,
    trainingPreferences: { version: 1, runsPerWeek: 4, runDurationMin: 60, liftsPerWeek: 3, liftDurationMin: 60 },
  })
  assert.equal(draft.weeklyRunMinutes, 80)
  assert.equal(draft.recommendedSetup!.typicalRunMinutes, 45)
  assert.equal(draft.runsPerWeek, 2)
  assert.equal(draft.trainingPreferences!.runsPerWeek, 4)
  const restored = parseCampaign(JSON.parse(JSON.stringify({ ...state, draft })))
  assert.deepEqual(restored.draft, draft)
  const built = buildCampaign({ ...state, draft: { ...draft, confirmed: true } })
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(built))).draft.currentTraining, current)
})

test('reported facts are bounded, internally consistent and recent only after explicit date validation', () => {
  assert.deepEqual(parseCurrentTraining(current), current)
  assert.throws(() => parseCurrentTraining({ ...current, invented: true }), /fields/)
  assert.throws(() => parseCurrentTraining({ ...current, runsPerWeek: 1 }), /conflict/)
  assert.throws(() => parseCurrentTraining({ ...current, weeklyRunMinutes: NaN }), /number/)
  assert.throws(() => parseCurrentTraining({ ...current, source: 'inferred' }), /source/)
  assert.throws(() => assertCurrentTrainingDate({ ...current, asOf: '2026-05-12' }, '2026-09-07'), /Older imports/)
  assert.throws(() => assertCurrentTrainingDate(current, '2026-09-01'), /42 days/)
  assert.doesNotThrow(() => assertCurrentTrainingDate(current, '2026-09-07'))
  assert.throws(() => parseTrainingPreferences({ version: 1, runsPerWeek: 15, runDurationMin: 30, liftsPerWeek: 2, liftDurationMin: 45 }), /Desired runs/)
})

test('high-frequency average preferences and zero activity counts stay separate from reported facts', () => {
  const state = emptyCampaign('2026-09-07')
  const preferences = { version: 1, runsPerWeek: 14, runDurationMin: 90, liftsPerWeek: 14, liftDurationMin: 90 }
  const draft = patchOnboardingDraft(state.draft, { currentTraining: current, trainingPreferences: parseTrainingPreferences(preferences) })
  validateOnboardingRoutine(draft)
  assert.deepEqual(draft.currentTraining, current)
  assert.equal(draft.weeklyRunMinutes, 80)
  assert.equal(draft.runsPerWeek, 2)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify({ ...state, draft }))).draft.trainingPreferences, preferences)
  for (const runsPerWeek of [-1, 15, 1.5, Infinity, NaN, '14']) {
    assert.throws(() => parseTrainingPreferences({ ...preferences, runsPerWeek }))
  }
  const withoutRunning = patchOnboardingDraft(draft, { trainingPreferences: { ...draft.trainingPreferences!, runsPerWeek: 0, runDurationMin: 0 } })
  assert.doesNotThrow(() => validateOnboardingRoutine(withoutRunning))
  const missingAverage = patchOnboardingDraft(draft, { trainingPreferences: { ...draft.trainingPreferences!, runDurationMin: 0 } })
  assert.throws(() => validateOnboardingRoutine(missingAverage), /average duration/)
})

test('built-in planning honours a smaller desired routine without rewriting observed capacity', () => {
  const state = confirmSetupEquipment(emptyCampaign('2026-09-07'), ['floor_space'])
  const draft = normalizeRecommendedDraft({
    ...state.draft, currentTraining: current, confirmed: true,
    trainingPreferences: { version: 1, runsPerWeek: 1, runDurationMin: 20, liftsPerWeek: 1, liftDurationMin: 30 },
  })

  const built = buildCampaign({ ...state, draft })
  const week = built.weeks[0]!
  assert.equal(week.input.athlete.baseline.runsPerWeek, 2)
  assert.equal(week.input.athlete.baseline.weeklyRunMinutes, 80)
  assert.equal(week.plan.sessions.filter(item => item.discipline === 'run').length, 1)
  assert.equal(week.plan.sessions.filter(item => item.discipline === 'strength').length, 1)
  assert.ok(week.plan.sessions.filter(item => item.discipline === 'run').every(item => item.durationMin <= 20))
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(built))), built)
})

test('built-in preference budgeting preserves short and long sessions instead of treating averages as individual caps', () => {
  const source = confirmSetupEquipment(emptyCampaign('2026-09-07'), ['floor_space'])
  const draft = normalizeRecommendedDraft({ ...source.draft, currentTraining: current, confirmed: true })
  const built = buildCampaign({ ...source, draft })
  const runs = built.weeks[0]!.plan.sessions.filter(session => session.discipline === 'run')
  const lifts = built.weeks[0]!.plan.sessions.filter(session => session.discipline === 'strength')
  assert.equal(runs.length, 2)
  assert.equal(lifts.length, 2)
  const varied = [
    { ...runs[0]!, durationMin: 20 }, { ...runs[1]!, durationMin: 80 },
    { ...lifts[0]!, durationMin: 20 }, { ...lifts[1]!, durationMin: 60 },
  ]
  const before = structuredClone(varied)
  const budgeted = budgetBuiltInSessions(varied, {
    version: 1, runsPerWeek: 2, runDurationMin: 30, liftsPerWeek: 2, liftDurationMin: 30,
  })
  assert.deepEqual(budgeted.filter(session => session.discipline === 'run').map(session => session.durationMin), [12, 48])
  assert.deepEqual(budgeted.filter(session => session.discipline === 'strength').map(session => session.durationMin), [15, 45])
  assert.deepEqual(varied, before)
  assert.deepEqual(draft.currentTraining, current)
})
