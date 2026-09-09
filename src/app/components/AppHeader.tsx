import type { MouseEventHandler } from 'react'
import { ActionButton, type ActionButtonProps } from './ActionButton.tsx'
import { classNames } from './classNames.ts'
import { Icon, type IconName } from './Icon.tsx'

export interface AppHeaderNavItem {
  id: string
  label: string
  href?: string
  current?: boolean
  disabled?: boolean
  onSelect?: MouseEventHandler<HTMLButtonElement>
}

export interface AppHeaderProps {
  brandLabel?: string
  brandHref?: string
  title?: string
  subtitle?: string
  statusLabel?: string
  navLabel?: string
  navItems: ReadonlyArray<AppHeaderNavItem>
  primaryAction?: ActionButtonProps
  secondaryAction?: ActionButtonProps
}

const navIcons: Record<string, IconName> = {
  'nav-start': 'overview', 'nav-onboarding': 'ai', 'nav-planner': 'week',
  'nav-ai': 'ai', 'nav-review': 'review', 'nav-settings': 'settings',
}

export function AppHeader({
  brandLabel = 'Hybrid Coach',
  brandHref = '#',
  title = 'Hybrid Coach',
  subtitle,
  statusLabel,
  navLabel = 'Planner sections',
  navItems,
  primaryAction,
  secondaryAction,
}: AppHeaderProps) {
  return (
    <header className="hc-header">
      <div className="hc-headerTop">
        <a aria-label={brandLabel} className="hc-brand hc-control" href={brandHref}>
          <img src="../favicon.svg" width="38" height="38" alt="" />
          <span className="hc-brandText">
            <span className="hc-brandName">{title === 'Hybrid Coach' ? 'Hybrid' : title}</span>
            <span className="hc-brandSubtitle">{subtitle ?? 'COACH'}</span>
          </span>
        </a>
        <div className="hc-headerMeta">
          {statusLabel ? <span className="hc-statusPill">{statusLabel}</span> : null}
          {navItems.length > 0 && <a className="hc-guidesLink" href="../learn/">Training guides <span aria-hidden="true">&rarr;</span></a>}
          {secondaryAction ? <ActionButton {...secondaryAction} tone={secondaryAction.tone ?? 'ghost'} /> : null}
          {primaryAction ? <ActionButton {...primaryAction} tone={primaryAction.tone ?? 'primary'} /> : null}
        </div>
      </div>
      {navItems.length > 0 && <nav aria-label={navLabel} className="hc-nav">
        <ul className="hc-navList">
          {navItems.map(item => {
            const itemClassName = classNames('hc-navItem', item.current && 'is-current')

            return (
              <li key={item.id}>
                {item.href && !item.disabled ? (
                  <a
                    aria-current={item.current ? 'page' : undefined}
                    className={classNames(itemClassName, 'hc-control')}
                    href={item.href}
                  >
                    <Icon name={navIcons[item.id] ?? 'week'} />
                    {item.label}
                  </a>
                ) : (
                  <button
                    aria-current={item.current ? 'page' : undefined}
                    className={classNames(itemClassName, 'hc-control')}
                    disabled={item.disabled}
                    onClick={item.onSelect}
                    type="button"
                  >
                    <Icon name={navIcons[item.id] ?? 'week'} />
                    {item.label}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </nav>}
    </header>
  )
}
