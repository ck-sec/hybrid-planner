// Anchor contracts: no imports, side effects, browser APIs, or dependencies.
export type Day = 0 | 1 | 2 | 3 | 4 | 5 | 6 // Monday = 0, retained from schema 1.
export type ISODate = string
export type LocalTime = string // Validated HH:mm; all times use one planning-local calendar.

/** Arbitrary scheduling-cost units, not measured fatigue or injury risk. */
export interface Load { systemic: number; structural: number }
export type SessionEffortRating = number // CR10-style whole-session rating, 0-10.
export type SessionTrainingLoad = number // Whole-session effort rating * actual minutes.
export type TargetRPE = 6 | 6.5 | 7 | 7.5 | 8 | 8.5 | 9 | 9.5 | 10
export type MovementPattern =
  | 'knee_dominant' | 'hip_dominant' | 'horizontal_push' | 'vertical_push'
  | 'horizontal_pull' | 'vertical_pull' | 'unilateral_lower' | 'carry' | 'core' | 'rotational'
export type Equipment = 'barbell' | 'dumbbell' | 'kettlebell' | 'machine' | 'cable' | 'bodyweight' | 'bands' | 'none'
export type Resource = Equipment | 'bench' | 'rack' | 'pull_up_bar' | 'stable_step' | 'floor_space'
  | 'anchor_point' | 'carry_space' | 'dodgeball' | 'court_space' | 'safe_target'
  | 'bike' | 'rower' | 'ski_erg' | `custom:${string}`
export type CustomExerciseProfileId =
  | 'controlled_squat' | 'controlled_hinge' | 'controlled_push' | 'controlled_pull'
  | 'controlled_unilateral' | 'controlled_core' | 'controlled_rotation' | 'timed_carry' | 'timed_mobility'
/** User-reviewed profile fit, not validation of a new technique. Prose has no execution authority. */
export interface CustomExerciseSpec {
  version: 1
  id: string
  name: string
  profileId: CustomExerciseProfileId
  requirements: readonly Resource[]
  description: string
  focus: string
  why: string
}
/** A confirmed identity for the existing controlled-target-throw practice profile. */
export interface CustomSportDrillSpec {
  version: 1
  id: string
  name: string
  profileId: 'controlled_target_throw'
  requirements: readonly Resource[]
  description: string
  focus: string
  why: string
}
export type PrescriptionUnit = 'reps' | 'seconds'
export type ProgramGoal = 'balanced' | 'endurance' | 'strength' | 'dodgeball'
export type ConditioningModality = 'run_road' | 'run_trail' | 'bike_road' | 'bike_gravel' | 'row' | 'ski_erg'
export type ExecutionStyle = 'controlled' | 'slow_lowering' | 'fast_concentric_intent' | 'ballistic_logging_only'
export interface ExecutionProfile {
  style: ExecutionStyle
  label: string
  eccentricSeconds?: 2 | 3
  concentricIntent: 'controlled' | 'fast' | 'not_applicable'
  ballistic: boolean
}

export interface RepPrescriptionTemplate {
  unit: 'reps'
  sets: number
  reps: number
  targetRPE: TargetRPE
}
export interface SecondsPrescriptionTemplate {
  unit: 'seconds'
  sets: number
  seconds: number
}
export type ExercisePrescriptionTemplate = RepPrescriptionTemplate | SecondsPrescriptionTemplate
export interface ExerciseProfile {
  version: 'scheduling-estimate-1'
  /** Reviewed, hand-authored scheduling estimate; not an injury-risk coefficient. */
  schedulingEstimate: Load
  prescription: ExercisePrescriptionTemplate
}

export interface Exercise {
  id: string
  name: string
  pattern: MovementPattern
  equipment: readonly Equipment[]
  /** Hand-authored AU per ten-rep set at RPE 7, not derived from research effect sizes. */
  coefficients: Load
  competesWithRunning: boolean
  highSkill: boolean
  /** Required only by the extensible library. Legacy library entries omit these fields. */
  requirements?: readonly Resource[]
  label?: string
  template?: 'squat' | 'hinge' | 'push' | 'pull' | 'unilateral' | 'carry' | 'core' | 'rotation' | 'mobility'
  profile?: ExerciseProfile
  custom?: CustomExerciseSpec
}
export interface ExerciseLibrary { version: string; exercises: readonly Exercise[] }

