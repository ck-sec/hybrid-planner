import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createBackupEnvelope,
  isFullySpecifiedClubSession,
  parseAthleteProfile,
  parseBackupEnvelope,
  parseOnboardingDraft,
  parseWeekImportBundle,
  parseWeekPlan,
  parseWorkout,
  parseWorkoutLog,
  parsePlanningContext,
  parseGoalAssessment,
  parseWeeklyReview,
  weekPlanEnd,
  type FixedClubSession,
} from './contracts.ts'
import {
  addDaysToLocalDate,
  isLocalDate,
  localDateDayOfWeek,
  parseClockTime,
  parseIsoTimestamp,
  parseLocalDate,
} from './local-date.ts'
import { isStableIdentity, parseStableIdentity } from './identity.ts'

const athlete = {
  version: 1,
  id: 'athlete-amy',
  createdOn: '2026-09-07',
  updatedOn: '2026-09-08',
  name: 'Amy',
  goal: 'Build a consistent running and lifting week.',
  goalDate: '2026-12-06',
  sports: ['running', 'lifting'],
  preferredWeeklyStructure: [
    { dayOfWeek: 1, modalities: ['strength'], preferredStartTime: '07:00', expectedDurationMin: 60 },
    { dayOfWeek: 3, modalities: ['aerobic', 'mobility'], preferredStartTime: '18:30', expectedDurationMin: 50 },
  ],
  strengthPreference: 'upper_lower',
  equipmentDetails: [
    { id: 'kit-barbell', label: 'Barbell', constraints: ['Needs rack access'] },
    { id: 'kit-road-shoes', label: 'Road shoes', constraints: [] },
  ],
  constraints: ['Avoid back-to-back hard run days'],
  clubSessions: [
    { id: 'club-track', title: 'Track club', scope: 'Primary run session', category: 'aerobic', dayOfWeek: 2, startTime: '19:00', durationMin: 75 },
  ],
}

const weekPlan = {
  version: 1,
  id: 'week-2026-09-07',
  athleteId: 'athlete-amy',
  weekStart: '2026-09-07',
  title: 'Base week',
  goal: 'Build consistency.',
  workouts: [
    {
      version: 1,
      id: 'workout-run-1',
      athleteId: 'athlete-amy',
      weekPlanId: 'week-2026-09-07',
      scheduledDate: '2026-09-08',
      startTime: '19:00',
      category: 'aerobic',
      source: 'club',
      title: 'Track club',
      purpose: 'Use the weekly club session as the hard aerobic anchor.',
      expectedDurationMin: 75,
      warmup: [{ id: 'step-run-warm', title: 'Jog', target: { minutes: 15 } }],
      main: [{ id: 'step-run-main', title: 'Intervals', target: { minutes: 40, effort: 'hard' } }],
      cooldown: [{ id: 'step-run-cool', title: 'Jog', target: { minutes: 10 } }],
      fixedClubSession: {
        recurringSessionId: 'club-track',
        title: 'Track club',
        scope: 'Primary run session',
        category: 'aerobic',
        dayOfWeek: 2,
        startTime: '19:00',
        durationMin: 75,
      },
    },
    {
      version: 1,
      id: 'workout-lift-1',
      athleteId: 'athlete-amy',
      weekPlanId: 'week-2026-09-07',
      scheduledDate: '2026-09-10',
      category: 'strength',
      source: 'ai',
      title: 'Lower body',
      purpose: 'Build strength without crowding the next run.',
      expectedDurationMin: 60,
      warmup: [],
      main: [{ id: 'step-lift-main', title: 'Front squat', target: { sets: 4, reps: 5, loadKg: 65 } }],
      cooldown: [{ id: 'step-lift-cool', title: 'Hip mobility', target: { seconds: 90 } }],
      notes: 'Keep bar speed crisp.',
    },
  ],
}

const workoutLog = {
  version: 1,
  id: 'log-run-1',
  athleteId: 'athlete-amy',
  weekPlanId: 'week-2026-09-07',
  workoutId: 'workout-run-1',
  loggedOn: '2026-09-08',
  outcome: 'completed',
  effortRating: 8,
  metrics: {
    durationMin: 74,
    distanceMeters: 10800,
    paceSecondsPerKm: 250,
    averageHeartRate: 164,
  },
  steps: [
    { stepId: 'step-run-main', completedMinutes: 41, completedDistanceMeters: 8000, completedPaceSecondsPerKm: 245, notes: 'Strong final rep.' },
  ],
  notes: 'Felt controlled.',
}

