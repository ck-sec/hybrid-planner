import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createBackupEnvelope,
  parseAthleteProfile,
  parseOnboardingDraft,
  parseWeekImportBundle,
  parseWeekPlan,
  parseWorkoutLog,
  validateWorkoutLogsForWeekPlan,
  type AthleteProfile,
  type BackupEnvelope,
  type OnboardingDraft,
  type WeekImportBundle,
  type WeekPlan,
  type WorkoutLog,
} from '../../domain/contracts.ts'
import { localDateDayOfWeek, type LocalDateString } from '../../domain/local-date.ts'
import type { HybridCoachRepository, WorkoutLogListQuery } from '../../storage/indexeddb-repository.ts'
import {
  createGuidedOnboardingState,
  reduceGuidedOnboardingState,
  type GuidedOnboardingState,
} from '../state/onboarding.ts'
import {
  addPlannerWorkout,
  createPlannerStateFromWeekPlan,
  createBlankPlannerState,
  plannerStateToWeekPlan,
  type PlannerState,
} from '../state/planner.ts'
import { buildWorkoutReviewPayload, createWorkoutReviewState, getDirtyWorkoutReviewIds, reduceInlineWorkoutReviewState, reduceWorkoutReviewState, startWorkoutReviewLog } from '../state/review.ts'
import { buildInitialWeekPrompt } from '../../ai/index.ts'
import { buildInitialPromptInputFromAthleteProfile, previewAiWeekHandoff } from '../state/ai-handoff.ts'
import { currentWeekStart, listWeekDates, weekStartFor } from './dates.ts'
import {
  applyWeekImport,
  bootstrapApp,
  createDefaultAthleteProfile,
  finalizeGuidedOnboarding,
  persistPlannerWeek,
  saveOnboardingDraftState,
  saveReviewWorkoutLog,
  savePendingReviewWorkoutLogs,
  saveReviewWeek,
  deleteRecordedPlannerWorkout,
  refreshHandoffPrompt,
  startManualWeek,
} from './effects.ts'
import { createControllerId } from './ids.ts'
import { appReducer, createInitialAppState, type AppState, type AppAction } from './state.ts'
import { createAthleteProfileEditingDraft, exportRepositoryBackup, previewRestoreBackupJson } from '../state/settings.ts'
import { buildHeaderProps, buildNavItems, buildStartScreenProps, countPlannedWorkouts, describeSavedState } from './viewModel.ts'
import {
  buildWorkoutDefinition,
  createBlankWorkoutEditorState,
  workoutToEditorState,
  type WorkoutEditorState,
} from './workoutDraft.ts'

const TODAY = '2026-09-09' as LocalDateString
const WEEK_START = weekStartFor(TODAY)

function createFakeRepository(overrides: Partial<HybridCoachRepository> = {}): HybridCoachRepository {
  const athletes = new Map<string, AthleteProfile>()
  const weeks = new Map<string, WeekPlan>()
  const logs = new Map<string, WorkoutLog>()
  const drafts = new Map<string, OnboardingDraft>()

  const repository: HybridCoachRepository = {
    async saveAthleteProfile(profile) {
      const validated = parseAthleteProfile(profile)
      athletes.set(validated.id, validated)
      return validated
    },
    async getAthleteProfile(id) {
      return athletes.get(id)
    },
    async listAthleteProfiles() {
      return [...athletes.values()].sort((left, right) => right.updatedOn.localeCompare(left.updatedOn))
    },
    async saveWeekPlan(weekPlan) {
      const validated = parseWeekPlan(weekPlan)
      if (!athletes.has(validated.athleteId)) throw new Error(`Week plan ${validated.id} requires an existing athlete profile.`)
      weeks.set(validated.id, validated)
      return validated
    },
    async getWeekPlan(id) {
      return weeks.get(id)
    },
    async listWeekPlans(athleteId) {
      return [...weeks.values()]
        .filter(week => athleteId === undefined || week.athleteId === athleteId)
        .sort((left, right) => right.weekStart.localeCompare(left.weekStart))
    },
    async getLatestWeekPlan(athleteId) {
      return (await repository.listWeekPlans(athleteId))[0]
    },
    async deleteWeekPlan(id) {
      weeks.delete(id)
      for (const log of [...logs.values()]) {
        if (log.weekPlanId === id) logs.delete(log.id)
      }
    },
    async saveWorkoutLog(workoutLog) {
      const validated = parseWorkoutLog(workoutLog)
      const weekPlan = weeks.get(validated.weekPlanId)
      if (!weekPlan) throw new Error(`Workout log ${validated.id} requires an existing week plan.`)
      validateWorkoutLogsForWeekPlan(weekPlan, [validated], 'WorkoutLog')
      logs.set(validated.id, validated)
      return validated
    },
    async listWorkoutLogs(query: WorkoutLogListQuery = {}) {
      return [...logs.values()].filter(log =>
        (query.athleteId === undefined || log.athleteId === query.athleteId)
        && (query.weekPlanId === undefined || log.weekPlanId === query.weekPlanId)
        && (query.workoutId === undefined || log.workoutId === query.workoutId))
    },
    async deleteWorkoutLog(id) {
      logs.delete(id)
    },
    async saveOnboardingDraft(draft) {
      const validated = parseOnboardingDraft(draft)
      drafts.set(validated.id, validated)
      return validated
    },
    async getOnboardingDraft(id) {
      return drafts.get(id)
    },
    async listOnboardingDrafts(athleteId) {
      return [...drafts.values()].filter(draft => athleteId === undefined || draft.athleteId === athleteId)
    },
    async deleteOnboardingDraft(id) {
      drafts.delete(id)
    },
    async importWeek(bundle: WeekImportBundle, options = {}) {
      const validated = parseWeekImportBundle(bundle)
      if (options.expectedAthleteProfile
        && JSON.stringify(athletes.get(validated.weekPlan.athleteId)) !== JSON.stringify(parseAthleteProfile(options.expectedAthleteProfile))) {
        throw new Error('The athlete profile changed after preview. Preview the week again before applying it.')
      }
      if (!athletes.has(validated.weekPlan.athleteId) && !validated.athleteProfile) {
        throw new Error(`Week import ${validated.weekPlan.id} requires an existing athlete profile.`)
      }
      const deleted = new Set(options.deleteWorkoutIds ?? [])
      const merged = new Map([...logs].filter(([, log]) => !(log.weekPlanId === validated.weekPlan.id && deleted.has(log.workoutId))))
      for (const log of validated.workoutLogs) merged.set(log.id, log)
      validateWorkoutLogsForWeekPlan(validated.weekPlan, [...merged.values()].filter(log => log.weekPlanId === validated.weekPlan.id), 'CombinedLogs')
      if (validated.athleteProfile) athletes.set(validated.athleteProfile.id, validated.athleteProfile)
      weeks.set(validated.weekPlan.id, validated.weekPlan)
      logs.clear()
      for (const [id, log] of merged) logs.set(id, log)
      return { ...validated, workoutLogs: [...logs.values()].filter(log => log.weekPlanId === validated.weekPlan.id) }
    },
    async exportBackup(): Promise<BackupEnvelope> {
      return createBackupEnvelope({
        athleteProfiles: [...athletes.values()],
        weekPlans: [...weeks.values()],
        workoutLogs: [...logs.values()],
        onboardingDrafts: [...drafts.values()],
      })
    },
    async restoreBackup(backup) {
      athletes.clear()
      weeks.clear()
      logs.clear()
      drafts.clear()
      for (const profile of backup.athleteProfiles) athletes.set(profile.id, profile)
      for (const week of backup.weekPlans) weeks.set(week.id, week)
      for (const log of backup.workoutLogs) logs.set(log.id, log)
      for (const draft of backup.onboardingDrafts) drafts.set(draft.id, draft)
      return backup
    },
    async reset() {
      athletes.clear()
      weeks.clear()
      logs.clear()
      drafts.clear()
    },
  }

  return { ...repository, ...overrides }
}

