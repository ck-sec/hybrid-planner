import { useState } from 'react'
import { CUSTOM_EXERCISE_PROFILES } from '../../engine/custom-exercises.ts'
import { parseCustomExercise } from '../../engine/validation.ts'
import type { CustomExerciseProfileId, CustomExerciseSpec, Resource } from '../../engine/types.ts'
import { nextCustomExerciseId } from './custom-exercises.ts'
import { programResources } from './equipment.ts'
import type { ResourceId } from './equipment.ts'
import { programResourceLabel } from './programming.ts'

export default function CustomExerciseEditor({ resources, existing, onCreate }: {
  resources: readonly ResourceId[]
  existing: readonly CustomExerciseSpec[]
  onCreate: (exercise: CustomExerciseSpec) => boolean
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [focus, setFocus] = useState('')
  const [why, setWhy] = useState('')
  const [profileId, setProfileId] = useState<CustomExerciseProfileId>('controlled_squat')
  const [requirements, setRequirements] = useState<readonly Resource[]>(['bodyweight'])
  const [reviewed, setReviewed] = useState(false)
  const [issue, setIssue] = useState('')
  const available = programResources(resources)
  const changed = () => { setReviewed(false); setIssue('') }
  if (!open) return <div className="cf-stack">
    <button type="button" className="cf-button cf-secondary" onClick={() => setOpen(true)}>Create an exercise</button>
    {existing.length > 0 && <details className="cf-details"><summary>Revise a custom exercise</summary>
      <p className="cf-small">Changes create a new exercise identity. Earlier sessions and weight records stay attached to the original.</p>
      {existing.map(exercise => <button type="button" className="cf-text-button" key={exercise.id} onClick={() => {
        setName(`${exercise.name.slice(0, 70)} (revised)`); setDescription(exercise.description); setFocus(exercise.focus); setWhy(exercise.why)
        setProfileId(exercise.profileId); setRequirements(exercise.requirements)
        setReviewed(false)
        setIssue(exercise.requirements.some(resource => !available.includes(resource)) ? 'This exercise needs equipment no longer selected. Correct your equipment, or remove a requirement only if the revised movement genuinely does not need it.' : '')
        setOpen(true)
      }}>Revise {exercise.name}</button>)}
    </details>}
  </div>
  return <fieldset className="cf-card cf-stack">
    <legend>Create an exercise</legend>
    <p className="cf-small">Add a controlled movement you understand. It gets its own identity and log; the app, not this description, sets the workload.</p>
    <label className="cf-field">Exercise name<input value={name} maxLength={80} onChange={event => { setName(event.target.value); changed() }} /></label>
    <label className="cf-field">Movement category<select value={profileId} onChange={event => {
      const profile = Object.values(CUSTOM_EXERCISE_PROFILES).find(item => item.id === event.target.value)
      if (profile) { setProfileId(profile.id); changed() }
      else setIssue('Choose one of the supported movement categories.')
    }}>
      {Object.values(CUSTOM_EXERCISE_PROFILES).map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
    </select></label>
    <label className="cf-field">Description<textarea rows={3} value={description} maxLength={600} onChange={event => { setDescription(event.target.value); changed() }} /></label>
    <label className="cf-field">What to focus on<textarea rows={2} value={focus} maxLength={600} onChange={event => { setFocus(event.target.value); changed() }} /></label>
    <label className="cf-field">Why this exercise<textarea rows={2} value={why} maxLength={600} onChange={event => { setWhy(event.target.value); changed() }} /></label>
    <fieldset className="cf-stack"><legend>Equipment it needs</legend>{[...available, ...requirements.filter(resource => !available.includes(resource))].map(resource => <label className="cf-check" key={resource}>
      <input type="checkbox" checked={requirements.includes(resource)} onChange={event => {
        setRequirements(event.target.checked ? [...requirements, resource] : requirements.filter(item => item !== resource)); changed()
      }} /><span>{programResourceLabel(resource)}{!available.includes(resource) && ' (not available)'}</span>
    </label>)}</fieldset>
    <label className="cf-check"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />
      <span>I have reviewed this controlled movement and its category. This is not ballistic, rehabilitation or unfamiliar high-skill work; the app does not assess my technique.</span>
    </label>
    {issue && <p role="alert" className="cf-error">{issue}</p>}
    <div className="cf-inline">
      <button type="button" className="cf-button cf-primary" disabled={!reviewed} onClick={() => {
        try {
          const exercise = parseCustomExercise({
            version: 1, id: nextCustomExerciseId(name, existing), name: name.trim(), profileId, requirements,
            description: description.trim().replace(/\s+/g, ' '),
            focus: focus.trim().replace(/\s+/g, ' '), why: why.trim().replace(/\s+/g, ' '),
          }, available)
          if (onCreate(exercise)) {
            setOpen(false); setName(''); setDescription(''); setFocus(''); setWhy(''); setReviewed(false); setIssue('')
          } else setIssue('The exercise was not saved. Resolve the displayed issue before continuing.')
        } catch (error) { setIssue(error instanceof Error ? error.message : 'Review the exercise details before saving.') }
      }}>Save exercise</button>
      <button type="button" className="cf-text-button" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  </fieldset>
}
