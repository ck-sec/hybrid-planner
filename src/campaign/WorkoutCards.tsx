import { useId, useState } from 'react'
import { RESOURCE_CATALOG, exerciseAvailable, resourceLabels } from './equipment.ts'
import type { ResourceId } from './equipment.ts'
import {
  MAX_WORKOUT_CARDS, WORKOUT_CARD_EXERCISES, WORKOUT_CARD_LIMITS, moveWorkoutCard, parseWorkoutCards, saveWorkoutCard,
} from './workout-cards.ts'
import type { WorkoutCard } from './workout-cards.ts'
import './workout-cards.css'

export interface WorkoutCardsProps {
  cards: readonly WorkoutCard[]
  resources: readonly ResourceId[]
  onChange: (cards: WorkoutCard[]) => void
  exerciseId?: string
  readOnly?: boolean
}

const allResources = RESOURCE_CATALOG.map(resource => resource.id)

function missingResources(card: WorkoutCard, resources: readonly ResourceId[]): ResourceId[] {
  const required = [...card.resources]
  if (card.exerciseId !== null) {
    for (const resource of allResources) {
      if (!exerciseAvailable(card.exerciseId, allResources.filter(id => id !== resource))) required.push(resource)
    }
  }
  return [...new Set(required)].filter(resource => !resources.includes(resource))
}

function sourceLabel(card: WorkoutCard): string {
  return `${card.source === 'ai' ? 'AI' : 'User'} · ${card.source === 'ai' || card.status === 'draft' ? 'Draft' : 'Personal reference'}`
}

