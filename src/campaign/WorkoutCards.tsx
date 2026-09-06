import { useId, useState } from 'react'
import { parseResources, resourceLabels } from './equipment.ts'
import type { ProgramConfigV1 } from '../../engine/types.ts'
import type { ResourceId } from './equipment.ts'
import {
  MAX_WORKOUT_CARDS, WORKOUT_CARD_EXERCISES, WORKOUT_CARD_LIMITS, moveWorkoutCard, parseWorkoutCards, saveWorkoutCard,
  workoutCardAvailable, workoutCardCatalog, workoutCardMissingResources, workoutCardResourceOptions,
} from './workout-cards.ts'
import type { WorkoutCard } from './workout-cards.ts'
import './workout-cards.css'

export interface WorkoutCardsProps {
  cards: readonly WorkoutCard[]
  resources: readonly ResourceId[]
  onChange: (cards: WorkoutCard[]) => void
  exerciseId?: string
  readOnly?: boolean
  program?: ProgramConfigV1
}

const labelsFor = (resources: readonly ResourceId[]): string => resources.map(resource => resourceLabels([resource])[0]).join(', ')

function sourceLabel(card: WorkoutCard): string {
  return `${card.source === 'ai' ? 'AI' : 'User'} · ${card.source === 'ai' || card.status === 'draft' ? 'Draft' : 'Personal reference'}`
}

