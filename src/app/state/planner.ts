import type { WeekBoardProps } from '../components/WeekBoard.tsx'
import {
  DOMAIN_VERSION,
  parseWeekPlan,
  parseWorkout,
  type FixedClubSession,
  type WeekPlan,
  type Workout,
  type WorkoutCategory,
  type WorkoutSource,
  type WorkoutStep,
  type WorkoutStepTarget,
} from '../../domain/contracts.ts'
import { addDaysToLocalDate, isDateInRollingWeek, localDateDayOfWeek, parseClockTime, parseLocalDate, type LocalDateString } from '../../domain/local-date.ts'
import { parseStableIdentity } from '../../domain/identity.ts'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const DATE_LABEL_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

export type PlannerErrorCode =
  | 'date-out-of-range'
  | 'fixed-club-edit-required'
  | 'invalid-local-id'
  | 'invalid-target-index'
  | 'invalid-week'
  | 'invalid-workout'
  | 'missing-workout'
  | 'week-workout-required'

export class PlannerValidationError extends Error {
  readonly code: PlannerErrorCode
  readonly path?: string

  constructor(code: PlannerErrorCode, message: string, path?: string) {
    super(message)
    this.name = 'PlannerValidationError'
    this.code = code
    this.path = path
  }
}

export type PlannerLocalId = string & { readonly __plannerLocalId: unique symbol }

export interface PlannerWorkoutStepDefinition {
  readonly id?: string
  readonly title: string
  readonly detail?: string
  readonly equipment?: readonly string[]
  readonly target?: WorkoutStepTarget
  readonly estimatedTotalMin?: number
}

export interface PlannerWorkoutDefinition {
  readonly id?: string
  readonly scheduledDate: LocalDateString | string
  readonly startTime?: string
  readonly category: WorkoutCategory
  readonly source: WorkoutSource
  readonly title: string
  readonly purpose: string
  readonly expectedDurationMin: number
  readonly warmup?: readonly PlannerWorkoutStepDefinition[]
  readonly main: readonly PlannerWorkoutStepDefinition[]
  readonly cooldown?: readonly PlannerWorkoutStepDefinition[]
  readonly fixedClubSession?: FixedClubSession
  readonly notes?: string
}

export interface PlannerWorkoutChanges {
  readonly scheduledDate?: LocalDateString | string
  readonly startTime?: string
  readonly category?: WorkoutCategory
  readonly source?: WorkoutSource
  readonly title?: string
  readonly purpose?: string
  readonly expectedDurationMin?: number
  readonly warmup?: readonly PlannerWorkoutStepDefinition[]
  readonly main?: readonly PlannerWorkoutStepDefinition[]
  readonly cooldown?: readonly PlannerWorkoutStepDefinition[]
  readonly notes?: string
}

export interface CreateBlankPlannerWeekInput {
  readonly athleteId: string
  readonly weekStart: LocalDateString | string
  readonly title?: string
  readonly goal?: string
  readonly notes?: string
  readonly weekPlanId?: string
}

export interface AddPlannerWorkoutInput extends PlannerWorkoutDefinition {
  readonly insertAt?: number
}

export type FixedClubSessionEdit =
  | { readonly kind: 'clear' }
  | { readonly kind: 'preserve' }
  | { readonly kind: 'replace'; readonly value: FixedClubSession }

export interface UpdatePlannerWorkoutInput {
  readonly localId: PlannerLocalId | string
  readonly changes: PlannerWorkoutChanges
  readonly fixedClubSession?: FixedClubSessionEdit
}

export interface DuplicatePlannerWorkoutInput {
  readonly localId: PlannerLocalId | string
  readonly changes?: PlannerWorkoutChanges
  readonly fixedClubSession?: FixedClubSessionEdit
  readonly insertAt?: number
}

export interface MovePlannerWorkoutInput {
  readonly localId: PlannerLocalId | string
  readonly scheduledDate: LocalDateString | string
  readonly insertAt?: number
  readonly fixedClubSession?: FixedClubSessionEdit
}

export interface ReorderPlannerWorkoutInput {
  readonly localId: PlannerLocalId | string
  readonly targetDate: LocalDateString | string
  readonly targetIndex: number
  readonly fixedClubSession?: FixedClubSessionEdit
}

export interface PlannerWorkoutEntry {
  readonly localId: PlannerLocalId
  readonly workout: Workout
}

