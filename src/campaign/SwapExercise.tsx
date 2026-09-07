import { useId, useState } from 'react'
import type { CampaignState } from './types.ts'
import { stable } from './model.ts'
import { swapChoices, swapWorkoutExercise, SWAP_REASONS } from './exercise-swaps.ts'
import type { SwapReason } from './exercise-swaps.ts'

interface Preview {
  source: CampaignState
  sourceKey: string
  candidate: CampaignState
}

const messageFor = (error: unknown) => error instanceof Error ? error.message : 'The swap could not be checked. Your saved workout is unchanged.'

function swapSourceKey(state: CampaignState, sessionId: string, blockIndex: number): string {
  const week = state.weeks[state.selectedWeek]
  return stable({
    selectedWeek: state.selectedWeek, weekStart: week?.plan.weekStart, sessionId, blockIndex,
    session: week?.plan.sessions.find(item => item.id === sessionId),
    log: week?.logs[sessionId], library: week?.input.library,
  })
}

export default function SwapExercise({ state, sessionId, blockIndex, update, onClose, onReportPain }: {
  state: CampaignState
  sessionId: string
  blockIndex: number
  update: (change: (previous: CampaignState) => CampaignState) => boolean
  onClose: () => void
  onReportPain: () => void
}) {
  const headingId = useId()
  const [replacementId, setReplacementId] = useState('')
  const [reason, setReason] = useState<SwapReason | ''>('')
  const [preferInFuture, setPreferInFuture] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [issue, setIssue] = useState('')
  let choices: ReturnType<typeof swapChoices> = []
  let choicesIssue = ''
  try { choices = swapChoices(state, sessionId, blockIndex) } catch (error) { choicesIssue = messageFor(error) }
  const week = state.weeks[state.selectedWeek]
  const session = week?.plan.sessions.find(item => item.id === sessionId)
  const block = session?.kind === 'workout' ? session.blocks[blockIndex] : undefined
  const name = block && block.unit !== 'throws' ? week.input.library.exercises.find(item => item.id === block.exerciseId)?.name : undefined
  const stale = preview !== null && preview.sourceKey !== swapSourceKey(state, sessionId, blockIndex)
  const resetPreview = () => { setPreview(null); setIssue('') }
  return <section className="cf-card cf-stack" aria-labelledby={headingId}>
    <h2 id={headingId}>Swap {name ?? 'remaining work'}</h2>
    <p>Swap only the remaining work. Preview before applying.</p>
    {choicesIssue ? <p className="cf-error" role="alert">{choicesIssue}</p> : choices.length === 0
      ? <p role="status">No compatible alternatives with your saved equipment. Keep this exercise or finish early.</p>
      : <>
        <label className="cf-field">Replacement exercise<select value={replacementId} onChange={event => { setReplacementId(event.target.value); resetPreview() }}>
          <option value="">Choose an exercise</option>{choices.map(choice => <option value={choice.id} key={choice.id}>{choice.name}</option>)}
        </select></label>
        <label className="cf-field">Reason for swapping<select value={reason} onChange={event => { setReason(event.target.value as SwapReason); resetPreview() }}>
          <option value="">Choose a reason</option>{(Object.keys(SWAP_REASONS) as SwapReason[]).map(value => <option value={value} key={value}>{SWAP_REASONS[value]}</option>)}
        </select></label>
        <label className="cf-check"><input type="checkbox" checked={preferInFuture} onChange={event => { setPreferInFuture(event.target.checked); resetPreview() }} /><span>Prefer in future proposals</span></label>
        <p className="cf-small">{preferInFuture ? 'Future workouts still need approval.' : 'This workout only.'}</p>
        {block?.unit === 'seconds' && <p className="cf-small">Only unlogged timed blocks can be swapped.</p>}
        <button type="button" className="cf-button cf-secondary" disabled={!replacementId || !reason} onClick={() => {
          if (!reason || !replacementId) return
          try {
            const candidate = swapWorkoutExercise(state, sessionId, blockIndex, replacementId, reason, preferInFuture)
            setPreview({ source: state, sourceKey: swapSourceKey(state, sessionId, blockIndex), candidate }); setIssue('')
          } catch (error) { setPreview(null); setIssue(messageFor(error)) }
        }}>Preview swap</button>
      </>}
    {preview && <>
      {stale && <p className="cf-error" role="alert">The workout changed after this preview. Preview the swap again before applying.</p>}
      <SwapExercisePreview source={preview.source} candidate={preview.candidate} sessionId={sessionId} blockIndex={blockIndex} replacementId={replacementId} />
      <button type="button" className="cf-button cf-primary" disabled={stale || !reason} onClick={() => {
        if (stale || !reason) return
        let applyIssue = ''
        try {
          const applied = update(previous => {
            try {
              if (swapSourceKey(previous, sessionId, blockIndex) !== preview.sourceKey) {
                throw new Error('This workout changed after the preview. Preview the remaining work again.')
              }
              return swapWorkoutExercise(previous, sessionId, blockIndex, replacementId, reason, preferInFuture)
            } catch (error) { applyIssue = messageFor(error); throw error }
          })
          if (applied) onClose()
          else { setIssue(applyIssue || 'The swap was not applied. Check the save message and preview again.'); setPreview(null) }
        } catch (error) { setIssue(messageFor(error)); setPreview(null) }
      }}>Apply swap</button>
    </>}
    {issue && <p className="cf-error" role="alert">{issue}</p>}
    <p className="cf-small">Pain? Stop and report it. A swap cannot clear a pain or health hold.</p>
    <div className="cf-inline"><button type="button" className="cf-text-button" onClick={onReportPain}>Report pain via Finish workout</button><button type="button" className="cf-button cf-secondary" onClick={onClose}>Keep current exercise</button></div>
  </section>
}

