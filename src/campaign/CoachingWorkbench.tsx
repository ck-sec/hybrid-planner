import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { AssistantConfig } from './assistant.ts'
import { buildHandoff, exportHandoff, HANDOFF_LIMIT, parseHandoffReply, requestHandoff } from './handoff.ts'
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
import { stageCustomExercises } from './custom-exercises.ts'

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
  const [method, setMethod] = useState<'builtin' | 'chat' | 'api'>(config ? 'api' : state.setupComplete ? 'builtin' : 'chat')
  const [request, setRequest] = useState('')
  const [pasted, setPasted] = useState('')
  const [review, setReview] = useState<HandoffReview | null>(null)
  const [customApproval, setCustomApproval] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [endpoint, setEndpoint] = useState(config?.endpoint ?? '')
  const [model, setModel] = useState(config?.model ?? '')
  const [apiKey, setApiKey] = useState(config?.apiKey ?? '')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [equipment, setEquipment] = useState(() => state.draft.resources ?? resourcesForEquipment(state.draft.equipment))
  const controller = useRef<AbortController | null>(null)
  const importSequence = useRef(0)
  const resultElement = useRef<HTMLDivElement>(null)
  let unavailable = ''
  let contextId = ''
  let brief = ''
  let catalog: ReturnType<typeof buildHandoff>['context']['catalog'] | undefined
  try {
    const handoff = buildHandoff(state, scope, request)
    catalog = handoff.context.catalog
    contextId = JSON.stringify([handoff.contextId, request])
    brief = exportHandoff(state, scope, request)
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
    const sequence = ++importSequence.current
    return () => { controller.current?.abort(); controller.current = null; importSequence.current = -sequence }
  }, [contextId])
  useEffect(() => { if (review) resultElement.current?.scrollIntoView({ block: 'start' }) }, [review])
  const resources = state.draft.resources ?? resourcesForEquipment(state.draft.equipment)
  const customExercises = review?.reply.customExercises ?? []
  const approvalKey = customExercises.length ? JSON.stringify([contextId, customExercises]) : ''
  const customApproved = !customExercises.length || customApproval === approvalKey
  const reviewDraft = customExercises.length ? stageCustomExercises(state.draft, customExercises) : state.draft
  const canKeepReview = Boolean(scope.weekReview && review?.reply.summary)

  function parseReply(text: string) {
    setCustomApproval('')
    setReview(null)
    setError('')
    setNotice('')
    try { setReview(parseHandoffReply(text, state, scope, request)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The reply could not be read. Nothing was applied.') }
  }
  function downloadBrief() {
    const url = URL.createObjectURL(new Blob([brief], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'hybrid-coach-brief.txt'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice('Brief downloaded. Attach it to your AI chat, then bring back the final JSON reply.')
  }
  async function askApi() {
    if (controller.current) return
    const active = new AbortController()
    controller.current = active
    setBusy(true)
    setReview(null)
    setCustomApproval('')
    setError('')
    const accepted = consent
    setConsent(false)
    try {
      const connection = { endpoint, model, apiKey }
      const next = await requestHandoff(state, scope, request, connection, accepted, active.signal)
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
    try {
      const date = !state.setupComplete && scope.purpose === 'interpret_goal' && state.draft.eventDate
        ? validateSetupDate(state.draft.startDate, state.draft.eventDate) : undefined
      if (onApply(review, request, date)) onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Review the suggestions before applying.') }
  }
  const changeConfig = () => { setConsent(false); setError('') }

  return <section className="cf-stack">
    <header className="cf-dialog-header"><div><p className="cf-kicker">YOUR COACHING WORKSPACE</p><h2>{scope.weekReview ? 'Review your week' : 'Shape your sessions'}</h2></div><button type="button" className="cf-button cf-secondary" onClick={onClose}>Close workspace</button></header>
    <div className="cf-inline" role="group" aria-label="How to customise">
      {([['builtin', 'Built-in'], ['chat', 'Use my AI chat'], ['api', 'Connect API']] as const).map(([value, label]) => <button className={`cf-button ${method === value ? 'cf-primary' : 'cf-secondary'}`} type="button" key={value} disabled={busy} aria-pressed={method === value} onClick={() => { setMethod(value); setError(''); setNotice('') }}>{label}</button>)}
    </div>
    <p className="cf-small">AI can suggest new exercises, not just notes. You approve their movement categories and equipment; the app controls quantities, loads and placement.</p>
    {state.setupComplete && <div className="cf-card cf-stack">
      <p>Your current week is locked. This workspace edits notes, not its exercise lineup. {state.draft.program ? 'Changes to the lineup start next week.' : 'This plan still uses the original exercise library.'}</p>
      {onRevise && <button type="button" className="cf-button cf-secondary" disabled={busy} onClick={onRevise}>Change next week's exercises</button>}
    </div>}
    {method === 'builtin' ? <>
      <p>No AI is needed. Return to your review to choose, create or swap exercises before building the week.</p>
      <button type="button" className="cf-button cf-primary" onClick={onClose}>Continue without AI</button>
      <details className="cf-details"><summary>Personal notes</summary><WorkoutCards cards={state.cards ?? []} resources={resources} program={state.draft.program} onChange={onCards} /></details>
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
      {catalog && <p role="status" className="cf-small">{catalog.label}: {catalog.availableExerciseCount} equipped movements.
        {state.setupComplete ? ' Current-week identities stay unchanged.' : ` Choose ${catalog.minimumSelection}-${catalog.maximumSelection} for your active routine; this is not the library size.`}
      </p>}
      <label className="cf-field">What would you like to refine?<textarea maxLength={500} rows={2} value={request} disabled={busy} placeholder={scope.weekReview ? 'What felt useful or difficult? What should we change next week?' : 'Keep the movements I enjoy; suggest an exercise using my available equipment.'} onChange={event => setRequest(event.target.value)} /></label>
      {scope.weekReview && <p className="cf-small">This brief includes this week's actual records, unknown or skipped work, notes and recorded health flags. Review it before sharing. Earlier weeks cannot be changed.</p>}
      {method === 'chat' ? <>
        <p>Copy the brief into your AI chat and discuss your exercises in ordinary language. When ready, ask for the final app reply and paste it below. No API key needed.</p>
        <p className="cf-small">Already using an older brief? Paste this fresh one into the same chat and ask it to replace the old brief. The AI cannot see app updates on its own.</p>
        <div className="cf-inline">
          <button type="button" className="cf-button cf-primary" onClick={() => {
            setError('')
            if (!navigator.clipboard) { setError('Clipboard unavailable. Download the brief or copy it from the preview below.'); return }
            void navigator.clipboard.writeText(brief).then(() => setNotice('Brief copied. Paste it into your AI chat.')).catch(() => setError('Clipboard permission was denied. Download the brief or copy it from the preview below.'))
          }}>Copy coaching brief</button>
          <button type="button" className="cf-button cf-secondary" onClick={downloadBrief}>Download brief</button>
        </div>
        <label className="cf-field" htmlFor={`${id}-reply`}>Paste final AI reply<textarea id={`${id}-reply`} rows={4} maxLength={HANDOFF_LIMIT} value={pasted} onChange={event => { importSequence.current++; setPasted(event.target.value); setReview(null); setError('') }} placeholder="Paste the final JSON block, not the whole conversation." /></label>
        <div className="cf-inline"><button type="button" className="cf-button cf-primary" disabled={!pasted.trim()} onClick={() => parseReply(pasted)}>Review reply</button>
          <label className="cf-field">Or upload reply<input type="file" accept=".json,.txt,application/json,text/plain" onChange={event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            const sequence = ++importSequence.current
            setReview(null)
            if (file.size > HANDOFF_LIMIT) { setError('Choose a reply smaller than 32 KB.'); return }
            void file.text().then(text => {
              if (sequence === importSequence.current && contextId === currentContext.current) { setPasted(text); parseReply(text) }
            }).catch(() => { if (sequence === importSequence.current) setError('The file could not be read. Nothing was applied.') })
          }} /></label>
        </div>
      </> : <>
        <details className="cf-details" open={!config}><summary>{config ? `Connection: ${config.model}` : 'Set up your API connection'}</summary><div className="cf-stack">
          <label className="cf-field">Local or HTTPS API endpoint<input type="url" value={endpoint} maxLength={2048} disabled={busy} onChange={event => { setEndpoint(event.target.value); changeConfig() }} autoComplete="off" placeholder="https://provider.example/v1/chat/completions" /></label>
          <label className="cf-field">Model<input value={model} maxLength={128} disabled={busy} onChange={event => { setModel(event.target.value); changeConfig() }} /></label>
          <label className="cf-field">API key (if required)<input type="password" value={apiKey} maxLength={4096} disabled={busy} autoComplete="off" onChange={event => { setApiKey(event.target.value); changeConfig() }} /></label>
        </div></details>
        <p className="cf-small">Kept only in this open tab, including after setup. Disconnect or reload clears it. Never in backups. Use a private browser for real keys; password masking does not hide them from browser automation.</p>
        <label className="cf-check"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />Send this brief, including selected training context{scope.weekReview ? ", this week's actual logs, notes and health flags" : ''} and cards, to my endpoint.</label>
        <button type="button" className="cf-button cf-primary" disabled={busy || !consent || !endpoint.trim() || !model.trim()} onClick={() => void askApi()}>{busy ? 'Requesting suggestions...' : 'Request suggestions'}</button>
        {busy && <button type="button" className="cf-button cf-secondary" onClick={() => controller.current?.abort()}>Cancel request</button>}
        {config && <button type="button" className="cf-text-button" disabled={busy} onClick={() => { onConnect(undefined); setEndpoint(''); setModel(''); setApiKey(''); setConsent(false) }}>Disconnect AI</button>}
      </>}
      <details className="cf-details"><summary>Review the exact brief &amp; guardrails</summary><p>Only the fields shown below are shared. {scope.weekReview ? "Includes the selected week's actual training, notes and health flags." : 'No actual training logs.'} No imported files, credentials or full backup. The external chat or API provider has its own privacy policy.</p><textarea className="cf-assistant-payload" aria-label="Coaching brief preview" readOnly rows={8} value={brief} /></details>
      {notice && <p role="status">{notice}</p>}
      <div ref={resultElement} aria-live="polite">{review && <div className="cf-stack">
        {review.summaryShortened && <p role="status" className="cf-small">The AI's explanation was longer than the review limit, so it has been shortened. Exercise suggestions and reference cards are unchanged. Keep the original reply if you want the full explanation.</p>}
        {review.reply.summary && <div className="cf-card"><h3>Your AI's review</h3><p>{review.reply.summary}</p><p className="cf-small">AI-authored context, not a verified assessment or an instruction to change training quantities.</p></div>}
        {customExercises.length > 0 && <>
          <CustomExerciseCards exercises={customExercises} />
          {customExercises.some(exercise => !review.reply.proposal?.exerciseIds.includes(exercise.id)) && <p className="cf-small">Exercises not included in the proposed lineup are saved to your library, not scheduled. You can select them in the review.</p>}
          <label className="cf-check"><input type="checkbox" checked={customApproved} onChange={event => setCustomApproval(event.target.checked ? approvalKey : '')} />
            <span>I have reviewed these controlled movements, their categories and required equipment. They are not ballistic, rehabilitation or unfamiliar high-skill work. The app does not assess technique.</span>
          </label>
        </>}
        {review.reply.proposal && <GoalProposalReview draft={reviewDraft} proposal={review.reply.proposal} purpose={scope.purpose} dateIssue={review.dateIssue} />}
        {review.reply.cards.length > 0 && <><h3>Reference cards to import</h3><p className="cf-small">Matching IDs replace the shown local card; other cards are kept. All AI prose stays an unverified draft, not workout instructions.</p>
          {review.reply.cards.map(card => <p key={card.id} className="cf-small">{state.cards?.some(old => old.id === card.id) ? 'Replace' : 'Add'}: {card.title}</p>)}
          <WorkoutCards cards={review.reply.cards} resources={resources} program={reviewDraft.program} onChange={() => {}} readOnly />
        </>}
        {!review.reply.proposal && !review.reply.cards.length && !customExercises.length && <p>No changes proposed.</p>}
        <button type="button" className="cf-button cf-primary" disabled={busy || !customApproved || (!review.reply.proposal && !review.reply.cards.length && !customExercises.length && !canKeepReview)} onClick={apply}>
          {!review.reply.proposal && !review.reply.cards.length && !customExercises.length && canKeepReview ? 'Keep review notes'
            : review.reply.proposal && scope.purpose === 'interpret_goal'
            ? state.draft.eventDate || review.reply.proposal.eventDate ? 'Confirm date & apply suggestions' : 'Apply suggestions, then choose date'
            : 'Apply reviewed changes'}
        </button>
      </div>}</div>
    </>}
    {error && <p className="cf-error" role="alert">{error}</p>}
  </section>
}