export interface PlannerWeekDraft extends Readonly<Pick<WeekPlan, 'planningContext' | 'goalAssessment' | 'review'>> {
  readonly version: 1
  readonly id: string
  readonly athleteId: string
  readonly weekStart: LocalDateString
  readonly title: string
  readonly goal: string
  readonly workouts: readonly PlannerWorkoutEntry[]
  readonly notes?: string
}

export interface PlannerSnapshot {
  readonly week: PlannerWeekDraft
}

export interface PlannerState {
  readonly past: readonly PlannerSnapshot[]
  readonly present: PlannerSnapshot
  readonly future: readonly PlannerSnapshot[]
  readonly nextGeneratedId: number
}

interface MutablePlannerWeek extends Pick<WeekPlan, 'planningContext' | 'goalAssessment' | 'review'> {
  version: 1
  id: string
  athleteId: string
  weekStart: LocalDateString
  title: string
  goal: string
  workouts: PlannerWorkoutEntry[]
  notes?: string
}

function plannerError(code: PlannerErrorCode, message: string, path?: string): PlannerValidationError {
  return new PlannerValidationError(code, message, path)
}

function asPlannerError(code: PlannerErrorCode, path: string, error: unknown): PlannerValidationError {
  if (error instanceof PlannerValidationError) return error
  if (error instanceof Error) return new PlannerValidationError(code, error.message, path)
  return new PlannerValidationError(code, `Unexpected planner failure at ${path}.`, path)
}

function normalizeText(value: unknown, label: string, minimum: number, maximum: number, code: PlannerErrorCode): string {
  if (typeof value !== 'string') throw plannerError(code, `${label} must be a string.`, label)
  const normalized = value.trim()
  if (normalized.length < minimum || normalized.length > maximum) {
    throw plannerError(code, `${label} must be between ${minimum} and ${maximum} characters.`, label)
  }
  return normalized
}

function normalizeOptionalText(value: unknown, label: string, maximum: number, code: PlannerErrorCode): string | undefined {
  if (value === undefined) return undefined
  return normalizeText(value, label, 1, maximum, code)
}

function normalizeInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw plannerError('invalid-workout', `${label} must be an integer between ${minimum} and ${maximum}.`, label)
  }
  return value
}

function normalizeLocalDate(value: LocalDateString | string, label: string, code: PlannerErrorCode): LocalDateString {
  try {
    return parseLocalDate(value, label)
  } catch (error) {
    throw asPlannerError(code, label, error)
  }
}

function normalizeClockTime(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined
  try {
    return parseClockTime(value, label)
  } catch (error) {
    throw asPlannerError('invalid-workout', label, error)
  }
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function weekMetadata(week: Pick<WeekPlan, 'planningContext' | 'goalAssessment' | 'review'>) {
  return {
    ...(week.planningContext === undefined ? {} : { planningContext: cloneValue(week.planningContext) }),
    ...(week.goalAssessment === undefined ? {} : { goalAssessment: cloneValue(week.goalAssessment) }),
    ...(week.review === undefined ? {} : { review: cloneValue(week.review) }),
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested)
  }
  return value
}

function freezePlannerState(state: PlannerState): PlannerState {
  return deepFreeze(state)
}

function makeMutableWeek(week: PlannerWeekDraft): MutablePlannerWeek {
  return {
    version: DOMAIN_VERSION,
    id: week.id,
    athleteId: week.athleteId,
    weekStart: week.weekStart,
    title: week.title,
    goal: week.goal,
    notes: week.notes,
    ...weekMetadata(week),
    workouts: week.workouts.map(entry => ({
      localId: entry.localId,
      workout: cloneValue(entry.workout),
    })),
  }
}

function createPlannerLocalId(workoutId: string): PlannerLocalId {
  return `planner-local-${parseStableIdentity(workoutId, 'Workout.id')}` as PlannerLocalId
}

function ensureWeekDate(weekStart: LocalDateString, date: LocalDateString, label: string): void {
  if (!isDateInRollingWeek(date, weekStart)) {
    throw plannerError('date-out-of-range', `${label} must stay inside the active seven-day week.`, label)
  }
}

