import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AssistantError } from './assistant.ts'
import type { AssistantConfig } from './assistant.ts'
import {
  applyGoalProposal, buildSetupAssistantContext, GOAL_KIND_LABELS, proposalExerciseChanges,
  MAX_EXERCISE_REFINEMENT_LENGTH, requestGoalProposal, SETUP_QUALITY_LABELS,
} from './setup-assistant.ts'
import type { GoalProposal, GoalProposalPurpose } from './setup-assistant.ts'
import type { CampaignDraft } from './types.ts'

export interface SetupAssistantPanelProps {
  draft: CampaignDraft
  onApply: (proposal: GoalProposal, purpose: GoalProposalPurpose) => void
  onClose: () => void
  initialConfig?: AssistantConfig
  initialPurpose?: GoalProposalPurpose
  onConnect?: (config: AssistantConfig) => void
}

function readableDate(value: string | null): string {
  if (!value) return 'Not specified — confirm a date separately if needed'
  const [year, month, day] = value.split('-').map(Number)
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${day} ${months[month - 1]} ${year}`
}

export function GoalProposalReview({
  draft, proposal, purpose = 'interpret_goal',
}: { draft: CampaignDraft; proposal: GoalProposal; purpose?: GoalProposalPurpose }) {
  return (
    <div className="cf-stack">
      <h3>Review AI suggestions</h3>
      {purpose === 'interpret_goal' ? (
        <dl className="cf-card cf-goal-proposal">
          <dt>Goal</dt><dd>{proposal.label}</dd>
          <dt>Activity</dt><dd>{GOAL_KIND_LABELS[proposal.goalKind]}</dd>
          <dt>Location</dt><dd>{proposal.location || 'Not specified'}</dd>
          <dt>Event date — please verify</dt><dd>{readableDate(proposal.eventDate)}</dd>
          <dt>Priorities</dt><dd>{proposal.priorities.map(quality => SETUP_QUALITY_LABELS[quality]).join(' · ')}</dd>
        </dl>
      ) : <p className="cf-muted">Only exercise cards will be applied; your approved goal and date stay unchanged.</p>}
      <h4>Proposed exercise cards</h4>
      {proposalExerciseChanges(draft, proposal).map(({ exercise, change }) => (
        <article className={`cf-card cf-proposal-card cf-proposal-${change}`} key={exercise.id}>
          <p className="cf-kicker">{change === 'added' ? 'Added' : change === 'removed' ? 'Removed' : 'Kept'}</p>
          <h4>{exercise.name}</h4>
          <p className="cf-muted">{exercise.pattern.replaceAll('_', ' ')} · {exercise.equipment.join(', ')}</p>
        </article>
      ))}
      <p className="cf-muted">Check every added or removed card. Nothing is applied yet.</p>
    </div>
  )
}

export default function SetupAssistantPanel({
  draft, onApply, onClose, initialConfig, onConnect, initialPurpose = 'interpret_goal',
}: SetupAssistantPanelProps) {
  const id = useId()
  const [endpoint, setEndpoint] = useState(() => initialConfig?.endpoint ?? '')
  const [model, setModel] = useState(() => initialConfig?.model ?? '')
  const [apiKey, setApiKey] = useState(() => initialConfig?.apiKey ?? '')
  const [purpose, setPurpose] = useState<GoalProposalPurpose>(initialPurpose)
  const [requestText, setRequestText] = useState('')
  const [consentFor, setConsentFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ contextKey: string; proposal: GoalProposal } | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const review = useRef<HTMLDivElement>(null)
  const tabConnection = Boolean(initialConfig || onConnect)

  let context: ReturnType<typeof buildSetupAssistantContext> | null = null
  let unavailable = ''
  try { context = buildSetupAssistantContext(draft, purpose === 'suggest_exercises' ? requestText : '') } catch (cause) {
    unavailable = cause instanceof AssistantError ? cause.message : 'Review your goal text and equipment before continuing.'
  }
  const contextKey = context ? JSON.stringify([context, draft.startDate, purpose]) : ''
  const consent = Boolean(contextKey && consentFor === contextKey)
  const proposal = result?.contextKey === contextKey ? result.proposal : null
  const [previousContextKey, setPreviousContextKey] = useState(contextKey)

  if (previousContextKey !== contextKey) {
    setPreviousContextKey(contextKey)
    setBusy(false)
    setResult(null)
    setError(null)
    setConsentFor(null)
  }

  useEffect(() => () => {
    activeRequest.current?.abort()
    activeRequest.current = null
  }, [contextKey])
  useEffect(() => {
    if (result?.contextKey === contextKey) review.current?.scrollIntoView({ block: 'start' })
  }, [result, contextKey])

  function close() {
    activeRequest.current?.abort()
    activeRequest.current = null
    setEndpoint('')
    setModel('')
    setApiKey('')
    setRequestText('')
    setConsentFor(null)
    setResult(null)
    setError(null)
    setBusy(false)
    onClose()
  }

  function configurationChanged() {
    setConsentFor(null)
    setError(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (activeRequest.current) return
    const controller = new AbortController()
    activeRequest.current = controller
    setBusy(true)
    setResult(null)
    setError(null)
    setConsentFor(null)
    try {
      const next = await requestGoalProposal({
        draft, purpose, consent, config: { endpoint, model, apiKey }, signal: controller.signal,
        requestText: purpose === 'suggest_exercises' ? requestText : '',
      })
      if (activeRequest.current === controller) {
        setResult({ contextKey, proposal: next })
        onConnect?.({ endpoint, model, apiKey })
      }
    } catch (cause) {
      if (activeRequest.current === controller) {
        setError(cause instanceof AssistantError ? cause.message : 'Could not interpret the goal. Check your endpoint and try again.')
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null
        setBusy(false)
      }
    }
  }

  function apply() {
    if (!proposal || !context || busy) return
    try {
      applyGoalProposal(draft, proposal, next => onApply(next, purpose))
      close()
    } catch (cause) {
      setError(cause instanceof AssistantError ? cause.message : 'The suggestions could not be applied. Review your setup and try again.')
    }
  }

  return (
    <section className="cf-stack cf-assistant" aria-labelledby={`${id}-title`}>
      <header className="cf-dialog-header">
        <div>
          <p className="cf-kicker">Optional · Before committing your block</p>
          <h2 id={`${id}-title`}>Shape your goal with AI</h2>
        </div>
        <button type="button" className="cf-button cf-secondary" onClick={close} aria-label="Close goal assistant">Close</button>
      </header>

      {!context ? <p className="cf-muted" role="status">{unavailable}</p> : (
        <>
          <p>AI can interpret your goal and suggest exercise-card changes. You review every change; AI never sets training quantities.</p>
          <form className="cf-stack" onSubmit={submit} autoComplete="off" aria-busy={busy}>
            <fieldset className="cf-stack" disabled={busy}>
              <legend>What would you like help with?</legend>
              <label className="cf-field" htmlFor={`${id}-purpose`}>
                Task
                <select id={`${id}-purpose`} value={purpose} onChange={event => setPurpose(event.target.value as GoalProposalPurpose)}>
                  <option value="interpret_goal">Interpret my goal</option>
                  <option value="suggest_exercises">Suggest exercise changes</option>
                </select>
              </label>
              {purpose === 'suggest_exercises' && (
                <>
                  <label className="cf-field" htmlFor={`${id}-refinement`}>
                    What exercise-card changes would you like?
                    <textarea
                      id={`${id}-refinement`} rows={3} maxLength={MAX_EXERCISE_REFINEMENT_LENGTH} value={requestText}
                      placeholder="Swap the goblet squat for a bodyweight option."
                      onChange={event => { setRequestText(event.target.value); setConsentFor(null) }}
                      aria-describedby={`${id}-refinement-help`}
                    />
                  </label>
                  <p id={`${id}-refinement-help`} className="cf-muted">Optional · {requestText.length}/{MAX_EXERCISE_REFINEMENT_LENGTH} characters. Leave blank to tailor cards from your goal; no quantity changes.</p>
                </>
              )}
              <details className="cf-details cf-connection-details" open={!initialConfig}>
                <summary>{initialConfig ? `AI connection · ${initialConfig.model}` : 'Connect a local model or API'}</summary>
                <div className="cf-stack">
                  <label className="cf-field" htmlFor={`${id}-endpoint`}>
                    Local or HTTPS API endpoint
                    <input
                      id={`${id}-endpoint`} type="url" required maxLength={2048} value={endpoint}
                      placeholder="http://localhost:1234/v1/chat/completions"
                      onChange={event => { setEndpoint(event.target.value); configurationChanged() }}
                      autoCapitalize="none" spellCheck={false} aria-describedby={`${id}-connection`}
                    />
                  </label>
                  <label className="cf-field" htmlFor={`${id}-model`}>
                    Model
                    <input
                      id={`${id}-model`} required maxLength={128} value={model}
                      placeholder="Model identifier from your endpoint"
                      onChange={event => { setModel(event.target.value); configurationChanged() }}
                      autoCapitalize="none" spellCheck={false}
                    />
                  </label>
                  <label className="cf-field" htmlFor={`${id}-key`}>
                    API key (if required)
                    <input
                      id={`${id}-key`} type="password" maxLength={4096} value={apiKey}
                      onChange={event => { setApiKey(event.target.value); configurationChanged() }}
                      autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby={`${id}-memory`}
                    />
                  </label>
                  <p className="cf-muted">Not saved to disk. Use a limited-scope key.</p>
                </div>
              </details>
            </fieldset>

            <details className="cf-assistant-details">
              <summary>Your goal, privacy &amp; connection help</summary>
              <div className="cf-stack">
                <p><strong>Your current goal.</strong> {context.goalText}</p>
                <p><strong>Review first.</strong> AI can classify your free-text sporting goal, identify a stated place or date, choose priorities and add or swap equipped library exercise cards. It cannot set baseline quantities, prescriptions, volume, time budgets or scheduling. Classic recommended cards work without AI.</p>
                <p id={`${id}-sharing`}><strong>Data sent.</strong> Only your goal text, exercise-change request, selected equipment, current exercise IDs and eligible library catalog are sent, with the task instructions and model name. No training logs, files, history, baseline quantities or other profile fields are shared. Avoid private details in your text.</p>
                <p id={`${id}-memory`}><strong>Memory only.</strong> {tabConnection
                  ? 'Connection kept only in this open tab; disconnect or reload clears it.'
                  : 'The endpoint, model and API key clear when this panel closes.'} Unapplied suggestions clear on close. A supplied key goes only to your endpoint in its authorization header; it is not logged, saved to disk or included in backups.</p>
                <p id={`${id}-connection`}><strong>Connection.</strong> Use an OpenAI-compatible /chat/completions endpoint: HTTPS remotely, or HTTP on localhost or 127.0.0.1. Nothing connects automatically. CORS, mixed-content and private-network restrictions may require configuration at your endpoint; the app has no proxy to bypass them and cannot guarantee every provider works.</p>
                <p><strong>Dates need confirmation.</strong> A proposed date must match a complete date in your goal: YYYY-MM-DD or a date with an English month name. Otherwise request no date and confirm it separately.</p>
                <details>
                  <summary>Exact goal and exercise data sent</summary>
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
              I agree to send my goal, change request, equipment and exercise selection to my endpoint.
            </label>
            <button type="submit" className="cf-button cf-primary" disabled={busy || !consent || !endpoint.trim() || !model.trim()}>
              {busy ? 'Requesting suggestions…' : purpose === 'interpret_goal' ? 'Interpret my goal' : 'Suggest exercise changes'}
            </button>
            {busy && <button type="button" className="cf-button cf-secondary" onClick={() => activeRequest.current?.abort()}>Cancel request</button>}
          </form>

          {error && <p className="cf-error" role="alert">{error}</p>}
          <div ref={review} aria-live="polite" aria-atomic="true">
            {busy && <p role="status">Waiting for your endpoint…</p>}
            {proposal && (
              <div className="cf-stack">
                <GoalProposalReview draft={draft} proposal={proposal} purpose={purpose} />
                <button type="button" className="cf-button cf-primary" onClick={apply} disabled={busy}>
                  Apply these suggestions
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