const onboardingDraft = {
  version: 1,
  id: 'draft-amy',
  athleteId: 'athlete-amy',
  createdOn: '2026-09-07',
  updatedOn: '2026-09-08',
  startingWeek: '2026-09-14',
  name: 'Amy',
  goal: 'Balance running, lifting, and mobility.',
  goalDate: '2026-12-06',
  sports: ['running', 'lifting'],
  preferredWeeklyStructure: [
    { dayOfWeek: 1, modalities: ['strength'], preferredStartTime: '07:00' },
    { dayOfWeek: 2, modalities: ['aerobic'] },
  ],
  strengthPreference: 'upper_lower',
  equipmentDetails: [{ id: 'kit-barbell', label: 'Barbell', constraints: ['Needs rack access'] }],
  constraints: ['No early-morning club travel days'],
  clubSessions: [
    { id: 'club-track', title: 'Track club', scope: 'Primary run session', category: 'aerobic', dayOfWeek: 2, startTime: '19:00', durationMin: 75 },
  ],
}

test('local dates, timestamps, clock times, weekdays, and stable ids validate strictly', () => {
  assert.equal(parseLocalDate('2026-02-28'), '2026-02-28')
  assert.equal(isLocalDate('2026-02-29'), false)
  assert.equal(addDaysToLocalDate(parseLocalDate('2026-09-07'), 6), '2026-09-13')
  assert.equal(localDateDayOfWeek(parseLocalDate('2026-09-08')), 2)
  assert.equal(parseClockTime('06:45'), '06:45')
  assert.equal(parseIsoTimestamp('2026-09-09T06:14:51.760Z'), '2026-09-09T06:14:51.760Z')
  assert.equal(parseStableIdentity('week-2026-09-07'), 'week-2026-09-07')
  assert.equal(isStableIdentity('Week 1'), false)
  assert.throws(() => parseLocalDate('2026-02-29'))
  assert.throws(() => parseClockTime('24:00'))
  assert.throws(() => parseIsoTimestamp('2026-09-09'))
  assert.throws(() => parseStableIdentity('Week 1'))
})

test('contracts parse valid athlete, workout, week, log, and onboarding records', () => {
  const parsedAthlete = parseAthleteProfile(athlete)
  const parsedWorkout = parseWorkout(weekPlan.workouts[0])
  const parsedWeek = parseWeekPlan(weekPlan)
  const parsedLog = parseWorkoutLog(workoutLog)
  const parsedDraft = parseOnboardingDraft(onboardingDraft)
  const bundle = parseWeekImportBundle({ weekPlan, workoutLogs: [workoutLog] })

  assert.equal(parsedAthlete.goalDate, '2026-12-06')
  assert.equal(parsedAthlete.preferredWeeklyStructure[1]!.modalities[1], 'mobility')
  assert.equal(parsedWorkout.fixedClubSession?.scope, 'Primary run session')
  assert.equal(parsedWeek.workouts.length, 2)
  assert.equal(weekPlanEnd(parsedWeek), '2026-09-13')
  assert.equal(parsedLog.metrics?.paceSecondsPerKm, 250)
  assert.equal(parsedDraft.clubSessions[0]!.startTime, '19:00')
  assert.equal(bundle.workoutLogs.length, 1)
})

test('athletes and onboarding drafts can leave strength programming unspecified without a default', () => {
  const profileInput = { ...athlete, notes: 'Discuss strength programming with the coach.' }
  const draftInput = { ...onboardingDraft, notes: 'Discuss strength programming with the coach.' }
  const { strengthPreference: _profilePreference, ...profileWithoutPreference } = profileInput
  const { strengthPreference: _draftPreference, ...draftWithoutPreference } = draftInput
  const profile = parseAthleteProfile(profileWithoutPreference)
  const draft = parseOnboardingDraft(draftWithoutPreference)

  assert.equal(profile.strengthPreference, undefined)
  assert.equal(draft.strengthPreference, undefined)
  assert.equal(profile.notes, profileInput.notes)
  assert.equal(draft.notes, draftInput.notes)
  assert.doesNotMatch(JSON.stringify([profile, draft]), /full.body|strengthPreference/i)

  for (const preference of ['full_body', 'upper_lower', 'push_pull_legs', 'mixed']) {
    assert.equal(parseAthleteProfile({ ...athlete, strengthPreference: preference }).strengthPreference, preference)
    assert.equal(parseOnboardingDraft({ ...onboardingDraft, strengthPreference: preference }).strengthPreference, preference)
  }
  for (const preference of [null, '', 'invented']) {
    assert.throws(() => parseAthleteProfile({ ...athlete, strengthPreference: preference }), /strengthPreference/)
    assert.throws(() => parseOnboardingDraft({ ...onboardingDraft, strengthPreference: preference }), /strengthPreference/)
  }
})

