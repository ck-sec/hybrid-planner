import { useState } from 'react'
import type { FormEvent } from 'react'
import { DAY_NAMES } from '../engine/constants.ts'
import { DEFAULT_LIBRARY } from '../engine/library.ts'
import type { AthleteState, Day, Discipline, Equipment, Goal, Modality, Quality } from '../engine/types.ts'
import { parseAthlete, parseGoal } from '../engine/validation.ts'
import { currentMonday } from './dates.ts'
import { numberFrom } from './form-values.ts'

const EQUIPMENT: Equipment[] = ['barbell', 'dumbbell', 'kettlebell', 'machine', 'cable', 'bodyweight', 'bands', 'none']
const QUALITIES: Quality[] = ['aerobic_base', 'threshold', 'vo2max', 'repeat_sprint', 'change_of_direction', 'max_strength', 'power', 'strength_endurance', 'shoulder_durability']
const DISCIPLINES: Discipline[] = ['run', 'bike', 'swim', 'strength', 'sport', 'mobility']
const MODALITIES: Modality[] = ['run_road', 'run_trail', 'bike_road', 'bike_gravel', 'swim', 'row', 'ski_erg', 'lifting', 'court_sport', 'other']
const labelFor = (value: string) => value.replaceAll('_', ' ')

export function NumericField({ name, label, value, min = 0, max, step = 1, required = true }: {
  name: string; label: string; value?: number; min?: number; max?: number; step?: number | 'any'; required?: boolean
}) {
  return <label className="model-field">{label}<input name={name} type="number" min={min} max={max} step={step} defaultValue={value ?? ''} required={required} inputMode="decimal" /></label>
}