export interface ConditioningBaseline {
  modality: ConditioningModality
  weeklyMinutes: number
  longestSessionMinutes: number
  sessionsPerWeek: number
}
export interface ProgramConfigV1 {
  version: 1
  libraryVersion: 'exercise-profiles-1'
  goal: ProgramGoal
  resources: readonly Resource[]
  /**
   * Additional modality-specific baselines. Existing baseline running is retained.
   * One exactly equivalent run baseline may replace its implicit run_road representation.
   */
  conditioningBaselines: readonly ConditioningBaseline[]
  selectedExerciseIds?: readonly string[]
  /** Confirmed definitions, including inactive history. Current resources gate selection, not retention. */
  customExercises?: readonly CustomExerciseSpec[]
  customSportDrills?: readonly CustomSportDrillSpec[]
  /** User-established administrative exposure cap; not a validated injury-safe threshold. */
  comfortableThrowsPerPractice?: number
  includeMobility?: boolean
}
export interface SportDrillMetadata {
  id: string
  label: string
  sport: 'dodgeball'
  unit: 'throws'
  requirements: readonly Resource[]
  intent: 'controlled_technique'
}

export interface ExerciseObservation {
  exerciseId: string
  date: ISODate
  weightKg: number // Added external load; 0 means no added load, never a denominator.
  sets: number
  reps: number
  actualRPE: TargetRPE
  experienceMonths: number
}
export interface ObservedBaseline {
  asOf: ISODate
  weeklyRunMinutes: number
  longestRunMinutes: number
  runsPerWeek: number
  liftsPerWeek: number
  liftDurationMin: number
  exercises: readonly ExerciseObservation[]
}
/** v1 intentionally keeps recovery half-lives fixed and does not learn two axes from one rating. */
export interface Calibration {
  version: 1
  costMultiplier: number
  observationCount: number
}
export interface SafetyHold {
  reason: 'pain' | 'illness' | 'return_from_break'
  since: ISODate
}
export interface AthleteState {
  baseline: ObservedBaseline
  calibration: Calibration
  availableDays: readonly Day[]
  equipment: readonly Equipment[]
  weeklyTimeBudgetMin: number
  defaultStartTime: LocalTime
  aggressiveness: 'conservative' | 'standard' | 'aggressive'
  residual: { asOfDate: ISODate; asOfTime: LocalTime; load: Load }
  safetyHold: SafetyHold | null
  /** Explicitly selected recommendations, not fabricated performance observations. */
  recommendedExerciseIds?: readonly string[]
  /** Opt-in. Absence retains the complete v0.2 planning policy. */
  program?: ProgramConfigV1
}

