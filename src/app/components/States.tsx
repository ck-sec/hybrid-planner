import type { ReactNode } from 'react'
import { ActionButton, type ActionButtonProps } from './ActionButton.tsx'
import { classNames } from './classNames.ts'

interface BaseStateProps {
  title: string
  message: string
  action?: ActionButtonProps
  secondaryAction?: ActionButtonProps
}

export interface EmptyStateProps extends BaseStateProps {}

export interface ErrorStateProps extends BaseStateProps {
  recoveryHint?: string
}

export interface LoadingStateProps {
  title: string
  message: string
}

function StateFrame({
  title,
  message,
  action,
  secondaryAction,
  tone,
  children,
}: BaseStateProps & { tone: 'empty' | 'error' | 'loading'; children?: ReactNode }) {
  return (
    <section className={classNames('hc-statePanel hc-surface', `is-${tone}`)}>
      <div className="hc-stateHeader">
        <div className={classNames('hc-stateIcon', `is-${tone}`)} aria-hidden="true" />
        <div>
          <h2>{title}</h2>
          <p className="hc-bodyCopy">{message}</p>
        </div>
      </div>
      {children}
      {(secondaryAction || action) ? (
        <div className="hc-stateActions">
          {secondaryAction ? <ActionButton {...secondaryAction} tone={secondaryAction.tone ?? 'secondary'} /> : null}
          {action ? <ActionButton {...action} tone={action.tone ?? 'primary'} /> : null}
        </div>
      ) : null}
    </section>
  )
}

export function EmptyState(props: EmptyStateProps) {
  return <StateFrame {...props} tone="empty" />
}

export function ErrorState({ recoveryHint, ...props }: ErrorStateProps) {
  return (
    <StateFrame {...props} tone="error">
      {recoveryHint ? <p className="hc-supportCopy">{recoveryHint}</p> : null}
    </StateFrame>
  )
}

export function LoadingState({ title, message }: LoadingStateProps) {
  return (
    <section aria-live="polite" className="hc-statePanel hc-surface is-loading" role="status">
      <div className="hc-stateHeader">
        <div className="hc-spinner" aria-hidden="true" />
        <div>
          <h2>{title}</h2>
          <p className="hc-bodyCopy">{message}</p>
        </div>
      </div>
    </section>
  )
}
