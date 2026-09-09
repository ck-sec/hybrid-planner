import {
  buildTargetWeek,
  parseAndValidatePastedPlan,
  type AiWeekCopyPasteContract,
  type ClubTimetableCommitment,
  type ContinuationWeekPromptInput,
  type FixedClubSession as AiFixedClubSession,
  type InitialWeekPromptInput,
  type LoggedWorkout,
  type LoggedWorkoutStep,
  type PlannedWorkout,
  type PreviousWeekContext,
  type ValidationIssue,
  type WeekPromptKind,
  type WorkoutChangeType,
  type WorkoutStepContract,
} from '../../ai/index.ts'
import {
  isFullySpecifiedClubSession,
  parseAthleteProfile,
  parseWeekImportBundle,
  parseWeekPlan,
  parseWorkout,
  parseWorkoutLog,
  type AthleteProfile,
  type FixedClubSession,
  type FullySpecifiedRecurringClubSession,
  type PreferredTrainingDay,
  type RecurringClubSession,
  type WeekImportBundle,
  type WeekPlan,
  type Workout,
  type WorkoutEffort,
  type WorkoutLog,
  type WorkoutLogMetrics,
  type WorkoutLogStep,
  type WorkoutStep,
  type WorkoutStepTarget,
} from '../../domain/contracts.ts'
import { parseStableIdentity } from '../../domain/identity.ts'
import { addDaysToLocalDate, localDateDayOfWeek, parseLocalDate, type LocalDateString } from '../../domain/local-date.ts'
import type { ImportIssue, JsonImportPreview, JsonPreviewGroup } from '../features/models.ts'

const MAX_WORKOUT_TITLE_LENGTH = 120
const MAX_WORKOUT_PURPOSE_LENGTH = 500
const MAX_NOTES_LENGTH = 2_000
const MAX_STEP_TITLE_LENGTH = 120
const METADATA_PREFIX = 'AI metadata'

export interface TrackedWorkoutChange {
  workoutId: string
  type: WorkoutChangeType
  fromDate?: LocalDateString
  toDate?: LocalDateString
  note?: string
  workoutSnapshot?: Workout
}

export interface BuildPromptInputOptions {
  warmupRequirement?: string
}

export interface BuildContinuationPromptInputOptions extends BuildPromptInputOptions {
  trackedChanges?: readonly TrackedWorkoutChange[]
}

export interface WeekImportBuildOptions {
  athlete: AthleteProfile
  targetWeekStart: LocalDateString
  expectedWeekType: WeekPromptKind
  weekPlanId?: string
  weekTitle?: string
}

export type JsonHandoffPreviewState =
  | {
    ok: true
    canApply: true
    contract: AiWeekCopyPasteContract
    bundle: WeekImportBundle
    preview: JsonImportPreview
    issues: readonly ImportIssue[]
  }
  | {
    ok: false
    canApply: false
    preview: null
    issues: readonly ImportIssue[]
  }

class ConversionError extends Error {
  readonly path: string
  readonly code: string
  readonly suggestion?: string

  constructor(path: string, code: string, message: string, suggestion?: string) {
    super(message)
    this.name = 'ConversionError'
    this.path = path
    this.code = code
    this.suggestion = suggestion
  }
}

function issue(path: string, code: string, message: string, suggestion?: string): ValidationIssue {
  return { path, code, message, ...(suggestion === undefined ? {} : { suggestion }) }
}

function fail(path: string, code: string, message: string, suggestion?: string): never {
  throw new ConversionError(path, code, message, suggestion)
}

function mapConversionError(error: unknown, fallbackPath = 'domain'): ValidationIssue {
  if (error instanceof ConversionError) {
    return issue(error.path, error.code, error.message, error.suggestion)
  }
  if (error instanceof Error) {
    return issue(fallbackPath, 'conversion_failed', error.message)
  }
  return issue(fallbackPath, 'conversion_failed', 'The AI handoff could not be converted.')
}

function sanitizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function sortByDateTimeId<T extends { id: string; scheduledDate: LocalDateString; startTime?: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) =>
    left.scheduledDate.localeCompare(right.scheduledDate)
    || (left.startTime ?? '').localeCompare(right.startTime ?? '')
    || left.id.localeCompare(right.id))
}

function sortTrainingDays(days: readonly PreferredTrainingDay[]): PreferredTrainingDay[] {
  return [...days].sort((left, right) =>
    left.dayOfWeek - right.dayOfWeek
    || (left.preferredStartTime ?? '').localeCompare(right.preferredStartTime ?? '')
    || left.modalities.join(',').localeCompare(right.modalities.join(',')))
}

function buildFixedClubSessionNotes(session: FullySpecifiedRecurringClubSession): string | undefined {
  const parts = [
    `Scope: ${session.scope}`,
    ...(sanitizeText(session.notes) ? [`Notes: ${sanitizeText(session.notes)!}`] : []),
  ]
  return parts.length ? parts.join('; ') : undefined
}

