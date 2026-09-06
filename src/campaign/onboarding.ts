import { LIMITS, RECOMMENDATION_POLICY } from '../../engine/constants.ts'
import { addDays, dayOfWeek } from '../../engine/dates.ts'
import type { CustomExerciseSpec } from '../../engine/types.ts'
import { stageCustomExercises } from './custom-exercises.ts'
import { CAMPAIGN_TEXT_LIMITS } from './draft-limits.ts'
import { resourcesForEquipment } from './equipment.ts'
import { buildCampaign, confirmSetupEquipment, normalizeRecommendedDraft, prepareRecommendedSetup } from './model.ts'
import { MAX_GOAL_TEXT_LENGTH } from './setup-assistant.ts'
import { selectProgramExercises } from './programming.ts'
import { validateSetupDate } from './setup-dates.ts'
import type { CampaignDraft, CampaignState, RecommendedSetup } from './types.ts'

export const ONBOARDING_STEPS = [
  { value: 1, label: 'Goal' },
  { value: 2, label: 'Routine' },
  { value: 5, label: 'Review & build' },
] as const

export function onboardingStep(step: number): 1 | 2 | 5 {
  if (step === 2 || step === 4 || step === 6) return 2
  if (step === 3 || step === 5) return 5
  return 1
}

export function goalLabelFromText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, CAMPAIGN_TEXT_LIMITS.goalLabel).trimEnd()
}

export function onboardingGoalText(draft: CampaignDraft): string {
  return draft.recommendedSetup?.goalText
    || (draft.recommendedSetup?.typicalRunMinutes || draft.goalKind !== 'hybrid' ? draft.goalLabel : '')
}

export function onboardingReviewDate(start: string): string {
  try { return addDays(start, RECOMMENDATION_POLICY.classicReviewOffsetDays) } catch { return '' }
}

export function patchOnboardingDraft(
  draft: CampaignDraft, change: Partial<CampaignDraft> = {}, preference: Partial<RecommendedSetup> = {},
): CampaignDraft {
  if (!draft.recommendedSetup) throw new Error('Prepare the recommended setup before editing your answers.')
  const goalChange = preference.goalText !== undefined
  if (goalChange && preference.goalText!.length > MAX_GOAL_TEXT_LENGTH) throw new Error('Shorten your goal description before continuing.')
  const startChanged = change.startDate !== undefined && change.startDate !== draft.startDate
  const resetReview = startChanged && (!draft.eventDate || draft.eventDate === onboardingReviewDate(draft.startDate))
  return normalizeRecommendedDraft({
    ...draft, ...change,
    ...(resetReview && change.eventDate === undefined ? { eventDate: onboardingReviewDate(change.startDate!) } : {}),
    ...(goalChange ? {
      goalLabel: goalLabelFromText(preference.goalText!),
      // An existing practice ceiling must keep its original sport contract.
      goalKind: draft.program?.comfortableThrowsPerPractice === undefined ? 'custom' : draft.goalKind,
    } : {}),
    recommendedSetup: { ...draft.recommendedSetup, ...preference, mode: 'assisted' },
    confirmed: false,
  })
}

function validateGoal(draft: CampaignDraft): CampaignDraft {
  const goalText = onboardingGoalText(draft)
  if (!goalText.trim()) throw new Error('Tell us what you want to work toward before continuing.')
  const next = patchOnboardingDraft(draft, {}, draft.recommendedSetup?.goalText && draft.goalLabel.trim() ? {} : { goalText })
  return { ...next, eventDate: validateSetupDate(next.startDate, next.eventDate || onboardingReviewDate(next.startDate)) }
}

export function validateOnboardingRoutine(draft: CampaignDraft): void {
  const positive = (value: number, max: number) => Number.isFinite(value) && value > 0 && value <= max
  if (!positive(draft.recommendedSetup?.typicalRunMinutes ?? 0, LIMITS.maxRunMinutes)
    || !positive(draft.runsPerWeek, LIMITS.maxRuns) || !Number.isInteger(draft.runsPerWeek)
    || !positive(draft.liftsPerWeek, LIMITS.maxLifts) || !Number.isInteger(draft.liftsPerWeek)
    || !positive(draft.liftDurationMin, 180)) {
    throw new Error('Choose your usual run length, run frequency, lift frequency and session length.')
  }
  if (dayOfWeek(draft.startDate) !== 0) throw new Error('Choose a Monday for your block start in Availability & fixed sessions.')
  if (!draft.availableDays.length) throw new Error('Choose at least one training day in Availability & fixed sessions.')
  if (draft.practiceDays.length && (!positive(draft.practiceDuration, 240) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.practiceTime))) {
    throw new Error('Add the usual length and start time for your fixed sessions.')
  }
}

export function advanceOnboarding(state: CampaignState): CampaignState {
  const prepared = prepareRecommendedSetup(state)
  const step = onboardingStep(state.step)
  const draft = validateGoal(prepared.draft)
  if (step === 1) return { ...prepared, draft, step: 2 }
  validateOnboardingRoutine(draft)
  if (step === 2) {
    try {
      return { ...confirmSetupEquipment({ ...prepared, draft }, draft.resources ?? resourcesForEquipment(draft.equipment)), step: 5 }
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : 'Equipment could not be confirmed.'} Check your equipment selection, including usable floor space. No kit, Home and Gym include floor space.`)
    }
  }
  return buildCampaign({ ...prepared, draft: { ...draft, confirmed: prepared.draft.confirmed } })
}

export function addOnboardingCustomExercise(
  draft: CampaignDraft, exercise: CustomExerciseSpec,
): { draft: CampaignDraft; selected: boolean } {
  const active = draft.recommendedSetup?.exerciseIds
  if (!active) throw new Error('Prepare your starting lineup before creating an exercise.')
  const staged = stageCustomExercises(draft, [exercise])
  const selected = active.includes(exercise.id) || active.length < LIMITS.maxProgramExercises
  const next = selected && !active.includes(exercise.id) ? selectProgramExercises(staged, [...active, exercise.id]) : staged
  return { draft: patchOnboardingDraft(next), selected }
}