export default function BlockSetup({ athlete, disabled, onSave }: {
  athlete: AthleteState | null
  disabled: boolean
  onSave: (athlete: AthleteState, goal: Goal, startDate: string, confirmed: boolean) => Promise<boolean>
}) {
  const [equipment, setEquipment] = useState<Equipment[]>([...(athlete?.equipment ?? [])])
  const [days, setDays] = useState<Day[]>([...(athlete?.availableDays ?? [])])
  const [selected, setSelected] = useState<string[]>(athlete?.baseline.exercises.map(item => item.exerciseId) ?? [])
  const [commitments, setCommitments] = useState<number[]>([])
  const [error, setError] = useState('')
  const [start, setStart] = useState(currentMonday())
  const options = DEFAULT_LIBRARY.exercises.filter(exercise => !exercise.highSkill &&
    exercise.equipment.every(item => equipment.includes(item) || item === 'none'))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      if (selected.length < 1 || selected.length > 8) throw new Error('Select one to eight exercises you already perform comfortably.')
      if (selected.some(id => !options.some(item => item.id === id))) throw new Error('Every selected exercise must match your available equipment. Remove incompatible selections.')
      const parsed = parseAthlete({
        baseline: {
          asOf: form.get('asOf'),
          weeklyRunMinutes: numberFrom(form, 'weeklyRunMinutes'),
          longestRunMinutes: numberFrom(form, 'longestRunMinutes'),
          runsPerWeek: numberFrom(form, 'runsPerWeek'),
          liftsPerWeek: numberFrom(form, 'liftsPerWeek'),
          liftDurationMin: numberFrom(form, 'liftDurationMin'),
          exercises: selected.map(id => ({
            exerciseId: id,
            date: form.get(`${id}_date`),
            weightKg: numberFrom(form, `${id}_weightKg`),
            sets: numberFrom(form, `${id}_sets`),
            reps: numberFrom(form, `${id}_reps`),
            actualRPE: numberFrom(form, `${id}_actualRPE`),
            experienceMonths: numberFrom(form, `${id}_experienceMonths`),
          })),
        },
        calibration: { version: 1, costMultiplier: 1, observationCount: 0 },
        availableDays: days,
        equipment,
        weeklyTimeBudgetMin: numberFrom(form, 'weeklyTimeBudgetMin'),
        defaultStartTime: form.get('defaultStartTime'),
        aggressiveness: form.get('aggressiveness'),
        residual: { asOfDate: start, asOfTime: '00:00', load: { systemic: 0, structural: 0 } },
        safetyHold: null,
      })
      const goal = parseGoal({
        label: form.get('goalLabel'),
        peakDate: form.get('peakDate'),
        qualityBias: form.getAll('qualityBias'),
        protectedExerciseIds: form.getAll('protectedExerciseIds'),
        fixedCommitments: commitments.map(id => ({
          id: `commitment-${id}`,
          label: form.get(`commitment_${id}_label`),
          dayOfWeek: numberFrom(form, `commitment_${id}_day`),
          startTime: form.get(`commitment_${id}_time`),
          durationMin: numberFrom(form, `commitment_${id}_duration`),
          discipline: form.get(`commitment_${id}_discipline`),
          modality: form.get(`commitment_${id}_modality`),
          estimatedLoad: { systemic: numberFrom(form, `commitment_${id}_systemic`), structural: numberFrom(form, `commitment_${id}_structural`) },
        })),
      })
      const confirmed = form.get('comfortable') === 'on' && form.get('healthy') === 'on'
      await onSave(parsed, goal, start, confirmed)
    } catch (error) { setError(error instanceof Error ? error.message : 'Check your baseline inputs.') }
  }

  return <form className="panel model-setup" id="block-setup" onSubmit={event => { void submit(event) }}>
    <div className="panel-heading"><div><p className="eyebrow">One established starting point</p><h2>Baseline &amp; block setup</h2></div><span className="small-tag">0.2.0</span></div>
    <p className="muted">Use your own recent, comfortable training. This saves a block and its exercise anchors, not a whole block of workouts. Each week is previewed separately.</p>
    <fieldset disabled={disabled}>
      <fieldset className="model-section"><legend>Goal and dates</legend>
        <label className="model-field">Goal label<input name="goalLabel" maxLength={80} required placeholder="Your own training goal" /></label>
        <div className="model-fields">
          <label className="model-field">Block start (Monday)<input name="blockStart" type="date" value={start} onChange={event => setStart(event.target.value)} required /></label>
          <label className="model-field">Goal / peak date<input name="peakDate" type="date" min={start} required /></label>
          <label className="model-field">Baseline observed as of<input name="asOf" type="date" max={start} defaultValue={athlete?.baseline.asOf ?? start} required /></label>
        </div>
        <p className="field-hint">Choose at least one quality priority. These are soft scheduling emphasis only. Selecting speed, power or threshold never prescribes harder running.</p>
        <div className="check-grid">{QUALITIES.map(quality => <label key={quality}><input type="checkbox" name="qualityBias" value={quality} />{labelFor(quality)}</label>)}</div>
      </fieldset>
      <fieldset className="model-section"><legend>Your recent comfortable baseline</legend>
        <div className="model-fields">
          <NumericField name="weeklyRunMinutes" label="Running minutes / week" value={athlete?.baseline.weeklyRunMinutes} min={1} max={600} />
          <NumericField name="longestRunMinutes" label="Longest comfortable run (min)" value={athlete?.baseline.longestRunMinutes} min={1} max={180} />
          <NumericField name="runsPerWeek" label="Established runs / week" value={athlete?.baseline.runsPerWeek} min={1} max={4} />
          <NumericField name="liftsPerWeek" label="Established lifts / week" value={athlete?.baseline.liftsPerWeek} min={1} max={3} />
          <NumericField name="liftDurationMin" label="Established lift duration (min)" value={athlete?.baseline.liftDurationMin} min={15} max={180} />
          <NumericField name="weeklyTimeBudgetMin" label="Available minutes / week" value={athlete?.weeklyTimeBudgetMin} min={1} max={10080} />
          <label className="model-field">Habitual session start<input name="defaultStartTime" type="time" defaultValue={athlete?.defaultStartTime ?? ''} required /></label>
          <label className="model-field">Recovery / reduction policy<select name="aggressiveness" defaultValue={athlete?.aggressiveness ?? 'conservative'}><option value="conservative">Conservative · larger reductions</option><option value="standard">Standard · moderate reductions</option><option value="aggressive">Smaller reductions · still baseline-bounded</option></select></label>
        </div>
        <p className="field-hint">No setting permits automatic increases above your baseline. Calibration week and scheduled deloads use 60% volume. Recovery half-lives stay fixed; logs do not learn two model axes from a single effort rating.</p>
        <div className="day-picker">{DAY_NAMES.map((day, index) => <label className={`day-option${days.includes(index as Day) ? ' selected' : ''}`} key={day}><input type="checkbox" checked={days.includes(index as Day)} onChange={event => setDays(event.target.checked ? [...days, index as Day].sort() : days.filter(item => item !== index))} />{day.slice(0, 3)}</label>)}</div>
      </fieldset>
      <fieldset className="model-section"><legend>Equipment you have</legend>
        <div className="check-grid">{EQUIPMENT.map(item => <label key={item}><input type="checkbox" checked={equipment.includes(item)} onChange={event => setEquipment(event.target.checked ? [...equipment, item] : equipment.filter(value => value !== item))} />{item}</label>)}</div>
      </fieldset>
      <fieldset className="model-section"><legend>Your established exercises · {selected.length} / 8</legend>
        <p className="field-hint">Select entries you already use, then enter your own observations. No exercise-to-exercise weight inference. High-skill exercises are excluded. Zero kg means no added external load, not an invented starting load.</p>
        <div className="check-grid">{options.map(exercise => <label key={exercise.id}><input type="checkbox" checked={selected.includes(exercise.id)} disabled={!selected.includes(exercise.id) && selected.length >= 8} onChange={event => setSelected(event.target.checked ? [...selected, exercise.id] : selected.filter(id => id !== exercise.id))} />{exercise.name} · {labelFor(exercise.pattern)}</label>)}</div>
        {!options.length && <p className="field-warning">Choose equipment to see compatible exercises.</p>}
        {selected.map(id => {
          const exercise = DEFAULT_LIBRARY.exercises.find(item => item.id === id)
          const observation = athlete?.baseline.exercises.find(item => item.exerciseId === id)
          return <fieldset key={id} className="exercise-row"><legend>{exercise?.name ?? id}</legend>
            {!options.some(item => item.id === id) && <p className="field-warning">Equipment no longer matches. <button type="button" className="text-button" onClick={() => setSelected(selected.filter(value => value !== id))}>Remove this exercise</button></p>}
            <div className="model-fields">
              <NumericField name={`${id}_weightKg`} label="Your established external kg" value={observation?.weightKg} max={500} step="any" />
              <NumericField name={`${id}_sets`} label="Established sets" value={observation?.sets} min={1} max={10} />
              <NumericField name={`${id}_reps`} label="Reps per set" value={observation?.reps} min={1} max={50} />
              <NumericField name={`${id}_actualRPE`} label="Last-set RPE (6–10)" value={observation?.actualRPE} min={6} max={10} step={0.5} />
              <NumericField name={`${id}_experienceMonths`} label="Experience with this exercise (months)" value={observation?.experienceMonths} max={1200} />
              <label className="model-field">Observation date<input type="date" name={`${id}_date`} defaultValue={observation?.date ?? ''} max={start} required /></label>
            </div>
            <label className="check-line"><input type="checkbox" name="protectedExerciseIds" value={id} />Prefer keeping this established exercise as an anchor</label>
          </fieldset>
        })}
        <p className="field-hint">Set RPE is not whole-session effort. RPE 9 ≈ 1 rep in reserve; RPE 8 ≈ 2. Anchor targets never exceed your observation: at most 7 below 12 months of exercise experience, or 8 at 12+ months. These are conservative policy categories, not biological cutoffs. A starting-weight suggestion requires your same-rep, compatible-RPE observation; otherwise none is given.</p>
      </fieldset>
      <details className="model-section">
        <summary>Optional fixed commitments · advanced estimated loads ({commitments.length} / 4)</summary>
        <p className="field-hint">No commitments are assumed. These are sessions you already chose, not new prescriptions. Enter your own estimated systemic and structural AU. AU are hand-authored scheduling cost units, not measured fatigue, readiness or injury risk.</p>
        {commitments.map(id => <fieldset className="exercise-row" key={id}><legend>Fixed commitment {id + 1}</legend>
          <label className="model-field">Your commitment label<input name={`commitment_${id}_label`} maxLength={80} required /></label>
          <div className="model-fields">
            <label className="model-field">Day<select name={`commitment_${id}_day`} defaultValue="" required><option value="" disabled>Select day</option>{DAY_NAMES.map((day, index) => <option value={index} key={day}>{day}</option>)}</select></label>
            <label className="model-field">Start time<input name={`commitment_${id}_time`} type="time" required /></label>
            <NumericField name={`commitment_${id}_duration`} label="Duration (min)" min={1} max={600} />
            <label className="model-field">Discipline<select name={`commitment_${id}_discipline`} defaultValue="" required><option value="" disabled>Select discipline</option>{DISCIPLINES.map(value => <option value={value} key={value}>{labelFor(value)}</option>)}</select></label>
            <label className="model-field">Modality<select name={`commitment_${id}_modality`} defaultValue="" required><option value="" disabled>Select modality</option>{MODALITIES.map(value => <option value={value} key={value}>{labelFor(value)}</option>)}</select></label>
            <NumericField name={`commitment_${id}_systemic`} label="User-estimated systemic AU" max={10000} step={0.1} />
            <NumericField name={`commitment_${id}_structural`} label="User-estimated structural AU" max={10000} step={0.1} />
          </div>
          <button className="text-button" type="button" onClick={() => setCommitments(commitments.filter(value => value !== id))}>Remove commitment</button>
        </fieldset>)}
        <button type="button" className="text-button" disabled={commitments.length >= 4} onClick={() => setCommitments([...commitments, Math.max(-1, ...commitments) + 1])}>Add an established fixed commitment</button>
      </details>
      <label className="confirmation"><input type="checkbox" name="comfortable" required />This baseline is recent and comfortable for me. These are observations of training I already do, not desired targets.</label>
      <label className="confirmation"><input type="checkbox" name="healthy" required />I have no current pain or illness and am not returning from a break. I am explicitly reconfirming my baseline; any earlier safety hold can only resolve after its date.</label>
      {athlete?.safetyHold && <p className="notice notice-error">Active {athlete.safetyHold.reason} hold since {athlete.safetyHold.since}. Use a newly established comfortable baseline dated after that event. This is not rehabilitation or return-to-training advice.</p>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <button className="button button-primary" type="submit">Save confirmed baseline &amp; new block</button>
      <p className="field-hint">Existing blocks, week inputs and logs remain unchanged. No workout week is saved by this action.</p>
    </fieldset>
  </form>
}