function createIdAllocator(startAt: number) {
  let next = startAt
  return {
    allocate(prefix: 'step' | 'week' | 'workout'): string {
      const id = `planner-${prefix}-${next}`
      next += 1
      return parseStableIdentity(id, `${prefix} id`)
    },
    getNext(): number {
      return next
    },
  }
}

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function normalizeWorkoutSteps(
  steps: readonly PlannerWorkoutStepDefinition[] | undefined,
  label: string,
  allocator: ReturnType<typeof createIdAllocator>,
): WorkoutStep[] {
  if (!Array.isArray(steps)) throw plannerError('invalid-workout', `${label} must be an array.`, label)
  return steps.map(step => ({
    id: step.id === undefined ? allocator.allocate('step') : parseStableIdentity(step.id, 'WorkoutStep.id'),
    title: step.title,
    detail: step.detail,
    equipment: step.equipment === undefined ? undefined : [...step.equipment],
    target: step.target === undefined ? undefined : cloneValue(step.target),
    ...(step.estimatedTotalMin === undefined ? {} : { estimatedTotalMin: step.estimatedTotalMin }),
  }))
}

function normalizeExistingWorkoutSteps(workout: Workout, section: 'cooldown' | 'main' | 'warmup'): WorkoutStep[] {
  return cloneValue(workout[section])
}

function resolveFixedClubSession(
  current: Workout | undefined,
  nextWorkout: Pick<Workout, 'category' | 'expectedDurationMin' | 'scheduledDate' | 'source' | 'startTime'>,
  edit: FixedClubSessionEdit | undefined,
): FixedClubSession | undefined {
  const currentFixed = current?.fixedClubSession

  if (nextWorkout.source !== 'club') {
    if (edit?.kind === 'replace') {
      throw plannerError('fixed-club-edit-required', 'Only club workouts can include fixed club metadata.', 'Workout.fixedClubSession')
    }
    if (currentFixed && edit?.kind !== 'clear') {
      throw plannerError(
        'fixed-club-edit-required',
        'Changing a fixed club workout to a non-club source requires an explicit fixed club clear action.',
        'Workout.fixedClubSession',
      )
    }
    return undefined
  }

  if (edit?.kind === 'clear') {
    throw plannerError('fixed-club-edit-required', 'Club workouts must keep fixed club metadata.', 'Workout.fixedClubSession')
  }

  if (edit?.kind === 'replace') {
    return cloneValue(edit.value)
  }

  if (!currentFixed) {
    throw plannerError(
      'fixed-club-edit-required',
      'Creating or converting a club workout requires explicit fixed club metadata.',
      'Workout.fixedClubSession',
    )
  }

  const nextDayOfWeek = localDateDayOfWeek(nextWorkout.scheduledDate)
  const mismatchedCategory = currentFixed.category !== nextWorkout.category
  const mismatchedDay = currentFixed.dayOfWeek !== nextDayOfWeek
  const mismatchedDuration = currentFixed.durationMin !== nextWorkout.expectedDurationMin
  const mismatchedStartTime = nextWorkout.startTime !== undefined && currentFixed.startTime !== nextWorkout.startTime

  if (mismatchedCategory || mismatchedDay || mismatchedDuration || mismatchedStartTime) {
    throw plannerError(
      'fixed-club-edit-required',
      'Changing the category, date, start time, or duration of a fixed club workout requires an explicit fixed club replacement.',
      'Workout.fixedClubSession',
    )
  }

  return cloneValue(currentFixed)
}

function buildWorkoutFromDefinition(
  week: Pick<PlannerWeekDraft, 'athleteId' | 'id' | 'weekStart'>,
  input: PlannerWorkoutDefinition,
  allocator: ReturnType<typeof createIdAllocator>,
): Workout {
  const scheduledDate = normalizeLocalDate(input.scheduledDate, 'Workout.scheduledDate', 'invalid-workout')
  ensureWeekDate(week.weekStart, scheduledDate, 'Workout.scheduledDate')

  const candidateBase = {
    version: DOMAIN_VERSION,
    id: input.id === undefined ? allocator.allocate('workout') : parseStableIdentity(input.id, 'Workout.id'),
    athleteId: parseStableIdentity(week.athleteId, 'WeekPlan.athleteId'),
    weekPlanId: parseStableIdentity(week.id, 'WeekPlan.id'),
    scheduledDate,
    startTime: normalizeClockTime(input.startTime, 'Workout.startTime'),
    category: input.category,
    source: input.source,
    title: input.title,
    purpose: input.purpose,
    expectedDurationMin: normalizeInteger(input.expectedDurationMin, 'Workout.expectedDurationMin', 1, 720),
    warmup: normalizeWorkoutSteps(input.warmup ?? [], 'Workout.warmup', allocator),
    main: normalizeWorkoutSteps(input.main, 'Workout.main', allocator),
    cooldown: normalizeWorkoutSteps(input.cooldown ?? [], 'Workout.cooldown', allocator),
    notes: normalizeOptionalText(input.notes, 'Workout.notes', 2_000, 'invalid-workout'),
  } satisfies Omit<Workout, 'fixedClubSession'>

  const candidate: Workout = {
    ...candidateBase,
    fixedClubSession: resolveFixedClubSession(undefined, candidateBase, input.fixedClubSession === undefined ? undefined : {
      kind: 'replace',
      value: input.fixedClubSession,
    }),
  }

  try {
    return parseWorkout(candidate)
  } catch (error) {
    throw asPlannerError('invalid-workout', 'Workout', error)
  }
}

