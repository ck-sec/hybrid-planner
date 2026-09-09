import type { GoalAssessment, LoadBasis, PlanningContext, RepBasis, WeeklyReview } from '../domain/planning-context.ts'

export type WeekPromptKind = 'initial' | 'continuation'

export type WorkoutCategory = 'aerobic' | 'strength' | 'mobility'

export type WorkoutSourceKind = 'ai' | 'fixed_club'

export type WorkoutCompletionStatus = 'completed' | 'partial' | 'skipped' | 'unlogged'

export type WorkoutChangeType = 'moved' | 'added' | 'deleted'

export interface FixedClubSession {
  sessionId?: string
  label: string
  date: string
  startTime: string
  durationMin: number
  category?: WorkoutCategory
  modality?: string
  notes?: string
}

export interface NormalizedFixedClubSession {
  sessionId: string
  label: string
  date: string
  startTime: string
  durationMin: number
  category?: WorkoutCategory
  modality?: string
  notes?: string
}

export interface ClubTimetableCommitment {
  sessionId: string
  title: string
  dayOfWeek: number
  date: string
  startTime: string
  notes?: string
  scope?: string
  category?: WorkoutCategory
  durationMin?: number
}

export interface BaseWeekPromptInput {
  profile: Readonly<Record<string, unknown>>
  equipment: Readonly<Record<string, unknown> | readonly string[]>
  preferences: Readonly<Record<string, unknown>>
  fixedClubSessions: readonly FixedClubSession[]
  clubTimetableCommitments?: readonly ClubTimetableCommitment[]
  targetWeekStartDate: string
  warmupRequirement?: string
}

export interface InitialWeekPromptInput extends BaseWeekPromptInput {}

export interface WorkoutStepContract {
  id: string
  instruction: string
  purpose?: string
  sets?: number
  reps?: number
  loadKg?: number
  loadBasis?: LoadBasis
  repBasis?: RepBasis
  distanceMeters?: number
  /** In v2, work minutes per set when sets is supplied; otherwise work minutes for the step. */
  durationMin?: number
  /** Total block estimate including all sets, rest, and transitions; not a logged duration. */
  estimatedTotalMin?: number
  pace?: string
  effort?: string
  restSeconds?: number
  modality?: string
  notes?: string
}

export interface AiWorkoutSource {
  kind: 'ai'
}

export interface FixedClubWorkoutSource {
  kind: 'fixed_club'
  fixedClub: NormalizedFixedClubSession
}

export type WorkoutSource = AiWorkoutSource | FixedClubWorkoutSource

export interface PlannedWorkout {
  id: string
  date: string
  startTime: string
  category: WorkoutCategory
  modality?: string
  title: string
  purpose: string
  expectedDuration: number
  warmup: readonly WorkoutStepContract[]
  main: readonly WorkoutStepContract[]
  cooldown: readonly WorkoutStepContract[]
  source: WorkoutSource
  notes?: string
}

export interface LoggedWorkoutStep {
  stepId: string
  completedSets?: number
  completedReps?: number
  completedDurationMin?: number
  completedDistanceMeters?: number
  loadKg?: number
  loadBasis?: LoadBasis
  repBasis?: RepBasis
  note?: string
}

export interface LoggedWorkout {
  completionStatus: WorkoutCompletionStatus
  effort?: string
  notes?: string
  steps?: readonly LoggedWorkoutStep[]
}

export interface WorkoutChange {
  type: WorkoutChangeType
  fromDate?: string
  toDate?: string
  note?: string
}

export interface PreviousWorkoutContext {
  original: PlannedWorkout
  actualLog?: LoggedWorkout
  changes?: readonly WorkoutChange[]
}

export interface PreviousWeekContext {
  weekStart: string
  weekEnd: string
  summary?: string
  workouts: readonly PreviousWorkoutContext[]
  review?: WeeklyReview
}

export interface ContinuationWeekPromptInput extends BaseWeekPromptInput {
  previousWeek: PreviousWeekContext
}

export interface TargetWeek {
  startDate: string
  endDate: string
  dates: readonly string[]
}

interface AiWeekCopyPasteContractBase {
  format: 'hybrid-coach-week'
  weekType: WeekPromptKind
  targetWeek: TargetWeek
  summary: string
  workouts: readonly PlannedWorkout[]
}

export interface AiWeekCopyPasteContractV1 extends AiWeekCopyPasteContractBase {
  version: 1
}

export interface AiWeekCopyPasteContractV2 extends AiWeekCopyPasteContractBase {
  version: 2
  athleteContext?: PlanningContext
  goalAssessment: GoalAssessment
}

export type AiWeekCopyPasteContract = AiWeekCopyPasteContractV1 | AiWeekCopyPasteContractV2

export interface AiPromptPackage {
  kind: WeekPromptKind
  targetWeek: TargetWeek
  contract: Readonly<{
    format: 'hybrid-coach-week'
    version: 2
    categories: readonly WorkoutCategory[]
    requiresStructuredWarmupSteps: true
  }>
  example: AiWeekCopyPasteContractV2
  contractJson: string
  exampleJson: string
  messages: readonly [
    { role: 'system'; content: string },
    { role: 'user'; content: string },
  ]
  prompt: string
}

export interface ValidationIssue {
  path: string
  code: string
  message: string
  suggestion?: string
}

export type DomainValidatorLike<T> =
  | ((value: AiWeekCopyPasteContract) => unknown)
  | {
    safeParse?: (value: AiWeekCopyPasteContract) => unknown
    parse?: (value: AiWeekCopyPasteContract) => T
    validate?: (value: AiWeekCopyPasteContract) => unknown
  }

export interface ParsePastedPlanOptions<T = AiWeekCopyPasteContract> {
  expectedWeekType?: WeekPromptKind
  expectedTargetWeekStartDate?: string
  expectedTargetWeekDates?: readonly string[]
  expectedFixedClubSessions?: readonly FixedClubSession[]
  domainValidator?: DomainValidatorLike<T>
  domainValidators?: readonly DomainValidatorLike<T>[]
}

export type ParsePastedPlanResult<T = AiWeekCopyPasteContract> =
  | {
    ok: true
    contract: AiWeekCopyPasteContract
    data: T
    formattedIssues: ''
    issues: readonly []
  }
  | {
    ok: false
    issues: readonly ValidationIssue[]
    formattedIssues: string
  }
