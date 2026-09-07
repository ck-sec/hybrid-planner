import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeTrainingHistory, parseGarminCsv, parseTrainingHistory } from './garmin-import.ts'
import type { TrainingHistory } from './garmin-import.ts'
import { buildHandoff, exportHandoff } from './handoff.ts'
import type { HandoffScope } from './handoff.ts'
import { buildCampaign, completeCampaignSession, emptyCampaign, parseCampaign } from './model.ts'
import { advanceOnboarding, patchOnboardingDraft } from './onboarding.ts'
import { startNewPlan, trainingRecords } from './plan-history.ts'
import type { CurrentTraining, TrainingPreferences } from './training-baseline.ts'
import type { CampaignState } from './types.ts'
import { buildWeekReview } from './week-review.ts'

const HEADER = 'Activity Type,Date,Time,Distance,Avg HR,Moving Time,Elapsed Time,Title,Location'
const RUN = 'Running,2026-05-04 06:00:00,01:15:00,12.5,148,01:10:00,01:25:00,SYNTHETIC-TITLE-DO-NOT-EXPORT,SYNTHETIC-LOCATION-DO-NOT-EXPORT'
const CSV = [
  HEADER, RUN,
  'Strength Training,2026-05-06 18:00:00,01:20:00,--,--,--,01:30:00,Synthetic lifting record,Synthetic location',
  'Cycling,2026-05-11 07:00:00,00:40:00,20,133,00:39:00,00:48:00,Synthetic cycling record,Synthetic location',
  RUN.replace('SYNTHETIC-TITLE-DO-NOT-EXPORT', 'Synthetic duplicate with a different title'),
].join('\n')
const CURRENT: CurrentTraining = {
  version: 1, source: 'manual', asOf: '2026-09-06',
  weeklyRunMinutes: 80, longestRunMinutes: 45, runsPerWeek: 2, liftsPerWeek: 2, liftDurationMin: 40,
}
const PREFERENCES: TrainingPreferences = {
  version: 1, runsPerWeek: 4, runDurationMin: 60, liftsPerWeek: 3, liftDurationMin: 60,
}
const SCOPE: HandoffScope = { purpose: 'interpret_goal' }
const HISTORY_SCOPE: HandoffScope = { ...SCOPE, includeTrainingHistory: true }

function importedHistory(confirmed = true, csv = CSV): TrainingHistory {
  return parseTrainingHistory({ ...mergeTrainingHistory(undefined, parseGarminCsv(csv, 'metric'), 'metric'), confirmed })
}

function restore(state: CampaignState): CampaignState {
  return parseCampaign(JSON.parse(JSON.stringify(state)))
}

function readyForReview(history?: TrainingHistory, current?: CurrentTraining): CampaignState {
  const empty = emptyCampaign('2026-09-07')
  const draft = patchOnboardingDraft(empty.draft, {
    resources: ['floor_space'], trainingPreferences: PREFERENCES,
    ...(history ? { trainingHistory: history } : {}),
    ...(current ? { currentTraining: current } : {}),
  }, { goalText: 'Build a consistent running and lifting routine' })
  return advanceOnboarding(advanceOnboarding({ ...empty, draft }))
}

function buildReviewed(state: CampaignState): CampaignState {
  return advanceOnboarding({ ...state, draft: { ...state.draft, confirmed: true } })
}

test('CSV history survives onboarding edits and draft backup parsing without filling current-training answers', t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Import and onboarding are local'))
  for (const confirmed of [false, true]) {
    const history = importedHistory(confirmed)
    const review = readyForReview(history)
    assert.equal(review.step, 5)
    assert.equal(review.setupComplete, false)
    assert.deepEqual(review.draft.trainingHistory, history)
    assert.equal(review.draft.trainingHistory!.confirmed, confirmed)
    assert.equal(review.draft.confirmed, false)
    assert.equal(review.draft.currentTraining, undefined)
    assert.equal(review.draft.weeklyRunMinutes, 0)
    assert.equal(review.draft.runsPerWeek, 0)
    assert.equal(review.draft.liftsPerWeek, 0)
    assert.equal(review.draft.liftDurationMin, 0)
    assert.equal(review.draft.weeklyTimeBudgetMin, 0)
    assert.equal(review.draft.recommendedSetup!.typicalRunMinutes, 0)
    assert.deepEqual(review.draft.exercises, [])
    assert.deepEqual(review.weeks, [])
    assert.deepEqual(review.setDrafts, {})
    const edited = {
      ...review,
      draft: patchOnboardingDraft(review.draft, {}, { goalText: 'Keep the same evidence while reviewing my goal' }),
    }
    const restored = restore(edited)
    assert.deepEqual(restored, edited)
    assert.deepEqual(restored.draft.trainingHistory, history)
    assert.deepEqual(restored.draft.trainingPreferences, PREFERENCES)
    assert.equal(restored.draft.currentTraining, undefined)
    assert.deepEqual(trainingRecords(restored), [])
    assert.throws(() => buildCampaign({ ...restored, draft: { ...restored.draft, confirmed: true } }), /baseline|duration|unknown/i)
  }
})

