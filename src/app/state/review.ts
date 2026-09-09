import type { PreviousWeekContext } from '../../ai/index.ts'
import {
  parseWeekPlan,
  parseWorkoutLog,
  validateWorkoutLogsForWeekPlan,
  type WeekPlan,
  type Workout,
  type WorkoutLog,
  type WorkoutLogMetrics,
  type WorkoutLogStep,
} from '../../domain/contracts.ts'
import { parseStableIdentity } from '../../domain/identity.ts'
import { addDaysToLocalDate, parseLocalDate } from '../../domain/local-date.ts'
import type {
  FormMessage,
  WeeklyMetricDraft,
  WeeklyReviewDraft,
  WorkoutCompletionStatus,
  WorkoutLogStepResultDraft,
  WorkoutStepResultStatus,
} from '../features/models.ts'
import type { WeeklyReviewScreenProps } from '../features/weeklyReviewScreen.ts'
import type { WorkoutLogScreenProps } from '../features/workoutLogScreen.ts'
import { buildContinuationWeekContext, type TrackedWorkoutChange } from './ai-handoff.ts'

const STEP_STATUS_PREFIX = 'Step status: '
const STEP_EFFORT_PREFIX = 'Step effort RPE: '
const WORKOUT_OUTCOMES = new Set<WorkoutCompletionStatus>(['completed', 'partial', 'skipped'])
const STEP_OUTCOMES = new Set<WorkoutStepResultStatus>(['unrecorded', 'done', 'trimmed', 'skipped'])

export type WorkoutReviewErrorCode =
  | 'invalid-review'
  | 'invalid-review-field'
  | 'invalid-workout-log'
  | 'missing-log'
  | 'missing-workout'

export class WorkoutReviewError extends Error {
  readonly code: WorkoutReviewErrorCode
  readonly path?: string

  constructor(code: WorkoutReviewErrorCode, message: string, path?: string) {
    super(message)
    this.name = 'WorkoutReviewError'
    this.code = code
    this.path = path
  }
}

export interface WorkoutReviewIssue {
  readonly id: string
  readonly scope: 'workout' | 'weekly-review'
  readonly workoutId?: string
  readonly field: string
  readonly message: string
}

export interface WorkoutReviewValidation {
  readonly issues: readonly WorkoutReviewIssue[]
  readonly workoutIssuesById: Readonly<Record<string, readonly WorkoutReviewIssue[]>>
  readonly weeklyReviewIssues: readonly WorkoutReviewIssue[]
}

export interface WorkoutReviewSummary {
  readonly total: number
  readonly logged: number
  readonly completed: number
  readonly partial: number
  readonly skipped: number
  readonly unlogged: number
  readonly changes: Readonly<{
    moved: number
    added: number
    deleted: number
  }>
}

export interface WorkoutReviewStepActualValues {
  readonly sets?: number
  readonly reps?: number
  readonly seconds?: number
  readonly minutes?: number
  readonly distanceMeters?: number
  readonly paceSecondsPerKm?: number
  readonly loadKg?: number
}

export interface ValidatedWeeklyMetric {
  readonly id: string
  readonly label: string
  readonly planned?: string
  readonly completed?: string
  readonly note?: string
}

export interface ValidatedWeeklyReview {
  readonly weekLabel?: string
  readonly reflection?: string
  readonly energy?: number
  readonly recovery?: number
  readonly wins?: string
  readonly blockers?: string
  readonly nextFocus?: string
  readonly coachNotes?: string
  readonly metrics: readonly ValidatedWeeklyMetric[]
}

export interface WorkoutReviewLogDraft {
  readonly logId: string
  readonly performedOn: string
  readonly completionStatus: WorkoutCompletionStatus
  readonly sessionRpe: string
  readonly actualSummary: string
  readonly notes: string
  readonly stepResults: readonly WorkoutLogStepResultDraft[]
}

export interface WorkoutReviewWorkoutState {
  readonly workout: Workout
  readonly logHistory: readonly WorkoutLog[]
  readonly changeHistory: readonly TrackedWorkoutChange[]
  readonly isLogged: boolean
  readonly draft: WorkoutReviewLogDraft
  readonly hydrationMessages: readonly FormMessage[]
}

export interface WorkoutReviewState {
  readonly weekPlan: WeekPlan
  readonly sourceLogs: readonly WorkoutLog[]
  readonly trackedChanges: readonly TrackedWorkoutChange[]
  readonly workouts: readonly WorkoutReviewWorkoutState[]
  readonly weeklyReview: Readonly<{
    draft: WeeklyReviewDraft
    metrics: readonly WeeklyMetricDraft[]
    editedMetricFields?: Readonly<Record<string, readonly WeeklyMetricField[]>>
  }>
}

export interface CreateWorkoutReviewStateInput {
  readonly weekPlan: WeekPlan
  readonly workoutLogs?: readonly WorkoutLog[]
  readonly trackedChanges?: readonly TrackedWorkoutChange[]
}

export interface WorkoutReviewPayload {
  readonly weekPlan: WeekPlan
  readonly workoutLogs: readonly WorkoutLog[]
  readonly trackedChanges: readonly TrackedWorkoutChange[]
  readonly summary: WorkoutReviewSummary
  readonly review: ValidatedWeeklyReview
  readonly previousWeek: PreviousWeekContext
}

export interface WorkoutReviewLogScreenAdapterProps extends WorkoutLogScreenProps {
  readonly workoutId: string
  readonly workout: Workout
  readonly hasLog: boolean
  readonly historyCount: number
  readonly changeHistory: readonly TrackedWorkoutChange[]
}

export interface WeeklyReviewScreenAdapterProps extends WeeklyReviewScreenProps {
  readonly summary: WorkoutReviewSummary
}

type WorkoutLogEditableField = Exclude<keyof WorkoutLogStepResultDraft, 'id' | 'title'>
type WeeklyMetricField = Exclude<keyof WeeklyMetricDraft, 'id' | 'label'>
type WeeklyReviewField = keyof WeeklyReviewDraft

export type WorkoutReviewAction =
  | { readonly type: 'startWorkoutLog'; readonly workoutId: string; readonly outcome?: WorkoutCompletionStatus }
  | { readonly type: 'setWorkoutCompletionStatus'; readonly workoutId: string; readonly value: WorkoutCompletionStatus }
  | { readonly type: 'setWorkoutSessionRpe'; readonly workoutId: string; readonly value: string }
  | { readonly type: 'setWorkoutActualSummary'; readonly workoutId: string; readonly value: string }
  | { readonly type: 'setWorkoutNotes'; readonly workoutId: string; readonly value: string }
  | { readonly type: 'setWorkoutStepResultField'; readonly workoutId: string; readonly stepId: string; readonly field: WorkoutLogEditableField; readonly value: string }
  | { readonly type: 'setWeeklyReviewField'; readonly field: WeeklyReviewField; readonly value: string }
  | { readonly type: 'setWeeklyMetricField'; readonly metricId: string; readonly field: WeeklyMetricField; readonly value: string }

function reviewError(code: WorkoutReviewErrorCode, message: string, path?: string): WorkoutReviewError {
  return new WorkoutReviewError(code, message, path)
}

function asReviewError(code: WorkoutReviewErrorCode, path: string, error: unknown, fallback: string): WorkoutReviewError {
  if (error instanceof WorkoutReviewError) return error
  if (error instanceof Error) return new WorkoutReviewError(code, error.message, path)
  return new WorkoutReviewError(code, fallback, path)
}

