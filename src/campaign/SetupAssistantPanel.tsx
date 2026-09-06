import { GOAL_KIND_LABELS, proposalExerciseChanges, SETUP_QUALITY_LABELS } from './setup-assistant.ts'
import type { GoalDateIssue, GoalProposal, GoalProposalPurpose } from './setup-assistant.ts'
import type { CampaignDraft } from './types.ts'

function readableDate(value: string | null): string {
  if (!value) return 'Not set — choose it with the date picker beside your goal'
  const [year, month, day] = value.split('-').map(Number)
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${day} ${months[month - 1]} ${year}`
}

const dateIssueText: Record<GoalDateIssue, string> = {
  invalid: 'The AI returned an invalid calendar date, so that date was not used.',
  before_start: 'The AI returned a date before your block starts, so that date was not used.',
  outside_block: 'The AI returned a date beyond the supported 52-week block, so that date was not used.',
  not_explicit: 'Your brief does not confirm the full date the AI suggested, so that date was not used.',
}

export function GoalProposalReview({
  draft, proposal, purpose = 'interpret_goal', dateIssue = null,
}: { draft: CampaignDraft; proposal: GoalProposal; purpose?: GoalProposalPurpose; dateIssue?: GoalDateIssue | null }) {
  return (
    <div className="cf-stack">
      <h3>Review AI suggestions</h3>
      {purpose === 'interpret_goal' ? (
        <dl className="cf-card cf-goal-proposal">
          <dt>Goal</dt><dd>{proposal.label}</dd>
          <dt>Activity</dt><dd>{GOAL_KIND_LABELS[proposal.goalKind]}</dd>
          <dt>Location</dt><dd>{proposal.location || 'Not specified'}</dd>
          <dt>Event / review date — confirm before applying</dt><dd>{readableDate(draft.eventDate || proposal.eventDate)}{draft.eventDate && ' (from your date picker)'}</dd>
          <dt>Priorities</dt><dd>{proposal.priorities.map(quality => SETUP_QUALITY_LABELS[quality]).join(' · ')}</dd>
        </dl>
      ) : <p className="cf-muted">Only exercise cards will be applied; your approved goal and date stay unchanged.</p>}
      {purpose === 'interpret_goal' && dateIssue && <p className="cf-card" role="status">
        {dateIssueText[dateIssue]} Your goal and exercise suggestions are still available.{' '}
        {draft.eventDate ? 'Confirm the date shown above to keep your selection, or close this panel to change it.' : 'Apply the suggestions, then choose your event or review date in the date picker before continuing.'}
      </p>}
      {purpose === 'interpret_goal' && !dateIssue && !draft.eventDate && !proposal.eventDate && <p className="cf-muted">
        No date was supplied. Apply the suggestions, then choose your event or review date in the date picker before continuing.
      </p>}
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
