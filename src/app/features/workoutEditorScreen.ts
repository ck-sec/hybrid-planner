import type {
  FormMessage,
  SelectOption,
  WorkoutEditorDraft,
  WorkoutSectionDraft,
  WorkoutSectionId,
  WorkoutStepDraft,
} from './models.ts'
import { actionBar, h, messageList, screenFrame, sectionCard, selectInput, textArea, textInput } from './ui.ts'

type WorkoutMetadataField = keyof WorkoutEditorDraft

const loadBasisOptions = [
  { value: '', label: 'Unknown / not specified' },
  { value: 'total', label: 'Weight (kg total)' },
  { value: 'per_implement', label: 'Weight (kg each)' },
  { value: 'added', label: 'Weight (added kg)' },
  { value: 'assistance', label: 'Weight (assistance kg)' },
] as const satisfies readonly SelectOption[]

const repBasisOptions = [
  { value: '', label: 'Unknown / not specified' },
  { value: 'total', label: 'Reps (total)' },
  { value: 'per_side', label: 'Reps each side' },
] as const satisfies readonly SelectOption[]

export interface WorkoutEditorScreenProps {
  draft: WorkoutEditorDraft
  sections: readonly WorkoutSectionDraft[]
  categoryOptions: readonly SelectOption[]
  modalityOptions: readonly SelectOption[]
  sourceOptions: readonly SelectOption[]
  fixedClubSessionOptions?: readonly SelectOption[]
  messages?: readonly FormMessage[]
  onWorkoutFieldChange: (field: WorkoutMetadataField, value: string) => void
  onStepChange: (sectionId: WorkoutSectionId, stepId: string, field: Exclude<keyof WorkoutStepDraft, 'id'>, value: string) => void
  onAddStep: (sectionId: WorkoutSectionId) => void
  onMoveStep: (sectionId: WorkoutSectionId, stepId: string, direction: 'down' | 'up') => void
  onRemoveStep: (sectionId: WorkoutSectionId, stepId: string) => void
  onSave: () => void
}

