import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { DEFAULT_LIBRARY, resolveProgramLibrary } from '../../engine/library.ts'
import { LIMITS, PROGRAM_POLICY, RECOMMENDATION_POLICY } from '../../engine/constants.ts'
import { recommendProgram } from '../../engine/program.ts'
import { confirmSetupEquipment, prepareRecommendedSetup } from './model.ts'
import { MAX_GOAL_TEXT_LENGTH } from './setup-assistant.ts'
import { eventDateBounds, validateSetupDate } from './setup-dates.ts'
import type { CampaignDraft, CampaignState, RecommendedSetup } from './types.ts'
import { DayPicker, NumberField } from './components.tsx'
import Icon from './Icons.tsx'
import EquipmentPicker from './EquipmentPicker.tsx'
import { equipmentForResources, exerciseAvailable, programResources, recommendForResources, resourcesForEquipment, resourceLabels } from './equipment.ts'
import type { ResourceId } from './equipment.ts'
import WorkoutCards from './WorkoutCards.tsx'
import { parseWorkoutCards } from './workout-cards.ts'
import ExercisePoolEditor from './ExercisePoolEditor.tsx'
import { programmingChoices, selectProgramExercises } from './programming.ts'
import { ConditioningOptions, PracticeBlockOptions, ProgrammingChoice } from './ProgrammingOptions.tsx'
import { addOnboardingCustomExercise, advanceOnboarding, ONBOARDING_STEPS, onboardingGoalText, onboardingReviewDate, onboardingStep, patchOnboardingDraft, validateOnboardingRoutine } from './onboarding.ts'
import './onboarding.css'

function QuickChoice({ label, value, options, onChange, unit = '' }: { label: string; value: number; options: number[]; onChange: (value: number) => void; unit?: string }) {
  const choices = value > 0 && !options.includes(value) ? [...options, value].sort((a, b) => a - b) : options
  return <fieldset className="cf-quick-choice"><legend>{label}</legend><div>{choices.map(option => <button type="button" key={option} aria-pressed={value === option} onClick={() => onChange(option)}><strong>{option}</strong><span>{option === 1 ? unit.replace(/s$/, '') : unit}</span></button>)}</div></fieldset>
}

