import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { AssistantConfig } from './assistant.ts'
import { buildHandoff, exportHandoff, parseHandoffReply, requestHandoff, supportsFullWeekHandoff } from './handoff.ts'
import type { HandoffReview, HandoffScope } from './handoff.ts'
import { resourcesForEquipment } from './equipment.ts'
import type { ResourceId } from './equipment.ts'
import EquipmentPicker from './EquipmentPicker.tsx'
import { GoalProposalReview } from './SetupAssistantPanel.tsx'
import { validateSetupDate } from './setup-dates.ts'
import type { CampaignState } from './types.ts'
import type { WorkoutCard } from './workout-cards.ts'
import WorkoutCards from './WorkoutCards.tsx'
import CustomExerciseCards from './CustomExerciseCards.tsx'
import { stageCustomExercises, stageCustomSportDrills } from './custom-exercises.ts'
import FullWeekProposalReview from './full-week-handoff.tsx'

interface Props {
  state: CampaignState
  scope: HandoffScope
  config?: AssistantConfig
  onConnect: (config: AssistantConfig | undefined) => void
  onApply: (review: HandoffReview, request: string, confirmedDate?: string) => boolean
  onCards: (cards: WorkoutCard[]) => void
  onClose: () => void
  onConfirmEquipment: (resources: readonly ResourceId[]) => boolean
  onRevise?: () => void
}

