/// <reference types="node" />

import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import {
  AI_COPY_PASTE_FORMAT,
  AI_COPY_PASTE_VERSION,
  buildContinuationWeekPrompt,
  type FixedClubSession as AiFixedClubSession,
  buildInitialWeekPrompt,
  buildTargetWeek,
  type AiWeekCopyPasteContract,
} from '../src/ai/index.ts'
import {
  createBackupEnvelope,
  parseWeekImportBundle,
  type AthleteProfile,
  type WeekPlan,
} from '../src/domain/contracts.ts'
import { parseLocalDate } from '../src/domain/local-date.ts'
import {
  buildContinuationPromptInputFromAthleteProfile,
  buildExpectedFixedClubSessions,
  buildInitialPromptInputFromAthleteProfile,
  buildContinuationWeekContext,
  convertAiWeekContractToWeekImportBundle,
  previewAiWeekHandoff,
  type TrackedWorkoutChange,
} from '../src/app/state/ai-handoff.ts'
import {
  createAthleteProfileFromGuidedOnboardingState,
  createFixedClubWorkoutsForTargetWeek,
  createGuidedOnboardingScreenProps,
  createGuidedOnboardingState,
  createResumableOnboardingDraft,
  reduceGuidedOnboardingState,
  restoreGuidedOnboardingStateFromDraft,
  validateGuidedOnboardingState,
  type GuidedOnboardingAction,
  type GuidedOnboardingState,
} from '../src/app/state/onboarding.ts'
import {
  addPlannerWorkout,
  createBlankPlannerState,
  createPlannerStateFromWeekPlan,
  deletePlannerWorkout,
  duplicatePlannerWorkout,
  listPlannerWorkoutsForDate,
  mapPlannerStateToWeekBoardProps,
  movePlannerWorkout,
  plannerStateToWeekPlan,
  PlannerValidationError,
} from '../src/app/state/planner.ts'
import {
  buildWorkoutReviewPayload,
  createWeeklyReviewScreenProps,
  createWorkoutReviewState,
  reduceWorkoutReviewState,
  startWorkoutReviewLog,
  setWorkoutReviewEffortRating,
  setWorkoutReviewMetrics,
  setWorkoutReviewNotes,
  setWorkoutReviewStepActualValues,
  setWorkoutReviewStepEffortRating,
  setWorkoutReviewStepNotes,
  setWorkoutReviewStepStatus,
} from '../src/app/state/review.ts'
import {
  applyPreviewedBackupRestore,
  buildBackupPreview,
  canApplyPreviewedBackupRestore,
  exportRepositoryBackup,
  previewRestoreBackupJson,
} from '../src/app/state/settings.ts'
import { createHybridCoachRepository } from '../src/storage/indexeddb-repository.ts'

function apply(state: GuidedOnboardingState, ...actions: GuidedOnboardingAction[]) {
  return actions.reduce((current, action) => reduceGuidedOnboardingState(current, action), state)
}

function requireDefined<T>(value: T | null | undefined, message: string): T {
  assert.ok(value !== undefined && value !== null, message)
  return value
}

function requireResultValue<T>(result: { ok: boolean; value?: T }, message: string): T {
  assert.equal(result.ok, true)
  return requireDefined(result.value, message)
}

function assertPlannerError(execute: () => unknown, code: PlannerValidationError['code'], message: RegExp) {
  let thrown: unknown
  try {
    execute()
  } catch (error) {
    thrown = error
  }

  assert.ok(thrown instanceof PlannerValidationError)
  assert.equal(thrown.code, code)
  assert.match(thrown.message, message)
}

function buildFixedClubFixtureSessions(profile: AthleteProfile, targetWeekStart: ReturnType<typeof parseLocalDate>) {
  return buildExpectedFixedClubSessions(profile, targetWeekStart).map(session => ({
    ...session,
    sessionId: requireDefined(session.sessionId, `Expected sessionId for fixed club session "${session.label}".`),
  })) satisfies readonly (AiFixedClubSession & { sessionId: string })[]
}