function issueId(scope: 'workout' | 'weekly-review', field: string, workoutId?: string): string {
  const scopeId = workoutId ?? 'review'
  return `${scope}-${scopeId}-${field}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
}

function createIssue(
  scope: 'workout' | 'weekly-review',
  field: string,
  message: string,
  workoutId?: string,
): WorkoutReviewIssue {
  return {
    id: issueId(scope, field, workoutId),
    scope,
    workoutId,
    field,
    message,
  }
}

function asMessage(error: WorkoutReviewIssue): FormMessage {
  return {
    id: error.id,
    tone: 'error',
    text: error.message,
  }
}

function textMessage(id: string, tone: FormMessage['tone'], text: string): FormMessage {
  return { id, tone, text }
}

function normalizeFreeText(value: string | undefined): string {
  return value?.trim() ?? ''
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = normalizeFreeText(value)
  return normalized ? normalized : undefined
}

function parseIntegerString(value: string, label: string, minimum: number, maximum: number): number {
  if (!/^-?\d+$/.test(value.trim())) {
    throw reviewError('invalid-review-field', `${label} must be a whole number.`, label)
  }
  const parsed = Number(value.trim())
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw reviewError('invalid-review-field', `${label} must be between ${minimum} and ${maximum}.`, label)
  }
  return parsed
}

function parseNumericString(value: string, label: string, minimum: number, maximum: number): number {
  if (!/^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    throw reviewError('invalid-review-field', `${label} must be numeric.`, label)
  }
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw reviewError('invalid-review-field', `${label} must be between ${minimum} and ${maximum}.`, label)
  }
  return parsed
}

const PACE_PATTERN = /^(?:(\d+):)?(\d+):([0-5]\d)\/km$/i

function formatPaceSecondsPerKm(secondsPerKm: number): string {
  const hours = Math.floor(secondsPerKm / 3_600)
  const minutes = Math.floor((secondsPerKm % 3_600) / 60)
  const seconds = secondsPerKm % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}/km`
  return `${minutes}:${String(seconds).padStart(2, '0')}/km`
}

function parsePaceSecondsPerKm(value: string, label: string): number {
  const normalized = value.trim()
  const match = PACE_PATTERN.exec(normalized)
  if (!match) throw reviewError('invalid-review-field', `${label} must use M:SS/km or H:MM:SS/km pace format.`, label)
  const [, hoursText, middleText, secondsText] = match
  const seconds = Number(secondsText)
  if (hoursText === undefined) {
    const minutes = Number(middleText)
    const total = (minutes * 60) + seconds
    if (total < 60 || total > 7_200) throw reviewError('invalid-review-field', `${label} must be between 1:00/km and 2:00:00/km.`, label)
    return total
  }
  const hours = Number(hoursText)
  const minutes = Number(middleText)
  if (minutes > 59) throw reviewError('invalid-review-field', `${label} must use valid H:MM:SS/km pace format.`, label)
  const total = (hours * 3_600) + (minutes * 60) + seconds
  if (total < 60 || total > 7_200) throw reviewError('invalid-review-field', `${label} must be between 1:00/km and 2:00:00/km.`, label)
  return total
}

interface StructuredFieldDefinition<T> {
  readonly canonical: string
  readonly aliases: readonly string[]
  readonly parse: (value: string, label: string) => T
}

function normalizeStructuredKey(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}

function parseStructuredText(
  text: string,
  field: string,
  definitions: readonly StructuredFieldDefinition<unknown>[],
): Map<string, unknown> {
  const normalized = normalizeFreeText(text)
  if (!normalized) return new Map()
  const definitionByAlias = new Map<string, StructuredFieldDefinition<unknown>>()
  for (const definition of definitions) {
    definitionByAlias.set(normalizeStructuredKey(definition.canonical), definition)
    for (const alias of definition.aliases) definitionByAlias.set(normalizeStructuredKey(alias), definition)
  }
  const values = new Map<string, unknown>()
  const supported = definitions.map(definition => definition.canonical).join(', ')
  const lines = normalized.split(/\r?\n/)
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim()
    if (!line) continue
    const separatorIndex = line.indexOf(':')
    if (separatorIndex <= 0 || separatorIndex === line.length - 1) {
      throw reviewError('invalid-review-field', `${field} line ${index + 1} must use "key: value". Supported keys: ${supported}.`, field)
    }
    const rawKey = line.slice(0, separatorIndex).trim()
    const rawValue = line.slice(separatorIndex + 1).trim()
    const definition = definitionByAlias.get(normalizeStructuredKey(rawKey))
    if (!definition) {
      throw reviewError('invalid-review-field', `Unsupported ${field} key "${rawKey}". Supported keys: ${supported}.`, field)
    }
    if (values.has(definition.canonical)) {
      throw reviewError('invalid-review-field', `${field} key "${definition.canonical}" can only appear once.`, field)
    }
    values.set(definition.canonical, definition.parse(rawValue, `${field}.${definition.canonical}`))
  }
  return values
}

const WORKOUT_METRIC_FIELDS = [
  {
    canonical: 'durationMin',
    aliases: ['duration'],
    parse: (value: string, label: string) => parseIntegerString(value, label, 0, 1_440),
  },
  {
    canonical: 'movingTimeMin',
    aliases: ['movingtime'],
    parse: (value: string, label: string) => parseIntegerString(value, label, 0, 1_440),
  },
  {
    canonical: 'elapsedTimeMin',
    aliases: ['elapsedtime'],
    parse: (value: string, label: string) => parseIntegerString(value, label, 0, 1_440),
  },
  {
    canonical: 'distanceMeters',
    aliases: ['distance'],
    parse: (value: string, label: string) => parseIntegerString(value, label, 0, 500_000),
  },
  {
    canonical: 'paceSecondsPerKm',
    aliases: ['pace'],
    parse: (value: string, label: string) => parsePaceSecondsPerKm(value, label),
  },
  {
    canonical: 'averageHeartRate',
    aliases: ['heartrate', 'averagehr', 'hr'],
    parse: (value: string, label: string) => parseIntegerString(value, label, 20, 260),
  },
] as const satisfies readonly StructuredFieldDefinition<unknown>[]

const STEP_ACTUAL_FIELDS = [
  {
    canonical: 'sets',
    aliases: [],
    parse: (value: string, label: string) => parseIntegerString(value, label, 0, 100),
  },
  {
    canonical: 'reps',
    aliases: [],
    parse: (value: string, label: string) => parseIntegerString(value, label, 0, 1_000),
  },
  {
    canonical: 'seconds',
    aliases: ['durationseconds'],
    parse: (value: string, label: string) => parseIntegerString(value, label, 0, 21_600),
  },
  {
    canonical: 'minutes',
    aliases: ['durationmin', 'durationminutes'],
    parse: (value: string, label: string) => parseIntegerString(value, label, 0, 1_440),
  },
  {
    canonical: 'distanceMeters',
    aliases: ['distance'],
    parse: (value: string, label: string) => parseIntegerString(value, label, 0, 500_000),
  },
  {
    canonical: 'paceSecondsPerKm',
    aliases: ['pace'],
    parse: (value: string, label: string) => parsePaceSecondsPerKm(value, label),
  },
  {
    canonical: 'loadKg',
    aliases: ['load'],
    parse: (value: string, label: string) => parseNumericString(value, label, 0, 1_000),
  },
] as const satisfies readonly StructuredFieldDefinition<unknown>[]

function hasWorkoutMetricValues(metrics: WorkoutLogMetrics | undefined): boolean {
  return metrics !== undefined && Object.keys(metrics).length > 0
}

function hasStepActualValues(actual: WorkoutReviewStepActualValues | undefined): boolean {
  return actual !== undefined && Object.keys(actual).length > 0
}

export function parseWorkoutActualMetricsText(text: string): WorkoutLogMetrics | undefined {
  const values = parseStructuredText(text, 'actualSummary', WORKOUT_METRIC_FIELDS)
  if (!values.size) return undefined
  return {
    ...(values.has('durationMin') ? { durationMin: values.get('durationMin') as number } : {}),
    ...(values.has('movingTimeMin') ? { movingTimeMin: values.get('movingTimeMin') as number } : {}),
    ...(values.has('elapsedTimeMin') ? { elapsedTimeMin: values.get('elapsedTimeMin') as number } : {}),
    ...(values.has('distanceMeters') ? { distanceMeters: values.get('distanceMeters') as number } : {}),
    ...(values.has('paceSecondsPerKm') ? { paceSecondsPerKm: values.get('paceSecondsPerKm') as number } : {}),
    ...(values.has('averageHeartRate') ? { averageHeartRate: values.get('averageHeartRate') as number } : {}),
  }
}

