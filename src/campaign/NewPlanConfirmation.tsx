import type { CampaignState } from './types.ts'

export default function NewPlanConfirmation({ state, ready, onBackup, onCancel, onConfirm }: {
  state: CampaignState
  ready: boolean
  onBackup: () => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const logs = state.weeks.flatMap(week => Object.values(week.logs))
  return <section className="cf-stack" aria-labelledby="new-plan-title">
    <div><p className="cf-kicker">A FRESH START, NOT A LOST RECORD</p><h2 id="new-plan-title">Replace this plan?</h2></div>
    <p>This ends <strong>{state.draft.goalLabel}</strong> and removes its remaining workouts from your active calendar.</p>
    <p>Your {logs.length} recorded session{logs.length === 1 ? '' : 's'}, including partial workouts and skips, stay in read-only training history. Unlogged workouts are not marked completed.</p>
    <p className="cf-small">Your goal, equipment, exercises and routine are prefilled for editing. Review them and confirm a new recent, comfortable baseline before building. No new week is generated automatically.</p>
    {Object.keys(state.setDrafts).length > 0 && <p className="cf-small">Unsubmitted set entries are kept in the previous plan's backup, but are not counted as logged training.</p>}
    <p className="cf-small">Restarting is not clearance to train through pain or illness.</p>
    {!ready && <p role="status">Finish saving or resolve the storage error before starting a new plan.</p>}
    <button type="button" className="cf-button cf-secondary" onClick={onBackup}>Export backup first</button>
    <div className="cf-inline">
      <button type="button" className="cf-button cf-primary" disabled={!ready} onClick={onConfirm}>Start new plan &amp; keep history</button>
      <button type="button" className="cf-button cf-secondary" onClick={onCancel}>Keep current plan</button>
    </div>
  </section>
}
