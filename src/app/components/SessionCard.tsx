import { ActionButton, type ActionButtonProps } from './ActionButton.tsx'
import { classNames } from './classNames.ts'

export type SessionCardKind = 'aerobic' | 'strength' | 'mobility'

export interface SessionCardMetric {
  label: string
  value: string
}

export interface SessionCardProps {
  title: string
  kind: SessionCardKind
  timeLabel?: string
  summary?: string
  metrics?: ReadonlyArray<SessionCardMetric>
  note?: string
  clubBadgeLabel?: string
  fixed?: boolean
  status?: 'completed' | 'partial' | 'skipped'
  action?: ActionButtonProps
}

const KIND_LABEL: Record<SessionCardKind, string> = {
  aerobic: 'Aerobic',
  strength: 'Strength',
  mobility: 'Mobility',
}

export function SessionCard({
  title,
  kind,
  timeLabel,
  summary,
  metrics,
  note,
  clubBadgeLabel,
  fixed = false,
  status,
  action,
}: SessionCardProps) {
  return (
    <article className={classNames('hc-sessionCard', `is-${kind}`, fixed && 'is-fixed')}>
      <div className="hc-cardHeading">
        <div>
          <p className="hc-eyebrow">{KIND_LABEL[kind]}</p>
          <h3>{title}</h3>
        </div>
        {clubBadgeLabel ? <span className="hc-clubBadge">{clubBadgeLabel}</span> : null}
      </div>
      {timeLabel ? <p className="hc-cardMeta">{timeLabel}</p> : null}
      {status ? <span className={`hc-completion is-${status}`}>{status === 'completed' ? 'Completed' : status === 'partial' ? 'Partly completed' : 'Skipped'}</span> : null}
      {summary ? <p className="hc-cardSummary">{summary}</p> : null}
      {metrics?.length ? (
        <dl className="hc-cardMetrics">
          {metrics.map(metric => (
            <div className="hc-cardMetric" key={`${metric.label}-${metric.value}`}>
              <dt>{metric.label}</dt>
              <dd>{metric.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {note ? <p className="hc-cardNote">{note}</p> : null}
      {action ? <ActionButton {...action} className="hc-cardAction" tone={action.tone ?? 'ghost'} /> : null}
    </article>
  )
}