export default function CampaignSetup({ state, update, onAI, connected, onDisconnect }: {
  state: CampaignState
  update: (change: (state: CampaignState) => CampaignState) => void
  onAI: () => void
  connected: boolean
  onDisconnect: () => void
}) {
  const [issue, setIssue] = useState('')
  const dateHelpId = useId()
  const prepared = prepareRecommendedSetup(state)
  const draft = prepared.draft
  const setup = draft.recommendedSetup
  if (!setup) throw new Error('Recommended setup is unavailable for this draft.')
  const step = onboardingStep(state.step)
  const visibleStep = ONBOARDING_STEPS.findIndex(item => item.value === step) + 1
  const resources = draft.resources ?? resourcesForEquipment(draft.equipment)
  const library = draft.program ? resolveProgramLibrary(draft.program) : DEFAULT_LIBRARY
  const defaultReview = onboardingReviewDate(draft.startDate)
  const dateBounds = eventDateBounds(draft.startDate)
  const dateIssue = dateBounds.issue ? 'Choose a complete Monday start date in Routine → Availability & fixed sessions.' : ''
  const saveDraft = (next: CampaignDraft) => {
    try {
      const normalized = patchOnboardingDraft(next)
      update(previous => ({ ...previous, draft: normalized }))
      setIssue('')
      return true
    } catch (error) { setIssue(error instanceof Error ? error.message : 'Check your answers before continuing.'); return false }
  }
  const patch = (change: Partial<CampaignDraft>, preference: Partial<RecommendedSetup> = {}) => {
    try {
      const next = patchOnboardingDraft(draft, change, preference)
      update(previous => ({ ...previous, draft: next }))
      setIssue('')
      return true
    } catch (error) { setIssue(error instanceof Error ? error.message : 'Check your answers before continuing.'); return false }
  }
  const changeResources = (selected: ResourceId[]) => {
    try {
      const candidate = { ...draft, resources: selected, equipment: equipmentForResources(selected) }
      if (draft.program) {
        const allowed = new Set(programmingChoices(candidate).map(item => item.exercise.id))
        const equipped = setup.exerciseIds.filter(id => allowed.has(id))
        const exerciseIds = equipped.length >= PROGRAM_POLICY.minSelectedExercises ? equipped : [...recommendProgram(programResources(selected), draft.program.goal, library).exerciseIds]
        const changed = patch({ resources: selected, equipment: candidate.equipment }, { exerciseIds })
        if (changed && equipped.length !== setup.exerciseIds.length) setIssue('The lineup was updated for your equipment. Review it before building; your personal notes were kept.')
      } else {
        const next = patchOnboardingDraft(candidate, {}, { exerciseIds: recommendForResources(selected) })
        try {
          const confirmed = confirmSetupEquipment({ ...prepared, draft: next }, selected)
          update(previous => ({ ...previous, draft: confirmed.draft }))
          setIssue('')
        } catch {
          update(previous => ({ ...previous, draft: next }))
          setIssue('Your equipment was saved. Confirm usable floor space or choose a preset before continuing.')
        }
      }
    } catch (error) {
      setIssue(`${error instanceof Error ? error.message : 'Equipment changes could not be applied.'} Check floor space and any required supports.`)
    }
  }
  function forward(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const next = advanceOnboarding(state)
      update(() => next)
      setIssue('')
    } catch (error) { setIssue(error instanceof Error ? error.message : 'Review your answers before continuing.') }
  }
  const moveTo = (next: 1 | 2 | 5) => {
    setIssue('')
    update(previous => ({ ...prepareRecommendedSetup(previous), step: next }))
  }

  return <div className="cf-setup-layout cf-lean-onboarding">
    <aside className="cf-setup-aside"><div><p className="cf-kicker">MAKE IT YOURS</p><h2>Your goal.<br />Your real routine.</h2></div>
      <ol>{ONBOARDING_STEPS.map((item, index) => <li key={item.value} aria-current={step === item.value ? 'step' : undefined}><span>{visibleStep > index + 1 ? <Icon name="check" size={16} /> : `0${index + 1}`}</span>{item.label}</li>)}</ol>
      <p className="cf-small">Three steps. No account or AI needed.<br />Your answers stay on this device.</p>
    </aside>
    <form className="cf-setup-form" onSubmit={forward}>
      <div className="cf-step-header"><button type="button" className="cf-icon-button" disabled={step === 1} aria-label="Previous step" onClick={() => moveTo(step === 5 ? 2 : 1)}><Icon name="back" /></button><span>0{visibleStep} <span className="cf-muted">/ 03</span></span><span>{ONBOARDING_STEPS[visibleStep - 1]!.label}</span></div>
      <div className="cf-step-progress" aria-hidden="true">{ONBOARDING_STEPS.map((item, index) => <i key={item.value} className={visibleStep > index ? 'cf-filled' : ''} />)}</div>

      {step === 1 && <section className="cf-stack" aria-label="Goal">
        <div><p className="cf-kicker">START WITH YOUR OWN WORDS</p><h1>What are you<br /><em>working toward?</em></h1><p className="cf-lead">A race, a stronger season, or feeling fitter. A sentence is enough.</p></div>
        <label className="cf-field cf-goal-prompt"><span>Your goal</span><textarea rows={3} required maxLength={MAX_GOAL_TEXT_LENGTH} placeholder="I want to feel stronger and run comfortably while keeping time for the activities I enjoy." value={onboardingGoalText(draft)} onChange={event => patch({}, { goalText: event.target.value })} /></label>
        <label className="cf-field"><span>Event date (optional)</span><input type="date" value={draft.eventDate === defaultReview ? '' : draft.eventDate} min={draft.startDate} max={dateBounds.max} aria-describedby={dateHelpId} onChange={event => patch({ eventDate: event.target.value })} /></label>
        <p id={dateHelpId} className="cf-small">No event date? Your default is a 12-week progress review{defaultReview ? ` on ${defaultReview}` : ', once your start date is set'}. Enter a full date, including the year, only if you have one. We never infer dates from your goal.</p>
        {dateIssue && <p role="status" className="cf-small">{dateIssue}<button type="button" className="cf-text-button" onClick={() => moveTo(2)}>Set start date</button></p>}
        <p className="cf-small">No sport menu, account or API key. The built-in planner works with your answers; optional AI comes after your routine is complete.</p>
      </section>}

      {step === 2 && <section className="cf-stack" aria-label="Routine">
        <div><p className="cf-kicker">USE YOUR RECENT, COMFORTABLE ROUTINE</p><h1>A normal session.<br /><em>Not a target.</em></h1></div>
        <div className="cf-onboarding-routine">
          <div className="cf-input-group cf-rhythm-group"><h3><Icon name="run" />Running</h3>
            <QuickChoice label="A usual easy run lasts about…" value={setup.typicalRunMinutes} options={[15, 20, 30, 45, 60]} unit="min" onChange={typicalRunMinutes => patch({}, { typicalRunMinutes })} />
            <QuickChoice label="Runs in a normal week" value={draft.runsPerWeek} options={[1, 2, 3, 4]} unit="runs" onChange={runsPerWeek => patch({ runsPerWeek })} />
          </div>
          <div className="cf-input-group cf-rhythm-group"><h3><Icon name="dumbbell" />Lifting</h3>
            <QuickChoice label="A usual lifting session lasts about…" value={draft.liftDurationMin} options={[20, 30, 45, 60]} unit="min" onChange={liftDurationMin => patch({ liftDurationMin })} />
            <QuickChoice label="Lifts in a normal week" value={draft.liftsPerWeek} options={[1, 2, 3]} unit="lifts" onChange={liftsPerWeek => patch({ liftsPerWeek })} />
          </div>
        </div>
        <details className="cf-details"><summary>My sessions are a different length</summary><div className="cf-two">
          <NumberField label="Typical easy run" value={setup.typicalRunMinutes} min={1} max={LIMITS.maxRunMinutes} suffix="min" required={false} onChange={typicalRunMinutes => patch({}, { typicalRunMinutes })} />
          <NumberField label="Typical lifting session" value={draft.liftDurationMin} min={1} max={180} suffix="min" required={false} onChange={liftDurationMin => patch({ liftDurationMin })} />
        </div></details>
        <EquipmentPicker value={resources} onChange={changeResources} />
        <ConditioningOptions draft={draft} onChange={saveDraft} />
        <details className="cf-details"><summary>Availability &amp; fixed sessions (optional)</summary><div className="cf-stack cf-practice-fields">
          <p className="cf-small">Start: {draft.startDate || 'not set'}. By default, the planner can use any day and leaves room for rest.</p>
          <label className="cf-field">Block starts (Monday)<input type="date" value={draft.startDate} onChange={event => patch({ startDate: event.target.value })} /></label>
          <DayPicker label="Days you can train" value={draft.availableDays} onChange={availableDays => patch({ availableDays })} />
          <DayPicker label="Fixed practice or activity days" value={draft.practiceDays} onChange={practiceDays => patch({ practiceDays })} />
          {draft.practiceDays.length > 0 && <div className="cf-two"><label className="cf-field">Starts at<input type="time" value={draft.practiceTime} onChange={event => patch({ practiceTime: event.target.value })} /></label><NumberField label="Usual session length" value={draft.practiceDuration} min={1} max={240} suffix="min" required={false} onChange={practiceDuration => patch({ practiceDuration })} /></div>}
          <PracticeBlockOptions draft={draft} onChange={saveDraft} />
        </div></details>
      </section>}

      {step === 5 && <section className="cf-stack" aria-label="Review & build">
        <div><p className="cf-kicker">A COMPLETE PLAN, WITHOUT AI</p><h1>Your starting point.<br /><em>Ready to build.</em></h1></div>
        <div className="cf-onboarding-review">
          <div><h2>{draft.goalLabel}</h2><p>{draft.eventDate === defaultReview || !draft.eventDate ? '12-week progress review' : 'Event'}: {draft.eventDate || defaultReview}</p><button type="button" className="cf-text-button" onClick={() => moveTo(1)}>Edit goal</button></div>
          <div><p>{draft.runsPerWeek} runs of about {setup.typicalRunMinutes} min · {draft.liftsPerWeek} lifts of about {draft.liftDurationMin} min</p><p>{resourceLabels(resources).join(' · ') || 'Bodyweight only'}{draft.practiceDays.length ? ` · ${draft.practiceDays.length} fixed sessions` : ''}</p><button type="button" className="cf-text-button" onClick={() => moveTo(2)}>Edit routine &amp; equipment</button></div>
        </div>
        <div><h3>Your starting lineup</h3><p className="cf-small">Easy runs and {setup.exerciseIds.length} recommended strength movements. Your first exposures stay conservative; starting weights are never guessed.</p>
          <ul className="cf-onboarding-lineup">{setup.exerciseIds.map(id => <li key={id}>{library.exercises.find(item => item.id === id)?.name ?? id}</li>)}</ul>
        </div>
        <details className="cf-details"><summary>Edit the lineup or add notes (optional)</summary><div className="cf-stack">
          <ProgrammingChoice draft={draft} onChange={saveDraft} />
          {draft.program ? <ExercisePoolEditor choices={programmingChoices(draft)} selected={setup.exerciseIds} maxExercises={LIMITS.maxProgramExercises}
            goal={draft.goalLabel} resources={resources} cards={state.cards ?? []} program={draft.program}
            onChange={ids => { try { saveDraft(selectProgramExercises(draft, ids)) } catch (error) { setIssue(error instanceof Error ? error.message : 'The lineup could not be updated.') } }}
            onCreateCustom={exercise => {
              try {
                const result = addOnboardingCustomExercise(draft, exercise)
                if (!saveDraft(result.draft)) return false
                if (!result.selected) setIssue('Exercise saved to your library. Your lineup is full; swap an existing movement to use it.')
                return true
              } catch (error) { setIssue(error instanceof Error ? error.message : 'The custom exercise could not be saved.'); return false }
            }}
            onCards={cards => update(previous => ({ ...previous, cards: parseWorkoutCards(cards, previous.draft.program) }))} />
            : <div className="cf-stack">{setup.exerciseIds.map(id => {
              const exercise = DEFAULT_LIBRARY.exercises.find(item => item.id === id)
              const alternatives = DEFAULT_LIBRARY.exercises.filter(item => item.pattern === exercise?.pattern && !setup.exerciseIds.includes(item.id) && (RECOMMENDATION_POLICY.supportedExerciseIds as readonly string[]).includes(item.id) && exerciseAvailable(item.id, resources))
              return <label className="cf-field" key={id}>Swap {exercise?.name ?? id}<select value={id} onChange={event => patch({}, { exerciseIds: setup.exerciseIds.map(current => current === id ? event.target.value : current) })}><option value={id}>{exercise?.name ?? id}</option>{alternatives.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            })}</div>}
          <details className="cf-details"><summary>Personal notes &amp; unscheduled ideas</summary><WorkoutCards cards={state.cards ?? []} resources={resources} program={draft.program} onChange={cards => update(previous => ({ ...previous, cards: parseWorkoutCards(cards, previous.draft.program) }))} /></details>
        </div></details>
        <button type="button" className="cf-ai-teaser" onClick={() => {
          try { validateOnboardingRoutine(draft); validateSetupDate(draft.startDate, draft.eventDate); if (!draft.goalLabel.trim()) throw new Error('Finish your goal before using optional AI.'); onAI(); setIssue('') } catch (error) { setIssue(error instanceof Error ? error.message : 'Finish your answers before using AI.') }
        }}><Icon name="spark" /><div><strong>Optional: refine with AI or chat</strong><span>Use all your answers in one brief. Review suggestions before applying them.</span></div><Icon name="chevron" size={18} /></button>
        {connected && <button type="button" className="cf-text-button" onClick={onDisconnect}>Disconnect AI</button>}
        <label className="cf-check"><input type="checkbox" required checked={draft.confirmed} onChange={event => update(previous => ({ ...previous, draft: { ...previous.draft, confirmed: event.target.checked } }))} /><span>These session amounts reflect my recent, comfortable routine. I'm not currently in pain, ill or returning from a break.</span></label>
        <p className="cf-small">Recommendations are not claimed past performances. This isn't rehabilitation or a complete sport-coaching programme.</p>
      </section>}
      {issue && <p className="cf-error" role="alert">{issue}</p>}
      <div className="cf-step-footer"><span><Icon name="lock" size={14} />Private by default</span><button className="cf-button cf-primary" type="submit">{step === 5 ? 'Build my week' : 'Continue'}<Icon name="arrow" size={19} /></button></div>
    </form>
  </div>
}