function applyWorkoutChanges(
  workout: Workout,
  changes: PlannerWorkoutChanges,
  fixedClubSession: FixedClubSessionEdit | undefined,
  allocator: ReturnType<typeof createIdAllocator>,
): Workout {
  const scheduledDate = hasOwn(changes, 'scheduledDate')
    ? normalizeLocalDate(changes.scheduledDate!, 'Workout.scheduledDate', 'invalid-workout')
    : workout.scheduledDate
  const startTime = hasOwn(changes, 'startTime')
    ? normalizeClockTime(changes.startTime, 'Workout.startTime')
    : workout.startTime
  const category = hasOwn(changes, 'category') ? changes.category! : workout.category
  const source = hasOwn(changes, 'source') ? changes.source! : workout.source
  const title = hasOwn(changes, 'title') ? changes.title! : workout.title
  const purpose = hasOwn(changes, 'purpose') ? changes.purpose! : workout.purpose
  const expectedDurationMin = hasOwn(changes, 'expectedDurationMin')
    ? normalizeInteger(changes.expectedDurationMin, 'Workout.expectedDurationMin', 1, 720)
    : workout.expectedDurationMin
  const warmup = hasOwn(changes, 'warmup')
    ? normalizeWorkoutSteps(changes.warmup, 'Workout.warmup', allocator)
    : normalizeExistingWorkoutSteps(workout, 'warmup')
  const main = hasOwn(changes, 'main')
    ? normalizeWorkoutSteps(changes.main, 'Workout.main', allocator)
    : normalizeExistingWorkoutSteps(workout, 'main')
  const cooldown = hasOwn(changes, 'cooldown')
    ? normalizeWorkoutSteps(changes.cooldown, 'Workout.cooldown', allocator)
    : normalizeExistingWorkoutSteps(workout, 'cooldown')
  const notes = hasOwn(changes, 'notes')
    ? normalizeOptionalText(changes.notes, 'Workout.notes', 2_000, 'invalid-workout')
    : workout.notes

  const candidateBase = {
    version: DOMAIN_VERSION,
    id: workout.id,
    athleteId: workout.athleteId,
    weekPlanId: workout.weekPlanId,
    scheduledDate,
    startTime,
    category,
    source,
    title,
    purpose,
    expectedDurationMin,
    warmup,
    main,
    cooldown,
    notes,
  } satisfies Omit<Workout, 'fixedClubSession'>

  const candidate: Workout = {
    ...candidateBase,
    fixedClubSession: resolveFixedClubSession(workout, candidateBase, fixedClubSession),
  }

  try {
    return parseWorkout(candidate)
  } catch (error) {
    throw asPlannerError('invalid-workout', 'Workout', error)
  }
}

function duplicateWorkout(
  workout: Workout,
  changes: PlannerWorkoutChanges | undefined,
  fixedClubSession: FixedClubSessionEdit | undefined,
  allocator: ReturnType<typeof createIdAllocator>,
): Workout {
  const duplicateBase: Workout = {
    ...cloneValue(workout),
    id: allocator.allocate('workout'),
    warmup: normalizeWorkoutSteps(
      workout.warmup.map(step => ({ ...step, id: undefined })),
      'Workout.warmup',
      allocator,
    ),
    main: normalizeWorkoutSteps(
      workout.main.map(step => ({ ...step, id: undefined })),
      'Workout.main',
      allocator,
    ),
    cooldown: normalizeWorkoutSteps(
      workout.cooldown.map(step => ({ ...step, id: undefined })),
      'Workout.cooldown',
      allocator,
    ),
  }
  return applyWorkoutChanges(duplicateBase, changes ?? {}, fixedClubSession, allocator)
}