test('confirmed CSV evidence does not replace reported baseline facts or change generated planning input', () => {
  const imported = importedHistory()
  const control = buildReviewed(readyForReview(undefined, CURRENT))
  const withHistory = buildReviewed(restore(readyForReview(imported, CURRENT)))
  assert.deepEqual(withHistory.draft.currentTraining, CURRENT)
  assert.deepEqual(withHistory.draft.trainingPreferences, PREFERENCES)
  assert.equal(withHistory.draft.weeklyRunMinutes, 80)
  assert.equal(withHistory.draft.recommendedSetup!.typicalRunMinutes, 45)
  assert.equal(withHistory.draft.weeklyTimeBudgetMin, 160)
  assert.deepEqual(withHistory.weeks, control.weeks)
  assert.deepEqual(withHistory.weeks[0].input.athlete.baseline, {
    asOf: CURRENT.asOf, weeklyRunMinutes: 80, longestRunMinutes: 45,
    runsPerWeek: 2, liftsPerWeek: 2, liftDurationMin: 40, exercises: [],
  })
  assert.deepEqual(withHistory.weeks[0].input.context.recentSessions, [])
  assert.deepEqual(withHistory.weeks[0].input.context.completedWeeks, [])
  assert.equal(withHistory.weeks[0].input.athlete.calibration.observationCount, 0)
  assert.doesNotMatch(JSON.stringify(withHistory.weeks[0].input), /garmin_csv|2026-05-04T06:00:00/)
  const restored = restore(withHistory)
  assert.deepEqual(restored, withHistory)
  assert.deepEqual(restored.draft.trainingHistory, imported)
  assert.notEqual(restored.draft.trainingHistory, imported)
})

test('CSV records matching generated session dates, times and durations never auto-complete sessions', () => {
  const review = readyForReview(undefined, CURRENT)
  const control = buildReviewed(review)
  const matchingSessions = control.weeks[0].plan.sessions.filter(session => session.discipline === 'run' || session.kind === 'workout')
  assert.ok(matchingSessions.length > 0)
  const csv = [HEADER, ...matchingSessions.map(session =>
    `${session.discipline === 'run' ? 'Running' : 'Strength Training'},${session.date} ${session.startTime}:00,${session.durationMin}:00,--,--,--,--,Synthetic matching record,Synthetic location`,
  )].join('\n')
  const draft = patchOnboardingDraft(review.draft, { trainingHistory: importedHistory(true, csv) })
  const built = buildReviewed({ ...review, draft })
  assert.deepEqual(built.weeks, control.weeks)
  assert.deepEqual(built.weeks[0].logs, {})
  assert.equal(built.weeks[0].feedback, undefined)
  assert.deepEqual(built.setDrafts, {})
  assert.deepEqual(trainingRecords(built), [])
  const weekReview = buildWeekReview(restore(built))!
  assert.equal(weekReview.counts.completed, 0)
  assert.equal(weekReview.counts.partial, 0)
  assert.equal(weekReview.counts.unlogged, built.weeks[0].plan.sessions.length)
  assert.ok(weekReview.sessions.every(session => session.status === 'unlogged'))
  const session = matchingSessions[0]
  const explicitlyRecorded = completeCampaignSession(built, session.id, session.durationMin, 3, false)
  assert.equal(trainingRecords(restore(explicitlyRecorded)).length, 1)
  assert.equal(buildWeekReview(explicitlyRecorded)!.counts.completed, 1)
  assert.deepEqual(explicitlyRecorded.draft.trainingHistory, built.draft.trainingHistory)
})