export default function WorkoutCards({ cards, resources, onChange, exerciseId, readOnly = false }: WorkoutCardsProps) {
  const notebookId = useId()
  const [editing, setEditing] = useState<{ card: WorkoutCard; isNew: boolean; original: WorkoutCard | null } | null>(null)
  const [issue, setIssue] = useState('')
  const visible = exerciseId === undefined ? cards : cards.filter(card => card.exerciseId === exerciseId)
  const compatibleExercises = WORKOUT_CARD_EXERCISES.filter(exercise => exerciseAvailable(exercise.id, resources))
  const editor = readOnly ? null : editing
  const editorMissing = editor ? missingResources(editor.card, resources) : []
  const editorUnavailable = editor !== null && (editorMissing.length > 0
    || (editor.card.exerciseId !== null && !exerciseAvailable(editor.card.exerciseId, resources)))

  function changeCards(next: WorkoutCard[]) {
    try {
      onChange(parseWorkoutCards(next))
      setIssue('')
      return true
    } catch (error) {
      setIssue(error instanceof Error ? error.message : 'The reference note could not be saved.')
      return false
    }
  }

  function addCard() {
    if (readOnly || cards.length >= MAX_WORKOUT_CARDS) return
    let number = 1
    while (cards.some(card => card.id === `note-${number}`)) number += 1
    setEditing({
      isNew: true,
      original: null,
      card: {
        id: `note-${number}`,
        exerciseId: exerciseId !== undefined && compatibleExercises.some(exercise => exercise.id === exerciseId) ? exerciseId : null,
        title: '', purpose: '', instructions: '', cues: '', resources: [], source: 'user', status: 'draft',
      },
    })
    setIssue('')
  }

  function patchCard(change: Partial<Pick<WorkoutCard, 'exerciseId' | 'title' | 'purpose' | 'instructions' | 'cues' | 'resources'>>) {
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
      if (changeCards(saveWorkoutCard(cards, next, editor.original))) setEditing(null)
    } catch (error) { setIssue(error instanceof Error ? error.message : 'The reference note could not be saved.') }
  }

  return <section className="cf-notebook" aria-labelledby={`${notebookId}-title`}>
    <div className="cf-notebook-heading">
      <div><h3 id={`${notebookId}-title`}>Reference notebook</h3><p>Local notes, outside your training plan.</p></div>
      {!readOnly && <button type="button" className="cf-notebook-button" disabled={cards.length >= MAX_WORKOUT_CARDS || editor !== null} aria-expanded={editor !== null} aria-controls={`${notebookId}-editor`} onClick={addCard}>Add note or drill</button>}
    </div>
    <p className="cf-notebook-disclaimer">Notes and drill drafts are not engine-approved instructions. They do not add work or change quantities, scheduling or exercise identity. Follow your plan, not this notebook.</p>
    {exerciseId !== undefined && <p className="cf-notebook-meta">Showing notes linked to {WORKOUT_CARD_EXERCISES.find(exercise => exercise.id === exerciseId)?.name ?? 'this exercise'}. This is a display filter only.</p>}
    {visible.length === 0 && <p className="cf-notebook-empty">No notes here yet.</p>}
    {cards.length >= MAX_WORKOUT_CARDS && !readOnly && <p className="cf-notebook-meta">Notebook limit: {MAX_WORKOUT_CARDS} notes. Delete a note before adding another.</p>}
    <div className="cf-notebook-list">{visible.map(card => {
      const exercise = WORKOUT_CARD_EXERCISES.find(exercise => exercise.id === card.exerciseId)
      const missing = missingResources(card, resources)
      const unavailable = missing.length > 0 || (card.exerciseId !== null && !exerciseAvailable(card.exerciseId, resources))
      return <article key={card.id} className={`cf-notebook-card${unavailable ? ' cf-notebook-unavailable' : ''}`} aria-labelledby={`${notebookId}-${card.id}`}>
        <p className="cf-notebook-meta">{sourceLabel(card)}</p>
        <h4 id={`${notebookId}-${card.id}`}>{card.title}</h4>
        <p className="cf-notebook-identity">{exercise ? <><span>Catalog exercise: </span><strong>{exercise.name}</strong></> : <strong>Unscheduled drill idea</strong>}</p>
        {card.resources.length > 0 && <p className="cf-notebook-meta">Note resources: {resourceLabels(card.resources).join(', ')}.</p>}
        {unavailable && <p className="cf-notebook-warning">Unavailable for use. Missing: {missing.length ? resourceLabels(missing).join(', ') : 'compatible exercise equipment'}. You can keep and edit this as a draft; it cannot add work to your plan.</p>}
        {(card.purpose || card.instructions || card.cues) && <details className="cf-notebook-text"><summary>Read note</summary><dl>
          {card.purpose && <><dt>Purpose note</dt><dd>{card.purpose}</dd></>}
          {card.instructions && <><dt>Instruction notes — not a prescription</dt><dd>{card.instructions}</dd></>}
          {card.cues && <><dt>Cue notes</dt><dd>{card.cues}</dd></>}
        </dl></details>}
        {!readOnly && <div className="cf-notebook-actions">
          <button type="button" className="cf-notebook-button" disabled={editor !== null} aria-label={`Edit ${card.title}`} onClick={() => {
            setEditing({ card: { ...card, resources: [...card.resources], status: card.source === 'ai' ? 'draft' : card.status }, isNew: false, original: parseWorkoutCards([card])[0] })
            setIssue('')
          }}>Edit</button>
          <button type="button" className="cf-notebook-button cf-notebook-delete" aria-label={`Delete ${card.title}`} onClick={() => {
            if (changeCards(cards.filter(item => item.id !== card.id)) && editing?.card.id === card.id) setEditing(null)
          }}>Delete</button>
          {exerciseId === undefined && ([-1, 1] as const).map(direction => <button key={direction} type="button" className="cf-notebook-button" disabled={editor !== null || cards.findIndex(item => item.id === card.id) + direction < 0 || cards.findIndex(item => item.id === card.id) + direction >= cards.length} aria-label={`Move ${card.title} ${direction === -1 ? 'up' : 'down'} in notebook`} onClick={() => changeCards(moveWorkoutCard(cards, card.id, direction))}>{direction === -1 ? 'Up' : 'Down'}</button>)}
        </div>}
      </article>
    })}</div>
    {editor && <fieldset id={`${notebookId}-editor`} className="cf-notebook-editor" onKeyDown={event => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'checkbox') event.preventDefault()
    }}>
      <legend>{editor.isNew ? 'New reference note' : 'Edit reference note'}</legend>
      <p className="cf-notebook-meta">{sourceLabel(editor.card)}. Editing does not certify this text or change its source. Drafts stay drafts.</p>
      <label>Custom title<input type="text" value={editor.card.title} maxLength={WORKOUT_CARD_LIMITS.title} placeholder={editor.card.exerciseId === null ? 'For example: Target-lane throwing' : 'Your note title'} onChange={event => patchCard({ title: event.target.value })} /></label>
      <label>Exercise link<select value={editor.card.exerciseId ?? ''} onChange={event => patchCard({ exerciseId: event.target.value || null })}>
        <option value="">Unscheduled drill idea</option>
        {editor.card.exerciseId !== null && !compatibleExercises.some(exercise => exercise.id === editor.card.exerciseId) && <option value={editor.card.exerciseId} disabled>{WORKOUT_CARD_EXERCISES.find(exercise => exercise.id === editor.card.exerciseId)?.name ?? 'Catalog exercise'} — equipment unavailable (draft only)</option>}
        {compatibleExercises.map(exercise => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}
      </select></label>
      <p className="cf-notebook-meta">A title never changes the linked exercise. New sport drills must stay “Unscheduled drill idea”; linking a different exercise does not make them supported.</p>
      {(['purpose', 'instructions', 'cues'] as const).map(field => <label key={field}>
        {field === 'instructions' ? 'Instruction notes (not a training prescription)' : field === 'purpose' ? 'Purpose note' : 'Cue notes'}
        <textarea rows={field === 'instructions' ? 3 : 2} maxLength={WORKOUT_CARD_LIMITS[field]} value={editor.card[field]} onChange={event => patchCard({ [field]: event.target.value })} />
      </label>)}
      <p className="cf-notebook-meta">Plain text and paragraphs; no HTML. These fields are notes, not a way to prescribe sets, reps, load or duration.</p>
      <fieldset className="cf-notebook-resources"><legend>Resources needed for this note</legend><div>{RESOURCE_CATALOG.map(resource => <label key={resource.id}>
        <input type="checkbox" checked={editor.card.resources.includes(resource.id)} onChange={event => patchCard({
          resources: event.target.checked ? [...editor.card.resources, resource.id] : editor.card.resources.filter(id => id !== resource.id),
        })} />
        <span>{resource.label}{!resources.includes(resource.id) && <small>Not available — draft only</small>}</span>
      </label>)}</div></fieldset>
      {editorUnavailable && <p className="cf-notebook-warning">Missing: {editorMissing.length ? resourceLabels(editorMissing).join(', ') : 'compatible exercise equipment'}. Save as a draft only; unavailable notes cannot be used in your plan.</p>}
      <div className="cf-notebook-actions">
        <button type="button" className="cf-notebook-button" onClick={saveCard}>{editor.card.source === 'user' && editor.card.status === 'reference' && !editorUnavailable ? 'Save note' : 'Save draft'}</button>
        <button type="button" className="cf-notebook-button" onClick={() => { setEditing(null); setIssue('') }}>Cancel</button>
      </div>
    </fieldset>}
    {issue && <p role="alert" className="cf-notebook-warning">{issue}</p>}
  </section>
}
