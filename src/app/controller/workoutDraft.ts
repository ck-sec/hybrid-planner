import type { FormMessage, SelectOption, WorkoutEditorDraft, WorkoutSectionDraft, WorkoutSectionId, WorkoutStepDraft } from '../features/models.ts'
import type { PlannerWorkoutDefinition, PlannerWorkoutStepDefinition } from '../state/planner.ts'
import type { Workout, WorkoutCategory, WorkoutSource, WorkoutStep } from '../../domain/contracts.ts'
import { parseLoadBasis, parseRepBasis } from '../../domain/planning-context.ts'
import { parseClockTime, parseLocalDate, type LocalDateString } from '../../domain/local-date.ts'
import { createControllerId } from './ids.ts'

const MODALITY_PREFIX = 'Modality: '
const STEP_FIELD_PREFIXES = {
  target: 'Target: ',
  duration: 'Duration: ',
  rest: 'Rest: ',
  notes: 'Notes: ',
} as const

export const WORKOUT_CATEGORY_OPTIONS: readonly SelectOption[] = [
  { value: 'aerobic', label: 'Aerobic' },
  { value: 'strength', label: 'Strength' },
  { value: 'mobility', label: 'Mobility' },
]

export const WORKOUT_MODALITY_OPTIONS: readonly SelectOption[] = [
  { value: '', label: 'No specific modality' },
  { value: 'running', label: 'Running' },
  { value: 'cycling', label: 'Cycling' },
  { value: 'swimming', label: 'Swimming' },
  { value: 'rowing', label: 'Rowing' },
  { value: 'hiking', label: 'Hiking' },
  { value: 'ski-erg', label: 'Ski erg' },
  { value: 'strength', label: 'Strength work' },
  { value: 'mobility', label: 'Mobility work' },
]

export const WORKOUT_SOURCE_OPTIONS: readonly SelectOption[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'ai', label: 'AI handoff' },
  { value: 'club', label: 'Fixed club session' },
]

export interface WorkoutEditorState {
  readonly draft: WorkoutEditorDraft
  readonly sections: readonly WorkoutSectionDraft[]
}

export type WorkoutDefinitionResult =
  | { readonly ok: true; readonly definition: PlannerWorkoutDefinition }
  | { readonly ok: false; readonly messages: readonly FormMessage[] }

function errorMessage(id: string, text: string): FormMessage {
  return { id, tone: 'error', text }
}

function blankStep(): WorkoutStepDraft {
  return {
    id: createControllerId('step'),
    title: '',
    instructions: '',
    target: '',
    duration: '',
    rest: '',
    notes: '',
    loadBasis: '',
    repBasis: '',
    estimatedTotalMin: '',
  }
}

export function createEmptySection(id: WorkoutSectionId): WorkoutSectionDraft {
  const label = id === 'warmup' ? 'Warm-up' : id === 'main' ? 'Main' : 'Cool-down'
  return {
    id,
    label,
    description: id === 'main'
      ? 'At least one main step is required before the workout can be saved.'
      : 'Optional. Add steps when the session needs them.',
    steps: id === 'main' ? [blankStep()] : [],
  }
}

export function createBlankWorkoutEditorState(scheduledDate: LocalDateString | string): WorkoutEditorState {
  return {
    draft: {
      workoutTitle: '',
      category: 'aerobic',
      scheduledDate: String(scheduledDate),
      scheduledTime: '',
      purpose: '',
      expectedDuration: '45',
      modality: '',
      source: 'manual',
      fixedClubSessionId: '',
      notes: '',
    },
    sections: [createEmptySection('warmup'), createEmptySection('main'), createEmptySection('cooldown')],
  }
}

