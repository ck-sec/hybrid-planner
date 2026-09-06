import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { AssistantConfig } from './assistant.ts'
import { buildHandoff, exportHandoff, HANDOFF_LIMIT, parseHandoffReply, requestHandoff } from './handoff.ts'
import type { HandoffReview, HandoffScope } from './handoff.ts'
import { resourcesForEquipment } from './equipment.ts'
import { GoalProposalReview } from './SetupAssistantPanel.tsx'
import { validateSetupDate } from './setup-dates.ts'
import type { CampaignState } from './types.ts'
import type { WorkoutCard } from './workout-cards.ts'
import WorkoutCards from './WorkoutCards.tsx'

interface Props {
  state: CampaignState
  scope: HandoffScope
  config?: AssistantConfig
  onConnect: (config: AssistantConfig | undefined) => void
  onApply: (review: HandoffReview, request: string, confirmedDate?: string) => boolean
  onCards: (cards: WorkoutCard[]) => void
  onClose: () => void
}

export default function CoachingWorkbench({ state, scope, config, onConnect, onApply, onCards, onClose }: Props) {
  const id = useId()
  const [method, setMethod] = useState<'builtin' | 'chat' | 'api'>(config ? 'api' : state.setupComplete ? 'builtin' : 'chat')
  const [request, setRequest] = useState('')
  const [pasted, setPasted] = useState('')
  const [review, setReview] = useState<HandoffReview | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [endpoint, setEndpoint] = useState(config?.endpoint ?? '')
  const [model, setModel] = useState(config?.model ?? '')
  const [apiKey, setApiKey] = useState(config?.apiKey ?? '')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const importSequence = useRef(0)
  const resultElement = useRef<HTMLDivElement>(null)
  let unavailable = ''
  let contextId = ''
  let brief = ''
  try {
    contextId = JSON.stringify([buildHandoff(state, scope, request).contextId, request])
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

  function parseReply(text: string) {
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
    try {
      const date = !state.setupComplete && scope.purpose === 'interpret_goal' && state.draft.eventDate
        ? validateSetupDate(state.draft.startDate, state.draft.eventDate) : undefined
      if (onApply(review, request, date)) onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Review the suggestions before applying.') }
  }
  const changeConfig = () => { setConsent(false); setError('') }

  return <section className="cf-stack">
    <header className="cf-dialog-header"><div><p className="cf-kicker">YOUR COACHING WORKSPACE</p><h2>Shape your sessions</h2></div><button type="button" className="cf-button cf-secondary" onClick={onClose}>Close workspace</button></header>
    <div className="cf-inline" role="group" aria-label="How to customise">
      {([['builtin', 'Built-in'], ['chat', 'Use my AI chat'], ['api', 'Connect API']] as const).map(([value, label]) => <button className={`cf-button ${method === value ? 'cf-primary' : 'cf-secondary'}`} type="button" key={value} disabled={busy} aria-pressed={method === value} onClick={() => { setMethod(value); setError(''); setNotice('') }}>{label}</button>)}
    </div>
    <p className="cf-small">The engine owns prescriptions and the calendar. Your notes and novel drills stay separate; importing a card never adds training.</p>
    {method === 'builtin' ? <>
      <p>Edit your reference cards here. Exercise swaps are available in Your base before the block is committed.</p>
      <WorkoutCards cards={state.cards ?? []} resources={resources} onChange={onCards} />
    </> : unavailable ? <p role="status">{unavailable}</p> : <>
      <label className="cf-field">What would you like to refine?<textarea maxLength={500} rows={2} value={request} disabled={busy} placeholder="Keep my strength base; suggest a dodgeball throwing drill idea using my equipment." onChange={event => setRequest(event.target.value)} /></label>
      {method === 'chat' ? <>
        <p>Copy once. Work in your usual AI chat. Ask it for the final JSON when ready, then paste it below. No API key needed.</p>
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
        <label className="cf-check"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />Send this brief, including selected training context and cards, to my endpoint.</label>
        <button type="button" className="cf-button cf-primary" disabled={busy || !consent || !endpoint.trim() || !model.trim()} onClick={() => void askApi()}>{busy ? 'Requesting suggestions...' : 'Request suggestions'}</button>
        {busy && <button type="button" className="cf-button cf-secondary" onClick={() => controller.current?.abort()}>Cancel request</button>}
        {config && <button type="button" className="cf-text-button" disabled={busy} onClick={() => { onConnect(undefined); setEndpoint(''); setModel(''); setApiKey(''); setConsent(false) }}>Disconnect AI</button>}
      </>}
      <details className="cf-details"><summary>Review the exact brief &amp; guardrails</summary><p>Only the fields shown below are shared. No logs, imported files, secrets or backup data. The external chat or API provider has its own privacy policy.</p><textarea className="cf-assistant-payload" aria-label="Coaching brief preview" readOnly rows={8} value={brief} /></details>
      {notice && <p role="status">{notice}</p>}
      <div ref={resultElement} aria-live="polite">{review && <div className="cf-stack">
        {review.reply.proposal && <GoalProposalReview draft={state.draft} proposal={review.reply.proposal} purpose={scope.purpose} dateIssue={review.dateIssue} />}
        {review.reply.cards.length > 0 && <><h3>Reference cards to import</h3><p className="cf-small">Matching IDs replace the shown local card; other cards are kept. All AI prose stays an unverified draft, not workout instructions.</p>
          {review.reply.cards.map(card => <p key={card.id} className="cf-small">{state.cards?.some(old => old.id === card.id) ? 'Replace' : 'Add'}: {card.title}</p>)}
          <WorkoutCards cards={review.reply.cards} resources={resources} onChange={() => {}} readOnly />
        </>}
        {!review.reply.proposal && !review.reply.cards.length && <p>No changes proposed.</p>}
        <button type="button" className="cf-button cf-primary" disabled={busy || (!review.reply.proposal && !review.reply.cards.length)} onClick={apply}>
          {review.reply.proposal && scope.purpose === 'interpret_goal'
            ? state.draft.eventDate || review.reply.proposal.eventDate ? 'Confirm date & apply suggestions' : 'Apply suggestions, then choose date'
            : 'Apply reviewed changes'}
        </button>
      </div>}</div>
    </>}
    {error && <p className="cf-error" role="alert">{error}</p>}
  </section>
}