export function formatWorkoutActualMetrics(metrics: WorkoutLogMetrics | undefined): string {
  if (metrics === undefined || !hasWorkoutMetricValues(metrics)) return ''
  const lines: string[] = []
  if (metrics.durationMin !== undefined) lines.push(`durationMin: ${metrics.durationMin}`)
  if (metrics.movingTimeMin !== undefined) lines.push(`movingTimeMin: ${metrics.movingTimeMin}`)
  if (metrics.elapsedTimeMin !== undefined) lines.push(`elapsedTimeMin: ${metrics.elapsedTimeMin}`)
  if (metrics.distanceMeters !== undefined) lines.push(`distanceMeters: ${metrics.distanceMeters}`)
  if (metrics.paceSecondsPerKm !== undefined) lines.push(`pace: ${formatPaceSecondsPerKm(metrics.paceSecondsPerKm)}`)
  if (metrics.averageHeartRate !== undefined) lines.push(`averageHeartRate: ${metrics.averageHeartRate}`)
  return lines.join('\n')
}

export function parseWorkoutStepActualText(text: string): WorkoutReviewStepActualValues | undefined {
  const values = parseStructuredText(text, 'stepActualResult', STEP_ACTUAL_FIELDS)
  if (!values.size) return undefined
  return {
    ...(values.has('sets') ? { sets: values.get('sets') as number } : {}),
    ...(values.has('reps') ? { reps: values.get('reps') as number } : {}),
    ...(values.has('seconds') ? { seconds: values.get('seconds') as number } : {}),
    ...(values.has('minutes') ? { minutes: values.get('minutes') as number } : {}),
    ...(values.has('distanceMeters') ? { distanceMeters: values.get('distanceMeters') as number } : {}),
    ...(values.has('paceSecondsPerKm') ? { paceSecondsPerKm: values.get('paceSecondsPerKm') as number } : {}),
    ...(values.has('loadKg') ? { loadKg: values.get('loadKg') as number } : {}),
  }
}

export function formatWorkoutStepActual(actual: WorkoutReviewStepActualValues | undefined): string {
  if (actual === undefined || !hasStepActualValues(actual)) return ''
  const lines: string[] = []
  if (actual.sets !== undefined) lines.push(`sets: ${actual.sets}`)
  if (actual.reps !== undefined) lines.push(`reps: ${actual.reps}`)
  if (actual.seconds !== undefined) lines.push(`seconds: ${actual.seconds}`)
  if (actual.minutes !== undefined) lines.push(`minutes: ${actual.minutes}`)
  if (actual.distanceMeters !== undefined) lines.push(`distanceMeters: ${actual.distanceMeters}`)
  if (actual.paceSecondsPerKm !== undefined) lines.push(`pace: ${formatPaceSecondsPerKm(actual.paceSecondsPerKm)}`)
  if (actual.loadKg !== undefined) lines.push(`loadKg: ${actual.loadKg}`)
  return lines.join('\n')
}

function parseOptionalRating(value: string, label: string, minimum: number, maximum: number): number | undefined {
  const normalized = normalizeFreeText(value)
  if (!normalized) return undefined
  return parseIntegerString(normalized, label, minimum, maximum)
}

function ensureWorkout(state: WorkoutReviewState, workoutId: string): WorkoutReviewWorkoutState {
  const validatedId = parseStableIdentity(workoutId, 'workoutId')
  const workout = state.workouts.find(entry => entry.workout.id === validatedId)
  if (!workout) throw reviewError('missing-workout', `Workout "${validatedId}" was not found in the review state.`, 'workoutId')
  return workout
}

function requireLoggedWorkout(workout: WorkoutReviewWorkoutState): WorkoutReviewWorkoutState {
  if (!workout.isLogged) {
    throw reviewError('missing-log', `Create a workout log for "${workout.workout.title}" before updating it.`, workout.workout.id)
  }
  return workout
}

function listWorkoutSteps(workout: Workout): readonly Workout['main'][number][] {
  return [...workout.warmup, ...workout.main, ...workout.cooldown]
}

function allocateWorkoutLogId(existingLogs: readonly WorkoutLog[], workoutId: string): string {
  const base = parseStableIdentity(`log-${workoutId}`, 'generatedLogId')
  const used = new Set(existingLogs.map(log => log.id))
  if (!used.has(base)) return base
  let sequence = 2
  while (true) {
    const candidate = parseStableIdentity(`${base}-${sequence}`, 'generatedLogId')
    if (!used.has(candidate)) return candidate
    sequence += 1
  }
}

function sortLogsNewestFirst(logs: readonly WorkoutLog[]): WorkoutLog[] {
  return [...logs].sort((left, right) => right.loggedOn.localeCompare(left.loggedOn) || left.id.localeCompare(right.id))
}

function countChanges(trackedChanges: readonly TrackedWorkoutChange[]): WorkoutReviewSummary['changes'] {
  return trackedChanges.reduce(
    (counts, change) => ({
      ...counts,
      [change.type]: counts[change.type] + 1,
    }),
    { moved: 0, added: 0, deleted: 0 },
  )
}

function buildSummaryFromState(state: WorkoutReviewState): WorkoutReviewSummary {
  const counts = {
    total: 0,
    logged: 0,
    completed: 0,
    partial: 0,
    skipped: 0,
    unlogged: 0,
  }
  const weekWorkoutIds = new Set(state.workouts.map(entry => entry.workout.id))
  counts.total += state.workouts.length
  for (const workout of state.workouts) {
    if (workout.isLogged) {
      counts.logged += 1
      counts[workout.draft.completionStatus] += 1
    } else {
      counts.unlogged += 1
    }
  }
  const extraWorkoutIds = new Set<string>()
  for (const change of state.trackedChanges) {
    if (!weekWorkoutIds.has(change.workoutId) && change.workoutSnapshot) extraWorkoutIds.add(change.workoutId)
  }
  counts.total += extraWorkoutIds.size
  counts.unlogged += extraWorkoutIds.size
  return {
    ...counts,
    changes: countChanges(state.trackedChanges),
  }
}

function buildDefaultWeeklyReviewDraft(weekPlan: WeekPlan): WeeklyReviewDraft {
  return {
    weekLabel: `${weekPlan.weekStart} to ${addDaysToLocalDate(weekPlan.weekStart, 6)}`,
    reflection: '',
    energy: '',
    recovery: '',
    wins: '',
    blockers: '',
    nextFocus: '',
    coachNotes: '',
  }
}

function buildDefaultWeeklyMetrics(summary: WorkoutReviewSummary): readonly WeeklyMetricDraft[] {
  const total = String(summary.total)
  return [
    { id: 'total-workouts', label: 'Total workouts', planned: total, completed: String(summary.logged), note: 'Auto-derived from current logs.' },
    { id: 'completed-workouts', label: 'Completed workouts', planned: total, completed: String(summary.completed), note: '' },
    { id: 'partial-workouts', label: 'Partial workouts', planned: total, completed: String(summary.partial), note: '' },
    { id: 'skipped-workouts', label: 'Skipped workouts', planned: total, completed: String(summary.skipped), note: '' },
    { id: 'unlogged-workouts', label: 'Unlogged workouts', planned: total, completed: String(summary.unlogged), note: '' },
  ]
}

function getWeeklyReviewMetrics(
  state: WorkoutReviewState,
  summary: WorkoutReviewSummary = buildSummaryFromState(state),
): readonly WeeklyMetricDraft[] {
  const defaults = new Map(buildDefaultWeeklyMetrics(summary).map(metric => [metric.id, metric]))
  let changed = false
  const metrics = state.weeklyReview.metrics.map(metric => {
    const automatic = defaults.get(metric.id)
    if (!automatic) return metric
    const editedFields = state.weeklyReview.editedMetricFields?.[metric.id] ?? []
    const planned = editedFields.includes('planned') ? metric.planned : automatic.planned
    const completed = editedFields.includes('completed') ? metric.completed : automatic.completed
    if (metric.planned === planned && metric.completed === completed) return metric
    changed = true
    return { ...metric, planned, completed }
  })
  return changed ? metrics : state.weeklyReview.metrics
}

function refreshWeeklyReviewMetrics(state: WorkoutReviewState): WorkoutReviewState {
  const metrics = getWeeklyReviewMetrics(state)
  if (metrics === state.weeklyReview.metrics) return state
  return {
    ...state,
    weeklyReview: { ...state.weeklyReview, metrics },
  }
}

