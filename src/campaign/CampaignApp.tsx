import { useEffect, useRef, useState } from 'react'
import type { DragEvent, PointerEvent } from 'react'
import { addDays } from '../../engine/dates.ts'
import { DAY_NAMES } from '../../engine/constants.ts'
import { DEFAULT_LIBRARY } from '../../engine/library.ts'
import { SUPPORTED_SPORT_DRILLS } from '../../engine/program.ts'
import type { ExerciseLibrary, Quality, Session } from '../../engine/types.ts'
import { currentMonday, formatDay, formatWeek } from '../dates.ts'
import BrandMark from '../BrandMark.tsx'
import { observeOfflineWorker } from '../offline.ts'
import type { OfflineStatus } from '../offline.ts'
import { adaptCampaign, CAMPAIGN_BACKUP_LIMIT, campaignDraftForWeek, campaignSessionOnHold, confirmSetupEquipment, emptyCampaign, logCampaignSet, nextCampaignWeek, parseCampaign, prepareRecommendedSetup, workoutContent } from './model.ts'
import { startNewPlan, trainingRecords } from './plan-history.ts'
import NewPlanConfirmation from './NewPlanConfirmation.tsx'
import { loadCampaign, persistCampaign } from './storage.ts'
import type { CalendarAction, CampaignState, GoalKind, SetDraft } from './types.ts'
import Icon from './Icons.tsx'
import type { IconName } from './Icons.tsx'
import CoachingWorkbench from './CoachingWorkbench.tsx'
import { applyHandoff } from './handoff.ts'
import type { HandoffScope } from './handoff.ts'
import WorkoutCards from './WorkoutCards.tsx'
import { parseWorkoutCards } from './workout-cards.ts'
import { resourcesForEquipment, resourceLabels } from './equipment.ts'
import type { AssistantConfig } from './assistant.ts'
import ExerciseGuide from './ExerciseGuide.tsx'
import { exerciseGuidance } from './exercise-guidance.ts'
import TemplateWorkout from './TemplateWorkout.tsx'
import SwapExercise from './SwapExercise.tsx'
import { finishWithFeedback, formatSessionPace, SESSION_FEELING_LABELS } from './training-feedback.ts'
import type { SessionFeedback } from './training-feedback.ts'
import ProgrammingRevision from './ProgrammingRevision.tsx'
import CampaignSetup from './CampaignSetup.tsx'
import { CourtArt } from './components.tsx'
import './campaign.css'
import { policyForWeek } from './authored-policy.ts'
import { sessionTitle } from './session-title.ts'

type Tab = 'today' | 'plan' | 'history'
type SaveStatus = 'loading' | 'saving' | 'saved' | 'failed'
type Update = (change: (state: CampaignState) => CampaignState) => boolean

const goalIcons: Record<GoalKind, IconName> = { dodgeball: 'court', running: 'run', hybrid: 'dumbbell', custom: 'spark' }
const qualityLabels: Record<Quality, string> = { aerobic_base: 'Endurance', threshold: 'Sustained effort', vo2max: 'Aerobic power', repeat_sprint: 'Repeated efforts', change_of_direction: 'Change of direction', max_strength: 'Strength', power: 'Power', strength_endurance: 'Strength endurance', shoulder_durability: 'Shoulder durability' }
const exerciseName = (id: string, library: ExerciseLibrary = DEFAULT_LIBRARY) => library.exercises.find(exercise => exercise.id === id)?.name ?? id
const sessionIcon = (session: Session): IconName => session.discipline === 'strength' ? 'dumbbell' : session.discipline === 'run' ? 'run' : 'court'
const sessionTheme = (session: Session) => session.kind === 'conditioning' ? 'run'
  : session.kind === 'workout' ? session.discipline === 'strength' ? 'strength' : 'commitment' : session.kind
const sessionType = (session: Session) => sessionTheme(session) === 'commitment' ? 'FIXED PRACTICE'
  : session.discipline === 'strength' ? 'LIFT' : session.modality === 'row' ? 'ROW'
    : session.modality === 'ski_erg' ? 'SKIERG' : session.discipline.toUpperCase()
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Your saved data has not been replaced.'
const rowKey = (sessionId: string, exerciseId: string, index: number) => `${sessionId}:${exerciseId}:${index}`

