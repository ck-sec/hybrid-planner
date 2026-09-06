export const ENGINE_VERSION = '0.2.0'
export const POLICY_VERSION = 'baseline-bounded-1'
export const LIBRARY_VERSION = 'exercise-estimates-1'
export const PROGRAM_LIBRARY_VERSION = 'exercise-profiles-1'
export const PROGRAM_POLICY_VERSION = 'extensible-programming-1'
/** Absolute storage bound for truthful actual sets; this is not a prescription ceiling. */
export const MAX_LOGGED_SETS_PER_BLOCK = 10
export const LEGACY_EXERCISE_IDS = [
  'back-squat', 'goblet-squat', 'bodyweight-squat', 'deadlift', 'romanian-deadlift', 'hip-thrust',
  'bench-press', 'push-up', 'overhead-press', 'dumbbell-row', 'pull-up', 'split-squat',
  'band-rotation', 'dead-bug', 'snatch',
] as const
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

// Model estimates in arbitrary units; not measured physiological recovery.
export const DEFAULT_SYSTEMIC_HALF_LIFE_HOURS = 24
export const DEFAULT_STRUCTURAL_HALF_LIFE_HOURS = 60
export const COST_MULTIPLIER_RANGE = [0.8, 1.4] as const

// Finite policy weights applied to bounded magnitudes, never to hard constraints.
export const PENALTY_WEIGHTS = {
  structuralCollision: 70,
  sameDaySeparation: 35,
  longRunClearance: 35,
  hardDaysAdjacent: 25,
  goalPriority: 10,
} as const
export const MIN_SEPARATION_HOURS = 3
export const MIN_SEPARATION_HOURS_HIGH_INTENSITY = 6
export const HARD_SESSION_SYSTEMIC_THRESHOLD = 300
export const HARD_SESSION_STRUCTURAL_THRESHOLD = 250
export const LONG_RUN_CLEARANCE_STRUCTURAL_MAX = 150
export const RUN_COST_PER_MINUTE = { systemic: 3, structural: 2 } as const
export const TRAIL_STRUCTURAL_MULTIPLIER = 1.25
export const FIRST_EXPOSURE_COST_MULTIPLIER = 1.2
export const MAX_COST_RPE_FACTOR = 1.75
export const MIN_COST_RPE_FACTOR = 0.75
export const STANDARD_SET_REPS = 10
export const REFERENCE_SET_RPE = 7
export const NOVICE_MONTHS_THRESHOLD = 12 // Policy informed by study grouping, not a biological cutoff.
export const ANCHOR_RPE_RANGE = [7, 8] as const
export const NOVICE_RPE_MAX = 7
export const ACCESSORY_RPE_RANGE = [6, 8] as const
export const SAFETY = {
  maxWeeklyVolumeIncreasePct: 10,
  minRestDaysPerWeek: 1,
  maxConsecutiveHardDays: 2,
  maxSessionsPerDay: 2,
  calibrationWeekVolumeFraction: 0.6,
  minimumLiftGapHours: 24,
  untimedLiftClearDays: 1,
} as const
export const DELOAD_EVERY_N_WEEKS = 4
export const DELOAD_VOLUME_FRACTION = 0.6
export const TAPER_WEEKS_DEFAULT = 2
// These alter reductions only. No setting permits exceeding established workload.
export const AGGRESSIVENESS_VOLUME_FRACTION = { conservative: 0.8, standard: 0.9, aggressive: 1 } as const
export const LIMITS = {
  maxWeeks: 52,
  maxExercises: 8,
  maxLibraryExercises: 100,
  maxCommitments: 4,
  maxRuns: 4,
  maxLifts: 3,
  maxWeeklyRunMinutes: 600,
  maxRunMinutes: 180,
  maxHistorySessions: 140,
  maxCandidates: 150000,
  maxNotesLength: 2000,
  // Two four-block A/B templates share one stable anchor: at most seven unique exercises.
  maxProgramExercises: 7,
  maxWorkoutBlocks: 8,
  maxConditioningBaselines: 4,
} as const

// Campaign-only heuristics; the versioned v0.2 engine policy above is unchanged.
export const CAMPAIGN_POLICY = {
  version: 'calendar-adaptation-1',
  fatigueVolumeFraction: 0.8,
  maxCompoundedFatigueSkips: 10,
  practiceCostPerMinute: { systemic: 4, structural: 3 },
  maximumBaselineObservationAgeDays: 42,
  comfortableObservationRpeMax: 8,
} as const

export const RECOMMENDATION_POLICY = {
  version: 'first-exposure-1',
  sets: 2,
  reps: 8,
  targetRPE: 6,
  maxExercises: 8,
  maxSessionSets: 8,
  maxSessionReps: 64,
  classicQualityBias: ['aerobic_base', 'max_strength'],
  classicReviewOffsetDays: 83,
  supportedExerciseIds: [
    'back-squat', 'goblet-squat', 'bodyweight-squat', 'deadlift', 'romanian-deadlift', 'hip-thrust',
    'bench-press', 'push-up', 'overhead-press', 'dumbbell-row', 'pull-up', 'split-squat', 'band-rotation', 'dead-bug',
  ],
  bodyweightRoutine: ['bodyweight-squat', 'push-up', 'dead-bug'],
  dumbbellRoutine: ['goblet-squat', 'dumbbell-row', 'push-up', 'dead-bug'],
  gymRoutine: ['back-squat', 'romanian-deadlift', 'bench-press', 'dumbbell-row', 'dead-bug'],
} as const

export const PROGRAM_POLICY = {
  version: PROGRAM_POLICY_VERSION,
  minSelectedExercises: 4,
  maxSelectedExercises: 7,
  maxSessionWorkUnits: 8,
  maxSessionRepetitions: 64,
  firstWeekFraction: 0.6,
  throwingCalibrationFraction: 0.5,
  conditioningCostPerMinute: {
    run_road: { systemic: 3, structural: 2 },
    run_trail: { systemic: 3, structural: 2.5 },
    bike_road: { systemic: 2.5, structural: 0.75 },
    bike_gravel: { systemic: 2.75, structural: 1 },
    row: { systemic: 3, structural: 1.5 },
    ski_erg: { systemic: 3, structural: 1.25 },
  },
} as const