function encodeStepReviewNotes(status: WorkoutStepResultStatus, effort: string, notes: string): string {
  const lines = [`${STEP_STATUS_PREFIX}${status}`]
  const effortRating = parseOptionalRating(effort, 'step.effort', 1, 10)
  if (effortRating !== undefined) lines.push(`${STEP_EFFORT_PREFIX}${effortRating}/10`)
  if (normalizeOptionalText(notes)) lines.push(normalizeOptionalText(notes)!)
  return lines.join('\n')
}

function hasLoggedStepValues(step: WorkoutLogStep | undefined): boolean {
  return step !== undefined && [
    step.completedSets,
    step.completedReps,
    step.completedSeconds,
    step.completedMinutes,
    step.completedDistanceMeters,
    step.completedPaceSecondsPerKm,
    step.loadKg,
  ].some(value => value !== undefined)
}

function inferStepStatus(log: WorkoutLog, step: WorkoutLogStep | undefined): WorkoutStepResultStatus {
  if (step === undefined) {
    return log.outcome === 'completed' ? 'done' : log.outcome === 'partial' ? 'trimmed' : 'skipped'
  }
  if (hasLoggedStepValues(step)) return log.outcome === 'skipped' ? 'skipped' : 'done'
  return log.outcome === 'completed' ? 'done' : log.outcome === 'partial' ? 'trimmed' : 'skipped'
}

interface ParsedStepReviewNotes {
  readonly status?: WorkoutStepResultStatus
  readonly effort: string
  readonly notes: string
  readonly messages: readonly FormMessage[]
}

function parseStepReviewNotes(notes: string | undefined, fallbackStatus: WorkoutStepResultStatus, stepId: string): ParsedStepReviewNotes {
  const normalized = normalizeOptionalText(notes)
  if (!normalized) return { status: undefined, effort: '', notes: '', messages: [] }
  const messages: FormMessage[] = []
  const remaining: string[] = []
  let status: WorkoutStepResultStatus | undefined
  let effort = ''
  for (const rawLine of normalized.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith(STEP_STATUS_PREFIX)) {
      const value = line.slice(STEP_STATUS_PREFIX.length).trim()
      if (status !== undefined) {
        messages.push(textMessage(`duplicate-step-status-${stepId}`, 'error', `Step "${stepId}" has duplicate structured status metadata; using the first value.`))
        continue
      }
      if (!STEP_OUTCOMES.has(value as WorkoutStepResultStatus)) {
        messages.push(textMessage(`invalid-step-status-${stepId}`, 'error', `Step "${stepId}" stored unsupported status metadata "${value}".`))
        remaining.push(rawLine)
        continue
      }
      status = value as WorkoutStepResultStatus
      continue
    }
    if (line.startsWith(STEP_EFFORT_PREFIX)) {
      const value = line.slice(STEP_EFFORT_PREFIX.length).trim().replace(/\/10$/i, '')
      if (effort) {
        messages.push(textMessage(`duplicate-step-effort-${stepId}`, 'error', `Step "${stepId}" has duplicate structured effort metadata; using the first value.`))
        continue
      }
      try {
        effort = String(parseIntegerString(value, `step ${stepId} effort`, 1, 10))
      } catch {
        messages.push(textMessage(`invalid-step-effort-${stepId}`, 'error', `Step "${stepId}" stored invalid effort metadata "${value}".`))
        remaining.push(rawLine)
      }
      continue
    }
    remaining.push(rawLine)
  }
  if (status === undefined) {
    messages.push(textMessage(`inferred-step-status-${stepId}`, 'info', `Step "${stepId}" had no structured status; inferred "${fallbackStatus}" from the saved workout log.`))
  }
  return {
    status,
    effort,
    notes: remaining.join('\n').trim(),
    messages,
  }
}

function createDraftStep(stepId: string, title: string, status: WorkoutStepResultStatus): WorkoutLogStepResultDraft {
  return {
    id: stepId,
    title,
    status,
    actualResult: '',
    effort: '',
    notes: '',
  }
}

function defaultPerformedOn(workout: Workout, changeHistory: readonly TrackedWorkoutChange[]): string {
  const datedChanges = [...changeHistory]
    .filter(change => change.toDate !== undefined)
    .sort((left, right) => (right.toDate ?? '').localeCompare(left.toDate ?? '') || left.type.localeCompare(right.type))
  return datedChanges[0]?.toDate ?? workout.scheduledDate
}

function hydrateWorkoutDraft(
  workout: Workout,
  latestLog: WorkoutLog | undefined,
  changeHistory: readonly TrackedWorkoutChange[],
): Pick<WorkoutReviewWorkoutState, 'draft' | 'isLogged' | 'hydrationMessages'> {
  if (!latestLog) {
    return {
      isLogged: false,
      draft: {
        logId: '',
        performedOn: defaultPerformedOn(workout, changeHistory),
        completionStatus: 'completed',
        sessionRpe: '',
        actualSummary: '',
        notes: '',
        stepResults: listWorkoutSteps(workout).map(step => createDraftStep(step.id, step.title, 'done')),
      },
      hydrationMessages: [],
    }
  }
  const logStepsById = new Map(latestLog.steps.map(step => [step.stepId, step]))
  const hydrationMessages: FormMessage[] = []
  const stepResults = listWorkoutSteps(workout).map(step => {
    const loggedStep = logStepsById.get(step.id)
    const fallbackStatus = inferStepStatus(latestLog, loggedStep)
    const parsedNotes = parseStepReviewNotes(loggedStep?.notes, fallbackStatus, step.id)
    hydrationMessages.push(...parsedNotes.messages)
    return {
      id: step.id,
      title: step.title,
      status: parsedNotes.status ?? fallbackStatus,
      actualResult: formatWorkoutStepActual(loggedStep ? {
        ...(loggedStep.completedSets === undefined ? {} : { sets: loggedStep.completedSets }),
        ...(loggedStep.completedReps === undefined ? {} : { reps: loggedStep.completedReps }),
        ...(loggedStep.completedSeconds === undefined ? {} : { seconds: loggedStep.completedSeconds }),
        ...(loggedStep.completedMinutes === undefined ? {} : { minutes: loggedStep.completedMinutes }),
        ...(loggedStep.completedDistanceMeters === undefined ? {} : { distanceMeters: loggedStep.completedDistanceMeters }),
        ...(loggedStep.completedPaceSecondsPerKm === undefined ? {} : { paceSecondsPerKm: loggedStep.completedPaceSecondsPerKm }),
        ...(loggedStep.loadKg === undefined ? {} : { loadKg: loggedStep.loadKg }),
      } : undefined),
      effort: parsedNotes.effort,
      notes: parsedNotes.notes,
    }
  })
  return {
    isLogged: true,
    draft: {
      logId: latestLog.id,
      performedOn: latestLog.loggedOn,
      completionStatus: latestLog.outcome,
      sessionRpe: latestLog.effortRating === undefined ? '' : String(latestLog.effortRating),
      actualSummary: formatWorkoutActualMetrics(latestLog.metrics),
      notes: latestLog.notes ?? '',
      stepResults,
    },
    hydrationMessages,
  }
}

function validateTrackedChanges(weekPlan: WeekPlan, workoutLogs: readonly WorkoutLog[], trackedChanges: readonly TrackedWorkoutChange[]): void {
  buildContinuationWeekContext(weekPlan, workoutLogs, trackedChanges)
}