export default function CampaignApp() {
  const [state, setState] = useState<CampaignState | null>(null)
  const current = useRef<CampaignState | null>(null)
  const revision = useRef(0)
  const queue = useRef(Promise.resolve())
  const failed = useRef(false)
  const generation = useRef(0)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading')
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('today')
  const [sessionId, setSessionId] = useState<string | null>(decodeSessionHash())
  const [panel, setPanel] = useState<'ai' | 'setup-ai' | 'settings' | 'next-week' | 'leave-example' | 'revision' | 'new-plan' | null>(null)
  const [setupConnection, setSetupConnection] = useState<AssistantConfig | undefined>()
  const dialog = useRef<HTMLDialogElement>(null)
  const main = useRef<HTMLElement>(null)
  const [offline, setOffline] = useState<OfflineStatus>({ kind: 'checking', message: 'Checking offline availability.' })
  const [pendingRestore, setPendingRestore] = useState<CampaignState | null>(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let disposed = false
    void loadCampaign(emptyCampaign(addDays(currentMonday(), 7))).then(snapshot => {
      if (disposed) return
      revision.current = snapshot.revision
      const prepared = snapshot.state.setupComplete ? snapshot.state : prepareRecommendedSetup(snapshot.state)
      current.current = prepared
      setState(prepared)
      setSaveStatus('saved')
    }).catch(error => { if (!disposed) { setError(errorMessage(error)); setSaveStatus('failed') } })
    return () => { disposed = true }
  }, [])
  useEffect(() => observeOfflineWorker(document.querySelector<HTMLMetaElement>('meta[name="offline-worker"]')?.content ?? null, document.baseURI, navigator.serviceWorker, setOffline), [])
  useEffect(() => {
    const changed = () => setSessionId(decodeSessionHash())
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  useEffect(() => {
    if (panel) dialog.current?.showModal()
    else dialog.current?.close()
  }, [panel])
  useEffect(() => {
    main.current?.focus()
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [state?.step, state?.setupComplete, tab, sessionId])
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (saveStatus === 'saving' || saveStatus === 'failed') event.preventDefault()
    }
    window.addEventListener('beforeunload', preventLoss)
    return () => window.removeEventListener('beforeunload', preventLoss)
  }, [saveStatus])

  function save(next: CampaignState) {
    const sequence = ++generation.current
    setSaveStatus('saving')
    queue.current = queue.current.then(async () => {
      if (failed.current) return
      try {
        const snapshot = await persistCampaign(next, revision.current)
        revision.current = snapshot.revision
        if (sequence === generation.current) setSaveStatus('saved')
      } catch (error) {
        failed.current = true
        setSaveStatus('failed')
        setError(errorMessage(error))
      }
    })
  }
  const update: Update = change => {
    if (!current.current) return false
    try {
      const next = change(current.current)
      current.current = next
      setState(next)
      setError('')
      if (!failed.current) save(next)
      else setError('Changes are only in this tab. Resolve the save error before leaving.')
      return true
    } catch (error) { setError(errorMessage(error)); return false }
  }
  function retrySave() {
    if (!current.current) { window.location.reload(); return }
    failed.current = false
    setError('')
    save(current.current)
  }
  function navigate(next: Tab) { setTab(next); window.location.hash = ''; setSessionId(null) }
  function selectSession(id: string) { setSessionId(id); window.location.hash = `session/${encodeURIComponent(id)}` }
  function action(value: CalendarAction) {
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    update(previous => adaptCampaign(previous, value, today))
  }
  const week = state?.weeks[state.selectedWeek]
  const session = week?.plan.sessions.find(item => item.id === sessionId) ?? week?.removed.find(item => item.id === sessionId)
  const showHome = state?.setupComplete
  const coachingScope: HandoffScope = {
    purpose: state?.setupComplete ? 'suggest_exercises' : 'interpret_goal',
    ...(state?.setupComplete && session ? { sessionId: session.id } : {}),
  }
  function reviewNextWeek() {
    if (update(previous => ({ ...previous, selectedWeek: previous.weeks.length - 1 }))) {
      setPanel(state?.draft.recommendedSetup ? 'revision' : 'next-week')
    }
  }

  function exportData() {
    if (!current.current) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(current.current, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'hybrid-campaign-backup.json'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <div className="cf-app">
    <a className="cf-skip" href="#campaign-main">Skip to content</a>
    <header className="cf-header">
      <button className="cf-brand" onClick={() => { navigate('today'); if (!showHome) update(previous => ({ ...previous, step: 0 })) }} aria-label="Hybrid Coach home"><BrandMark className="cf-brand-mark" /><span className="cf-brand-name">Hybrid<span>Coach</span></span></button>
      {showHome && <nav className="cf-desktop-nav" aria-label="Primary">{(['today', 'plan', 'history'] as Tab[]).map(item => <button key={item} aria-current={tab === item && !sessionId ? 'page' : undefined} onClick={() => navigate(item)}>{item === 'today' ? 'Your week' : item === 'plan' ? 'Plan' : 'History'}</button>)}</nav>}
      <div className="cf-header-end"><span className="cf-save-indicator" role="status"><i className={saveStatus === 'failed' ? 'cf-dot-error' : ''} />{saveStatus === 'saving' ? 'Saving locally' : saveStatus === 'loading' ? 'Opening' : saveStatus === 'failed' ? 'Not saved' : 'Saved on device'}</span><button className="cf-icon-button" aria-label="Data and settings" onClick={() => setPanel('settings')}><Icon name="settings" /></button></div>
    </header>
    {state?.sample && <div className="cf-sample-banner"><span>EXAMPLE CAMPAIGN</span> Sample dates and training. Not your recorded baseline.</div>}
    {error && <div className="cf-error cf-global-error" role="alert"><strong>{error}</strong>{saveStatus === 'failed' && <div><p>Keep this page open. Export a copy before reloading if another tab changed the data.</p><button className="cf-button cf-secondary" onClick={exportData}>Export current copy</button><button className="cf-button cf-secondary" onClick={retrySave}>Retry save</button></div>}</div>}
    <main id="campaign-main" ref={main} tabIndex={-1} className={`cf-main${!showHome && tab !== 'history' ? ' cf-onboarding' : ''}`}>
      {!state ? <div className="cf-loading"><Icon name="lock" /><h1>{saveStatus === 'failed' ? 'Your data comes first.' : 'Making room for your training.'}</h1><p>{saveStatus === 'failed' ? 'Resolve the storage error to continue. Nothing has been reset.' : 'Opening your local notebook...'}</p></div>
        : !showHome && tab === 'history' ? <><button type="button" className="cf-button cf-secondary" onClick={() => navigate('today')}>Continue new plan setup</button><History state={state} /></>
          : !showHome ? <>{Boolean(state.pastPlans?.length) && <button type="button" className="cf-text-button" onClick={() => navigate('history')}>View training history</button>}<CampaignSetup state={state} update={update} onAI={() => setPanel('setup-ai')} connected={setupConnection !== undefined} onDisconnect={() => setSetupConnection(undefined)} /></>
          : session && week ? <Workout key={session.id} state={state} session={session} update={update} onBack={() => navigate('today')} onAction={action} onAI={() => setPanel('ai')} />
            : tab === 'today' ? <CalendarHome state={state} update={update} onSession={selectSession} onAction={action} onAI={() => setPanel('ai')} onNext={reviewNextWeek} />
              : tab === 'plan' ? <PlanOverview state={state} onAI={() => setPanel('ai')} onNext={reviewNextWeek} />
                : <History state={state} />}
    </main>
    {showHome && !session && <nav className="cf-bottom-nav" aria-label="Mobile navigation">{(['today', 'plan', 'history'] as Tab[]).map((item, index) => <button key={item} aria-current={tab === item ? 'page' : undefined} onClick={() => navigate(item)}><Icon name={index === 0 ? 'calendar' : index === 1 ? 'court' : 'history'} /><span>{item === 'today' ? 'Your week' : item === 'plan' ? 'Plan' : 'History'}</span></button>)}</nav>}
    <dialog className="cf-dialog" ref={dialog} onCancel={() => setPanel(null)} onClose={() => setPanel(null)}>
      {(panel === 'ai' || panel === 'setup-ai') && state && <CoachingWorkbench
        state={state} scope={coachingScope} config={setupConnection} onConnect={setSetupConnection}
        onConfirmEquipment={resources => {
          const next = confirmSetupEquipment(state, resources)
          return update(() => next)
        }}
        onRevise={state.setupComplete && state.draft.recommendedSetup ? () => setPanel('revision') : undefined}
        onCards={cards => { update(previous => ({ ...previous, cards: parseWorkoutCards(cards, previous.draft.program) })) }}
        onApply={(review, request, date) => update(previous => applyHandoff(previous, review, coachingScope, request, date))}
        onClose={() => setPanel(null)}
      />}
      {panel === 'next-week' && <section className="cf-stack"><h2>Review next week</h2><p>Your recorded training and fatigue skips inform the next week. No catch-up work is added.</p><p className="cf-muted">Approving makes this week read-only. Unlogged work stays unknown.</p><div className="cf-inline"><button className="cf-button cf-primary" onClick={() => { update(nextCampaignWeek); setPanel(null); navigate('today') }}>Approve next week <Icon name="arrow" /></button><button className="cf-button cf-secondary" onClick={() => setPanel(null)}>Back to my week</button></div></section>}
      {panel === 'revision' && state && <ProgrammingRevision state={state} config={setupConnection} onConnect={setSetupConnection}
        onApply={next => update(() => parseCampaign(next))} onClose={() => { setPanel(null); navigate('today') }} />}
      {panel === 'new-plan' && state?.setupComplete && <NewPlanConfirmation
        state={state} ready={saveStatus === 'saved'}
        onBackup={exportData} onCancel={() => setPanel('settings')}
        onConfirm={() => {
          if (saveStatus !== 'saved') return
          if (update(previous => startNewPlan(previous, addDays(currentMonday(), 7)))) {
            setPendingRestore(null); setNotice(''); setPanel(null); navigate('today')
          }
        }}
      />}
      {panel === 'leave-example' && <section className="cf-stack"><h2>Start your own plan?</h2><p>This clears the example plan and any entries you made in it. Export a backup first to keep them. Previous plans in training history stay saved.</p><div className="cf-inline"><button className="cf-button cf-secondary" onClick={exportData}>Export example</button><button className="cf-button cf-primary" onClick={() => { update(previous => ({ ...emptyCampaign(addDays(currentMonday(), 7)), step: 1, ...(previous.pastPlans ? { pastPlans: previous.pastPlans } : {}) })); setPanel(null); navigate('today') }}>Start my plan</button><button className="cf-text-button" onClick={() => setPanel('settings')}>Cancel</button></div></section>}
      {panel === 'settings' && <section className="cf-stack">
        <div className="cf-dialog-header"><h2>Data &amp; settings</h2><button className="cf-icon-button" aria-label="Close settings" onClick={() => setPanel(null)}><Icon name="close" /></button></div>
        <div className="cf-card"><Icon name="lock" /><h3>Stored in this browser</h3><p className="cf-muted">Clearing browser data removes your training records—keep a backup. AI connects only when you ask.</p><p className="cf-small">{offline.message}</p></div>
        <button className="cf-button cf-primary" onClick={exportData} disabled={!state}><Icon name="download" />Export backup</button>
        {state && <div className="cf-card"><h3>Equipment &amp; space</h3><p>{resourceLabels(state.draft.resources ?? resourcesForEquipment(state.draft.equipment)).join(', ') || 'No kit'}</p><p className="cf-small">{state.setupComplete ? 'Review next week to change future equipment. Saved workouts stay unchanged.' : 'Change this selection in Your routine.'}</p></div>}
        {state?.setupComplete && state.draft.recommendedSetup && <button type="button" className="cf-button cf-secondary" onClick={() => {
          update(previous => ({ ...previous, selectedWeek: previous.weeks.length - 1 }))
          setPanel('revision')
        }}>Review next week</button>}
        {state?.setupComplete && <button type="button" className="cf-button cf-secondary" disabled={saveStatus !== 'saved'} onClick={() => setPanel('new-plan')}>Start a new plan</button>}
        {Boolean(state?.pastPlans?.length) && <button type="button" className="cf-text-button" onClick={() => { setPanel(null); navigate('history') }}>View training history</button>}
        {setupConnection && <button type="button" className="cf-text-button" onClick={() => setSetupConnection(undefined)}>Disconnect AI</button>}
        {state?.sample && <button className="cf-button cf-secondary" onClick={() => setPanel('leave-example')}>Leave the example &amp; start my own</button>}
        <label className="cf-field">Restore backup<input type="file" accept=".json,application/json" onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          if (file.size > CAMPAIGN_BACKUP_LIMIT) { setNotice('Choose a backup smaller than 50 MB.'); return }
          void file.text().then(text => { setPendingRestore(parseCampaign(JSON.parse(text))); setNotice('') }).catch(error => { setPendingRestore(null); setNotice(errorMessage(error)) })
        }} /></label>
        {notice && <p role="alert" className="cf-error">{notice}</p>}
        {pendingRestore && <div className="cf-card"><h3>Replace saved data?</h3><p>This replaces your current plan and all retained training history with the backup. Export a copy first.</p><div className="cf-inline"><button className="cf-button cf-danger" onClick={() => { update(() => pendingRestore); setPendingRestore(null); setPanel(null); navigate('today') }}>Replace saved data</button><button className="cf-button cf-secondary" onClick={() => setPendingRestore(null)}>Cancel</button></div></div>}
      </section>}
    </dialog>
  </div>
}