function filledEditorState(scheduledDate: LocalDateString): WorkoutEditorState {
  const blank = createBlankWorkoutEditorState(scheduledDate)
  const mainStep = blank.sections.find(section => section.id === 'main')!.steps[0]!
  return {
    draft: {
      ...blank.draft,
      workoutTitle: 'Easy aerobic run',
      purpose: 'Build aerobic base without fatigue.',
      expectedDuration: '45',
      scheduledTime: '07:30',
      modality: 'running',
      notes: 'Keep it conversational.',
    },
    sections: blank.sections.map(section =>
      section.id === 'main'
        ? {
          ...section,
          steps: [{
            ...mainStep,
            title: 'Steady run',
            instructions: 'Run at an easy conversational pace.',
            target: 'Zone 2',
            duration: '40 min',
            rest: 'None',
            notes: 'Add strides if fresh.',
          }],
        }
        : section),
  }
}

async function seedPlannerWithWorkout(repository: HybridCoachRepository): Promise<{
  athlete: AthleteProfile
  planner: PlannerState
  weekPlan: WeekPlan
}> {
  const started = await startManualWeek(repository, { today: TODAY, weekStart: WEEK_START })
  const definition = buildWorkoutDefinition(filledEditorState(WEEK_START))
  assert.equal(definition.ok, true)
  if (!definition.ok) throw new Error('definition should be valid')
  const planner = addPlannerWorkout(started.planner, definition.definition)
  const weekPlan = await persistPlannerWeek(repository, planner)
  return { athlete: started.athlete, planner, weekPlan }
}

function completedOnboardingState(): GuidedOnboardingState {
  const initial = createGuidedOnboardingState({
    athleteId: createControllerId('athlete'),
    draftId: createControllerId('draft'),
    athleteName: 'Local athlete',
    createdOn: TODAY,
    startingWeek: WEEK_START,
  })

  let state = reduceGuidedOnboardingState(initial, { type: 'setGoalSummary', value: 'Finish a strong half marathon' })
  state = reduceGuidedOnboardingState(state, { type: 'setCategoryCount', category: 'aerobic', value: '3' })
  state = reduceGuidedOnboardingState(state, { type: 'setCategoryCount', category: 'strength', value: '2' })
  state = reduceGuidedOnboardingState(state, { type: 'setCategoryCount', category: 'mobility', value: '0' })
  for (const day of ['tuesday', 'thursday', 'sunday'] as const) {
    state = reduceGuidedOnboardingState(state, { type: 'toggleCategoryDay', category: 'aerobic', day })
  }
  for (const day of ['monday', 'friday'] as const) {
    state = reduceGuidedOnboardingState(state, { type: 'toggleCategoryDay', category: 'strength', day })
  }
  state = reduceGuidedOnboardingState(state, { type: 'toggleAerobicModality', id: 'running' })
  state = reduceGuidedOnboardingState(state, { type: 'setStrengthPreference', id: 'full_body' })
  state = reduceGuidedOnboardingState(state, { type: 'setEquipmentMode', id: 'home' })
  state = reduceGuidedOnboardingState(state, { type: 'addClubSession' })
  const sessionId = state.clubSessions[0]!.id
  const clubFields = {
    category: 'aerobic',
    activity: 'Club interval night',
    scope: 'Primary weekly anchor',
    location: 'City track',
    day: 'tuesday',
    startTime: '18:30',
    durationMinutes: '60',
  } as const
  for (const [field, value] of Object.entries(clubFields)) {
    state = reduceGuidedOnboardingState(state, {
      type: 'setClubSessionField',
      sessionId,
      field: field as 'activity',
      value,
    })
  }
  return state
}

test('week helpers always resolve a Monday week start with seven dates', () => {
  const weekStart = weekStartFor(TODAY)
  assert.equal(localDateDayOfWeek(weekStart), 1)
  const dates = listWeekDates(weekStart)
  assert.equal(dates.length, 7)
  assert.equal(dates[0], weekStart)
  assert.equal(localDateDayOfWeek(currentWeekStart(new Date('2026-09-09T10:00:00.000Z'))), 1)
})

