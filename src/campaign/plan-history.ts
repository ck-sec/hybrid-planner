import { RECOMMENDATION_POLICY } from '../../engine/constants.ts'
import { addDays } from '../../engine/dates.ts'
import { emptyCampaign, MAX_PAST_PLANS, parseCampaign, prepareRecommendedSetup } from './model.ts'
import type { CampaignState } from './types.ts'

export function startNewPlan(state: CampaignState, startMonday: string): CampaignState {
  const { pastPlans = [], ...previous } = parseCampaign(state)
  if (!previous.setupComplete) throw new Error('You already have a new plan in setup. Continue reviewing your goal and routine.')
  if (pastPlans.length >= MAX_PAST_PLANS) {
    throw new Error('Local plan history is full. Export a backup before moving your training to a new browser profile; no history has been removed.')
  }
  const fresh = emptyCampaign(startMonday)
  const oldReviewDate = addDays(previous.draft.startDate, RECOMMENDATION_POLICY.classicReviewOffsetDays)
  const eventDate = previous.draft.eventDate > startMonday && previous.draft.eventDate !== oldReviewDate
    ? previous.draft.eventDate : fresh.draft.eventDate
  const next = prepareRecommendedSetup({
    ...fresh, step: 1,
    draft: previous.sample ? fresh.draft : {
      ...structuredClone(previous.draft), startDate: startMonday, eventDate,
      confirmed: false, exercises: [],
    },
    ...(!previous.sample && previous.cards ? { cards: structuredClone(previous.cards) } : {}),
    pastPlans: [...pastPlans, previous],
  })
  return parseCampaign(next)
}

export function trainingRecords(state: CampaignState) {
  return [...(state.pastPlans ?? []), state].flatMap((plan, planIndex) =>
    plan.weeks.flatMap(week => Object.entries(week.logs).flatMap(([id, log]) => {
      const session = [...week.plan.sessions, ...week.removed].find(item => item.id === id)
      if (!session) throw new Error('A training record is missing its saved session.')
      return [{
        key: `${planIndex}:${week.input.weekIndex}:${id}`,
        session, log, library: week.input.library,
        goalLabel: week.input.block.goal.label, sample: plan.sample,
        previousPlan: planIndex < (state.pastPlans?.length ?? 0),
      }]
    })),
  ).sort((a, b) => b.session.date.localeCompare(a.session.date))
}