function normalizePlannerEntries(entries: readonly PlannerWorkoutEntry[]): PlannerWorkoutEntry[] {
  return entries
    .slice()
    .sort((left, right) => {
      if (left.workout.scheduledDate === right.workout.scheduledDate) return 0
      return left.workout.scheduledDate < right.workout.scheduledDate ? -1 : 1
    })
}

function validatePlannerWeekDraft(week: PlannerWeekDraft): PlannerWeekDraft {
  const normalizedWeekStart = normalizeLocalDate(week.weekStart, 'WeekPlan.weekStart', 'invalid-week')
  const normalized: PlannerWeekDraft = {
    version: DOMAIN_VERSION,
    id: parseStableIdentity(week.id, 'WeekPlan.id'),
    athleteId: parseStableIdentity(week.athleteId, 'WeekPlan.athleteId'),
    weekStart: normalizedWeekStart,
    title: normalizeText(week.title, 'WeekPlan.title', 1, 120, 'invalid-week'),
    goal: normalizeText(week.goal, 'WeekPlan.goal', 1, 500, 'invalid-week'),
    workouts: normalizePlannerEntries(week.workouts.map(entry => ({
      localId: (() => {
        const expectedLocalId = createPlannerLocalId(entry.workout.id)
        if (entry.localId !== expectedLocalId) {
          throw plannerError('invalid-local-id', `Local id ${entry.localId} does not match workout ${entry.workout.id}.`, 'PlannerWorkout.localId')
        }
        return expectedLocalId
      })(),
      workout: cloneValue(entry.workout),
    }))),
    notes: normalizeOptionalText(week.notes, 'WeekPlan.notes', 2_000, 'invalid-week'),
    ...weekMetadata(week),
  }

  try {
    const validatedWeek = parseWeekPlan({
      version: DOMAIN_VERSION,
      id: normalized.id,
      athleteId: normalized.athleteId,
      weekStart: normalized.weekStart,
      title: normalized.title,
      goal: normalized.goal,
      workouts: normalized.workouts.map(entry => entry.workout),
      notes: normalized.notes,
      ...weekMetadata(normalized),
    })

    return {
      version: DOMAIN_VERSION,
      id: validatedWeek.id,
      athleteId: validatedWeek.athleteId,
      weekStart: validatedWeek.weekStart,
      title: validatedWeek.title,
      goal: validatedWeek.goal,
      workouts: validatedWeek.workouts.map(workout => ({
        localId: createPlannerLocalId(workout.id),
        workout,
      })),
      notes: validatedWeek.notes,
      ...weekMetadata(validatedWeek),
    }
  } catch (error) {
    throw asPlannerError('invalid-week', 'WeekPlan', error)
  }
}

function createPlannerState(week: PlannerWeekDraft, nextGeneratedId: number): PlannerState {
  return freezePlannerState({
    past: [],
    present: { week: validatePlannerWeekDraft(week) },
    future: [],
    nextGeneratedId,
  })
}

function commitPlannerWeek(state: PlannerState, nextWeek: PlannerWeekDraft, nextGeneratedId: number): PlannerState {
  const validatedWeek = validatePlannerWeekDraft(nextWeek)
  if (JSON.stringify(state.present.week) === JSON.stringify(validatedWeek) && state.nextGeneratedId === nextGeneratedId) {
    return state
  }
  return freezePlannerState({
    past: [...state.past, state.present],
    present: { week: validatedWeek },
    future: [],
    nextGeneratedId,
  })
}

function indexOfWorkout(state: PlannerState, localId: PlannerLocalId | string): number {
  const index = state.present.week.workouts.findIndex(entry => entry.localId === localId)
  if (index < 0) throw plannerError('missing-workout', `Planner workout "${localId}" was not found.`, 'PlannerWorkout.localId')
  return index
}

