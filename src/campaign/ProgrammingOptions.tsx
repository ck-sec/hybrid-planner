import { useState } from 'react'
import type { ConditioningModality, ProgramGoal } from '../../engine/types.ts'
import { resourcesForEquipment } from './equipment.ts'
import { enableTemplateProgramming, PROGRAM_GOAL_LABELS } from './programming.ts'
import type { CampaignDraft } from './types.ts'

export function ProgrammingChoice({ draft, onChange }: { draft: CampaignDraft; onChange: (draft: CampaignDraft) => void }) {
  const [issue, setIssue] = useState('')
  return <div className="cf-card cf-stack">
    <div><h3>{draft.program ? 'Built-in programming' : 'Saved routine'}</h3></div>
    <p className="cf-small">{draft.program ? 'A complete starting plan. Session amounts and recovery checks come from the planning engine.' : 'This older draft keeps its original routine unless you choose to upgrade it.'}</p>
    {draft.program ? <details className="cf-details"><summary>Advanced: programming emphasis</summary><label className="cf-field">Emphasis<select value={draft.program.goal} onChange={event => onChange({ ...draft, confirmed: false, program: { ...draft.program!, goal: event.target.value as ProgramGoal } })}>{Object.entries(PROGRAM_GOAL_LABELS).filter(([id]) => id !== 'dodgeball' || draft.program?.goal === id).map(([id, label]) => <option value={id} key={id}>{id === 'dodgeball' ? 'Saved sport emphasis (legacy)' : label}</option>)}</select></label></details>
      : <button type="button" className="cf-button cf-primary" onClick={() => {
        try { onChange(enableTemplateProgramming(draft)); setIssue('') } catch (error) {
          setIssue(error instanceof Error ? error.message : 'Template programming could not be enabled.')
        }
      }}>Upgrade this draft to built-in programming</button>}
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
    <p className="cf-small">Add only a recent, comfortable routine for that activity. Running time is never converted into rowing or cycling tolerance.</p>
    {draft.program.conditioningBaselines.map(baseline => <div className="cf-inline" key={baseline.modality}><span>{CONDITIONING.find(item => item.modality === baseline.modality)?.label ?? baseline.modality}: {baseline.sessionsPerWeek} sessions, usually {Math.round(baseline.weeklyMinutes / baseline.sessionsPerWeek)} minutes</span><button type="button" className="cf-text-button" onClick={() => onChange({ ...draft, confirmed: false, program: { ...draft.program!, conditioningBaselines: draft.program!.conditioningBaselines.filter(item => item.modality !== baseline.modality) } })}>Remove</button></div>)}
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
    </> : <p className="cf-small">Select your cardio equipment before adding its routine.</p>}
    {issue && <p role="alert" className="cf-error">{issue}</p>}
  </div></details>
}

export function PracticeBlockOptions({ draft }: { draft: CampaignDraft; onChange: (draft: CampaignDraft) => void }) {
  const count = draft.program?.comfortableThrowsPerPractice
  if (count === undefined) return null
  return <p className="cf-small">Saved legacy practice ceiling: {count} throws per practice. Kept unchanged from your existing draft; not a new recommendation.</p>
}