function inferFixedClubModality(session: FullySpecifiedRecurringClubSession, athlete: AthleteProfile): string | undefined {
  if (session.category !== 'aerobic') return undefined
  const text = `${session.title} ${session.scope} ${session.notes ?? ''}`.toLowerCase()
  if (/(run|track|road|trail|marathon|jog)/.test(text)) return 'running'
  if (/(ride|bike|bik|cycle|cycling|velo)/.test(text)) return 'cycling'
  if (/(swim|pool|open water)/.test(text)) return 'swimming'
  if (/(row|erg)/.test(text)) return 'rowing'
  if (/(ski)/.test(text)) return 'ski-erg'
  const aerobicSports = athlete.sports
    .map(sport => sport.toLowerCase())
    .filter(sport => !/(strength|mobility|gym|lifting)/.test(sport))
  return aerobicSports.length === 1 ? athlete.sports.find(sport => sport.toLowerCase() === aerobicSports[0]) : undefined
}

function buildFixedClubSessionDate(targetWeekStart: LocalDateString, dayOfWeek: number): LocalDateString {
  const weekStartDay = localDateDayOfWeek(targetWeekStart)
  const offset = (dayOfWeek - weekStartDay + 7) % 7
  return addDaysToLocalDate(targetWeekStart, offset)
}

function normalizeTrackedChange(change: TrackedWorkoutChange): TrackedWorkoutChange {
  return {
    workoutId: parseStableIdentity(change.workoutId, 'TrackedWorkoutChange.workoutId'),
    type: change.type,
    ...(change.fromDate === undefined ? {} : { fromDate: parseLocalDate(change.fromDate, 'TrackedWorkoutChange.fromDate') }),
    ...(change.toDate === undefined ? {} : { toDate: parseLocalDate(change.toDate, 'TrackedWorkoutChange.toDate') }),
    ...(sanitizeText(change.note) ? { note: sanitizeText(change.note)! } : {}),
    ...(change.workoutSnapshot === undefined ? {} : { workoutSnapshot: parseWorkout(change.workoutSnapshot) }),
  }
}

function toEffortLabel(effortRating: number | undefined): string | undefined {
  return effortRating === undefined ? undefined : `RPE ${effortRating}/10`
}

