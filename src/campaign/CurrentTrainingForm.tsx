import { useState } from 'react'
import { AI_ADVISORY_LIMITS } from '../../engine/constants.ts'
import type { CampaignDraft } from './types.ts'
import { parseCurrentTraining } from './training-baseline.ts'
import type { CurrentTraining } from './training-baseline.ts'
import { NumberField } from './components.tsx'

export default function CurrentTrainingForm({ draft, onChange }: {
  draft: CampaignDraft
  onChange: (training: CurrentTraining) => boolean
}) {
  const [training, setTraining] = useState<CurrentTraining>(() => draft.currentTraining ?? {
    version: 1, source: 'manual', asOf: draft.startDate,
    weeklyRunMinutes: 0, longestRunMinutes: 0, runsPerWeek: 0, liftsPerWeek: 0, liftDurationMin: 0,
  })
  const [issue, setIssue] = useState('')
  const patch = (change: Partial<CurrentTraining>) => setTraining(previous => ({ ...previous, ...change, source: 'manual' }))
  return <div className="cf-stack">
    <p className="cf-small">Report recent, comfortable training—not your target. Recordings cannot establish comfort, missing activities or working weights.</p>
    <label className="cf-field">Current training as of<input type="date" value={training.asOf} max={draft.startDate} onChange={event => patch({ asOf: event.target.value })} /></label>
    <div className="cf-two">
      <NumberField label="Recent runs per week" value={training.runsPerWeek} min={0} max={AI_ADVISORY_LIMITS.maxRuns} required={false} onChange={runsPerWeek => patch({ runsPerWeek })} />
      <NumberField label="Recent weekly running time" value={training.weeklyRunMinutes} min={0} max={AI_ADVISORY_LIMITS.maxWeeklyRunMinutes} suffix="min" required={false} onChange={weeklyRunMinutes => patch({ weeklyRunMinutes })} />
      <NumberField label="Longest comfortable run" value={training.longestRunMinutes} min={0} max={AI_ADVISORY_LIMITS.maxRunMinutes} suffix="min" required={false} onChange={longestRunMinutes => patch({ longestRunMinutes })} />
      <NumberField label="Recent lifts per week" value={training.liftsPerWeek} min={0} max={AI_ADVISORY_LIMITS.maxLifts} required={false} onChange={liftsPerWeek => patch({ liftsPerWeek })} />
      <NumberField label="Comfortable lifting session" value={training.liftDurationMin} min={0} max={AI_ADVISORY_LIMITS.maxLiftMinutes} suffix="min" required={false} onChange={liftDurationMin => patch({ liftDurationMin })} />
    </div>
    <p className="cf-small">Zero activity and frequent training are valid reports, not recommendations. AI and you decide the proposed training; the built-in planner has narrower baseline limits.</p>
    <button type="button" className="cf-button cf-secondary" onClick={() => {
      try {
        if (onChange(parseCurrentTraining({ ...training, source: 'manual' }))) setIssue('Added to your draft. Review and confirm these facts before building.')
        else setIssue('Current training could not be added. Resolve the displayed draft error before continuing.')
      }
      catch (error) { setIssue(error instanceof Error ? error.message : 'Current training could not be saved.') }
    }}>Add to review</button>
    {issue && <p role="status">{issue}</p>}
  </div>
}
