import {
  addDaysToLocalDate,
  compareLocalDates,
  isDateInRollingWeek,
  localDateDayOfWeek,
  parseClockTime,
  parseIsoTimestamp,
  parseLocalDate,
  type LocalDateString,
} from './local-date.ts'
import { assertUniqueStableIdentities, parseStableIdentity } from './identity.ts'

export const DOMAIN_VERSION = 1 as const

export type WorkoutCategory = 'aerobic' | 'strength' | 'mobility'
export type WorkoutEffort = 'recovery' | 'easy' | 'steady' | 'tempo' | 'hard' | 'max'
export type WorkoutSource = 'manual' | 'ai' | 'club'
export type WorkoutLogOutcome = 'completed' | 'partial' | 'skipped'
export type StrengthPreference = 'full_body' | 'upper_lower' | 'push_pull_legs' | 'mixed'

export interface PreferredTrainingDay {
  dayOfWeek: number
  modalities: WorkoutCategory[]
  preferredStartTime?: string
  expectedDurationMin?: number
  notes?: string
}

export interface EquipmentDetail {
  id: string
  label: string
  constraints: string[]
  notes?: string
}

export interface RecurringClubSession {
  id: string
  title: string
  scope?: string
  category?: WorkoutCategory
  dayOfWeek: number
  startTime: string
  durationMin?: number
  notes?: string
}

export interface FullySpecifiedRecurringClubSession extends RecurringClubSession {
  scope: string
  category: WorkoutCategory
  durationMin: number
}

export function isFullySpecifiedClubSession(session: RecurringClubSession): session is FullySpecifiedRecurringClubSession {
  return session.scope !== undefined && session.category !== undefined && session.durationMin !== undefined
}

export interface AthleteProfile {
  version: 1
  id: string
  createdOn: LocalDateString
  updatedOn: LocalDateString
  name: string
  goal: string
  goalDate?: LocalDateString
  sports: string[]
  preferredWeeklyStructure: PreferredTrainingDay[]
  strengthPreference?: StrengthPreference
  equipmentDetails: EquipmentDetail[]
  constraints: string[]
  clubSessions: RecurringClubSession[]
  notes?: string
}

export interface WorkoutStepTarget {
  sets?: number
  reps?: number
  seconds?: number
  minutes?: number
  distanceMeters?: number
  loadKg?: number
  effort?: WorkoutEffort
}

export interface WorkoutStep {
  id: string
  title: string
  detail?: string
  equipment?: string[]
  target?: WorkoutStepTarget
}

export interface FixedClubSession {
  recurringSessionId: string
  title: string
  scope: string
  category: WorkoutCategory
  dayOfWeek: number
  startTime: string
  durationMin: number
}

export interface Workout {
  version: 1
  id: string
  athleteId: string
  weekPlanId: string
  scheduledDate: LocalDateString
  startTime?: string
  category: WorkoutCategory
  source: WorkoutSource
  title: string
  purpose: string
  expectedDurationMin: number
  warmup: WorkoutStep[]
  main: WorkoutStep[]
  cooldown: WorkoutStep[]
  fixedClubSession?: FixedClubSession
  notes?: string
}

export interface WeekPlan {
  version: 1
  id: string
  athleteId: string
  weekStart: LocalDateString
  title: string
  goal: string
  workouts: Workout[]
  notes?: string
}

export interface WorkoutLogMetrics {
  durationMin?: number
  movingTimeMin?: number
  elapsedTimeMin?: number
  distanceMeters?: number
  paceSecondsPerKm?: number
  averageHeartRate?: number
}

export interface WorkoutLogStep {
  stepId: string
  completedSets?: number
  completedReps?: number
  completedSeconds?: number
  completedMinutes?: number
  completedDistanceMeters?: number
  completedPaceSecondsPerKm?: number
  loadKg?: number
  notes?: string
}

export interface WorkoutLog {
  version: 1
  id: string
  athleteId: string
  weekPlanId: string
  workoutId: string
  loggedOn: LocalDateString
  outcome: WorkoutLogOutcome
  effortRating?: number
  metrics?: WorkoutLogMetrics
  steps: WorkoutLogStep[]
  notes?: string
}

export interface OnboardingDraft {
  version: 1
  id: string
  athleteId: string
  createdOn: LocalDateString
  updatedOn: LocalDateString
  startingWeek: LocalDateString
  name?: string
  goal: string
  goalDate?: LocalDateString
  sports: string[]
  preferredWeeklyStructure: PreferredTrainingDay[]
  strengthPreference?: StrengthPreference
  equipmentDetails: EquipmentDetail[]
  constraints: string[]
  clubSessions: RecurringClubSession[]
  notes?: string
}