export function createWorkoutReviewState(input: CreateWorkoutReviewStateInput): WorkoutReviewState {
  const validatedWeekPlan = parseWeekPlan(input.weekPlan)
  const validatedLogs = validateWorkoutLogsForWeekPlan(
    validatedWeekPlan,
    (input.workoutLogs ?? []).map(log => parseWorkoutLog(log)),
    'WorkoutReviewState.workoutLogs',
  )
  const trackedChanges = [...(input.trackedChanges ?? [])]
  validateTrackedChanges(validatedWeekPlan, validatedLogs, trackedChanges)
  const logsByWorkoutId = new Map<string, WorkoutLog[]>()
  for (const log of validatedLogs) {
    const list = logsByWorkoutId.get(log.workoutId) ?? []
    list.push(log)
    logsByWorkoutId.set(log.workoutId, list)
  }
  const changesByWorkoutId = new Map<string, TrackedWorkoutChange[]>()
  for (const change of trackedChanges) {
    const list = changesByWorkoutId.get(change.workoutId) ?? []
    list.push(change)
    changesByWorkoutId.set(change.workoutId, list)
  }
  const workouts: WorkoutReviewWorkoutState[] = validatedWeekPlan.workouts.map(workout => {
    const history = sortLogsNewestFirst(logsByWorkoutId.get(workout.id) ?? [])
    const changeHistory = [...(changesByWorkoutId.get(workout.id) ?? [])]
    const hydrated = hydrateWorkoutDraft(workout, history[0], changeHistory)
    return {
      workout,
      logHistory: history,
      changeHistory,
      isLogged: hydrated.isLogged,
      draft: {
        ...hydrated.draft,
        logId: hydrated.draft.logId || allocateWorkoutLogId(validatedLogs, workout.id),
      },
      hydrationMessages: history.length > 1
        ? [
          textMessage(`workout-history-${workout.id}`, 'info', `Loaded the latest of ${history.length} saved logs for "${workout.title}". Older log history will be preserved.`),
          ...hydrated.hydrationMessages,
        ]
        : hydrated.hydrationMessages,
    }
  })
  const state: WorkoutReviewState = {
    weekPlan: validatedWeekPlan,
    sourceLogs: [...validatedLogs],
    trackedChanges,
    workouts,
    weeklyReview: {
      draft: buildDefaultWeeklyReviewDraft(validatedWeekPlan),
      metrics: [],
    },
  }
  return {
    ...state,
    weeklyReview: {
      ...state.weeklyReview,
      metrics: buildDefaultWeeklyMetrics(buildSummaryFromState(state)),
    },
  }
}

function workoutReviewDraftsEqual(left: WorkoutReviewLogDraft, right: WorkoutReviewLogDraft): boolean {
  return left.logId === right.logId
    && left.performedOn === right.performedOn
    && left.completionStatus === right.completionStatus
    && left.sessionRpe === right.sessionRpe
    && left.actualSummary === right.actualSummary
    && left.notes === right.notes
    && left.stepResults.length === right.stepResults.length
    && left.stepResults.every((step, index) => {
      const other = right.stepResults[index]
      return other !== undefined
        && step.id === other.id
        && step.title === other.title
        && step.status === other.status
        && step.actualResult === other.actualResult
        && step.effort === other.effort
        && step.notes === other.notes
    })
}

export function getDirtyWorkoutReviewIds(state: WorkoutReviewState): readonly string[] {
  return state.workouts.filter(workout => {
    if (!workout.isLogged) return false
    const latestLog = workout.logHistory[0]
    if (!latestLog) return true
    const baseline = hydrateWorkoutDraft(workout.workout, latestLog, workout.changeHistory)
    return !workoutReviewDraftsEqual(workout.draft, baseline.draft)
  }).map(workout => workout.workout.id)
}

export function mergeSavedWorkoutReviewLogs(
  current: WorkoutReviewState,
  submitted: WorkoutReviewState,
  logs: readonly WorkoutLog[],
  savedWorkoutIds: readonly string[],
): WorkoutReviewState {
  const savedIds = new Set(savedWorkoutIds.map(workoutId => {
    const workout = ensureWorkout(current, workoutId)
    requireLoggedWorkout(ensureWorkout(submitted, workoutId))
    return workout.workout.id
  }))
  if (!savedIds.size) return current
  if (current.weekPlan.id !== submitted.weekPlan.id || current.weekPlan.athleteId !== submitted.weekPlan.athleteId) {
    throw reviewError('invalid-review', 'Saved workout logs must belong to the submitted review week and athlete.', 'weekPlan')
  }
  try {
    const validatedLogs = validateWorkoutLogsForWeekPlan(
      current.weekPlan,
      logs.map(log => parseWorkoutLog(log)),
      'SavedWorkoutReviewLogs',
    )
    for (const workoutId of savedIds) {
      const submittedWorkout = ensureWorkout(submitted, workoutId)
      if (!validatedLogs.some(log => log.workoutId === workoutId && log.id === submittedWorkout.draft.logId)) {
        throw reviewError('missing-log', `Saved log "${submittedWorkout.draft.logId}" for workout "${workoutId}" was not found.`, workoutId)
      }
    }
    // A full save response may contain stale logs for cards saved since submission.
    const savedLogs = validatedLogs.filter(log => savedIds.has(log.workoutId))
    const replacementIds = new Set(savedLogs.map(log => log.id))
    for (const log of current.sourceLogs) {
      if (replacementIds.has(log.id) && !savedIds.has(log.workoutId)) {
        throw reviewError('invalid-workout-log', `Saved log "${log.id}" belongs to a different workout.`, 'workoutId')
      }
    }
    const sourceLogs = validateWorkoutLogsForWeekPlan(current.weekPlan, [
      ...current.sourceLogs.filter(log => !replacementIds.has(log.id)),
      ...savedLogs,
    ], 'SavedWorkoutReviewLogs')
    const workouts = current.workouts.map(workout => {
      if (!savedIds.has(workout.workout.id)) return workout
      const logHistory = sortLogsNewestFirst(sourceLogs.filter(log => log.workoutId === workout.workout.id))
      const hydrated = hydrateWorkoutDraft(workout.workout, logHistory[0], workout.changeHistory)
      const submittedWorkout = ensureWorkout(submitted, workout.workout.id)
      return {
        ...workout,
        logHistory,
        hydrationMessages: logHistory.length > 1
          ? [
            textMessage(`workout-history-${workout.workout.id}`, 'info', `Loaded the latest of ${logHistory.length} saved logs for "${workout.workout.title}". Older log history will be preserved.`),
            ...hydrated.hydrationMessages,
          ]
          : hydrated.hydrationMessages,
        ...(workout.draft === submittedWorkout.draft
          ? { draft: hydrated.draft, isLogged: hydrated.isLogged }
          : {}),
      }
    })
    return refreshWeeklyReviewMetrics({ ...current, sourceLogs, workouts })
  } catch (error) {
    throw asReviewError('invalid-workout-log', 'workoutLogs', error, 'Could not merge saved workout logs.')
  }
}

function updateWorkoutEntry(
  state: WorkoutReviewState,
  workoutId: string,
  updater: (workout: WorkoutReviewWorkoutState) => WorkoutReviewWorkoutState,
): WorkoutReviewState {
  let found = false
  const workouts = state.workouts.map(workout => {
    if (workout.workout.id !== workoutId) return workout
    found = true
    return updater(workout)
  })
  if (!found) throw reviewError('missing-workout', `Workout "${workoutId}" was not found in the review state.`, 'workoutId')
  return refreshWeeklyReviewMetrics({ ...state, workouts })
}

function updateStepResult(
  workout: WorkoutReviewWorkoutState,
  stepId: string,
  updater: (step: WorkoutLogStepResultDraft) => WorkoutLogStepResultDraft,
): WorkoutReviewWorkoutState {
  let found = false
  const stepResults = workout.draft.stepResults.map(step => {
    if (step.id !== stepId) return step
    found = true
    return updater(step)
  })
  if (!found) {
    throw reviewError('invalid-workout-log', `Step "${stepId}" was not found in workout "${workout.workout.title}".`, stepId)
  }
  return {
    ...workout,
    draft: { ...workout.draft, stepResults },
  }
}

