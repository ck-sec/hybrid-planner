import { exerciseMetadata } from '../../engine/program.ts'
import { MAX_LOGGED_SETS_PER_BLOCK } from '../../engine/constants.ts'
import { workoutLogOverruns } from '../../engine/observations.ts'
import type { WorkoutSession } from '../../engine/types.ts'
import { campaignDraftForWeek, logCampaignBlockAmount, logCampaignBlockSet } from './model.ts'
import type { CampaignState, SetDraft } from './types.ts'
import { resourcesForEquipment } from './equipment.ts'
import { exerciseGuidance } from './exercise-guidance.ts'
import ExerciseGuide from './ExerciseGuide.tsx'
import WorkoutCards from './WorkoutCards.tsx'
import { parseWorkoutCards } from './workout-cards.ts'
import Icon from './Icons.tsx'
import './template-workout.css'

export default function TemplateWorkout({ state, session, readOnly, update }: {
  state: CampaignState
  session: WorkoutSession
  readOnly: boolean
  update: (change: (previous: CampaignState) => CampaignState) => boolean
}) {
  const week = state.weeks[state.selectedWeek]
  const log = week.logs[session.id]
  const overruns = log ? workoutLogOverruns(session, log) : []
  const draft = campaignDraftForWeek(state)
  const resources = draft.resources ?? resourcesForEquipment(draft.equipment)
  return <div className="cf-lift-list">{session.blocks.map((block, blockIndex) => {
    const exerciseId = block.unit === 'throws' ? block.drillId : block.exerciseId
    const exercise = block.unit === 'throws' ? undefined : week.input.library.exercises.find(item => item.id === block.exerciseId)
    if (block.unit !== 'throws' && !exercise) throw new Error('This workout block is missing its saved exercise identity.')
    const metadata = exercise ? exerciseMetadata(exercise.id) : undefined
    const name = exercise?.name ?? 'Controlled target throws'
    const saved = log?.blockLogs?.find(item => item.blockIndex === blockIndex)
    const overrun = overruns.find(item => item.blockIndex === blockIndex)
    const actualSets = saved?.unit === 'reps' ? saved.sets : []
    const filledRows = Math.max(block.unit === 'reps' ? block.sets : 0, actualSets.length)
    const extraKey = `${session.id}:block-${blockIndex}:${filledRows}`
    const extraDraft = block.unit === 'reps' && state.setDrafts[extraKey] !== undefined
    const carry = exercise?.template === 'carry'
    const amountKey = `${session.id}:block-${blockIndex}:total`
    const amountDraft = state.setDrafts[amountKey] ?? {
      weight: saved?.unit === 'seconds' && saved.weightKg !== undefined ? String(saved.weightKg) : '',
      reps: saved?.unit === 'seconds' ? String(saved.seconds) : saved?.unit === 'throws' ? String(saved.throws) : '',
      effort: '',
    }
    const changeAmount = (change: Partial<SetDraft>) => update(previous => ({ ...previous, setDrafts: { ...previous.setDrafts, [amountKey]: { ...amountDraft, ...change } } }))
    return <section className="cf-lift cf-template-block" key={`${exerciseId}-${blockIndex}`}>
      <div className="cf-lift-heading"><span className="cf-exercise-number">{String(blockIndex + 1).padStart(2, '0')}</span><div><h2>{name}</h2>
        <p>{block.unit === 'reps' ? `${block.sets} sets x ${block.reps} reps · RPE ${block.targetRPE}`
          : block.unit === 'seconds' ? `${block.sets} bouts x ${block.seconds} seconds`
            : `Up to ${block.throws} controlled throws within practice`}</p>
      </div><span className="cf-tag">{block.unit === 'throws' ? 'Within practice' : block.unit === 'seconds' ? carry ? 'Carry' : 'Timed' : block.role}</span></div>
      {metadata && <p className="cf-template-execution">{metadata.execution.label}{metadata.execution.eccentricSeconds !== undefined && ` · Lower for ${metadata.execution.eccentricSeconds} seconds`}</p>}
      {exercise && metadata && <ExerciseGuide name={name} guide={exerciseGuidance(exercise, { execution: metadata.execution.label, goal: week.input.block.goal.label, slot: block.unit === 'throws' ? 'practice' : block.role })} />}
      {overrun && <p role="status" className="cf-card cf-small">{overrun.message} Your actual record is kept. This does not raise prescriptions or count as successful calibration.</p>}
      {block.unit === 'throws' && <div className="cf-card cf-stack"><h3>Description</h3><p>Use an established clear court lane and designated safe target. Make deliberate, submaximal throws and reset between attempts.</p><h3>What to focus on</h3><p>Finish balanced; stop when technique deteriorates or pain appears. This is not maximal throwing or extra conditioning.</p><h3>Why this block</h3><p>It makes controlled technique visible inside existing practice. The count is an exposure ceiling based on your own routine, not medical clearance or a validated injury threshold.</p></div>}
      {block.unit === 'reps' ? <>
        <p className="cf-small">{block.suggestedWeightKg === undefined ? 'No starting weight invented. This execution variant has its own weight history.' : `${block.suggestedWeightKg} kg suggested from a compatible record for this exact variant; it is not a logged set.`}</p>
        <div className="cf-set-labels"><span>SET</span><span>KG</span><span>REPS</span><span>RPE</span><span>LOG</span></div>
        {Array.from({ length: filledRows + Number(extraDraft) }, (_, setIndex) => {
          const actual = saved?.unit === 'reps' ? saved.sets[setIndex] : undefined
          const key = `${session.id}:block-${blockIndex}:${setIndex}`
          const values = state.setDrafts[key] ?? { weight: actual ? String(actual.weightKg) : '', reps: actual ? String(actual.reps) : '', effort: actual ? String(actual.actualRPE) : '' }
          const change = (part: Partial<SetDraft>) => update(previous => ({ ...previous, setDrafts: { ...previous.setDrafts, [key]: { ...values, ...part } } }))
          return <form className={`cf-set-row ${actual ? 'cf-set-saved' : ''}`} key={setIndex} onSubmit={event => { event.preventDefault(); update(previous => logCampaignBlockSet(previous, session.id, blockIndex, setIndex, values)) }}>
            <span title={setIndex >= block.sets ? 'Extra set already performed, not prescribed' : undefined}>{setIndex + 1}{setIndex >= block.sets && '*'}</span>
            <input aria-label={`${name} set ${setIndex + 1} kilograms`} type="number" inputMode="decimal" min="0" max="500" step="any" required disabled={readOnly} value={values.weight} placeholder={block.suggestedWeightKg === undefined ? '-' : String(block.suggestedWeightKg)} onChange={event => change({ weight: event.target.value })} />
            <input aria-label={`${name} set ${setIndex + 1} reps`} type="number" inputMode="numeric" min="1" max="50" step="1" required disabled={readOnly} value={values.reps} placeholder={String(block.reps)} onChange={event => change({ reps: event.target.value })} />
            <input aria-label={`${name} set ${setIndex + 1} RPE`} type="number" inputMode="decimal" min="6" max="10" step=".5" required disabled={readOnly} value={values.effort} placeholder={String(block.targetRPE)} onChange={event => change({ effort: event.target.value })} />
            <button type="submit" disabled={readOnly} aria-label={`Log ${name} set ${setIndex + 1}`}><Icon name={actual ? 'check' : 'plus'} size={18} /></button>
          </form>
        })}
        {!readOnly && actualSets.length >= block.sets && actualSets.length < MAX_LOGGED_SETS_PER_BLOCK && !extraDraft && <div className="cf-stack">
          <p className="cf-small">Already performed more than the plan? Record it honestly; this does not prescribe extra training. * marks an extra actual set.</p>
          <button type="button" className="cf-button cf-secondary" onClick={() => update(previous => ({
            ...previous, setDrafts: { ...previous.setDrafts, [extraKey]: { weight: '', reps: '', effort: '' } },
          }))}>Record an extra set already performed</button>
        </div>}
      </> : <form className="cf-template-amount" onSubmit={event => {
        event.preventDefault()
        update(previous => logCampaignBlockAmount(previous, session.id, blockIndex, amountDraft.reps, carry && amountDraft.weight.trim() ? amountDraft.weight : undefined))
      }}>
        {carry && <label className="cf-field">Actual total carried weight (kg, optional)<input type="number" inputMode="decimal" min="0" max="500" step="any" disabled={readOnly} value={amountDraft.weight} onChange={event => changeAmount({ weight: event.target.value })} /></label>}
        <label className="cf-field">{block.unit === 'seconds' ? 'Actual total seconds across all bouts' : 'Actual total throws in this practice'}<input type="number" inputMode="numeric" min="0" step="1" required disabled={readOnly} value={amountDraft.reps} onChange={event => changeAmount({ reps: event.target.value })} /></label>
        <p className="cf-small">{block.unit === 'seconds' ? 'Record only what you did. Seconds are not repetitions; no RIR rating is required.' : 'Include warm-up, drill and game throws. The planned count is not extra permission to throw.'}</p>
        <button type="submit" className="cf-button cf-secondary" disabled={readOnly}>{saved ? 'Update recorded total' : 'Log actual total'}</button>
      </form>}
      <details className="cf-details"><summary>Personal description, focus &amp; why</summary><WorkoutCards cards={state.cards ?? []} exerciseId={exerciseId} resources={resources} program={draft.program} readOnly={state.selectedWeek < state.weeks.length - 1} onChange={cards => { update(previous => ({ ...previous, cards: parseWorkoutCards(cards) })) }} /></details>
    </section>
  })}</div>
}
