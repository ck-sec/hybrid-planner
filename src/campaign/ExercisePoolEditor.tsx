import { useId, useState } from 'react'
import type { CustomExerciseSpec, Exercise, ProgramConfigV1 } from '../../engine/types.ts'
import { PROGRAM_POLICY } from '../../engine/constants.ts'
import type { ResourceId } from './equipment.ts'
import type { WorkoutCard } from './workout-cards.ts'
import { exerciseGuidance } from './exercise-guidance.ts'
import ExerciseGuide from './ExerciseGuide.tsx'
import WorkoutCards from './WorkoutCards.tsx'
import CustomExerciseEditor from './CustomExerciseEditor.tsx'
import './exercise-pool.css'

export interface ExerciseChoice {
  exercise: Exercise
  family: string
  execution: string
  prescription: string
}

export default function ExercisePoolEditor({ choices, selected, maxExercises, goal, resources, cards, program, onChange, onCards, onCreateCustom }: {
  choices: readonly ExerciseChoice[]
  selected: readonly string[]
  maxExercises: number
  goal: string
  resources: readonly ResourceId[]
  cards: readonly WorkoutCard[]
  program?: ProgramConfigV1
  onChange: (ids: string[]) => void
  onCards: (cards: WorkoutCard[]) => void
  onCreateCustom?: (exercise: CustomExerciseSpec) => boolean
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [swapping, setSwapping] = useState<string | null>(null)
  const available = choices.filter(choice => !selected.includes(choice.exercise.id)
    && `${choice.exercise.name} ${choice.exercise.pattern} ${choice.exercise.equipment.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))

  return <section className="cf-pool" aria-labelledby={`${id}-title`}>
    <div><h3 id={`${id}-title`}>Your exercise pool</h3><p className="cf-small">The engine arranges these across complementary sessions, not one repeated list. Every quantity below is a ceiling, not additional work.</p></div>
    <div className="cf-pool-list">{selected.map(exerciseId => {
      const choice = choices.find(item => item.exercise.id === exerciseId)
      if (!choice) return <article key={exerciseId} className="cf-card"><p role="alert">Unavailable exercise: {exerciseId}. Review equipment or remove it before planning.</p><button type="button" className="cf-text-button" onClick={() => onChange(selected.filter(item => item !== exerciseId))}>Remove unavailable exercise</button></article>
      const { exercise } = choice
      const variants = choices.filter(item => item.family === choice.family && (!selected.includes(item.exercise.id) || item.exercise.id === exerciseId))
      const alternatives = choices.filter(item => item.exercise.pattern === exercise.pattern && !selected.includes(item.exercise.id))
      return <article key={exerciseId} className="cf-pool-card">
        <div className="cf-pool-heading"><div><p className="cf-kicker">{exercise.pattern.replaceAll('_', ' ')}</p><h3>{exercise.name}</h3></div><span className="cf-tag">{exercise.id.startsWith('custom-') ? 'Custom exercise' : 'Built-in exercise'}</span></div>
        <p className="cf-pool-dose">{choice.prescription}</p>
        {variants.length > 1 ? <label className="cf-field">Execution style<select value={exerciseId} onChange={event => {
          onChange(selected.map(item => item === exerciseId ? event.target.value : item))
          setEditing(null)
          setSwapping(null)
        }}>{variants.map(item => <option key={item.exercise.id} value={item.exercise.id}>{item.execution}</option>)}</select><span className="cf-small">Changing style selects a separate exercise variant. Loads are never copied from another variant.</span></label> : <p className="cf-small">Execution: {choice.execution}</p>}
        <ExerciseGuide name={exercise.name} guide={exerciseGuidance(exercise, { execution: choice.execution, goal, customExercise: program?.customExercises?.find(item => item.id === exerciseId) })} />
        <div className="cf-inline">
          <button type="button" className="cf-text-button" aria-expanded={editing === exerciseId} onClick={() => setEditing(editing === exerciseId ? null : exerciseId)}>Edit description &amp; notes</button>
          {alternatives.length > 0 && <button type="button" className="cf-text-button" aria-expanded={swapping === exerciseId} onClick={() => setSwapping(swapping === exerciseId ? null : exerciseId)}>Swap movement</button>}
          <button type="button" className="cf-text-button" disabled={selected.length <= PROGRAM_POLICY.minSelectedExercises} aria-label={`Remove ${exercise.name}`} onClick={() => onChange(selected.filter(item => item !== exerciseId))}>Remove</button>
        </div>
        {swapping === exerciseId && <div className="cf-pool-alternatives">{alternatives.map(item => <button type="button" key={item.exercise.id} onClick={() => {
          onChange(selected.map(id => id === exerciseId ? item.exercise.id : id))
          setSwapping(null)
          setEditing(null)
        }}>{item.exercise.name}</button>)}</div>}
        {editing === exerciseId && <WorkoutCards cards={cards} resources={resources} exerciseId={exerciseId} program={program} onChange={onCards} />}
      </article>
    })}</div>
    <details className="cf-details"><summary>Add an equipped movement</summary>
      <label className="cf-field">Find an exercise<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Kettlebell, carry, squat..." /></label>
      <div className="cf-pool-alternatives">{available.map(({ exercise, execution }) => <button type="button" key={exercise.id} disabled={selected.length >= maxExercises} onClick={() => onChange([...selected, exercise.id])}><strong>{exercise.name}</strong><span>{execution}</span></button>)}</div>
      {!available.length && <p role="status" className="cf-small">No additional equipped movements match this search.</p>}
      <p className="cf-small">{selected.length} of {maxExercises} movements selected. More selections do not increase the session workload limit.</p>
    </details>
    {program && onCreateCustom && <CustomExerciseEditor resources={resources} existing={program.customExercises ?? []} onCreate={onCreateCustom} />}
  </section>
}