function insertEntryAtDate(
  entries: readonly PlannerWorkoutEntry[],
  entry: PlannerWorkoutEntry,
  scheduledDate: LocalDateString,
  insertAt?: number,
): PlannerWorkoutEntry[] {
  const before = entries.filter(candidate => candidate.workout.scheduledDate < scheduledDate)
  const onDay = entries.filter(candidate => candidate.workout.scheduledDate === scheduledDate)
  const after = entries.filter(candidate => candidate.workout.scheduledDate > scheduledDate)
  const targetIndex = insertAt ?? onDay.length

  if (!Number.isSafeInteger(targetIndex) || targetIndex < 0 || targetIndex > onDay.length) {
    throw plannerError(
      'invalid-target-index',
      `Target index ${String(insertAt)} is outside the ${scheduledDate} workout list.`,
      'PlannerWorkout.insertAt',
    )
  }

  return [...before, ...onDay.slice(0, targetIndex), entry, ...onDay.slice(targetIndex), ...after]
}

function detectNextGeneratedId(week: WeekPlan | Pick<PlannerWeekDraft, 'id' | 'workouts'>): number {
  let maximum = 0
  const inspect = (id: string) => {
    const match = /^planner-(?:step|week|workout)-(\d+)$/.exec(id)
    if (!match) return
    const value = Number.parseInt(match[1]!, 10)
    if (Number.isSafeInteger(value) && value > maximum) maximum = value
  }

  inspect(week.id)
  for (const entry of week.workouts) {
    const workout = 'workout' in entry ? entry.workout : entry
    inspect(workout.id)
    for (const step of [...workout.warmup, ...workout.main, ...workout.cooldown]) inspect(step.id)
  }

  return maximum + 1
}

function formatDateLabel(date: LocalDateString): string {
  return DATE_LABEL_FORMATTER.format(new Date(`${date}T00:00:00.000Z`))
}

function formatDuration(minutes: number): string {
  return `${minutes} min`
}

function daySummary(workouts: readonly PlannerWorkoutEntry[]): string | undefined {
  if (!workouts.length) return undefined
  const totalMinutes = workouts.reduce((sum, entry) => sum + entry.workout.expectedDurationMin, 0)
  const sessionLabel = workouts.length === 1 ? '1 session' : `${workouts.length} sessions`
  return `${sessionLabel} · ${formatDuration(totalMinutes)}`
}

export function createBlankPlannerState(input: CreateBlankPlannerWeekInput): PlannerState {
  const normalizedWeekStart = normalizeLocalDate(input.weekStart, 'WeekPlan.weekStart', 'invalid-week')
  const allocator = createIdAllocator(1)
  const weekId = input.weekPlanId === undefined ? allocator.allocate('week') : parseStableIdentity(input.weekPlanId, 'WeekPlan.id')

  return createPlannerState(
    {
      version: DOMAIN_VERSION,
      id: weekId,
      athleteId: parseStableIdentity(input.athleteId, 'WeekPlan.athleteId'),
      weekStart: normalizedWeekStart,
      title: input.title ?? `Week of ${normalizedWeekStart}`,
      goal: input.goal ?? 'Build a clear seven-day plan.',
      workouts: [],
      notes: input.notes,
    },
    input.weekPlanId === undefined ? allocator.getNext() : detectNextGeneratedId({ id: weekId, workouts: [] }),
  )
}

export function createPlannerStateFromWeekPlan(weekPlan: WeekPlan): PlannerState {
  let validated: WeekPlan
  try {
    validated = parseWeekPlan(weekPlan)
  } catch (error) {
    throw asPlannerError('invalid-week', 'WeekPlan', error)
  }

  return createPlannerState(
    {
      version: DOMAIN_VERSION,
      id: validated.id,
      athleteId: validated.athleteId,
      weekStart: validated.weekStart,
      title: validated.title,
      goal: validated.goal,
      notes: validated.notes,
      ...weekMetadata(validated),
      workouts: validated.workouts.map(workout => ({
        localId: createPlannerLocalId(workout.id),
        workout: cloneValue(workout),
      })),
    },
    detectNextGeneratedId(validated),
  )
}

export function plannerStateToWeekPlan(state: PlannerState): WeekPlan {
  const week = state.present.week
  try {
    return parseWeekPlan({
      version: DOMAIN_VERSION,
      id: week.id,
      athleteId: week.athleteId,
      weekStart: week.weekStart,
      title: week.title,
      goal: week.goal,
      workouts: week.workouts.map(entry => cloneValue(entry.workout)),
      notes: week.notes,
      ...weekMetadata(week),
    })
  } catch (error) {
    throw asPlannerError('invalid-week', 'WeekPlan', error)
  }
}