test('minimal and partially specified recurring clubs parse without inventing workout metadata', () => {
  const minimal = { id: 'club-social', title: 'Social club', dayOfWeek: 0, startTime: '09:30', notes: 'Meet by the gate.' }
  const partial = { ...minimal, id: 'club-partial', category: 'aerobic', durationMin: 60 }
  for (const record of [
    parseAthleteProfile({ ...athlete, clubSessions: [minimal, partial] }),
    parseOnboardingDraft({ ...onboardingDraft, clubSessions: [minimal, partial] }),
  ]) {
    assert.deepEqual(JSON.parse(JSON.stringify(record.clubSessions)), [minimal, partial])
    assert.equal(record.clubSessions[0]!.scope, undefined)
    assert.equal(record.clubSessions[0]!.category, undefined)
    assert.equal(record.clubSessions[0]!.durationMin, undefined)
    assert.equal(isFullySpecifiedClubSession(record.clubSessions[0]!), false)
    assert.equal(isFullySpecifiedClubSession(record.clubSessions[1]!), false)
  }
})

test('club-only athlete profiles may omit preferred training days but cannot have an empty schedule', () => {
  const minimal = { id: 'club-social', title: 'Social club', dayOfWeek: 0, startTime: '09:30' }
  for (const clubSessions of [[minimal], athlete.clubSessions]) {
    const profile = parseAthleteProfile({
      ...athlete,
      strengthPreference: undefined,
      preferredWeeklyStructure: [],
      clubSessions,
    })
    assert.deepEqual(profile.preferredWeeklyStructure, [])
    assert.deepEqual(JSON.parse(JSON.stringify(profile.clubSessions)), clubSessions)
    assert.equal(profile.strengthPreference, undefined)
  }
  assert.throws(
    () => parseAthleteProfile({ ...athlete, preferredWeeklyStructure: [], clubSessions: [] }),
    /AthleteProfile\.preferredWeeklyStructure: Add at least one preferred training day or recurring club session\./,
  )
  assert.throws(
    () => parseAthleteProfile({ ...athlete, preferredWeeklyStructure: [], clubSessions: [{ ...minimal, startTime: '24:00' }] }),
    /AthleteProfile\.clubSessions\[0\]\.startTime/,
  )
  assert.doesNotThrow(() => parseAthleteProfile({ ...athlete, clubSessions: [] }))
})

test('fully specified legacy recurring clubs retain their metadata and narrow to fixed workout metadata', () => {
  const profile = parseAthleteProfile(athlete)
  const session = profile.clubSessions[0]!
  assert.equal(isFullySpecifiedClubSession(session), true)
  if (!isFullySpecifiedClubSession(session)) return
  const fixedMetadata: FixedClubSession = {
    recurringSessionId: session.id,
    title: session.title,
    scope: session.scope,
    category: session.category,
    dayOfWeek: session.dayOfWeek,
    startTime: session.startTime,
    durationMin: session.durationMin,
  }
  assert.deepEqual(fixedMetadata, weekPlan.workouts[0]!.fixedClubSession)
  for (const field of ['scope', 'category', 'durationMin'] as const) {
    assert.equal(isFullySpecifiedClubSession({ ...session, [field]: undefined }), false)
  }
})

test('recurring clubs still strictly validate every supplied field', () => {
  const minimal = { id: 'club-social', title: 'Social club', dayOfWeek: 0, startTime: '09:30' }
  const invalidFields = [
    { scope: '' }, { scope: null }, { scope: 12 },
    { category: 'running' }, { category: null },
    { durationMin: 0 }, { durationMin: 1_441 }, { durationMin: 45.5 }, { durationMin: '45' }, { durationMin: null },
    { id: 'Club social' }, { title: '' }, { dayOfWeek: 7 }, { startTime: '24:00' }, { notes: 123 }, { intensity: 'easy' },
  ]
  for (const invalid of invalidFields) {
    assert.throws(() => parseAthleteProfile({ ...athlete, clubSessions: [{ ...minimal, ...invalid }] }), /clubSessions/)
    assert.throws(() => parseOnboardingDraft({ ...onboardingDraft, clubSessions: [{ ...minimal, ...invalid }] }), /clubSessions/)
  }
})

