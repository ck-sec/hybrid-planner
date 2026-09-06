import { useState } from 'react'
import type { FormEvent } from 'react'
import type { AthleteState, Goal, PlanWeekInput, Session, SessionLog } from '../engine/types.ts'
import { LEGACY_LIBRARY as DEFAULT_LIBRARY } from '../engine/library.ts'
import BlockSetup, { NumericField } from './BlockSetup.tsx'
import { numberFrom } from './form-values.ts'
import ModelWeekView from './ModelWeekView.tsx'
import type { AppState } from './model-state.ts'
import { inputForWeek, modelWeekKey, planForModelInput, previewForModelInput, saveModelWeek, startBlock, updateModelLog, weekStartFor } from './model-state.ts'

type Commit = (build: (current: AppState) => AppState, success: string, onSuccess?: () => void) => Promise<boolean>

export default function ModelWorkflow({ state, disabled, commit }: { state: AppState; disabled: boolean; commit: Commit }) {
  const [preview, setPreview] = useState<PlanWeekInput | null>(null)
  const [error, setError] = useState('')
  const [acceptOmissions, setAcceptOmissions] = useState(false)
  const [selected, setSelected] = useState('')
  const [setupEpoch, setSetupEpoch] = useState(0)
  const block = state.activeBlock
  const athlete = state.athlete
  const savedDates = new Set([...state.legacy.weeks.map(week => week.weekStart), ...state.modelWeeks.map(week => weekStartFor(week.input.block, week.input.weekIndex))])
  const availableIndices = block ? Array.from({ length: block.totalWeeks }, (_, index) => index).filter(index => !savedDates.has(weekStartFor(block, index))) : []
  const saved = [...state.modelWeeks].sort((a, b) => weekStartFor(b.input.block, b.input.weekIndex).localeCompare(weekStartFor(a.input.block, a.input.weekIndex)))
  const selectedWeek = saved.find(week => modelWeekKey(week.input) === selected) ?? saved[0]
  const plan = preview ? previewForModelInput(state, preview) : null

  function confirmWeek(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setPreview(null)
    setAcceptOmissions(false)
    if (!athlete) return
    const form = new FormData(event.currentTarget)
    try {
      if (form.get('weeklyComfortable') !== 'on') throw new Error('Confirm that this week’s baseline remains recent and comfortable.')
      const currentAthlete: AthleteState = {
        ...athlete,
        baseline: {
          ...athlete.baseline,
          weeklyRunMinutes: numberFrom(form, 'weeklyRunMinutes'),
          longestRunMinutes: numberFrom(form, 'longestRunMinutes'),
          runsPerWeek: numberFrom(form, 'runsPerWeek'),
          liftsPerWeek: numberFrom(form, 'liftsPerWeek'),
          liftDurationMin: numberFrom(form, 'liftDurationMin'),
        },
        weeklyTimeBudgetMin: numberFrom(form, 'weeklyTimeBudgetMin'),
      }
      const input = inputForWeek(state, numberFrom(form, 'weekIndex'), currentAthlete)
      planForModelInput(input)
      setPreview(input)
    } catch (error) { setError(error instanceof Error ? error.message : 'This week could not be previewed.') }
  }

  function pin(session: Session) {
    if (!preview) return
    setError('')
    setAcceptOmissions(false)
    try {
      const pins = [...preview.context.pinnedSessions.filter(item => item.id !== session.id), session]
      const next = inputForWeek(state, preview.weekIndex, preview.athlete, pins)
      planForModelInput(next)
      setPreview(next)
    } catch (error) { setError(error instanceof Error ? error.message : 'The rearrangement is invalid.'); setPreview(null) }
  }

  async function create(athlete: AthleteState, goal: Goal, start: string, confirmed: boolean) {
    return commit(current => startBlock(current, athlete, goal, start, confirmed), 'New baseline and block saved. Previous blocks, week inputs and logs are unchanged. Preview one week when ready.', () => {
      setPreview(null); setError(''); setSetupEpoch(value => value + 1)
    })
  }
  async function save() {
    if (!preview) return
    const candidate = preview
    await commit(current => saveModelWeek(current, candidate, acceptOmissions), 'Model week saved after safety checks. Its plan is now immutable; logs remain editable.', () => {
      setSelected(modelWeekKey(candidate)); setPreview(null); setAcceptOmissions(false)
    })
  }
  function saveLog(log: SessionLog) {
    if (!selectedWeek) return Promise.resolve(false)
    return commit(current => updateModelLog(current, modelWeekKey(selectedWeek.input), log), 'Log saved. No historical plan or other log was rewritten. Pain and illness holds do not clear automatically.', () => setPreview(null))
  }

  return <section className="model-workflow" id="model" aria-label="Current model planner">
    <div className="panel-heading"><div><p className="eyebrow">The current model · one week at a time</p><h2>A block with a stable starting point.</h2></div><span className="small-tag">0.2.0</span></div>
    <p className="model-intro">Established exercise anchors, conservative week-by-week planning, and transparent scheduling costs. No automatic load increases. No account or remote coach.</p>
    {state.legacy.weeks.length > 0 && <p className="notice">Archive sessions do not contain observed times or complete workload estimates. No duration or model AU is invented for them. A separate conservative calendar-day veto protects full-body lifting across archive boundaries; unsafe previews cannot be saved. Original archive inputs and logs remain unchanged.</p>}
    {athlete?.safetyHold && <div className="notice notice-error" role="alert"><strong>Training generation is on hold: {athlete.safetyHold.reason.replaceAll('_', ' ')} since {athlete.safetyHold.since}.</strong><p>Logs stay accessible. Do not use a previous preview as return-to-training advice. Reconfirm a new recent, comfortable baseline in block setup after this date to explicitly resolve the hold.</p></div>}
    {block && athlete ? <div className="panel active-block">
      <h3>{block.goal.label}</h3><p className="session-detail">{block.startDate} → goal {block.goal.peakDate} · {block.totalWeeks} weeks · anchors fixed for this block</p>
      <ol className="phase-list">{block.phases.map(phase => <li key={`${phase.startWeekIndex}-${phase.kind}`}><strong>{phase.kind}</strong> · weeks {phase.startWeekIndex + 1}–{phase.endWeekIndex + 1} · up to {Math.round(phase.volumeFraction * 100)}% of established volume</li>)}</ol>
      <details className="storage-details"><summary>Stable exercise anchors</summary><ul>{block.anchors.map(anchor => <li key={`${anchor.exerciseId}-${anchor.role}`}>{DEFAULT_LIBRARY.exercises.find(exercise => exercise.id === anchor.exerciseId)?.name ?? anchor.exerciseId} · {anchor.sets} × {anchor.reps} · target RPE {anchor.targetRPE} · {anchor.role}</li>)}</ul><p>These do not rotate or automatically progress. Weekly reductions may omit work. New established observations require a new baseline/block.</p></details>
      {availableIndices.length > 0 ? <form key={`${block.id}-${setupEpoch}-${state.modelWeeks.length}`} className="weekly-confirm" onSubmit={confirmWeek} onChange={() => { setPreview(null); setAcceptOmissions(false) }}>
        <fieldset disabled={disabled}>
          <h3>Confirm the next week, then preview</h3>
          <label className="model-field">Unsaved week in this block<select name="weekIndex" defaultValue={availableIndices[0]}>{availableIndices.map(index => <option key={index} value={index}>Week {index + 1} · {weekStartFor(block, index)}</option>)}</select></label>
          <div className="model-fields">
            <NumericField name="weeklyRunMinutes" label="Current comfortable run minutes / week" value={athlete.baseline.weeklyRunMinutes} min={1} max={600} />
            <NumericField name="longestRunMinutes" label="Current comfortable longest run (min)" value={athlete.baseline.longestRunMinutes} min={1} max={180} />
            <NumericField name="runsPerWeek" label="Current established runs / week" value={athlete.baseline.runsPerWeek} min={1} max={4} />
            <NumericField name="liftsPerWeek" label="Current established lifts / week" value={athlete.baseline.liftsPerWeek} min={1} max={3} />
            <NumericField name="liftDurationMin" label="Current established lift duration (min)" value={athlete.baseline.liftDurationMin} min={15} max={180} />
            <NumericField name="weeklyTimeBudgetMin" label="Time available this week (min)" value={athlete.weeklyTimeBudgetMin} min={1} max={10080} />
          </div>
          <label className="confirmation"><input type="checkbox" name="weeklyComfortable" required />These are my current recent comfortable amounts, not increases requested from the planner. My equipment, availability and exercise observations still apply; otherwise I will create a new baseline/block.</label>
          <button type="submit" className="button button-primary">Preview this week · do not save yet</button>
          <p className="field-hint">Prior 14 days inform estimated residual costs. Adjacent saved plans are checked separately. Unknown and skipped training are never silently recorded as completed.</p>
        </fieldset>
      </form> : <p className="notice">All calendar weeks in this block are already saved. Review history or create a new block; existing weeks cannot be overwritten.</p>}
    </div> : <div className="empty-week"><h3>Start with what you already do.</h3><p>Save your own baseline and a goal to create stable exercise anchors. Nothing is inferred from archive exercise names or example workloads.</p><a className="button button-secondary" href="#block-setup">Set up your block</a></div>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {preview && plan && <div className="preview-panel">
      <ModelWeekView input={preview} plan={plan} disabled={disabled} onPin={pin} />
      {preview.context.pinnedSessions.length > 0 && <button type="button" className="text-button" disabled={disabled} onClick={() => { setPreview(inputForWeek(state, preview.weekIndex, preview.athlete)); setAcceptOmissions(false) }}>Remove pins and preview again</button>}
      {plan.omitted.length > 0 && <label className="confirmation"><input type="checkbox" checked={acceptOmissions} onChange={event => setAcceptOmissions(event.target.checked)} disabled={disabled} />I understand the explicitly listed omissions. Save only the safe scheduled portion; do not add catch-up work.</label>}
      <button type="button" className="button button-primary" disabled={disabled || !plan.safety.passed || (plan.omitted.length > 0 && !acceptOmissions)} onClick={() => { void save() }}>Save this {plan.omitted.length ? 'partial ' : ''}week</button>
      <p className="field-hint">Saving is separate from preview. Unsafe previews cannot be saved. After saving, arrangement and planning inputs are immutable.</p>
    </div>}
    {saved.length > 0 && <section className="model-history" aria-labelledby="model-history-heading">
      <div className="week-heading-row"><h2 id="model-history-heading">Saved model weeks &amp; logs</h2><label className="model-field">Model history<select value={selectedWeek ? modelWeekKey(selectedWeek.input) : ''} onChange={event => setSelected(event.target.value)} disabled={disabled}>{saved.map(week => <option key={modelWeekKey(week.input)} value={modelWeekKey(week.input)}>{weekStartFor(week.input.block, week.input.weekIndex)} · {week.input.block.goal.label} · week {week.input.weekIndex + 1}</option>)}</select></label></div>
      {selectedWeek && <ModelWeekView input={selectedWeek.input} plan={planForModelInput(selectedWeek.input)} week={selectedWeek} disabled={disabled} onSaveLog={saveLog} />}
    </section>}
    {state.blockHistory.length > 0 && <details className="panel block-history"><summary>Block history · {state.blockHistory.length} saved</summary><ul>{state.blockHistory.map(item => <li key={item.id}><strong>{item.goal.label}</strong> · {item.startDate} → {item.goal.peakDate}{item.id === block?.id ? ' · active' : ' · archived'}<details><summary>Original phases and anchors</summary><ul>{item.phases.map(phase => <li key={`${phase.startWeekIndex}-${phase.kind}`}>{phase.kind}: weeks {phase.startWeekIndex + 1}–{phase.endWeekIndex + 1}</li>)}{item.anchors.map(anchor => <li key={`${anchor.exerciseId}-${anchor.role}`}>{anchor.exerciseId}: {anchor.sets} × {anchor.reps}, RPE {anchor.targetRPE}</li>)}</ul></details></li>)}</ul></details>}
    <details className="setup-disclosure" open={!block}><summary>{block ? 'Create a new confirmed baseline / block (also resolves holds)' : 'Your first baseline & block'}</summary>
      <BlockSetup key={setupEpoch} athlete={athlete} disabled={disabled} onSave={create} />
    </details>
  </section>
}
