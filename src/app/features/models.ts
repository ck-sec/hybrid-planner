export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

export type OnboardingStepId =
  | 'goal'
  | 'schedule'
  | 'modalities'
  | 'strength'
  | 'equipment'
  | 'club'
  | 'review'

export interface ChoiceOption<T extends string = string> {
  id: T
  label: string
  description?: string
  selected: boolean
  disabled?: boolean
}

export interface SelectOption {
  value: string
  label: string
}

export interface FormMessage {
  id: string
  tone: 'info' | 'error' | 'success'
  text: string
}

export type EquipmentMode = 'bodyweight' | 'commercial' | 'home'

export interface ClubSessionDraft {
  id: string
  category: string
  activity: string
  scope: string
  location: string
  day: DayOfWeek | ''
  startTime: string
  durationMinutes: string
  notes: string
}

export interface OnboardingDraft {
  goalSummary: string
  targetDate: string
  goalNotes: string
  aerobicSessionCount: string
  aerobicExercises?: string
  strengthSessionCount: string
  mobilitySessionCount: string
  equipmentMode: EquipmentMode | ''
  equipmentDetails: string
  reviewNotes: string
}

export interface ImportIssue {
  id: string
  severity: 'error' | 'warning'
  message: string
  path?: string
  suggestion?: string
}

export interface JsonPreviewItem {
  label: string
  value: string
}

export interface JsonPreviewGroup {
  id: string
  title: string
  items: readonly JsonPreviewItem[]
}

export interface JsonImportPreview {
  title: string
  summary: readonly string[]
  groups: readonly JsonPreviewGroup[]
}

export type WorkoutSectionId = 'warmup' | 'main' | 'cooldown'

export interface WorkoutEditorDraft {
  workoutTitle: string
  category: string
  scheduledDate: string
  scheduledTime: string
  purpose: string
  expectedDuration: string
  modality: string
  source: string
  fixedClubSessionId: string
  notes: string
}

export interface WorkoutStepDraft {
  id: string
  title: string
  instructions: string
  target: string
  duration: string
  rest: string
  notes: string
}

export interface WorkoutSectionDraft {
  id: WorkoutSectionId
  label: string
  description?: string
  steps: readonly WorkoutStepDraft[]
}

export type WorkoutCompletionStatus = 'completed' | 'partial' | 'skipped'

export type WorkoutStepResultStatus = 'unrecorded' | 'done' | 'trimmed' | 'skipped'

export interface WorkoutLogStepResultDraft {
  id: string
  title: string
  status: WorkoutStepResultStatus
  actualResult: string
  effort: string
  notes: string
}

export interface WeeklyMetricDraft {
  id: string
  label: string
  planned: string
  completed: string
  note: string
}

export interface WeeklyReviewDraft {
  weekLabel: string
  reflection: string
  energy: string
  recovery: string
  wins: string
  blockers: string
  nextFocus: string
  coachNotes: string
}

export interface ResetAction {
  id: string
  label: string
  description: string
  confirmationLabel: string
}
