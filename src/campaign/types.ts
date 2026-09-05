import type { Day, Equipment, ExerciseObservation, PlanWeekInput, Quality, Session, SessionLog, WeekPlan } from '../../engine/types.ts'

export type GoalKind = 'dodgeball' | 'running' | 'hybrid' | 'custom'
export interface RecommendedSetup {
  version: 1
  mode: 'classic' | 'assisted'
  goalText: string
  typicalRunMinutes: number
  exerciseIds: string[]
}

export interface CampaignDraft {
  goalKind: GoalKind
  goalLabel: string
  location: string
  eventDate: string
  startDate: string
  priorities: Quality[]
  availableDays: Day[]
  practiceDays: Day[]
  practiceTime: string
  practiceDuration: number
  weeklyRunMinutes: number
  runsPerWeek: number
  liftsPerWeek: number
  liftDurationMin: number
  weeklyTimeBudgetMin: number
  equipment: Equipment[]
  exercises: ExerciseObservation[]
  confirmed: boolean
  recommendedSetup?: RecommendedSetup
}

export interface CalendarChange {
  id: string
  message: string
}

export interface CampaignWeek {
  input: PlanWeekInput
  plan: WeekPlan
  logs: Record<string, SessionLog>
  removed: Session[]
  changes: CalendarChange[]
}

export interface SetDraft {
  weight: string
  reps: string
  effort: string
}

export interface CampaignState {
  version: 1
  step: number
  setupComplete: boolean
  sample: boolean
  draft: CampaignDraft
  weeks: CampaignWeek[]
  selectedWeek: number
  setDrafts: Record<string, SetDraft>
}

export type CalendarAction =
  | { type: 'move'; sessionId: string; date: string; startTime: string }
  | { type: 'skip'; sessionId: string; reason: 'too_tired' | 'life' }
  | { type: 'delete'; sessionId: string }

export interface WorkoutContent {
  title: string
  focus: string
  cues: string[]
}
