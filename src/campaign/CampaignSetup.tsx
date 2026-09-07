import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { DEFAULT_LIBRARY, resolveProgramLibrary } from '../../engine/library.ts'
import { LIMITS, PROGRAM_POLICY, RECOMMENDATION_POLICY } from '../../engine/constants.ts'
import { recommendProgram } from '../../engine/program.ts'
import { buildCampaign, confirmSetupEquipment, prepareRecommendedSetup, stable } from './model.ts'
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
import { PracticeBlockOptions, ProgrammingChoice } from './ProgrammingOptions.tsx'
import { addOnboardingCustomExercise, advanceOnboarding, ONBOARDING_STEPS, onboardingGoalText, onboardingReviewDate, onboardingStep, patchOnboardingDraft, validateOnboardingRoutine } from './onboarding.ts'
import './onboarding.css'
import CurrentTrainingForm from './CurrentTrainingForm.tsx'
import TrainingHistoryImport from './TrainingHistoryImport.tsx'
import { parseTrainingPreferences, TRAINING_PREFERENCE_LIMITS } from './training-baseline.ts'
import type { TrainingPreferences } from './training-baseline.ts'
import WeekPlanPreview from './WeekPlanPreview.tsx'
import { AI_PLANNING_OPTIONS } from './authored-policy.ts'

function PreferenceSlider({ label, value, max, unit, onChange }: {
  label: string; value: number; max: number; unit: string; onChange: (value: number) => void
}) {
  const id = useId()
  const valueText = `${value} ${value === 1 ? unit.replace(/s$/, '') : unit}`
  return <div className="cf-preference-slider">
    <div><label htmlFor={id}>{label}</label><output htmlFor={id} aria-hidden="true">{valueText}</output></div>
    <input id={id} type="range" min={0} max={max} step={Number.isInteger(value) ? 1 : 'any'}
      value={value} aria-valuetext={valueText} onChange={event => onChange(Math.round(Number(event.currentTarget.value)))} />
  </div>
}

function WeeklyPreferenceTotal({ minutes, count, activity }: { minutes: number; count: number; activity: string }) {
  return <p className="cf-preference-total" role="status">{count === 0 ? `No ${activity} requested.`
    : minutes === 0 ? 'Choose an average duration.'
      : `${minutes} min × ${count} = ${Math.round(minutes * count * 100) / 100} min/week`}</p>
}

