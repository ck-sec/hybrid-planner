import { normalizeRecommendedDraft, prepareRecommendedSetup } from './model.ts'
import { parseGoalProposal } from './setup-assistant.ts'
import type { GoalProposal, GoalProposalPurpose } from './setup-assistant.ts'
import type { CampaignState } from './types.ts'

export function applySetupProposal(state: CampaignState, proposal: GoalProposal, purpose: GoalProposalPurpose): CampaignState {
  if (state.setupComplete) throw new Error('Exercise suggestions cannot change a committed block.')
  if (purpose !== 'interpret_goal' && purpose !== 'suggest_exercises') throw new Error('Choose a supported setup request.')
  const prepared = prepareRecommendedSetup(state)
  const draft = prepared.draft
  const setup = draft.recommendedSetup
  if (!setup) throw new Error('Start recommended setup before applying suggestions.')
  const reviewed = parseGoalProposal(JSON.stringify(proposal), draft)
  const goal = purpose === 'interpret_goal' ? {
    goalKind: reviewed.goalKind,
    goalLabel: reviewed.label,
    location: reviewed.location,
    eventDate: reviewed.eventDate ?? draft.eventDate,
    priorities: reviewed.priorities,
  } : {}
  return {
    ...prepared,
    draft: normalizeRecommendedDraft({
      ...draft, ...goal, confirmed: false,
      recommendedSetup: { ...setup, mode: 'assisted', exerciseIds: [...reviewed.exerciseIds] },
    }),
  }
}