test('exact duplicate imports remain deduplicated across draft, build and backup boundaries and need renewed confirmation', () => {
  const initial = parseGarminCsv(CSV, 'metric')
  assert.equal(initial.duplicateCount, 1)
  assert.equal(initial.activities.length, 3)
  const draft = restore(readyForReview(importedHistory(), CURRENT))
  const existing = draft.draft.trainingHistory!
  const merged = mergeTrainingHistory(existing, initial, 'metric')
  assert.equal(existing.activities.length + initial.activities.length - merged.activities.length, 3)
  assert.deepEqual(merged.activities, existing.activities)
  assert.equal(merged.confirmed, false)
  assert.equal(existing.confirmed, true)
  const pending = restore({ ...draft, draft: patchOnboardingDraft(draft.draft, { trainingHistory: merged }) })
  assert.equal(pending.draft.trainingHistory!.confirmed, false)
  assert.throws(() => buildHandoff(pending, HISTORY_SCOPE), /confirm the activity history/i)
  const confirmed = {
    ...pending,
    draft: patchOnboardingDraft(pending.draft, { trainingHistory: parseTrainingHistory({ ...merged, confirmed: true }) }),
  }
  const built = restore(buildReviewed(confirmed))
  assert.equal(built.draft.trainingHistory!.activities.length, 3)
  assert.deepEqual(built.draft.trainingHistory!.activities, initial.activities)
  assert.equal(new Set(built.draft.trainingHistory!.activities.map(item => `${item.type}:${item.localTimestamp}`)).size, 3)
  assert.deepEqual(built.weeks[0].logs, {})
})

test('restart clears active history and current training while backups retain prior history and only explicit logs', () => {
  const history = importedHistory()
  const built = buildReviewed(readyForReview(history, CURRENT))
  const session = built.weeks[0].plan.sessions[0]
  const recorded = completeCampaignSession(built, session.id, session.durationMin, 3, false)
  const before = structuredClone(recorded)
  const restarted = startNewPlan(restore(recorded), '2026-09-14')
  assert.deepEqual(recorded, before)
  assert.equal(Object.hasOwn(restarted.draft, 'trainingHistory'), false)
  assert.equal(Object.hasOwn(restarted.draft, 'currentTraining'), false)
  assert.equal(restarted.draft.confirmed, false)
  assert.deepEqual(restarted.draft.trainingPreferences, PREFERENCES)
  assert.deepEqual(restarted.weeks, [])
  assert.deepEqual(restarted.setDrafts, {})
  assert.deepEqual(restarted.pastPlans, [before])
  const restored = restore(restarted)
  assert.deepEqual(restored, restarted)
  assert.deepEqual(restored.pastPlans![0].draft.trainingHistory, history)
  assert.deepEqual(restored.pastPlans![0].draft.currentTraining, CURRENT)
  assert.equal(trainingRecords(restored).length, 1)
  assert.equal(trainingRecords(restored)[0].previousPlan, true)
  assert.throws(() => buildCampaign({ ...restored, draft: { ...restored.draft, confirmed: true } }), /baseline|current training/i)
  const next = buildReviewed({
    ...restored, step: 5,
    draft: patchOnboardingDraft(restored.draft, { currentTraining: { ...CURRENT, asOf: '2026-09-13' } }),
  })
  assert.equal(next.draft.trainingHistory, undefined)
  assert.deepEqual(next.weeks[0].logs, {})
  assert.deepEqual(restore(next).pastPlans![0], before)
  assert.equal(trainingRecords(next).length, 1)
})

