import { useEffect, useState, type ReactNode, type SyntheticEvent } from 'react'
import type { Workout, WorkoutStep, WorkoutStepTarget } from '../../domain/contracts.ts'
import type { WorkoutLogStepResultDraft } from './models.ts'
import {
  parseStructuredMetricText,
  updateStructuredMetricAdvancedText,
  updateStructuredMetricField,
  workoutStepActualFields,
} from './metricFields.ts'
import { h, selectInput, textArea, textInput } from './ui.ts'

export type ExerciseResultField = Exclude<keyof WorkoutLogStepResultDraft, 'id' | 'title'>

export interface WorkoutExerciseCardsProps {
  idPrefix: string
  workout?: Workout
  stepResults: readonly WorkoutLogStepResultDraft[]
  unlogged?: boolean
  onStepResultChange: (stepId: string, field: ExerciseResultField, value: string) => void
}

const sectionLabels = { warmup: 'Warm-up', main: 'Main work', cooldown: 'Cool-down' } as const
const statusOptions = [
  { value: 'unrecorded', label: 'Not marked' },
  { value: 'done', label: 'Done' },
  { value: 'trimmed', label: 'Partial' },
  { value: 'skipped', label: 'Skipped' },
]
const metricLabels: Record<string, string> = {
  loadKg: 'Weight (kg)', minutes: 'Time (min)', seconds: 'Time (sec)',
  distanceMeters: 'Distance (m)', paceSecondsPerKm: 'Pace (min/km)',
}

function plannedTargets(target: WorkoutStepTarget | undefined): string {
  if (!target) return ''
  return [
    target.sets !== undefined ? `${target.sets} sets` : '',
    target.reps !== undefined ? `${target.reps} reps` : '',
    target.loadKg !== undefined ? `${target.loadKg} kg` : '',
    target.minutes !== undefined ? `${target.minutes} min` : '',
    target.seconds !== undefined ? `${target.seconds} sec` : '',
    target.distanceMeters !== undefined ? `${target.distanceMeters} m` : '',
    target.effort,
  ].filter(Boolean).join(' \u00b7 ')
}

function primaryMetricKeys(workout: Workout | undefined, step: WorkoutStep | undefined): Set<string> {
  if (!workout) return new Set(workoutStepActualFields.map(field => field.key))
  const keys = new Set<string>()
  const target = step?.target
  if (workout.category === 'strength') {
    keys.add('loadKg')
    if (target?.sets !== undefined || target?.reps !== undefined || !(target?.minutes || target?.seconds || target?.distanceMeters)) {
      keys.add('sets')
      keys.add('reps')
    }
  } else {
    keys.add('minutes')
    if (workout.category === 'aerobic') keys.add('distanceMeters')
  }
  for (const field of workoutStepActualFields) {
    if (target && field.key !== 'paceSecondsPerKm' && target[field.key] !== undefined) keys.add(field.key)
  }
  return keys
}

export function WorkoutExerciseCards(props: WorkoutExerciseCardsProps) {
  const groups = props.workout
    ? (['warmup', 'main', 'cooldown'] as const).map(section => ({
      id: section, label: sectionLabels[section], steps: props.workout![section],
    }))
    : [{ id: 'exercises', label: 'Exercises', steps: props.stepResults.map(result => ({ id: result.id, title: result.title })) }]
  return h('div', { className: 'workout-exercises' }, groups.filter(group => group.steps.length).map(group =>
    h('section', { key: group.id, 'aria-labelledby': `${props.idPrefix}-${group.id}-heading`, className: 'workout-exercises__section' }, [
      h('h3', { key: 'heading', id: `${props.idPrefix}-${group.id}-heading` }, group.label),
      h('div', { key: 'cards', className: 'workout-exercises__grid' }, group.steps.map(step =>
        renderExercise(props, step, group.id),
      )),
    ]),
  ))
}

