import { normalizeRecommendedDraft, prepareRecommendedSetup } from './model.ts'
import { parseGoalProposal } from './setup-assistant.ts'
import type { GoalProposal, GoalProposalPurpose } from './setup-assistant.ts'
import { validateSetupDate } from './setup-dates.ts'
import type { CampaignState } from './types.ts'
import { programGoalForKind } from './programming.ts'

export function applySetupProposal(
  state: CampaignState, proposal: GoalProposal, purpose: GoalProposalPurpose, confirmedDate?: string,
): CampaignState {
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
    eventDate: confirmedDate ? validateSetupDate(draft.startDate, confirmedDate) : reviewed.eventDate ?? '',
    priorities: reviewed.priorities,
  } : {}
  return {
    ...prepared,
    draft: normalizeRecommendedDraft({
      ...draft, ...goal, confirmed: false,
      ...(draft.program && purpose === 'interpret_goal' && reviewed.goalKind !== draft.goalKind
        ? { program: { ...draft.program, goal: programGoalForKind(reviewed.goalKind) } } : {}),
      recommendedSetup: { ...setup, mode: 'assisted', exerciseIds: [...reviewed.exerciseIds] },
    }),
  }
}