test('normal workouts and fixed club workout metadata still require category and duration', () => {
  const workout = weekPlan.workouts[0]!
  for (const field of ['scope', 'category', 'durationMin'] as const) {
    assert.throws(() => parseWorkout({
      ...workout,
      fixedClubSession: { ...workout.fixedClubSession, [field]: undefined },
    }), /fixedClubSession/)
  }
  for (const field of ['category', 'expectedDurationMin']) {
    assert.throws(() => parseWorkout({ ...weekPlan.workouts[1], [field]: undefined }), new RegExp(field))
  }
})

test('workouts reject explicit status fields and invalid club metadata', () => {
  const withStatus = { ...structuredClone(weekPlan.workouts[0]), status: 'planned' }
  assert.throws(() => parseWorkout(withStatus), /Unexpected field/i)

  const baseWorkout = structuredClone(weekPlan.workouts[0])
  assert.ok(baseWorkout)
  assert.ok(baseWorkout.fixedClubSession)
  const invalidClub = structuredClone(baseWorkout)
  invalidClub.fixedClubSession.category = 'strength'
  assert.throws(() => parseWorkout(invalidClub), /must match the workout category/i)

  const wrongDay = structuredClone(baseWorkout)
  wrongDay.fixedClubSession.dayOfWeek = 3
  assert.throws(() => parseWorkout(wrongDay), /scheduled workout day/i)
})

test('week plans and onboarding drafts reject invalid schedule relationships', () => {
  const invalidWeek = structuredClone(weekPlan)
  invalidWeek.workouts[1]!.scheduledDate = '2026-09-15'
  assert.throws(() => parseWeekPlan(invalidWeek), /seven-day plan window/i)

  const invalidDraft = structuredClone(onboardingDraft)
  invalidDraft.goalDate = '2026-09-01'
  assert.throws(() => parseOnboardingDraft(invalidDraft), /goalDate cannot be earlier than startingWeek/i)
})

test('week imports and backups reject mismatched references', () => {
  const badImport = structuredClone(workoutLog)
  badImport.steps[0]!.stepId = 'missing-step'
  assert.throws(() => parseWeekImportBundle({ weekPlan, workoutLogs: [badImport] }), /planned workout steps/i)

  const envelope = createBackupEnvelope({
    athleteProfiles: [parseAthleteProfile(athlete)],
    weekPlans: [parseWeekPlan(weekPlan)],
    workoutLogs: [parseWorkoutLog(workoutLog)],
    onboardingDrafts: [parseOnboardingDraft(onboardingDraft)],
    exportedAt: '2026-09-09T06:14:51.760Z',
  })
  assert.equal(parseBackupEnvelope(envelope).weekPlans.length, 1)

  const orphan = structuredClone(envelope)
  orphan.athleteProfiles = []
  assert.throws(() => parseBackupEnvelope(orphan), /saved athlete profile/i)
})

test('planning context preserves unknowns, validates identifiers and rejects invented fields', () => {
  const context = parsePlanningContext({
    asOf: '2026-09-09', recentTraining: { weeks: 4, strengthMinutes: 0 },
    clubLoads: [{ sessionId: 'club-track', durationMin: 75, effortRating: 7 }],
  })
  assert.equal(context.recentTraining?.strengthMinutes, 0)
  assert.equal(context.recentTraining?.aerobicMinutes, undefined)
  assert.throws(() => parsePlanningContext({ ...context, equipment: ['sled'] }), /Unexpected field/)
  assert.throws(() => parsePlanningContext({ ...context, recentTraining: { weeks: 4, aerobicMinutes: -1 } }), /aerobicMinutes/)
  assert.throws(() => parsePlanningContext({ ...context, sessionLimits: [{ dayOfWeek: 1, maxMinutes: 30 }, { dayOfWeek: 1, maxMinutes: 45 }] }), /unique/)
  assert.throws(() => parseAthleteProfile({ ...athlete, planningContext: { ...context, clubLoads: [{ sessionId: 'invented-club' }] } }), /existing club/)
  assert.throws(() => parseGoalAssessment({ status: 'guaranteed', rationale: 'Win', unknowns: [], nextMilestone: 'Win' }), /status/)
})

