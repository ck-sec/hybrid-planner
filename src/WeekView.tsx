import { useState } from 'react'
import type { FormEvent } from 'react'
import { DAY_NAMES } from '../engine/legacy/types.ts'
import type { ScheduledSession, Session, WeekPlan } from '../engine/legacy/types.ts'
import { formatDay, formatWeek } from './dates.ts'
import type { SavedWeek, SessionLog } from './state.ts'
import { MAX_NOTES_LENGTH } from './state.ts'

interface Props {
  week: SavedWeek
  plan: WeekPlan
  disabled: boolean
  onSaveLog: (sessionId: string, log: SessionLog) => Promise<boolean>
}

function SessionIcon({ kind }: { kind: Session['kind'] | 'rest' }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === 'run' ? <><path d="m3 18 5-5 4 2 2 5M8 13l3-6 4 4 5 1M6 8l5-1M8 19l-3 2" /><circle cx="14" cy="3.5" r="1.5" /></>
        : kind === 'lift' ? <><path d="M7 12h10M4 7v10M7 5v14M17 5v14M20 7v10M2 12h2M20 12h2" /></>
          : <><path d="M5 18c-1-8 4-12 14-12 0 9-4 14-12 13M5 21l9-10" /></>}
    </svg>
  )
}

function description(session: Session): string {
  return session.kind === 'run' ? `${session.minutes} min easy run` : `Full-body lift · ${session.exercises.length} ${session.exercises.length === 1 ? 'exercise' : 'exercises'}`
}

function SessionCard({ session, weekStart, log, disabled, onSave }: {
  session: ScheduledSession
  weekStart: string
  log: SessionLog | undefined
  disabled: boolean
  onSave: (log: SessionLog) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState<SessionLog['status'] | ''>(log?.status ?? '')
  const [notes, setNotes] = useState(log?.notes ?? '')
  const [error, setError] = useState('')
  const prefix = `${weekStart}-${session.id}`

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!status) { setError('Choose completed or skipped before saving.'); return }
    setError('')
    if (await onSave({ status, notes })) setEditing(false)
  }

  function startEditing() {
    setStatus(log?.status ?? '')
    setNotes(log?.notes ?? '')
    setError('')
    setEditing(true)
  }

  return (
    <article className={`day-card ${session.kind}-card`} aria-labelledby={`${prefix}-heading`}>
      <div className="day-card-top"><span className="day-name">{DAY_NAMES[session.day]}</span><span className="day-date">{formatDay(weekStart, session.day)}</span></div>
      <div className="session-title"><span className={`session-icon ${session.kind}-icon`}><SessionIcon kind={session.kind} /></span><div><p className="eyebrow">{session.kind === 'run' ? 'Run' : 'Lift'}</p><h3 id={`${prefix}-heading`}>{session.kind === 'run' ? 'Easy run' : 'Full-body strength'}</h3></div></div>
      {session.kind === 'run' ? (
        <><p className="run-duration">{session.minutes}<span>minutes</span></p><p className="session-detail">Easy, conversational effort. No pace target.</p></>
      ) : (
        <>
          <p className="session-detail">{session.exercises.length} {session.exercises.length === 1 ? 'exercise' : 'exercises'} · your unchanged template</p>
          <details className="exercise-details"><summary>View exercises</summary><ul>{session.exercises.map((exercise, index) => (
            <li key={index}><strong>{exercise.name}</strong><span>{exercise.sets} × {exercise.reps} · {exercise.loadKg === 0 ? 'bodyweight (0 kg)' : `${exercise.loadKg} kg`}</span></li>
          ))}</ul></details>
        </>
      )}
      <div className="session-log">
        {log ? <><p className="log-label">Logged: <strong>{log.status === 'completed' ? 'Completed' : 'Skipped'}</strong></p>{log.notes && <p className="log-notes">{log.notes}</p>}</> : <p className="log-label muted">Not logged</p>}
        {!editing ? <button className="text-button" type="button" disabled={disabled} onClick={startEditing}>{log ? 'Edit log' : 'Log session'} <span aria-hidden="true">↗</span></button> : (
          <form onSubmit={event => { void submit(event) }} className="log-form">
            <fieldset disabled={disabled}>
              <legend className="sr-only">Log {DAY_NAMES[session.day]} {session.kind}</legend>
              <div className="field"><label htmlFor={`${prefix}-status`}>Session status</label><select id={`${prefix}-status`} value={status} onChange={event => setStatus(event.target.value as SessionLog['status'] | '')} required><option value="">Choose status</option><option value="completed">Completed</option><option value="skipped">Skipped</option></select></div>
              <div className="field"><label htmlFor={`${prefix}-notes`}>Notes <span className="muted">(optional)</span></label><textarea id={`${prefix}-notes`} rows={3} maxLength={MAX_NOTES_LENGTH} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Anything you want to remember" aria-describedby={`${prefix}-notes-help`} /><p className="field-hint" id={`${prefix}-notes-help`}>{notes.length} / {MAX_NOTES_LENGTH} characters · stays on this browser</p></div>
              {error && <p role="alert" className="field-warning">{error}</p>}
              <div className="button-row"><button type="submit" className="button button-primary button-small">Save log</button><button type="button" className="button button-secondary button-small" onClick={() => setEditing(false)}>Cancel</button></div>
            </fieldset>
          </form>
        )}
      </div>
    </article>
  )
}