function renderExercise(props: WorkoutExerciseCardsProps, prescription: WorkoutStep, section: string) {
  const result = props.stepResults.find(step => step.id === prescription.id)
  const id = `${props.idPrefix}-${section}-${prescription.id}`
  const guidanceOnly = section === 'warmup' || section === 'cooldown'
  const actuals = parseStructuredMetricText(result?.actualResult ?? '', workoutStepActualFields)
  const primary = primaryMetricKeys(props.workout, prescription)
  const secondaryFields = actuals.fields.filter(field => !primary.has(field.key))
  const update = (field: ExerciseResultField, value: string) => props.onStepResultChange(prescription.id, field, value)
  const metricField = (field: typeof actuals.fields[number]) => textInput({
    id: `${id}-${field.key}`, label: metricLabels[field.key] ?? field.label,
    value: field.value,
    inputMode: field.key === 'paceSecondsPerKm' ? 'text' : field.key === 'sets' || field.key === 'reps' ? 'numeric' : 'decimal',
    onChange: value => update('actualResult', updateStructuredMetricField(actuals, field.key, value)),
    placeholder: field.key === 'paceSecondsPerKm' ? '5:15/km' : '\u2014',
  })
  const planned = plannedTargets(prescription.target)
  return h('article', {
    key: prescription.id, className: 'workout-exercise', 'data-step-id': prescription.id,
    'aria-labelledby': `${id}-title`,
  }, [
    h('header', { key: 'heading', className: 'workout-exercise__heading' }, [
      h('h4', { key: 'title', id: `${id}-title` }, prescription.title),
      planned ? h('p', { key: 'planned', className: 'workout-exercise__planned' }, [
        h('span', { key: 'label' }, 'Planned'), planned,
      ]) : null,
    ]),
    prescription.detail ? h('p', { key: 'detail', className: 'workout-exercise__instructions' }, prescription.detail) : null,
    prescription.equipment?.length ? h('p', { key: 'equipment', className: 'app-hint' }, `Equipment: ${prescription.equipment.join(', ')}`) : null,
    ...(guidanceOnly ? [recordedGuidance(result, actuals)] : [
      h('div', { key: 'actuals', className: 'workout-exercise__actuals' }, [
        h('p', { key: 'label', className: 'workout-exercise__actualsLabel' }, 'You did'),
        h('div', { key: 'fields', className: 'feature-metric-grid' }, [...primary].flatMap(key => actuals.fields.filter(field => field.key === key)).map(metricField)),
      ]),
      textArea({
        id: `${id}-notes`, label: 'Comments', value: result?.notes ?? '',
        onChange: value => update('notes', value), rows: 2,
        placeholder: 'How it felt, changes, or weights for individual sets...',
      }),
      selectInput({
        id: `${id}-status`, label: 'Exercise status', value: props.unlogged ? 'unrecorded' : result?.status ?? 'unrecorded',
        options: statusOptions, onChange: value => update('status', value),
      }),
      h(MoreMeasurements, { key: 'more', hasValues: actuals.hasAdvancedContent || secondaryFields.some(field => Boolean(field.value.trim())) || Boolean(result?.effort.trim()) }, [
        h('summary', { key: 'summary' }, 'More measurements'),
        h('div', { key: 'fields', className: 'feature-metric-grid' }, secondaryFields.map(metricField)),
        selectInput({
          id: `${id}-effort`, label: 'Exercise effort (RPE)', value: result?.effort ?? '',
          options: [{ value: '', label: 'Not recorded' }, ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))],
          onChange: value => update('effort', value),
        }),
        textArea({
          id: `${id}-advanced`, label: 'Extra raw step lines', value: actuals.advancedText,
          onChange: value => update('actualResult', updateStructuredMetricAdvancedText(actuals, value)), rows: 2,
        }),
      ]),
    ]),
  ])
}

function recordedGuidance(
  result: WorkoutLogStepResultDraft | undefined,
  actuals: ReturnType<typeof parseStructuredMetricText>,
) {
  const recorded = [
    ...actuals.fields.filter(field => field.value.trim()).map(field => `${metricLabels[field.key] ?? field.label}: ${field.value}`),
    actuals.advancedText,
    result?.effort ? `Effort (RPE): ${result.effort}` : '',
    result?.notes,
  ].filter(Boolean).join('\n')
  if (!recorded) return null
  return h('details', { key: 'recorded', className: 'feature-advanced' }, [
    h('summary', { key: 'summary' }, 'Previously recorded'),
    h('p', { key: 'values', className: 'workout-exercise__instructions' }, recorded),
  ])
}

function MoreMeasurements({ hasValues, children }: { hasValues: boolean; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(hasValues)
  useEffect(() => {
    if (hasValues) setExpanded(true)
  }, [hasValues])
  return h('details', {
    className: 'feature-advanced workout-exercise__more',
    open: expanded,
    onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => setExpanded(event.currentTarget.open),
  }, children)
}