export function reduceWorkoutReviewState(state: WorkoutReviewState, action: WorkoutReviewAction): WorkoutReviewState {
  switch (action.type) {
    case 'startWorkoutLog':
      return updateWorkoutEntry(state, parseStableIdentity(action.workoutId, 'workoutId'), workout => {
        if (workout.isLogged) {
          throw reviewError('invalid-workout-log', `Workout "${workout.workout.title}" already has a current log draft.`, workout.workout.id)
        }
        const outcome = action.outcome ?? 'completed'
        if (!WORKOUT_OUTCOMES.has(outcome)) {
          throw reviewError('invalid-workout-log', `Unsupported workout outcome "${String(outcome)}".`, 'outcome')
        }
        return {
          ...workout,
          isLogged: true,
          draft: {
            ...workout.draft,
            completionStatus: outcome,
            stepResults: workout.draft.stepResults.map(step => ({
              ...step,
              status: outcome === 'completed' ? 'done' : outcome === 'partial' ? 'trimmed' : 'skipped',
            })),
          },
        }
      })
    case 'setWorkoutCompletionStatus':
      return updateWorkoutEntry(state, parseStableIdentity(action.workoutId, 'workoutId'), workout => {
        const current = requireLoggedWorkout(workout)
        if (!WORKOUT_OUTCOMES.has(action.value)) {
          throw reviewError('invalid-workout-log', `Unsupported workout outcome "${String(action.value)}".`, 'completionStatus')
        }
        return { ...current, draft: { ...current.draft, completionStatus: action.value } }
      })
    case 'setWorkoutSessionRpe':
      return updateWorkoutEntry(state, parseStableIdentity(action.workoutId, 'workoutId'), workout => {
        const current = requireLoggedWorkout(workout)
        return { ...current, draft: { ...current.draft, sessionRpe: action.value } }
      })
    case 'setWorkoutActualSummary':
      return updateWorkoutEntry(state, parseStableIdentity(action.workoutId, 'workoutId'), workout => {
        const current = requireLoggedWorkout(workout)
        return { ...current, draft: { ...current.draft, actualSummary: action.value } }
      })
    case 'setWorkoutNotes':
      return updateWorkoutEntry(state, parseStableIdentity(action.workoutId, 'workoutId'), workout => {
        const current = requireLoggedWorkout(workout)
        return { ...current, draft: { ...current.draft, notes: action.value } }
      })
    case 'setWorkoutStepResultField':
      return updateWorkoutEntry(state, parseStableIdentity(action.workoutId, 'workoutId'), workout => {
        const current = requireLoggedWorkout(workout)
        return updateStepResult(current, parseStableIdentity(action.stepId, 'stepId'), step => {
          if (action.field === 'status' && !STEP_OUTCOMES.has(action.value as WorkoutStepResultStatus)) {
            throw reviewError('invalid-workout-log', `Unsupported step status "${action.value}".`, 'step.status')
          }
          return { ...step, [action.field]: action.value }
        })
      })
    case 'setWeeklyReviewField':
      return {
        ...state,
        weeklyReview: {
          ...state.weeklyReview,
          draft: {
            ...state.weeklyReview.draft,
            [action.field]: action.value,
          },
        },
      }
    case 'setWeeklyMetricField': {
      // Explicitly entering the current automatic value is still an override.
      const editedFields = state.weeklyReview.editedMetricFields?.[action.metricId] ?? []
      return {
        ...state,
        weeklyReview: {
          ...state.weeklyReview,
          metrics: getWeeklyReviewMetrics(state).map(metric =>
            metric.id === action.metricId ? { ...metric, [action.field]: action.value } : metric),
          editedMetricFields: {
            ...state.weeklyReview.editedMetricFields,
            [action.metricId]: editedFields.includes(action.field) ? editedFields : [...editedFields, action.field],
          },
        },
      }
    }
  }
}

export function reduceInlineWorkoutReviewState(state: WorkoutReviewState, action: WorkoutReviewAction): WorkoutReviewState {
  if ('workoutId' in action && action.type !== 'startWorkoutLog') {
    const workout = ensureWorkout(state, action.workoutId)
    if (!workout.isLogged) {
      state = updateWorkoutEntry(state, workout.workout.id, current => ({
        ...current,
        isLogged: true,
        draft: {
          ...current.draft,
          completionStatus: 'partial',
          sessionRpe: '',
          actualSummary: '',
          notes: '',
          stepResults: current.draft.stepResults.map(step => createDraftStep(step.id, step.title, 'unrecorded')),
        },
      }))
    }
  }
  const next = reduceWorkoutReviewState(state, action)
  if (action.type === 'setWorkoutCompletionStatus' && (action.value === 'completed' || action.value === 'skipped')) {
    const status = action.value === 'completed' ? 'done' : 'skipped'
    return updateWorkoutEntry(next, parseStableIdentity(action.workoutId, 'workoutId'), workout => ({
      ...workout,
      draft: {
        ...workout.draft,
        stepResults: workout.draft.stepResults.map(step => step.status === 'unrecorded' ? { ...step, status } : step),
      },
    }))
  }
  return next
}

export function startWorkoutReviewLog(
  state: WorkoutReviewState,
  workoutId: string,
  outcome: WorkoutCompletionStatus = 'completed',
): WorkoutReviewState {
  return reduceWorkoutReviewState(state, { type: 'startWorkoutLog', workoutId, outcome })
}

export function setWorkoutReviewEffortRating(
  state: WorkoutReviewState,
  workoutId: string,
  effortRating: number | undefined,
): WorkoutReviewState {
  if (effortRating !== undefined && (!Number.isSafeInteger(effortRating) || effortRating < 1 || effortRating > 10)) {
    throw reviewError('invalid-review-field', 'Session RPE must be a whole number between 1 and 10.', 'sessionRpe')
  }
  return reduceWorkoutReviewState(state, {
    type: 'setWorkoutSessionRpe',
    workoutId,
    value: effortRating === undefined ? '' : String(effortRating),
  })
}

export function setWorkoutReviewMetrics(
  state: WorkoutReviewState,
  workoutId: string,
  metrics: WorkoutLogMetrics | undefined,
): WorkoutReviewState {
  return reduceWorkoutReviewState(state, {
    type: 'setWorkoutActualSummary',
    workoutId,
    value: formatWorkoutActualMetrics(metrics),
  })
}

export function setWorkoutReviewNotes(
  state: WorkoutReviewState,
  workoutId: string,
  notes: string,
): WorkoutReviewState {
  return reduceWorkoutReviewState(state, {
    type: 'setWorkoutNotes',
    workoutId,
    value: notes,
  })
}

export function setWorkoutReviewStepStatus(
  state: WorkoutReviewState,
  workoutId: string,
  stepId: string,
  status: WorkoutStepResultStatus,
): WorkoutReviewState {
  return reduceWorkoutReviewState(state, {
    type: 'setWorkoutStepResultField',
    workoutId,
    stepId,
    field: 'status',
    value: status,
  })
}

export function setWorkoutReviewStepEffortRating(
  state: WorkoutReviewState,
  workoutId: string,
  stepId: string,
  effortRating: number | undefined,
): WorkoutReviewState {
  if (effortRating !== undefined && (!Number.isSafeInteger(effortRating) || effortRating < 1 || effortRating > 10)) {
    throw reviewError('invalid-review-field', 'Step RPE must be a whole number between 1 and 10.', 'step.effort')
  }
  return reduceWorkoutReviewState(state, {
    type: 'setWorkoutStepResultField',
    workoutId,
    stepId,
    field: 'effort',
    value: effortRating === undefined ? '' : String(effortRating),
  })
}

export function setWorkoutReviewStepActualValues(
  state: WorkoutReviewState,
  workoutId: string,
  stepId: string,
  actual: WorkoutReviewStepActualValues | undefined,
): WorkoutReviewState {
  return reduceWorkoutReviewState(state, {
    type: 'setWorkoutStepResultField',
    workoutId,
    stepId,
    field: 'actualResult',
    value: formatWorkoutStepActual(actual),
  })
}

export function setWorkoutReviewStepNotes(
  state: WorkoutReviewState,
  workoutId: string,
  stepId: string,
  notes: string,
): WorkoutReviewState {
  return reduceWorkoutReviewState(state, {
    type: 'setWorkoutStepResultField',
    workoutId,
    stepId,
    field: 'notes',
    value: notes,
  })
}