test('workout editor drafts reject incomplete input and round-trip complete input', () => {
  const blank = buildWorkoutDefinition(createBlankWorkoutEditorState(WEEK_START))
  assert.equal(blank.ok, false)
  if (blank.ok) throw new Error('blank workout should not build')
  assert.ok(blank.messages.some(message => message.id === 'workout-title'))
  assert.ok(blank.messages.some(message => message.id === 'workout-purpose'))

  const result = buildWorkoutDefinition(filledEditorState(WEEK_START))
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('filled workout should build')
  assert.equal(result.definition.title, 'Easy aerobic run')
  assert.equal(result.definition.startTime, '07:30')
  assert.equal(result.definition.expectedDurationMin, 45)
  assert.equal(result.definition.main.length, 1)
  assert.deepEqual(result.definition.main[0]?.target, { minutes: 40 })
  assert.match(String(result.definition.notes), /^Modality: running/)

  const planner = addPlannerWorkout(
    createBlankPlannerState({ athleteId: 'athlete-1', weekStart: WEEK_START, weekPlanId: 'week-1' }),
    result.definition,
  )
  const workout = planner.present.week.workouts[0]!.workout
  const roundTripped = workoutToEditorState(workout)
  assert.equal(roundTripped.draft.modality, 'running')
  assert.equal(roundTripped.draft.notes, 'Keep it conversational.')
  assert.equal(roundTripped.sections.find(section => section.id === 'main')?.steps[0]?.duration, '40 min')
  assert.equal(roundTripped.sections.find(section => section.id === 'main')?.steps[0]?.target, 'Zone 2')
})

test('fixed club workouts cannot be converted to another source in the editor', () => {
  const state = filledEditorState(WEEK_START)
  const result = buildWorkoutDefinition(
    { ...state, draft: { ...state.draft, source: 'manual' } },
    {
      existing: {
        version: 1,
        id: 'club-workout',
        athleteId: 'athlete-1',
        weekPlanId: 'week-1',
        scheduledDate: WEEK_START,
        startTime: '18:30',
        category: 'aerobic',
        source: 'club',
        title: 'Club night',
        purpose: 'Fixed club session.',
        expectedDurationMin: 60,
        warmup: [],
        main: [{ id: 'club-main', title: 'Attend club night' }],
        cooldown: [],
        fixedClubSession: {
          recurringSessionId: 'club-session',
          title: 'Club night',
          scope: 'Primary weekly anchor',
          category: 'aerobic',
          dayOfWeek: localDateDayOfWeek(WEEK_START),
          startTime: '18:30',
          durationMin: 60,
        },
      },
    },
  )
  assert.equal(result.ok, false)
  if (result.ok) throw new Error('club source changes must be rejected')
  assert.ok(result.messages.some(message => message.id === 'workout-club-change'))
})

test('app reducer drives navigation, editor drafts, and imported weeks', () => {
  let state: AppState = createInitialAppState()
  assert.equal(state.phase, 'loading')

  state = appReducer(state, { type: 'bootstrapped', logs: [] })
  assert.equal(state.phase, 'ready')

  state = appReducer(state, { type: 'navigate', route: 'planner' })
  assert.equal(state.route, 'planner')

  state = appReducer(state, {
    type: 'openEditor',
    editor: { mode: 'create', state: createBlankWorkoutEditorState(WEEK_START), messages: [] },
  })
  state = appReducer(state, { type: 'editorField', field: 'workoutTitle', value: 'Tempo run' })
  assert.equal(state.editor?.state.draft.workoutTitle, 'Tempo run')

  state = appReducer(state, { type: 'editorAddStep', sectionId: 'warmup' })
  const warmupStep = state.editor?.state.sections.find(section => section.id === 'warmup')?.steps[0]
  assert.ok(warmupStep)
  state = appReducer(state, {
    type: 'editorStepField',
    sectionId: 'warmup',
    stepId: warmupStep!.id,
    field: 'title',
    value: 'Mobility flow',
  })
  assert.equal(state.editor?.state.sections.find(section => section.id === 'warmup')?.steps[0]?.title, 'Mobility flow')

  state = appReducer(state, { type: 'editorRemoveStep', sectionId: 'warmup', stepId: warmupStep!.id })
  assert.equal(state.editor?.state.sections.find(section => section.id === 'warmup')?.steps.length, 0)

  state = appReducer(state, { type: 'closeEditor' })
  assert.equal(state.editor, undefined)

  state = appReducer(state, { type: 'status', message: { id: 'x', tone: 'error', text: 'Broken' } })
  assert.equal(state.status?.text, 'Broken')
  state = appReducer(state, { type: 'navigate', route: 'ai' })
  assert.equal(state.status, null)
})

test('bootstrap reads saved profile, week, logs, and drafts', async () => {
  const repository = createFakeRepository()
  const empty = await bootstrapApp(repository)
  assert.equal(empty.athlete, undefined)
  assert.deepEqual(empty.logs, [])

  const seeded = await seedPlannerWithWorkout(repository)
  const snapshot = await bootstrapApp(repository)
  assert.equal(snapshot.athlete?.id, seeded.athlete.id)
  assert.equal(snapshot.weekPlan?.id, seeded.weekPlan.id)
  assert.deepEqual(snapshot.logs, [])
})

test('manual start saves a profile and creates an initially unsaved blank week that can be persisted', async () => {
  const repository = createFakeRepository()
  const started = await startManualWeek(repository, { today: TODAY, weekStart: WEEK_START })
  assert.equal((await repository.listAthleteProfiles()).length, 1)
  assert.equal(countPlannedWorkouts(started.planner), 0)
  assert.equal((await repository.listWeekPlans()).length, 0)
  assert.equal((await persistPlannerWeek(repository, started.planner)).workouts.length, 0)

  const definition = buildWorkoutDefinition(filledEditorState(WEEK_START))
  if (!definition.ok) throw new Error('definition should be valid')
  const weekPlan = await persistPlannerWeek(repository, addPlannerWorkout(started.planner, definition.definition))
  assert.equal(weekPlan.workouts.length, 1)
  assert.equal((await repository.listWeekPlans(started.athlete.id)).length, 1)
})

test('repository failures are surfaced instead of reported as saved weeks', async () => {
  const repository = createFakeRepository({
    async saveWeekPlan() {
      throw new Error('Local storage is full.')
    },
  })
  const started = await startManualWeek(repository, { today: TODAY, weekStart: WEEK_START })
  const definition = buildWorkoutDefinition(filledEditorState(WEEK_START))
  if (!definition.ok) throw new Error('definition should be valid')
  await assert.rejects(
    () => persistPlannerWeek(repository, addPlannerWorkout(started.planner, definition.definition)),
    /Local storage is full/,
  )
})

