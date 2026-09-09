import type { FormMessage, WorkoutCompletionStatus, WorkoutLogStepResultDraft } from './models.ts'
import type { Workout, WorkoutLogStep } from '../../domain/contracts.ts'
import { WorkoutExerciseCards } from './workoutExerciseCards.ts'
import {
  parseStructuredMetricText,
  updateStructuredMetricAdvancedText,
  updateStructuredMetricField,
  workoutActualMetricFields,
} from './metricFields.ts'
import { actionBar, h, messageList, radioList, screenFrame, sectionCard, selectInput, textArea, textInput } from './ui.ts'

type WorkoutLogEditableField = Exclude<keyof WorkoutLogStepResultDraft, 'id' | 'title'>

const completionOptions = [
  { id: 'completed', label: 'Completed', selected: false },
  { id: 'partial', label: 'Partial', selected: false },
  { id: 'skipped', label: 'Skipped', selected: false },
] as const

const rpeOptions = [
  { value: '', label: 'Select RPE' },
  ...Array.from({ length: 10 }, (_, index) => {
    const value = String(index + 1)
    return { value, label: value }
  }),
]

export interface WorkoutLogScreenProps {
  workout?: Workout
  hasLog?: boolean
  canSave?: boolean
  workoutTitle: string
  performedOn: string
  completionStatus: WorkoutCompletionStatus
  sessionRpe: string
  actualSummary: string
  notes: string
  stepResults: readonly WorkoutLogStepResultDraft[]
  recordedSteps?: readonly WorkoutLogStep[]
  messages?: readonly FormMessage[]
  onCompletionStatusChange: (status: WorkoutCompletionStatus) => void
  onSessionRpeChange: (value: string) => void
  onActualSummaryChange: (value: string) => void
  onNotesChange: (value: string) => void
  onStepResultChange: (stepId: string, field: WorkoutLogEditableField, value: string) => void
  onSave: () => void
}

export function WorkoutLogScreen(props: WorkoutLogScreenProps) {
  const sessionActuals = parseStructuredMetricText(props.actualSummary, workoutActualMetricFields)
  return screenFrame(
    'Workout log',
    'Capture the headline outcome first, then fill in the details that will help shape the next plan.',
    [
      sectionCard('workout-log-summary', 'Session summary', 'Start with the essentials, then add the numbers and notes that matter.', [
        textInput({
          id: 'log-title',
          label: 'Workout',
          value: props.workoutTitle,
          onChange: () => undefined,
          readOnly: true,
          className: 'workout-log__field',
        }),
        textInput({
          id: 'log-date',
          label: 'Performed on',
          value: props.performedOn,
          onChange: () => undefined,
          type: 'date',
          readOnly: true,
          className: 'workout-log__field',
        }),
        radioList({
          id: 'completion-status',
          legend: 'Completion status',
          description: 'Choose the closest overall outcome.',
          options: completionOptions.map(option => ({
            ...option,
            selected: option.id === props.completionStatus,
          })),
          onSelect: value => props.onCompletionStatusChange(value as WorkoutCompletionStatus),
          className: 'workout-log__choice-list',
        }),
        selectInput({
          id: 'session-rpe',
          label: 'Session RPE',
          value: props.sessionRpe,
          onChange: props.onSessionRpeChange,
          options: rpeOptions,
          description: 'Use a 1 to 10 scale.',
          className: 'workout-log__field',
        }),
        h('section', { key: 'session-actuals', 'aria-labelledby': 'session-actuals-title', className: 'workout-log__actuals' }, [
          h('h3', { id: 'session-actuals-title', key: 'title', className: 'workout-log__step-title' }, 'Actuals'),
          h(
            'p',
            { key: 'description', className: 'workout-log__field-description' },
            'Only fill in the numbers you tracked.',
          ),
          h(
            'div',
            { key: 'grid', className: 'feature-metric-grid workout-log__actual-grid' },
            sessionActuals.fields.map(field =>
              textInput({
                id: `session-actual-${field.key}`,
                label: field.label,
                value: field.value,
                onChange: value => props.onActualSummaryChange(updateStructuredMetricField(sessionActuals, field.key, value)),
                description: field.description,
                placeholder: field.placeholder,
                className: 'workout-log__field feature-metric-grid__field',
              }),
            ),
          ),
          renderAdvancedMetricEditor(
            'session-actuals-advanced',
            sessionActuals,
            value => props.onActualSummaryChange(updateStructuredMetricAdvancedText(sessionActuals, value)),
            'Extra raw metrics',
          ),
        ]),
        textArea({
          id: 'session-notes',
          label: 'Notes',
          value: props.notes,
          onChange: props.onNotesChange,
          rows: 4,
          className: 'workout-log__field',
        }),
      ], 'workout-log__card'),
      messageList(props.messages, 'workout-log-messages'),
      sectionCard('step-results', 'Exercises', 'Log the main exercises. Warm-up and cool-down are instructions only.', [
        h(WorkoutExerciseCards, {
          key: 'results', idPrefix: `log-${props.workout?.id ?? 'session'}`,
          workout: props.workout, stepResults: props.stepResults,
          recordedSteps: props.recordedSteps,
          unlogged: props.hasLog === false, onStepResultChange: props.onStepResultChange,
        }),
      ], 'workout-log__card'),
    ],
    actionBar('workout-log-save', [
      h('button', { key: 'save', type: 'button', className: 'workout-log__action', disabled: props.canSave === false, onClick: props.onSave }, 'Save log'),
    ], 'workout-log__actions'),
    'workout-log',
  )
}

function renderAdvancedMetricEditor(
  id: string,
  model: ReturnType<typeof parseStructuredMetricText>,
  onChange: (value: string) => void,
  label: string,
) {
  return h('details', {
    key: id,
    open: model.hasAdvancedContent ? true : undefined,
    className: 'feature-advanced workout-log__advanced',
  }, [
    h(
      'summary',
      { key: 'summary', className: 'workout-log__advanced-summary' },
      model.advancedLineCount ? `${label} (${model.advancedLineCount})` : label,
    ),
    textArea({
      id,
      label: 'Advanced raw lines',
      value: model.advancedText,
      onChange,
      rows: Math.max(3, model.advancedLineCount || 1),
      description: 'Unsupported or extra key/value lines stay here and are still saved.',
      placeholder: 'key: value',
      className: 'workout-log__field',
    }),
  ])
}
