import { useId, type ReactNode } from 'react'
import { SessionCard, type SessionCardProps } from './SessionCard.tsx'

export interface DayBoardCard extends SessionCardProps {
  id: string
}

export interface DayColumnProps {
  id: string
  label: string
  dateLabel: string
  summary?: string
  cards?: ReadonlyArray<DayBoardCard>
  emptyLabel?: string
  children?: ReactNode
}

export interface WeekBoardProps {
  title: string
  description?: string
  days: ReadonlyArray<DayColumnProps>
  footerNote?: string
}

export function DayColumn({ id, label, dateLabel, summary, cards, emptyLabel = 'Nothing planned yet.', children }: DayColumnProps) {
  const hasCards = Boolean(cards?.length)
  const hasChildren = children !== undefined && children !== null

  return (
    <section className="hc-dayColumn" id={id}>
      <header className="hc-dayHeader">
        <div>
          <p className="hc-dayLabel">{label}</p>
          <h3>{dateLabel}</h3>
        </div>
        {summary ? <p className="hc-daySummary">{summary}</p> : null}
      </header>
      <div className="hc-dayCards">
        {hasChildren
          ? children
          : hasCards
            ? cards!.map(card => <SessionCard key={card.id} {...card} />)
            : <p className="hc-emptySlot">{emptyLabel}</p>}
      </div>
    </section>
  )
}

export function WeekBoard({ title, description, days, footerNote }: WeekBoardProps) {
  const headingId = useId()

  return (
    <section className="hc-board" aria-labelledby={headingId}>
      <div className="hc-sectionHeading">
        <p className="hc-eyebrow">Current week</p>
        <h2 id={headingId}>{title}</h2>
        {description ? <p className="hc-bodyCopy">{description}</p> : null}
      </div>
      <div className="hc-boardGrid">
        {days.map(day => (
          <DayColumn key={day.id} {...day} />
        ))}
      </div>
      {footerNote ? <p className="hc-supportCopy">{footerNote}</p> : null}
    </section>
  )
}