export default function CampaignSetup({ state, update, onAI, connected, onDisconnect }: {
  state: CampaignState
  update: (change: (state: CampaignState) => CampaignState) => void
  onAI: () => void
  connected: boolean
  onDisconnect: () => void
}) {
  const [issue, setIssue] = useState('')
  const [preview, setPreview] = useState<{ key: string; state: CampaignState } | null>(null)
  const dateHelpId = useId()
  const prepared = prepareRecommendedSetup(state)
  const draft = prepared.draft
  const setup = draft.recommendedSetup
  if (!setup) throw new Error('Recommended setup is unavailable for this draft.')
  const step = onboardingStep(state.step)
  const visibleStep = ONBOARDING_STEPS.findIndex(item => item.value === step) + 1
  const resources = draft.resources ?? resourcesForEquipment(draft.equipment)
  const library = draft.program ? resolveProgramLibrary(draft.program, AI_PLANNING_OPTIONS) : DEFAULT_LIBRARY
  const defaultReview = onboardingReviewDate(draft.startDate)
  const dateBounds = eventDateBounds(draft.startDate)
  const dateIssue = dateBounds.issue ? 'Choose a complete Monday start date in Routine → Availability & start date.' : ''
  const preferences: TrainingPreferences = draft.trainingPreferences ?? {
    version: 1, runsPerWeek: draft.runsPerWeek, runDurationMin: setup.typicalRunMinutes,
    liftsPerWeek: draft.liftsPerWeek, liftDurationMin: draft.liftDurationMin,
  }
  const previewKey = stable([{ ...draft, confirmed: true }, state.pendingWeek])
  const checked = preview?.key === previewKey ? preview.state : null
  const saveDraft = (next: CampaignDraft) => {
    try {
      const normalized = patchOnboardingDraft(next)
      update(previous => { const next = { ...previous, draft: normalized }; delete next.pendingWeek; return next })
      setIssue('')
      return true
    } catch (error) { setIssue(error instanceof Error ? error.message : 'Check your answers before continuing.'); return false }
  }
  const patch = (change: Partial<CampaignDraft>, preference: Partial<RecommendedSetup> = {}) => {
    try {
      const next = patchOnboardingDraft(draft, change, preference)
      update(previous => { const changed = { ...previous, draft: next }; delete changed.pendingWeek; return changed })
      setIssue('')
      return true
    } catch (error) { setIssue(error instanceof Error ? error.message : 'Check your answers before continuing.'); return false }
  }
  const desire = (change: Partial<TrainingPreferences>) => patch({ trainingPreferences: parseTrainingPreferences({ ...preferences, ...change }) })
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
      if (step === 5 && state.pendingWeek && !checked) throw new Error('Preview the proposed week and resolve its checks before building.')
      const source = step === 1 ? { ...state, draft: { ...draft, trainingPreferences: preferences } } : state
      const next = advanceOnboarding(source)
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
      <p className="cf-small">No account or AI required.<br />Answers saved on this device.</p>
    </aside>
    <form className="cf-setup-form" onSubmit={forward}>
      <div className="cf-step-header"><button type="button" className="cf-icon-button" disabled={step === 1} aria-label="Previous step" onClick={() => moveTo(step === 5 ? 2 : 1)}><Icon name="back" /></button><span>0{visibleStep} <span className="cf-muted">/ 03</span></span><span>{ONBOARDING_STEPS[visibleStep - 1]!.label}</span></div>
      <div className="cf-step-progress" aria-hidden="true">{ONBOARDING_STEPS.map((item, index) => <i key={item.value} className={visibleStep > index ? 'cf-filled' : ''} />)}</div>

      {step === 1 && <section className="cf-stack" aria-label="Goal">
        <div><p className="cf-kicker">START WITH YOUR OWN WORDS</p><h1>What are you<br /><em>working toward?</em></h1><p className="cf-lead">A race, a stronger season, or feeling fitter. A sentence is enough.</p></div>
        <label className="cf-field cf-goal-prompt"><span>Your goal</span><textarea rows={3} required maxLength={MAX_GOAL_TEXT_LENGTH} placeholder="I want to feel stronger and run comfortably while keeping time for the activities I enjoy." value={onboardingGoalText(draft)} onChange={event => patch({}, { goalText: event.target.value })} /></label>
        <label className="cf-field"><span>Event date (optional)</span><input type="date" value={draft.eventDate === defaultReview ? '' : draft.eventDate} min={draft.startDate} max={dateBounds.max} aria-describedby={dateHelpId} onChange={event => patch({ eventDate: event.target.value })} /></label>
        <p id={dateHelpId} className="cf-small">No date? Use a 12-week progress review{defaultReview ? ` on ${defaultReview}` : ', once your start date is set'}. We never infer dates from your goal.</p>
        {dateIssue && <p role="status" className="cf-small">{dateIssue}<button type="button" className="cf-text-button" onClick={() => moveTo(2)}>Set start date</button></p>}
      </section>}

      {step === 2 && <section className="cf-stack" aria-label="Routine">
        <div><p className="cf-kicker">MAKE ROOM FOR TRAINING</p><h1>Your <em>preferred week.</em></h1><p className="cf-small">What you'd like to do—not your current training. We'll confirm your starting point next.</p></div>
        <div className="cf-onboarding-routine">
          <div className="cf-input-group cf-rhythm-group"><h3><Icon name="run" />Running</h3>
            <PreferenceSlider label="Runs per week" value={preferences.runsPerWeek} max={TRAINING_PREFERENCE_LIMITS.maxRunsPerWeek} unit="runs" onChange={runsPerWeek => desire({ runsPerWeek })} />
            <PreferenceSlider label="Average minutes per run" value={preferences.runDurationMin} max={TRAINING_PREFERENCE_LIMITS.maxDurationMin} unit="min" onChange={runDurationMin => desire({ runDurationMin })} />
            <WeeklyPreferenceTotal minutes={preferences.runDurationMin} count={preferences.runsPerWeek} activity="running" />
            <p className="cf-small">An average, not a long-run limit. Your AI can mix shorter runs with a longer run on a day that suits you.</p>
          </div>
          <div className="cf-input-group cf-rhythm-group"><h3><Icon name="dumbbell" />Lifting</h3>
            <PreferenceSlider label="Lifts per week" value={preferences.liftsPerWeek} max={TRAINING_PREFERENCE_LIMITS.maxLiftsPerWeek} unit="lifts" onChange={liftsPerWeek => desire({ liftsPerWeek })} />
            <PreferenceSlider label="Average minutes per lift" value={preferences.liftDurationMin} max={TRAINING_PREFERENCE_LIMITS.maxDurationMin} unit="min" onChange={liftDurationMin => desire({ liftDurationMin })} />
            <WeeklyPreferenceTotal minutes={preferences.liftDurationMin} count={preferences.liftsPerWeek} activity="lifting" />
          </div>
        </div>
        <EquipmentPicker value={resources} onChange={changeResources} />
        <details className="cf-details"><summary>Import Garmin history (optional)</summary><TrainingHistoryImport value={draft.trainingHistory} asOfDate={draft.startDate} onChange={trainingHistory => {
          const next = { ...draft, confirmed: false }
          if (trainingHistory) next.trainingHistory = trainingHistory
          else delete next.trainingHistory
          saveDraft(next)
        }} /></details>
        <div className="cf-card cf-stack cf-practice-fields">
          <h3>Club training &amp; fixed sessions</h3>
          <p className="cf-small">Add sessions already in your week. Their time and workload count toward the plan and appear in your AI brief.</p>
          <DayPicker label="Club training or fixed activity days" value={draft.practiceDays} onChange={practiceDays => patch({ practiceDays })} />
          {draft.practiceDays.length > 0 && <div className="cf-two"><label className="cf-field">Club session starts at<input type="time" value={draft.practiceTime} onChange={event => patch({ practiceTime: event.target.value })} /></label><NumberField label="Club session duration" value={draft.practiceDuration} min={1} max={240} suffix="min" required={false} onChange={practiceDuration => patch({ practiceDuration })} /></div>}
          {draft.practiceDays.length > 1 && <p className="cf-small">Selected days share this time and duration.</p>}
          <PracticeBlockOptions draft={draft} onChange={saveDraft} editable />
        </div>
        <details className="cf-details"><summary>Availability &amp; start date (optional)</summary><div className="cf-stack">
          <p className="cf-small">Start: {draft.startDate || 'not set'}. By default, the planner can use any day and leaves room for rest.</p>
          <label className="cf-field">Block starts (Monday)<input type="date" value={draft.startDate} onChange={event => patch({ startDate: event.target.value })} /></label>
          <DayPicker label="Days you can train" value={draft.availableDays} onChange={availableDays => patch({ availableDays })} />
        </div></details>
      </section>}

      {step === 5 && <section className="cf-stack" aria-label="Review & build">
        <div><p className="cf-kicker">REVIEW YOUR WEEK</p><h1>Review your <em>starting point.</em></h1></div>
        <div className="cf-onboarding-review">
          <div><h2>{draft.goalLabel}</h2><p>{draft.eventDate === defaultReview || !draft.eventDate ? '12-week progress review' : 'Event'}: {draft.eventDate || defaultReview}</p><button type="button" className="cf-text-button" onClick={() => moveTo(1)}>Edit goal</button></div>
          <div><p>Desired weekly averages: {preferences.runsPerWeek} runs × {preferences.runDurationMin} min = {preferences.runsPerWeek * preferences.runDurationMin} min · {preferences.liftsPerWeek} lifts × {preferences.liftDurationMin} min = {preferences.liftsPerWeek * preferences.liftDurationMin} min</p><p>{resourceLabels(resources).join(' · ') || 'Bodyweight only'}{draft.practiceDays.length ? ` · ${draft.practiceDays.length} fixed session${draft.practiceDays.length === 1 ? '' : 's'}` : ''}</p><button type="button" className="cf-text-button" onClick={() => moveTo(2)}>Edit routine &amp; equipment</button></div>
        </div>
        {draft.currentTraining ? <div className="cf-card"><h3>Reported current training</h3><p>{draft.currentTraining.runsPerWeek} runs / {draft.currentTraining.weeklyRunMinutes} min per week; longest comfortable run {draft.currentTraining.longestRunMinutes} min. {draft.currentTraining.liftsPerWeek} lifts of {draft.currentTraining.liftDurationMin} min.</p><p className="cf-small">As of {draft.currentTraining.asOf}. Source: {draft.currentTraining.source === 'chat' ? 'your conversation, awaiting your confirmation' : 'your local assessment'}.</p></div>
          : draft.trainingPreferences && <p role="status">Current training still needs confirmation—in chat or below without AI.</p>}
        <details className="cf-details"><summary>Enter current training without AI</summary><CurrentTrainingForm key={JSON.stringify(draft.currentTraining)} draft={draft} onChange={currentTraining => patch({ currentTraining })} /></details>
        {state.pendingWeek && <p role="status" className="cf-card">{checked
          ? 'Week checked, not saved. Review the preview and your confirmation below, then approve. No work has been logged.'
          : 'Week staged, not checked or saved. Select Preview week before approving. No work has been logged.'}</p>}
        {!state.pendingWeek && <div><h3>Your starting exercises</h3><p className="cf-small">Easy runs and {setup.exerciseIds.length} selected exercises. Conservative first sessions; no guessed starting weights.</p>
          <ul className="cf-onboarding-lineup">{setup.exerciseIds.map(id => <li key={id}>{library.exercises.find(item => item.id === id)?.name ?? id}</li>)}</ul>
        </div>}
        {(draft.currentTraining || !draft.trainingPreferences) && <button type="button" className="cf-button cf-secondary" onClick={() => {
          try {
            const next = buildCampaign({ ...state, draft: { ...draft, confirmed: true } })
            setPreview({ key: previewKey, state: next }); setIssue('')
          } catch (error) { setPreview(null); setIssue(error instanceof Error ? error.message : 'The week could not be checked.') }
        }}>Preview week</button>}
        {checked && <WeekPlanPreview plan={checked.weeks[0]!.plan} library={checked.weeks[0]!.input.library} program={checked.weeks[0]!.input.athlete.program} />}
        <details className="cf-details"><summary>Exercises &amp; notes (optional)</summary><div className="cf-stack">
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
          <details className="cf-details"><summary>Notes &amp; unscheduled ideas</summary><WorkoutCards cards={state.cards ?? []} resources={resources} program={draft.program} onChange={cards => update(previous => ({ ...previous, cards: parseWorkoutCards(cards, previous.draft.program) }))} /></details>
        </div></details>
        <button type="button" className="cf-ai-teaser" onClick={() => {
          try { validateOnboardingRoutine(draft); validateSetupDate(draft.startDate, draft.eventDate); if (!draft.goalLabel.trim()) throw new Error('Finish your goal before using optional AI.'); onAI(); setIssue('') } catch (error) { setIssue(error instanceof Error ? error.message : 'Finish your answers before using AI.') }
        }}><Icon name="spark" /><div><strong>Discuss in AI chat · Recommended</strong><span>Confirm your starting point and propose a week. No API key needed.</span></div><Icon name="chevron" size={18} /></button>
        {connected && <button type="button" className="cf-text-button" onClick={onDisconnect}>Disconnect AI</button>}
        <label className="cf-check"><input type="checkbox" required checked={draft.confirmed} onChange={event => update(previous => ({ ...previous, draft: { ...previous.draft, confirmed: event.target.checked } }))} /><span>I confirm the reported current training, not just my desired routine. I will review relevant pain, illness or breaks before deciding to train. App checks are not medical clearance.</span></label>
        <p className="cf-small">Recommendations are not claimed past performances. This isn't rehabilitation or a complete sport-coaching programme.</p>
      </section>}
      {issue && <p className="cf-error" role="alert">{issue}</p>}
      <div className="cf-step-footer"><span><Icon name="lock" size={14} />Private by default</span><button className="cf-button cf-primary" type="submit">{step === 5 ? checked ? 'Approve week' : 'Build my week' : 'Continue'}<Icon name="arrow" size={19} /></button></div>
    </form>
  </div>
}