test('guided onboarding saves a resumable draft and finalizes a profile with fixed club sessions', async () => {
  const repository = createFakeRepository()
  const state = completedOnboardingState()

  const draftResult = await saveOnboardingDraftState(repository, state, TODAY)
  assert.equal(draftResult.ok, true)
  if (!draftResult.ok) throw new Error('draft should save')
  assert.equal((await repository.listOnboardingDrafts()).length, 1)
  assert.equal(draftResult.draft.goal, 'Finish a strong half marathon')

  const outcome = await finalizeGuidedOnboarding(repository, state, TODAY)
  if (!outcome.ok) throw new Error(`finalize should succeed: ${outcome.issues[0]?.message}`)
  assert.equal(outcome.result.athlete.clubSessions.length, 1)
  assert.equal(outcome.result.weekPlan?.workouts.length, 1)
  assert.equal(outcome.result.weekPlan?.workouts[0]?.source, 'club')
  assert.equal(countPlannedWorkouts(outcome.result.planner), 1)
  assert.equal((await repository.listOnboardingDrafts()).length, 0)
})

test('incomplete onboarding cannot be finalized', async () => {
  const repository = createFakeRepository()
  const state = createGuidedOnboardingState({
    athleteId: createControllerId('athlete'),
    draftId: createControllerId('draft'),
    createdOn: TODAY,
    startingWeek: WEEK_START,
  })
  const outcome = await finalizeGuidedOnboarding(repository, state, TODAY)
  assert.equal(outcome.ok, false)
  if (outcome.ok) throw new Error('empty onboarding must not finalize')
  assert.ok(outcome.issues.length > 0)
  assert.equal((await repository.listAthleteProfiles()).length, 0)
})

test('pasted week bundles are imported atomically with their logs', async () => {
  const repository = createFakeRepository()
  const seeded = await seedPlannerWithWorkout(repository)
  const importedWeekId = 'week-imported'
  const workoutId = 'workout-imported'
  const bundle: WeekImportBundle = parseWeekImportBundle({
    weekPlan: {
      version: 1,
      id: importedWeekId,
      athleteId: seeded.athlete.id,
      weekStart: WEEK_START,
      title: 'Imported week',
      goal: 'Follow the pasted plan.',
      workouts: [{
        version: 1,
        id: workoutId,
        athleteId: seeded.athlete.id,
        weekPlanId: importedWeekId,
        scheduledDate: WEEK_START,
        category: 'aerobic',
        source: 'ai',
        title: 'Imported run',
        purpose: 'Easy aerobic work.',
        expectedDurationMin: 40,
        warmup: [],
        main: [{ id: 'imported-main', title: 'Run easy' }],
        cooldown: [],
      }],
    },
    workoutLogs: [],
  })

  const result = await applyWeekImport(repository, bundle)
  assert.equal(result.weekPlan.id, importedWeekId)
  assert.deepEqual(result.logs, [])
  assert.equal((await repository.getWeekPlan(importedWeekId))?.workouts.length, 1)

  const brokenBundle = {
    ...bundle,
    weekPlan: { ...bundle.weekPlan, athleteId: 'athlete-missing' },
  } as WeekImportBundle
  await assert.rejects(() => applyWeekImport(repository, brokenBundle))
})

test('workout logs capture completion status and structured actuals', async () => {
  const repository = createFakeRepository()
  const seeded = await seedPlannerWithWorkout(repository)
  const workoutId = seeded.weekPlan.workouts[0]!.id
  const stepId = seeded.weekPlan.workouts[0]!.main[0]!.id

  let review = createWorkoutReviewState({ weekPlan: seeded.weekPlan, workoutLogs: [] })
  review = startWorkoutReviewLog(review, workoutId, 'partial')
  review = reduceWorkoutReviewState(review, { type: 'setWorkoutSessionRpe', workoutId, value: '6' })
  review = reduceWorkoutReviewState(review, {
    type: 'setWorkoutActualSummary',
    workoutId,
    value: 'durationMin: 32\ndistanceMeters: 6000',
  })
  review = reduceWorkoutReviewState(review, {
    type: 'setWorkoutStepResultField',
    workoutId,
    stepId,
    field: 'actualResult',
    value: 'minutes: 30',
  })

  const result = await saveReviewWorkoutLog(repository, review, workoutId)
  assert.equal(result.log.outcome, 'partial')
  assert.equal(result.log.effortRating, 6)
  assert.equal(result.log.metrics?.durationMin, 32)
  assert.equal(result.log.metrics?.distanceMeters, 6_000)
  assert.equal(result.log.steps[0]?.completedMinutes, 30)
  assert.equal(result.logs.length, 1)

  const reloaded = createWorkoutReviewState({ weekPlan: seeded.weekPlan, workoutLogs: [...result.logs] })
  assert.equal(reloaded.workouts[0]?.isLogged, true)
  assert.equal(reloaded.workouts[0]?.draft.completionStatus, 'partial')
})

test('inline logs persist all pending exercise actuals before week-two context is built', async () => {
  const repository = createFakeRepository()
  const seeded = await seedPlannerWithWorkout(repository)
  const first = seeded.weekPlan.workouts[0]!
  const weekPlan = parseWeekPlan({ ...seeded.weekPlan, workouts: [first, { ...first, id: 'second-workout' }] })
  await repository.saveWeekPlan(weekPlan)
  let state = appReducer(createInitialAppState(), { type: 'setReview', review: createWorkoutReviewState({ weekPlan }) })
  const stepId = first.main[0]!.id
  for (const workoutId of [first.id, 'second-workout']) {
    state = appReducer(state, { type: 'inlineReview', action: {
      type: 'setWorkoutStepResultField', workoutId, stepId, field: 'actualResult',
      value: workoutId === first.id ? 'loadKg: 42.5\nsets: 3\nreps: 5' : 'loadKg: 0',
    } })
    state = appReducer(state, { type: 'inlineReview', action: {
      type: 'setWorkoutStepResultField', workoutId, stepId, field: 'notes', value: `Feedback for ${workoutId}`,
    } })
  }
  const submitted = state.review!
  const firstSave = await saveReviewWorkoutLog(repository, submitted, first.id)
  state = appReducer(state, { type: 'reviewLogsSaved', submitted, logs: firstSave.logs, savedWorkoutIds: [first.id] })
  assert.deepEqual(getDirtyWorkoutReviewIds(state.review!), ['second-workout'])
  assert.equal(state.review!.workouts[1]!.draft.stepResults[0]!.notes, 'Feedback for second-workout')
  const pending = await savePendingReviewWorkoutLogs(repository, state.review!)
  assert.deepEqual(pending.savedWorkoutIds, ['second-workout'])
  const logs = await repository.listWorkoutLogs({ weekPlanId: weekPlan.id })
  const reloaded = createWorkoutReviewState({ weekPlan, workoutLogs: logs })
  assert.deepEqual(getDirtyWorkoutReviewIds(reloaded), [])
  assert.equal(logs.find(log => log.workoutId === first.id)?.steps[0]?.loadKg, 42.5)
  assert.equal(logs.find(log => log.workoutId === 'second-workout')?.steps[0]?.loadKg, 0)
  const previousWeek = buildWorkoutReviewPayload(reloaded).previousWeek
  assert.match(JSON.stringify(previousWeek), /Feedback for second-workout/)
  assert.match(JSON.stringify(previousWeek), /"loadKg":42.5/)
  assert.equal(first.main[0]?.target?.loadKg, undefined)
})