function buildCompletedOnboardingState() {
  let state = createGuidedOnboardingState({
    athleteId: 'athlete-avery',
    draftId: 'draft-avery',
    athleteName: 'Avery Cross',
    createdOn: '2026-09-10',
    startingWeek: '2026-09-14',
  })

  state = apply(
    state,
    { type: 'setGoalSummary', value: 'Build a flexible run-lift week around Tuesday track and Thursday recovery work.' },
    { type: 'setTargetDate', value: '2026-11-01' },
    { type: 'setGoalNotes', value: 'Keep one quality run anchor, one lighter ride option, and simple strength support.' },
  )
  assert.equal(createGuidedOnboardingScreenProps(state, () => undefined).canGoNext, true)

  state = reduceGuidedOnboardingState(state, { type: 'next' })
  state = apply(
    state,
    { type: 'setCategoryCount', category: 'aerobic', value: '3' },
    { type: 'setCategoryCount', category: 'strength', value: '2' },
    { type: 'setCategoryCount', category: 'mobility', value: '2' },
    { type: 'toggleCategoryDay', category: 'aerobic', day: 'tuesday' },
    { type: 'toggleCategoryDay', category: 'aerobic', day: 'saturday' },
    { type: 'toggleCategoryDay', category: 'strength', day: 'wednesday' },
    { type: 'toggleCategoryDay', category: 'strength', day: 'sunday' },
    { type: 'toggleCategoryDay', category: 'mobility', day: 'thursday' },
    { type: 'toggleCategoryDay', category: 'mobility', day: 'sunday' },
  )
  assert.equal(createGuidedOnboardingScreenProps(state, () => undefined).canGoNext, true)

  state = apply(
    state,
    { type: 'setAerobicExercises', value: 'running, cycling' },
  )

  state = reduceGuidedOnboardingState(state, { type: 'selectStep', stepId: 'equipment' })
  state = apply(
    state,
    { type: 'setEquipmentMode', id: 'home' },
    { type: 'setEquipmentDetails', value: 'Adjustable dumbbells\nKettlebells\nDoor pull-up bar\nClub gym access on Fridays' },
  )

  state = reduceGuidedOnboardingState(state, { type: 'selectStep', stepId: 'schedule' })
  state = reduceGuidedOnboardingState(state, { type: 'addClubSession' })
  const trackId = requireDefined(state.clubSessions[0], 'Expected first club session draft after adding it.').id
  state = reduceGuidedOnboardingState(state, { type: 'addClubSession' })
  const yogaId = requireDefined(state.clubSessions[1], 'Expected second club session draft after adding it.').id
  state = apply(
    state,
    { type: 'setClubSessionField', sessionId: trackId, field: 'category', value: 'aerobic' },
    { type: 'setClubSessionField', sessionId: trackId, field: 'activity', value: 'Track Club' },
    { type: 'setClubSessionField', sessionId: trackId, field: 'scope', value: 'Primary weekly anchor' },
    { type: 'setClubSessionField', sessionId: trackId, field: 'location', value: 'Riverside track' },
    { type: 'setClubSessionField', sessionId: trackId, field: 'day', value: 'tuesday' },
    { type: 'setClubSessionField', sessionId: trackId, field: 'startTime', value: '19:00' },
    { type: 'setClubSessionField', sessionId: trackId, field: 'durationMinutes', value: '75' },
    { type: 'setClubSessionField', sessionId: trackId, field: 'notes', value: 'Hard intervals most weeks.' },
    { type: 'setClubSessionField', sessionId: yogaId, field: 'category', value: 'mobility' },
    { type: 'setClubSessionField', sessionId: yogaId, field: 'activity', value: 'Yoga for Runners' },
    { type: 'setClubSessionField', sessionId: yogaId, field: 'scope', value: 'Recovery anchor' },
    { type: 'setClubSessionField', sessionId: yogaId, field: 'location', value: 'Community studio' },
    { type: 'setClubSessionField', sessionId: yogaId, field: 'day', value: 'thursday' },
    { type: 'setClubSessionField', sessionId: yogaId, field: 'startTime', value: '18:15' },
    { type: 'setClubSessionField', sessionId: yogaId, field: 'durationMinutes', value: '50' },
    { type: 'setClubSessionField', sessionId: yogaId, field: 'notes', value: 'Stay easy and restore range.' },
  )
  assert.equal(createGuidedOnboardingScreenProps(state, () => undefined).canGoNext, true)

  state = reduceGuidedOnboardingState(state, { type: 'selectStep', stepId: 'review' })
  state = apply(
    state,
    { type: 'setReviewNotes', value: 'Travel Friday night, so keep the weekend flexible and recover well after the club anchors.' },
  )

  const validation = validateGuidedOnboardingState(state)
  assert.equal(state.currentStep, 'review')
  assert.equal(validation.issues.length, 0)
  assert.equal(createGuidedOnboardingScreenProps(state, () => undefined).canFinish, true)
  return state
}

