export const ENGINE_VERSION = '0.1.0' as const

export const DAY_NAMES = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
] as const

export type Day = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface Exercise {
  name: string
  sets: number
  reps: number
  loadKg: number
}

export interface Baseline {
  weeklyRunMinutes: number
  longestRunMinutes: number
  runsPerWeek: number
  liftsPerWeek: number
  availableDays: Day[]
  exercises: Exercise[]
}

export interface WeekBoundary {
  previousSundayLift: boolean
  nextMondayLift: boolean
}

export interface PlannerInput {
  baseline: Baseline
  boundary: WeekBoundary
}

export interface RunSession {
  id: string
  kind: 'run'
  minutes: number
  effort: 'easy'
}

export interface LiftSession {
  id: string
  kind: 'lift'
  exercises: Exercise[]
}

export type Session = RunSession | LiftSession
export type ScheduledSession = Session & { day: Day }

export interface WeekPlan {
  engineVersion: typeof ENGINE_VERSION
  input: PlannerInput
  sessions: ScheduledSession[]
  omitted: Session[]
  notes: string[]
  audit: {
    candidateCount: number
    rejectedCandidateCount: number
    placementScore: number
    safetyRules: string[]
  }
}
