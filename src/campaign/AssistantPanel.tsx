import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '../../engine/types.ts'
import type { CampaignState } from './types.ts'
import {
  AssistantError, buildAssistantContext, eligibleAssistantIdeas,
  MAX_REFINEMENT_LENGTH, requestAssistantIdeas,
} from './assistant.ts'

export interface AssistantPanelProps {
  state: CampaignState
  session: Session | null
  onClose: () => void
}

export default function AssistantPanel({ state, session, onClose }: AssistantPanelProps) {
  const id = useId()
  const [endpoint, setEndpoint] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [request, setRequest] = useState('')
  const [consentFor, setConsentFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ contextKey: string; ids: string[] } | null>(null)
  const activeRequest = useRef<AbortController | null>(null)

  let context: ReturnType<typeof buildAssistantContext> | null = null
  let unavailable = ''
  let catalog: ReturnType<typeof eligibleAssistantIdeas> = []
  try {
    context = buildAssistantContext(state, session, request)
    catalog = eligibleAssistantIdeas(state, session)
  } catch {
    unavailable = !session || !state.setupComplete || !state.draft.confirmed
      ? 'Finish setup, then open a session to personalise its content.'
      : 'No reviewed AI ideas match this session. Use its existing guidance.'
  }
  const contextKey = context ? JSON.stringify([session?.id, context]) : ''
  const consent = Boolean(contextKey && consentFor === contextKey)
  const ideas = result?.contextKey === contextKey ? catalog.filter(idea => result.ids.includes(idea.id)) : []
  const [previousContextKey, setPreviousContextKey] = useState(contextKey)

  if (previousContextKey !== contextKey) {
    setPreviousContextKey(contextKey)
    setBusy(false)
    setError(null)
    setResult(null)
    setConsentFor(null)
  }

  useEffect(() => () => {
    activeRequest.current?.abort()
    activeRequest.current = null
  }, [contextKey])

  function close() {
    activeRequest.current?.abort()
    activeRequest.current = null
    setApiKey('')
    setEndpoint('')
    setModel('')
    setRequest('')
    setConsentFor(null)
    setResult(null)
    setError(null)
    setBusy(false)
    onClose()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (activeRequest.current) return
    setError(null)
    setResult(null)
    const controller = new AbortController()
    activeRequest.current = controller
    setBusy(true)
    try {
      const selected = await requestAssistantIdeas({
        state, session, request, config: { endpoint, model, apiKey }, consent, signal: controller.signal,
      })
      if (activeRequest.current === controller) {
        setResult({ contextKey, ids: selected.map(idea => idea.id) })
      }
    } catch (cause) {
      if (activeRequest.current === controller) {
        setError(cause instanceof AssistantError ? cause.message : 'The request failed. Check your endpoint configuration and try again.')
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null
        setBusy(false)
      }
    }
  }

  return (
    <section className="cf-stack cf-assistant" aria-labelledby={`${id}-title`}>
      <header className="cf-dialog-header">
        <div>
          <p className="cf-kicker">Optional · Content only</p>
          <h2 id={`${id}-title`}>AI-selected session ideas</h2>
        </div>
        <button type="button" className="cf-button cf-secondary" onClick={close} aria-label="Close AI ideas">Close</button>
      </header>

      {!context ? <p className="cf-muted" role="status">{unavailable}</p> : (
        <>
          <p>AI selects reviewed focus cues for this session. It never changes your plan or adds work.</p>
          <p className="cf-muted">{context.goal.kind === 'dodgeball' ? 'Dodgeball' : context.goal.kind === 'running' ? 'Running' : context.goal.kind === 'hybrid' ? 'Hybrid' : 'Custom'} goal · {context.session.kind === 'commitment' ? 'Court practice' : context.session.kind === 'run' ? 'Run' : 'Strength'} · {context.session.durationMin} planned minutes</p>

          <form className="cf-stack" onSubmit={submit} autoComplete="off" aria-busy={busy}>
            <fieldset className="cf-stack" disabled={busy}>
              <legend>Your focus</legend>
              <label className="cf-field" htmlFor={`${id}-request`}>
                What would you like to focus on?
                <textarea
                  id={`${id}-request`} rows={3} maxLength={MAX_REFINEMENT_LENGTH} value={request}
                  placeholder={context.session.kind === 'commitment' ? 'Help me focus on team communication.' : 'Help me notice my technique during this session.'}
                  onChange={event => { setRequest(event.target.value); setConsentFor(null) }}
                  aria-describedby={`${id}-count`}
                />
              </label>
              <p id={`${id}-count`} className="cf-muted">Optional · {request.length}/{MAX_REFINEMENT_LENGTH} characters · Avoid private details.</p>
            </fieldset>

            <fieldset className="cf-stack" disabled={busy}>
              <legend>Your AI connection</legend>
              <label className="cf-field" htmlFor={`${id}-endpoint`}>
                Local or HTTPS API endpoint
                <input
                  id={`${id}-endpoint`} type="url" required value={endpoint} maxLength={2048}
                  placeholder="http://localhost:1234/v1/chat/completions"
                  onChange={event => { setEndpoint(event.target.value); setConsentFor(null); setError(null) }}
                  autoCapitalize="none" spellCheck={false} aria-describedby={`${id}-connection-help`}
                />
              </label>
              <label className="cf-field" htmlFor={`${id}-model`}>
                Model
                <input
                  id={`${id}-model`} type="text" required maxLength={128} value={model}
                  placeholder="Model identifier from your endpoint"
                  onChange={event => { setModel(event.target.value); setConsentFor(null); setError(null) }}
                  autoCapitalize="none" spellCheck={false}
                />
              </label>
              <label className="cf-field" htmlFor={`${id}-key`}>
                API key (if required)
                <input
                  id={`${id}-key`} type="password" value={apiKey} maxLength={4096}
                  onChange={event => { setApiKey(event.target.value); setConsentFor(null); setError(null) }}
                  autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby={`${id}-memory`}
                />
              </label>
              <p className="cf-muted">Not saved. Use a limited-scope key.</p>
            </fieldset>

            <details className="cf-assistant-details">
              <summary>Privacy, boundaries &amp; connection help</summary>
              <div className="cf-stack">
                <p><strong>Content only.</strong> AI selects IDs from a fixed, reviewed catalog; only matching catalog text is displayed. It cannot control placement, duration, exercises, sets, reps, loads, target RPE or mandatory volume. Curated session guidance elsewhere needs no connection or key.</p>
                <p id={`${id}-sharing`}><strong>Data sent.</strong> Your endpoint receives goal kind and priorities, the selected session prescription, your request, model name and approved catalog. No files, training logs, calendar dates, location or profile notes are sent. A supplied key goes only to that endpoint in its authorization header.</p>
                <p id={`${id}-memory`}><strong>Memory only.</strong> Endpoint, model and key are cleared when this panel closes; they are never saved, logged or included in backups.</p>
                <p id={`${id}-connection-help`}><strong>Endpoint requirements.</strong> Use an OpenAI-compatible URL ending in /chat/completions. Remote APIs require HTTPS; local HTTP supports only localhost or 127.0.0.1, not IPv6. Nothing connects automatically.</p>
                <p><strong>Browser restrictions.</strong> CORS, mixed-content and private-network rules may block requests. Your endpoint must permit this app’s origin and authorization header. There is no backend or proxy to bypass these restrictions, and not every provider is compatible.</p>
                <details>
                  <summary>Exact goal, session and request data</summary>
                  <pre className="cf-assistant-payload">{JSON.stringify(context, null, 2)}</pre>
                </details>
              </div>
            </details>

            <label className="cf-check" htmlFor={`${id}-consent`}>
              <input
                id={`${id}-consent`} type="checkbox" checked={consent} disabled={busy}
                onChange={event => setConsentFor(event.target.checked ? contextKey : null)}
                aria-describedby={`${id}-sharing`}
              />
              I agree to send this goal, session prescription and request to my endpoint.
            </label>
            <button type="submit" className="cf-button cf-primary" disabled={!consent || busy || !endpoint.trim() || !model.trim()}>
              {busy ? 'Requesting ideas…' : 'Request optional ideas'}
            </button>
            {busy && <button type="button" className="cf-button cf-secondary" onClick={() => activeRequest.current?.abort()}>Cancel request</button>}
          </form>

          {error && <p className="cf-error" role="alert">{error}</p>}
          <div aria-live="polite" aria-atomic="true">
            {busy && <p role="status">Waiting for your endpoint…</p>}
            {ideas.length > 0 && (
              <div className="cf-stack">
                <h3>AI-selected suggestions only</h3>
                <p className="cf-muted">Optional cues within your existing session; follow your coach’s instructions.</p>
                {ideas.map(idea => (
                  <article className="cf-card" key={idea.id}>
                    <h4>{idea.title}</h4>
                    <p>{idea.focus}</p>
                    <ul>{idea.cues.map(cue => <li key={cue}>{cue}</li>)}</ul>
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