test('pending log saves validate before writing and report storage failures', async () => {
  let writes = 0
  const repository = createFakeRepository({ async importWeek() { writes += 1; throw new Error('Storage unavailable') } })
  const seeded = await seedPlannerWithWorkout(repository)
  const workout = seeded.weekPlan.workouts[0]!
  const weekPlan = parseWeekPlan({ ...seeded.weekPlan, workouts: [workout, { ...workout, id: 'second-workout' }] })
  let review = createWorkoutReviewState({ weekPlan })
  for (const [workoutId, value] of [[workout.id, 'loadKg: 40'], ['second-workout', 'loadKg: invalid']] as const) {
    review = reduceInlineWorkoutReviewState(review, {
      type: 'setWorkoutStepResultField', workoutId, stepId: workout.main[0]!.id, field: 'actualResult', value,
    })
  }
  await assert.rejects(savePendingReviewWorkoutLogs(repository, review))
  assert.equal(writes, 0)
  review = reduceInlineWorkoutReviewState(review, {
    type: 'setWorkoutStepResultField', workoutId: 'second-workout', stepId: workout.main[0]!.id, field: 'actualResult', value: 'loadKg: 45',
  })
  await assert.rejects(savePendingReviewWorkoutLogs(repository, review), /Storage unavailable/)
  assert.equal(writes, 1)
  assert.equal(getDirtyWorkoutReviewIds(review).length, 2)
})

test('editing pasted JSON clears its approval and importing the approved plan opens the week', async () => {
  const repository = createFakeRepository()
  const seeded = await seedPlannerWithWorkout(repository)
  const prompt = buildInitialWeekPrompt(buildInitialPromptInputFromAthleteProfile(seeded.athlete, WEEK_START))
  const preview = previewAiWeekHandoff(prompt.exampleJson, {
    athlete: seeded.athlete, targetWeekStart: WEEK_START, expectedWeekType: 'initial', weekPlanId: 'approved-week',
  })
  assert.ok(preview.ok)
  let state = appReducer(createInitialAppState(), { type: 'navigate', route: 'ai' })
  state = appReducer(state, { type: 'setHandoffJson', value: prompt.exampleJson })
  state = appReducer(state, { type: 'setHandoffPreview', preview })
  assert.ok(state.handoff.preview?.ok)
  state = appReducer(state, { type: 'setHandoffJson', value: '{changed' })
  assert.equal(state.handoff.preview, null)
  const imported = await applyWeekImport(repository, preview.bundle)
  state = appReducer(state, { type: 'weekImported', planner: createPlannerStateFromWeekPlan(imported.weekPlan), ...imported })
  assert.equal(state.route, 'planner')
  assert.equal(state.unsavedWeek, false)
  assert.equal(state.savedWeek?.id, 'approved-week')
})

test('starting a new guided week clears active logs without deleting prior feedback', async () => {
  const repository = createFakeRepository()
  const seeded = await seedPlannerWithWorkout(repository)
  const workoutId = seeded.weekPlan.workouts[0]!.id
  const review = startWorkoutReviewLog(createWorkoutReviewState({ weekPlan: seeded.weekPlan }), workoutId, 'completed')
  const saved = await saveReviewWorkoutLog(repository, review, workoutId)
  const outcome = await finalizeGuidedOnboarding(repository, completedOnboardingState(), TODAY)
  assert.ok(outcome.ok)
  const before = appReducer(createInitialAppState(), {
    type: 'bootstrapped', athlete: seeded.athlete, planner: seeded.planner, savedWeek: seeded.weekPlan, logs: saved.logs,
  })
  const after = appReducer(before, {
    type: 'onboardingFinished', athlete: outcome.result.athlete, planner: outcome.result.planner, savedWeek: outcome.result.weekPlan,
  })
  assert.deepEqual(after.logs, [])
  assert.equal((await repository.listWorkoutLogs({ weekPlanId: seeded.weekPlan.id })).length, 1)
})

test('start screen and navigation reflect what is actually saved', async () => {
  const repository = createFakeRepository()
  let state: AppState = appReducer(createInitialAppState(), { type: 'bootstrapped', logs: [] })

  const emptyNav = buildNavItems(state, { onNavigate: () => undefined })
  assert.equal(emptyNav.find(item => item.id === 'nav-planner')?.disabled, true)
  assert.equal(emptyNav.find(item => item.id === 'nav-settings')?.disabled, true)
  assert.deepEqual(emptyNav.map(item => item.label), ['Overview', 'Week', 'AI planner', 'Review', 'Profile'])
  const header = buildHeaderProps(state, { onNavigate: () => undefined, onSettings: () => undefined, onReview: () => undefined })
  assert.equal(header.brandHref, '../')
  assert.equal(header.primaryAction, undefined)
  assert.equal(header.secondaryAction, undefined)
  assert.equal(buildStartScreenProps(state, {
    onContinue: () => undefined,
    onGuidedStart: () => undefined,
    onManualStart: () => undefined,
    onResumeDraft: () => undefined,
  }).continuePath, undefined)
  assert.match(describeSavedState(state), /No local data/)

  const seeded = await seedPlannerWithWorkout(repository)
  state = appReducer(state, {
    type: 'bootstrapped',
    athlete: seeded.athlete,
    planner: seeded.planner,
    savedWeek: seeded.weekPlan,
    logs: [],
  })

  const readyNav = buildNavItems(state, { onNavigate: () => undefined })
  assert.equal(readyNav.find(item => item.id === 'nav-planner')?.disabled, false)
  assert.equal(readyNav.find(item => item.id === 'nav-review')?.disabled, false)
  const startProps = buildStartScreenProps(state, {
    onContinue: () => undefined,
    onGuidedStart: () => undefined,
    onManualStart: () => undefined,
    onResumeDraft: () => undefined,
  })
  assert.ok(startProps.continuePath)
  assert.match(startProps.savedStateSummary ?? '', /^1 workout planned/)
  assert.equal(startProps.continuePath.action.label, 'Open my week')
  assert.match(describeSavedState(state), /1 planned workout/)
  assert.match(describeSavedState(state), /saved locally/)

  const unsaved = appReducer(state, { type: 'setPlanner', planner: seeded.planner, unsaved: true })
  assert.match(describeSavedState(unsaved), /not saved yet/)
})

