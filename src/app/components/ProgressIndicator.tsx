import { useId } from 'react'
import { classNames } from './classNames.ts'

export type ProgressStepStatus = 'complete' | 'current' | 'upcoming'

export interface ProgressStep {
  id: string
  label: string
  description?: string
  status: ProgressStepStatus
}

export interface ProgressIndicatorProps {
  title?: string
  ariaLabel?: string
  steps: ReadonlyArray<ProgressStep>
}

export function ProgressIndicator({
  title = 'Plan progress',
  ariaLabel = 'Progress through the current planning flow',
  steps,
}: ProgressIndicatorProps) {
  const headingId = useId()

  return (
    <section className="hc-progress hc-surface" aria-labelledby={headingId}>
      <div className="hc-sectionHeading">
        <p className="hc-eyebrow">Flow</p>
        <h2 id={headingId}>{title}</h2>
      </div>
      <ol aria-label={ariaLabel} className="hc-progressList">
        {steps.map(step => (
          <li
            aria-current={step.status === 'current' ? 'step' : undefined}
            className={classNames('hc-progressStep', `is-${step.status}`)}
            key={step.id}
          >
            <span aria-hidden="true" className="hc-progressMarker">
              {step.status === 'complete' ? '✓' : ''}
            </span>
            <span className="hc-progressText">
              <span className="hc-progressLabel">{step.label}</span>
              {step.description ? <span className="hc-progressDescription">{step.description}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