function collectWorkoutIssues(workout: WorkoutReviewWorkoutState): WorkoutReviewIssue[] {
  const issues: WorkoutReviewIssue[] = []
  if (!workout.isLogged) return issues
  try {
    parseLocalDate(workout.draft.performedOn, `WorkoutLog(${workout.workout.id}).loggedOn`)
  } catch (error) {
    issues.push(createIssue('workout', 'performedOn', asReviewError('invalid-workout-log', 'performedOn', error, 'Invalid logged-on date.').message, workout.workout.id))
  }
  try {
    parseOptionalRating(workout.draft.sessionRpe, `WorkoutLog(${workout.workout.id}).effortRating`, 1, 10)
  } catch (error) {
    issues.push(createIssue('workout', 'sessionRpe', asReviewError('invalid-review-field', 'sessionRpe', error, 'Invalid session RPE.').message, workout.workout.id))
  }
  try {
    parseWorkoutActualMetricsText(workout.draft.actualSummary)
  } catch (error) {
    issues.push(createIssue('workout', 'actualSummary', asReviewError('invalid-review-field', 'actualSummary', error, 'Invalid actual metrics.').message, workout.workout.id))
  }
  if (normalizeOptionalText(workout.draft.notes)?.length && normalizeOptionalText(workout.draft.notes)!.length > 2_000) {
    issues.push(createIssue('workout', 'notes', 'Workout notes must be 2000 characters or fewer.', workout.workout.id))
  }
  for (const step of workout.draft.stepResults) {
    if (!STEP_OUTCOMES.has(step.status)) {
      issues.push(createIssue('workout', `steps.${step.id}.status`, `Step "${step.title}" must use unrecorded, done, trimmed, or skipped.`, workout.workout.id))
    }
    try {
      parseOptionalRating(step.effort, `WorkoutStep(${step.id}).effort`, 1, 10)
    } catch (error) {
      issues.push(createIssue('workout', `steps.${step.id}.effort`, asReviewError('invalid-review-field', step.id, error, 'Invalid step effort.').message, workout.workout.id))
    }
    try {
      parseWorkoutStepActualText(step.actualResult)
    } catch (error) {
      issues.push(createIssue('workout', `steps.${step.id}.actualResult`, asReviewError('invalid-review-field', step.id, error, 'Invalid step actual values.').message, workout.workout.id))
    }
    const encodedLength = encodeStepReviewNotes(step.status, step.effort, step.notes).length
    if (encodedLength > 2_000) {
      issues.push(createIssue('workout', `steps.${step.id}.notes`, `Step "${step.title}" notes are too long after structured status metadata is added.`, workout.workout.id))
    }
  }
  return issues
}

function collectWeeklyReviewIssues(state: WorkoutReviewState): WorkoutReviewIssue[] {
  const issues: WorkoutReviewIssue[] = []
  const draft = state.weeklyReview.draft
  if (normalizeOptionalText(draft.weekLabel)?.length && normalizeOptionalText(draft.weekLabel)!.length > 120) {
    issues.push(createIssue('weekly-review', 'weekLabel', 'Week label must be 120 characters or fewer.'))
  }
  for (const [field, value] of Object.entries({
    reflection: draft.reflection,
    wins: draft.wins,
    blockers: draft.blockers,
    nextFocus: draft.nextFocus,
    coachNotes: draft.coachNotes,
  })) {
    if (normalizeOptionalText(value)?.length && normalizeOptionalText(value)!.length > 2_000) {
      issues.push(createIssue('weekly-review', field, `${field} must be 2000 characters or fewer.`))
    }
  }
  for (const [field, value] of Object.entries({
    energy: draft.energy,
    recovery: draft.recovery,
  })) {
    try {
      parseOptionalRating(value, field, 1, 5)
    } catch (error) {
      issues.push(createIssue('weekly-review', field, asReviewError('invalid-review-field', field, error, `Invalid ${field} rating.`).message))
    }
  }
  for (const metric of getWeeklyReviewMetrics(state)) {
    if (metric.planned.trim().length > 120) {
      issues.push(createIssue('weekly-review', `${metric.id}.planned`, `Metric "${metric.label}" planned value must be 120 characters or fewer.`))
    }
    if (metric.completed.trim().length > 120) {
      issues.push(createIssue('weekly-review', `${metric.id}.completed`, `Metric "${metric.label}" completed value must be 120 characters or fewer.`))
    }
    if (metric.note.trim().length > 2_000) {
      issues.push(createIssue('weekly-review', `${metric.id}.note`, `Metric "${metric.label}" note must be 2000 characters or fewer.`))
    }
  }
  return issues
}

export function validateWorkoutReviewState(state: WorkoutReviewState): WorkoutReviewValidation {
  const workoutIssuesById = Object.fromEntries(
    state.workouts.map(workout => [workout.workout.id, collectWorkoutIssues(workout)]),
  ) as Record<string, readonly WorkoutReviewIssue[]>
  const weeklyReviewIssues = collectWeeklyReviewIssues(state)
  const issues = [
    ...Object.values(workoutIssuesById).flat(),
    ...weeklyReviewIssues,
  ]
  return {
    issues,
    workoutIssuesById,
    weeklyReviewIssues,
  }
}

function firstValidationError(issues: readonly WorkoutReviewIssue[], fallbackPath: string): never {
  const [firstIssue] = issues
  throw reviewError('invalid-review', firstIssue?.message ?? 'The review state is invalid.', firstIssue?.field ?? fallbackPath)
}

function buildDomainWorkoutLog(workout: WorkoutReviewWorkoutState, weekPlan: WeekPlan): WorkoutLog {
  const current = requireLoggedWorkout(workout)
  const effortRating = parseOptionalRating(current.draft.sessionRpe, `WorkoutLog(${current.workout.id}).effortRating`, 1, 10)
  const metrics = parseWorkoutActualMetricsText(current.draft.actualSummary)
  const steps = current.draft.stepResults.map(step => {
    const actual = parseWorkoutStepActualText(step.actualResult)
    return {
      stepId: step.id,
      ...(actual?.sets === undefined ? {} : { completedSets: actual.sets }),
      ...(actual?.reps === undefined ? {} : { completedReps: actual.reps }),
      ...(actual?.seconds === undefined ? {} : { completedSeconds: actual.seconds }),
      ...(actual?.minutes === undefined ? {} : { completedMinutes: actual.minutes }),
      ...(actual?.distanceMeters === undefined ? {} : { completedDistanceMeters: actual.distanceMeters }),
      ...(actual?.paceSecondsPerKm === undefined ? {} : { completedPaceSecondsPerKm: actual.paceSecondsPerKm }),
      ...(actual?.loadKg === undefined ? {} : { loadKg: actual.loadKg }),
      notes: encodeStepReviewNotes(step.status, step.effort, step.notes),
    } satisfies WorkoutLogStep
  })
  try {
    return parseWorkoutLog({
      version: 1,
      id: current.draft.logId,
      athleteId: weekPlan.athleteId,
      weekPlanId: weekPlan.id,
      workoutId: current.workout.id,
      loggedOn: parseLocalDate(current.draft.performedOn, `WorkoutLog(${current.workout.id}).loggedOn`),
      outcome: current.draft.completionStatus,
      ...(effortRating === undefined ? {} : { effortRating }),
      ...(metrics === undefined ? {} : { metrics }),
      steps,
      ...(normalizeOptionalText(current.draft.notes) ? { notes: normalizeOptionalText(current.draft.notes)! } : {}),
    })
  } catch (error) {
    throw asReviewError('invalid-workout-log', current.workout.id, error, `Could not build a valid log for workout "${current.workout.title}".`)
  }
}

export function buildWorkoutReviewLog(state: WorkoutReviewState, workoutId: string): WorkoutLog {
  const validation = validateWorkoutReviewState(state)
  const validatedId = parseStableIdentity(workoutId, 'workoutId')
  const workoutIssues = validation.workoutIssuesById[validatedId] ?? []
  if (workoutIssues.length) firstValidationError(workoutIssues, validatedId)
  return buildDomainWorkoutLog(ensureWorkout(state, validatedId), state.weekPlan)
}

export function buildWorkoutReviewLogs(state: WorkoutReviewState): readonly WorkoutLog[] {
  const validation = validateWorkoutReviewState(state)
  const blockingWorkoutIssues = Object.values(validation.workoutIssuesById).flat()
  if (blockingWorkoutIssues.length) firstValidationError(blockingWorkoutIssues, 'workoutLogs')
  const replacementIds = new Set<string>()
  const builtLogs: WorkoutLog[] = []
  for (const workout of state.workouts) {
    if (workout.logHistory[0]?.id) replacementIds.add(workout.logHistory[0].id)
    if (workout.isLogged) builtLogs.push(buildDomainWorkoutLog(workout, state.weekPlan))
  }
  const preservedHistory = state.sourceLogs.filter(log => !replacementIds.has(log.id))
  const combined = [...preservedHistory, ...builtLogs].sort((left, right) =>
    left.loggedOn.localeCompare(right.loggedOn) || left.id.localeCompare(right.id))
  return validateWorkoutLogsForWeekPlan(state.weekPlan, combined, 'WorkoutReviewPayload.workoutLogs')
}