export function SwapExercisePreview({ source, candidate, sessionId, blockIndex, replacementId }: {
  source: CampaignState
  candidate: CampaignState
  sessionId: string
  blockIndex: number
  replacementId: string
}) {
  const week = candidate.weeks[candidate.selectedWeek]
  const session = week.plan.sessions.find(item => item.id === sessionId)
  const before = source.weeks[source.selectedWeek]
  const logged = before.logs[sessionId]?.blockLogs?.find(item => item.blockIndex === blockIndex)
  const sets = logged?.unit === 'reps' ? logged.sets : []
  const replacement = session?.kind === 'workout' ? sets.length > 0 ? session.blocks.at(-1) : session.blocks[blockIndex] : undefined
  const name = week.input.library.exercises.find(item => item.id === replacementId)?.name ?? replacementId
  return <div className="cf-card cf-stack" role="status">
    <h3>Preview — not saved</h3>
    <p><strong>{name}</strong></p>
    {replacement?.unit === 'reps' && <p>{replacement.sets} remaining set{replacement.sets === 1 ? '' : 's'} × {replacement.reps} reps · target RPE {replacement.targetRPE}</p>}
    {replacement?.unit === 'seconds' && <p>{replacement.sets} remaining bouts × {replacement.seconds} seconds</p>}
    <p>{sets.length} logged set{sets.length === 1 ? '' : 's'} preserved under the original exercise.</p>
    {sets.length > 0 && <ul className="cf-small">{sets.map((set, index) => <li key={index}>
      {before.input.library.exercises.find(item => item.id === set.exerciseId)?.name ?? set.exerciseId}: {set.weightKg} kg × {set.reps} reps · recorded RPE {set.actualRPE}
    </li>)}</ul>}
    <p className="cf-small">No weight copied; no new work logged.</p>
    <details className="cf-details"><summary>Swap details</summary>{week.changes.slice(before.changes.length).map(change => <p className="cf-small" key={change.id}>{change.message}</p>)}</details>
  </div>
}