function buildRepresentativeAiWeek(profile: AthleteProfile, targetWeekStart: ReturnType<typeof parseLocalDate>): AiWeekCopyPasteContract {
  const fixedClubSessions = buildFixedClubFixtureSessions(profile, targetWeekStart)
  const targetWeek = buildTargetWeek(targetWeekStart)
  return {
    format: AI_COPY_PASTE_FORMAT,
    version: AI_COPY_PASTE_VERSION,
    weekType: 'initial',
    targetWeek,
    summary: 'Blend the fixed club anchors with flexible cycling, strength, and mobility support.',
    workouts: [
      ...fixedClubSessions.map(session => ({
        id: `fixed-${session.sessionId}`,
        date: session.date,
        startTime: session.startTime,
        category: session.category ?? 'aerobic',
        ...(session.modality === undefined ? {} : { modality: session.modality }),
        title: session.label,
        purpose: session.category === 'mobility'
          ? 'Keep the fixed recovery session exactly where it belongs in the week.'
          : 'Keep the key club anchor exactly as scheduled.',
        expectedDuration: session.durationMin,
        warmup: [],
        main: [{
          id: `fixed-${session.sessionId}-main`,
          instruction: `Attend ${session.label} as scheduled.`,
          durationMin: session.durationMin,
          ...(session.modality === undefined ? {} : { modality: session.modality }),
        }],
        cooldown: [],
        source: {
          kind: 'fixed_club' as const,
          fixedClub: {
            sessionId: session.sessionId,
            label: session.label,
            date: session.date,
            startTime: session.startTime,
            durationMin: session.durationMin,
            ...(session.category === undefined ? {} : { category: session.category }),
            ...(session.modality === undefined ? {} : { modality: session.modality }),
          },
        },
      })),
      {
        id: 'aerobic-1',
        date: requireDefined(targetWeek.dates[0], 'Expected first target-week date.'),
        startTime: '07:00',
        category: 'aerobic',
        modality: 'cycling',
        title: 'Flexible aerobic ride',
        purpose: 'Build easy aerobic volume before Tuesday track without extra impact.',
        expectedDuration: 55,
        warmup: [{
          id: 'aerobic-1-warmup',
          instruction: 'Spin easily and let cadence rise gradually.',
          durationMin: 10,
          modality: 'cycling',
        }],
        main: [{
          id: 'aerobic-1-main',
          instruction: 'Ride steadily on flat roads while breathing stays fully conversational.',
          durationMin: 40,
          effort: 'easy',
          modality: 'cycling',
          notes: 'Keep power capped and save the legs for track.',
        }],
        cooldown: [{
          id: 'aerobic-1-cooldown',
          instruction: 'Soft-pedal home and shake out the hips.',
          durationMin: 5,
          modality: 'cycling',
        }],
        source: { kind: 'ai' },
        notes: 'Choose the trainer if the morning weather is rough.',
      },
      {
        id: 'strength-1',
        date: requireDefined(targetWeek.dates[2], 'Expected third target-week date.'),
        startTime: '07:15',
        category: 'strength',
        title: 'Lower body + trunk strength',
        purpose: 'Keep strength progressing without turning Wednesday into another hard endurance day.',
        expectedDuration: 50,
        warmup: [{
          id: 'strength-1-warmup',
          instruction: 'Open the hips, wake up the trunk, and take two light ramp-up sets.',
          durationMin: 10,
        }],
        main: [{
          id: 'strength-1-main',
          instruction: 'Cycle through goblet squat, single-leg hinge, and loaded carry work.',
          sets: 4,
          reps: 5,
          loadKg: 28,
          effort: 'steady',
          notes: 'Keep one rep in reserve on every set.',
        }],
        cooldown: [{
          id: 'strength-1-cooldown',
          instruction: 'Downshift with easy breathing and calf mobility.',
          durationMin: 5,
        }],
        source: { kind: 'ai' },
      },
      {
        id: 'mobility-1',
        date: requireDefined(targetWeek.dates[5], 'Expected sixth target-week date.'),
        startTime: '20:15',
        category: 'mobility',
        title: 'Mobility downshift',
        purpose: 'Restore hips, calves, and upper back after the bigger training days.',
        expectedDuration: 25,
        warmup: [{
          id: 'mobility-1-warmup',
          instruction: 'Start with controlled breathing and easy cat-camel movement.',
          durationMin: 5,
        }],
        main: [{
          id: 'mobility-1-main',
          instruction: 'Move through hip, ankle, and thoracic mobility flows without rushing.',
          durationMin: 15,
          notes: 'Stay below stretch pain and keep the exhale long.',
        }],
        cooldown: [{
          id: 'mobility-1-cooldown',
          instruction: 'Finish with relaxed floor breathing.',
          durationMin: 5,
        }],
        source: { kind: 'ai' },
      },
    ],
  }
}

function buildTrackedPlannerChanges(previous: WeekPlan, next: WeekPlan): TrackedWorkoutChange[] {
  const previousById = new Map(previous.workouts.map(workout => [workout.id, workout]))
  const nextById = new Map(next.workouts.map(workout => [workout.id, workout]))
  const changes: TrackedWorkoutChange[] = []

  for (const workout of previous.workouts) {
    const current = nextById.get(workout.id)
    if (!current) {
      changes.push({
        workoutId: workout.id,
        type: 'deleted',
        fromDate: workout.scheduledDate,
        note: `${workout.title} was removed during planner editing.`,
        workoutSnapshot: workout,
      })
      continue
    }
    if (current.scheduledDate !== workout.scheduledDate) {
      changes.push({
        workoutId: workout.id,
        type: 'moved',
        fromDate: workout.scheduledDate,
        toDate: current.scheduledDate,
        note: `${workout.title} moved to fit the week better.`,
      })
    }
  }

  for (const workout of next.workouts) {
    if (previousById.has(workout.id)) continue
    changes.push({
      workoutId: workout.id,
      type: 'added',
      toDate: workout.scheduledDate,
      note: `${workout.title} was added in the planner.`,
    })
  }

  return changes.sort((left, right) =>
    (left.fromDate ?? '').localeCompare(right.fromDate ?? '')
    || (left.toDate ?? '').localeCompare(right.toDate ?? '')
    || left.type.localeCompare(right.type)
    || left.workoutId.localeCompare(right.workoutId))
}

function workoutByTitle(weekPlan: WeekPlan, title: string) {
  const workout = weekPlan.workouts.find(entry => entry.title === title)
  assert.ok(workout, `Missing workout "${title}"`)
  return workout
}

class FakeRequest<T> {
  result!: T
  error: Error | null = null
  onsuccess: (() => void) | null = null
  onerror: (() => void) | null = null
  onupgradeneeded: (() => void) | null = null
  onblocked: (() => void) | null = null
  transaction: FakeTransaction | null = null
}

class FakeObjectStoreNames {
  readonly names: Set<string>

  constructor(names: Set<string>) {
    this.names = names
  }