export interface BackupEnvelope {
  version: 1
  exportedAt: string
  athleteProfiles: AthleteProfile[]
  weekPlans: WeekPlan[]
  workoutLogs: WorkoutLog[]
  onboardingDrafts: OnboardingDraft[]
}

export interface WeekImportBundle {
  weekPlan: WeekPlan
  workoutLogs: WorkoutLog[]
}

const workoutCategories = new Set<WorkoutCategory>(['aerobic', 'strength', 'mobility'])
const workoutEfforts = new Set<WorkoutEffort>(['recovery', 'easy', 'steady', 'tempo', 'hard', 'max'])
const workoutSources = new Set<WorkoutSource>(['manual', 'ai', 'club'])
const workoutOutcomes = new Set<WorkoutLogOutcome>(['completed', 'partial', 'skipped'])
const strengthPreferences = new Set<StrengthPreference>(['full_body', 'upper_lower', 'push_pull_legs', 'mixed'])

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`)
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'Expected an object.')
  return value as Record<string, unknown>
}

function expectExactKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys)
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, 'Unexpected field.')
  }
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(path, `Expected an integer between ${minimum} and ${maximum}.`)
  }
  return value
}

function numeric(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `Expected a number between ${minimum} and ${maximum}.`)
  }
  return value
}

function text(value: unknown, path: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string') fail(path, 'Expected a string.')
  const normalized = value.trim()
  if (normalized.length < minimum || normalized.length > maximum) {
    fail(path, `Expected between ${minimum} and ${maximum} characters.`)
  }
  return normalized
}

function optionalText(value: unknown, path: string, maximum: number): string | undefined {
  if (value === undefined) return undefined
  return text(value, path, 1, maximum)
}

function textList(
  value: unknown,
  path: string,
  minimumItems: number,
  maximumItems: number,
  maximumLength: number,
): string[] {
  if (!Array.isArray(value)) fail(path, 'Expected an array.')
  if (value.length < minimumItems || value.length > maximumItems) {
    fail(path, `Expected between ${minimumItems} and ${maximumItems} items.`)
  }
  const items = value.map((entry, index) => text(entry, `${path}[${index}]`, 1, maximumLength))
  if (new Set(items).size !== items.length) fail(path, 'Items must be unique.')
  return items
}

function versionedRecord(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  const record = asObject(value, path)
  expectExactKeys(record, keys, path)
  if (record.version !== DOMAIN_VERSION) fail(`${path}.version`, `Expected version ${DOMAIN_VERSION}.`)
  return record
}

function parseWorkoutCategory(value: unknown, path: string): WorkoutCategory {
  if (typeof value !== 'string' || !workoutCategories.has(value as WorkoutCategory)) {
    fail(path, 'Expected a supported workout category.')
  }
  return value as WorkoutCategory
}

function parseWorkoutCategoryList(value: unknown, path: string, minimumItems: number, maximumItems: number): WorkoutCategory[] {
  if (!Array.isArray(value)) fail(path, 'Expected an array.')
  if (value.length < minimumItems || value.length > maximumItems) {
    fail(path, `Expected between ${minimumItems} and ${maximumItems} items.`)
  }
  const categories = value.map((entry, index) => parseWorkoutCategory(entry, `${path}[${index}]`))
  if (new Set(categories).size !== categories.length) fail(path, 'Categories must be unique.')
  return categories
}

function parseStrengthPreference(value: unknown, path: string): StrengthPreference {
  if (typeof value !== 'string' || !strengthPreferences.has(value as StrengthPreference)) {
    fail(path, 'Expected a supported strength preference.')
  }
  return value as StrengthPreference
}

function parsePreferredTrainingDay(value: unknown, path: string): PreferredTrainingDay {
  const record = asObject(value, path)
  expectExactKeys(record, ['dayOfWeek', 'modalities', 'preferredStartTime', 'expectedDurationMin', 'notes'], path)
  return {
    dayOfWeek: integer(record.dayOfWeek, `${path}.dayOfWeek`, 0, 6),
    modalities: parseWorkoutCategoryList(record.modalities, `${path}.modalities`, 1, 3),
    preferredStartTime: record.preferredStartTime === undefined ? undefined : parseClockTime(record.preferredStartTime, `${path}.preferredStartTime`),
    expectedDurationMin: record.expectedDurationMin === undefined ? undefined : integer(record.expectedDurationMin, `${path}.expectedDurationMin`, 1, 720),
    notes: optionalText(record.notes, `${path}.notes`, 500),
  }
}

function parsePreferredTrainingDays(value: unknown, path: string, minimumItems: number): PreferredTrainingDay[] {
  if (!Array.isArray(value)) fail(path, 'Expected an array.')
  if (value.length < minimumItems || value.length > 7) fail(path, `Expected between ${minimumItems} and 7 items.`)
  const days = value.map((entry, index) => parsePreferredTrainingDay(entry, `${path}[${index}]`))
  const dayKeys = days.map(day => String(day.dayOfWeek))
  if (new Set(dayKeys).size !== dayKeys.length) fail(path, 'Preferred training days must be unique.')
  return days
}

function parseEquipmentDetail(value: unknown, path: string): EquipmentDetail {
  const record = asObject(value, path)
  expectExactKeys(record, ['id', 'label', 'constraints', 'notes'], path)
  return {
    id: parseStableIdentity(record.id, `${path}.id`),
    label: text(record.label, `${path}.label`, 1, 80),
    constraints: textList(record.constraints, `${path}.constraints`, 0, 12, 120),
    notes: optionalText(record.notes, `${path}.notes`, 500),
  }
}

function parseEquipmentDetails(value: unknown, path: string, minimumItems: number): EquipmentDetail[] {
  if (!Array.isArray(value)) fail(path, 'Expected an array.')
  if (value.length < minimumItems || value.length > 24) fail(path, `Expected between ${minimumItems} and 24 items.`)
  const details = value.map((entry, index) => parseEquipmentDetail(entry, `${path}[${index}]`))
  assertUniqueStableIdentities(details.map(detail => detail.id), path)
  return details
}

function parseRecurringClubSession(value: unknown, path: string): RecurringClubSession {
  const record = asObject(value, path)
  expectExactKeys(record, ['id', 'title', 'scope', 'category', 'dayOfWeek', 'startTime', 'durationMin', 'notes'], path)
  return {
    id: parseStableIdentity(record.id, `${path}.id`),
    title: text(record.title, `${path}.title`, 1, 120),
    scope: optionalText(record.scope, `${path}.scope`, 120),
    category: record.category === undefined ? undefined : parseWorkoutCategory(record.category, `${path}.category`),
    dayOfWeek: integer(record.dayOfWeek, `${path}.dayOfWeek`, 0, 6),
    startTime: parseClockTime(record.startTime, `${path}.startTime`),
    durationMin: record.durationMin === undefined ? undefined : integer(record.durationMin, `${path}.durationMin`, 1, 1_440),
    notes: optionalText(record.notes, `${path}.notes`, 500),
  }
}

function parseRecurringClubSessions(value: unknown, path: string): RecurringClubSession[] {
  if (!Array.isArray(value)) fail(path, 'Expected an array.')
  if (value.length > 14) fail(path, 'Expected at most 14 recurring club sessions.')
  const sessions = value.map((entry, index) => parseRecurringClubSession(entry, `${path}[${index}]`))
  assertUniqueStableIdentities(sessions.map(session => session.id), path)
  return sessions
}

function parseWorkoutStepTarget(value: unknown, path: string): WorkoutStepTarget {
  const record = asObject(value, path)
  expectExactKeys(record, ['sets', 'reps', 'seconds', 'minutes', 'distanceMeters', 'loadKg', 'effort'], path)
  const target: WorkoutStepTarget = {}
  if (record.sets !== undefined) target.sets = integer(record.sets, `${path}.sets`, 1, 100)
  if (record.reps !== undefined) target.reps = integer(record.reps, `${path}.reps`, 1, 1_000)
  if (record.seconds !== undefined) target.seconds = integer(record.seconds, `${path}.seconds`, 1, 21_600)
  if (record.minutes !== undefined) target.minutes = integer(record.minutes, `${path}.minutes`, 1, 720)
  if (record.distanceMeters !== undefined) target.distanceMeters = integer(record.distanceMeters, `${path}.distanceMeters`, 1, 500_000)
  if (record.loadKg !== undefined) target.loadKg = numeric(record.loadKg, `${path}.loadKg`, 0, 1_000)
  if (record.effort !== undefined) {
    if (typeof record.effort !== 'string' || !workoutEfforts.has(record.effort as WorkoutEffort)) {
      fail(`${path}.effort`, 'Expected a supported effort.')
    }
    target.effort = record.effort as WorkoutEffort
  }
  if (!Object.keys(target).length) fail(path, 'Targets must include at least one field.')
  return target
}

function parseWorkoutStep(value: unknown, path: string): WorkoutStep {
  const record = asObject(value, path)
  expectExactKeys(record, ['id', 'title', 'detail', 'equipment', 'target'], path)
  return {
    id: parseStableIdentity(record.id, `${path}.id`),
    title: text(record.title, `${path}.title`, 1, 120),
    detail: optionalText(record.detail, `${path}.detail`, 2_000),
    equipment: record.equipment === undefined ? undefined : textList(record.equipment, `${path}.equipment`, 0, 16, 80),
    target: record.target === undefined ? undefined : parseWorkoutStepTarget(record.target, `${path}.target`),
  }
}

function parseWorkoutSteps(value: unknown, path: string): WorkoutStep[] {
  if (!Array.isArray(value)) fail(path, 'Expected an array.')
  if (value.length > 32) fail(path, 'Expected at most 32 steps.')
  return value.map((entry, index) => parseWorkoutStep(entry, `${path}[${index}]`))
}

function parseFixedClubSession(value: unknown, path: string): FixedClubSession {
  const record = asObject(value, path)
  expectExactKeys(record, ['recurringSessionId', 'title', 'scope', 'category', 'dayOfWeek', 'startTime', 'durationMin'], path)
  return {
    recurringSessionId: parseStableIdentity(record.recurringSessionId, `${path}.recurringSessionId`),
    title: text(record.title, `${path}.title`, 1, 120),
    scope: text(record.scope, `${path}.scope`, 1, 120),
    category: parseWorkoutCategory(record.category, `${path}.category`),
    dayOfWeek: integer(record.dayOfWeek, `${path}.dayOfWeek`, 0, 6),
    startTime: parseClockTime(record.startTime, `${path}.startTime`),
    durationMin: integer(record.durationMin, `${path}.durationMin`, 1, 1_440),
  }
}

function parseWorkoutInternal(value: unknown, path: string): Workout {
  const record = versionedRecord(
    value,
    path,
    ['version', 'id', 'athleteId', 'weekPlanId', 'scheduledDate', 'startTime', 'category', 'source', 'title', 'purpose', 'expectedDurationMin', 'warmup', 'main', 'cooldown', 'fixedClubSession', 'notes'],
  )
  if (typeof record.source !== 'string' || !workoutSources.has(record.source as WorkoutSource)) {
    fail(`${path}.source`, 'Expected a supported workout source.')
  }
  const workout: Workout = {
    version: DOMAIN_VERSION,
    id: parseStableIdentity(record.id, `${path}.id`),
    athleteId: parseStableIdentity(record.athleteId, `${path}.athleteId`),
    weekPlanId: parseStableIdentity(record.weekPlanId, `${path}.weekPlanId`),
    scheduledDate: parseLocalDate(record.scheduledDate, `${path}.scheduledDate`),
    startTime: record.startTime === undefined ? undefined : parseClockTime(record.startTime, `${path}.startTime`),
    category: parseWorkoutCategory(record.category, `${path}.category`),
    source: record.source as WorkoutSource,
    title: text(record.title, `${path}.title`, 1, 120),
    purpose: text(record.purpose, `${path}.purpose`, 1, 500),
    expectedDurationMin: integer(record.expectedDurationMin, `${path}.expectedDurationMin`, 1, 720),
    warmup: parseWorkoutSteps(record.warmup, `${path}.warmup`),
    main: parseWorkoutSteps(record.main, `${path}.main`),
    cooldown: parseWorkoutSteps(record.cooldown, `${path}.cooldown`),
    fixedClubSession: record.fixedClubSession === undefined ? undefined : parseFixedClubSession(record.fixedClubSession, `${path}.fixedClubSession`),
    notes: optionalText(record.notes, `${path}.notes`, 2_000),
  }
  if (!workout.main.length) fail(`${path}.main`, 'At least one main step is required.')
  assertUniqueStableIdentities([...workout.warmup, ...workout.main, ...workout.cooldown].map(step => step.id), `${path} step`)
  if (workout.source === 'club') {
    if (!workout.fixedClubSession) fail(`${path}.fixedClubSession`, 'Club workouts require fixed club metadata.')
    if (workout.fixedClubSession.category !== workout.category) {
      fail(`${path}.fixedClubSession.category`, 'Fixed club metadata must match the workout category.')
    }
    if (workout.fixedClubSession.dayOfWeek !== localDateDayOfWeek(workout.scheduledDate)) {
      fail(`${path}.fixedClubSession.dayOfWeek`, 'Fixed club metadata must match the scheduled workout day.')
    }
    if (workout.startTime !== undefined && workout.startTime !== workout.fixedClubSession.startTime) {
      fail(`${path}.startTime`, 'Club workout startTime must match its fixed club metadata.')
    }
    if (workout.expectedDurationMin !== workout.fixedClubSession.durationMin) {
      fail(`${path}.expectedDurationMin`, 'Club workout duration must match its fixed club metadata.')
    }
  } else if (workout.fixedClubSession) {
    fail(`${path}.fixedClubSession`, 'Only club workouts can include fixed club metadata.')
  }
  return workout
}

function parseWorkoutLogMetrics(value: unknown, path: string): WorkoutLogMetrics {
  const record = asObject(value, path)
  expectExactKeys(record, ['durationMin', 'movingTimeMin', 'elapsedTimeMin', 'distanceMeters', 'paceSecondsPerKm', 'averageHeartRate'], path)
  const metrics: WorkoutLogMetrics = {}
  if (record.durationMin !== undefined) metrics.durationMin = integer(record.durationMin, `${path}.durationMin`, 0, 1_440)
  if (record.movingTimeMin !== undefined) metrics.movingTimeMin = integer(record.movingTimeMin, `${path}.movingTimeMin`, 0, 1_440)
  if (record.elapsedTimeMin !== undefined) metrics.elapsedTimeMin = integer(record.elapsedTimeMin, `${path}.elapsedTimeMin`, 0, 1_440)
  if (record.distanceMeters !== undefined) metrics.distanceMeters = integer(record.distanceMeters, `${path}.distanceMeters`, 0, 500_000)
  if (record.paceSecondsPerKm !== undefined) metrics.paceSecondsPerKm = integer(record.paceSecondsPerKm, `${path}.paceSecondsPerKm`, 60, 7_200)
  if (record.averageHeartRate !== undefined) metrics.averageHeartRate = integer(record.averageHeartRate, `${path}.averageHeartRate`, 20, 260)
  if (!Object.keys(metrics).length) fail(path, 'Metrics must include at least one field.')
  return metrics
}

function parseWorkoutLogStep(value: unknown, path: string): WorkoutLogStep {
  const record = asObject(value, path)
  expectExactKeys(record, ['stepId', 'completedSets', 'completedReps', 'completedSeconds', 'completedMinutes', 'completedDistanceMeters', 'completedPaceSecondsPerKm', 'loadKg', 'notes'], path)
  const step: WorkoutLogStep = {
    stepId: parseStableIdentity(record.stepId, `${path}.stepId`),
    notes: optionalText(record.notes, `${path}.notes`, 2_000),
  }
  if (record.completedSets !== undefined) step.completedSets = integer(record.completedSets, `${path}.completedSets`, 0, 100)
  if (record.completedReps !== undefined) step.completedReps = integer(record.completedReps, `${path}.completedReps`, 0, 1_000)
  if (record.completedSeconds !== undefined) step.completedSeconds = integer(record.completedSeconds, `${path}.completedSeconds`, 0, 21_600)
  if (record.completedMinutes !== undefined) step.completedMinutes = integer(record.completedMinutes, `${path}.completedMinutes`, 0, 1_440)
  if (record.completedDistanceMeters !== undefined) {
    step.completedDistanceMeters = integer(record.completedDistanceMeters, `${path}.completedDistanceMeters`, 0, 500_000)
  }
  if (record.completedPaceSecondsPerKm !== undefined) {
    step.completedPaceSecondsPerKm = integer(record.completedPaceSecondsPerKm, `${path}.completedPaceSecondsPerKm`, 60, 7_200)
  }
  if (record.loadKg !== undefined) step.loadKg = numeric(record.loadKg, `${path}.loadKg`, 0, 1_000)
  if (Object.keys(step).length === 1 && step.notes === undefined) {
    fail(path, 'Each log step needs actual values or notes.')
  }
  return step
}

function parseWorkoutLogSteps(value: unknown, path: string): WorkoutLogStep[] {
  if (!Array.isArray(value)) fail(path, 'Expected an array.')
  if (value.length > 32) fail(path, 'Expected at most 32 logged steps.')
  const steps = value.map((entry, index) => parseWorkoutLogStep(entry, `${path}[${index}]`))
  assertUniqueStableIdentities(steps.map(step => step.stepId), `${path} step`)
  return steps
}

function parseWorkoutMap(weekPlan: WeekPlan): Map<string, Workout> {
  return new Map(weekPlan.workouts.map(workout => [workout.id, workout]))
}

function validateWeekPlanRelationships(weekPlan: WeekPlan, path: string): WeekPlan {
  assertUniqueStableIdentities(weekPlan.workouts.map(workout => workout.id), `${path} workout`)
  for (const [index, workout] of weekPlan.workouts.entries()) {
    if (workout.athleteId !== weekPlan.athleteId) {
      fail(`${path}.workouts[${index}].athleteId`, 'Workout athleteId must match the week plan athleteId.')
    }
    if (workout.weekPlanId !== weekPlan.id) {
      fail(`${path}.workouts[${index}].weekPlanId`, 'Workout weekPlanId must match the parent week plan id.')
    }
    if (!isDateInRollingWeek(workout.scheduledDate, weekPlan.weekStart)) {
      fail(`${path}.workouts[${index}].scheduledDate`, 'Workout dates must stay inside the seven-day plan window.')
    }
  }
  return weekPlan
}

function validateWorkoutLogAgainstWeekPlan(log: WorkoutLog, weekPlan: WeekPlan, path: string): void {
  if (log.athleteId !== weekPlan.athleteId) fail(`${path}.athleteId`, 'Workout log athleteId must match the week plan athleteId.')
  if (log.weekPlanId !== weekPlan.id) fail(`${path}.weekPlanId`, 'Workout log weekPlanId must match the parent week plan id.')
  if (!isDateInRollingWeek(log.loggedOn, weekPlan.weekStart)) fail(`${path}.loggedOn`, 'Workout log dates must stay inside the seven-day plan window.')
  const workout = parseWorkoutMap(weekPlan).get(log.workoutId)
  if (!workout) fail(`${path}.workoutId`, 'Workout log workoutId must reference a workout in the same week plan.')
  const stepIds = new Set([...workout.warmup, ...workout.main, ...workout.cooldown].map(step => step.id))
  for (const [index, step] of log.steps.entries()) {
    if (!stepIds.has(step.stepId)) fail(`${path}.steps[${index}].stepId`, 'Workout log steps must reference the planned workout steps.')
  }
}

export function validateWorkoutLogsForWeekPlan(weekPlan: WeekPlan, workoutLogs: WorkoutLog[], path = 'WorkoutLogs'): WorkoutLog[] {
  assertUniqueStableIdentities(workoutLogs.map(log => log.id), path)
  for (const [index, log] of workoutLogs.entries()) {
    validateWorkoutLogAgainstWeekPlan(log, weekPlan, `${path}[${index}]`)
  }
  return workoutLogs
}

export function parseAthleteProfile(value: unknown): AthleteProfile {
  const record = versionedRecord(
    value,
    'AthleteProfile',
    ['version', 'id', 'createdOn', 'updatedOn', 'name', 'goal', 'goalDate', 'sports', 'preferredWeeklyStructure', 'strengthPreference', 'equipmentDetails', 'constraints', 'clubSessions', 'notes'],
  )
  const athlete: AthleteProfile = {
    version: DOMAIN_VERSION,
    id: parseStableIdentity(record.id, 'AthleteProfile.id'),
    createdOn: parseLocalDate(record.createdOn, 'AthleteProfile.createdOn'),
    updatedOn: parseLocalDate(record.updatedOn, 'AthleteProfile.updatedOn'),
    name: text(record.name, 'AthleteProfile.name', 1, 120),
    goal: text(record.goal, 'AthleteProfile.goal', 1, 500),
    goalDate: record.goalDate === undefined ? undefined : parseLocalDate(record.goalDate, 'AthleteProfile.goalDate'),
    sports: textList(record.sports, 'AthleteProfile.sports', 1, 12, 80),
    preferredWeeklyStructure: parsePreferredTrainingDays(record.preferredWeeklyStructure, 'AthleteProfile.preferredWeeklyStructure', 0),
    strengthPreference: record.strengthPreference === undefined ? undefined : parseStrengthPreference(record.strengthPreference, 'AthleteProfile.strengthPreference'),
    equipmentDetails: parseEquipmentDetails(record.equipmentDetails, 'AthleteProfile.equipmentDetails', 0),
    constraints: textList(record.constraints, 'AthleteProfile.constraints', 0, 24, 120),
    clubSessions: parseRecurringClubSessions(record.clubSessions, 'AthleteProfile.clubSessions'),
    notes: optionalText(record.notes, 'AthleteProfile.notes', 2_000),
  }
  if (!athlete.preferredWeeklyStructure.length && !athlete.clubSessions.length) {
    fail('AthleteProfile.preferredWeeklyStructure', 'Add at least one preferred training day or recurring club session.')
  }
  if (compareLocalDates(athlete.createdOn, athlete.updatedOn) < 0) {
    fail('AthleteProfile.updatedOn', 'updatedOn cannot be earlier than createdOn.')
  }
  return athlete
}

export function parseWorkout(value: unknown): Workout {
  return parseWorkoutInternal(value, 'Workout')
}

export function parseWeekPlan(value: unknown): WeekPlan {
  const record = versionedRecord(
    value,
    'WeekPlan',
    ['version', 'id', 'athleteId', 'weekStart', 'title', 'goal', 'workouts', 'notes'],
  )
  if (!Array.isArray(record.workouts) || !record.workouts.length) fail('WeekPlan.workouts', 'At least one workout is required.')
  const weekPlan: WeekPlan = {
    version: DOMAIN_VERSION,
    id: parseStableIdentity(record.id, 'WeekPlan.id'),
    athleteId: parseStableIdentity(record.athleteId, 'WeekPlan.athleteId'),
    weekStart: parseLocalDate(record.weekStart, 'WeekPlan.weekStart'),
    title: text(record.title, 'WeekPlan.title', 1, 120),
    goal: text(record.goal, 'WeekPlan.goal', 1, 500),
    workouts: record.workouts.map((entry, index) => parseWorkoutInternal(entry, `WeekPlan.workouts[${index}]`)),
    notes: optionalText(record.notes, 'WeekPlan.notes', 2_000),
  }
  if (weekPlan.workouts.length > 28) fail('WeekPlan.workouts', 'Expected at most 28 workouts per week.')
  return validateWeekPlanRelationships(weekPlan, 'WeekPlan')
}

export function parseWorkoutLog(value: unknown): WorkoutLog {
  const record = versionedRecord(
    value,
    'WorkoutLog',
    ['version', 'id', 'athleteId', 'weekPlanId', 'workoutId', 'loggedOn', 'outcome', 'effortRating', 'metrics', 'steps', 'notes'],
  )
  if (typeof record.outcome !== 'string' || !workoutOutcomes.has(record.outcome as WorkoutLogOutcome)) {
    fail('WorkoutLog.outcome', 'Expected a supported workout log outcome.')
  }
  const log: WorkoutLog = {
    version: DOMAIN_VERSION,
    id: parseStableIdentity(record.id, 'WorkoutLog.id'),
    athleteId: parseStableIdentity(record.athleteId, 'WorkoutLog.athleteId'),
    weekPlanId: parseStableIdentity(record.weekPlanId, 'WorkoutLog.weekPlanId'),
    workoutId: parseStableIdentity(record.workoutId, 'WorkoutLog.workoutId'),
    loggedOn: parseLocalDate(record.loggedOn, 'WorkoutLog.loggedOn'),
    outcome: record.outcome as WorkoutLogOutcome,
    effortRating: record.effortRating === undefined ? undefined : integer(record.effortRating, 'WorkoutLog.effortRating', 1, 10),
    metrics: record.metrics === undefined ? undefined : parseWorkoutLogMetrics(record.metrics, 'WorkoutLog.metrics'),
    steps: parseWorkoutLogSteps(record.steps, 'WorkoutLog.steps'),
    notes: optionalText(record.notes, 'WorkoutLog.notes', 2_000),
  }
  if (!log.steps.length && log.metrics === undefined && log.effortRating === undefined && log.notes === undefined) {
    fail('WorkoutLog', 'Logs need steps, metrics, effort, or notes.')
  }
  return log
}

export function parseOnboardingDraft(value: unknown): OnboardingDraft {
  const record = versionedRecord(
    value,
    'OnboardingDraft',
    ['version', 'id', 'athleteId', 'createdOn', 'updatedOn', 'startingWeek', 'name', 'goal', 'goalDate', 'sports', 'preferredWeeklyStructure', 'strengthPreference', 'equipmentDetails', 'constraints', 'clubSessions', 'notes'],
  )
  const draft: OnboardingDraft = {
    version: DOMAIN_VERSION,
    id: parseStableIdentity(record.id, 'OnboardingDraft.id'),
    athleteId: parseStableIdentity(record.athleteId, 'OnboardingDraft.athleteId'),
    createdOn: parseLocalDate(record.createdOn, 'OnboardingDraft.createdOn'),
    updatedOn: parseLocalDate(record.updatedOn, 'OnboardingDraft.updatedOn'),
    startingWeek: parseLocalDate(record.startingWeek, 'OnboardingDraft.startingWeek'),
    name: optionalText(record.name, 'OnboardingDraft.name', 120),
    goal: text(record.goal, 'OnboardingDraft.goal', 1, 500),
    goalDate: record.goalDate === undefined ? undefined : parseLocalDate(record.goalDate, 'OnboardingDraft.goalDate'),
    sports: textList(record.sports, 'OnboardingDraft.sports', 0, 12, 80),
    preferredWeeklyStructure: parsePreferredTrainingDays(record.preferredWeeklyStructure, 'OnboardingDraft.preferredWeeklyStructure', 0),
    strengthPreference: record.strengthPreference === undefined ? undefined : parseStrengthPreference(record.strengthPreference, 'OnboardingDraft.strengthPreference'),
    equipmentDetails: parseEquipmentDetails(record.equipmentDetails, 'OnboardingDraft.equipmentDetails', 0),
    constraints: textList(record.constraints, 'OnboardingDraft.constraints', 0, 24, 120),
    clubSessions: parseRecurringClubSessions(record.clubSessions, 'OnboardingDraft.clubSessions'),
    notes: optionalText(record.notes, 'OnboardingDraft.notes', 2_000),
  }
  if (compareLocalDates(draft.createdOn, draft.updatedOn) < 0) {
    fail('OnboardingDraft.updatedOn', 'updatedOn cannot be earlier than createdOn.')
  }
  if (draft.goalDate && compareLocalDates(draft.startingWeek, draft.goalDate) < 0) {
    fail('OnboardingDraft.goalDate', 'goalDate cannot be earlier than startingWeek.')
  }
  return draft
}

export function parseWeekImportBundle(input: { weekPlan: unknown; workoutLogs?: unknown }): WeekImportBundle {
  const weekPlan = parseWeekPlan(input.weekPlan)
  const workoutLogs = input.workoutLogs === undefined
    ? []
    : Array.isArray(input.workoutLogs)
      ? input.workoutLogs.map(log => parseWorkoutLog(log))
      : fail('WeekImportBundle.workoutLogs', 'Expected an array.')
  validateWorkoutLogsForWeekPlan(weekPlan, workoutLogs, 'WeekImportBundle.workoutLogs')
  return { weekPlan, workoutLogs }
}

export function parseBackupEnvelope(value: unknown): BackupEnvelope {
  const record = versionedRecord(
    value,
    'BackupEnvelope',
    ['version', 'exportedAt', 'athleteProfiles', 'weekPlans', 'workoutLogs', 'onboardingDrafts'],
  )
  const athleteProfiles = Array.isArray(record.athleteProfiles)
    ? record.athleteProfiles.map(profile => parseAthleteProfile(profile))
    : fail('BackupEnvelope.athleteProfiles', 'Expected an array.')
  const weekPlans = Array.isArray(record.weekPlans)
    ? record.weekPlans.map(weekPlan => parseWeekPlan(weekPlan))
    : fail('BackupEnvelope.weekPlans', 'Expected an array.')
  const workoutLogs = Array.isArray(record.workoutLogs)
    ? record.workoutLogs.map(log => parseWorkoutLog(log))
    : fail('BackupEnvelope.workoutLogs', 'Expected an array.')
  const onboardingDrafts = Array.isArray(record.onboardingDrafts)
    ? record.onboardingDrafts.map(draft => parseOnboardingDraft(draft))
    : fail('BackupEnvelope.onboardingDrafts', 'Expected an array.')

  assertUniqueStableIdentities(athleteProfiles.map(profile => profile.id), 'BackupEnvelope.athleteProfiles')
  assertUniqueStableIdentities(weekPlans.map(plan => plan.id), 'BackupEnvelope.weekPlans')
  assertUniqueStableIdentities(workoutLogs.map(log => log.id), 'BackupEnvelope.workoutLogs')
  assertUniqueStableIdentities(onboardingDrafts.map(draft => draft.id), 'BackupEnvelope.onboardingDrafts')

  const athletes = new Set(athleteProfiles.map(profile => profile.id))
  const weeks = new Map(weekPlans.map(plan => [plan.id, plan]))

  for (const [index, plan] of weekPlans.entries()) {
    if (!athletes.has(plan.athleteId)) fail(`BackupEnvelope.weekPlans[${index}].athleteId`, 'Week plans must reference a saved athlete profile.')
  }
  for (const [index, draft] of onboardingDrafts.entries()) {
    if (!athletes.has(draft.athleteId)) fail(`BackupEnvelope.onboardingDrafts[${index}].athleteId`, 'Drafts must reference a saved athlete profile.')
  }
  for (const [index, log] of workoutLogs.entries()) {
    const week = weeks.get(log.weekPlanId)
    if (!week) fail(`BackupEnvelope.workoutLogs[${index}].weekPlanId`, 'Workout logs must reference a saved week plan.')
    if (!athletes.has(log.athleteId)) fail(`BackupEnvelope.workoutLogs[${index}].athleteId`, 'Workout logs must reference a saved athlete profile.')
    validateWorkoutLogAgainstWeekPlan(log, week, `BackupEnvelope.workoutLogs[${index}]`)
  }

  return {
    version: DOMAIN_VERSION,
    exportedAt: parseIsoTimestamp(record.exportedAt, 'BackupEnvelope.exportedAt'),
    athleteProfiles,
    weekPlans,
    workoutLogs,
    onboardingDrafts,
  }
}

export function createBackupEnvelope(input: {
  athleteProfiles?: AthleteProfile[]
  weekPlans?: WeekPlan[]
  workoutLogs?: WorkoutLog[]
  onboardingDrafts?: OnboardingDraft[]
  exportedAt?: string
}): BackupEnvelope {
  return parseBackupEnvelope({
    version: DOMAIN_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    athleteProfiles: input.athleteProfiles ?? [],
    weekPlans: input.weekPlans ?? [],
    workoutLogs: input.workoutLogs ?? [],
    onboardingDrafts: input.onboardingDrafts ?? [],
  })
}

export function weekPlanEnd(weekPlan: WeekPlan): LocalDateString {
  return addDaysToLocalDate(weekPlan.weekStart, 6)
}