function splitDetail(detail: string | undefined): Omit<WorkoutStepDraft, 'id' | 'title'> {
  const values = { instructions: '', target: '', duration: '', rest: '', notes: '' }
  if (!detail) return values
  const instructions: string[] = []
  for (const line of detail.split('\n')) {
    if (line.startsWith(STEP_FIELD_PREFIXES.target)) values.target = line.slice(STEP_FIELD_PREFIXES.target.length)
    else if (line.startsWith(STEP_FIELD_PREFIXES.duration)) values.duration = line.slice(STEP_FIELD_PREFIXES.duration.length)
    else if (line.startsWith(STEP_FIELD_PREFIXES.rest)) values.rest = line.slice(STEP_FIELD_PREFIXES.rest.length)
    else if (line.startsWith(STEP_FIELD_PREFIXES.notes)) values.notes = line.slice(STEP_FIELD_PREFIXES.notes.length)
    else instructions.push(line)
  }
  values.instructions = instructions.join('\n').trim()
  return values
}

function joinDetail(step: WorkoutStepDraft, includeDuration: boolean): string | undefined {
  const lines = [
    step.instructions.trim(),
    step.target.trim() ? `${STEP_FIELD_PREFIXES.target}${step.target.trim()}` : '',
    includeDuration && step.duration.trim() ? `${STEP_FIELD_PREFIXES.duration}${step.duration.trim()}` : '',
    step.rest.trim() ? `${STEP_FIELD_PREFIXES.rest}${step.rest.trim()}` : '',
    step.notes.trim() ? `${STEP_FIELD_PREFIXES.notes}${step.notes.trim()}` : '',
  ].filter(Boolean)
  const detail = lines.join('\n')
  return detail ? detail.slice(0, 2_000) : undefined
}

function parseWholeMinutes(value: string): number | undefined {
  const match = /^\s*(\d{1,3})\s*(?:min|mins|minutes)?\s*$/i.exec(value)
  if (!match) return undefined
  const minutes = Number.parseInt(match[1]!, 10)
  return Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= 720 ? minutes : undefined
}

function parseEstimatedTotalMinutes(value: string): number | undefined {
  const normalized = value.trim()
  if (!normalized) return undefined
  const minutes = Number(normalized)
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized) || !Number.isFinite(minutes) || minutes < 0.1 || minutes > 1_440) {
    throw new Error('Estimated block total must be a number of minutes between 0.1 and 1440.')
  }
  return minutes
}

function stepToDraft(step: WorkoutStep): WorkoutStepDraft {
  const values = splitDetail(step.detail)
  const minutes = step.target?.minutes
  return {
    id: step.id,
    title: step.title,
    instructions: values.instructions,
    target: values.target,
    duration: values.duration || (minutes === undefined ? '' : `${minutes} min`),
    rest: values.rest,
    notes: values.notes,
    loadBasis: step.target?.loadBasis ?? '',
    repBasis: step.target?.repBasis ?? '',
    estimatedTotalMin: step.estimatedTotalMin === undefined ? '' : String(step.estimatedTotalMin),
  }
}

function draftToStep(step: WorkoutStepDraft, existing?: WorkoutStep): PlannerWorkoutStepDefinition {
  const originalDraft = existing ? stepToDraft(existing) : undefined
  const minutes = originalDraft?.duration === step.duration ? existing?.target?.minutes : parseWholeMinutes(step.duration)
  const detailUnchanged = originalDraft && (['instructions', 'target', 'duration', 'rest', 'notes'] as const)
    .every(field => step[field] === originalDraft[field])
  const detail = detailUnchanged ? existing?.detail : joinDetail(step, minutes === undefined)
  const loadBasis = step.loadBasis === undefined ? existing?.target?.loadBasis
    : step.loadBasis === '' ? undefined : parseLoadBasis(step.loadBasis, 'Load basis')
  const repBasis = step.repBasis === undefined ? existing?.target?.repBasis
    : step.repBasis === '' ? undefined : parseRepBasis(step.repBasis, 'Rep basis')
  const estimatedTotalMin = step.estimatedTotalMin === undefined ? existing?.estimatedTotalMin
    : parseEstimatedTotalMinutes(step.estimatedTotalMin)
  const { minutes: _originalMinutes, loadBasis: _originalLoadBasis, repBasis: _originalRepBasis, ...retainedTarget } = existing?.target ?? {}
  const target = {
    ...retainedTarget,
    ...(minutes === undefined ? {} : { minutes }),
    ...(loadBasis === undefined ? {} : { loadBasis }),
    ...(repBasis === undefined ? {} : { repBasis }),
  }
  const { detail: _originalDetail, target: _originalTarget, estimatedTotalMin: _originalTotal, ...retainedStep } = existing ?? {}
  return {
    ...retainedStep,
    id: step.id,
    title: step.title.trim(),
    ...(detail === undefined ? {} : { detail }),
    ...(Object.keys(target).length ? { target } : {}),
    ...(estimatedTotalMin === undefined ? {} : { estimatedTotalMin }),
  }
}