export default function WorkoutCards({ cards, resources, onChange, exerciseId, readOnly = false, program }: WorkoutCardsProps) {
  const notebookId = useId()
  const [editing, setEditing] = useState<{ card: WorkoutCard; isNew: boolean; original: WorkoutCard | null } | null>(null)
  const [issue, setIssue] = useState('')
  const pickerCatalog = workoutCardCatalog(program)
  const catalog = [...pickerCatalog, ...WORKOUT_CARD_EXERCISES.filter(item =>
    !pickerCatalog.some(exercise => exercise.id === item.id)
    && (item.id === exerciseId || cards.some(card => card.exerciseId === item.id)))]
  const visible = exerciseId === undefined ? cards : cards.filter(card => card.exerciseId === exerciseId)
  const compatibleExercises = pickerCatalog.filter(exercise => workoutCardAvailable(exercise.id, resources, program))
  const editor = readOnly ? null : editing
  const editorMissing = editor ? workoutCardMissingResources(editor.card, resources, program) : []
  const resourceOptions = editor ? workoutCardResourceOptions(resources, editor.card.resources) : []
  const editorUnavailable = editor !== null && (editorMissing.length > 0
    || (editor.card.exerciseId !== null && !workoutCardAvailable(editor.card.exerciseId, resources, program)))

  function changeCards(next: WorkoutCard[]) {
    try {
      onChange(parseWorkoutCards(next, program))
      setIssue('')
      return true
    } catch (error) {
      setIssue(error instanceof Error ? error.message : 'The reference note could not be saved.')
      return false
    }
  }

  function addCard() {
    if (readOnly || cards.length >= MAX_WORKOUT_CARDS) return
    if (exerciseId !== undefined && !catalog.some(exercise => exercise.id === exerciseId)) {
      setIssue('This exercise needs an approved program definition before a note can be linked to it.')
      return
    }
    let number = 1
    while (cards.some(card => card.id === `note-${number}`)) number += 1
    setEditing({
      isNew: true,
      original: null,
      card: {
        id: `note-${number}`,
        exerciseId: exerciseId ?? null,
        title: '', purpose: '', instructions: '', cues: '', resources: [], source: 'user', status: 'draft',
      },
    })
    setIssue('')
  }

  function patchCard(change: Partial<Pick<WorkoutCard, 'exerciseId' | 'title' | 'purpose' | 'instructions' | 'cues' | 'resources'>>) {
    try {
      if (change.resources) change.resources = parseResources(change.resources)
    } catch (error) {
      setIssue(error instanceof Error ? error.message : 'Choose valid note resources.')
      return
    }
    setEditing(previous => previous ? { ...previous, card: { ...previous.card, ...change } } : null)
    setIssue('')
  }

  function saveCard() {
    if (!editor || readOnly) return
    const previous = cards.find(card => card.id === editor.card.id)
    if ((!editor.isNew && !previous) || (editor.isNew && previous)) {
      setIssue('The notebook changed while this editor was open. Cancel and reopen the note.')
      return
    }
    const source = previous?.source ?? 'user'
    const status = source === 'ai' || editorUnavailable ? 'draft' : previous?.status ?? 'draft'
    const next = { ...editor.card, source, status } satisfies WorkoutCard
    try {
      if (changeCards(saveWorkoutCard(cards, next, editor.original, program))) setEditing(null)
    } catch (error) { setIssue(error instanceof Error ? error.message : 'The reference note could not be saved.') }
  }

  return <section className="cf-notebook" aria-labelledby={`${notebookId}-title`}>
    <div className="cf-notebook-heading">
      <div><h3 id={`${notebookId}-title`}>Reference notebook</h3><p>Local notes, outside your training plan.</p></div>
      {!readOnly && <button type="button" className="cf-notebook-button" disabled={cards.length >= MAX_WORKOUT_CARDS || editor !== null} aria-expanded={editor !== null} aria-controls={`${notebookId}-editor`} onClick={addCard}>Add reference note</button>}
    </div>
    <p className="cf-notebook-disclaimer">Notes and drill drafts are not engine-approved instructions. They do not add work or change quantities, scheduling or exercise identity. Follow your plan, not this notebook.</p>
    {exerciseId !== undefined && <p className="cf-notebook-meta">Showing notes linked to {catalog.find(exercise => exercise.id === exerciseId)?.name ?? 'this exercise'}. This is a display filter only.</p>}
    {visible.length === 0 && <p className="cf-notebook-empty">No notes here yet.</p>}
    {cards.length >= MAX_WORKOUT_CARDS && !readOnly && <p className="cf-notebook-meta">Notebook limit: {MAX_WORKOUT_CARDS} notes. Delete a note before adding another.</p>}
    <div className="cf-notebook-list">{visible.map(card => {
      const exercise = catalog.find(exercise => exercise.id === card.exerciseId)
      const missing = workoutCardMissingResources(card, resources, program)
      const unavailable = missing.length > 0 || (card.exerciseId !== null && !workoutCardAvailable(card.exerciseId, resources, program))
      return <article key={card.id} className={`cf-notebook-card${unavailable ? ' cf-notebook-unavailable' : ''}`} aria-labelledby={`${notebookId}-${card.id}`}>
        <p className="cf-notebook-meta">{sourceLabel(card)}</p>
        <h4 id={`${notebookId}-${card.id}`}>{card.title}</h4>
        <p className="cf-notebook-identity">{exercise ? <><span>Catalog exercise: </span><strong>{exercise.name}</strong></> : <strong>Unscheduled drill idea</strong>}</p>
        {card.resources.length > 0 && <p className="cf-notebook-meta">Note resources: {resourceLabels(card.resources).join(', ')}.</p>}
        {unavailable && <p className="cf-notebook-warning">Unavailable for use. Missing: {missing.length ? labelsFor(missing) : 'compatible exercise equipment'}. You can keep and edit this as a draft; it cannot add work to your plan.</p>}
        {(card.purpose || card.instructions || card.cues) && <details className="cf-notebook-text"><summary>Read note</summary><dl>
          {card.instructions && <><dt>Description</dt><dd>{card.instructions}</dd></>}
          {card.cues && <><dt>What to focus on</dt><dd>{card.cues}</dd></>}
          {card.purpose && <><dt>Why this exercise</dt><dd>{card.purpose}</dd></>}
        </dl></details>}
        {!readOnly && <div className="cf-notebook-actions">
          <button type="button" className="cf-notebook-button" disabled={editor !== null} aria-label={`Edit ${card.title}`} onClick={() => {
            setEditing({ card: { ...card, resources: [...card.resources], status: card.source === 'ai' ? 'draft' : card.status }, isNew: false, original: parseWorkoutCards([card], program)[0] })
            setIssue('')
          }}>Edit</button>
          <button type="button" className="cf-notebook-button cf-notebook-delete" aria-label={`Delete ${card.title}`} onClick={() => {
            if (changeCards(cards.filter(item => item.id !== card.id)) && editing?.card.id === card.id) setEditing(null)
          }}>Delete</button>
          {exerciseId === undefined && ([-1, 1] as const).map(direction => <button key={direction} type="button" className="cf-notebook-button" disabled={editor !== null || cards.findIndex(item => item.id === card.id) + direction < 0 || cards.findIndex(item => item.id === card.id) + direction >= cards.length} aria-label={`Move ${card.title} ${direction === -1 ? 'up' : 'down'} in notebook`} onClick={() => changeCards(moveWorkoutCard(cards, card.id, direction, program))}>{direction === -1 ? 'Up' : 'Down'}</button>)}
        </div>}
      </article>
    })}</div>
    {editor && <fieldset id={`${notebookId}-editor`} className="cf-notebook-editor" onKeyDown={event => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'checkbox') event.preventDefault()
    }}>
      <legend>{editor.isNew ? 'New reference note' : 'Edit reference note'}</legend>
      <p className="cf-notebook-meta">{sourceLabel(editor.card)}. Editing does not certify this text or change its source. Drafts stay drafts.</p>
      <label>Custom title<input type="text" value={editor.card.title} maxLength={WORKOUT_CARD_LIMITS.title} placeholder="Your note title" onChange={event => patchCard({ title: event.target.value })} /></label>
      <label>Exercise link<select value={editor.card.exerciseId ?? ''} onChange={event => patchCard({ exerciseId: event.target.value || null })}>
        <option value="">Unscheduled drill idea</option>
        {editor.card.exerciseId !== null && !compatibleExercises.some(exercise => exercise.id === editor.card.exerciseId) && <option value={editor.card.exerciseId} disabled>{catalog.find(exercise => exercise.id === editor.card.exerciseId)?.name ?? 'Catalog exercise'} — saved link (draft only)</option>}
        {compatibleExercises.map(exercise => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}
      </select></label>
      <p className="cf-notebook-meta">A title never changes the linked exercise. Create custom movements in the routine editor; unlinked notebook ideas remain outside the plan.</p>
      {(['instructions', 'cues', 'purpose'] as const).map(field => <label key={field}>
        {field === 'instructions' ? 'Description - how to perform it' : field === 'purpose' ? 'Why this exercise' : 'What to focus on'}
        <textarea rows={field === 'instructions' ? 3 : 2} maxLength={WORKOUT_CARD_LIMITS[field]} value={editor.card[field]} onChange={event => patchCard({ [field]: event.target.value })} />
      </label>)}
      <p className="cf-notebook-meta">Personal notes do not change the prescription. Change execution style through a supported exercise variant, not by writing slower, faster or extra work here.</p>
      <fieldset className="cf-notebook-resources"><legend>Resources needed for this note</legend><div>{resourceOptions.map(resource => <label key={resource}>
        <input type="checkbox" checked={editor.card.resources.includes(resource)} onChange={event => patchCard({
          resources: event.target.checked ? [...editor.card.resources, resource] : editor.card.resources.filter(id => id !== resource),
        })} />
        <span>{resourceLabels([resource])[0]}{!resources.includes(resource) && <small>Not available — draft only</small>}</span>
      </label>)}</div></fieldset>
      {editorUnavailable && <p className="cf-notebook-warning">Missing: {editorMissing.length ? labelsFor(editorMissing) : 'compatible exercise equipment'}. Save as a draft only; unavailable notes cannot be used in your plan.</p>}
      <div className="cf-notebook-actions">
        <button type="button" className="cf-notebook-button" onClick={saveCard}>{editor.card.source === 'user' && editor.card.status === 'reference' && !editorUnavailable ? 'Save note' : 'Save draft'}</button>
        <button type="button" className="cf-notebook-button" onClick={() => { setEditing(null); setIssue('') }}>Cancel</button>
      </div>
    </fieldset>}
    {issue && <p role="alert" className="cf-notebook-warning">{issue}</p>}
  </section>
}