export default function CoachingWorkbench({ state, scope, config, onConnect, onApply, onCards, onClose, onConfirmEquipment, onRevise }: Props) {
  const id = useId()
  const fullWeek = supportsFullWeekHandoff(state, scope)
  const [method, setMethod] = useState<'builtin' | 'chat' | 'api'>(fullWeek ? 'chat' : config ? 'api' : state.setupComplete ? 'builtin' : 'chat')
  const [request, setRequest] = useState('')
  const [pasted, setPasted] = useState('')
  const [review, setReview] = useState<HandoffReview | null>(null)
  const [customApproval, setCustomApproval] = useState('')
  const [trainingApproval, setTrainingApproval] = useState('')
  const [drillApproval, setDrillApproval] = useState('')
  const [includeHistory, setIncludeHistory] = useState(scope.includeTrainingHistory === true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [endpoint, setEndpoint] = useState(config?.endpoint ?? '')
  const [model, setModel] = useState(config?.model ?? '')
  const [apiKey, setApiKey] = useState(config?.apiKey ?? '')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [equipment, setEquipment] = useState(() => state.draft.resources ?? resourcesForEquipment(state.draft.equipment))
  const controller = useRef<AbortController | null>(null)
  const resultElement = useRef<HTMLDivElement>(null)
  let unavailable = ''
  let contextId = ''
  let brief = ''
  let catalog: ReturnType<typeof buildHandoff>['context']['catalog'] | undefined
  let exerciseNames: Record<string, string> = {}
  const effectiveScope = { ...scope }
  if (fullWeek && includeHistory) effectiveScope.includeTrainingHistory = true
  else if (fullWeek) delete effectiveScope.includeTrainingHistory
  try {
    const handoff = buildHandoff(state, effectiveScope, request)
    catalog = handoff.context.catalog
    exerciseNames = Object.fromEntries(handoff.context.allowedCatalog.map(item => [item.id, item.name]))
    contextId = JSON.stringify([handoff.contextId, request])
    brief = exportHandoff(state, effectiveScope, request)
  } catch (cause) { unavailable = cause instanceof Error ? cause.message : 'Review your setup before sharing a brief.' }
  const currentContext = useRef(contextId)
  const [previousContext, setPreviousContext] = useState(contextId)
  if (contextId !== previousContext) {
    setPreviousContext(contextId)
    setReview(null)
    setConsent(false)
    setBusy(false)
    setError('')
    setNotice('')
  }
  useLayoutEffect(() => {
    currentContext.current = contextId
    return () => { controller.current?.abort(); controller.current = null }
  }, [contextId])
  useEffect(() => { if (review) resultElement.current?.scrollIntoView({ block: 'start' }) }, [review])
  const resources = state.draft.resources ?? resourcesForEquipment(state.draft.equipment)
  const customExercises = review?.reply.customExercises ?? []
  const approvalKey = customExercises.length ? JSON.stringify([contextId, customExercises]) : ''
  const customApproved = !customExercises.length || customApproval === approvalKey
  const customSportDrills = review?.reply.version === 3 ? review.reply.customSportDrills : []
  const drillApprovalKey = customSportDrills.length ? JSON.stringify([contextId, customSportDrills]) : ''
  const drillsApproved = !customSportDrills.length || drillApproval === drillApprovalKey
  const currentTraining = review?.reply.version === 3 ? review.reply.currentTraining : null
  const trainingApprovalKey = currentTraining ? JSON.stringify([contextId, currentTraining]) : ''
  const trainingApproved = !currentTraining || trainingApproval === trainingApprovalKey
  const proposedWeek = review?.reply.version === 3 ? review.reply.week : null
  const reviewDraft = stageCustomSportDrills(stageCustomExercises(state.draft, customExercises), customSportDrills)
  const canKeepReview = Boolean(scope.weekReview && review?.reply.summary)
  const hasChanges = Boolean(review?.reply.proposal || review?.reply.cards.length || customExercises.length
    || customSportDrills.length || currentTraining || proposedWeek)

  function parseReply(text: string) {
    setCustomApproval('')
    setTrainingApproval('')
    setDrillApproval('')
    setReview(null)
    setError('')
    setNotice('')
    try { setReview(parseHandoffReply(text, state, effectiveScope, request)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The reply could not be read. Nothing was applied.') }
  }
  async function askApi() {
    if (controller.current) return
    const active = new AbortController()
    controller.current = active
    setBusy(true)
    setReview(null)
    setCustomApproval('')
    setTrainingApproval('')
    setDrillApproval('')
    setError('')
    const accepted = consent
    setConsent(false)
    try {
      const connection = { endpoint, model, apiKey }
      const next = await requestHandoff(state, effectiveScope, request, connection, accepted, active.signal)
      if (controller.current === active && currentContext.current === contextId) {
        setReview(next)
        onConnect(connection)
      }
    } catch (cause) {
      if (controller.current === active) setError(cause instanceof Error ? cause.message : 'The request failed. Nothing was applied.')
    } finally {
      if (controller.current === active) { controller.current = null; setBusy(false) }
    }
  }
  function apply() {
    if (!review) return
    if (!customApproved) { setError('Review the new movements and confirm their categories before applying.'); return }
    if (!trainingApproved) { setError('Check and acknowledge the imported current-training facts before applying.'); return }
    if (!drillsApproved) { setError('Review the custom throwing drills and acknowledge their equipment and practice profile before applying.'); return }
    try {
      const date = !state.setupComplete && scope.purpose === 'interpret_goal' && state.draft.eventDate
        ? validateSetupDate(state.draft.startDate, state.draft.eventDate) : undefined
      if (onApply({ ...review,
        ...(currentTraining ? { currentTrainingAcknowledged: true } : {}),
        ...(customSportDrills.length ? { customSportDrillsAcknowledged: true } : {}),
      }, request, date)) onClose()
      else setError('The reviewed changes were not applied. Resolve the reported issue before trying again.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Review the suggestions before applying.') }
  }
  const changeConfig = () => { setConsent(false); setError('') }

  return <section className="cf-stack">
    <header className="cf-dialog-header"><h2>{method === 'builtin' ? 'Plan without AI' : fullWeek ? 'Plan your week with AI' : scope.weekReview ? 'Review your week' : 'Shape your sessions'}</h2><button type="button" className="cf-button cf-secondary" onClick={onClose}>Close</button></header>
    <div className="cf-inline" role="group" aria-label="How to customise">
      {([['builtin', 'Built-in'], ['chat', 'Use my AI chat'], ['api', 'Connect API']] as const).map(([value, label]) => <button className={`cf-button ${method === value ? 'cf-primary' : 'cf-secondary'}`} type="button" key={value} disabled={busy} aria-pressed={method === value} onClick={() => { setMethod(value); setError(''); setNotice('') }}>{label}</button>)}
    </div>
    {method !== 'builtin' && <p className="cf-small">{fullWeek
      ? 'AI chat is recommended. Review facts, movements and amounts; the app checks the week before approval.'
      : 'You approve new movements and equipment. The app sets quantities, loads and placement.'}
      {fullWeek && !scope.weekReview && !state.draft.confirmed && <span role="status"> Confirm recent training—not just your desired routine.</span>}
    </p>}
    {state.setupComplete && <div className="cf-card cf-stack">
      <p>Your current week is locked. This workspace edits notes, not its exercise lineup. {state.draft.program ? 'Changes to the lineup start next week.' : 'This plan still uses the original exercise library.'}</p>
      {onRevise && <button type="button" className="cf-button cf-secondary" disabled={busy} onClick={onRevise}>Change next week's exercises</button>}
    </div>}
    {method === 'builtin' ? <>
      <p>Return to your review to choose, create or swap exercises.</p>
      <button type="button" className="cf-button cf-primary" onClick={onClose}>Continue without AI</button>
      <details className="cf-details"><summary>Notes</summary><WorkoutCards cards={state.cards ?? []} resources={resources} program={state.draft.program} onChange={onCards} /></details>
    </> : !state.setupComplete && !state.draft.program ? <div className="cf-stack">
      <h3>Use the expanded exercise library</h3>
      <p>This draft started with the older exercise list. Confirm your equipment to include kettlebell movements, carries and execution styles where supported. Your goal, dates and notes stay; review the refreshed exercise lineup before building.</p>
      <EquipmentPicker value={equipment} onChange={setEquipment} />
      <button type="button" className="cf-button cf-primary" onClick={() => {
        try {
          if (onConfirmEquipment(equipment)) setError('')
          else setError('The equipment confirmation was not saved. Resolve the local save issue before continuing.')
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Review the equipment needed for your exercise lineup.') }
      }}>Use this equipment & continue</button>
    </div> : unavailable ? <p role="status">{unavailable}</p> : <>
      <details className="cf-details"><summary>{request.trim() ? 'Request added' : 'Add a request'}</summary>
        <label className="cf-field">Your request (optional)<textarea maxLength={500} rows={2} value={request} disabled={busy} placeholder={scope.weekReview ? 'What felt useful or difficult? What should we change next week?' : fullWeek ? 'Anything else to account for in your week?' : 'Keep the movements I enjoy; suggest an exercise using my available equipment.'} onChange={event => setRequest(event.target.value)} /></label>
      </details>
      {scope.weekReview && <p className="cf-small">Includes this week's actuals, gaps, skips, notes and health flags. Review before sharing; earlier weeks stay unchanged.</p>}
      {fullWeek && scope.weekReview && <p className="cf-small">Uses your confirmed training baseline; approving a week does not replace it.</p>}
      {fullWeek && state.draft.trainingHistory?.confirmed && <label className="cf-check"><input type="checkbox" disabled={busy} checked={includeHistory} onChange={event => setIncludeHistory(event.target.checked)} />
        <span>Include my reviewed activity records and summary. No titles, locations or original file. Gaps remain unknown.</span>
      </label>}
      <details className="cf-details" open={error.includes('Clipboard')}><summary>What I'm sharing</summary>
        <p>Only the fields below are shared. {scope.weekReview ? "Includes this week's actual training, notes and health flags." : includeHistory ? 'Includes your selected activity history.' : 'No actual training logs.'} No original files, activity titles, locations, prior plan records, credentials or full backup. Provider privacy policies apply.</p>
        {catalog && <p className="cf-small">{catalog.label}: {catalog.availableExerciseCount} equipped movements.
          {state.setupComplete ? ' Current-week identities stay unchanged.' : fullWeek
            ? ` A full week may use any equipped library identity, including more than seven movements. Only the optional built-in routine selection stays at ${catalog.minimumSelection}-${catalog.maximumSelection}.`
            : ` Choose ${catalog.minimumSelection}-${catalog.maximumSelection} for your active routine; this is not the library size.`}
        </p>}
        <p className="cf-small">Changed your setup? Copy a fresh brief into the same chat. AI cannot see app updates on its own.</p>
        <p className="cf-small">If copying fails, select this preview and copy it manually.</p>
        <textarea className="cf-assistant-payload" aria-label="Coaching brief preview" readOnly rows={8} value={brief} onFocus={event => event.currentTarget.select()} />
      </details>
      {method === 'chat' ? <>
        <p><strong>1. Copy brief</strong> → <strong>2. Discuss in chat</strong> → <strong>3. Paste final reply</strong></p>
        <p className="cf-small"><a href="https://chatgpt.com" target="_blank" rel="noopener noreferrer">ChatGPT</a> · <a href="https://claude.ai" target="_blank" rel="noopener noreferrer">Claude</a> · <a href="https://duck.ai" target="_blank" rel="noopener noreferrer">Duck.ai</a>. Free limits, account requirements and privacy policies vary. No API key needed.</p>
        <div className="cf-inline">
          <button type="button" className="cf-button cf-primary" onClick={() => {
            setError('')
            if (!navigator.clipboard) { setError('Clipboard unavailable. Select and copy the brief from the preview above.'); return }
            void navigator.clipboard.writeText(brief).then(() => setNotice('Brief copied. Paste it into your AI chat.')).catch(() => setError('Clipboard permission was denied. Select and copy the brief from the preview above.'))
          }}>Copy brief</button>
        </div>
        <label className="cf-field" htmlFor={`${id}-reply`}>Paste final reply<textarea id={`${id}-reply`} rows={4} value={pasted} onChange={event => { setPasted(event.target.value); setReview(null); setError('') }} placeholder="Ask your chat for the final app reply. Paste its JSON block here, not the conversation." /></label>
        <button type="button" className="cf-button cf-primary" disabled={!pasted.trim()} onClick={() => parseReply(pasted)}>Review reply</button>
      </> : <>
        <details className="cf-details" open={!config}><summary>{config ? `Connection: ${config.model}` : 'Set up your API connection'}</summary><div className="cf-stack">
          <label className="cf-field">Local or HTTPS API endpoint<input type="url" value={endpoint} maxLength={2048} disabled={busy} onChange={event => { setEndpoint(event.target.value); changeConfig() }} autoComplete="off" placeholder="https://provider.example/v1/chat/completions" /></label>
          <label className="cf-field">Model<input value={model} maxLength={128} disabled={busy} onChange={event => { setModel(event.target.value); changeConfig() }} /></label>
          <label className="cf-field">API key (if required)<input type="password" value={apiKey} maxLength={4096} disabled={busy} autoComplete="off" onChange={event => { setApiKey(event.target.value); changeConfig() }} /></label>
          <p className="cf-small">Use a private browser for real keys; password masking does not hide them from browser automation.</p>
        </div></details>
        <p className="cf-small">Credentials stay in this tab, including after setup. Disconnect or reload clears them. Never in backups.</p>
        <label className="cf-check"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />Send this brief, including selected training context{scope.weekReview ? ", this week's actual logs, notes and health flags" : ''}{includeHistory ? ', reviewed activity history' : ''} and cards, to my endpoint.</label>
        <button type="button" className="cf-button cf-primary" disabled={busy || !consent || !endpoint.trim() || !model.trim()} onClick={() => void askApi()}>{busy ? 'Requesting suggestions...' : 'Request suggestions'}</button>
        {busy && <button type="button" className="cf-button cf-secondary" onClick={() => controller.current?.abort()}>Cancel request</button>}
        {config && <button type="button" className="cf-text-button" disabled={busy} onClick={() => { onConnect(undefined); setEndpoint(''); setModel(''); setApiKey(''); setConsent(false) }}>Disconnect AI</button>}
      </>}
      {notice && <p role="status">{notice}</p>}
      <div ref={resultElement} aria-live="polite">{review && <div className="cf-stack">
        {review.summaryShortened && <p role="status" className="cf-small">AI explanation shortened; exercises and cards are unchanged. Keep the original reply for the full explanation.</p>}
        {review.reply.summary && <div className="cf-card"><h3>Your AI's review</h3><p>{review.reply.summary}</p><p className="cf-small">AI-authored context, not a verified assessment or an instruction to change training quantities.</p></div>}
        {customExercises.length > 0 && <>
          <CustomExerciseCards exercises={customExercises} />
          {!proposedWeek && customExercises.some(exercise => !review.reply.proposal?.exerciseIds.includes(exercise.id)) && <p className="cf-small">Exercises not included in the proposed lineup are saved to your library, not scheduled. You can select them in the review.</p>}
          <label className="cf-check"><input type="checkbox" checked={customApproved} onChange={event => setCustomApproval(event.target.checked ? approvalKey : '')} />
            <span>I have reviewed these controlled movements, their categories and required equipment. They are not ballistic, rehabilitation or unfamiliar high-skill work. The app does not assess technique.</span>
          </label>
        </>}
        {review.reply.proposal && <GoalProposalReview draft={reviewDraft} proposal={review.reply.proposal} purpose={scope.purpose} dateIssue={review.dateIssue} />}
        {review.reply.version === 3 && <FullWeekProposalReview reply={review.reply} acknowledged={trainingApproved} onAcknowledge={value => setTrainingApproval(value ? trainingApprovalKey : '')}
          drillsAcknowledged={drillsApproved} onAcknowledgeDrills={value => setDrillApproval(value ? drillApprovalKey : '')}
          exerciseNames={{ ...exerciseNames, ...Object.fromEntries([...customExercises, ...customSportDrills].map(exercise => [exercise.id, exercise.name])) }} />}
        {review.reply.cards.length > 0 && <><h3>Reference cards to import</h3><p className="cf-small">Matching IDs replace the shown local card; other cards are kept. All AI prose stays an unverified draft, not workout instructions.</p>
          {review.reply.cards.map(card => <p key={card.id} className="cf-small">{state.cards?.some(old => old.id === card.id) ? 'Replace' : 'Add'}: {card.title}</p>)}
          <WorkoutCards cards={review.reply.cards} resources={resources} program={reviewDraft.program} onChange={() => {}} readOnly />
        </>}
        {!hasChanges && <p>{fullWeek ? 'No training changes proposed. Continue the assessment in chat if current facts are still unknown.' : 'No changes proposed.'}</p>}
        <button type="button" className="cf-button cf-primary" disabled={busy || !customApproved || !trainingApproved || !drillsApproved || (!hasChanges && !canKeepReview)} onClick={apply}>
          {proposedWeek ? 'Continue to week check' : currentTraining ? 'Apply reviewed training facts'
            : !hasChanges && canKeepReview ? 'Keep review notes'
            : review.reply.proposal && scope.purpose === 'interpret_goal'
            ? state.draft.eventDate || review.reply.proposal.eventDate ? 'Confirm date & apply suggestions' : 'Apply suggestions, then choose date'
            : 'Apply reviewed changes'}
        </button>
      </div>}</div>
    </>}
    {error && <div className="cf-stack"><p className="cf-error" role="alert">{error}</p>{fullWeek && method === 'chat' && <button type="button" className="cf-button cf-secondary" onClick={() => {
      if (!navigator.clipboard) { setNotice('Clipboard unavailable. Copy the error above and paste the latest brief into your chat.'); return }
      void navigator.clipboard.writeText(`The app rejected the reply: ${error}\nNothing was applied. Use the latest brief and its exact schema, keep all intended sessions visible, and return a corrected final JSON reply. Do not change baseline facts unless I explicitly reported a correction.`)
        .then(() => setNotice('Fix message copied. Paste it with the latest brief into your chat.'))
        .catch(() => setNotice('Clipboard permission denied. Copy the error above into your chat.'))
    }}>Copy fix message for chat</button>}</div>}
  </section>
}