export function WorkoutEditorScreen(props: WorkoutEditorScreenProps) {
  const showFixedClubField = Boolean(props.fixedClubSessionOptions?.length)
  const hasAdvancedMetadata = Boolean(props.draft.fixedClubSessionId || props.draft.notes)
  return screenFrame(
    'Workout editor',
    'Make the session your own, from warm-up to the final rep.',
    [
      sectionCard('workout-meta', 'Workout details', 'What are you training, and when?', [
        h('div', { key: 'core', className: 'feature-metric-grid workout-editor__core-grid' }, [
          textInput({
            id: 'workout-title',
            label: 'Workout title',
            value: props.draft.workoutTitle,
            onChange: value => props.onWorkoutFieldChange('workoutTitle', value),
            className: 'workout-editor__field feature-metric-grid__field',
          }),
          selectInput({
            id: 'workout-category',
            label: 'Category',
            value: props.draft.category,
            onChange: value => props.onWorkoutFieldChange('category', value),
            options: props.categoryOptions,
            className: 'workout-editor__field feature-metric-grid__field',
          }),
          textInput({
            id: 'workout-date',
            label: 'Scheduled date',
            value: props.draft.scheduledDate,
            onChange: value => props.onWorkoutFieldChange('scheduledDate', value),
            type: 'date',
            className: 'workout-editor__field feature-metric-grid__field',
          }),
          textInput({
            id: 'workout-duration',
            label: 'Expected duration',
            value: props.draft.expectedDuration,
            onChange: value => props.onWorkoutFieldChange('expectedDuration', value),
            placeholder: 'Example: 45 min or 75 min',
            className: 'workout-editor__field feature-metric-grid__field',
          }),
        ]),
        h('div', { key: 'optional', className: 'feature-metric-grid workout-editor__optional-grid' }, [
          textInput({
            id: 'workout-purpose',
            label: 'Purpose',
            value: props.draft.purpose,
            onChange: value => props.onWorkoutFieldChange('purpose', value),
            placeholder: 'Example: Threshold support or easy recovery',
            className: 'workout-editor__field feature-metric-grid__field',
          }),
          selectInput({
            id: 'workout-modality',
            label: 'Modality',
            value: props.draft.modality,
            onChange: value => props.onWorkoutFieldChange('modality', value),
            options: props.modalityOptions,
            className: 'workout-editor__field feature-metric-grid__field',
          }),
          textInput({
            id: 'workout-time',
            label: 'Scheduled time',
            value: props.draft.scheduledTime,
            onChange: value => props.onWorkoutFieldChange('scheduledTime', value),
            type: 'time',
            className: 'workout-editor__field feature-metric-grid__field',
          }),
        ]),
        h('details', { key: 'advanced', open: hasAdvancedMetadata ? true : undefined, className: 'feature-advanced workout-editor__advanced' }, [
          h('summary', { key: 'summary', className: 'workout-editor__advanced-summary' }, 'Advanced workout details'),
          selectInput({
            id: 'workout-source',
            label: 'Source',
            value: props.draft.source,
            onChange: value => props.onWorkoutFieldChange('source', value),
            options: props.sourceOptions,
            className: 'workout-editor__field',
          }),
          showFixedClubField
            ? selectInput({
                id: 'workout-fixed-club',
                label: 'Fixed club session',
                value: props.draft.fixedClubSessionId,
                onChange: value => props.onWorkoutFieldChange('fixedClubSessionId', value),
                options: props.fixedClubSessionOptions ?? [],
                description: 'Use this when the workout belongs to a recurring club session.',
                className: 'workout-editor__field',
              })
            : null,
          textArea({
            id: 'workout-notes',
            label: 'Coach notes',
            value: props.draft.notes,
            onChange: value => props.onWorkoutFieldChange('notes', value),
            rows: 3,
            className: 'workout-editor__field',
          }),
        ]),
      ], 'workout-editor__card'),
      messageList(props.messages, 'workout-editor-messages'),
      ...props.sections.map(section =>
        sectionCard(
          `section-${section.id}`,
          section.label,
          section.description ?? 'Add the key step details first, then open optional notes only where needed.',
          [
            h(
              'div',
              { key: 'steps', className: 'workout-editor__step-list' },
              section.steps.map((step, index) =>
                h('article', { key: step.id, 'aria-labelledby': `${step.id}-title`, className: 'workout-editor__step-card' }, [
                  h('h3', { id: `${step.id}-title`, key: 'title', className: 'workout-editor__step-title' }, `${section.label} step ${index + 1}`),
                  h('div', { key: 'core', className: 'feature-metric-grid workout-editor__step-core-grid' }, [
                    textInput({
                      id: `${step.id}-title-field`,
                      label: 'Step title',
                      value: step.title,
                      onChange: value => props.onStepChange(section.id, step.id, 'title', value),
                      className: 'workout-editor__field feature-metric-grid__field',
                    }),
                    textInput({
                      id: `${step.id}-target`,
                      label: 'Target',
                      value: step.target,
                      onChange: value => props.onStepChange(section.id, step.id, 'target', value),
                      placeholder: 'Example: Zone 2, 5 x 3 min, RPE 7',
                      className: 'workout-editor__field feature-metric-grid__field',
                    }),
                    textInput({
                      id: `${step.id}-duration`,
                      label: 'Work duration',
                      value: step.duration,
                      onChange: value => props.onStepChange(section.id, step.id, 'duration', value),
                      placeholder: 'Example: 12 min or 45 sec',
                      className: 'workout-editor__field feature-metric-grid__field',
                    }),
                  ]),
                  textArea({
                    id: `${step.id}-instructions`,
                    label: 'Instructions',
                    value: step.instructions,
                    onChange: value => props.onStepChange(section.id, step.id, 'instructions', value),
                    rows: 3,
                    className: 'workout-editor__field',
                  }),
                  h('details', {
                    key: 'advanced',
                    open: step.rest || step.notes || step.loadBasis || step.repBasis || step.estimatedTotalMin ? true : undefined,
                    className: 'feature-advanced workout-editor__advanced',
                  }, [
                    h('summary', { key: 'summary', className: 'workout-editor__advanced-summary' }, 'Optional step details'),
                    h('div', { key: 'conventions', className: 'feature-metric-grid' }, [
                      selectInput({
                        id: `${step.id}-load-basis`,
                        label: 'Weight convention',
                        value: step.loadBasis ?? '',
                        options: loadBasisOptions,
                        onChange: value => props.onStepChange(section.id, step.id, 'loadBasis', value),
                        description: 'Labels the existing kg value; no weight conversion.',
                        className: 'workout-editor__field feature-metric-grid__field',
                      }),
                      selectInput({
                        id: `${step.id}-rep-basis`,
                        label: 'Rep convention',
                        value: step.repBasis ?? '',
                        options: repBasisOptions,
                        onChange: value => props.onStepChange(section.id, step.id, 'repBasis', value),
                        className: 'workout-editor__field feature-metric-grid__field',
                      }),
                      textInput({
                        id: `${step.id}-block-time`,
                        label: 'Estimated block time (min)',
                        value: step.estimatedTotalMin ?? '',
                        inputMode: 'decimal',
                        onChange: value => props.onStepChange(section.id, step.id, 'estimatedTotalMin', value),
                        description: '0.1-1440 minutes, including rests and transitions; not just work duration.',
                        placeholder: 'Example: 12.5',
                        className: 'workout-editor__field feature-metric-grid__field',
                      }),
                    ]),
                    textInput({
                      id: `${step.id}-rest`,
                      label: 'Rest',
                      value: step.rest,
                      onChange: value => props.onStepChange(section.id, step.id, 'rest', value),
                      placeholder: 'Example: 90 sec easy walk',
                      className: 'workout-editor__field',
                    }),
                    textArea({
                      id: `${step.id}-notes`,
                      label: 'Notes',
                      value: step.notes,
                      onChange: value => props.onStepChange(section.id, step.id, 'notes', value),
                      rows: 2,
                      className: 'workout-editor__field',
                    }),
                  ]),
                  actionBar(`${step.id}-actions`, [
                    h(
                      'button',
                      { key: 'up', type: 'button', className: 'workout-editor__action', onClick: () => props.onMoveStep(section.id, step.id, 'up') },
                      'Move up',
                    ),
                    h(
                      'button',
                      { key: 'down', type: 'button', className: 'workout-editor__action', onClick: () => props.onMoveStep(section.id, step.id, 'down') },
                      'Move down',
                    ),
                    h(
                      'button',
                      { key: 'remove', type: 'button', className: 'workout-editor__action', onClick: () => props.onRemoveStep(section.id, step.id) },
                      'Remove step',
                    ),
                  ], 'workout-editor__step-actions'),
                ]),
              ),
            ),
            h(
              'button',
              { key: `add-${section.id}`, type: 'button', className: 'workout-editor__action', onClick: () => props.onAddStep(section.id) },
              `Add ${section.label.toLowerCase()} step`,
            ),
          ],
          'workout-editor__card',
        ),
      ),
    ],
    actionBar('workout-editor-save', [
      h('button', { key: 'save', type: 'button', className: 'workout-editor__action', onClick: props.onSave }, 'Save workout'),
    ], 'workout-editor__actions'),
    'workout-editor',
  )
}