  contains(name: string) { return this.names.has(name) }
}

class FakeDatabaseHandle {
  onversionchange: (() => void) | null = null
  readonly database: FakeIndexedDb
  readonly request: FakeRequest<FakeDatabaseHandle>

  constructor(database: FakeIndexedDb, request: FakeRequest<FakeDatabaseHandle>) {
    this.database = database
    this.request = request
  }

  get objectStoreNames() {
    return new FakeObjectStoreNames(new Set(this.database.storeDefinitions.keys()))
  }

  createObjectStore(name: string, options: { keyPath: string }) {
    this.database.storeDefinitions.set(name, { keyPath: options.keyPath })
    if (!this.database.stores.has(name)) this.database.stores.set(name, new Map())
    return requireDefined(this.request.transaction, `Expected upgrade transaction for store ${name}.`).objectStore(name)
  }

  transaction(names: string | string[], _mode: IDBTransactionMode) {
    const transaction = new FakeTransaction(this.database, Array.isArray(names) ? names : [names])
    this.database.transactions.push(transaction)
    return transaction
  }

  close() {}
}

class FakeObjectStore {
  readonly database: FakeIndexedDb
  readonly transaction: FakeTransaction
  readonly name: string

  constructor(database: FakeIndexedDb, transaction: FakeTransaction, name: string) {
    this.database = database
    this.transaction = transaction
    this.name = name
  }

  private schedule<T>(value: T): FakeRequest<T> {
    const request = new FakeRequest<T>()
    queueMicrotask(() => {
      request.result = structuredClone(value)
      request.onsuccess?.()
    })
    return request
  }

  private storeData() {
    const store = this.database.stores.get(this.name)
    assert.ok(store, `Unknown store ${this.name}`)
    return store
  }

  private keyPath() {
    const definition = this.database.storeDefinitions.get(this.name)
    assert.ok(definition, `Missing store definition for ${this.name}`)
    return definition.keyPath
  }

  get(key: string) {
    return this.schedule(this.storeData().has(key) ? this.storeData().get(key) : undefined)
  }

  getAll() {
    return this.schedule([...this.storeData().values()])
  }

  put(value: Record<string, unknown>) {
    const key = value[this.keyPath()]
    assert.equal(typeof key, 'string')
    this.transaction.operations.push(() => { this.storeData().set(key as string, structuredClone(value)) })
    return this.schedule(undefined)
  }

  delete(key: string) {
    this.transaction.operations.push(() => { this.storeData().delete(key) })
    return this.schedule(undefined)
  }

  clear() {
    this.transaction.operations.push(() => { this.storeData().clear() })
    return this.schedule(undefined)
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null
  onabort: (() => void) | null = null
  error: Error | null = null
  operations: Array<() => void> = []
  readonly database: FakeIndexedDb
  readonly storeNames: string[]

  constructor(database: FakeIndexedDb, storeNames: string[]) {
    this.database = database
    this.storeNames = storeNames
  }

  objectStore(name: string) {
    if (this.storeNames.length) assert.ok(this.storeNames.includes(name), `Transaction missing store ${name}`)
    return new FakeObjectStore(this.database, this, name)
  }

  abort() {
    queueMicrotask(() => this.onabort?.())
  }

  complete() {
    for (const operation of this.operations) operation()
    this.oncomplete?.()
  }
}

class FakeIndexedDb {
  readonly stores = new Map<string, Map<string, unknown>>()
  readonly storeDefinitions = new Map<string, { keyPath: string }>()
  readonly transactions: FakeTransaction[] = []

  latestTransaction() {
    const transaction = this.transactions.at(-1)
    assert.ok(transaction)
    return transaction
  }

  open(_name: string, _version: number) {
    const request = new FakeRequest<FakeDatabaseHandle>()
    const upgrade = new FakeTransaction(this, [])
    request.transaction = upgrade
    request.result = new FakeDatabaseHandle(this, request)
    this.transactions.push(upgrade)
    queueMicrotask(() => {
      if (!this.storeDefinitions.size) request.onupgradeneeded?.()
      request.onsuccess?.()
    })
    return request
  }
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve))

function installFakeIndexedDb(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  const fake = new FakeIndexedDb()
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: { open: fake.open.bind(fake) },
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original)
    else Reflect.deleteProperty(globalThis, 'indexedDB')
  })
  return fake
}

async function commitRepositoryCall<T>(fake: FakeIndexedDb, work: Promise<T>) {
  await tick()
  fake.latestTransaction().complete()
  return await work
}