export type Discipline = 'run' | 'bike' | 'swim' | 'strength' | 'sport' | 'mobility'
export type Modality = 'run_road' | 'run_trail' | 'bike_road' | 'bike_gravel' | 'swim' | 'row' | 'ski_erg' | 'lifting' | 'court_sport' | 'other'
export type Quality = 'aerobic_base' | 'threshold' | 'vo2max' | 'repeat_sprint' | 'change_of_direction' | 'max_strength' | 'power' | 'strength_endurance' | 'shoulder_durability'
export interface FixedCommitment {
  id: string
  label: string
  dayOfWeek: Day
  startTime: LocalTime
  durationMin: number
  discipline: Discipline
  modality: Modality
  estimatedLoad: Load
}
export interface Goal {
  label: string
  peakDate: ISODate
  qualityBias: readonly Quality[]
  protectedExerciseIds: readonly string[]
  fixedCommitments: readonly FixedCommitment[]
}
export type PhaseKind = 'base' | 'build' | 'peak' | 'taper' | 'deload'
export interface Phase {
  kind: PhaseKind
  startWeekIndex: number // inclusive, zero-based
  endWeekIndex: number // inclusive
  volumeFraction: number // fraction of established baseline, not a promised adaptation.
}
export interface AnchorAssignment {
  pattern: MovementPattern
  exerciseId: string
  sets: number
  reps: number
  targetRPE: TargetRPE
  role: 'anchor' | 'accessory'
  provenance?: { kind: 'recommended'; policyVersion: string }
}
export interface Block {
  id: string
  engineVersion: string
  policyVersion: string
  libraryVersion: string
  startDate: ISODate
  totalWeeks: number
  goal: Goal
  phases: readonly Phase[]
  anchors: readonly AnchorAssignment[]
  /** Frozen opt-in programming contract. Absence identifies a legacy block. */
  program?: ProgramConfigV1
  workoutTemplates?: readonly FrozenWorkoutTemplate[]
}
export interface FrozenWorkoutTemplate {
  label: 'Strength A' | 'Strength B'
  exerciseIds: readonly string[]
}
export interface StrengthPrescription {
  exerciseId: string
  sets: number
  reps: number
  targetRPE: TargetRPE
  suggestedWeightKg?: number
  role: 'anchor' | 'accessory'
}
interface SessionBase {
  id: string
  date: ISODate
  startTime: LocalTime | null // Unknown is never interpreted as adequate separation.
  durationMin: number
  predictedLoad: Load
  reason: string
  pinned: boolean
  isCalibration: boolean
}
export interface RunSession extends SessionBase {
  kind: 'run'
  discipline: 'run'
  modality: 'run_road' | 'run_trail'
  endurancePrescription: { intent: 'easy' | 'long'; effort: 'conversational' }
}
export interface StrengthSession extends SessionBase {
  kind: 'strength'
  discipline: 'strength'
  modality: 'lifting'
  strengthPrescription: readonly StrengthPrescription[]
}
/** Externally established commitments are costed, never prescribed as exercises. */
export interface CommitmentSession extends SessionBase {
  kind: 'commitment'
  discipline: Discipline
  modality: Modality
  label: string
}
export interface ConditioningSession extends SessionBase {
  kind: 'conditioning'
  discipline: 'run' | 'bike' | 'sport'
  modality: ConditioningModality
  conditioningPrescription: { intent: 'easy'; effort: 'conversational' }
}
export interface RepsWorkoutBlock {
  unit: 'reps'
  exerciseId: string
  sets: number
  reps: number
  targetRPE: TargetRPE
  role: 'anchor' | 'accessory'
  suggestedWeightKg?: number
  executionStyle: Exclude<ExecutionStyle, 'ballistic_logging_only'>
}
export interface SecondsWorkoutBlock {
  unit: 'seconds'
  exerciseId: string
  sets: number
  seconds: number
  role: 'carry' | 'mobility'
  executionStyle: 'controlled'
}
export interface ThrowsWorkoutBlock {
  unit: 'throws'
  drillId: string
  throws: number
  intent: 'controlled_technique'
  /** The throws are allocated within this established commitment, never appended. */
  embedded: true
}
export type WorkoutBlock = RepsWorkoutBlock | SecondsWorkoutBlock | ThrowsWorkoutBlock
export interface WorkoutSession extends SessionBase {
  kind: 'workout'
  discipline: 'strength' | 'sport'
  modality: 'lifting' | 'court_sport'
  label: string
  blocks: readonly WorkoutBlock[]
  /** Present only when a sport workout represents an existing fixed commitment. */
  sourceCommitmentId?: string
}
export type Session = RunSession | StrengthSession | CommitmentSession | ConditioningSession | WorkoutSession
export type SkipReason = 'life' | 'too_tired' | 'pain' | 'illness' | 'weather' | 'other'
export interface SetLog { exerciseId: string; weightKg: number; reps: number; actualRPE: TargetRPE }
export interface RepsBlockLog {
  unit: 'reps'
  blockIndex: number
  exerciseId: string
  sets: readonly SetLog[]
}
export interface SecondsBlockLog {
  unit: 'seconds'
  blockIndex: number
  exerciseId: string
  seconds: number
  /** Optional observed external load for a carry; never a generated suggestion. */
  weightKg?: number
}
export interface ThrowsBlockLog {
  unit: 'throws'
  blockIndex: number
  drillId: string
  throws: number
}
export type BlockLog = RepsBlockLog | SecondsBlockLog | ThrowsBlockLog
export interface SessionLog {
  sessionId: string
  status: 'completed' | 'partial' | 'skipped'
  skipReason?: SkipReason
  actualEffort?: SessionEffortRating
  actualDurationMin?: number
  sets?: readonly SetLog[]
  blockLogs?: readonly BlockLog[]
  painFlag: boolean
  notes: string
}
export interface RecentSession { session: Session; log: SessionLog | null }
export interface CompletedWeek {
  weekStart: ISODate
  runMinutes: number
  plannedDeload: boolean
  disrupted: boolean
}
export interface PlanningContext {
  recentSessions: readonly RecentSession[]
  completedWeeks: readonly CompletedWeek[]
  neighboringSessions: readonly Session[]
  pinnedSessions: readonly Session[]
  /** Imported lifting dates with no reliable time/duration/cost; never fabricated as measured sessions. */
  untimedStrengthDates?: readonly ISODate[]
}
export interface PlanWeekInput {
  athlete: AthleteState
  block: Block
  weekIndex: number
  library: ExerciseLibrary
  context: PlanningContext
}
export interface PenaltyResult {
  rule: string
  weight: number
  magnitude: number // normalized to [0,1] per returned term
  score: number
  affectedSessionIds: readonly string[]
  explanation: string
  evidence: 'estimate' | 'policy'
}
export interface SafetyViolation { rule: string; sessionIds: readonly string[]; message: string }
export interface SafetyFloorResult {
  passed: boolean
  violations: readonly SafetyViolation[]
}
export interface Feasibility { fits: boolean; issues: readonly string[]; suggestions: readonly string[] }
export interface OmittedSession { sessionId: string; reason: string }
export interface WeekPlan {
  engineVersion: string
  policyVersion: string
  libraryVersion: string
  weekIndex: number
  weekStart: ISODate
  phase: PhaseKind
  intent: string
  sessions: readonly Session[]
  totalScore: number
  penalties: readonly PenaltyResult[]
  warnings: readonly string[]
  omitted: readonly OmittedSession[]
  feasibility: Feasibility
  safety: SafetyFloorResult
  audit: { candidatesScored: number; rejectedBySafety: number }
}
export type PlanWeek = (input: PlanWeekInput) => WeekPlan