test('default manual profiles are valid domain athlete profiles', () => {
  const profile = createDefaultAthleteProfile(TODAY)
  assert.doesNotThrow(() => parseAthleteProfile(profile))
  assert.equal(profile.createdOn, TODAY)
  assert.ok(profile.sports.length > 0)
})

test('planner weeks convert back into valid domain week plans', async () => {
  const repository = createFakeRepository()
  const seeded = await seedPlannerWithWorkout(repository)
  const weekPlan = plannerStateToWeekPlan(seeded.planner)
  assert.doesNotThrow(() => parseWeekPlan(weekPlan))
  assert.equal(weekPlan.workouts[0]?.scheduledDate, WEEK_START)
})

test('title-only editor changes retain all original step metadata and removal/new steps stay independent', async () => {
  const seeded = await seedPlannerWithWorkout(createFakeRepository())
  const original = seeded.weekPlan.workouts[0]!
  const step = {
    id: 'loaded-step', title: 'Split squat', detail: 'Original instructions\nDuration: as needed',
    equipment: ['Dumbbells'], estimatedTotalMin: 12,
    target: { sets: 3, reps: 8, loadKg: 20, effort: 'steady' as const, minutes: 2, loadBasis: 'per_implement' as const, repBasis: 'per_side' as const },
  }
  const workout = parseWeekPlan({ ...seeded.weekPlan, workouts: [{ ...original, main: [step], warmup: [{ ...step, id: 'warm-step' }], cooldown: [{ ...step, id: 'cool-step' }] }] }).workouts[0]!
  const editor = workoutToEditorState(workout)
  const result = buildWorkoutDefinition({ ...editor, draft: { ...editor.draft, workoutTitle: 'New title only' } }, { existing: workout })
  assert.ok(result.ok)
  assert.deepEqual(result.definition.main, workout.main)
  assert.deepEqual(result.definition.warmup, workout.warmup)
  assert.deepEqual(result.definition.cooldown, workout.cooldown)

  const changed = buildWorkoutDefinition({
    ...editor,
    sections: editor.sections.map(section => section.id === 'warmup' ? { ...section, steps: [] }
      : section.id === 'main' ? { ...section, steps: [section.steps[0]!, { ...section.steps[0]!, id: 'new-step', title: 'New exercise', duration: '5 min' }] }
        : section),
  }, { existing: workout })
  assert.ok(changed.ok)
  assert.deepEqual(changed.definition.warmup, [])
  assert.deepEqual(changed.definition.main[0], workout.main[0])
  assert.deepEqual(changed.definition.main[1]!.target, { minutes: 5, loadBasis: 'per_implement', repBasis: 'per_side' })
  assert.equal(changed.definition.main[1]!.equipment, undefined)
  assert.equal(changed.definition.main[1]!.estimatedTotalMin, 12)
})

test('bootstrap after restore/reset clears all previous athlete transient state', async () => {
  const repository = createFakeRepository()
  const seeded = await seedPlannerWithWorkout(repository)
  const backup = await exportRepositoryBackup(repository)
  let state: AppState = {
    ...createInitialAppState(), phase: 'ready', route: 'log',
    athlete: seeded.athlete, planner: seeded.planner, savedWeek: seeded.weekPlan,
    review: createWorkoutReviewState({ weekPlan: seeded.weekPlan }),
    onboarding: completedOnboardingState(), activeLogWorkoutId: seeded.weekPlan.workouts[0]!.id,
    editor: { mode: 'edit', existing: seeded.weekPlan.workouts[0]!, state: workoutToEditorState(seeded.weekPlan.workouts[0]!), messages: [] },
    movePickerLocalId: seeded.planner.present.week.workouts[0]!.localId,
    handoff: { kind: 'continuation', promptText: 'Private previous athlete feedback', jsonText: 'Private plan', preview: null, messages: [] },
    settings: { ...createInitialAppState().settings, backup, profileDraft: createAthleteProfileEditingDraft(seeded.athlete), restoreJson: backup.backupJson, restorePreview: previewRestoreBackupJson(backup.backupJson), restoreConfirmation: 'RESTORE BACKUP' },
  }
  state = appReducer(state, { type: 'bootstrapped', logs: [] })
  assert.equal(state.route, 'start')
  for (const field of ['athlete', 'planner', 'savedWeek', 'review', 'editor', 'onboarding', 'activeLogWorkoutId', 'movePickerLocalId'] as const) assert.equal(state[field], undefined)
  assert.deepEqual(state.settings, createInitialAppState().settings)
  assert.deepEqual(state.handoff, createInitialAppState().handoff)
})

test('successful writes invalidate cached backups and changed restore input invalidates approval', async () => {
  const repository = createFakeRepository()
  const seeded = await seedPlannerWithWorkout(repository)
  const backup = await exportRepositoryBackup(repository)
  const initial = appReducer(createInitialAppState(), {
    type: 'bootstrapped', athlete: seeded.athlete, planner: seeded.planner, savedWeek: seeded.weekPlan, logs: [],
  })
  const cached = appReducer(initial, { type: 'settings', patch: {
    backup, restoreJson: backup.backupJson,
  } })
  const approved = appReducer(cached, { type: 'settings', patch: {
    restorePreview: previewRestoreBackupJson(backup.backupJson), restoreConfirmation: 'RESTORE BACKUP',
  } })
  const changed = appReducer(approved, { type: 'settings', patch: { restoreJson: `${backup.backupJson} ` } })
  assert.equal(changed.settings.restorePreview, null)
  assert.equal(changed.settings.restoreConfirmation, '')
  const actions: AppAction[] = [
    { type: 'storageChanged' },
    { type: 'weekPersisted', weekPlan: seeded.weekPlan },
    { type: 'setAthlete', athlete: seeded.athlete },
    { type: 'weekImported', planner: seeded.planner, weekPlan: seeded.weekPlan, logs: [] },
  ]
  for (const action of actions) {
    const next = appReducer(cached, action)
    assert.equal(next.settings.backup, undefined, action.type)
    assert.ok(next.storageRevision > cached.storageRevision, action.type)
  }
})

