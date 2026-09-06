import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { addDays } from '../../engine/dates.ts'
import { DEFAULT_LIBRARY } from '../../engine/library.ts'
import { recommendationForExercise } from '../../engine/recommendations.ts'
import { RECOMMENDATION_POLICY } from '../../engine/constants.ts'
import type { MovementPattern } from '../../engine/types.ts'
import { buildCampaign, exampleCampaign, normalizeRecommendedDraft, prepareRecommendedSetup } from './model.ts'
import { MAX_GOAL_TEXT_LENGTH } from './setup-assistant.ts'
import { eventDateBounds, validateSetupDate } from './setup-dates.ts'
import type { CampaignDraft, CampaignState, RecommendedSetup } from './types.ts'
import { CourtArt, DayPicker, NumberField } from './components.tsx'
import Icon from './Icons.tsx'
import EquipmentPicker from './EquipmentPicker.tsx'
import { equipmentForResources, exerciseAvailable, recommendForResources, resourcesForEquipment, resourceLabels } from './equipment.ts'
import type { ResourceId } from './equipment.ts'
import WorkoutCards from './WorkoutCards.tsx'
import { parseWorkoutCards } from './workout-cards.ts'

const stepOrder = [6, 1, 2, 3, 4, 5]
const steps = ['Welcome', 'Your direction', 'Your rhythm', 'Your base', 'Your week', 'Ready to start', 'Your equipment']
const patterns: Record<MovementPattern, string> = {
  knee_dominant: 'Squat', hip_dominant: 'Hinge', horizontal_push: 'Push', vertical_push: 'Overhead push',
  horizontal_pull: 'Pull', vertical_pull: 'Vertical pull', unilateral_lower: 'Single leg', carry: 'Carry', core: 'Core', rotational: 'Rotation',
}