test('context, assessment, review and load conventions round-trip through backups', () => {
  const context = parsePlanningContext({ asOf: '2026-09-09', event: 'Foam club player', benchmarks: ['Recent working weights'], recentTraining: { weeks: 6, strengthMinutes: 35 } })
  const assessment = parseGoalAssessment({ status: 'conditional', rationale: 'Support club training.', unknowns: ['Selection'], nextMilestone: 'Discuss trials with the coach.' })
  const profile = parseAthleteProfile({ ...athlete, planningContext: context })
  const week = parseWeekPlan({
    ...weekPlan, planningContext: context, goalAssessment: assessment,
    review: { reflection: 'Good week', energy: 3, recovery: 4, nextFocus: 'Keep club fresh', metrics: [] },
    workouts: weekPlan.workouts.map(workout => ({
      ...workout,
      main: workout.main.map(step => ({ ...step, estimatedTotalMin: 35, target: { ...step.target, loadKg: 12, loadBasis: 'per_implement', repBasis: 'per_side' } })),
    })),
  })
  const log = parseWorkoutLog({ ...workoutLog, steps: workoutLog.steps.map(step => ({ ...step, loadKg: 12, loadBasis: 'per_implement', repBasis: 'per_side' })) })
  const backup = createBackupEnvelope({ athleteProfiles: [profile], weekPlans: [week], workoutLogs: [log] })
  const restored = parseBackupEnvelope(JSON.parse(JSON.stringify(backup)))
  assert.deepEqual(restored.athleteProfiles[0]?.planningContext, context)
  assert.deepEqual(restored.weekPlans[0]?.goalAssessment, assessment)
  assert.equal(restored.weekPlans[0]?.review?.reflection, 'Good week')
  assert.equal(restored.weekPlans[0]?.workouts[0]?.main[0]?.estimatedTotalMin, 35)
  assert.equal(restored.workoutLogs[0]?.steps[0]?.loadKg, 12)
  assert.equal(restored.workoutLogs[0]?.steps[0]?.loadBasis, 'per_implement')
  assert.equal(parseWeekImportBundle({ weekPlan: week, athleteProfile: profile }).athleteProfile?.id, profile.id)
  assert.throws(() => parseWeekImportBundle({ weekPlan: week, athleteProfile: { ...profile, id: 'wrong-athlete' } }), /Profile must belong/)
})

test('draft-only backups and empty manual weeks remain valid without orphan logs', () => {
  const backup = createBackupEnvelope({ onboardingDrafts: [parseOnboardingDraft(onboardingDraft)] })
  assert.equal(parseBackupEnvelope(backup).onboardingDrafts.length, 1)
  const empty = parseWeekPlan({ ...weekPlan, workouts: [] })
  assert.equal(empty.workouts.length, 0)
  assert.throws(() => parseWeekImportBundle({ weekPlan: empty, workoutLogs: [workoutLog] }), /same week plan/)
  assert.equal(parseWorkout(weekPlan.workouts[1]).main[0]?.target?.loadBasis, undefined)
  assert.throws(() => parseWeekPlan({ ...empty, review: { energy: 6, metrics: [] } }), /energy/)
  assert.throws(() => parseWeekPlan({ ...empty, review: { metrics: [{ id: 'metric', label: 'Metric', planned: 'x'.repeat(121) }] } }), /planned/)
})

test('weekly metric override provenance is optional, validated, and survives backups', () => {
  const metrics = [
    { id: 'auto-count', label: 'Automatic', planned: '2', completed: '0', overriddenFields: [] },
    { id: 'manual-count', label: 'Manual', planned: '8', overriddenFields: ['planned', 'note'] },
    { id: 'legacy-count', label: 'Legacy', completed: '3' },
  ]
  const review = parseWeeklyReview({ metrics })
  assert.deepEqual(review.metrics[0]?.overriddenFields, [])
  assert.deepEqual(review.metrics[1]?.overriddenFields, ['planned', 'note'])
  assert.equal(Object.hasOwn(review.metrics[2]!, 'overriddenFields'), false)
  const backup = createBackupEnvelope({
    athleteProfiles: [parseAthleteProfile(athlete)],
    weekPlans: [parseWeekPlan({ ...weekPlan, review })],
  })
  const restored = parseBackupEnvelope(JSON.parse(JSON.stringify(backup)))
  assert.deepEqual(restored.weekPlans[0]?.review, review)
  for (const overriddenFields of [null, '', ['unknown'], [1], ['planned', 'planned'], ['planned', 'completed', 'note', 'planned']]) {
    assert.throws(() => parseWeeklyReview({ metrics: [{ id: 'bad', label: 'Bad', overriddenFields }] }), /overriddenFields/)
  }
})
