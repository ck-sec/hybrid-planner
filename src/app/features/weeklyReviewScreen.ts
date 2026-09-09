import type { FormMessage, WeeklyMetricDraft, WeeklyReviewDraft } from './models.ts'
import { actionBar, h, messageList, screenFrame, sectionCard, selectInput, textArea, textInput } from './ui.ts'

type WeeklyReviewField = keyof WeeklyReviewDraft
type WeeklyMetricField = Exclude<keyof WeeklyMetricDraft, 'id' | 'label'>

const ratingOptions = [
  { value: '', label: 'Select rating' },
  ...Array.from({ length: 5 }, (_, index) => {
    const value = String(index + 1)
    return { value, label: value }
  }),
]

export interface WeeklyReviewScreenProps {
  draft: WeeklyReviewDraft
  metrics: readonly WeeklyMetricDraft[]
  messages?: readonly FormMessage[]
  onFieldChange: (field: WeeklyReviewField, value: string) => void
  onMetricChange: (metricId: string, field: WeeklyMetricField, value: string) => void
  onSave: () => void
}

export function WeeklyReviewScreen(props: WeeklyReviewScreenProps) {
  return screenFrame(
    'Weekly review',
    'Close the week with a few useful signals and only the extra detail you want to keep.',
    [
      sectionCard('weekly-review-meta', 'Week summary', 'Capture the feel of the week in a way that is easy to revisit before planning the next one.', [
        h('div', { key: 'meta-grid', className: 'feature-metric-grid weekly-review__metric-grid' }, [
          textInput({
            id: 'week-label',
            label: 'Week label',
            value: props.draft.weekLabel,
            onChange: value => props.onFieldChange('weekLabel', value),
            placeholder: 'Example: 9 to 15 September',
            className: 'weekly-review__field feature-metric-grid__field',
          }),
          selectInput({
            id: 'week-energy',
            label: 'Energy',
            value: props.draft.energy,
            onChange: value => props.onFieldChange('energy', value),
            options: ratingOptions,
            description: '1 low, 5 high',
            className: 'weekly-review__field feature-metric-grid__field',
          }),
          selectInput({
            id: 'week-recovery',
            label: 'Recovery',
            value: props.draft.recovery,
            onChange: value => props.onFieldChange('recovery', value),
            options: ratingOptions,
            description: '1 low, 5 high',
            className: 'weekly-review__field feature-metric-grid__field',
          }),
        ]),
        textArea({
          id: 'week-reflection',
          label: 'Overall reflection',
          value: props.draft.reflection,
          onChange: value => props.onFieldChange('reflection', value),
          rows: 3,
          className: 'weekly-review__field',
        }),
      ], 'weekly-review__card'),
      messageList(props.messages, 'weekly-review-messages'),
      sectionCard('weekly-review-metrics', 'Planned vs completed', 'Keep the numbers tight, then open a note only when the number needs context.', [
        h(
          'div',
          { key: 'metrics', className: 'weekly-review__metric-list' },
          props.metrics.map(metric =>
            h('article', { key: metric.id, 'aria-labelledby': `${metric.id}-title`, className: 'weekly-review__metric-card' }, [
              h('h3', { id: `${metric.id}-title`, key: 'title', className: 'weekly-review__metric-title' }, metric.label),
              h('div', { key: 'grid', className: 'feature-metric-grid weekly-review__metric-grid' }, [
                textInput({
                  id: `${metric.id}-planned`,
                  label: 'Planned',
                  value: metric.planned,
                  onChange: value => props.onMetricChange(metric.id, 'planned', value),
                  className: 'weekly-review__field feature-metric-grid__field',
                }),
                textInput({
                  id: `${metric.id}-completed`,
                  label: 'Completed',
                  value: metric.completed,
                  onChange: value => props.onMetricChange(metric.id, 'completed', value),
                  className: 'weekly-review__field feature-metric-grid__field',
                }),
              ]),
              h('details', { key: 'details', open: metric.note ? true : undefined, className: 'feature-advanced weekly-review__advanced' }, [
                h('summary', { key: 'summary', className: 'weekly-review__advanced-summary' }, 'Optional note'),
                textArea({
                  id: `${metric.id}-note`,
                  label: 'Metric note',
                  value: metric.note,
                  onChange: value => props.onMetricChange(metric.id, 'note', value),
                  rows: 2,
                  className: 'weekly-review__field',
                }),
              ]),
            ]),
          ),
        ),
      ], 'weekly-review__card'),
      sectionCard('weekly-review-notes', 'Wins and next focus', 'Keep the main takeaway visible, then expand for blockers or coach-only notes if needed.', [
        textArea({
          id: 'week-wins',
          label: 'Wins',
          value: props.draft.wins,
          onChange: value => props.onFieldChange('wins', value),
          rows: 3,
          className: 'weekly-review__field',
        }),
        textArea({
          id: 'week-focus',
          label: 'Next week focus',
          value: props.draft.nextFocus,
          onChange: value => props.onFieldChange('nextFocus', value),
          rows: 3,
          className: 'weekly-review__field',
        }),
        h('details', {
          key: 'details',
          open: props.draft.blockers || props.draft.coachNotes ? true : undefined,
          className: 'feature-advanced weekly-review__advanced',
        }, [
          h('summary', { key: 'summary', className: 'weekly-review__advanced-summary' }, 'Optional details'),
          textArea({
            id: 'week-blockers',
            label: 'Blockers',
            value: props.draft.blockers,
            onChange: value => props.onFieldChange('blockers', value),
            rows: 3,
            className: 'weekly-review__field',
          }),
          textArea({
            id: 'week-coach-notes',
            label: 'Coach note',
            value: props.draft.coachNotes,
            onChange: value => props.onFieldChange('coachNotes', value),
            rows: 2,
            className: 'weekly-review__field',
          }),
        ]),
      ], 'weekly-review__card'),
    ],
    actionBar('weekly-review-save', [
      h('button', { key: 'save', type: 'button', className: 'weekly-review__action', onClick: props.onSave }, 'Save review'),
    ], 'weekly-review__actions'),
    'weekly-review',
  )
}
