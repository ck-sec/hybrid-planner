import { useState } from 'react'
import { LIMITS, PROGRAM_POLICY } from '../../engine/constants.ts'
import { recommendProgram } from '../../engine/program.ts'
import type { AssistantConfig } from './assistant.ts'
import { applyHandoff } from './handoff.ts'
import { equipmentForResources, programResources, resourcesForEquipment } from './equipment.ts'
import type { ResourceId } from './equipment.ts'
import { confirmSetupEquipment, nextCampaignWeek, normalizeRecommendedDraft, stable, workoutContent } from './model.ts'
import type { CampaignDraft, CampaignState } from './types.ts'
import { programmingChoices, selectProgramExercises } from './programming.ts'
import { ProgrammingChoice, PracticeBlockOptions } from './ProgrammingOptions.tsx'
import EquipmentPicker from './EquipmentPicker.tsx'
import ExercisePoolEditor from './ExercisePoolEditor.tsx'
import CoachingWorkbench from './CoachingWorkbench.tsx'
import { parseWorkoutCards } from './workout-cards.ts'

function sourceKey(state: CampaignState): string {
  return stable([state.draft, state.weeks, state.revisions, state.cards])
}

export default function ProgrammingRevision({ state, config, onConnect, onApply, onClose }: {
  state: CampaignState
  config?: AssistantConfig
  onConnect: (config: AssistantConfig | undefined) => void
  onApply: (next: CampaignState) => boolean
  onClose: () => void
}) {
  const [original] = useState(() => sourceKey(state))
  const [working, setWorking] = useState<CampaignState>(() => ({
    version: 1, step: 3, setupComplete: false, sample: state.sample,
    draft: { ...state.draft, confirmed: false }, weeks: [], selectedWeek: 0, setDrafts: {}, cards: state.cards ?? [],
  }))
  const [preview, setPreview] = useState<CampaignState | null>(null)
  const [showAI, setShowAI] = useState(false)
  const [issue, setIssue] = useState('')
  const changed = sourceKey(state) !== original
  const draft = working.draft
  const scope = { purpose: 'suggest_exercises' as const }
  const updateDraft = (next: CampaignDraft) => {
    try { setWorking(previous => ({ ...previous, draft: normalizeRecommendedDraft(next) })); setPreview(null); setIssue('') }
    catch (error) { setIssue(error instanceof Error ? error.message : 'The draft revision could not be changed.') }
  }
  const equipment = (resources: ResourceId[]) => {
    try {
      const next = { ...draft, resources, equipment: equipmentForResources(resources) }
      if (!draft.program) { updateDraft(next); return }
      const allowed = new Set(programmingChoices(next).map(item => item.exercise.id))
      const kept = draft.recommendedSetup!.exerciseIds.filter(id => allowed.has(id))
      const ids = kept.length >= PROGRAM_POLICY.minSelectedExercises ? kept : recommendProgram(programResources(resources), draft.program.goal).exerciseIds
      updateDraft(selectProgramExercises(next, ids))
    } catch (error) { setIssue(error instanceof Error ? error.message : 'The equipment revision could not be applied.') }
  }

  if (showAI) return <CoachingWorkbench state={working} scope={scope} config={config} onConnect={onConnect}
    onConfirmEquipment={resources => {
      const next = confirmSetupEquipment(working, resources)
      setWorking(next); setPreview(null); return true
    }}
    onCards={cards => { setWorking(previous => ({ ...previous, cards: parseWorkoutCards(cards) })); setPreview(null) }}
    onApply={(review, request, date) => {
      try { setWorking(applyHandoff(working, review, scope, request, date)); setPreview(null); return true }
      catch (error) { setIssue(error instanceof Error ? error.message : 'AI suggestions could not be reviewed.'); setShowAI(false); return false }
    }} onClose={() => setShowAI(false)} />

  return <section className="cf-stack">
    <div><p className="cf-kicker">CHANGE THE FUTURE, NOT THE RECORD</p><h2>Revise next week's exercises</h2></div>
    <p className="cf-small">Current and earlier sessions stay unchanged. Existing recovery, fatigue reductions and health holds carry forward. New variants start without borrowed weights.</p>
    {changed && <p role="alert" className="cf-error">The campaign changed while this revision was open. Close and reopen it before applying anything.</p>}
    <details className="cf-details"><summary>Equipment for the revision</summary><EquipmentPicker value={draft.resources ?? resourcesForEquipment(draft.equipment)} onChange={equipment} /></details>
    <ProgrammingChoice draft={draft} onChange={updateDraft} />
    {draft.program && <>
      <ExercisePoolEditor choices={programmingChoices(draft)} selected={draft.recommendedSetup!.exerciseIds} maxExercises={LIMITS.maxProgramExercises}
        goal={draft.goalLabel} resources={draft.resources ?? []} cards={working.cards ?? []} program={draft.program}
        onChange={ids => { try { updateDraft(selectProgramExercises(draft, ids)) } catch (error) { setIssue(error instanceof Error ? error.message : 'The selection could not be applied.') } }}
        onCards={cards => { setWorking(previous => ({ ...previous, cards: parseWorkoutCards(cards) })); setPreview(null) }} />
      <PracticeBlockOptions draft={draft} onChange={updateDraft} />
      <button type="button" className="cf-button cf-secondary" disabled={changed} onClick={() => setShowAI(true)}>Shape this revision with my AI</button>
      <button type="button" className="cf-button cf-primary" disabled={changed} onClick={() => {
        try {
          const next = nextCampaignWeek(state, { ...draft, confirmed: true })
          setPreview({ ...next, cards: parseWorkoutCards(working.cards ?? []) })
          setIssue('')
        } catch (error) { setIssue(error instanceof Error ? error.message : 'The revised week could not be generated.'); setPreview(null) }
      }}>Preview the revised week</button>
    </>}
    {preview && <div className="cf-card cf-stack">
      <h3>Review before committing</h3>
      <p>Only week {preview.selectedWeek + 1} uses this revision. Earlier prescriptions and logs are preserved.</p>
      {preview.weeks.at(-1)!.plan.sessions.map(session => <div key={session.id}><strong>{workoutContent(preview, session).title}</strong><p className="cf-small">{session.date} · {session.durationMin} min</p>
        {session.kind === 'workout' && <ul className="cf-small">{session.blocks.map((block, index) => <li key={index}>{block.unit === 'throws' ? `${block.throws} throws within practice` : `${preview.weeks.at(-1)!.input.library.exercises.find(item => item.id === block.exerciseId)?.name}: ${block.sets} x ${block.unit === 'reps' ? `${block.reps} reps at RPE ${block.targetRPE}` : `${block.seconds} seconds`}`}</li>)}</ul>}
      </div>)}
      {preview.weeks.at(-1)!.plan.omitted.map(item => <p role="status" className="cf-error" key={item.sessionId}>{item.reason}</p>)}
      <details className="cf-details"><summary>Engine checks and assumptions</summary>{preview.weeks.at(-1)!.plan.warnings.map((warning, index) => <p key={index} className="cf-small">{warning}</p>)}</details>
      <button type="button" className="cf-button cf-primary" disabled={changed} onClick={() => { if (onApply(preview)) onClose() }}>Use this revision for next week</button>
    </div>}
    {issue && <p role="alert" className="cf-error">{issue}</p>}
    <button type="button" className="cf-text-button" onClick={onClose}>Cancel revision</button>
  </section>
}