export default function WeekView({ week, plan, disabled, onSaveLog }: Props) {
  const runMinutes = plan.sessions.reduce((total, session) => total + (session.kind === 'run' ? session.minutes : 0), 0)
  const runs = plan.sessions.filter(session => session.kind === 'run').length
  const lifts = plan.sessions.filter(session => session.kind === 'lift').length
  return (
    <>
      <div className="week-summary" aria-label="Planned week summary">
        <span><strong>{runMinutes} min</strong> easy running</span><span><strong>{lifts}</strong> {lifts === 1 ? 'lift' : 'lifts'}</span><span><strong>{7 - plan.sessions.length}</strong> rest {7 - plan.sessions.length === 1 ? 'day' : 'days'}</span>
      </div>
      <p className="week-caption">{formatWeek(week.weekStart)} · Saved plan, not a target to make up.</p>
      {plan.omitted.length > 0 && <section className="omissions" aria-labelledby="omissions-heading">
        <h3 id="omissions-heading">Some work stays out this week.</h3>
        <p>{runs} of {week.input.baseline.runsPerWeek} runs and {lifts} of {week.input.baseline.liftsPerWeek} lifts fit safely. The following was not scheduled:</p>
        <ul>{plan.omitted.map(session => <li key={session.id}>{description(session)}</li>)}</ul>
        <p>It is not moved to another day or added to another session. No catching up.</p>
      </section>}
      <div className="week-grid">
        {DAY_NAMES.map((day, index) => {
          const session = plan.sessions.find(item => item.day === index)
          return session ? <SessionCard key={`${week.weekStart}-${session.id}`} session={session} weekStart={week.weekStart} log={week.logs[session.id]} disabled={disabled} onSave={log => onSaveLog(session.id, log)} />
            : <article className="day-card rest-card" key={`${week.weekStart}-${day}`} aria-label={`${day}, ${formatDay(week.weekStart, index)}, rest`}>
              <div className="day-card-top"><span className="day-name">{day}</span><span className="day-date">{formatDay(week.weekStart, index)}</span></div>
              <div className="session-title"><span className="session-icon rest-icon"><SessionIcon kind="rest" /></span><div><p className="eyebrow">Rest</p><h3>A day with space.</h3></div></div>
              <p className="session-detail">No planned training. Nothing to log or make up.</p>
            </article>
        })}
      </div>
      <details className="plan-explanation">
        <summary>Why this week looks this way <span aria-hidden="true">+</span></summary>
        <div className="explanation-content">
          <h3>Planner notes</h3><ul>{plan.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
          <h3>Safety checks after scheduling</h3><ul>{plan.audit.safetyRules.map((rule, index) => <li key={index}>{rule}</li>)}</ul>
          <p className="field-hint">Engine {plan.engineVersion} · {plan.audit.candidateCount.toLocaleString()} candidate placements · {plan.audit.rejectedCandidateCount.toLocaleString()} rejected · placement score {plan.audit.placementScore}. This score compares calendar arrangements, not your fitness or performance.</p>
          <h3>Frozen baseline for this week</h3>
          <p>{week.input.baseline.weeklyRunMinutes} running minutes across {week.input.baseline.runsPerWeek} runs, a {week.input.baseline.longestRunMinutes}-minute longest-run limit, and {week.input.baseline.liftsPerWeek} identical full-body lifts.</p>
          <p className="field-hint">Available: {week.input.baseline.availableDays.map(day => DAY_NAMES[day]).join(', ')}. Changing the form never changes this saved week.</p>
          <p className="field-hint">At generation: previous Sunday lift {week.input.boundary.previousSundayLift ? 'present' : 'not present'}; next Monday lift {week.input.boundary.nextMondayLift ? 'present' : 'not present'}. New neighboring weeks also check actual saved lift placements.</p>
        </div>
      </details>
    </>
  )
}
