import { useState } from 'react'
import { LIMITS, PROGRAM_POLICY } from '../../engine/constants.ts'
import { recommendProgram } from '../../engine/program.ts'
import { resolveProgramLibrary } from '../../engine/library.ts'
import { buildWeekReview } from './week-review.ts'
import { stageCustomExercises } from './custom-exercises.ts'
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
  const [reviewSummary, setReviewSummary] = useState('')
  const changed = sourceKey(state) !== original
  const draft = working.draft
  const weekReview = buildWeekReview(state)
  const scope = { purpose: 'suggest_exercises' as const, weekReview }
  const updateDraft = (next: CampaignDraft) => {
    try {
      const normalized = normalizeRecommendedDraft(next)
      setWorking(previous => ({ ...previous, draft: normalized })); setPreview(null); setIssue(''); return true
    } catch (error) { setIssue(error instanceof Error ? error.message : 'The draft revision could not be changed.'); return false }
  }
  const equipment = (resources: ResourceId[]) => {
    try {
      const next = { ...draft, resources, equipment: equipmentForResources(resources) }
      if (!draft.program) { updateDraft(next); return }
      const allowed = new Set(programmingChoices(next).map(item => item.exercise.id))
      const kept = draft.recommendedSetup!.exerciseIds.filter(id => allowed.has(id))
      const ids = kept.length >= PROGRAM_POLICY.minSelectedExercises ? kept : recommendProgram(programResources(resources), draft.program.goal, resolveProgramLibrary(draft.program)).exerciseIds
      updateDraft(selectProgramExercises(next, ids))
    } catch (error) { setIssue(error instanceof Error ? error.message : 'The equipment revision could not be applied.') }
  }

  if (showAI) return <CoachingWorkbench state={working} scope={scope} config={config} onConnect={onConnect}
    onConfirmEquipment={resources => {
      const next = confirmSetupEquipment(working, resources)
      setWorking(next); setPreview(null); return true
    }}
    onCards={cards => { setWorking(previous => ({ ...previous, cards: parseWorkoutCards(cards, previous.draft.program) })); setPreview(null) }}
    onApply={(review, request, date) => {
      try {
        setWorking(applyHandoff(working, review, scope, request, date))
        setReviewSummary(review.reply.summary); setPreview(null); return true
      }
      catch (error) { setIssue(error instanceof Error ? error.message : 'AI suggestions could not be reviewed.'); setShowAI(false); return false }
    }} onClose={() => setShowAI(false)} />

  return <section className="cf-stack">
    <div><p className="cf-kicker">ONE WEEK AT A TIME</p><h2>Review this week. Shape the next.</h2></div>
    <p className="cf-small">Recorded work stays unchanged. Recovery, fatigue reductions and health holds carry forward. No catch-up work or borrowed weights.</p>
    {weekReview && <div className="cf-card cf-stack">
      <h3>This week's record</h3>
      <p>{weekReview.counts.completed} completed · {weekReview.counts.partial} in progress · {weekReview.counts.skipped} skipped · {weekReview.counts.unlogged} unlogged</p>
      {(weekReview.counts.removed > 0 || weekReview.counts.omitted > 0) && <p className="cf-small">{weekReview.counts.removed} removed · {weekReview.counts.omitted} omitted by the engine</p>}
      <p className="cf-small">Unlogged work stays unknown, not completed. Finish recording before continuing; this week then becomes read-only.</p>
      {weekReview.counts.partial > 0 && <p role="status">Finish each in-progress session before building the next week.</p>}
      <details className="cf-details"><summary>Review individual records</summary>{weekReview.sessions.map(session => <p key={session.id} className="cf-small">
        {session.date}: {session.label ?? session.kind} — {session.status}{session.skipReason ? ` (${session.skipReason === 'too_tired' ? 'fatigue' : 'time'})` : ''}
        {session.actualDurationMin !== null && ` · ${session.actualDurationMin} actual minutes`}
      </p>)}</details>
    </div>}
    {changed && <p role="alert" className="cf-error">The campaign changed while this revision was open. Close and reopen it before applying anything.</p>}
    {reviewSummary && <div className="cf-card"><h3>AI notes from your review</h3><p>{reviewSummary}</p><p className="cf-small">Unverified context. Your final selection and all engine guardrails still apply.</p></div>}
    <details className="cf-details"><summary>Equipment for the revision</summary><EquipmentPicker value={draft.resources ?? resourcesForEquipment(draft.equipment)} onChange={equipment} /></details>
    <details className="cf-details"><summary>Adjust next week's exercises</summary><div className="cf-stack">
      <ProgrammingChoice draft={draft} onChange={updateDraft} />
      {draft.program && <>
      <ExercisePoolEditor choices={programmingChoices(draft)} selected={draft.recommendedSetup!.exerciseIds} maxExercises={LIMITS.maxProgramExercises}
        goal={draft.goalLabel} resources={draft.resources ?? []} cards={working.cards ?? []} program={draft.program}
        onChange={ids => { try { updateDraft(selectProgramExercises(draft, ids)) } catch (error) { setIssue(error instanceof Error ? error.message : 'The selection could not be applied.') } }}
        onCards={cards => { setWorking(previous => ({ ...previous, cards: parseWorkoutCards(cards, previous.draft.program) })); setPreview(null) }}
        onCreateCustom={exercise => {
          try {
            const next = stageCustomExercises(draft, [exercise])
            const ids = next.recommendedSetup!.exerciseIds
            return updateDraft(ids.length < LIMITS.maxProgramExercises ? selectProgramExercises(next, [...ids, exercise.id]) : next)
          } catch (error) { setIssue(error instanceof Error ? error.message : 'The custom exercise could not be saved.'); return false }
        }} />
      <PracticeBlockOptions draft={draft} onChange={updateDraft} />
      </>}
    </div></details>
      <button type="button" className="cf-button cf-secondary" disabled={changed} onClick={() => setShowAI(true)}>Review with my AI</button>
      <button type="button" className="cf-button cf-primary" disabled={changed} onClick={() => {
        try {
          const confirmedDraft = normalizeRecommendedDraft({ ...draft, confirmed: true })
          const next = nextCampaignWeek(state, stable(confirmedDraft) === stable(state.draft) ? undefined : confirmedDraft)
          if (reviewSummary) {
            const nextWeek = next.weeks.at(-1)!
            nextWeek.changes = [...nextWeek.changes, {
              id: `change-${nextWeek.input.weekIndex}-ai-review`,
              message: `AI review of the previous week (unverified context; the final selection may have been edited): ${reviewSummary}`,
            }]
          }
          setPreview({ ...next, cards: parseWorkoutCards(working.cards ?? [], next.draft.program) })
          setIssue('')
        } catch (error) { setIssue(error instanceof Error ? error.message : 'The revised week could not be generated.'); setPreview(null) }
      }}>Preview next week</button>
    {preview && <div className="cf-card cf-stack">
      <h3>Review before committing</h3>
      <p>Only week {preview.selectedWeek + 1} uses this revision. Earlier prescriptions and logs are preserved.</p>
      {preview.weeks.at(-1)!.plan.sessions.map(session => <div key={session.id}><strong>{workoutContent(preview, session).title}</strong><p className="cf-small">{session.date} · {session.durationMin} min</p>
        {session.kind === 'workout' && <ul className="cf-small">{session.blocks.map((block, index) => <li key={index}>{block.unit === 'throws' ? `${block.throws} throws within practice` : `${preview.weeks.at(-1)!.input.library.exercises.find(item => item.id === block.exerciseId)?.name}: ${block.sets} x ${block.unit === 'reps' ? `${block.reps} reps at RPE ${block.targetRPE}` : `${block.seconds} seconds`}`}</li>)}</ul>}
      </div>)}
      {preview.weeks.at(-1)!.plan.omitted.map(item => <p role="status" className="cf-error" key={item.sessionId}>{item.reason}</p>)}
      <details className="cf-details"><summary>Engine checks and assumptions</summary>{preview.weeks.at(-1)!.plan.warnings.map((warning, index) => <p key={index} className="cf-small">{warning}</p>)}</details>
      <button type="button" className="cf-button cf-primary" disabled={changed} onClick={() => { if (onApply(preview)) onClose() }}>Use this next week</button>
    </div>}
    {issue && <p role="alert" className="cf-error">{issue}</p>}
    <button type="button" className="cf-text-button" onClick={onClose}>Back to my week</button>
  </section>
}
