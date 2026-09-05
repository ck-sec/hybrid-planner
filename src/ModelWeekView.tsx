import { useState } from 'react'
import type { FormEvent } from 'react'
import { DAY_NAMES } from '../engine/constants.ts'
import type { PlanWeekInput, Session, SessionLog, SetLog, TargetRPE, WeekPlan } from '../engine/types.ts'
import { parseSessionLog } from '../engine/validation.ts'
import { dayOfWeekDate, daysBetween, formatDay, formatWeek } from './dates.ts'
import { NumericField } from './BlockSetup.tsx'
import { numberFrom } from './form-values.ts'
import type { ModelWeek } from './model-state.ts'

function SessionLogEditor({ session, input, log, disabled, onSave }: {
  session: Session; input: PlanWeekInput; log?: SessionLog; disabled: boolean; onSave: (value: SessionLog) => Promise<boolean>
}) {
  const [status, setStatus] = useState<SessionLog['status']>(log?.status ?? 'completed')
  const [setRows, setSetRows] = useState<number[]>((log?.sets ?? []).map((_, index) => index))
  const [error, setError] = useState('')
  const prescriptions = session.kind === 'strength' ? session.strengthPrescription : []
  const exerciseName = (id: string) => input.library.exercises.find(item => item.id === id)?.name ?? id
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      const sets: SetLog[] = (status === 'skipped' ? [] : setRows).map(row => ({
        exerciseId: String(form.get(`set_${row}_exercise`)),
        weightKg: numberFrom(form, `set_${row}_weight`),
        reps: numberFrom(form, `set_${row}_reps`),
        actualRPE: numberFrom(form, `set_${row}_rpe`) as TargetRPE,
      }))
      const parsed = parseSessionLog({
        sessionId: session.id,
        status,
        ...(status === 'skipped' ? { skipReason: form.get('skipReason') } : {}),
        ...(status !== 'skipped' && String(form.get('actualEffort') ?? '').trim() ? { actualEffort: numberFrom(form, 'actualEffort') } : {}),
        ...(status !== 'skipped' && String(form.get('actualDurationMin') ?? '').trim() ? { actualDurationMin: numberFrom(form, 'actualDurationMin') } : {}),
        ...(sets.length ? { sets } : {}),
        painFlag: form.get('painFlag') === 'on',
        notes: String(form.get('notes') ?? ''),
      })
      await onSave(parsed)
    } catch (error) { setError(error instanceof Error ? error.message : 'Check this log.') }
  }
  return <details className="session-log">
    <summary>{log ? `Logged: ${log.status} · edit log` : 'Log this session'}</summary>
    {log?.notes && <p className="log-notes">{log.notes}</p>}
    {log?.actualEffort !== undefined && log.actualDurationMin !== undefined && <p className="field-hint">Actual whole-session effort × minutes: {log.actualEffort * log.actualDurationMin} session-training-load units. Separate from estimated model AU.</p>}
    <form className="log-form" onSubmit={event => { void submit(event) }}>
      <fieldset disabled={disabled}>
        <label className="model-field">Status<select value={status} onChange={event => setStatus(event.target.value as SessionLog['status'])}><option value="completed">Completed</option><option value="partial">Partial</option><option value="skipped">Skipped</option></select></label>
        {status === 'skipped' && <label className="model-field">Reason for skipping<select name="skipReason" required defaultValue={log?.skipReason ?? ''}><option value="" disabled>Choose a reason</option>{['life', 'too_tired', 'pain', 'illness', 'weather', 'other'].map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>}
        {status !== 'skipped' && <div className="model-fields">
          <NumericField name="actualEffort" label="Actual whole-session effort · optional (0–10)" value={log?.actualEffort} max={10} step="any" required={false} />
          <NumericField name="actualDurationMin" label="Actual duration · optional (min)" value={log?.actualDurationMin} min={0.1} max={1440} step="any" required={false} />
        </div>}
        <p className="field-hint">Whole-session effort is not last-set RPE. Every completed session needs actual duration before its week is fully accounted. Partial and skipped sessions never count as completed. Ordinary life/weather/other skips do not create a health hold.</p>
        {status !== 'skipped' && prescriptions.length > 0 && <fieldset className="model-section"><legend>Optional actual set logs</legend>
          {setRows.map(row => <div className="exercise-row" key={row}>
            <label className="model-field">Exercise for actual set<select name={`set_${row}_exercise`} defaultValue={log?.sets?.[row]?.exerciseId ?? prescriptions[0].exerciseId}>{prescriptions.map(item => <option key={item.exerciseId} value={item.exerciseId}>{exerciseName(item.exerciseId)}</option>)}</select></label>
            <div className="model-fields">
              <NumericField name={`set_${row}_weight`} label="Actual external kg" value={log?.sets?.[row]?.weightKg} max={500} step="any" />
              <NumericField name={`set_${row}_reps`} label="Actual reps" value={log?.sets?.[row]?.reps} min={1} max={50} />
              <NumericField name={`set_${row}_rpe`} label="Actual last-set RPE" value={log?.sets?.[row]?.actualRPE} min={6} max={10} step={0.5} />
            </div>
            <button type="button" className="text-button" onClick={() => setSetRows(setRows.filter(value => value !== row))}>Remove actual set</button>
          </div>)}
          <button type="button" className="text-button" disabled={setRows.length >= 80} onClick={() => setSetRows([...setRows, Math.max(-1, ...setRows) + 1])}>Add an actual set</button>
        </fieldset>}
        <label className="check-line"><input name="painFlag" type="checkbox" defaultChecked={log?.painFlag ?? false} />Pain during or after this session</label>
        <p className="field-warning">Pain, or skipping for illness, creates a persistent planning hold. Editing the flag away does not clear it. A new confirmed comfortable baseline/block is required.</p>
        <label className="model-field">Notes<textarea name="notes" maxLength={2000} rows={3} defaultValue={log?.notes ?? ''} /></label>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <button type="submit" className="button button-secondary button-small">Save session log</button>
      </fieldset>
    </form>
  </details>
}