test('guided onboarding flows through AI import repository planning review and continuation prompt', async t => {
  const fake = installFakeIndexedDb(t)
  const repository = createHybridCoachRepository('planner-mvp-integration')
  const onboardingState = buildCompletedOnboardingState()

  const savedDraftResult = createResumableOnboardingDraft(onboardingState, { updatedOn: '2026-09-10' })
  const savedDraft = requireResultValue(savedDraftResult, 'Expected a resumable onboarding draft.')
  const onboardingDraft = await commitRepositoryCall(fake, repository.saveOnboardingDraft(savedDraft))
  const restoredDraft = await commitRepositoryCall(fake, repository.getOnboardingDraft(onboardingDraft.id))
  const restoredState = restoreGuidedOnboardingStateFromDraft(requireDefined(restoredDraft, 'Expected the onboarding draft to reload.'))
  assert.equal(createGuidedOnboardingScreenProps(restoredState, () => undefined).canFinish, true)

  const athleteResult = createAthleteProfileFromGuidedOnboardingState(restoredState, { updatedOn: '2026-09-10' })
  const finalizedAthlete = requireResultValue(athleteResult, 'Expected a finalized athlete profile.')
  const athlete = await commitRepositoryCall(fake, repository.saveAthleteProfile(finalizedAthlete))

  const targetWeekStart = parseLocalDate('2026-09-14')
  const nextWeekStart = parseLocalDate('2026-09-21')
  const fixedClubWorkouts = createFixedClubWorkoutsForTargetWeek(athlete, {
    athleteId: athlete.id,
    weekPlanId: `week-${targetWeekStart}-${athlete.id}`,
    weekStart: targetWeekStart,
  })
  assert.deepEqual(
    fixedClubWorkouts.map(workout => [workout.title, workout.scheduledDate, workout.category]),
    [
      ['Track Club', '2026-09-15', 'aerobic'],
      ['Yoga for Runners', '2026-09-17', 'mobility'],
    ],
  )

  const initialInput = buildInitialPromptInputFromAthleteProfile(athlete, targetWeekStart, {
    warmupRequirement: 'Keep every session reviewable with a structured warm-up.',
  })
  const initialPrompt = buildInitialWeekPrompt(initialInput)
  assert.equal(initialInput.fixedClubSessions.length, 2)
  assert.match(initialPrompt.messages[0].content, /Keep every session reviewable with a structured warm-up\./)
  assert.match(initialPrompt.messages[1].content, /"Track Club"/)
  assert.match(initialPrompt.messages[1].content, /"Yoga for Runners"/)

  const contract = buildRepresentativeAiWeek(athlete, targetWeekStart)
  const preview = previewAiWeekHandoff(JSON.stringify(contract), {
    athlete,
    targetWeekStart,
    expectedWeekType: 'initial',
  })
  assert.equal(preview.ok, true)
  if (!preview.ok) return
  const converted = convertAiWeekContractToWeekImportBundle(contract, {
    athlete,
    targetWeekStart,
    expectedWeekType: 'initial',
  })
  assert.deepEqual(preview.bundle, converted)
  assert.deepEqual(preview.preview.summary, [
    '5 workouts ready to import',
    '2 fixed club sessions validated',
    'AI summary preserved in week notes',
  ])
  assert.match(preview.bundle.weekPlan.notes ?? '', /Week type: initial/)

  await commitRepositoryCall(fake, repository.importWeek(preview.bundle))
  const importedWeek = requireDefined(
    await commitRepositoryCall(fake, repository.getLatestWeekPlan(athlete.id)),
    'Expected the imported week to be saved.',
  )

  let planner = createPlannerStateFromWeekPlan(importedWeek)
  const fixedTrackLocalId = requireDefined(
    planner.present.week.workouts.find(entry => entry.workout.title === 'Track Club'),
    'Expected Track Club in the imported planner state.',
  ).localId
  assertPlannerError(
    () => movePlannerWorkout(planner, { localId: fixedTrackLocalId, scheduledDate: '2026-09-16' }),
    'fixed-club-edit-required',
    /requires an explicit fixed club replacement/,
  )

  const movedRideLocalId = requireDefined(
    planner.present.week.workouts.find(entry => entry.workout.title === 'Flexible aerobic ride'),
    'Expected Flexible aerobic ride in the imported planner state.',
  ).localId
  planner = movePlannerWorkout(planner, {
    localId: movedRideLocalId,
    scheduledDate: '2026-09-18',
  })
  const strengthLocalId = requireDefined(
    planner.present.week.workouts.find(entry => entry.workout.title === 'Lower body + trunk strength'),
    'Expected Lower body + trunk strength in the imported planner state.',
  ).localId
  planner = duplicatePlannerWorkout(planner, {
    localId: strengthLocalId,
    changes: {
      scheduledDate: '2026-09-20',
      startTime: '09:00',
      title: 'Upper body support lift',
      purpose: 'Add a shorter second strength touch using the home setup.',
      expectedDurationMin: 35,
      main: [
        {
          title: 'Half-kneeling press',
          detail: 'Use a crisp tempo and stop with one rep in reserve.',
          target: { sets: 3, reps: 6, loadKg: 18, effort: 'steady' },
        },
        {
          title: 'Pull-up ladder',
          detail: 'Alternate grips if elbows are fresh.',
          target: { sets: 4, reps: 4, effort: 'steady' },
        },
      ],
      cooldown: [{
        title: 'Breathing reset',
        target: { minutes: 4 },
      }],
      notes: 'Short support session after the travel day.',
    },
  })
  planner = addPlannerWorkout(planner, {
    scheduledDate: '2026-09-19',
    startTime: '08:00',
    category: 'aerobic',
    source: 'manual',
    title: 'Trail shakeout run',
    purpose: 'Use a short flexible aerobic session if the legs feel good.',
    expectedDurationMin: 35,
    warmup: [{ title: 'Walk and jog', target: { minutes: 8 } }],
    main: [{ title: 'Relaxed trail run', detail: 'Keep the effort easy on rolling terrain.', target: { minutes: 22, effort: 'easy' } }],
    cooldown: [{ title: 'Walk home', target: { minutes: 5 } }],
    notes: 'Skip it if travel fatigue is high.',
  })
  const mobilityLocalId = requireDefined(
    planner.present.week.workouts.find(entry => entry.workout.title === 'Mobility downshift'),
    'Expected Mobility downshift in the imported planner state.',
  ).localId
  planner = deletePlannerWorkout(planner, mobilityLocalId)

  assert.deepEqual(
    listPlannerWorkoutsForDate(planner, '2026-09-19').map(entry => entry.workout.title),
    ['Trail shakeout run'],
  )
  const board = mapPlannerStateToWeekBoardProps(planner)
  assert.equal(board.days[4]?.summary, '1 session · 55 min')
  assert.deepEqual(board.days[6]?.cards?.map(card => card.title), ['Upper body support lift'])

  const editedWeek = plannerStateToWeekPlan(planner)
  const trackedChanges = buildTrackedPlannerChanges(importedWeek, editedWeek)
  assert.deepEqual(trackedChanges.map(change => change.type).sort(), ['added', 'added', 'deleted', 'moved'])
  await commitRepositoryCall(fake, repository.saveWeekPlan(editedWeek))

  let reviewState = createWorkoutReviewState({ weekPlan: editedWeek, trackedChanges })
  reviewState = startWorkoutReviewLog(reviewState, workoutByTitle(editedWeek, 'Flexible aerobic ride').id, 'partial')
  reviewState = setWorkoutReviewEffortRating(reviewState, workoutByTitle(editedWeek, 'Flexible aerobic ride').id, 6)
  reviewState = setWorkoutReviewMetrics(reviewState, workoutByTitle(editedWeek, 'Flexible aerobic ride').id, {
    durationMin: 42,
    distanceMeters: 22800,
    averageHeartRate: 138,
  })
  reviewState = setWorkoutReviewStepActualValues(reviewState, workoutByTitle(editedWeek, 'Flexible aerobic ride').id, 'aerobic-1-main', {
    minutes: 30,
    distanceMeters: 16400,
  })
  reviewState = setWorkoutReviewStepNotes(reviewState, workoutByTitle(editedWeek, 'Flexible aerobic ride').id, 'aerobic-1-main', 'Stopped the steady block early once cadence faded.')

  reviewState = startWorkoutReviewLog(reviewState, workoutByTitle(editedWeek, 'Track Club').id, 'completed')
  reviewState = setWorkoutReviewEffortRating(reviewState, workoutByTitle(editedWeek, 'Track Club').id, 8)
  reviewState = setWorkoutReviewMetrics(reviewState, workoutByTitle(editedWeek, 'Track Club').id, {
    durationMin: 74,
    distanceMeters: 10750,
    paceSecondsPerKm: 251,
    averageHeartRate: 164,
  })
  reviewState = setWorkoutReviewStepActualValues(reviewState, workoutByTitle(editedWeek, 'Track Club').id, 'fixed-club-session-1-main', {
    minutes: 75,
    paceSecondsPerKm: 251,
  })

  reviewState = startWorkoutReviewLog(reviewState, workoutByTitle(editedWeek, 'Lower body + trunk strength').id, 'completed')
  reviewState = setWorkoutReviewEffortRating(reviewState, workoutByTitle(editedWeek, 'Lower body + trunk strength').id, 7)
  reviewState = setWorkoutReviewMetrics(reviewState, workoutByTitle(editedWeek, 'Lower body + trunk strength').id, {
    durationMin: 49,
    averageHeartRate: 126,
  })
  reviewState = setWorkoutReviewStepStatus(reviewState, workoutByTitle(editedWeek, 'Lower body + trunk strength').id, 'strength-1-main', 'done')
  reviewState = setWorkoutReviewStepEffortRating(reviewState, workoutByTitle(editedWeek, 'Lower body + trunk strength').id, 'strength-1-main', 7)
  reviewState = setWorkoutReviewStepActualValues(reviewState, workoutByTitle(editedWeek, 'Lower body + trunk strength').id, 'strength-1-main', {
    sets: 4,
    reps: 5,
    loadKg: 28,
  })
  reviewState = setWorkoutReviewStepNotes(reviewState, workoutByTitle(editedWeek, 'Lower body + trunk strength').id, 'strength-1-main', 'Felt strong and kept the final set crisp.')

  reviewState = startWorkoutReviewLog(reviewState, workoutByTitle(editedWeek, 'Trail shakeout run').id, 'skipped')
  reviewState = setWorkoutReviewNotes(reviewState, workoutByTitle(editedWeek, 'Trail shakeout run').id, 'Skipped after the Friday travel delay and tight calves.')
  reviewState = reduceWorkoutReviewState(reviewState, {
    type: 'setWeeklyReviewField',
    field: 'reflection',
    value: 'The club anchors worked well, but the easy ride needed more recovery margin.',
  })
  reviewState = reduceWorkoutReviewState(reviewState, {
    type: 'setWeeklyReviewField',
    field: 'energy',
    value: '3',
  })
  reviewState = reduceWorkoutReviewState(reviewState, {
    type: 'setWeeklyReviewField',
    field: 'recovery',
    value: '4',
  })
  reviewState = reduceWorkoutReviewState(reviewState, {
    type: 'setWeeklyReviewField',
    field: 'wins',
    value: 'Kept both fixed sessions and both strength touches visible.',
  })
  reviewState = reduceWorkoutReviewState(reviewState, {
    type: 'setWeeklyReviewField',
    field: 'blockers',
    value: 'Travel compressed the weekend and cost the planned mobility block.',
  })
  reviewState = reduceWorkoutReviewState(reviewState, {
    type: 'setWeeklyReviewField',
    field: 'nextFocus',
    value: 'Keep the Tuesday quality anchor, restore a short mobility slot, and avoid crowding Friday.',
  })
  reviewState = reduceWorkoutReviewState(reviewState, {
    type: 'setWeeklyReviewField',
    field: 'coachNotes',
    value: 'Bias toward flexible weekend volume instead of stacking another hard session.',
  })

  const weeklyProps = createWeeklyReviewScreenProps(reviewState)
  const weeklySummaryMessage = requireDefined(weeklyProps.messages?.[0]?.text, 'Expected weekly review summary message.')
  assert.match(weeklySummaryMessage, /7 workouts: 2 completed, 1 partial, 1 skipped, 3 unlogged/)

  const payload = buildWorkoutReviewPayload(reviewState)
  assert.equal(payload.summary.total, 7)
  assert.equal(payload.summary.completed, 2)
  assert.equal(payload.summary.partial, 1)
  assert.equal(payload.summary.skipped, 1)
  assert.equal(payload.summary.unlogged, 3)
  assert.equal(payload.summary.changes.moved, 1)
  assert.equal(payload.summary.changes.added, 2)
  assert.equal(payload.summary.changes.deleted, 1)
  assert.match(payload.previousWeek.summary ?? '', /Status summary: 2 completed, 1 partial, 1 skipped, 3 unlogged across 7 prior workouts\./)
  assert.match(payload.previousWeek.summary ?? '', /Change summary: 1 moved, 2 added, 1 deleted\./)
  assert.match(payload.previousWeek.summary ?? '', /Next week focus: Keep the Tuesday quality anchor/)

  for (const workoutLog of payload.workoutLogs) {
    await commitRepositoryCall(fake, repository.saveWorkoutLog(workoutLog))
  }
  const savedLogs = await commitRepositoryCall(fake, repository.listWorkoutLogs({ weekPlanId: editedWeek.id }))
  assert.equal(savedLogs.length, 4)

  const continuationInput = buildContinuationPromptInputFromAthleteProfile(
    athlete,
    nextWeekStart,
    payload.weekPlan,
    payload.workoutLogs,
    {
      trackedChanges,
      warmupRequirement: 'Keep every session reviewable with a structured warm-up.',
    },
  )
  const continuationPrompt = buildContinuationWeekPrompt(continuationInput)
  assert.match(continuationInput.previousWeek.summary ?? '', /7 prior workouts/)
  assert.match(continuationPrompt.messages[0].content, /This is a continuation week\./)
  assert.match(continuationPrompt.messages[1].content, /"type": "deleted"/)
  assert.match(continuationPrompt.messages[1].content, /Average heart rate 164 bpm/)
  assert.match(continuationPrompt.messages[1].content, /Upper body support lift/)

  const exported = await commitRepositoryCall(fake, exportRepositoryBackup(repository))
  assert.equal(exported.summary.athleteProfiles, 1)
  assert.equal(exported.summary.weekPlans, 1)
  assert.equal(exported.summary.workoutLogs, 4)
  assert.equal(exported.summary.onboardingDrafts, 1)
  const restorePreview = previewRestoreBackupJson(exported.backupJson)
  assert.equal(restorePreview.ok, true)
  if (!restorePreview.ok) return
  assert.equal(canApplyPreviewedBackupRestore(restorePreview, 'RESTORE BACKUP'), true)
  const restored = await commitRepositoryCall(fake, applyPreviewedBackupRestore(repository, restorePreview, 'RESTORE BACKUP'))
  assert.equal(restored.message.tone, 'success')
})

