import type { FullWeekHandoffReply } from './handoff.ts'
import type { AuthoredWeekProposal } from '../../engine/authored-week.ts'
import { programResourceLabel } from './programming.ts'

export default function FullWeekProposalReview({ reply, acknowledged, onAcknowledge, exerciseNames = {}, drillsAcknowledged = false, onAcknowledgeDrills }: {
  reply: FullWeekHandoffReply
  acknowledged: boolean
  onAcknowledge: (value: boolean) => void
  exerciseNames?: Record<string, string>
  drillsAcknowledged?: boolean
  onAcknowledgeDrills?: (value: boolean) => void
}) {
  const facts = reply.currentTraining
  return <>
    {reply.customSportDrills.length > 0 && <section className="cf-card cf-stack">
      <h3>Review custom throwing drills</h3>
      {reply.customSportDrills.map(drill => <article key={drill.id} className="cf-card cf-stack">
        <h4>{drill.name}</h4>
        <p className="cf-small">Controlled target throwing · {drill.requirements.map(programResourceLabel).join(', ')}</p>
        <dl>
          <dt>Description</dt><dd>{drill.description}</dd>
          <dt>What to focus on</dt><dd>{drill.focus}</dd>
          <dt>Why this drill</dt><dd>{drill.why}</dd>
        </dl>
      </article>)}
      <p className="cf-small">Each drill keeps separate records and needs its own calibration. It can be scheduled only inside an existing court practice after final checks.</p>
      <label className="cf-check"><input type="checkbox" checked={drillsAcknowledged} onChange={event => onAcknowledgeDrills?.(event.target.checked)} />
        <span>I have reviewed these throwing techniques, their required equipment and fit with controlled target practice. They are not maximal-power, weighted-ball, rehabilitation or unfamiliar high-skill drills. The app does not assess technique or medical safety.</span>
      </label>
    </section>}
    {facts && <section className="cf-card cf-stack">
      <h3>Review reported current training</h3>
      <p className="cf-small">Reported in chat as of {facts.asOf}. Actual training—not your target or a readiness assessment.</p>
      <dl>
        <dt>Weekly running</dt><dd>{facts.weeklyRunMinutes} minutes across {facts.runsPerWeek} runs</dd>
        <dt>Longest comfortable run</dt><dd>{facts.longestRunMinutes} minutes</dd>
        <dt>Usual lifting</dt><dd>{facts.liftsPerWeek} sessions per week, {facts.liftDurationMin} minutes each</dd>
      </dl>
      <label className="cf-check"><input type="checkbox" checked={acknowledged} onChange={event => onAcknowledge(event.target.checked)} />
        <span>I have checked these current-training facts against what I actually do, not what I want to do. I will correct anything inaccurate before confirming my baseline.</span>
      </label>
    </section>}
    {reply.week && <>
      <p role="status">Not checked or saved yet. Continue stages this proposal for hard data, equipment and recorded-history checks in the week preview. Training and recovery warnings are advisory. Approval does not establish medical safety or technique.</p>
      <AuthoredWeekPreview week={reply.week} exerciseNames={exerciseNames} />
    </>}
  </>
}

export interface AuthoredWeekPreviewProps {
  week: AuthoredWeekProposal
  exerciseNames?: Readonly<Record<string, string>>
  warnings?: readonly string[]
}

export function AuthoredWeekPreview({ week, exerciseNames = {}, warnings = [] }: AuthoredWeekPreviewProps) {
  return <section className="cf-card cf-stack">
    <h3>Proposed week starting {week.weekStart}</h3>
    <p className="cf-small">Fixed practices stay in place. Gaps stay unknown; a time skip is not fatigue. No catch-up work or automatic progression.</p>
    {warnings.length > 0 && <ul role="status">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    {!week.sessions.length && <p>No added sessions: this is a rest-only proposal apart from fixed practices.</p>}
    {week.sessions.map(session => <article key={session.id} className="cf-card">
      <h4>{session.label}</h4>
      <p>{session.date} at {session.startTime} · {session.durationMin} minutes</p>
      {session.kind === 'workout' ? <>
        {session.sourceCommitmentId && <p className="cf-small">Inside fixed practice: {session.sourceCommitmentId}</p>}
        <ul>{session.blocks.map(block => {
          const id = block.unit === 'throws' ? block.drillId : block.exerciseId
          return <li key={id}>{exerciseNames[id] ?? id}: {block.unit === 'reps'
            ? `${block.sets} sets × ${block.reps} reps, target RPE ${block.targetRPE}`
            : block.unit === 'seconds' ? `${block.sets} sets × ${block.seconds} seconds`
              : `${block.throws} controlled throws`}</li>
        })}</ul>
      </> : <p>{session.kind === 'run' ? `${session.intent} run` : 'Easy conditioning'} · {session.modality.replaceAll('_', ' ')} · conversational effort</p>}
    </article>)}
  </section>
}
