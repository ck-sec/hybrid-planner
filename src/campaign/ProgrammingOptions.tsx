import { useState } from 'react'
import { availableSportDrills } from '../../engine/program.ts'
import type { ConditioningModality, ProgramGoal } from '../../engine/types.ts'
import { programResources, resourcesForEquipment } from './equipment.ts'
import { enableTemplateProgramming, PROGRAM_GOAL_LABELS } from './programming.ts'
import type { CampaignDraft } from './types.ts'

export function ProgrammingChoice({ draft, onChange }: { draft: CampaignDraft; onChange: (draft: CampaignDraft) => void }) {
  const [issue, setIssue] = useState('')
  return <div className="cf-card cf-stack">
    <div><p className="cf-kicker">MORE THAN A REPEATED ROUTINE</p><h3>Template-based sessions</h3></div>
    <p className="cf-small">Complementary strength sessions, kettlebell movements, timed carries and supported execution styles. The engine still owns quantities and recovery checks.</p>
    {draft.program ? <label className="cf-field">Programming emphasis<select value={draft.program.goal} onChange={event => onChange({ ...draft, confirmed: false, program: { ...draft.program!, goal: event.target.value as ProgramGoal } })}>{Object.entries(PROGRAM_GOAL_LABELS).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
      : <button type="button" className="cf-button cf-primary" onClick={() => {
        try { onChange(enableTemplateProgramming(draft)); setIssue('') } catch (error) {
          setIssue(error instanceof Error ? error.message : 'Template programming could not be enabled.')
        }
      }}>Use template-based sessions</button>}
    {draft.program && <p className="cf-small">Enabled for this draft only. Previously committed calendars are not upgraded automatically.</p>}
    {issue && <p role="alert" className="cf-error">{issue} Check floor space and support equipment above.</p>}
  </div>
}

const CONDITIONING = [
  { modality: 'row', resource: 'rower', label: 'Rowing' },
  { modality: 'ski_erg', resource: 'ski_erg', label: 'SkiErg' },
  { modality: 'bike_road', resource: 'bike', label: 'Cycling' },
] as const

export function ConditioningOptions({ draft, onChange }: { draft: CampaignDraft; onChange: (draft: CampaignDraft) => void }) {
  const [modality, setModality] = useState<ConditioningModality>('row')
  const [duration, setDuration] = useState('')
  const [frequency, setFrequency] = useState('')
  const [issue, setIssue] = useState('')
  if (!draft.program) return null
  const resources = draft.resources ?? resourcesForEquipment(draft.equipment)
  const available = CONDITIONING.filter(item => resources.includes(item.resource))
  return <details className="cf-details"><summary>Already row, cycle or use a SkiErg?</summary><div className="cf-stack">
    <p className="cf-small">Add only a recent, comfortable routine for that specific modality. Running time is never converted into rowing or SkiErg tolerance. These sessions count toward the same weekly budget.</p>
    {draft.program.conditioningBaselines.map(baseline => <div className="cf-inline" key={baseline.modality}><span>{CONDITIONING.find(item => item.modality === baseline.modality)?.label ?? baseline.modality}: {baseline.sessionsPerWeek} sessions, {baseline.weeklyMinutes} min/week</span><button type="button" className="cf-text-button" onClick={() => onChange({ ...draft, confirmed: false, program: { ...draft.program!, conditioningBaselines: draft.program!.conditioningBaselines.filter(item => item.modality !== baseline.modality) } })}>Remove</button></div>)}
    {available.length ? <>
      <label className="cf-field">Modality<select value={available.some(item => item.modality === modality) ? modality : ''} onChange={event => setModality(event.target.value as ConditioningModality)}><option value="" disabled>Choose an equipped modality</option>{available.map(item => <option key={item.modality} value={item.modality}>{item.label}</option>)}</select></label>
      <div className="cf-two"><label className="cf-field">Usual comfortable duration (minutes)<input type="number" inputMode="numeric" min="1" max="180" step="1" value={duration} onChange={event => setDuration(event.target.value)} /></label><label className="cf-field">Usual sessions per week<input type="number" inputMode="numeric" min="1" max="4" step="1" value={frequency} onChange={event => setFrequency(event.target.value)} /></label></div>
      <p className="cf-small">That usual duration is also the conservative longest-session cap; it is not a measured maximum.</p>
      <button type="button" className="cf-button cf-secondary" onClick={() => {
        const minutes = Number(duration)
        const count = Number(frequency)
        if (!available.some(item => item.modality === modality) || !duration.trim() || !frequency.trim()
          || !Number.isInteger(minutes) || minutes < 1 || minutes > 180 || !Number.isInteger(count) || count < 1 || count > 4) {
          setIssue('Choose an equipped modality and enter its usual duration and frequency.')
          return
        }
        onChange({ ...draft, confirmed: false, program: { ...draft.program!, conditioningBaselines: [
          ...draft.program!.conditioningBaselines.filter(item => item.modality !== modality),
          { modality, weeklyMinutes: minutes * count, longestSessionMinutes: minutes, sessionsPerWeek: count },
        ] } })
        setIssue('')
      }}>Use this established routine</button>
    </> : <p className="cf-small">Select a rower, SkiErg or bike in Your equipment before adding its routine.</p>}
    {issue && <p role="alert" className="cf-error">{issue}</p>}
  </div></details>
}

export function PracticeBlockOptions({ draft, onChange }: { draft: CampaignDraft; onChange: (draft: CampaignDraft) => void }) {
  const [count, setCount] = useState('')
  const [issue, setIssue] = useState('')
  if (!draft.program || draft.goalKind !== 'dodgeball' || !draft.practiceDays.length) return null
  const equipped = availableSportDrills(programResources(draft.resources ?? resourcesForEquipment(draft.equipment))).length > 0
  return <details className="cf-details"><summary>Include a supported throwing-technique block</summary><div className="cf-stack">
    <p className="cf-small">Controlled target throws fit inside your existing practice, not on top. Count all throws in practice, including games and warm-up. A usual count is an administrative exposure ceiling, not a proven injury-safe dose.</p>
    {!equipped ? <p className="cf-small">Confirm dodgeballs, court space and a safe throwing target in Your equipment first.</p> : <>
      {draft.program.comfortableThrowsPerPractice !== undefined && <p role="status" className="cf-small">Recorded usual ceiling: {draft.program.comfortableThrowsPerPractice} throws per practice.</p>}
      <label className="cf-field">Your recent comfortable total throws per practice<input type="number" inputMode="numeric" min="1" max="500" step="1" value={count} onChange={event => setCount(event.target.value)} /></label>
      <button type="button" className="cf-button cf-secondary" onClick={() => {
        const amount = Number(count)
        if (!count.trim() || !Number.isInteger(amount) || amount < 1 || amount > 500) { setIssue('Enter a known recent practice count, not a target or guessed allowance.'); return }
        onChange({ ...draft, confirmed: false, program: { ...draft.program!, goal: 'dodgeball', comfortableThrowsPerPractice: amount } })
        setIssue('')
      }}>Confirm established count</button>
      {draft.program.comfortableThrowsPerPractice !== undefined && <button type="button" className="cf-text-button" onClick={() => {
        const program = { ...draft.program! }
        delete program.comfortableThrowsPerPractice
        onChange({ ...draft, confirmed: false, program })
      }}>Keep practice without a generated drill block</button>}
    </>}
    {issue && <p role="alert" className="cf-error">{issue}</p>}
  </div></details>
}