function readModality(notes: string | undefined): { modality: string; notes: string } {
  if (!notes) return { modality: '', notes: '' }
  const [first, ...rest] = notes.split('\n')
  if (first?.startsWith(MODALITY_PREFIX)) {
    return { modality: first.slice(MODALITY_PREFIX.length).trim(), notes: rest.join('\n').trim() }
  }
  return { modality: '', notes }
}

function writeNotes(modality: string, notes: string): string | undefined {
  const lines = [modality.trim() ? `${MODALITY_PREFIX}${modality.trim()}` : '', notes.trim()].filter(Boolean)
  const combined = lines.join('\n')
  return combined ? combined.slice(0, 2_000) : undefined
}

export function workoutToEditorState(workout: Workout): WorkoutEditorState {
  const { modality, notes } = readModality(workout.notes)
  return {
    draft: {
      workoutTitle: workout.title,
      category: workout.category,
      scheduledDate: workout.scheduledDate,
      scheduledTime: workout.startTime ?? '',
      purpose: workout.purpose,
      expectedDuration: String(workout.expectedDurationMin),
      modality,
      source: workout.source,
      fixedClubSessionId: workout.fixedClubSession?.recurringSessionId ?? '',
      notes,
    },
    sections: [
      { ...createEmptySection('warmup'), steps: workout.warmup.map(stepToDraft) },
      { ...createEmptySection('main'), steps: workout.main.map(stepToDraft) },
      { ...createEmptySection('cooldown'), steps: workout.cooldown.map(stepToDraft) },
    ],
  }
}

function sectionSteps(state: WorkoutEditorState, id: WorkoutSectionId): readonly WorkoutStepDraft[] {
  return state.sections.find(section => section.id === id)?.steps ?? []
}

