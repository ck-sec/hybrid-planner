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
import { confirmSetupEquipment, nextCampaignWeek, normalizeRecommendedDraft, stable } from './model.ts'
import type { CampaignDraft, CampaignState } from './types.ts'
import { programmingChoices, selectProgramExercises } from './programming.ts'
import { ProgrammingChoice, PracticeBlockOptions } from './ProgrammingOptions.tsx'
import EquipmentPicker from './EquipmentPicker.tsx'
import ExercisePoolEditor from './ExercisePoolEditor.tsx'
import CoachingWorkbench from './CoachingWorkbench.tsx'
import { parseWorkoutCards } from './workout-cards.ts'
import { addDays } from '../../engine/dates.ts'
import { DayPicker } from './components.tsx'
import WeekPlanPreview from './WeekPlanPreview.tsx'
import { AI_PLANNING_OPTIONS, policyForWeek } from './authored-policy.ts'

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
  const scope = { purpose: 'suggest_exercises' as const, weekReview, nextWeekStart: addDays(state.draft.startDate, state.weeks.length * 7) }
  const updateDraft = (next: CampaignDraft) => {
    try {
      const normalized = normalizeRecommendedDraft(next)
      setWorking(previous => { const next = { ...previous, draft: normalized }; delete next.pendingWeek; return next }); setPreview(null); setIssue(''); return true
    } catch (error) { setIssue(error instanceof Error ? error.message : 'The draft revision could not be changed.'); return false }
  }
  const equipment = (resources: ResourceId[]) => {
    try {
      const next = { ...draft, resources, equipment: equipmentForResources(resources) }
      if (!draft.program) { updateDraft(next); return }
      const allowed = new Set(programmingChoices(next).map(item => item.exercise.id))
      const kept = draft.recommendedSetup!.exerciseIds.filter(id => allowed.has(id))
      const ids = kept.length >= PROGRAM_POLICY.minSelectedExercises ? kept : recommendProgram(programResources(resources), draft.program.goal, resolveProgramLibrary(draft.program, AI_PLANNING_OPTIONS)).exerciseIds
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
    <h2>Review next week</h2>
    <p className="cf-small">Your recorded work, baseline and health holds carry forward. Changes apply only to next week.</p>
    {policyForWeek(state.weeks.at(-1)!).policy === 'ai-advisory' && !working.pendingWeek && <p role="status">No new AI reply needed: preview repeats your originally approved weekly pattern, not the built-in plan. One-week skips, moves and swaps do not change that template. Review before approving; you can edit the new week locally afterward.</p>}
    {weekReview && <div className="cf-card cf-stack">
      <h3>This week's record</h3>
      <p>{weekReview.counts.completed} completed · {weekReview.counts.finishedEarly} stopped early · {weekReview.counts.partial} in progress · {weekReview.counts.skipped} skipped · {weekReview.counts.unlogged} unlogged</p>
      {(weekReview.counts.removed > 0 || weekReview.counts.omitted > 0) && <p className="cf-small">{weekReview.counts.removed} removed · {weekReview.counts.omitted} omitted by the engine</p>}
      <p className="cf-small">Finish recording this week before approving the next. Unlogged work stays unknown.</p>
      {weekReview.counts.partial > 0 && <p role="status">Finish each in-progress workout before previewing next week.</p>}
      <details className="cf-details"><summary>Review individual records</summary>{weekReview.sessions.map(session => <p key={session.id} className="cf-small">
        {session.date}: {session.label ?? session.kind} — {session.status === 'finished_early' ? 'stopped early' : session.status}{session.skipReason ? ` (${session.skipReason === 'too_tired' ? 'fatigue' : 'time'})` : ''}
        {session.actualDurationMin !== null && ` · ${session.actualDurationMin} actual minutes`}
      </p>)}</details>
    </div>}
    {changed && <p role="alert" className="cf-error">Your plan changed during this review. Close and reopen it before approving.</p>}
    {reviewSummary && <details className="cf-details"><summary>AI review notes</summary><p>{reviewSummary}</p><p className="cf-small">Unverified notes; app checks still apply.</p></details>}
    <details className="cf-details"><summary>Next week's equipment</summary><EquipmentPicker value={draft.resources ?? resourcesForEquipment(draft.equipment)} onChange={equipment} /></details>
    <details className="cf-details"><summary>Next week's availability</summary><DayPicker label="Days available next week" value={draft.availableDays} onChange={availableDays => updateDraft({ ...draft, availableDays })} /></details>
    {working.pendingWeek && <p role="status">A proposed week is ready to preview.</p>}
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
      <button type="button" className="cf-text-button" disabled={changed} onClick={() => setShowAI(true)}>Review with AI (optional)</button>
      <button type="button" className="cf-button cf-primary" disabled={changed} onClick={() => {
        try {
          const confirmedDraft = normalizeRecommendedDraft({ ...draft, confirmed: true })
          const next = nextCampaignWeek(state, stable(confirmedDraft) === stable(state.draft) ? undefined : confirmedDraft, working.pendingWeek)
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
      <h3>Week {preview.selectedWeek + 1} preview</h3>
      <p>Approving makes the previous week read-only. Its planned and recorded work stays unchanged.</p>
      <WeekPlanPreview plan={preview.weeks.at(-1)!.plan} library={preview.weeks.at(-1)!.input.library} program={preview.weeks.at(-1)!.input.athlete.program} />
      <button type="button" className="cf-button cf-primary" disabled={changed} onClick={() => { if (onApply(preview)) onClose() }}>Approve next week</button>
    </div>}
    {issue && <p role="alert" className="cf-error">{issue}</p>}
    <button type="button" className="cf-text-button" onClick={onClose}>Back to my week</button>
  </section>
}