test('manual blank-week planning round-trips as a pure week plan and valid backup preview', () => {
  const onboardingState = buildCompletedOnboardingState()
  const athleteResult = createAthleteProfileFromGuidedOnboardingState(onboardingState, { updatedOn: '2026-09-10' })
  const draftResult = createResumableOnboardingDraft(onboardingState, { updatedOn: '2026-09-10' })
  const athlete = requireResultValue(athleteResult, 'Expected finalized athlete profile for blank-week planning.')
  const onboardingDraft = requireResultValue(draftResult, 'Expected resumable onboarding draft for blank-week backup.')

  let planner = createBlankPlannerState({
    athleteId: athlete.id,
    weekPlanId: 'week-2026-09-21-athlete-avery-manual',
    weekStart: '2026-09-21',
    title: 'Coach-owned blank week',
    goal: 'Fill the next week manually while the controller wiring lands.',
    notes: 'Built from scratch without importing App.tsx.',
  })

  assertPlannerError(() => plannerStateToWeekPlan(planner), 'week-workout-required', /At least one workout is required/)

  planner = addPlannerWorkout(planner, {
    scheduledDate: '2026-09-21',
    startTime: '06:45',
    category: 'aerobic',
    source: 'manual',
    title: 'Easy aerobic reset',
    purpose: 'Reopen the week with low-stress aerobic work.',
    expectedDurationMin: 40,
    warmup: [{ title: 'Walk and jog', target: { minutes: 8 } }],
    main: [{ title: 'Conversational run', detail: 'Stay light and tall.', target: { minutes: 27, effort: 'easy' } }],
    cooldown: [{ title: 'Walk', target: { minutes: 5 } }],
    notes: 'Switch to cycling if the calves still feel heavy.',
  })
  planner = addPlannerWorkout(planner, {
    scheduledDate: '2026-09-23',
    startTime: '17:30',
    category: 'strength',
    source: 'manual',
    title: 'Garage strength circuit',
    purpose: 'Keep the second week grounded with straightforward home strength.',
    expectedDurationMin: 45,
    warmup: [{ title: 'Dynamic prep', target: { minutes: 8 } }],
    main: [{ title: 'Squat and press circuit', detail: 'Rotate through crisp sets.', target: { sets: 4, reps: 5, loadKg: 24, effort: 'steady' } }],
    cooldown: [{ title: 'Breathing reset', target: { minutes: 4 } }],
  })
  planner = addPlannerWorkout(planner, {
    scheduledDate: '2026-09-25',
    startTime: '20:00',
    category: 'mobility',
    source: 'manual',
    title: 'Mobility floor flow',
    purpose: 'Keep recovery explicit after the midweek work.',
    expectedDurationMin: 20,
    warmup: [{ title: 'Ground breathing', target: { minutes: 4 } }],
    main: [{ title: 'Hip and ankle flow', detail: 'Move slowly and breathe out fully.', target: { minutes: 12 } }],
    cooldown: [{ title: 'Legs-up reset', target: { minutes: 4 } }],
  })

  const weekPlan = plannerStateToWeekPlan(planner)
  assert.deepEqual(
    weekPlan.workouts.map(workout => workout.category),
    ['aerobic', 'strength', 'mobility'],
  )
  const bundle = parseWeekImportBundle({ weekPlan, workoutLogs: [] })
  assert.equal(bundle.weekPlan.title, 'Coach-owned blank week')

  const backup = createBackupEnvelope({
    athleteProfiles: [athlete],
    weekPlans: [bundle.weekPlan],
    workoutLogs: [],
    onboardingDrafts: [onboardingDraft],
    exportedAt: '2026-09-10T08:00:00.000Z',
  })
  const backupPreview = buildBackupPreview(backup, 'Manual backup preview')
  assert.deepEqual(backupPreview.summary, [
    '1 athlete profile validated',
    '1 week plan and 0 workout logs ready to restore',
    '1 onboarding draft included',
  ])

  const restorePreview = previewRestoreBackupJson(JSON.stringify(backup))
  assert.equal(restorePreview.ok, true)
  if (!restorePreview.ok) return
  assert.equal(restorePreview.confirmationRequirement?.phrase, 'RESTORE BACKUP')
})