export function buildWorkoutDefinition(
  state: WorkoutEditorState,
  options: { readonly existing?: Workout } = {},
): WorkoutDefinitionResult {
  const messages: FormMessage[] = []
  const title = state.draft.workoutTitle.trim()
  const purpose = state.draft.purpose.trim()

  if (!title) messages.push(errorMessage('workout-title', 'Add a workout title before saving.'))
  if (title.length > 120) messages.push(errorMessage('workout-title-length', 'Workout titles must be 120 characters or fewer.'))
  if (!purpose) messages.push(errorMessage('workout-purpose', 'Add a short purpose so the session stays reviewable.'))

  let scheduledDate: LocalDateString | undefined
  try {
    scheduledDate = parseLocalDate(state.draft.scheduledDate, 'Scheduled date')
  } catch (error) {
    messages.push(errorMessage('workout-date', error instanceof Error ? error.message : 'Scheduled date is invalid.'))
  }

  let startTime: string | undefined
  if (state.draft.scheduledTime.trim()) {
    try {
      startTime = parseClockTime(state.draft.scheduledTime.trim(), 'Scheduled time')
    } catch (error) {
      messages.push(errorMessage('workout-time', error instanceof Error ? error.message : 'Scheduled time is invalid.'))
    }
  }

  const expectedDurationMin = parseWholeMinutes(state.draft.expectedDuration)
  if (expectedDurationMin === undefined) {
    messages.push(errorMessage('workout-duration', 'Expected duration must be whole minutes between 1 and 720.'))
  }

  const category = state.draft.category as WorkoutCategory
  const source = state.draft.source as WorkoutSource
  const mainSteps = sectionSteps(state, 'main').filter(step => step.title.trim())
  if (!mainSteps.length) messages.push(errorMessage('workout-main', 'Add at least one main step with a title.'))

  const untitledSteps = state.sections.flatMap(section => section.steps)
    .filter(step => !step.title.trim() && [
      step.instructions, step.target, step.duration, step.rest, step.notes,
      step.loadBasis, step.repBasis, step.estimatedTotalMin,
    ].some(value => value?.trim()))
  if (untitledSteps.length) {
    messages.push(errorMessage('workout-step-title', 'Every step with content needs a title.'))
  }

  if (source === 'club' && !options.existing?.fixedClubSession) {
    messages.push(errorMessage(
      'workout-club-source',
      'Fixed club sessions are created from your profile club sessions. Keep this workout manual or AI sourced.',
    ))
  }
  if (options.existing?.source === 'club' && source !== 'club') {
    messages.push(errorMessage(
      'workout-club-change',
      'Fixed club workouts keep their club source. Delete the workout if the club session no longer applies.',
    ))
  }

  const originalSteps = new Map(
    options.existing
      ? [...options.existing.warmup, ...options.existing.main, ...options.existing.cooldown].map(step => [step.id, step])
      : [],
  )
  const convertedSections = new Map<WorkoutSectionId, PlannerWorkoutStepDefinition[]>()
  for (const section of state.sections) {
    const steps: PlannerWorkoutStepDefinition[] = []
    for (const step of section.steps.filter(step => step.title.trim())) {
      try {
        steps.push(draftToStep(step, originalSteps.get(step.id)))
      } catch (error) {
        messages.push(errorMessage(
          `workout-${section.id}-${step.id}`,
          `${section.label}: "${step.title}" - ${error instanceof Error ? error.message : 'Invalid step fields.'}`,
        ))
      }
    }
    convertedSections.set(section.id, steps)
  }
  if (messages.length || scheduledDate === undefined || expectedDurationMin === undefined) {
    return { ok: false, messages }
  }

  return {
    ok: true,
    definition: {
      ...(options.existing ? { id: options.existing.id } : {}),
      scheduledDate,
      ...(startTime === undefined ? {} : { startTime }),
      category,
      source,
      title,
      purpose: purpose.slice(0, 500),
      expectedDurationMin,
      warmup: convertedSections.get('warmup') ?? [],
      main: convertedSections.get('main') ?? [],
      cooldown: convertedSections.get('cooldown') ?? [],
      ...(options.existing?.fixedClubSession ? { fixedClubSession: options.existing.fixedClubSession } : {}),
      ...(writeNotes(state.draft.modality, state.draft.notes) === undefined
        ? {}
        : { notes: writeNotes(state.draft.modality, state.draft.notes)! }),
    },
  }
}

export function updateEditorSections(
  sections: readonly WorkoutSectionDraft[],
  sectionId: WorkoutSectionId,
  update: (steps: readonly WorkoutStepDraft[]) => readonly WorkoutStepDraft[],
): readonly WorkoutSectionDraft[] {
  return sections.map(section => (section.id === sectionId ? { ...section, steps: update(section.steps) } : section))
}

export function addEditorStep(steps: readonly WorkoutStepDraft[]): readonly WorkoutStepDraft[] {
  return [...steps, blankStep()]
}

export function moveEditorStep(
  steps: readonly WorkoutStepDraft[],
  stepId: string,
  direction: 'down' | 'up',
): readonly WorkoutStepDraft[] {
  const index = steps.findIndex(step => step.id === stepId)
  if (index < 0) return steps
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= steps.length) return steps
  const next = [...steps]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved!)
  return next
}