export function listPlannerWorkoutsForDate(
  state: PlannerState,
  scheduledDate: LocalDateString | string,
): readonly PlannerWorkoutEntry[] {
  const date = normalizeLocalDate(scheduledDate, 'Workout.scheduledDate', 'invalid-workout')
  ensureWeekDate(state.present.week.weekStart, date, 'Workout.scheduledDate')
  return state.present.week.workouts.filter(entry => entry.workout.scheduledDate === date)
}

export function addPlannerWorkout(state: PlannerState, input: AddPlannerWorkoutInput): PlannerState {
  const allocator = createIdAllocator(state.nextGeneratedId)
  const nextWeek = makeMutableWeek(state.present.week)
  const workout = buildWorkoutFromDefinition(nextWeek, input, allocator)
  const entry: PlannerWorkoutEntry = { localId: createPlannerLocalId(workout.id), workout }
  nextWeek.workouts = insertEntryAtDate(nextWeek.workouts, entry, workout.scheduledDate, input.insertAt)
  return commitPlannerWeek(state, nextWeek, allocator.getNext())
}

export function updatePlannerWorkout(state: PlannerState, input: UpdatePlannerWorkoutInput): PlannerState {
  const allocator = createIdAllocator(state.nextGeneratedId)
  const workoutIndex = indexOfWorkout(state, input.localId)
  const currentEntry = state.present.week.workouts[workoutIndex]!
  const currentDayIndex = listPlannerWorkoutsForDate(state, currentEntry.workout.scheduledDate).findIndex(entry => entry.localId === currentEntry.localId)
  const nextWeek = makeMutableWeek(state.present.week)
  const updatedWorkout = applyWorkoutChanges(currentEntry.workout, input.changes, input.fixedClubSession, allocator)
  ensureWeekDate(nextWeek.weekStart, updatedWorkout.scheduledDate, 'Workout.scheduledDate')

  const remaining = nextWeek.workouts.filter((_, index) => index !== workoutIndex)
  const updatedEntry: PlannerWorkoutEntry = { localId: createPlannerLocalId(updatedWorkout.id), workout: updatedWorkout }
  nextWeek.workouts = insertEntryAtDate(
    remaining,
    updatedEntry,
    updatedWorkout.scheduledDate,
    updatedWorkout.scheduledDate === currentEntry.workout.scheduledDate ? currentDayIndex : undefined,
  )
  return commitPlannerWeek(state, nextWeek, allocator.getNext())
}

export function duplicatePlannerWorkout(state: PlannerState, input: DuplicatePlannerWorkoutInput): PlannerState {
  const workoutIndex = indexOfWorkout(state, input.localId)
  const sourceEntry = state.present.week.workouts[workoutIndex]!
  const sourceDayEntries = listPlannerWorkoutsForDate(state, sourceEntry.workout.scheduledDate)
  const sourceDayIndex = sourceDayEntries.findIndex(entry => entry.localId === sourceEntry.localId)
  const allocator = createIdAllocator(state.nextGeneratedId)
  const nextWeek = makeMutableWeek(state.present.week)

  const duplicated = duplicateWorkout(sourceEntry.workout, input.changes, input.fixedClubSession, allocator)
  ensureWeekDate(nextWeek.weekStart, duplicated.scheduledDate, 'Workout.scheduledDate')
  const duplicatedEntry: PlannerWorkoutEntry = { localId: createPlannerLocalId(duplicated.id), workout: duplicated }
  const insertAt = input.insertAt
    ?? (duplicated.scheduledDate === sourceEntry.workout.scheduledDate ? sourceDayIndex + 1 : undefined)

  nextWeek.workouts = insertEntryAtDate(nextWeek.workouts, duplicatedEntry, duplicated.scheduledDate, insertAt)
  return commitPlannerWeek(state, nextWeek, allocator.getNext())
}

export function deletePlannerWorkout(state: PlannerState, localId: PlannerLocalId | string): PlannerState {
  const workoutIndex = indexOfWorkout(state, localId)
  const nextWeek = makeMutableWeek(state.present.week)
  nextWeek.workouts = nextWeek.workouts.filter((_, index) => index !== workoutIndex)
  return commitPlannerWeek(state, nextWeek, state.nextGeneratedId)
}