function buildValidatedWeeklyReview(state: WorkoutReviewState): ValidatedWeeklyReview {
  const validation = validateWorkoutReviewState(state)
  if (validation.weeklyReviewIssues.length) firstValidationError(validation.weeklyReviewIssues, 'weeklyReview')
  const draft = state.weeklyReview.draft
  return {
    ...(normalizeOptionalText(draft.weekLabel) ? { weekLabel: normalizeOptionalText(draft.weekLabel)! } : {}),
    ...(normalizeOptionalText(draft.reflection) ? { reflection: normalizeOptionalText(draft.reflection)! } : {}),
    ...(parseOptionalRating(draft.energy, 'energy', 1, 5) === undefined ? {} : { energy: parseOptionalRating(draft.energy, 'energy', 1, 5)! }),
    ...(parseOptionalRating(draft.recovery, 'recovery', 1, 5) === undefined ? {} : { recovery: parseOptionalRating(draft.recovery, 'recovery', 1, 5)! }),
    ...(normalizeOptionalText(draft.wins) ? { wins: normalizeOptionalText(draft.wins)! } : {}),
    ...(normalizeOptionalText(draft.blockers) ? { blockers: normalizeOptionalText(draft.blockers)! } : {}),
    ...(normalizeOptionalText(draft.nextFocus) ? { nextFocus: normalizeOptionalText(draft.nextFocus)! } : {}),
    ...(normalizeOptionalText(draft.coachNotes) ? { coachNotes: normalizeOptionalText(draft.coachNotes)! } : {}),
    metrics: getWeeklyReviewMetrics(state).map(metric => ({
      id: metric.id,
      label: metric.label,
      ...(normalizeOptionalText(metric.planned) ? { planned: normalizeOptionalText(metric.planned)! } : {}),
      ...(normalizeOptionalText(metric.completed) ? { completed: normalizeOptionalText(metric.completed)! } : {}),
      ...(normalizeOptionalText(metric.note) ? { note: normalizeOptionalText(metric.note)! } : {}),
    })),
  }
}

function buildReviewNarrative(summary: WorkoutReviewSummary, review: ValidatedWeeklyReview): string {
  const lines = [
    `Status summary: ${summary.completed} completed, ${summary.partial} partial, ${summary.skipped} skipped, ${summary.unlogged} unlogged across ${summary.total} prior workouts.`,
  ]
  if (summary.changes.moved || summary.changes.added || summary.changes.deleted) {
    lines.push(`Change summary: ${summary.changes.moved} moved, ${summary.changes.added} added, ${summary.changes.deleted} deleted.`)
  }
  if (review.weekLabel) lines.push(`Week label: ${review.weekLabel}`)
  if (review.reflection) lines.push(`Overall reflection: ${review.reflection}`)
  if (review.energy !== undefined || review.recovery !== undefined) {
    lines.push([
      review.energy === undefined ? undefined : `energy ${review.energy}/5`,
      review.recovery === undefined ? undefined : `recovery ${review.recovery}/5`,
    ].filter(Boolean).join(', '))
  }
  if (review.metrics.length) {
    lines.push(`Metrics: ${review.metrics.map(metric => [
      metric.label,
      metric.planned ? `planned ${metric.planned}` : undefined,
      metric.completed ? `completed ${metric.completed}` : undefined,
      metric.note ? `note ${metric.note}` : undefined,
    ].filter(Boolean).join(' | ')).join(' || ')}`)
  }
  if (review.wins) lines.push(`Wins: ${review.wins}`)
  if (review.blockers) lines.push(`Blockers: ${review.blockers}`)
  if (review.nextFocus) lines.push(`Next week focus: ${review.nextFocus}`)
  if (review.coachNotes) lines.push(`Coach notes: ${review.coachNotes}`)
  return lines.join('\n')
}

export function summarizeWorkoutReviewState(state: WorkoutReviewState): WorkoutReviewSummary {
  return buildSummaryFromState(state)
}

export function buildWorkoutReviewPayload(state: WorkoutReviewState): WorkoutReviewPayload {
  const validation = validateWorkoutReviewState(state)
  if (validation.issues.length) firstValidationError(validation.issues, 'review')
  const workoutLogs = buildWorkoutReviewLogs(state)
  const summary = buildSummaryFromState(state)
  const review = buildValidatedWeeklyReview(state)
  const previousWeek = buildContinuationWeekContext(state.weekPlan, workoutLogs, state.trackedChanges)
  return {
    weekPlan: state.weekPlan,
    workoutLogs,
    trackedChanges: [...state.trackedChanges],
    summary,
    review,
    previousWeek: {
      ...previousWeek,
      summary: buildReviewNarrative(summary, review),
    },
  }
}

export function createWorkoutLogScreenProps(
  state: WorkoutReviewState,
  workoutId: string,
  dispatch: (action: WorkoutReviewAction) => void = () => undefined,
  validation: WorkoutReviewValidation = validateWorkoutReviewState(state),
): WorkoutReviewLogScreenAdapterProps {
  const workout = ensureWorkout(state, workoutId)
  const messages = [
    ...workout.hydrationMessages,
    ...(!workout.isLogged
      ? [textMessage(`unlogged-${workoutId}`, 'info', `Choose an outcome for "${workout.workout.title}" before saving your log.`)]
      : []),
    ...(validation.workoutIssuesById[workout.workout.id] ?? []).map(asMessage),
  ]
  return {
    workoutId: workout.workout.id,
    workout: workout.workout,
    hasLog: workout.isLogged,
    historyCount: workout.logHistory.length,
    changeHistory: workout.changeHistory,
    workoutTitle: workout.workout.title,
    performedOn: workout.draft.performedOn,
    completionStatus: workout.draft.completionStatus,
    sessionRpe: workout.draft.sessionRpe,
    actualSummary: workout.draft.actualSummary,
    notes: workout.draft.notes,
    stepResults: workout.draft.stepResults,
    messages,
    onCompletionStatusChange: value => dispatch({ type: 'setWorkoutCompletionStatus', workoutId: workout.workout.id, value }),
    onSessionRpeChange: value => dispatch({ type: 'setWorkoutSessionRpe', workoutId: workout.workout.id, value }),
    onActualSummaryChange: value => dispatch({ type: 'setWorkoutActualSummary', workoutId: workout.workout.id, value }),
    onNotesChange: value => dispatch({ type: 'setWorkoutNotes', workoutId: workout.workout.id, value }),
    onStepResultChange: (stepId, field, value) => dispatch({ type: 'setWorkoutStepResultField', workoutId: workout.workout.id, stepId, field, value }),
    onSave: () => undefined,
  }
}

export function createWeeklyReviewScreenProps(
  state: WorkoutReviewState,
  dispatch: (action: WorkoutReviewAction) => void = () => undefined,
): WeeklyReviewScreenAdapterProps {
  const summary = buildSummaryFromState(state)
  const validation = validateWorkoutReviewState(state)
  const workoutIssueCount = Object.values(validation.workoutIssuesById).flat().length
  const messages: FormMessage[] = [
    textMessage(
      'weekly-summary',
      'info',
      `${summary.total} workouts: ${summary.completed} completed, ${summary.partial} partial, ${summary.skipped} skipped, ${summary.unlogged} unlogged.`,
    ),
    ...(summary.changes.moved || summary.changes.added || summary.changes.deleted
      ? [textMessage('weekly-changes', 'info', `Change history: ${summary.changes.moved} moved, ${summary.changes.added} added, ${summary.changes.deleted} deleted.`)]
      : []),
    ...(workoutIssueCount
      ? [textMessage('weekly-blockers', 'error', `${workoutIssueCount} workout review issue${workoutIssueCount === 1 ? '' : 's'} must be fixed before building the continuation payload.`)]
      : []),
    ...validation.weeklyReviewIssues.map(asMessage),
  ]
  return {
    summary,
    draft: state.weeklyReview.draft,
    metrics: getWeeklyReviewMetrics(state, summary),
    messages,
    onFieldChange: (field, value) => dispatch({ type: 'setWeeklyReviewField', field, value }),
    onMetricChange: (metricId, field, value) => dispatch({ type: 'setWeeklyMetricField', metricId, field, value }),
    onSave: () => undefined,
  }
}
