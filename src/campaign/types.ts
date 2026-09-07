import type { Day, Equipment, ExerciseObservation, PlanWeekInput, ProgramConfigV1, Quality, Session, SessionLog, WeekPlan } from '../../engine/types.ts'
import type { ResourceId } from './equipment.ts'
import type { WorkoutCard } from './workout-cards.ts'
import type { TrainingPreferences, CurrentTraining } from './training-baseline.ts'
import type { TrainingHistory } from './garmin-import.ts'
import type { SessionFeedback } from './training-feedback.ts'
import type { AuthoredWeekProposal } from '../../engine/authored-week.ts'

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
  practiceProfile?: 'controlled_target_throw'
  weeklyRunMinutes: number
  runsPerWeek: number
  liftsPerWeek: number
  liftDurationMin: number
  weeklyTimeBudgetMin: number
  equipment: Equipment[]
  resources?: ResourceId[]
  program?: ProgramConfigV1
  exercises: ExerciseObservation[]
  confirmed: boolean
  recommendedSetup?: RecommendedSetup
  trainingPreferences?: TrainingPreferences
  currentTraining?: CurrentTraining
  trainingHistory?: TrainingHistory
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
  authored?: AuthoredWeekProposal
  feedback?: Record<string, SessionFeedback>
  authoredHistory?: Array<{ proposal: AuthoredWeekProposal; reason: string }>
}

export interface CampaignRevision {
  weekIndex: number
  draft: CampaignDraft
}

export interface SetDraft {
  weight: string
  reps: string
  effort: string
}

export interface SavedPlan {
  version: 1
  step: number
  setupComplete: boolean
  sample: boolean
  draft: CampaignDraft
  weeks: CampaignWeek[]
  selectedWeek: number
  setDrafts: Record<string, SetDraft>
  cards?: WorkoutCard[]
  revisions?: CampaignRevision[]
  pendingWeek?: AuthoredWeekProposal
}

export interface CampaignState extends SavedPlan {
  pastPlans?: SavedPlan[]
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
