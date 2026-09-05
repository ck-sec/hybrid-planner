import { useState } from 'react'
import type { FormEvent } from 'react'
import { DAY_NAMES } from '../engine/legacy/types.ts'
import type { Baseline, Day } from '../engine/legacy/types.ts'
import { InputError, parseBaseline } from '../engine/legacy/validation.ts'
import { currentMonday, parseWeekStart } from './dates.ts'

interface ExerciseDraft {
  key: number
  name: string
  sets: string
  reps: string
  loadKg: string
}

interface Props {
  baseline: Baseline | null
  disabled: boolean
  savedDates: readonly string[]
  onGenerate: (weekStart: string, baseline: Baseline) => Promise<boolean>
}

function errorText(error: unknown): string {
  return error instanceof InputError ? error.issues.join(' ') : error instanceof Error ? error.message : 'Please check your baseline.'
}

export default function BaselineForm({ baseline, disabled, savedDates, onGenerate }: Props) {
  const [weekStart, setWeekStart] = useState(currentMonday)
  const [minutes, setMinutes] = useState(baseline ? String(baseline.weeklyRunMinutes) : '')
  const [longest, setLongest] = useState(baseline ? String(baseline.longestRunMinutes) : '')
  const [runs, setRuns] = useState(baseline?.runsPerWeek ?? 3)
  const [lifts, setLifts] = useState(baseline?.liftsPerWeek ?? 2)
  const [days, setDays] = useState<Day[]>(baseline?.availableDays ?? [0, 1, 2, 3, 4, 5, 6])
  const [exercises, setExercises] = useState<ExerciseDraft[]>(baseline
    ? baseline.exercises.map((exercise, key) => ({ key, name: exercise.name, sets: String(exercise.sets), reps: String(exercise.reps), loadKg: String(exercise.loadKg) }))
    : [{ key: 0, name: '', sets: '', reps: '', loadKg: '' }])
  const [nextKey, setNextKey] = useState(exercises.length)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const duplicate = savedDates.includes(weekStart)

  function updateExercise(key: number, field: keyof Omit<ExerciseDraft, 'key'>, value: string) {
    setExercises(items => items.map(item => item.key === key ? { ...item, [field]: value } : item))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (disabled) return
    try {
      parseWeekStart(weekStart)
      if (duplicate) throw new Error('This week already exists. Choose another Monday or view the saved week in history.')
      if (!confirmed) throw new Error('Confirm that every value reflects your recent, comfortable, established baseline.')
      const baseline = parseBaseline({
        weeklyRunMinutes: minutes.trim() ? Number(minutes) : Number.NaN,
        longestRunMinutes: longest.trim() ? Number(longest) : Number.NaN,
        runsPerWeek: runs,
        liftsPerWeek: lifts,
        availableDays: days,
        exercises: exercises.map(exercise => ({
          name: exercise.name,
          sets: exercise.sets.trim() ? Number(exercise.sets) : Number.NaN,
          reps: exercise.reps.trim() ? Number(exercise.reps) : Number.NaN,
          loadKg: exercise.loadKg.trim() ? Number(exercise.loadKg) : Number.NaN,
        })),
      })
      if (await onGenerate(weekStart, baseline)) setConfirmed(false)
    } catch (error) {
      setError(errorText(error))
    }
  }

  return (
    <section className="panel baseline-panel" id="baseline" aria-labelledby="baseline-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Your starting point</p><h2 id="baseline-heading">Keep what works.</h2></div>
        <span className="small-tag">No progression</span>
      </div>
      <p className="muted">Enter training you already do comfortably, not a target. Nothing here estimates what you should be able to handle.</p>
      <form onSubmit={event => { void submit(event) }} onChange={() => { if (confirmed) setConfirmed(false) }}>
        <fieldset disabled={disabled} className="form-fields">
          <div className="field">
            <label htmlFor="week-start">Week beginning</label>
            <input id="week-start" type="date" value={weekStart} onChange={event => setWeekStart(event.target.value)} required aria-describedby="week-start-help" />
            <p className={duplicate ? 'field-warning' : 'field-hint'} id="week-start-help">
              {duplicate ? 'Already saved. Pick another Monday; existing weeks stay unchanged.' : 'Choose a Monday. Plans are fixed once saved.'}
            </p>
          </div>

          <fieldset className="form-section">
            <legend><span className="section-number">01</span> Easy running</legend>
            <div className="field-pair">
              <div className="field">
                <label htmlFor="weekly-minutes">Weekly minutes</label>
                <input id="weekly-minutes" type="number" min="1" max="600" step="1" inputMode="numeric" placeholder="Established total" value={minutes} onChange={event => setMinutes(event.target.value)} required aria-describedby="run-budget-help" />
              </div>
              <div className="field">
                <label htmlFor="longest-run">Longest comfortable run</label>
                <div className="input-unit"><input id="longest-run" type="number" min="1" max="180" step="1" inputMode="numeric" placeholder="Minutes" value={longest} onChange={event => setLongest(event.target.value)} required aria-describedby="run-budget-help" /><span>min</span></div>
              </div>
            </div>
            <div className="field">
              <label htmlFor="run-count">Runs per week</label>
              <select id="run-count" value={runs} onChange={event => setRuns(Number(event.target.value))}>
                {[1, 2, 3, 4].map(count => <option key={count} value={count}>{count} {count === 1 ? 'run' : 'runs'}</option>)}
              </select>
            </div>
            <p className="field-hint" id="run-budget-help">Your weekly minutes are split evenly into easy runs. Each must fit your longest comfortable run. If a run cannot fit the calendar, its minutes are left out—not added elsewhere.</p>
          </fieldset>

          <fieldset className="form-section">
            <legend><span className="section-number">02</span> Full-body lifting</legend>
            <div className="field">
              <label htmlFor="lift-count">Lifting sessions per week</label>
              <select id="lift-count" value={lifts} onChange={event => setLifts(Number(event.target.value))}>
                {[1, 2, 3].map(count => <option key={count} value={count}>{count} {count === 1 ? 'session' : 'sessions'}</option>)}
              </select>
            </div>
            <p className="field-hint" id="template-help">Add your existing full-body template (1–8 exercises). Every lift repeats these exact sets, reps and loads. Use 0 kg for bodyweight. This is not an exercise recommendation.</p>
            <div className="exercise-editor" aria-describedby="template-help">
              {exercises.map((exercise, index) => (
                <fieldset className="exercise-row" key={exercise.key}>
                  <legend>Exercise {index + 1}</legend>
                  <div className="exercise-name-row">
                    <div className="field">
                      <label htmlFor={`exercise-${exercise.key}-name`}>Exercise name</label>
                      <input id={`exercise-${exercise.key}-name`} type="text" maxLength={80} placeholder="Your established exercise" value={exercise.name} onChange={event => updateExercise(exercise.key, 'name', event.target.value)} required />
                    </div>
                    <button type="button" className="icon-button" disabled={exercises.length <= 1} aria-label={`Remove exercise ${index + 1}`} onClick={() => {
                      setExercises(items => items.filter(item => item.key !== exercise.key))
                      setConfirmed(false)
                    }}>×</button>
                  </div>
                  <div className="exercise-numbers">
                    <div className="field"><label htmlFor={`exercise-${exercise.key}-sets`}>Sets</label><input id={`exercise-${exercise.key}-sets`} type="number" min="1" max="10" step="1" inputMode="numeric" placeholder="Sets" value={exercise.sets} onChange={event => updateExercise(exercise.key, 'sets', event.target.value)} required /></div>
                    <div className="field"><label htmlFor={`exercise-${exercise.key}-reps`}>Reps</label><input id={`exercise-${exercise.key}-reps`} type="number" min="1" max="50" step="1" inputMode="numeric" placeholder="Reps" value={exercise.reps} onChange={event => updateExercise(exercise.key, 'reps', event.target.value)} required /></div>
                    <div className="field"><label htmlFor={`exercise-${exercise.key}-load`}>Load · kg</label><input id={`exercise-${exercise.key}-load`} type="number" min="0" max="500" step="any" inputMode="decimal" placeholder="Your load" value={exercise.loadKg} onChange={event => updateExercise(exercise.key, 'loadKg', event.target.value)} required /></div>
                  </div>
                </fieldset>
              ))}
            </div>
            <button type="button" className="button button-secondary button-small" disabled={exercises.length >= 8} onClick={() => {
              setExercises(items => [...items, { key: nextKey, name: '', sets: '', reps: '', loadKg: '' }])
              setNextKey(value => value + 1)
              setConfirmed(false)
            }}>+ Add exercise</button>
          </fieldset>

          <fieldset className="form-section">
            <legend><span className="section-number">03</span> Make room in your week</legend>
            <p className="field-hint" id="availability-help">Choose the days you are available. The planner keeps at least one day free and never stacks sessions.</p>
            <div className="day-picker" aria-describedby="availability-help">
              {DAY_NAMES.map((day, index) => (
                <label key={day} className={days.includes(index as Day) ? 'day-option selected' : 'day-option'}>
                  <input type="checkbox" checked={days.includes(index as Day)} onChange={event => {
                    const dayIndex = index as Day
                    setDays(values => event.target.checked ? [...values, dayIndex].sort((a, b) => a - b) : values.filter(value => value !== dayIndex))
                  }} aria-label={day} />
                  <span>{day.slice(0, 3)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="confirmation">
            <input type="checkbox" checked={confirmed} onChange={event => {
              event.stopPropagation()
              setConfirmed(event.target.checked)
            }} required />
            <span>I confirm these minutes, frequencies and this full-body template reflect my recent, comfortable, established training—not a new goal.</span>
          </label>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <button className="button button-primary generate-button" type="submit" disabled={disabled || duplicate}>Generate & save week <span aria-hidden="true">↗</span></button>
          <p className="field-hint center-text">Saved only after browser storage confirms the write.</p>
        </fieldset>
      </form>
    </section>
  )
}
