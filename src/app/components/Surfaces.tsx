import { useEffect, useId, useRef, type ReactNode } from 'react'
import { ActionButton, type ActionButtonProps } from './ActionButton.tsx'
import { classNames } from './classNames.ts'

export interface ModalSurfaceProps {
  open: boolean
  title: string
  description?: string
  children?: ReactNode
  primaryAction?: ActionButtonProps
  secondaryAction?: ActionButtonProps
  dismissAction?: ActionButtonProps
}

export interface SheetSurfaceProps {
  open: boolean
  title: string
  description?: string
  children?: ReactNode
  primaryAction?: ActionButtonProps
  secondaryAction?: ActionButtonProps
  dismissAction?: ActionButtonProps
}

interface SurfaceFrameProps {
  className: string
  title: string
  description?: string
  children?: ReactNode
  primaryAction?: ActionButtonProps
  secondaryAction?: ActionButtonProps
  dismissAction?: ActionButtonProps
}

function SurfaceFrame({
  className,
  title,
  description,
  children,
  primaryAction,
  secondaryAction,
  dismissAction,
}: SurfaceFrameProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousOverflow = document.body.style.overflow
    const previousFocus = document.activeElement
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      aria-modal="true"
      className={className}
      onCancel={event => {
        event.preventDefault()
        dialogRef.current?.querySelector<HTMLButtonElement>('[data-dismiss] button')?.click()
      }}
      onKeyDown={event => {
        if (event.key === 'Escape' && dismissAction) {
          event.preventDefault()
          dialogRef.current?.querySelector<HTMLButtonElement>('[data-dismiss] button')?.click()
        }
      }}
    >
      <div className="hc-surfaceFrameHeader">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description ? <p className="hc-bodyCopy" id={descriptionId}>{description}</p> : null}
        </div>
        {dismissAction ? <span data-dismiss><ActionButton {...dismissAction} tone={dismissAction.tone ?? 'ghost'} /></span> : null}
        </div>
      {children ? <div className="hc-surfaceFrameBody">{children}</div> : null}
      {(secondaryAction || primaryAction) ? (
        <div className="hc-surfaceFrameActions">
          {secondaryAction ? <ActionButton {...secondaryAction} tone={secondaryAction.tone ?? 'secondary'} /> : null}
          {primaryAction ? <ActionButton {...primaryAction} tone={primaryAction.tone ?? 'primary'} /> : null}
        </div>
      ) : null}
    </dialog>
  )
}

export function ModalSurface({ open, title, description, children, primaryAction, secondaryAction, dismissAction }: ModalSurfaceProps) {
  if (!open) return null

  return (
    <div className="hc-backdrop" role="presentation">
      <SurfaceFrame
        className={classNames('hc-overlaySurface', 'hc-modalSurface')}
        description={description}
        dismissAction={dismissAction}
        primaryAction={primaryAction}
        secondaryAction={secondaryAction}
        title={title}
      >
        {children}
      </SurfaceFrame>
    </div>
  )
}

export function SheetSurface({ open, title, description, children, primaryAction, secondaryAction, dismissAction }: SheetSurfaceProps) {
  if (!open) return null

  return (
    <div className="hc-sheetBackdrop" role="presentation">
      <SurfaceFrame
        className={classNames('hc-overlaySurface', 'hc-sheetSurface')}
        description={description}
        dismissAction={dismissAction}
        primaryAction={primaryAction}
        secondaryAction={secondaryAction}
        title={title}
      >
        {children}
      </SurfaceFrame>
    </div>
  )
}
