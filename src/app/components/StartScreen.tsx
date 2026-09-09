import { useId } from 'react'
import { ActionButton, type ActionButtonProps } from './ActionButton.tsx'
import { classNames } from './classNames.ts'
import { Icon } from './Icon.tsx'

export interface StartPathCard {
  id: string
  title: string
  summary: string
  eyebrow?: string
  badgeLabel?: string
  featured?: boolean
  action: ActionButtonProps
}

export interface StartScreenProps {
  eyebrow?: string
  title: string
  intro: string
  savedStateSummary?: string
  continuePath?: StartPathCard
  aiPath: StartPathCard
  manualPath: StartPathCard
  secondaryHint?: string
}

function PathCard({ id, title, summary, eyebrow, badgeLabel, featured, action }: StartPathCard) {
  return (
    <article className={classNames('hc-startCard hc-surface', featured && 'is-featured')}>
      <div className="hc-cardHeading">
        <div>
          <span className="hc-pathIcon"><Icon name={id === 'start-manual' ? 'week' : id === 'start-continue' ? 'arrow' : 'ai'} /></span>
          {eyebrow ? <p className="hc-eyebrow">{eyebrow}</p> : null}
          <h3>{title}</h3>
        </div>
        {badgeLabel ? <span className="hc-cardBadge">{badgeLabel}</span> : null}
      </div>
      <p className="hc-cardSummary">{summary}</p>
      <ActionButton {...action} className="hc-startAction" tone={action.tone ?? (featured ? 'primary' : 'secondary')} />
    </article>
  )
}

export function StartScreen({
  eyebrow = 'Start here',
  title,
  intro,
  savedStateSummary,
  continuePath,
  aiPath,
  manualPath,
  secondaryHint,
}: StartScreenProps) {
  const headingId = useId()
  const split = title.indexOf('. ')

  return (
    <section className="hc-start" aria-labelledby={headingId}>
      <div className="hc-startIntro">
        <p className="hc-eyebrow">{eyebrow === 'Start here' ? 'YOUR HYBRID WORKSPACE' : eyebrow}</p>
        <h1 id={headingId}>{split < 0 ? title : <>{title.slice(0, split + 1)}<br /><span className="hc-serif">{title.slice(split + 2)}</span></>}</h1>
        <p className="hc-bodyCopy">{intro}</p>
        {savedStateSummary ? <p className="hc-supportCopy">{savedStateSummary}</p> : null}
      </div>
      <div className="hc-startGrid">
        {continuePath ? <PathCard {...continuePath} /> : null}
        <PathCard {...aiPath} />
        <PathCard {...manualPath} />
      </div>
      {secondaryHint ? <p className="hc-supportCopy">{secondaryHint}</p> : null}
      <div className="hc-howItWorks" aria-label="How it works">
        <div><span>01</span><strong>Shape your week</strong><p>Your goals, your schedule.</p></div>
        <div><span>02</span><strong>Train &amp; take notes</strong><p>Your plan and results together.</p></div>
        <div><span>03</span><strong>Learn &amp; adjust</strong><p>A fresh start every week.</p></div>
      </div>
    </section>
  )
}