test('integration rejection cases stay explicit for AI handoff continuation context and backups', () => {
  const onboardingState = buildCompletedOnboardingState()
  const athleteResult = createAthleteProfileFromGuidedOnboardingState(onboardingState, { updatedOn: '2026-09-10' })
  const athlete = requireResultValue(athleteResult, 'Expected finalized athlete profile for rejection tests.')
  const targetWeekStart = parseLocalDate('2026-09-14')
  const validContract = buildRepresentativeAiWeek(athlete, targetWeekStart)

  const trackFixedWorkout = requireDefined(
    validContract.workouts.find(workout => workout.id === 'fixed-club-session-1'),
    'Expected fixed-club-session-1 in the representative contract.',
  )
  const brokenPreview = previewAiWeekHandoff(JSON.stringify({
    ...validContract,
    workouts: [
      ...validContract.workouts.filter(workout => workout.id !== 'fixed-club-session-2'),
      { ...trackFixedWorkout, id: 'fixed-track-duplicate' },
    ],
  }), {
    athlete,
    targetWeekStart,
    expectedWeekType: 'initial',
  })
  assert.equal(brokenPreview.ok, false)
  if (brokenPreview.ok) return
  assert.match(brokenPreview.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'), /Missing fixed club workout for session "club-session-2"/)
  assert.match(brokenPreview.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'), /appears more than once/)

  const validWeek = convertAiWeekContractToWeekImportBundle(validContract, {
    athlete,
    targetWeekStart,
    expectedWeekType: 'initial',
  }).weekPlan

  assert.throws(
    () => buildContinuationWeekContext(validWeek, [], [{
      workoutId: 'deleted-outside-plan',
      type: 'deleted',
      fromDate: parseLocalDate('2026-09-19'),
      note: 'Deleted without a snapshot.',
    }]),
    /needs a workoutSnapshot/,
  )

  const orphanedBackup = createBackupEnvelope({
    athleteProfiles: [athlete],
    weekPlans: [validWeek],
    workoutLogs: [],
  })
  const invalidRestore = previewRestoreBackupJson(JSON.stringify({
    ...orphanedBackup,
    athleteProfiles: [],
  }))
  assert.equal(invalidRestore.ok, false)
  assert.match(invalidRestore.issues[0]?.path ?? '', /BackupEnvelope\.weekPlans\[0\]\.athleteId/)
  assert.match(invalidRestore.issues[0]?.message ?? '', /saved athlete profile/i)
})