function decodeSessionHash(): string | null {
  if (!window.location.hash.startsWith('#session/')) return null
  try { return decodeURIComponent(window.location.hash.slice(9)) } catch { return null }
}

export function CalendarHome({ state, update, onSession, onAction, onAI, onNext }: { state: CampaignState; update: Update; onSession: (id: string) => void; onAction: (action: CalendarAction) => void; onAI: () => void; onNext: () => void }) {
  const week = state.weeks[state.selectedWeek]
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const dragOrigin = useRef({ x: 0, y: 0 })
  const suppressClick = useRef(false)
  if (!week) return <p>No saved week. Complete setup to begin.</p>
  const { plan } = week
  const archived = state.selectedWeek < state.weeks.length - 1
  const isLocked = (session: Session) => archived || week.logs[session.id] !== undefined
    || Boolean(week.authored && (session.kind === 'commitment' || (session.kind === 'workout' && session.sourceCommitmentId)))
    || campaignSessionOnHold(state, session)
  const totalMinutes = plan.sessions.filter(session => week.logs[session.id]?.status !== 'skipped').reduce((sum, session) => sum + session.durationMin, 0)
  function drop(id: string, date: string) {
    const session = plan.sessions.find(item => item.id === id)
    if (session && session.date !== date) onAction({ type: 'move', sessionId: id, date, startTime: session.startTime ?? '08:00' })
    setDragging(null); setOver(null)
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!dragging) return
    if (Math.hypot(event.clientX - dragOrigin.current.x, event.clientY - dragOrigin.current.y) > 8) suppressClick.current = true
    if (event.clientY > window.innerHeight - 110) window.scrollBy(0, 12)
    else if (event.clientY < 80) window.scrollBy(0, -12)
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-calendar-date]')
    setOver(target?.dataset.calendarDate ?? null)
  }
  function pointerDrop(event: PointerEvent<HTMLButtonElement>) {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-calendar-date]')
    if (dragging && target?.dataset.calendarDate) drop(dragging, target.dataset.calendarDate)
    else { setDragging(null); setOver(null) }
  }
  function nativeDrop(event: DragEvent, date: string) { event.preventDefault(); drop(event.dataTransfer.getData('text/plain'), date) }
  return <div className="cf-home-layout">
    <section className="cf-week-main">
      <div className="cf-page-heading"><h1>Your week</h1><button type="button" className="cf-text-button" onClick={onAI}><Icon name="spark" size={18} />Ask AI (optional)</button></div>
      <div className="cf-campaign-strip"><span className="cf-campaign-symbol"><Icon name={goalIcons[state.draft.goalKind]} /></span><div><span className="cf-kicker">{state.draft.location || 'YOUR GOAL'}</span><strong>{state.draft.goalLabel}</strong></div><span className="cf-tag">WEEK {plan.weekIndex + 1}</span></div>
      <div className="cf-calendar-heading"><div><h2>{formatWeek(plan.weekStart).split(' – ')[0]} <span>— {formatDay(plan.weekStart, 6)}</span></h2><p>{plan.phase === 'base' && plan.weekIndex === 0 ? 'Finding your starting point' : `${plan.phase.charAt(0).toUpperCase() + plan.phase.slice(1)} phase`}<span className="cf-mid-dot">·</span>{Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m planned</p></div><div className="cf-inline"><button className="cf-icon-button" aria-label="Previous week" disabled={state.selectedWeek === 0} onClick={() => update(previous => ({ ...previous, selectedWeek: previous.selectedWeek - 1 }))}><Icon name="back" size={19} /></button><button className="cf-icon-button" aria-label={archived ? 'Next saved week' : 'Review next week'} onClick={() => archived ? update(previous => ({ ...previous, selectedWeek: previous.selectedWeek + 1 })) : onNext()}><Icon name="arrow" size={19} /></button></div></div>
      <div className="cf-calendar-rail">{DAY_NAMES.map((day, index) => <a href={`#day-${index}`} key={day} onClick={event => { event.preventDefault(); document.getElementById(`day-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}><span>{day.slice(0, 3)}</span><strong>{Number(addDays(plan.weekStart, index).slice(-2))}</strong><span className="cf-day-dots">{plan.sessions.filter(session => session.date === addDays(plan.weekStart, index)).map(session => <i key={session.id} className={`cf-dot-${sessionTheme(session)}`} />)}</span></a>)}</div>
      {archived && <p className="cf-small">Past week · read-only</p>}
      {plan.sessions.some(session => !isLocked(session)) && <p className="cf-calendar-help"><Icon name="move" size={14} />Drag to another day, or use Session options → Move.</p>}
      {week.changes.length > 1 && <div className="cf-adaptation" role="status"><Icon name="leaf" size={20} /><div><strong>Plan adapted</strong><p>{week.changes.at(-1)?.message}</p></div></div>}
      {!plan.safety.passed && <div className="cf-error" role="alert"><strong>{week.input.athlete.safetyHold || Object.values(week.logs).some(log => log.painFlag) ? 'Training is on hold.' : 'Review the remaining week before continuing.'}</strong>{plan.safety.violations.map(violation => <p key={violation.rule}>{violation.message}</p>)}</div>}
      {plan.safety.passed && (week.input.athlete.safetyHold || Object.values(week.logs).some(log => log.painFlag)) && <p className="cf-error" role="status">Pain or a health concern remains recorded. Review it before further training. Plan approval is not medical clearance and does not clear this report.</p>}
      {plan.omitted.length > 0 && <details className="cf-details cf-omission"><summary>{plan.omitted.length} session{plan.omitted.length === 1 ? '' : 's'} left out to respect your limits</summary>{plan.omitted.map(item => <p key={item.sessionId}>{item.reason}</p>)}</details>}
      <div className="cf-calendar" aria-label="Weekly training calendar">{DAY_NAMES.map((day, index) => {
        const date = addDays(plan.weekStart, index)
        const sessions = plan.sessions.filter(session => session.date === date)
        const removed = week.removed.filter(session => session.date === date)
        return <section id={`day-${index}`} key={day} data-calendar-date={date} className={`cf-calendar-day ${over === date ? 'cf-drop-target' : ''}`} aria-label={`${day} ${date}`} onDragOver={event => { event.preventDefault(); setOver(date) }} onDrop={event => nativeDrop(event, date)}><div className="cf-date-column"><span>{day.slice(0, 3)}</span><strong>{Number(date.slice(-2))}</strong></div><div className="cf-day-sessions">
          {sessions.map(session => {
            const log = week.logs[session.id]
            const stoppedEarly = week.feedback?.[session.id]?.outcome === 'finished_early'
            const locked = isLocked(session)
            return <div key={session.id} className={`cf-session cf-session-${sessionTheme(session)} ${dragging === session.id ? 'cf-dragging' : ''} ${log?.status === 'skipped' ? 'cf-session-skipped' : ''}`} draggable={!locked} onDragStart={event => { event.dataTransfer.setData('text/plain', session.id); setDragging(session.id) }} onDragEnd={() => { setDragging(null); setOver(null) }}>
              <button className="cf-session-open" onClick={() => onSession(session.id)}><span className="cf-sport-icon"><Icon name={sessionIcon(session)} /></span><span className="cf-session-copy"><span className="cf-session-type">{stoppedEarly ? 'STOPPED EARLY' : log?.status === 'completed' ? 'COMPLETED' : log?.status === 'partial' ? 'IN PROGRESS' : sessionType(session)}</span><strong>{sessionTitle(session)}</strong><span>{session.startTime ?? 'Time flexible'}<span className="cf-mid-dot">·</span>{session.durationMin} min{session.kind === 'strength' ? ` · ${session.strengthPrescription.length} lifts` : session.kind === 'workout' && session.discipline === 'strength' ? ` · ${session.blocks.length} exercises` : session.kind === 'run' || session.kind === 'conditioning' ? ' · Conversational' : ''}</span></span><Icon name={log?.status === 'completed' ? 'check' : 'chevron'} size={19} /></button>
              {!locked && <button className="cf-drag-handle" aria-label={`Drag ${sessionTitle(session)} on ${day}; or use Session options, Move`} onPointerDown={event => { event.preventDefault(); dragOrigin.current = { x: event.clientX, y: event.clientY }; suppressClick.current = false; event.currentTarget.setPointerCapture(event.pointerId); setDragging(session.id) }} onPointerMove={pointerMove} onPointerUp={pointerDrop} onPointerCancel={() => { setDragging(null); setOver(null) }} onClick={() => { if (!suppressClick.current) onSession(session.id); suppressClick.current = false }}><Icon name="move" size={17} /></button>}
            </div>
          })}
          {sessions.length === 0 && removed.length === 0 && <div className="cf-rest"><Icon name="leaf" size={19} /><span>Rest day</span></div>}
          {removed.map(session => <button className="cf-removed-session" key={session.id} onClick={() => onSession(session.id)}><span>{sessionTitle(session)}</span><span>{week.logs[session.id]?.skipReason === 'too_tired' ? 'Skipped · fatigue' : week.logs[session.id]?.status === 'skipped' ? 'Skipped · time' : 'Removed from plan'}</span></button>)}
        </div></section>
      })}</div>
    </section>
    <aside className="cf-home-aside"><div className="cf-aside-goal"><p className="cf-kicker">YOUR GOAL</p><h2>{state.draft.location || 'Your plan'}</h2><CourtArt /><p>{state.draft.goalLabel}</p><span>{state.draft.eventDate}</span></div><div className="cf-card cf-stack"><h3>Why this week</h3><p className="cf-muted">Your established training and recovery time guide the schedule.</p><details className="cf-details"><summary>Scheduling details</summary><p>{plan.intent}</p>{plan.warnings.map(warning => <p key={warning}>{warning}</p>)}</details></div></aside>
  </div>
}

export function Workout({ state, session, update, onBack, onAction, onAI }: { state: CampaignState; session: Session; update: Update; onBack: () => void; onAction: (action: CalendarAction) => void; onAI: () => void }) {
  const week = state.weeks[state.selectedWeek]
  const sessionDraft = campaignDraftForWeek(state)
  const log = week.logs[session.id]
  const feedback = week.feedback?.[session.id]
  const removed = week.removed.some(item => item.id === session.id)
  const [mode, setMode] = useState<'move' | 'skip' | 'delete' | null>(null)
  const content = workoutContent(state, session)
  const [moveDate, setMoveDate] = useState(session.date)
  const [moveTime, setMoveTime] = useState(session.startTime ?? '08:00')
  const [finishOutcome, setFinishOutcome] = useState<SessionFeedback['outcome'] | null>(null)
  const [swapBlock, setSwapBlock] = useState<number | null>(null)
  const held = campaignSessionOnHold(state, session)
  const advisory = policyForWeek(week).policy === 'ai-advisory'
  const archived = state.selectedWeek < state.weeks.length - 1
  const readOnly = removed || held || archived || log?.status === 'completed' || log?.status === 'skipped'
  const isStrength = session.kind === 'strength' || (session.kind === 'workout' && session.discipline === 'strength')
  const recordedSets = (log?.sets?.length ?? 0) + (log?.blockLogs ?? []).reduce((total, block) => total + (block.unit === 'reps' ? block.sets.length : 0), 0)
  const recordedTotals = log?.blockLogs?.filter(block => block.unit !== 'reps').length ?? 0
  return <section className="cf-workout">
    <div className="cf-workout-top"><button className="cf-text-button" onClick={onBack}><Icon name="back" size={19} />Your week</button><span className="cf-kicker">{session.date}</span></div>
    <div className={`cf-workout-hero cf-session-${sessionTheme(session)}`}><span className="cf-sport-icon"><Icon name={sessionIcon(session)} size={28} /></span><p className="cf-kicker">{removed ? 'REMOVED' : feedback?.outcome === 'finished_early' ? 'STOPPED EARLY' : log?.status === 'completed' ? 'WORKOUT COMPLETE' : sessionType(session)}</p><h1>{sessionTitle(session)}</h1><div className="cf-workout-meta"><span>{session.durationMin} <small>min planned</small></span>{isStrength && <span>{session.kind === 'strength' ? session.strengthPrescription.length : session.kind === 'workout' ? session.blocks.length : 0} <small>exercises</small></span>}<span>{session.startTime ?? 'Flexible'} <small>start</small></span></div></div>
    <details className="cf-workout-focus" open={!isStrength}><summary>Workout focus</summary><h2>{content.focus}</h2><ul>{content.cues.map(cue => <li key={cue}>{cue}</li>)}</ul><details className="cf-details"><summary>Scheduling details</summary><p>{session.reason}</p><p>Scheduling costs are estimates, not a measurement of your fatigue or readiness.</p></details></details>
    {held && <p className="cf-error" role="alert">A pain report has paused this workout. It remains a record, not a recommendation to train.</p>}
    {!held && (week.input.athlete.safetyHold || Object.values(week.logs).some(item => item.painFlag)) && <p className="cf-error" role="status">A pain or health report remains recorded for review. Logging actual work does not clear it or establish medical safety.</p>}
    {archived && <p className="cf-small">Past week · read-only</p>}
    {!log && !readOnly && <details className="cf-details"><summary>Session options</summary>
      <div className="cf-session-actions">{!(week.authored && (session.kind === 'commitment' || (session.kind === 'workout' && session.sourceCommitmentId))) && <button type="button" aria-expanded={mode === 'move'} onClick={() => setMode(mode === 'move' ? null : 'move')}><Icon name="move" size={18} />Move</button>}<button type="button" aria-expanded={mode === 'skip'} onClick={() => setMode(mode === 'skip' ? null : 'skip')}><Icon name="leaf" size={18} />Skip</button><button type="button" aria-expanded={mode === 'delete'} onClick={() => setMode(mode === 'delete' ? null : 'delete')}><Icon name="close" size={18} />Remove from week</button></div>
      {mode === 'move' && <form className="cf-card cf-stack" onSubmit={event => { event.preventDefault(); onAction({ type: 'move', sessionId: session.id, date: moveDate, startTime: moveTime }); setMode(null) }}><h3>Move workout</h3><p className="cf-muted">The app checks the new placement without adding work.</p><div className="cf-two"><label className="cf-field">Day<select value={moveDate} onChange={event => setMoveDate(event.target.value)}>{DAY_NAMES.map((day, index) => <option key={day} value={addDays(week.plan.weekStart, index)}>{day} · {formatDay(week.plan.weekStart, index)}</option>)}</select></label><label className="cf-field">Time<input type="time" required value={moveTime} onChange={event => setMoveTime(event.target.value)} /></label></div><button className="cf-button cf-primary">Check &amp; move</button></form>}
      {mode === 'skip' && <div className="cf-card cf-stack"><h3>Why skip this workout?</h3><button className="cf-choice cf-horizontal" onClick={() => { onAction({ type: 'skip', sessionId: session.id, reason: 'too_tired' }); setMode(null) }}><Icon name="leaf" /><div><strong>I'm fatigued</strong><span>{advisory ? 'Record fatigue for review. No automatic dose reduction.' : 'Reduce upcoming optional work. No catch-up.'}</span></div><Icon name="chevron" /></button><button className="cf-choice cf-horizontal" onClick={() => { onAction({ type: 'skip', sessionId: session.id, reason: 'life' }); setMode(null) }}><Icon name="calendar" /><div><strong>I don't have time</strong><span>Rearrange what's left. No catch-up.</span></div><Icon name="chevron" /></button></div>}
      {mode === 'delete' && <div className="cf-card cf-stack"><h3>Remove from this week?</h3><p>The change stays in history and is not treated as fatigue.</p><div className="cf-inline"><button className="cf-button cf-danger" onClick={() => { onAction({ type: 'delete', sessionId: session.id }); setMode(null) }}>Remove workout</button><button className="cf-button cf-secondary" onClick={() => setMode(null)}>Keep workout</button></div></div>}
    </details>}
    {removed && <div className="cf-adaptation"><Icon name="leaf" /><p>{log?.skipReason === 'too_tired'
      ? advisory ? 'Skipped for fatigue. Other prescriptions are unchanged; the report remains available for review.' : 'Skipped for fatigue. The remaining plan was adapted conservatively.'
      : log?.status === 'skipped' ? 'Skipped for time. No catch-up work was added.' : 'Removed from the calendar. The change is preserved.'}</p></div>}
    {session.kind === 'workout' && <>
      <TemplateWorkout state={state} session={session} readOnly={readOnly} update={update} onSwap={!readOnly && !session.sourceCommitmentId ? blockIndex => { setSwapBlock(blockIndex); setFinishOutcome(null) } : undefined} />
      {swapBlock !== null && !readOnly && <SwapExercise key={`${session.id}:${swapBlock}`} state={state} sessionId={session.id} blockIndex={swapBlock} update={update} onClose={() => setSwapBlock(null)} onReportPain={() => { setSwapBlock(null); setFinishOutcome('finished') }} />}
    </>}
    {session.kind === 'strength' && <div className="cf-lift-list">
      {!readOnly && <p className="cf-small">Record actual work. Suggestions and filled rows stay unlogged until you press Log.</p>}
      {session.strengthPrescription.toSorted((a, b) => Number(a.role === 'accessory') - Number(b.role === 'accessory')).map((prescription, exerciseIndex) => {
      const exercise = week.input.library.exercises.find(item => item.id === prescription.exerciseId)
      if (!exercise) throw new Error('This prescription references an exercise missing from its saved library.')
      const observation = state.draft.exercises.find(item => item.exerciseId === prescription.exerciseId)
      const savedSets = log?.sets?.filter(set => set.exerciseId === prescription.exerciseId) ?? []
      const previousSets = state.weeks.flatMap(item => item.plan.sessions.filter(previous => previous.id !== session.id && previous.date <= session.date).toSorted((a, b) => a.date.localeCompare(b.date)).flatMap(previous => item.logs[previous.id]?.painFlag ? [] : item.logs[previous.id]?.sets?.filter(set => set.exerciseId === prescription.exerciseId) ?? []))
      const last = previousSets.at(-1) ?? (observation ? { weightKg: observation.weightKg, reps: observation.reps, actualRPE: observation.actualRPE } : null)
      return <section key={prescription.exerciseId} className="cf-lift"><div className="cf-lift-heading"><span className="cf-exercise-number">{String(exerciseIndex + 1).padStart(2, '0')}</span><div><h2>{exerciseName(prescription.exerciseId)}</h2><p>{prescription.sets} {prescription.sets === 1 ? 'set' : 'sets'} × {prescription.reps} reps <span className="cf-mid-dot">·</span> RPE {prescription.targetRPE} target</p></div><span className="cf-tag">{prescription.role}</span></div>{!readOnly && last && <div className="cf-last-time"><Icon name="history" size={16} /><span>Last logged: {last.weightKg} kg × {last.reps} · RPE {last.actualRPE}</span></div>}
        <ExerciseGuide name={exercise.name} guide={exerciseGuidance(exercise, { goal: week.input.block.goal.label, slot: prescription.role })} />
        <div className="cf-set-labels"><span>SET</span><span>KG</span><span>REPS</span><span>RPE</span><span>LOG</span></div>
        {Array.from({ length: Math.max(prescription.sets, savedSets.length) }, (_, index) => {
          const saved = savedSets[index]
          const key = rowKey(session.id, prescription.exerciseId, index)
          const values = state.setDrafts[key] ?? { weight: saved ? String(saved.weightKg) : '', reps: saved ? String(saved.reps) : '', effort: saved ? String(saved.actualRPE) : '' }
          const change = (part: Partial<SetDraft>) => update(previous => ({ ...previous, setDrafts: { ...previous.setDrafts, [key]: { ...values, ...part } } }))
          return <form className={`cf-set-row ${saved ? 'cf-set-saved' : ''}`} key={index} onSubmit={event => { event.preventDefault(); update(previous => logCampaignSet(previous, session.id, prescription.exerciseId, index, values)) }}>
            <span>{index + 1}</span><input aria-label={`${exerciseName(prescription.exerciseId)} set ${index + 1} kilograms`} inputMode="decimal" type="number" min="0" max="500" step="any" placeholder={prescription.suggestedWeightKg === undefined ? '—' : String(prescription.suggestedWeightKg)} value={values.weight} disabled={readOnly} onChange={event => change({ weight: event.target.value })} required /><input aria-label={`${exerciseName(prescription.exerciseId)} set ${index + 1} reps`} inputMode="numeric" type="number" min="1" max="50" step="1" placeholder={String(prescription.reps)} value={values.reps} disabled={readOnly} onChange={event => change({ reps: event.target.value })} required /><input aria-label={`${exerciseName(prescription.exerciseId)} set ${index + 1} RPE`} inputMode="decimal" type="number" min="6" max="10" step="0.5" placeholder={String(prescription.targetRPE)} value={values.effort} disabled={readOnly} onChange={event => change({ effort: event.target.value })} required /><button type="submit" disabled={readOnly} aria-label={`${saved ? 'Update' : 'Log'} ${exerciseName(prescription.exerciseId)} set ${index + 1}`}><Icon name={saved ? 'check' : 'plus'} size={19} /></button>
          </form>
        })}
        {!readOnly && last && <button className="cf-text-button cf-copy-last" onClick={() => {
          const index = savedSets.length
          if (index >= prescription.sets) return
          update(previous => ({ ...previous, setDrafts: { ...previous.setDrafts, [rowKey(session.id, prescription.exerciseId, index)]: { weight: String(last.weightKg), reps: String(last.reps), effort: String(last.actualRPE) } } }))
        }}>Fill next set from last record <Icon name="arrow" size={15} /></button>}
      </section>
    })}</div>}
    <details className="cf-details"><summary>All notes</summary><WorkoutCards cards={state.cards ?? []} resources={sessionDraft.resources ?? resourcesForEquipment(sessionDraft.equipment)} program={sessionDraft.program} readOnly={readOnly} onChange={cards => { update(previous => ({ ...previous, cards: parseWorkoutCards(cards, previous.draft.program) })) }} /></details>
    {!removed && <div><button type="button" className="cf-text-button" onClick={onAI}><Icon name="spark" size={18} />Ask AI (optional)</button><p className="cf-small">Advice only. Exercise swaps require preview and approval.</p></div>}
    {feedback && <div className="cf-card cf-stack"><h2>Recorded feedback</h2><SessionFeedbackSummary feedback={feedback} durationMin={log?.actualDurationMin} plannedDurationMin={session.durationMin} effort={log?.actualEffort} /></div>}
    {finishOutcome && !readOnly && <WorkoutFeedbackForm session={session} outcome={finishOutcome} onCancel={() => setFinishOutcome(null)} onFinish={(duration, effort, pain, submitted) => {
      const saved = update(previous => finishWithFeedback(previous, session.id, duration, effort, pain, submitted))
      if (saved) setFinishOutcome(null)
      return saved
    }} />}
    <div className="cf-workout-footer"><span>{log?.status === 'completed' ? feedback?.outcome === 'finished_early' ? 'Stopped early · recorded' : 'Workout recorded' : `${recordedSets} set${recordedSets === 1 ? '' : 's'} recorded${recordedTotals ? ` · ${recordedTotals} block total${recordedTotals === 1 ? '' : 's'}` : ''}`}</span>{!readOnly ? !finishOutcome && <div className="cf-inline"><button className="cf-button cf-secondary" onClick={() => { setSwapBlock(null); setFinishOutcome('finished_early') }}>Finish early</button><button className="cf-button cf-primary" onClick={() => { setSwapBlock(null); setFinishOutcome('finished') }}>Finish workout <Icon name="check" size={19} /></button></div> : <button className="cf-button cf-secondary" onClick={onBack}>Back to week <Icon name="arrow" /></button>}</div>
  </section>
}

export function WorkoutFeedbackForm({ session, outcome, onFinish, onCancel }: {
  session: Session
  outcome: SessionFeedback['outcome']
  onFinish: (duration: number, effort: number, pain: boolean, feedback: SessionFeedback) => boolean
  onCancel: () => void
}) {
  const [duration, setDuration] = useState('')
  const [effort, setEffort] = useState('')
  const [pain, setPain] = useState(false)
  const [feeling, setFeeling] = useState<SessionFeedback['feeling']>(null)
  const [distanceKm, setDistanceKm] = useState('')
  const [averageHr, setAverageHr] = useState('')
  const [note, setNote] = useState('')
  const pace = duration.trim() && distanceKm.trim() ? formatSessionPace(Number(duration), Number(distanceKm)) : null
  return <form className="cf-card cf-stack" onSubmit={event => {
    event.preventDefault()
    if (!duration.trim() || !effort.trim()) return
    onFinish(Number(duration), Number(effort), pain, {
      version: 1, feeling, outcome,
      ...(distanceKm.trim() ? { distanceKm: Number(distanceKm) } : {}),
      ...(averageHr.trim() ? { averageHr: Number(averageHr) } : {}),
      ...(note.trim() ? { note } : {}),
    })
  }}>
    <h2>{outcome === 'finished_early' ? 'Record an early finish' : 'Finish workout'}</h2>
    <p>{outcome === 'finished_early' ? 'Record only what you did. Stopping early is not full completion and does not mean fatigue.' : 'Confirm your actual duration and effort. Unlogged work stays unknown.'}</p>
    <fieldset className="cf-stack"><legend>How did it feel? (optional)</legend><div className="cf-inline">{(Object.keys(SESSION_FEELING_LABELS) as Array<keyof typeof SESSION_FEELING_LABELS>).map(choice =>
      <button key={choice} type="button" className={`cf-button ${feeling === choice ? 'cf-primary' : 'cf-secondary'}`} aria-pressed={feeling === choice} onClick={() => setFeeling(feeling === choice ? null : choice)}>{SESSION_FEELING_LABELS[choice]}</button>,
    )}</div><p className="cf-small">{feeling === null ? 'Feeling not recorded.' : 'Tap the selected feeling again to clear it.'}</p></fieldset>
    <div className="cf-two">
      <label className="cf-field">Actual duration (minutes)<input type="number" inputMode="decimal" min="1" max="1440" step="any" value={duration} onChange={event => setDuration(event.target.value)} required /></label>
      <label className="cf-field">Whole-session effort (0–10)<input type="number" inputMode="decimal" min="0" max="10" step="any" value={effort} onChange={event => setEffort(event.target.value)} required /></label>
    </div>
    <p className="cf-small">{session.durationMin} min planned. Rate effort separately from how it felt.</p>
    {session.discipline === 'run' && <div className="cf-stack">
      <div className="cf-two">
        <label className="cf-field">Distance (km, optional)<input type="number" inputMode="decimal" min="0" step="any" value={distanceKm} onChange={event => setDistanceKm(event.target.value)} /></label>
        <label className="cf-field">Average heart rate (bpm, optional)<input type="number" inputMode="decimal" min="0" max="300" step="any" value={averageHr} onChange={event => setAverageHr(event.target.value)} /></label>
      </div>
      <p className="cf-small">{pace ? `Derived pace: ${pace}, using your recorded duration and distance (not a moving-pace measurement).` : 'Distance and heart rate can stay blank. No watch or heart-rate reading is required.'}</p>
    </div>}
    <label className="cf-field">Anything useful to remember? (optional)<textarea rows={2} maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="For example, stopped for time or a movement felt awkward." /></label>
    <label className="cf-check"><input type="checkbox" checked={pain} onChange={event => setPain(event.target.checked)} /><span>I experienced pain during or after this workout.</span></label>
    {pain && <p className="cf-error">Pain pauses further planning. This app does not provide return-to-training advice.</p>}
    <div className="cf-inline"><button type="submit" className="cf-button cf-primary">{outcome === 'finished_early' ? 'Confirm stopped early' : 'Confirm completion'} <Icon name="check" /></button><button type="button" className="cf-button cf-secondary" onClick={onCancel}>Keep logging</button></div>
  </form>
}

function SessionFeedbackSummary({ feedback, durationMin, plannedDurationMin, effort }: {
  feedback: SessionFeedback
  durationMin?: number
  plannedDurationMin: number
  effort?: number
}) {
  const pace = formatSessionPace(durationMin, feedback.distanceKm)
  return <div className="cf-stack">
    <p>{feedback.feeling === null ? 'Feeling not recorded' : SESSION_FEELING_LABELS[feedback.feeling]}</p>
    <p className="cf-small">{plannedDurationMin} min planned · {durationMin === undefined ? 'Actual duration unknown' : `${durationMin} min recorded`}{effort !== undefined && ` · Effort ${effort}/10`}</p>
    {feedback.distanceKm !== undefined && <p className="cf-small">{feedback.distanceKm} km recorded{pace ? ` · ${pace} derived from recorded duration/distance` : ''}</p>}
    {feedback.averageHr !== undefined && <p className="cf-small">Average heart rate: {feedback.averageHr} bpm</p>}
    {feedback.note && <p>{feedback.note}</p>}
  </div>
}

export function PlanOverview({ state, onAI, onNext }: { state: CampaignState; onAI: () => void; onNext: () => void }) {
  const week = state.weeks[state.selectedWeek]
  if (!week) return null
  const block = week.input.block
  return <section className="cf-plan-overview cf-stack">
    <div className="cf-page-heading"><h1>Your plan</h1></div>
    <div className="cf-goal-summary"><Icon name="court" /><div><span>{state.draft.location || 'YOUR GOAL'}</span><h2>{block.goal.label}</h2><p>{block.startDate} → {block.goal.peakDate}</p></div></div>
    <div className="cf-chip-list">{state.draft.priorities.map(quality => <span key={quality}>{qualityLabels[quality]}</span>)}</div>
    <p className="cf-small">Phases guide scheduling. No automatic training increases.</p>
    <div className="cf-phase-timeline">{block.phases.map(phase => <div className={week.plan.weekIndex >= phase.startWeekIndex && week.plan.weekIndex <= phase.endWeekIndex ? 'cf-phase-current' : ''} key={phase.startWeekIndex}><span className="cf-phase-node" /><div><p className="cf-kicker">WEEK {phase.startWeekIndex + 1}{phase.endWeekIndex !== phase.startWeekIndex ? ` — ${phase.endWeekIndex + 1}` : ''}</p><h3>{phase.kind.charAt(0).toUpperCase() + phase.kind.slice(1)}</h3></div></div>)}</div>
    <button className="cf-button cf-primary" onClick={onNext}>Review next week <Icon name="arrow" /></button>
    <button type="button" className="cf-text-button" onClick={onAI}><Icon name="spark" size={18} />Ask AI (optional)</button>
    <details className="cf-details"><summary>What this plan supports</summary>{policyForWeek(week).policy === 'ai-advisory'
      ? <><p>You and AI decide the training. The app checks supported data, equipment and immutable recorded work; training-policy warnings are advisory.</p><p>Pain, fatigue and baseline reports remain available for review. Approval is not medical clearance and does not clear those facts.</p></>
      : <><p>Existing practice, easy running and familiar lifts within your baseline. Phases are an outline, not a guaranteed competition peak.</p><p>Fatigue skips reduce optional work; time skips do not imply fatigue. Future changes preserve logged sets. Pain blocks further planning.</p></>}</details>
  </section>
}

export function History({ state }: { state: CampaignState }) {
  const records = trainingRecords(state)
  const weeksByLog = new Map([...(state.pastPlans ?? []), state].flatMap(plan => plan.weeks.flatMap(week =>
    Object.values(week.logs).map(log => [log, week] as const),
  )))
  return <section className="cf-history cf-stack">
    <div className="cf-page-heading"><h1>Training history</h1></div>
    {records.length === 0 ? <div className="cf-empty-state"><Icon name="history" size={36} /><h2>No recorded workouts yet</h2><p>Log a workout or record a skip from your week.</p></div> : records.map(({ key, session, log, library, goalLabel, sample, previousPlan }) => {
      const sets = [...(log.sets ?? []), ...(log.blockLogs ?? []).flatMap(item => item.unit === 'reps' ? item.sets : [])]
      const savedWeek = weeksByLog.get(log)
      const feedback = savedWeek?.feedback?.[session.id]
      return <article className="cf-history-entry" key={key}>
        {previousPlan && <p className="cf-small">{sample ? 'Example plan' : 'Previous plan'}: {goalLabel} · Read-only record</p>}
        <div className="cf-history-heading"><span className={`cf-sport-icon cf-session-${session.kind}`}><Icon name={sessionIcon(session)} /></span><div><span className="cf-kicker">{session.date}</span><h2>{sessionTitle(session)}</h2></div><span className="cf-tag">{log.status === 'skipped' ? log.skipReason === 'too_tired' ? 'Fatigue skip' : 'Time skip' : feedback?.outcome === 'finished_early' ? 'Stopped early' : log.status}</span></div>
        {sets.map((set, index) => <div className="cf-history-set" key={index}><span>{exerciseName(set.exerciseId, library)}</span><strong>{set.weightKg} <small>kg</small> × {set.reps}</strong><span>RPE {set.actualRPE}</span></div>)}
        {log.blockLogs?.map(item => item.unit === 'reps' ? null : <div className="cf-history-set" key={`block-${item.blockIndex}`}>
          <span>{item.unit === 'seconds' ? exerciseName(item.exerciseId, library)
            : library.exercises.find(exercise => exercise.id === item.drillId)?.name
              ?? savedWeek?.input.athlete.program?.customSportDrills?.find(drill => drill.id === item.drillId)?.name
              ?? SUPPORTED_SPORT_DRILLS.find(drill => drill.id === item.drillId)?.label ?? item.drillId}</span>
          <strong>{item.unit === 'seconds' ? `${item.seconds} seconds` : `${item.throws} throws`}</strong>
          {item.unit === 'seconds' && item.weightKg !== undefined && <span>{item.weightKg} kg carried</span>}
        </div>)}
        {feedback ? <SessionFeedbackSummary feedback={feedback} durationMin={log.actualDurationMin} plannedDurationMin={session.durationMin} effort={log.actualEffort} />
          : log.actualDurationMin !== undefined && <p className="cf-small">{log.actualDurationMin} min recorded{log.actualEffort !== undefined ? ` · Effort ${log.actualEffort}/10` : ''}</p>}
        {log.notes && log.notes !== feedback?.note && <p className="cf-small">{log.notes}</p>}
        {log.painFlag && <p className="cf-error">{previousPlan ? 'Pain was reported in this session. A new plan is not medical clearance.' : 'Pain reported and retained for review. Plan approval is not medical clearance.'}</p>}
      </article>
    })}
    <details className="cf-details"><summary>Calendar changes</summary>{state.weeks.flatMap(week => week.changes).length === 0 ? <p>No changes yet.</p> : state.weeks.flatMap(week => week.changes).map(change => <p key={change.id}>{change.message}</p>)}</details>
  </section>
}