function formatPaceSecondsPerKm(secondsPerKm: number): string {
  const hours = Math.floor(secondsPerKm / 3_600)
  const minutes = Math.floor((secondsPerKm % 3_600) / 60)
  const seconds = secondsPerKm % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}/km`
  return `${minutes}:${String(seconds).padStart(2, '0')}/km`
}

function buildMetricSummary(metrics: WorkoutLogMetrics | undefined): string[] {
  if (!metrics) return []
  const parts: string[] = []
  if (metrics.durationMin !== undefined) parts.push(`Duration ${metrics.durationMin} min`)
  if (metrics.movingTimeMin !== undefined) parts.push(`Moving time ${metrics.movingTimeMin} min`)
  if (metrics.elapsedTimeMin !== undefined) parts.push(`Elapsed time ${metrics.elapsedTimeMin} min`)
  if (metrics.distanceMeters !== undefined) parts.push(`Distance ${metrics.distanceMeters} m`)
  if (metrics.paceSecondsPerKm !== undefined) parts.push(`Pace ${formatPaceSecondsPerKm(metrics.paceSecondsPerKm)}`)
  if (metrics.averageHeartRate !== undefined) parts.push(`Average heart rate ${metrics.averageHeartRate} bpm`)
  return parts
}

function buildStepResultNotes(step: WorkoutLogStep): string | undefined {
  const parts: string[] = []
  if (sanitizeText(step.notes)) parts.push(sanitizeText(step.notes)!)
  if (step.completedPaceSecondsPerKm !== undefined) parts.push(`Completed pace: ${formatPaceSecondsPerKm(step.completedPaceSecondsPerKm)}`)
  return parts.length ? parts.join('\n') : undefined
}

function toLoggedWorkoutStep(step: WorkoutLogStep): LoggedWorkoutStep {
  return {
    stepId: step.stepId,
    ...(step.completedSets === undefined ? {} : { completedSets: step.completedSets }),
    ...(step.completedReps === undefined ? {} : { completedReps: step.completedReps }),
    ...(step.completedMinutes === undefined && step.completedSeconds === undefined
      ? {}
      : { completedDurationMin: step.completedMinutes ?? step.completedSeconds! / 60 }),
    ...(step.completedDistanceMeters === undefined ? {} : { completedDistanceMeters: step.completedDistanceMeters }),
    ...(step.loadKg === undefined ? {} : { loadKg: step.loadKg }),
    ...(buildStepResultNotes(step) ? { note: buildStepResultNotes(step)! } : {}),
  }
}

function toLoggedWorkout(log: WorkoutLog): LoggedWorkout {
  const metricSummary = buildMetricSummary(log.metrics)
  const notes = [
    ...(sanitizeText(log.notes) ? [sanitizeText(log.notes)!] : []),
    ...(metricSummary.length ? [`Metrics: ${metricSummary.join('; ')}`] : []),
  ]
  return {
    completionStatus: log.outcome,
    ...(toEffortLabel(log.effortRating) ? { effort: toEffortLabel(log.effortRating)! } : {}),
    ...(notes.length ? { notes: notes.join('\n') } : {}),
    ...(log.steps.length ? { steps: log.steps.map(toLoggedWorkoutStep) } : {}),
  }
}

function toPromptStep(step: WorkoutStep): WorkoutStepContract {
  return {
    id: step.id,
    instruction: step.title,
    ...(sanitizeText(step.detail) ? { notes: sanitizeText(step.detail)! } : {}),
    ...(step.target?.sets === undefined ? {} : { sets: step.target.sets }),
    ...(step.target?.reps === undefined ? {} : { reps: step.target.reps }),
    ...(step.target?.loadKg === undefined ? {} : { loadKg: step.target.loadKg }),
    ...(step.target?.distanceMeters === undefined ? {} : { distanceMeters: step.target.distanceMeters }),
    ...(step.target?.minutes === undefined ? {} : { durationMin: step.target.minutes }),
    ...(step.target?.effort === undefined ? {} : { effort: step.target.effort }),
  }
}

function toPromptWorkout(workout: Workout): PlannedWorkout {
  const notes: string[] = []
  if (workout.source === 'manual') notes.push('Planner source: manual')
  if (sanitizeText(workout.notes)) notes.push(sanitizeText(workout.notes)!)
  return {
    id: workout.id,
    date: workout.scheduledDate,
    startTime: workout.startTime ?? workout.fixedClubSession?.startTime ?? '00:00',
    category: workout.category,
    title: workout.title,
    purpose: workout.purpose,
    expectedDuration: workout.expectedDurationMin,
    warmup: workout.warmup.map(toPromptStep),
    main: workout.main.map(toPromptStep),
    cooldown: workout.cooldown.map(toPromptStep),
    source: workout.source === 'club' && workout.fixedClubSession
      ? {
        kind: 'fixed_club',
        fixedClub: {
          sessionId: workout.fixedClubSession.recurringSessionId,
          label: workout.fixedClubSession.title,
          date: workout.scheduledDate,
          startTime: workout.fixedClubSession.startTime,
          durationMin: workout.fixedClubSession.durationMin,
          category: workout.fixedClubSession.category,
          notes: `Scope: ${workout.fixedClubSession.scope}`,
        },
      }
      : { kind: 'ai' },
    ...(notes.length ? { notes: notes.join('\n') } : {}),
  }
}

function buildPreviousWeekSummary(workouts: ReadonlyArray<PreviousWeekContext['workouts'][number]>): string {
  const completionCounts = {
    completed: 0,
    partial: 0,
    skipped: 0,
    unlogged: 0,
  }
  const changeCounts = {
    moved: 0,
    added: 0,
    deleted: 0,
  }
  for (const workout of workouts) {
    const status = workout.actualLog?.completionStatus ?? 'unlogged'
    completionCounts[status] += 1
    for (const change of workout.changes ?? []) changeCounts[change.type] += 1
  }
  const completionSummary = Object.entries(completionCounts)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${count} ${label}`)
    .join(', ')
  const changeSummary = Object.entries(changeCounts)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${count} ${label}`)
    .join(', ')
  return [
    `${workouts.length} prior workouts`,
    completionSummary ? `completion: ${completionSummary}` : '',
    changeSummary ? `changes: ${changeSummary}` : '',
  ].filter(Boolean).join('; ')
}

function buildExpectedFixedClubSessionsInternal(athlete: AthleteProfile, targetWeekStart: LocalDateString): readonly AiFixedClubSession[] {
  const targetWeek = buildTargetWeek(targetWeekStart)
  const dates = targetWeek.dates.map(date => parseLocalDate(date))
  const fixedSessions = athlete.clubSessions.filter(isFullySpecifiedClubSession).map(session => {
    const date = dates.find(candidate => localDateDayOfWeek(candidate) === session.dayOfWeek)
    if (!date) {
      fail('targetWeek', 'missing_week_day', `Could not place recurring club session "${session.id}" inside the target week.`)
    }
    return {
      sessionId: session.id,
      label: session.title,
      date,
      startTime: session.startTime,
      durationMin: session.durationMin,
      category: session.category,
      ...(inferFixedClubModality(session, athlete) ? { modality: inferFixedClubModality(session, athlete)! } : {}),
      ...(buildFixedClubSessionNotes(session) ? { notes: buildFixedClubSessionNotes(session)! } : {}),
    }
  })
  return [...fixedSessions].sort((left, right) =>
    left.date.localeCompare(right.date)
    || left.startTime.localeCompare(right.startTime)
    || left.sessionId!.localeCompare(right.sessionId!))
}

function buildClubTimetableCommitments(athlete: AthleteProfile, targetWeekStart: LocalDateString): readonly ClubTimetableCommitment[] {
  return athlete.clubSessions
    .filter(session => !isFullySpecifiedClubSession(session))
    .map(session => ({
      sessionId: session.id,
      title: session.title,
      dayOfWeek: session.dayOfWeek,
      date: buildFixedClubSessionDate(targetWeekStart, session.dayOfWeek),
      startTime: session.startTime,
      ...(session.notes === undefined ? {} : { notes: session.notes }),
      ...(session.scope === undefined ? {} : { scope: session.scope }),
      ...(session.category === undefined ? {} : { category: session.category }),
      ...(session.durationMin === undefined ? {} : { durationMin: session.durationMin }),
    }))
    .sort((left, right) =>
      left.date.localeCompare(right.date)
      || left.startTime.localeCompare(right.startTime)
      || left.sessionId.localeCompare(right.sessionId))
}

function appendMetadataBlock(base: string | undefined, lines: readonly string[]): string | undefined {
  const normalizedBase = sanitizeText(base)
  const normalizedLines = lines.map(line => sanitizeText(line)).filter((line): line is string => Boolean(line))
  if (!normalizedBase && !normalizedLines.length) return undefined
  const sections = [
    ...(normalizedBase ? [normalizedBase] : []),
    ...(normalizedLines.length ? [`${METADATA_PREFIX}:\n${normalizedLines.join('\n')}`] : []),
  ]
  const combined = sections.join('\n\n')
  if (combined.length > MAX_NOTES_LENGTH) {
    fail('notes', 'notes_too_long', 'The converted notes exceed the domain note limit.', 'Shorten the AI notes or remove unsupported extra metadata.')
  }
  return combined
}

function truncateText(value: string, maximum: number): string {
  if (value.length <= maximum) return value
  return `${value.slice(0, maximum - 3).trimEnd()}...`
}

function deriveCompactText(value: string, maximum: number): string {
  const firstLine = value.split(/\r?\n/, 1)[0]?.trim() ?? value.trim()
  if (firstLine.length <= maximum) return firstLine
  const firstSentence = value.split(/[.!?](?:\s|$)/, 1)[0]?.trim()
  if (firstSentence && firstSentence.length <= maximum) return firstSentence
  return truncateText(value, maximum)
}

function normalizeEffort(value: string | undefined): { normalized?: WorkoutEffort; original?: string } {
  const original = sanitizeText(value)
  if (!original) return {}
  const normalized = original.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const direct = new Set<WorkoutEffort>(['recovery', 'easy', 'steady', 'tempo', 'hard', 'max'])
  if (direct.has(normalized as WorkoutEffort)) {
    return { normalized: normalized as WorkoutEffort }
  }
  const rpe = /(?:^|\s)rpe\s*([1-9]|10)(?:\s|$)/.exec(normalized)
  if (rpe) {
    const rating = Number(rpe[1])
    if (rating <= 2) return { normalized: 'recovery', original }
    if (rating <= 4) return { normalized: 'easy', original }
    if (rating <= 6) return { normalized: 'steady', original }
    if (rating === 7) return { normalized: 'tempo', original }
    if (rating <= 9) return { normalized: 'hard', original }
    return { normalized: 'max', original }
  }
  if (/(recovery|very easy|light)/.test(normalized)) return { normalized: 'recovery', original }
  if (/(easy|conversational|zone 2)/.test(normalized)) return { normalized: 'easy', original }
  if (/(steady|moderate|controlled|aerobic|zone 3)/.test(normalized)) return { normalized: 'steady', original }
  if (/(tempo|threshold|comfortably hard|zone 4)/.test(normalized)) return { normalized: 'tempo', original }
  if (/(hard|vo2|max effort intervals|zone 5|interval)/.test(normalized)) return { normalized: 'hard', original }
  if (/(max|all out|sprint)/.test(normalized)) return { normalized: 'max', original }
  return { original }
}

function buildStepTitleAndDetail(step: WorkoutStepContract, path: string): { title: string; detail?: string } {
  const fullInstruction = sanitizeText(step.instruction)
  if (!fullInstruction) fail(path, 'missing_instruction', 'Each workout step needs an instruction.')
  const title = deriveCompactText(fullInstruction, MAX_STEP_TITLE_LENGTH)
  const effort = normalizeEffort(step.effort)
  const detailLines = [
    ...(title !== fullInstruction ? [`Instruction: ${fullInstruction}`] : []),
    ...(sanitizeText(step.purpose) ? [`Purpose: ${sanitizeText(step.purpose)!}`] : []),
    ...(sanitizeText(step.modality) ? [`Modality: ${sanitizeText(step.modality)!}`] : []),
    ...(sanitizeText(step.pace) ? [`Pace: ${sanitizeText(step.pace)!}`] : []),
    ...(step.restSeconds === undefined ? [] : [`Rest: ${step.restSeconds} sec`]),
    ...(sanitizeText(step.notes) ? [`Notes: ${sanitizeText(step.notes)!}`] : []),
    ...(effort.original && effort.normalized !== step.effort ? [`Original effort: ${effort.original}`] : []),
  ]
  const detail = detailLines.length ? detailLines.join('\n') : undefined
  if (detail && detail.length > MAX_NOTES_LENGTH) {
    fail(path, 'detail_too_long', 'The converted step detail exceeds the domain detail limit.', 'Shorten the AI instruction or notes for this step.')
  }
  return { title, ...(detail ? { detail } : {}) }
}

function buildStepTarget(step: WorkoutStepContract): WorkoutStepTarget | undefined {
  const effort = normalizeEffort(step.effort)
  const target: WorkoutStepTarget = {}
  if (step.sets !== undefined) target.sets = step.sets
  if (step.reps !== undefined) target.reps = step.reps
  if (step.loadKg !== undefined) target.loadKg = step.loadKg
  if (step.distanceMeters !== undefined) target.distanceMeters = step.distanceMeters
  if (step.durationMin !== undefined) target.minutes = step.durationMin
  if (effort.normalized !== undefined) target.effort = effort.normalized
  return Object.keys(target).length ? target : undefined
}

function convertStep(step: WorkoutStepContract, path: string): WorkoutStep {
  const titleAndDetail = buildStepTitleAndDetail(step, path)
  return {
    id: parseStableIdentity(step.id, `${path}.id`),
    title: titleAndDetail.title,
    ...(titleAndDetail.detail ? { detail: titleAndDetail.detail } : {}),
    ...(buildStepTarget(step) ? { target: buildStepTarget(step)! } : {}),
  }
}

function buildFixedClubLookup(athlete: AthleteProfile, targetWeekStart: LocalDateString) {
  const byId = new Map<string, { recurring: FullySpecifiedRecurringClubSession; prompt: AiFixedClubSession; scheduledDate: LocalDateString }>()
  const promptSessions = buildExpectedFixedClubSessionsInternal(athlete, targetWeekStart)
  for (const session of athlete.clubSessions.filter(isFullySpecifiedClubSession)) {
    const scheduledDate = buildFixedClubSessionDate(targetWeekStart, session.dayOfWeek)
    const prompt = promptSessions.find(entry => entry.sessionId === session.id)
    if (!prompt) fail('clubSessions', 'missing_fixed_club', `Missing recurring club session "${session.id}" in the fixed-club lookup.`)
    byId.set(session.id, { recurring: session, prompt, scheduledDate })
  }
  return byId
}

function validateFixedClubWorkouts(contract: AiWeekCopyPasteContract, athlete: AthleteProfile, targetWeekStart: LocalDateString): ValidationIssue[] {
  const lookup = buildFixedClubLookup(athlete, targetWeekStart)
  const issues: ValidationIssue[] = []
  const seen = new Map<string, number[]>()
  contract.workouts.forEach((workout, index) => {
    if (workout.source.kind !== 'fixed_club') return
    const sessionId = workout.source.fixedClub.sessionId
    const matches = seen.get(sessionId) ?? []
    matches.push(index)
    seen.set(sessionId, matches)
    const expected = lookup.get(sessionId)
    if (!expected) {
      issues.push(issue(`workouts[${index}].source.fixedClub.sessionId`, 'unexpected_fixed_club', `Unexpected fixed club session "${sessionId}".`, 'Use only recurring club sessions from the athlete profile.'))
      return
    }
    if (workout.category !== expected.recurring.category) {
      issues.push(issue(`workouts[${index}].category`, 'mismatched_fixed_club', `Fixed club workout "${sessionId}" must stay in category "${expected.recurring.category}".`, 'Keep the fixed club card category unchanged.'))
    }
    if (workout.source.fixedClub.category !== expected.recurring.category) {
      issues.push(issue(`workouts[${index}].source.fixedClub.category`, 'mismatched_fixed_club', `Fixed club workout "${sessionId}" must carry source.fixedClub.category "${expected.recurring.category}".`, 'Return the recurring club category explicitly on the fixed club card.'))
    }
    if (workout.source.fixedClub.label !== expected.recurring.title) {
      issues.push(issue(`workouts[${index}].source.fixedClub.label`, 'mismatched_fixed_club', `Fixed club workout "${sessionId}" must keep the title "${expected.recurring.title}".`, 'Keep the recurring club title unchanged.'))
    }
    if (workout.source.fixedClub.date !== expected.scheduledDate) {
      issues.push(issue(`workouts[${index}].source.fixedClub.date`, 'mismatched_fixed_club', `Fixed club workout "${sessionId}" must stay on ${expected.scheduledDate}.`, 'Keep the recurring club date unchanged.'))
    }
    if (workout.source.fixedClub.startTime !== expected.recurring.startTime) {
      issues.push(issue(`workouts[${index}].source.fixedClub.startTime`, 'mismatched_fixed_club', `Fixed club workout "${sessionId}" must keep start time ${expected.recurring.startTime}.`, 'Keep the recurring club start time unchanged.'))
    }
    if (workout.source.fixedClub.durationMin !== expected.recurring.durationMin) {
      issues.push(issue(`workouts[${index}].source.fixedClub.durationMin`, 'mismatched_fixed_club', `Fixed club workout "${sessionId}" must keep duration ${expected.recurring.durationMin} minutes.`, 'Keep the recurring club duration unchanged.'))
    }
  })
  for (const [sessionId] of lookup) {
    const matches = seen.get(sessionId) ?? []
    if (matches.length === 0) {
      issues.push(issue('workouts', 'missing_fixed_club', `Missing fixed club workout for "${sessionId}".`, 'Return every recurring club card exactly once.'))
    }
    if (matches.length > 1) {
      issues.push(issue('workouts', 'duplicate_fixed_club', `Fixed club workout "${sessionId}" appears more than once.`, 'Return each recurring club card exactly once.'))
    }
  }
  return issues
}

function buildWeekPlanId(athleteId: string, targetWeekStart: LocalDateString, explicitId?: string): string {
  const candidate = explicitId ?? `week-${targetWeekStart}-${athleteId}`
  return parseStableIdentity(candidate, 'WeekImportBundle.weekPlan.id')
}

function buildWeekTitle(targetWeekStart: LocalDateString, explicitTitle?: string): string {
  const title = sanitizeText(explicitTitle) ?? `Week of ${targetWeekStart}`
  return title.length <= MAX_WORKOUT_TITLE_LENGTH ? title : truncateText(title, MAX_WORKOUT_TITLE_LENGTH)
}

function buildWeekPlanNotes(contract: AiWeekCopyPasteContract): string | undefined {
  const notes = appendMetadataBlock(undefined, [
    `Week type: ${contract.weekType}`,
    `Summary: ${contract.summary}`,
  ])
  if (notes && notes.length > MAX_NOTES_LENGTH) {
    fail('summary', 'summary_too_long', 'The AI summary is too long to preserve in week notes.', 'Shorten the AI summary.')
  }
  return notes
}

function buildWorkoutNotes(workout: PlannedWorkout, recurringSession: RecurringClubSession | undefined): string | undefined {
  const metadata = [
    ...(sanitizeText(workout.modality) ? [`Modality: ${sanitizeText(workout.modality)!}`] : []),
    ...(workout.source.kind === 'fixed_club' && sanitizeText(workout.source.fixedClub.notes)
      ? [`Fixed club notes: ${sanitizeText(workout.source.fixedClub.notes)!}`]
      : []),
    ...(workout.source.kind === 'fixed_club' && recurringSession ? [`Fixed club scope: ${recurringSession.scope}`] : []),
  ]
  return appendMetadataBlock(workout.notes, metadata)
}

function convertWorkoutFromContract(
  workout: PlannedWorkout,
  index: number,
  athlete: AthleteProfile,
  weekPlanId: string,
  targetWeekStart: LocalDateString,
): Workout {
  const fixedClubLookup = buildFixedClubLookup(athlete, targetWeekStart)
  const recurringSession = workout.source.kind === 'fixed_club'
    ? fixedClubLookup.get(workout.source.fixedClub.sessionId)?.recurring
    : undefined
  if (workout.source.kind === 'fixed_club' && !recurringSession) {
    fail(`workouts[${index}].source.fixedClub.sessionId`, 'missing_fixed_club', `Could not resolve recurring club session "${workout.source.fixedClub.sessionId}".`, 'Use a recurring club session from the athlete profile.')
  }
  const title = sanitizeText(workout.title)
  if (!title) fail(`workouts[${index}].title`, 'missing_title', 'Each workout needs a title.')
  const purpose = sanitizeText(workout.purpose)
  if (!purpose) fail(`workouts[${index}].purpose`, 'missing_purpose', 'Each workout needs a purpose.')
  const workoutNotes = buildWorkoutNotes(workout, recurringSession)
  return {
    version: 1,
    id: parseStableIdentity(workout.id, `workouts[${index}].id`),
    athleteId: athlete.id,
    weekPlanId,
    scheduledDate: parseLocalDate(workout.date, `workouts[${index}].date`),
    startTime: workout.startTime,
    category: workout.category,
    source: workout.source.kind === 'fixed_club' ? 'club' : 'ai',
    title: title.length <= MAX_WORKOUT_TITLE_LENGTH ? title : deriveCompactText(title, MAX_WORKOUT_TITLE_LENGTH),
    purpose: purpose.length <= MAX_WORKOUT_PURPOSE_LENGTH ? purpose : truncateText(purpose, MAX_WORKOUT_PURPOSE_LENGTH),
    expectedDurationMin: workout.expectedDuration,
    warmup: workout.warmup.map((step, stepIndex) => convertStep(step, `workouts[${index}].warmup[${stepIndex}]`)),
    main: workout.main.map((step, stepIndex) => convertStep(step, `workouts[${index}].main[${stepIndex}]`)),
    cooldown: workout.cooldown.map((step, stepIndex) => convertStep(step, `workouts[${index}].cooldown[${stepIndex}]`)),
    ...(workout.source.kind === 'fixed_club' && recurringSession
      ? {
        fixedClubSession: {
          recurringSessionId: recurringSession.id,
          title: recurringSession.title,
          scope: recurringSession.scope,
          category: recurringSession.category,
          dayOfWeek: recurringSession.dayOfWeek,
          startTime: recurringSession.startTime,
          durationMin: recurringSession.durationMin,
        } satisfies FixedClubSession,
      }
      : {}),
    ...(workoutNotes ? { notes: workoutNotes } : {}),
  }
}

function mapValidationIssuesToImportIssues(issues: readonly ValidationIssue[]): ImportIssue[] {
  return issues.map((entry, index) => ({
    id: `issue-${index + 1}`,
    severity: 'error',
    message: entry.message,
    ...(entry.path ? { path: entry.path } : {}),
    ...(entry.suggestion ? { suggestion: entry.suggestion } : {}),
  }))
}

function buildPreview(bundle: WeekImportBundle, contract: AiWeekCopyPasteContract, athlete: AthleteProfile): JsonImportPreview {
  const groups: JsonPreviewGroup[] = [
    {
      id: 'week-summary',
      title: 'Week',
      items: [
        { label: 'Athlete', value: athlete.name },
        { label: 'Week start', value: bundle.weekPlan.weekStart },
        { label: 'Week title', value: bundle.weekPlan.title },
        { label: 'Goal', value: bundle.weekPlan.goal },
        { label: 'AI week type', value: contract.weekType },
      ],
    },
  ]
  for (const workout of sortByDateTimeId(bundle.weekPlan.workouts)) {
    groups.push({
      id: `workout-${workout.id}`,
      title: `${workout.scheduledDate} - ${workout.title}`,
      items: [
        { label: 'Category', value: workout.category },
        { label: 'Source', value: workout.source },
        { label: 'Start time', value: workout.startTime ?? 'Unspecified' },
        { label: 'Expected duration', value: `${workout.expectedDurationMin} min` },
        { label: 'Purpose', value: workout.purpose },
        { label: 'Warm-up steps', value: String(workout.warmup.length) },
        { label: 'Main steps', value: String(workout.main.length) },
        { label: 'Cooldown steps', value: String(workout.cooldown.length) },
        ...(workout.fixedClubSession
          ? [{ label: 'Fixed club', value: `${workout.fixedClubSession.title} (${workout.fixedClubSession.scope})` }]
          : []),
      ],
    })
  }
  const fixedClubCount = bundle.weekPlan.workouts.filter(workout => workout.source === 'club').length
  return {
    title: 'Week import preview',
    summary: [
      `${bundle.weekPlan.workouts.length} workouts ready to import`,
      `${fixedClubCount} fixed club sessions validated`,
      'AI summary preserved in week notes',
    ],
    groups,
  }
}

function safeConvertAiWeekContractToBundle(contract: AiWeekCopyPasteContract, options: WeekImportBuildOptions): { ok: true; bundle: WeekImportBundle } | { ok: false; issues: ValidationIssue[] } {
  const athlete = parseAthleteProfile(options.athlete)
  const targetWeekStart = parseLocalDate(options.targetWeekStart, 'targetWeekStart')
  const fixedClubIssues = validateFixedClubWorkouts(contract, athlete, targetWeekStart)
  if (fixedClubIssues.length) return { ok: false, issues: fixedClubIssues }
  const weekPlanId = buildWeekPlanId(athlete.id, targetWeekStart, options.weekPlanId)
  try {
    const weekPlan = {
      version: 1 as const,
      id: weekPlanId,
      athleteId: athlete.id,
      weekStart: targetWeekStart,
      title: buildWeekTitle(targetWeekStart, options.weekTitle),
      goal: athlete.goal,
      workouts: contract.workouts.map((workout, index) => convertWorkoutFromContract(workout, index, athlete, weekPlanId, targetWeekStart)),
      ...(buildWeekPlanNotes(contract) ? { notes: buildWeekPlanNotes(contract)! } : {}),
    }
    return {
      ok: true,
      bundle: parseWeekImportBundle({
        weekPlan,
        workoutLogs: [],
      }),
    }
  } catch (error) {
    return { ok: false, issues: [mapConversionError(error)] }
  }
}

export function buildExpectedFixedClubSessions(athlete: AthleteProfile, targetWeekStart: LocalDateString): readonly AiFixedClubSession[] {
  const validatedAthlete = parseAthleteProfile(athlete)
  const validatedTargetWeekStart = parseLocalDate(targetWeekStart, 'targetWeekStart')
  return buildExpectedFixedClubSessionsInternal(validatedAthlete, validatedTargetWeekStart)
}

export function buildInitialPromptInputFromAthleteProfile(
  athlete: AthleteProfile,
  targetWeekStart: LocalDateString,
  options: BuildPromptInputOptions = {},
): InitialWeekPromptInput {
  const validatedAthlete = parseAthleteProfile(athlete)
  const validatedTargetWeekStart = parseLocalDate(targetWeekStart, 'targetWeekStart')
  return {
    profile: {
      athleteId: validatedAthlete.id,
      name: validatedAthlete.name,
      goal: validatedAthlete.goal,
      ...(validatedAthlete.goalDate ? { goalDate: validatedAthlete.goalDate } : {}),
      sports: [...validatedAthlete.sports],
      constraints: [...validatedAthlete.constraints],
      ...(sanitizeText(validatedAthlete.notes) ? { notes: sanitizeText(validatedAthlete.notes)! } : {}),
    },
    equipment: {
      items: validatedAthlete.equipmentDetails.map(detail => ({
        id: detail.id,
        label: detail.label,
        constraints: [...detail.constraints],
        ...(sanitizeText(detail.notes) ? { notes: sanitizeText(detail.notes)! } : {}),
      })),
    },
    preferences: {
      preferredWeeklyStructure: sortTrainingDays(validatedAthlete.preferredWeeklyStructure).map(day => ({
        dayOfWeek: day.dayOfWeek,
        modalities: [...day.modalities],
        ...(day.preferredStartTime ? { preferredStartTime: day.preferredStartTime } : {}),
        ...(day.expectedDurationMin ? { expectedDurationMin: day.expectedDurationMin } : {}),
        ...(sanitizeText(day.notes) ? { notes: sanitizeText(day.notes)! } : {}),
      })),
      ...(validatedAthlete.strengthPreference === undefined ? {} : { strengthPreference: validatedAthlete.strengthPreference }),
    },
    fixedClubSessions: buildExpectedFixedClubSessionsInternal(validatedAthlete, validatedTargetWeekStart),
    clubTimetableCommitments: buildClubTimetableCommitments(validatedAthlete, validatedTargetWeekStart),
    targetWeekStartDate: validatedTargetWeekStart,
    ...(sanitizeText(options.warmupRequirement) ? { warmupRequirement: sanitizeText(options.warmupRequirement)! } : {}),
  }
}

export function buildContinuationWeekContext(
  weekPlan: WeekPlan,
  workoutLogs: readonly WorkoutLog[],
  trackedChanges: readonly TrackedWorkoutChange[] = [],
): PreviousWeekContext {
  const validatedWeekPlan = parseWeekPlan(weekPlan)
  const normalizedChanges = trackedChanges.map(normalizeTrackedChange)
  const workoutsById = new Map<string, Workout>(validatedWeekPlan.workouts.map(workout => [workout.id, workout]))
  for (const change of normalizedChanges) {
    if (change.workoutSnapshot && !workoutsById.has(change.workoutId)) workoutsById.set(change.workoutId, change.workoutSnapshot)
    if (!workoutsById.has(change.workoutId)) {
      fail('trackedChanges', 'missing_workout_snapshot', `Tracked change "${change.type}" for workout "${change.workoutId}" needs a workoutSnapshot when the workout is not in the saved week plan.`)
    }
  }
  const relevantLogs = workoutLogs
    .map(log => parseWorkoutLog(log))
    .filter(log => log.athleteId === validatedWeekPlan.athleteId && log.weekPlanId === validatedWeekPlan.id && workoutsById.has(log.workoutId))
    .sort((left, right) => right.loggedOn.localeCompare(left.loggedOn) || left.id.localeCompare(right.id))
  const latestLogByWorkoutId = new Map<string, WorkoutLog>()
  for (const log of relevantLogs) {
    if (!latestLogByWorkoutId.has(log.workoutId)) latestLogByWorkoutId.set(log.workoutId, log)
  }
  const changesByWorkoutId = new Map<string, TrackedWorkoutChange[]>()
  for (const change of normalizedChanges) {
    const list = changesByWorkoutId.get(change.workoutId) ?? []
    list.push(change)
    changesByWorkoutId.set(change.workoutId, list)
  }
  const workouts = sortByDateTimeId([...workoutsById.values()]).map(workout => ({
    original: toPromptWorkout(workout),
    ...(latestLogByWorkoutId.get(workout.id) ? { actualLog: toLoggedWorkout(latestLogByWorkoutId.get(workout.id)!) } : {}),
    ...(changesByWorkoutId.get(workout.id)?.length
      ? {
        changes: [...changesByWorkoutId.get(workout.id)!]
          .sort((left, right) =>
            (left.fromDate ?? '').localeCompare(right.fromDate ?? '')
            || (left.toDate ?? '').localeCompare(right.toDate ?? '')
            || left.type.localeCompare(right.type)
            || left.workoutId.localeCompare(right.workoutId))
          .map(change => ({
            type: change.type,
            ...(change.fromDate ? { fromDate: change.fromDate } : {}),
            ...(change.toDate ? { toDate: change.toDate } : {}),
            ...(change.note ? { note: change.note } : {}),
          })),
      }
      : {}),
  }))
  return {
    weekStart: validatedWeekPlan.weekStart,
    weekEnd: addDaysToLocalDate(validatedWeekPlan.weekStart, 6),
    summary: buildPreviousWeekSummary(workouts),
    workouts,
  }
}

export function buildContinuationPromptInputFromAthleteProfile(
  athlete: AthleteProfile,
  targetWeekStart: LocalDateString,
  weekPlan: WeekPlan,
  workoutLogs: readonly WorkoutLog[],
  options: BuildContinuationPromptInputOptions = {},
): ContinuationWeekPromptInput {
  return {
    ...buildInitialPromptInputFromAthleteProfile(athlete, targetWeekStart, options),
    previousWeek: buildContinuationWeekContext(weekPlan, workoutLogs, options.trackedChanges),
  }
}

export function convertAiWeekContractToWeekImportBundle(contract: AiWeekCopyPasteContract, options: WeekImportBuildOptions): WeekImportBundle {
  const result = safeConvertAiWeekContractToBundle(contract, options)
  if (!result.ok) {
    const [firstIssue] = result.issues
    fail(firstIssue?.path ?? 'domain', firstIssue?.code ?? 'conversion_failed', firstIssue?.message ?? 'Could not convert the AI week contract.')
  }
  return result.bundle
}

export function previewAiWeekHandoff(jsonText: string, options: WeekImportBuildOptions): JsonHandoffPreviewState {
  const athlete = parseAthleteProfile(options.athlete)
  const targetWeekStart = parseLocalDate(options.targetWeekStart, 'targetWeekStart')
  const expectedFixedClubSessions = buildExpectedFixedClubSessionsInternal(athlete, targetWeekStart)
  const result = parseAndValidatePastedPlan<{ bundle: WeekImportBundle }>(jsonText, {
    expectedWeekType: options.expectedWeekType,
    expectedTargetWeekStartDate: targetWeekStart,
    expectedTargetWeekDates: buildTargetWeek(targetWeekStart).dates,
    expectedFixedClubSessions,
    domainValidator: {
      safeParse(contract) {
        const converted = safeConvertAiWeekContractToBundle(contract, { ...options, athlete, targetWeekStart })
        return converted.ok
          ? { success: true, data: { bundle: converted.bundle } }
          : { success: false, issues: converted.issues }
      },
    },
  })
  if (!result.ok) {
    return {
      ok: false,
      canApply: false,
      preview: null,
      issues: mapValidationIssuesToImportIssues(result.issues),
    }
  }
  return {
    ok: true,
    canApply: true,
    contract: result.contract,
    bundle: result.data.bundle,
    preview: buildPreview(result.data.bundle, result.contract, athlete),
    issues: [],
  }
}
