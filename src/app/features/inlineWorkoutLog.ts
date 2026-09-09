import type { ChangeEvent } from 'react'
import type { Workout } from '../../domain/contracts.ts'
import type { WorkoutLogScreenProps } from './workoutLogScreen.ts'
import { WorkoutExerciseCards } from './workoutExerciseCards.ts'
import { h, messageList, textArea } from './ui.ts'

export interface InlineWorkoutLogProps {
  workout: Workout
  log?: WorkoutLogScreenProps
  hasLog: boolean
  dirty: boolean
  disabled?: boolean
  onSave: () => void
}

export function InlineWorkoutLog(props: InlineWorkoutLogProps) {
  const prefix = `workout-${props.workout.id}`
  const errors = props.log?.messages?.filter(message => message.tone === 'error') ?? []
  return h('fieldset', { className: 'inline-workout-log', disabled: props.disabled || !props.log }, [
    h('legend', { key: 'legend', className: 'inline-workout-log__legend' }, `Record ${props.workout.title}`),
    h('p', { key: 'purpose', className: 'inline-workout-log__purpose' }, props.workout.purpose),
    props.workout.notes ? h('p', { key: 'notes', className: 'workout-exercise__instructions' }, props.workout.notes) : null,
    h(WorkoutExerciseCards, {
      key: 'exercises', idPrefix: prefix, workout: props.workout,
      stepResults: props.log?.stepResults ?? [], unlogged: !props.hasLog,
      recordedSteps: props.log?.recordedSteps,
      onStepResultChange: (stepId, field, value) => props.log?.onStepResultChange(stepId, field, value),
    }),
    h('div', { key: 'summary', className: 'inline-workout-log__summary' }, [
      h('div', { key: 'outcome', className: 'feature-field' }, [
        h('label', { key: 'label', className: 'feature-field__label', htmlFor: `${prefix}-outcome` }, 'Workout status'),
        h('select', {
          key: 'select', className: 'feature-field__input', id: `${prefix}-outcome`,
          value: props.hasLog ? props.log?.completionStatus : '',
          onChange: (event: ChangeEvent<HTMLSelectElement>) => {
            const value = event.target.value
            if (value !== 'partial' && value !== 'completed' && value !== 'skipped') throw new Error('Unsupported workout status.')
            props.log?.onCompletionStatusChange(value)
          },
        }, [
          h('option', { key: '', value: '', disabled: true }, 'Not logged'),
          h('option', { key: 'partial', value: 'partial' }, 'In progress / partial'),
          h('option', { key: 'completed', value: 'completed' }, 'Completed'),
          h('option', { key: 'skipped', value: 'skipped' }, 'Skipped'),
        ]),
      ]),
      textArea({
        id: `${prefix}-notes`, label: 'Workout comments', value: props.log?.notes ?? '',
        onChange: value => props.log?.onNotesChange(value), rows: 2,
        placeholder: 'Anything else to carry into next week?',
      }),
    ]),
    messageList(errors, `${prefix}-errors`, 'Check your log'),
    h('div', { key: 'save', className: 'inline-workout-log__save' }, [
      h('p', { key: 'status', role: 'status', className: props.dirty ? 'is-unsaved' : 'app-hint' },
        props.dirty ? 'Unsaved changes' : props.hasLog ? 'Saved in this browser' : 'Nothing logged yet'),
      h('button', {
        key: 'button', type: 'button', className: 'hc-button hc-control is-primary',
        disabled: !props.hasLog || !props.dirty || errors.length > 0,
        onClick: props.onSave, 'aria-label': `Save log for ${props.workout.title}`,
      }, 'Save log'),
    ]),
  ])
}