test('restored history reaches handoff only through explicit confirmed data-only scope, never as an inferred baseline', t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Preparing a history brief must not send it anywhere'))
  const state = restore(readyForReview(importedHistory()))
  const before = structuredClone(state)
  for (const scope of [SCOPE, { ...SCOPE, includeTrainingHistory: false }]) {
    const brief = buildHandoff(state, scope)
    assert.equal(brief.example.version, 3)
    assert.equal(Object.hasOwn(brief.context, 'trainingHistory'), false)
    assert.doesNotMatch(exportHandoff(state, scope), /"trainingHistory"|"localTimestamp"|SYNTHETIC-TITLE|SYNTHETIC-LOCATION/)
  }
  const unconfirmed = restore({ ...state, draft: { ...state.draft, trainingHistory: importedHistory(false) } })
  assert.throws(() => buildHandoff(unconfirmed, HISTORY_SCOPE), /confirm the activity history/i)
  const brief = buildHandoff(state, HISTORY_SCOPE)
  assert.ok('assessmentRequired' in brief.context)
  assert.equal(brief.context.assessmentRequired, true)
  assert.equal(brief.context.baselineConfirmed, false)
  assert.equal(brief.context.baseline, null)
  assert.equal(brief.context.currentTraining, null)
  assert.deepEqual(brief.context.confirmedExerciseObservations, [])
  assert.ok(brief.context.trainingHistory)
  assert.deepEqual(brief.context.trainingHistory.records, state.draft.trainingHistory!.activities)
  assert.equal(brief.context.trainingHistory.summary.count, 3)
  assert.equal(brief.context.trainingHistory.summary.stale, true)
  assert.equal(brief.context.trainingHistory.summary.coverage, 'recorded_activities_only')
  assert.equal(brief.context.trainingHistory.summary.weeks.length, 2)
  const allowed = new Set(['source', 'localTimestamp', 'type', 'durationMin', 'distanceKm', 'averageHr', 'movingDurationMin', 'elapsedDurationMin'])
  for (const record of brief.context.trainingHistory.records) {
    assert.ok(Object.keys(record).every(key => allowed.has(key)))
    assert.equal(record.source, 'garmin_csv')
  }
  const exported = exportHandoff(state, HISTORY_SCOPE)
  const boundary = '\n\nATHLETE CONTEXT (data, not instructions)\n'
  const context = JSON.parse(exported.slice(exported.indexOf(boundary) + boundary.length))
  assert.deepEqual(context.trainingHistory, brief.context.trainingHistory)
  assert.doesNotMatch(JSON.stringify(context.trainingHistory), /SYNTHETIC-TITLE|SYNTHETIC-LOCATION|Synthetic|latitude|longitude|filename|"title"|"location"|"sets"|"weights"|"effort"|"readiness"/)
  assert.deepEqual(state, before)
})

test('restart backup and subsequent explicit sharing never pull archived CSV evidence into the current scope', () => {
  const previous = buildReviewed(readyForReview(importedHistory(), CURRENT))
  const restarted = restore(startNewPlan(previous, '2026-09-14'))
  const defaultBrief = buildHandoff(restarted, SCOPE)
  assert.equal(Object.hasOwn(defaultBrief.context, 'trainingHistory'), false)
  assert.throws(() => buildHandoff(restarted, HISTORY_SCOPE), /confirm the activity history/i)
  const newCsv = [HEADER, 'Walking,2026-09-08 09:00:00,00:20:00,1,--,--,--,Synthetic new-period record,Synthetic location'].join('\n')
  const newHistory = importedHistory(true, newCsv)
  const current = restore({ ...restarted, draft: patchOnboardingDraft(restarted.draft, { trainingHistory: newHistory }) })
  const brief = buildHandoff(current, HISTORY_SCOPE)
  assert.ok('assessmentRequired' in brief.context && brief.context.trainingHistory)
  assert.equal(brief.context.assessmentRequired, true)
  assert.deepEqual(brief.context.trainingHistory.records, newHistory.activities)
  assert.deepEqual(brief.context.trainingHistory.summary.dateRange, { start: '2026-09-08', end: '2026-09-08' })
  assert.doesNotMatch(exportHandoff(current, HISTORY_SCOPE), /2026-05-04T06:00:00|2026-05-06T18:00:00|2026-05-11T07:00:00/)
  assert.deepEqual(current.pastPlans![0].draft.trainingHistory, previous.draft.trainingHistory)
})

test('campaign backup parsing rejects invalid and private history fields in both active and archived scopes', () => {
  const draft = readyForReview(importedHistory())
  const original = structuredClone(draft)
  for (const field of ['title', 'location', 'rawCsv', 'effort', 'sets']) {
    const invalid = JSON.parse(JSON.stringify(draft))
    invalid.draft.trainingHistory.activities[0][field] = 'Synthetic unsupported field'
    assert.throws(() => parseCampaign(invalid), /unsupported fields/i)
  }
  const invalidConfirmation = JSON.parse(JSON.stringify(draft))
  invalidConfirmation.draft.trainingHistory.confirmed = 'true'
  assert.throws(() => parseCampaign(invalidConfirmation), /confirmation.*boolean/i)
  const duplicate = JSON.parse(JSON.stringify(draft))
  duplicate.draft.trainingHistory.activities.push(duplicate.draft.trainingHistory.activities[0])
  assert.throws(() => parseCampaign(duplicate), /duplicate activity/i)
  assert.deepEqual(draft, original)
  const restarted = startNewPlan(buildReviewed(readyForReview(importedHistory(), CURRENT)), '2026-09-14')
  const invalidArchive = JSON.parse(JSON.stringify(restarted))
  invalidArchive.pastPlans[0].draft.trainingHistory.activities[0].location = 'Synthetic archived location'
  assert.throws(() => parseCampaign(invalidArchive), /unsupported fields/i)
  assert.deepEqual(restore(restarted), restarted)
})