test('weekly review saves atomically and unrelated inline saves retain unsaved reflection', async () => {
  const repository = createFakeRepository()
  const seeded = await seedPlannerWithWorkout(repository)
  const workout = seeded.weekPlan.workouts[0]!
  let review = createWorkoutReviewState({ weekPlan: seeded.weekPlan })
  review = reduceWorkoutReviewState(review, { type: 'setWeeklyReviewField', field: 'reflection', value: 'Persisted reflection' })
  review = reduceWorkoutReviewState(review, { type: 'setWeeklyReviewField', field: 'energy', value: '4' })
  const saved = await saveReviewWeek(repository, review)
  const loadedWeek = (await repository.getWeekPlan(seeded.weekPlan.id))!
  assert.equal(loadedWeek.review?.reflection, 'Persisted reflection')
  assert.equal(loadedWeek.review?.energy, 4)
  review = createWorkoutReviewState({ weekPlan: loadedWeek, workoutLogs: saved.logs })
  review = reduceWorkoutReviewState(review, { type: 'setWeeklyReviewField', field: 'reflection', value: 'Unsaved next draft' })
  review = reduceInlineWorkoutReviewState(review, { type: 'setWorkoutNotes', workoutId: workout.id, value: 'Exercise feedback' })
  const savedLog = await saveReviewWorkoutLog(repository, review, workout.id)
  const state = appReducer({ ...createInitialAppState(), review }, { type: 'reviewLogsSaved', submitted: review, logs: savedLog.logs, savedWorkoutIds: [workout.id] })
  assert.equal(state.review?.weeklyReview.draft.reflection, 'Unsaved next draft')
  assert.equal((await repository.getWeekPlan(seeded.weekPlan.id))!.review?.reflection, 'Persisted reflection')
  await assert.rejects(saveReviewWeek({ ...repository, async importWeek() { throw new Error('Atomic save failed') } }, state.review!), /Atomic save failed/)
  assert.equal((await repository.getWeekPlan(seeded.weekPlan.id))!.review?.reflection, 'Persisted reflection')
})

test('confirmed deletion removes recorded cards and their logs without an optimistic failing state', async () => {
  const repository = createFakeRepository()
  const seeded = await seedPlannerWithWorkout(repository)
  const first = seeded.weekPlan.workouts[0]!
  const weekPlan = parseWeekPlan({ ...seeded.weekPlan, review: { reflection: 'Keep this weekly reflection', metrics: [] }, workouts: [first, { ...first, id: 'second-card' }] })
  await repository.saveWeekPlan(weekPlan)
  const planner = createPlannerStateFromWeekPlan(weekPlan)
  let review = createWorkoutReviewState({ weekPlan })
  for (const workout of weekPlan.workouts) review = reduceInlineWorkoutReviewState(review, { type: 'setWorkoutNotes', workoutId: workout.id, value: `Recorded ${workout.id}` })
  await savePendingReviewWorkoutLogs(repository, review)
  const localId = planner.present.week.workouts[0]!.localId
  await assert.rejects(deleteRecordedPlannerWorkout({
    ...repository, async importWeek() { throw new Error('Delete failed') },
  }, planner, localId), /Delete failed/)
  assert.equal(planner.present.week.workouts.length, 2)
  assert.equal((await repository.listWorkoutLogs()).length, 2)
  const deleted = await deleteRecordedPlannerWorkout(repository, planner, localId)
  assert.equal(deleted.weekPlan?.workouts.length, 1)
  assert.deepEqual(deleted.logs.map(log => log.workoutId), ['second-card'])
  const last = await deleteRecordedPlannerWorkout(repository, deleted.planner, deleted.planner.present.week.workouts[0]!.localId)
  assert.equal(last.weekPlan.workouts.length, 0)
  assert.equal(last.weekPlan.review?.reflection, 'Keep this weekly reflection')
  assert.equal(last.planner.present.week.workouts.length, 0)
  assert.equal((await repository.listWorkoutLogs()).length, 0)
  assert.equal((await repository.getWeekPlan(weekPlan.id))!.workouts.length, 0)
})

test('refreshing a continuation brief preserves kind/date and includes the latest review', async () => {
  const seeded = await seedPlannerWithWorkout(createFakeRepository())
  let review = createWorkoutReviewState({ weekPlan: seeded.weekPlan })
  review = reduceWorkoutReviewState(review, { type: 'setWeeklyReviewField', field: 'reflection', value: 'Latest recovery feedback' })
  const targetWeekStart = '2026-09-14' as LocalDateString
  const result = refreshHandoffPrompt(seeded.athlete, {
    ...createInitialAppState().handoff, kind: 'continuation', targetWeekStart, promptText: 'Earlier brief',
  }, WEEK_START, review)
  assert.equal(result.kind, 'continuation')
  assert.equal(result.targetWeekStart, targetWeekStart)
  assert.match(result.promptText, /Latest recovery feedback/)
  assert.match(result.promptText, /2026-09-14/)
})

test('import approval updates the stored and active matching athlete profile', async () => {
  const repository = createFakeRepository()
  const seeded = await seedPlannerWithWorkout(repository)
  const athleteProfile = parseAthleteProfile({ ...seeded.athlete, planningContext: { asOf: TODAY, event: 'Race in November' } })
  const result = await applyWeekImport(repository, { weekPlan: seeded.weekPlan, workoutLogs: [], athleteProfile })
  const state = appReducer({ ...createInitialAppState(), athlete: seeded.athlete }, {
    type: 'weekImported', ...result, planner: seeded.planner,
  })
  assert.deepEqual(state.athlete, athleteProfile)
  assert.deepEqual(await repository.getAthleteProfile(athleteProfile.id), athleteProfile)
})