export function movePlannerWorkout(state: PlannerState, input: MovePlannerWorkoutInput): PlannerState {
  const workoutIndex = indexOfWorkout(state, input.localId)
  const currentEntry = state.present.week.workouts[workoutIndex]!
  const currentDayIndex = listPlannerWorkoutsForDate(state, currentEntry.workout.scheduledDate).findIndex(entry => entry.localId === currentEntry.localId)
  const allocator = createIdAllocator(state.nextGeneratedId)
  const nextWeek = makeMutableWeek(state.present.week)
  const scheduledDate = normalizeLocalDate(input.scheduledDate, 'Workout.scheduledDate', 'invalid-workout')
  ensureWeekDate(nextWeek.weekStart, scheduledDate, 'Workout.scheduledDate')

  const movedWorkout = applyWorkoutChanges(currentEntry.workout, { scheduledDate }, input.fixedClubSession, allocator)
  const remaining = nextWeek.workouts.filter((_, index) => index !== workoutIndex)
  nextWeek.workouts = insertEntryAtDate(
    remaining,
    { localId: createPlannerLocalId(movedWorkout.id), workout: movedWorkout },
    movedWorkout.scheduledDate,
    input.insertAt ?? (movedWorkout.scheduledDate === currentEntry.workout.scheduledDate ? currentDayIndex : undefined),
  )
  return commitPlannerWeek(state, nextWeek, allocator.getNext())
}

export function reorderPlannerWorkout(state: PlannerState, input: ReorderPlannerWorkoutInput): PlannerState {
  const workoutIndex = indexOfWorkout(state, input.localId)
  const currentEntry = state.present.week.workouts[workoutIndex]!
  const allocator = createIdAllocator(state.nextGeneratedId)
  const nextWeek = makeMutableWeek(state.present.week)
  const targetDate = normalizeLocalDate(input.targetDate, 'Workout.scheduledDate', 'invalid-workout')
  ensureWeekDate(nextWeek.weekStart, targetDate, 'Workout.scheduledDate')

  const reorderedWorkout = applyWorkoutChanges(currentEntry.workout, { scheduledDate: targetDate }, input.fixedClubSession, allocator)
  const remaining = nextWeek.workouts.filter((_, index) => index !== workoutIndex)
  nextWeek.workouts = insertEntryAtDate(
    remaining,
    { localId: createPlannerLocalId(reorderedWorkout.id), workout: reorderedWorkout },
    reorderedWorkout.scheduledDate,
    input.targetIndex,
  )
  return commitPlannerWeek(state, nextWeek, allocator.getNext())
}

export function undoPlannerState(state: PlannerState): PlannerState {
  if (!state.past.length) return state
  const previous = state.past[state.past.length - 1]!
  return freezePlannerState({
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future],
    nextGeneratedId: state.nextGeneratedId,
  })
}

export function redoPlannerState(state: PlannerState): PlannerState {
  if (!state.future.length) return state
  const [next, ...rest] = state.future
  return freezePlannerState({
    past: [...state.past, state.present],
    present: next!,
    future: rest,
    nextGeneratedId: state.nextGeneratedId,
  })
}

export function mapPlannerStateToWeekBoardProps(state: PlannerState): WeekBoardProps {
  const week = state.present.week
  const days = Array.from({ length: 7 }, (_, offset) => {
    const scheduledDate = addDaysToLocalDate(week.weekStart, offset)
    const workouts = week.workouts.filter(entry => entry.workout.scheduledDate === scheduledDate)

    return {
      id: `planner-day-${scheduledDate}`,
      label: DAY_LABELS[localDateDayOfWeek(scheduledDate)]!,
      dateLabel: formatDateLabel(scheduledDate),
      summary: daySummary(workouts),
      emptyLabel: 'Open space.',
      cards: workouts.map(entry => ({
        id: entry.localId,
        kind: entry.workout.category,
        title: entry.workout.title,
        timeLabel: entry.workout.startTime === undefined
          ? formatDuration(entry.workout.expectedDurationMin)
          : `${entry.workout.startTime} · ${formatDuration(entry.workout.expectedDurationMin)}`,
        summary: entry.workout.purpose,
        note: entry.workout.notes,
        clubBadgeLabel: entry.workout.fixedClubSession?.scope,
        fixed: entry.workout.fixedClubSession !== undefined,
      })),
    }
  })

  return {
    title: week.title,
    description: week.goal,
    days,
    footerNote: week.notes,
  }
}