function PinEditor({ session, plan, disabled, onPin }: {
  session: Session; plan: WeekPlan; disabled: boolean; onPin: (session: Session) => void
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const offset = Number(form.get('day'))
    const date = dayOfWeekDate(plan.weekStart, offset).toISOString().slice(0, 10)
    onPin({ ...session, date, startTime: String(form.get('time')), pinned: true })
  }
  return <details className="session-log"><summary>{session.pinned ? 'Pinned · preview another arrangement' : 'Choose a day & time / pin'}</summary>
    <form className="log-form" onSubmit={submit}><fieldset disabled={disabled}>
      <label className="model-field">Pinned day<select name="day" defaultValue={daysBetween(plan.weekStart, session.date)}>{DAY_NAMES.map((day, index) => <option key={day} value={index}>{day} · {formatDay(plan.weekStart, index)}</option>)}</select></label>
      <label className="model-field">Pinned start time<input type="time" name="time" defaultValue={session.startTime ?? ''} required /></label>
      <button type="submit" className="button button-secondary button-small">Preview rearrangement</button>
      <p className="field-hint">This re-scores the whole candidate with safety checks. It does not save or rewrite a week.</p>
    </fieldset></form>
  </details>
}

export default function ModelWeekView({ input, plan, week, disabled, onSaveLog, onPin }: {
  input: PlanWeekInput; plan: WeekPlan; week?: ModelWeek; disabled: boolean;
  onSaveLog?: (value: SessionLog) => Promise<boolean>; onPin?: (session: Session) => void
}) {
  return <section className="model-week" aria-label={week ? 'Saved model week' : 'Unsaved model preview'}>
    <div className="week-heading-row"><div><p className="eyebrow">{week ? 'Saved · immutable plan' : 'Preview · not saved'}</p><h3>{formatWeek(plan.weekStart)}</h3></div><span className="small-tag">{plan.phase} · week {plan.weekIndex + 1}</span></div>
    <p className="session-detail">{plan.intent}</p>
    {!plan.safety.passed && <div className="notice notice-error" role="alert"><strong>Not safe to save or use as a plan.</strong><ul>{plan.safety.violations.map((item, index) => <li key={index}>{item.message}</li>)}</ul></div>}
    {(!plan.feasibility.fits || plan.omitted.length > 0) && <div className="omissions"><h3>Some training does not fit</h3><p>Omitted sessions are not catch-up work and are not redistributed.</p><ul>{plan.omitted.map(item => <li key={item.sessionId}>{item.sessionId}: {item.reason}</li>)}{plan.feasibility.issues.map((issue, index) => <li key={`issue-${index}`}>{issue}</li>)}</ul>{plan.feasibility.suggestions.map((suggestion, index) => <p key={index}>{suggestion}</p>)}</div>}
    {plan.warnings.length > 0 && <div className="notice"><strong>Before using this preview</strong><ul>{plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
    {input.context.neighboringSessions.some(session => session.id.startsWith('legacy-')) && <p className="notice">This frozen historical input contains explicit archive-boundary estimates. They are not observed archive workload or new prescriptions. New previews use an unknown-time calendar-day veto instead of inventing archive duration or AU.</p>}
    <div className="week-grid">{DAY_NAMES.map((day, index) => {
      const date = dayOfWeekDate(plan.weekStart, index).toISOString().slice(0, 10)
      const sessions = plan.sessions.filter(session => session.date === date)
      return <article className={`day-card${sessions.length ? '' : ' rest-card'}`} key={day}>
        <div className="day-card-top"><span className="day-name">{day}</span><time className="day-date" dateTime={date}>{formatDay(plan.weekStart, index)}</time></div>
        {!sessions.length && <><h3>Rest / unscheduled</h3><p className="session-detail">No training assigned. No catching up.</p></>}
        {sessions.map(session => <section className="model-session" key={session.id}>
          <h4>{session.kind === 'run' ? `${session.endurancePrescription.intent === 'long' ? 'Long easy' : 'Easy'} run` : session.kind === 'strength' ? 'Established strength' : session.label}</h4>
          <p className="session-detail">{session.startTime ?? 'Time unknown'} · {session.durationMin} min{session.isCalibration ? ' · calibration' : ''}{session.pinned ? ' · pinned' : ''}</p>
          {session.kind === 'run' && <p className="session-detail">Conversational effort. No pace target or intensity increase.</p>}
          {session.kind === 'strength' && <ul className="prescription-list">{session.strengthPrescription.map(exercise => <li key={exercise.exerciseId}>
            <strong>{input.library.exercises.find(item => item.id === exercise.exerciseId)?.name ?? exercise.exerciseId}</strong>
            <span>{exercise.sets} × {exercise.reps} · target set RPE {exercise.targetRPE} · {exercise.role}</span>
            <span>{exercise.suggestedWeightKg === undefined ? 'No automatic starting weight' : `${exercise.suggestedWeightKg} kg suggested from your own compatible observation`}</span>
          </li>)}</ul>}
          {session.kind === 'commitment' && <p className="field-hint">Your established commitment · user-estimated load, not a new prescription.</p>}
          <p className="session-detail">{session.reason}</p>
          <p className="field-hint">estimatedAU · systemic {session.predictedLoad.systemic.toFixed(1)} / structural {session.predictedLoad.structural.toFixed(1)}. Model scheduling costs, not measured readiness.</p>
          {onPin && session.kind !== 'commitment' && <PinEditor key={`${session.id}-${session.date}-${session.startTime}`} session={session} plan={plan} disabled={disabled} onPin={onPin} />}
          {week && onSaveLog && <SessionLogEditor key={`${session.id}-${JSON.stringify(week.logs[session.id])}`} session={session} input={input} log={week.logs[session.id]} disabled={disabled} onSave={onSaveLog} />}
        </section>)}
      </article>
    })}</div>
    <details className="plan-explanation"><summary>Why this arrangement? Model estimates &amp; safety <span aria-hidden="true">+</span></summary><div className="explanation-content">
      <p>All load figures are estimatedAU. They are not physiological measurements, readiness scores, promises of recovery or injury probabilities. Smaller scheduling penalties are preferences, not permission to bypass safety.</p>
      <p>Scheduling preference penalty: {plan.totalScore.toFixed(2)} (weighted penalty units, not AU). {plan.audit.candidatesScored} candidates scored; {plan.audit.rejectedBySafety} rejected by safety.</p>
      <ul>{plan.penalties.map((penalty, index) => <li key={index}><strong>{penalty.rule}</strong>: {penalty.explanation} · weight {penalty.weight}, magnitude {penalty.magnitude.toFixed(3)}, penalty {penalty.score.toFixed(2)} · {penalty.evidence}</li>)}</ul>
      <p>Engine {plan.engineVersion} · policy {plan.policyVersion} · library {plan.libraryVersion}. Cost multiplier: {input.athlete.calibration.costMultiplier}{input.athlete.calibration.costMultiplier === 1 ? ' (default)' : ' (explicit experimental input, not learned)'}. Observation count: {input.athlete.calibration.observationCount} (informational only). Recovery half-lives stay fixed. Actual effort logs never recalibrate the two AU axes.</p>
    </div></details>
  </section>
}