test('saving profile fields invalidates the brief and v2 preview and refuses its stale bundle at apply', async () => {
  const repository = createFakeRepository()
  const seeded = await seedPlannerWithWorkout(repository)
  const prompt = buildInitialWeekPrompt(buildInitialPromptInputFromAthleteProfile(seeded.athlete, WEEK_START))
  const json = JSON.stringify({ ...JSON.parse(prompt.exampleJson), athleteContext: { asOf: TODAY, benchmarks: ['A recorded baseline'] } })
  const options = { athlete: seeded.athlete, targetWeekStart: WEEK_START, expectedWeekType: 'initial' as const, weekPlanId: 'previewed-week' }
  const preview = previewAiWeekHandoff(json, options)
  assert.ok(preview.ok)
  assert.ok(preview.bundle.athleteProfile)
  let state = appReducer(createInitialAppState(), { type: 'bootstrapped', ...seeded, savedWeek: seeded.weekPlan, logs: [] })
  state = appReducer(state, { type: 'setHandoffJson', value: json })
  state = appReducer(state, { type: 'setHandoffPreview', preview })
  state = { ...state, handoff: { ...state.handoff, promptText: 'Earlier profile brief' } }
  const savedProfile = await repository.saveAthleteProfile({
    ...seeded.athlete, goal: 'My newly saved goal',
    equipmentDetails: [{ id: 'new-dumbbells', label: 'New dumbbells', constraints: [] }],
  })
  state = appReducer(state, { type: 'setAthlete', athlete: savedProfile })
  assert.equal(state.handoff.preview, null)
  assert.equal(state.handoff.promptText, '')
  assert.equal(state.handoff.jsonText, json)
  await assert.rejects(applyWeekImport(repository, preview.bundle), /profile changed after preview/)
  assert.equal(await repository.getWeekPlan('previewed-week'), undefined)
  assert.deepEqual(await repository.getAthleteProfile(savedProfile.id), savedProfile)

  const refreshed = previewAiWeekHandoff(json, { ...options, athlete: savedProfile })
  assert.ok(refreshed.ok)
  const applied = await applyWeekImport(repository, refreshed.bundle, savedProfile)
  assert.equal(applied.athleteProfile?.goal, savedProfile.goal)
  assert.deepEqual(applied.athleteProfile?.equipmentDetails, savedProfile.equipmentDetails)
  assert.deepEqual(applied.athleteProfile?.planningContext?.benchmarks, ['A recorded baseline'])
})

test('apply boundary rejects a changed profile baseline and forwards the baseline transactionally', async () => {
  const repository = createFakeRepository()
  const seeded = await seedPlannerWithWorkout(repository)
  const updated = await repository.saveAthleteProfile({
    ...seeded.athlete, planningContext: { asOf: TODAY, benchmarks: ['Edited since preview'] },
  })
  const bundle = { weekPlan: seeded.weekPlan, workoutLogs: [], athleteProfile: {
    ...seeded.athlete, planningContext: { asOf: TODAY, benchmarks: ['Old AI proposal'] },
  } }
  await assert.rejects(applyWeekImport(repository, bundle, seeded.athlete), /profile changed after preview/)
  assert.deepEqual(await repository.getAthleteProfile(updated.id), updated)
  let checked = false
  await applyWeekImport({
    ...repository,
    async importWeek(imported, options) {
      assert.deepEqual(options?.expectedAthleteProfile, updated)
      checked = true
      return repository.importWeek(imported, options)
    },
  }, bundle, updated)
  assert.equal(checked, true)
})

test('saved review provenance keeps automatic counts live through log persistence and card deletion', async () => {
  const repository = createFakeRepository()
  const seeded = await seedPlannerWithWorkout(repository)
  const first = seeded.weekPlan.workouts[0]!
  const weekPlan = parseWeekPlan({ ...seeded.weekPlan, workouts: [first, { ...first, id: 'second-card' }] })
  await repository.saveWeekPlan(weekPlan)
  let review = createWorkoutReviewState({ weekPlan })
  review = reduceWorkoutReviewState(review, { type: 'setWeeklyMetricField', metricId: 'total-workouts', field: 'planned', value: '5' })
  const savedReview = await saveReviewWeek(repository, review)
  review = createWorkoutReviewState({ weekPlan: savedReview.weekPlan })
  for (const workout of weekPlan.workouts) {
    review = reduceInlineWorkoutReviewState(review, { type: 'setWorkoutNotes', workoutId: workout.id, value: 'Recorded workout' })
  }
  const savedLogs = await savePendingReviewWorkoutLogs(repository, review)
  const planner = createPlannerStateFromWeekPlan(savedReview.weekPlan)
  let state = appReducer(createInitialAppState(), {
    type: 'bootstrapped', athlete: seeded.athlete, planner, savedWeek: savedReview.weekPlan, logs: savedLogs.logs,
  })
  state = appReducer(state, { type: 'setReview', review: createWorkoutReviewState({ weekPlan: savedReview.weekPlan, workoutLogs: savedLogs.logs }) })
  assert.equal(state.review?.weeklyReview.metrics.find(metric => metric.id === 'total-workouts')?.completed, '2')
  const deleted = await deleteRecordedPlannerWorkout(repository, planner, planner.present.week.workouts[0]!.localId)
  state = appReducer(state, { type: 'workoutDeleted', ...deleted })
  assert.equal(state.review?.weeklyReview.metrics.find(metric => metric.id === 'total-workouts')?.planned, '5')
  assert.equal(state.review?.weeklyReview.metrics.find(metric => metric.id === 'total-workouts')?.completed, '1')
  assert.equal(state.review?.weeklyReview.metrics.find(metric => metric.id === 'partial-workouts')?.completed, '1')
  const reloaded = createWorkoutReviewState({
    weekPlan: (await repository.getWeekPlan(weekPlan.id))!,
    workoutLogs: await repository.listWorkoutLogs({ weekPlanId: weekPlan.id }),
  })
  assert.equal(reloaded.weeklyReview.metrics.find(metric => metric.id === 'total-workouts')?.planned, '5')
  assert.equal(reloaded.weeklyReview.metrics.find(metric => metric.id === 'total-workouts')?.completed, '1')
})