function QuickChoice({ label, value, options, onChange, unit = '' }: { label: string; value: number; options: number[]; onChange: (value: number) => void; unit?: string }) {
  return <fieldset className="cf-quick-choice"><legend>{label}</legend><div>{options.map(option => <button type="button" key={option} aria-pressed={value === option} onClick={() => onChange(option)}><strong>{option}</strong><span>{option === 1 ? unit.replace(/s$/, '') : unit}</span></button>)}</div></fieldset>
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
  const [swapping, setSwapping] = useState<string | null>(null)
  const [editingExercise, setEditingExercise] = useState<string | null>(null)
  const prepared = prepareRecommendedSetup(state)
  const draft = prepared.draft
  const setup = draft.recommendedSetup
  if (!setup) throw new Error('Recommended setup is unavailable for this draft.')
  const dateBounds = eventDateBounds(draft.startDate)
  const resources = draft.resources ?? resourcesForEquipment(draft.equipment)
  const visibleStep = stepOrder.indexOf(state.step) + 1
  const patch = (change: Partial<CampaignDraft>, preference: Partial<RecommendedSetup> = {}) => {
    setIssue('')
    update(previous => {
      const current = prepareRecommendedSetup(previous)
      const currentSetup = current.draft.recommendedSetup
      if (!currentSetup) throw new Error('Recommended setup is unavailable for this draft.')
      return { ...current, draft: normalizeRecommendedDraft({ ...current.draft, ...change, recommendedSetup: { ...currentSetup, ...preference }, confirmed: false }) }
    })
  }
  const changeResources = (selected: ResourceId[]) => {
    const equipped = setup.exerciseIds.filter(id => exerciseAvailable(id, selected))
    const removed = setup.exerciseIds.length - equipped.length
    const wasRecommended = JSON.stringify(setup.exerciseIds) === JSON.stringify(recommendForResources(resources))
    patch({ resources: selected, equipment: equipmentForResources(selected) }, {
      exerciseIds: wasRecommended || !equipped.length ? recommendForResources(selected) : equipped,
    })
    if (removed) setIssue(`${removed} unavailable exercise card${removed === 1 ? ' was' : 's were'} removed. Review Your base before building the week. Personal notes were kept.`)
    setSwapping(null)
  }
  const changeMode = (mode: RecommendedSetup['mode']) => {
    if (mode === setup.mode) return
    if (mode === 'classic') {
      onDisconnect()
      patch({ goalKind: 'hybrid', goalLabel: 'Run + lift', location: '', eventDate: addDays(draft.startDate, 83), priorities: ['aerobic_base', 'max_strength'] }, { mode, goalText: '' })
    } else patch({ goalLabel: '', location: '', eventDate: '' }, { mode })
  }
  function forward(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state.step === 1 && setup?.mode === 'assisted' && !draft.goalLabel.trim()) {
      setIssue('Review your goal using an API or imported chat reply, or choose the classic run + lift plan.')
      return
    }
    if (state.step === 1 && setup?.mode === 'assisted') {
      try { validateSetupDate(draft.startDate, draft.eventDate) } catch (error) {
        setIssue(error instanceof Error ? error.message : 'Review your event or review date before continuing.')
        return
      }
    }
    if (state.step === 2 && (!setup?.typicalRunMinutes || !draft.runsPerWeek || !draft.liftsPerWeek || !draft.liftDurationMin)) {
      setIssue('Choose your usual run length, run frequency, lift frequency and session length.')
      return
    }
    setIssue('')
    update(previous => {
      const current = prepareRecommendedSetup(previous)
      if (current.step === 6) return {
        ...current, step: 1, draft: { ...current.draft, resources, equipment: equipmentForResources(resources),
          recommendedSetup: { ...current.draft.recommendedSetup!, exerciseIds: current.draft.recommendedSetup!.exerciseIds.filter(id => exerciseAvailable(id, resources)) } },
      }
      return current.step === 5 ? buildCampaign(current) : { ...current, step: current.step + 1 }
    })
  }
  if (state.step === 0) return <section className="cf-welcome">
    <div className="cf-welcome-copy">
      <p className="cf-kicker"><span className="cf-short-line" />RUN. LIFT. YOUR THING.</p>
      <h1>A big goal.<br />A real life.<br /><em>Room for both.</em></h1>
      <p className="cf-lead">Start with your equipment and a run + lift base.<br />Make it yours offline, through an API or with your usual AI chat.</p>
      <button className="cf-button cf-primary cf-hero-cta" onClick={() => update(previous => ({ ...prepareRecommendedSetup(previous), step: 6 }))}>Find my starting point <Icon name="arrow" /></button>
      <button className="cf-text-button" onClick={() => update(previous => ({ ...exampleCampaign(previous.draft.startDate), step: 1 }))}>Explore the Bangkok example <Icon name="chevron" size={17} /></button>
      <div className="cf-welcome-trust"><Icon name="lock" size={16} /><span>No account. No subscription. Just your device.</span></div>
    </div>
    <div className="cf-welcome-visual"><CourtArt /><div className="cf-visual-caption"><span>01 / THE CAMPAIGN</span><strong>A plan, not a blank page.</strong><p>Recommended exercises. A flexible calendar. Your own weights.</p></div></div>
  </section>
  return <div className="cf-setup-layout">
    <aside className="cf-setup-aside"><div><p className="cf-kicker">MAKE IT YOURS</p><h2>A strong base.<br />Your own direction.</h2></div><ol>{stepOrder.map((step, index) => <li key={step} aria-current={state.step === step ? 'step' : undefined}><span>{visibleStep > index + 1 ? <Icon name="check" size={16} /> : `0${index + 1}`}</span>{steps[step]}</li>)}</ol><p className="cf-small">No training spreadsheet needed.<br />Your answers stay on this device.</p></aside>
    <form className="cf-setup-form" onSubmit={forward}>
      <div className="cf-step-header"><button type="button" className="cf-icon-button" aria-label="Previous step" onClick={() => { setIssue(''); update(previous => ({ ...prepareRecommendedSetup(previous), step: previous.step === 6 ? 0 : previous.step === 1 ? 6 : previous.step - 1 })) }}><Icon name="back" /></button><span>0{visibleStep} <span className="cf-muted">/ 06</span></span><span>{steps[state.step]}</span></div>
      <div className="cf-step-progress" aria-hidden="true">{stepOrder.map((step, index) => <i key={step} className={visibleStep > index ? 'cf-filled' : ''} />)}</div>
      {state.step === 6 && <section className="cf-stack">
        <div><p className="cf-kicker">START WITH WHAT YOU HAVE</p><h1>Your space.<br /><em>Your equipment.</em></h1><p className="cf-lead">Choose a starting point, then adjust the details. Every recommendation and AI brief uses this selection.</p></div>
        <EquipmentPicker value={resources} onChange={changeResources} />
        <p className="cf-small">Cardio and sport equipment are included in your brief. This engine still schedules easy running, strength and established practices; selecting a rower or SkiErg does not add or replace training.</p>
      </section>}
      {state.step === 1 && <section className="cf-stack">
        <div><p className="cf-kicker">CHOOSE YOUR STARTING POINT</p><h1>A ready-made base.<br /><em>Or your own brief.</em></h1></div>
        <div className="cf-path-options">
          <button type="button" className={`cf-choice cf-horizontal ${setup.mode === 'classic' ? 'cf-selected' : ''}`} aria-pressed={setup.mode === 'classic'} onClick={() => changeMode('classic')}><Icon name="dumbbell" /><div><strong>Classic run + lift</strong><span>A complete hybrid scheme. No AI or API key needed.</span></div><Icon name={setup.mode === 'classic' ? 'check' : 'chevron'} size={18} /></button>
          <button type="button" className={`cf-choice cf-horizontal ${setup.mode === 'assisted' ? 'cf-selected' : ''}`} aria-pressed={setup.mode === 'assisted'} onClick={() => changeMode('assisted')}><Icon name="spark" /><div><strong>Build around my goal</strong><span>Use your AI chat or API. Review the reply here.</span></div><Icon name={setup.mode === 'assisted' ? 'check' : 'chevron'} size={18} /></button>
        </div>
        {setup.mode === 'classic' ? <div className="cf-classic-base"><div className="cf-classic-symbols"><Icon name="run" size={28} /><span>+</span><Icon name="dumbbell" size={28} /></div><h2>Run comfortably.<br />Lift consistently.</h2><p>Easy running, a recommended strength routine and room to recover. Just tell us what a normal training session looks like.</p><span className="cf-small">We choose the exercises. You find your starting weights when you train.</span></div> : <>
          <label className="cf-field cf-goal-prompt"><span>What are you building toward?</span><textarea rows={5} maxLength={MAX_GOAL_TEXT_LENGTH} placeholder="I'm preparing for the Dodgeball World Championships in Bangkok. I want to keep running and lifting around team practice..." value={setup.goalText} onChange={event => patch({ goalLabel: '', location: '', eventDate: '' }, { goalText: event.target.value })} /></label>
          <label className="cf-field"><span>Event / review date (required before continuing)</span><input type="date" value={draft.eventDate} min={draft.startDate} max={dateBounds.max} required aria-describedby={dateHelpId} onChange={event => patch({ eventDate: event.target.value })} /></label>
          <p id={dateHelpId} className="cf-small">Choose the full date, including the year. No event yet? Choose a progress review date. You can ask AI first, but a date is required to continue. Editing the brief clears this choice.{dateBounds.max && ` Available: ${draft.startDate} to ${dateBounds.max}. For a later event, choose an earlier review date.`}</p>
          {dateBounds.issue && <p role="status">{dateBounds.issue}</p>}
          <button className="cf-button cf-primary" type="button" disabled={!setup.goalText.trim()} onClick={onAI}><Icon name="spark" />{draft.goalLabel ? 'Refine my goal' : 'Shape my goal'}<Icon name="arrow" size={18} /></button>
          <p className="cf-small">{connected ? 'AI connection is held in this tab only. Nothing is sent without confirmation.' : 'Use a local model or your own API. You review its interpretation before anything is applied.'}</p>
          {connected && <button className="cf-text-button" type="button" onClick={onDisconnect}>Disconnect AI</button>}
          {draft.goalLabel && <div className="cf-goal-review"><p className="cf-kicker">{state.sample ? 'SAMPLE GOAL BRIEF' : 'YOUR REVIEWED GOAL'}</p><h2>{draft.goalLabel}</h2>{draft.location && <p>{draft.location}</p>}<p className="cf-small">Review your goal and the date selected above before continuing.</p></div>}
        </>}
      </section>}
      {state.step === 2 && <section className="cf-stack">
        <div><p className="cf-kicker">NO WEEKLY MATHS</p><h1>What's a normal<br /><em>session for you?</em></h1><p className="cf-lead">Think about recent, comfortable training. Approximate is fine—we'll do the adding up.</p></div>
        <div className="cf-input-group cf-rhythm-group"><h3><Icon name="run" />Your runs</h3><QuickChoice label="A usual easy run lasts about..." value={setup.typicalRunMinutes} options={[15, 20, 30, 45, 60]} unit="min" onChange={typicalRunMinutes => patch({}, { typicalRunMinutes })} /><QuickChoice label="How many runs in a normal week?" value={draft.runsPerWeek} options={[1, 2, 3, 4]} unit="runs" onChange={runsPerWeek => patch({ runsPerWeek })} /><details className="cf-details"><summary>My usual run is a different length</summary><NumberField label="Typical easy run" value={setup.typicalRunMinutes} min={1} max={150} suffix="min" required={false} onChange={typicalRunMinutes => patch({}, { typicalRunMinutes })} /></details></div>
        <div className="cf-input-group cf-rhythm-group"><h3><Icon name="dumbbell" />Your lifting</h3><QuickChoice label="How many lifting sessions is normal for you?" value={draft.liftsPerWeek} options={[1, 2, 3]} unit="lifts" onChange={liftsPerWeek => patch({ liftsPerWeek })} /><QuickChoice label="About how long are you usually in the gym?" value={draft.liftDurationMin} options={[20, 30, 45, 60]} unit="min" onChange={liftDurationMin => patch({ liftDurationMin })} /></div>
        <details className="cf-details"><summary>Have Garmin / FIT / Apple training history?</summary><p>On-device activity import is next. You won't need to calculate a weekly total when that arrives either. This build uses the simple answers above.</p></details>
      </section>}
      {state.step === 3 && <section className="cf-stack">
        <div><p className="cf-kicker">A BASE, NOT A BLANK PAGE</p><h1>Your starting<br /><em>lineup.</em></h1><p className="cf-lead">A recommended strength routine for the equipment you have. Keep it, swap a movement, or ask AI to tailor the cards.</p></div>
        <details className="cf-details"><summary>Equipment: {resourceLabels(resources).join(', ') || 'No kit'}</summary><EquipmentPicker value={resources} onChange={changeResources} /></details>
        <div className="cf-recommendation-list">{setup.exerciseIds.map((id, index) => {
          const exercise = DEFAULT_LIBRARY.exercises.find(item => item.id === id)
          if (!exercise) throw new Error('A recommended exercise is missing from the checked library. Review the saved setup.')
          const prescription = recommendationForExercise(id)
          const alternatives = DEFAULT_LIBRARY.exercises.filter(item => (RECOMMENDATION_POLICY.supportedExerciseIds as readonly string[]).includes(item.id) && item.pattern === exercise.pattern && !setup.exerciseIds.includes(item.id) && exerciseAvailable(item.id, resources))
          return <article key={id} className={`cf-recommendation-card cf-pattern-${exercise.pattern}`}>
            <div className="cf-movement-tile"><span>{String(index + 1).padStart(2, '0')}</span><Icon name={exercise.pattern === 'core' || exercise.pattern === 'rotational' ? 'court' : 'dumbbell'} size={32} /></div>
            <div className="cf-recommendation-copy"><p className="cf-kicker">{patterns[exercise.pattern]}</p><h2>{exercise.name}</h2><p>Up to {prescription.sets} sets × {prescription.reps} reps<span className="cf-mid-dot">·</span>Easy starting effort</p><span className="cf-small">No starting weight assumed</span></div>
            {alternatives.length > 0 && <button className="cf-swap-button" type="button" aria-label={`Swap ${exercise.name}`} onClick={() => setSwapping(swapping === id ? null : id)}><Icon name="move" size={16} /><span>Swap</span></button>}
            <div className="cf-inline"><button type="button" className="cf-text-button" onClick={() => setEditingExercise(editingExercise === id ? null : id)}>Customise {exercise.name}</button><button type="button" className="cf-text-button" disabled={setup.exerciseIds.length <= 1} onClick={() => patch({}, { exerciseIds: setup.exerciseIds.filter(item => item !== id) })}>Remove {exercise.name}</button></div>
            {swapping === id && <div className="cf-swap-options"><p className="cf-small">Same movement pattern. Fresh weight calibration.</p>{alternatives.map(alternative => <button type="button" key={alternative.id} onClick={() => { patch({}, { exerciseIds: setup.exerciseIds.map(current => current === id ? alternative.id : current) }); setSwapping(null) }}>{alternative.name}<Icon name="chevron" size={15} /></button>)}</div>}
          </article>
        })}</div>
        {editingExercise && <WorkoutCards cards={state.cards ?? []} resources={resources} exerciseId={editingExercise} onChange={cards => update(previous => ({ ...previous, cards: parseWorkoutCards(cards) }))} />}
        <details className="cf-details"><summary>Add an equipped exercise</summary><div className="cf-inline">{DEFAULT_LIBRARY.exercises.filter(item => !setup.exerciseIds.includes(item.id) && (RECOMMENDATION_POLICY.supportedExerciseIds as readonly string[]).includes(item.id) && exerciseAvailable(item.id, resources)).map(item => <button type="button" className="cf-button cf-secondary" key={item.id} disabled={setup.exerciseIds.length >= RECOMMENDATION_POLICY.maxExercises} onClick={() => patch({}, { exerciseIds: [...setup.exerciseIds, item.id] })}>{item.name}</button>)}</div><p className="cf-small">Up to {RECOMMENDATION_POLICY.maxExercises} supported cards. Quantities come from the engine, not custom text.</p></details>
        <details className="cf-details"><summary>Personal notes &amp; unscheduled drill ideas ({state.cards?.length ?? 0})</summary><WorkoutCards cards={state.cards ?? []} resources={resources} onChange={cards => update(previous => ({ ...previous, cards: parseWorkoutCards(cards) }))} /></details>
        <div className="cf-inline-note"><Icon name="leaf" /><p>You'll find comfortable starting weights in your first session. No old weight, rep or effort records needed.</p></div>
        <button type="button" className="cf-ai-teaser" onClick={onAI}><Icon name="spark" /><div><strong>Shape sessions with my AI</strong><span>Copy a chat brief or use your connected API. Review once, then apply.</span></div><Icon name="chevron" size={18} /></button>
        <p className="cf-small">AI can choose compatible exercises from the checked library. The engine sets the dose and checks scheduling costs. It can't invent an exercise with unknown fatigue data.</p>
        {connected && <button className="cf-text-button" type="button" onClick={onDisconnect}>Disconnect AI</button>}
      </section>}
      {state.step === 4 && <section className="cf-stack">
        <div><p className="cf-kicker">FIT THE WEEK YOU ACTUALLY HAVE</p><h1>Training meets<br /><em>real life.</em></h1><p className="cf-lead">Pick your days. Fixed practices go in first.</p></div>
        <label className="cf-field">Block starts (Monday)<input type="date" value={draft.startDate} required onChange={event => patch({ startDate: event.target.value })} /></label>
        <DayPicker label="Days you can train" value={draft.availableDays} onChange={availableDays => patch({ availableDays })} />
        <details className="cf-details" open={draft.practiceDays.length > 0}><summary>{draft.goalKind === 'dodgeball' ? 'Your dodgeball practice' : 'Add fixed sport practices'}</summary><div className="cf-stack cf-practice-fields"><DayPicker label="Practice days" value={draft.practiceDays} onChange={practiceDays => patch({ practiceDays })} />{draft.practiceDays.length > 0 && <div className="cf-two"><label className="cf-field">Starts at<input type="time" value={draft.practiceTime} required onChange={event => patch({ practiceTime: event.target.value })} /></label><NumberField label="Usual practice length" value={draft.practiceDuration} min={1} max={240} suffix="min" onChange={practiceDuration => patch({ practiceDuration })} /></div>}</div></details>
        <div className="cf-time-summary"><Icon name="calendar" /><div><strong>Roughly {Math.floor(draft.weeklyTimeBudgetMin / 60)}h {draft.weeklyTimeBudgetMin % 60 || ''}{draft.weeklyTimeBudgetMin % 60 ? 'm' : ''} in a normal week</strong><p>Calculated from your session choices, including practice. We'll stay within that time and leave room for rest.</p><button type="button" className="cf-text-button" onClick={() => update(previous => ({ ...previous, step: 2 }))}>Change my usual sessions <Icon name="back" size={15} /></button></div></div>
      </section>}
      {state.step === 5 && <section className="cf-stack">
        <div><p className="cf-kicker">READY, WITHOUT THE GUESSWORK</p><h1>Your base is set.<br /><em>Let's find your rhythm.</em></h1></div>
        <div className="cf-goal-summary"><Icon name={setup.mode === 'classic' ? 'dumbbell' : 'spark'} /><div><span>{setup.mode === 'classic' ? 'CLASSIC HYBRID' : draft.location || 'YOUR GOAL'}</span><h2>{draft.goalLabel}</h2><p>{setup.mode === 'classic' ? 'Running + lifting. No AI required.' : 'Your reviewed brief. Engine-checked training.'}</p></div></div>
        <div className="cf-principles"><div><span>01</span><h3>A routine to start from</h3><p>{setup.exerciseIds.length} recommended exercises. Easy runs based on your usual session length. Your first week starts lighter.</p></div><div><span>02</span><h3>Your weights, found in the gym</h3><p>No guessed kilograms. Choose a comfortable weight, log the set, and build your own reference point.</p></div><div><span>03</span><h3>Adapt without playing catch-up</h3><p>Move a session when life changes. Fatigue reduces upcoming work; a time skip leaves that slot free.</p></div></div>
        {setup.mode === 'classic' && <details className="cf-details"><summary>A 12-week direction, not a rigid schedule</summary><p>Only the next week is written from your current training. Revisit the overall direction on {draft.eventDate}.</p></details>}
        <label className="cf-check"><input type="checkbox" required checked={draft.confirmed} onChange={event => update(previous => ({ ...previous, draft: { ...previous.draft, confirmed: event.target.checked } }))} /><span>These session amounts reflect my recent, comfortable routine. I'm not currently in pain, ill or returning from a break.</span></label>
        <p className="cf-small">Exercise cards are recommendations, not claimed past performances. First exposures stay conservative. This isn't rehabilitation or a complete sport-coaching programme.</p>
      </section>}
      {issue && <p className="cf-error" role="alert">{issue}</p>}
      <div className="cf-step-footer"><span><Icon name="lock" size={14} />Private by default</span><button className="cf-button cf-primary" type="submit">{state.step === 5 ? 'Build my week' : 'Continue'}<Icon name="arrow" size={19} /></button></div>
    </form>
  </div>
}
