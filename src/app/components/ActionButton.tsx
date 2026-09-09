import type { MouseEventHandler } from 'react'
import { classNames } from './classNames.ts'

export type ActionButtonTone = 'primary' | 'secondary' | 'ghost'

export interface ActionButtonProps {
  label: string
  href?: string
  onClick?: MouseEventHandler<HTMLButtonElement | HTMLAnchorElement>
  disabled?: boolean
  tone?: ActionButtonTone
  className?: string
  ariaLabel?: string
  target?: string
  rel?: string
}

export function ActionButton({
  label,
  href,
  onClick,
  disabled = false,
  tone = 'primary',
  className,
  ariaLabel,
  target,
  rel,
}: ActionButtonProps) {
  const controlClassName = classNames('hc-button', 'hc-control', `is-${tone}`, className)
  const linkRel = rel ?? (target === '_blank' ? 'noreferrer' : undefined)

  if (href && !disabled) {
    return (
      <a
        aria-label={ariaLabel}
        className={controlClassName}
        href={href}
        onClick={onClick}
        rel={linkRel}
        target={target}
      >
        <span>{label}</span>
      </a>
    )
  }

  return (
    <button
      aria-label={ariaLabel}
      className={controlClassName}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
    </button>
  )
}
