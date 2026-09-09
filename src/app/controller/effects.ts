import {
  DOMAIN_VERSION,
  parseWeekPlan,
  type AthleteProfile,
  type OnboardingDraft,
  type WeekImportBundle,
  type WeekPlan,
  type WorkoutLog,
} from '../../domain/contracts.ts'
import type { LocalDateString } from '../../domain/local-date.ts'
import type { HybridCoachRepository } from '../../storage/indexeddb-repository.ts'
import {
  createAthleteProfileFromGuidedOnboardingState,
  createFixedClubWorkoutsForTargetWeek,
  createResumableOnboardingDraft,
  type GuidedOnboardingIssue,
  type GuidedOnboardingState,
} from '../state/onboarding.ts'
import {
  createBlankPlannerState,
  createPlannerStateFromWeekPlan,
  plannerStateToWeekPlan,
  type PlannerState,
} from '../state/planner.ts'
import { buildWorkoutReviewLog, getDirtyWorkoutReviewIds, type WorkoutReviewState } from '../state/review.ts'
import { createControllerId } from './ids.ts'

export interface BootstrapSnapshot {
  readonly athlete?: AthleteProfile
  readonly weekPlan?: WeekPlan
  readonly logs: readonly WorkoutLog[]
  readonly draft?: OnboardingDraft
}

export interface ManualStartResult {
  readonly athlete: AthleteProfile
  readonly planner: PlannerState
}

export interface OnboardingFinishResult {
  readonly athlete: AthleteProfile
  readonly planner: PlannerState
  readonly weekPlan?: WeekPlan
}

export type OnboardingDraftResult =
  | { readonly ok: true; readonly draft: OnboardingDraft }
  | { readonly ok: false; readonly issues: readonly GuidedOnboardingIssue[] }

export type OnboardingFinishOutcome =
  | { readonly ok: true; readonly result: OnboardingFinishResult }
  | { readonly ok: false; readonly issues: readonly GuidedOnboardingIssue[] }

export function createDefaultAthleteProfile(today: LocalDateString, name = 'Local athlete'): AthleteProfile {
  return {
    version: DOMAIN_VERSION,
    id: createControllerId('athlete'),
    createdOn: today,
    updatedOn: today,
    name,
    goal: 'Build a consistent hybrid training week.',
    sports: ['hybrid training'],
    preferredWeeklyStructure: [{ dayOfWeek: 1, modalities: ['aerobic', 'strength'] }],
    equipmentDetails: [],
    constraints: [],
    clubSessions: [],
  }
}

export async function bootstrapApp(repository: HybridCoachRepository): Promise<BootstrapSnapshot> {
  const profiles = await repository.listAthleteProfiles()
  const athlete = profiles[0]
  if (!athlete) {
    const drafts = await repository.listOnboardingDrafts()
    return { logs: [], ...(drafts[0] ? { draft: drafts[0] } : {}) }
  }

  const weekPlan = await repository.getLatestWeekPlan(athlete.id)
  const logs = weekPlan
    ? await repository.listWorkoutLogs({ athleteId: athlete.id, weekPlanId: weekPlan.id })
    : []
  const drafts = await repository.listOnboardingDrafts(athlete.id)

  return {
    athlete,
    ...(weekPlan ? { weekPlan } : {}),
    logs,
    ...(drafts[0] ? { draft: drafts[0] } : {}),
  }
}

export async function startManualWeek(
  repository: HybridCoachRepository,
  options: { readonly today: LocalDateString; readonly weekStart: LocalDateString; readonly athlete?: AthleteProfile },
): Promise<ManualStartResult> {
  const athlete = options.athlete ?? await repository.saveAthleteProfile(createDefaultAthleteProfile(options.today))
  const planner = createBlankPlannerState({
    athleteId: athlete.id,
    weekStart: options.weekStart,
    weekPlanId: createControllerId('week'),
    title: `Week of ${options.weekStart}`,
    goal: 'Plan a flexible seven-day hybrid week.',
  })
  return { athlete, planner }
}

export async function persistPlannerWeek(repository: HybridCoachRepository, planner: PlannerState): Promise<WeekPlan> {
  return repository.saveWeekPlan(plannerStateToWeekPlan(planner))
}

export async function saveOnboardingDraftState(
  repository: HybridCoachRepository,
  state: GuidedOnboardingState,
  today: LocalDateString,
): Promise<OnboardingDraftResult> {
  const result = createResumableOnboardingDraft(state, { updatedOn: today })
  if (!result.ok || !result.value) return { ok: false, issues: result.issues }
  const draft = await repository.saveOnboardingDraft(result.value)
  return { ok: true, draft }
}

export async function finalizeGuidedOnboarding(
  repository: HybridCoachRepository,
  state: GuidedOnboardingState,
  today: LocalDateString,
): Promise<OnboardingFinishOutcome> {
  const profileResult = createAthleteProfileFromGuidedOnboardingState(state, {
    updatedOn: today,
    athleteName: state.identity.athleteName ?? 'Local athlete',
  })
  if (!profileResult.ok || !profileResult.value) return { ok: false, issues: profileResult.issues }

  const athlete = await repository.saveAthleteProfile(profileResult.value)
  const weekStart = state.identity.startingWeek
  const weekPlanId = createControllerId('week')
  const clubWorkouts = createFixedClubWorkoutsForTargetWeek(athlete, {
    athleteId: athlete.id,
    weekPlanId,
    weekStart,
  })

  if (!clubWorkouts.length) {
    await repository.deleteOnboardingDraft(state.identity.draftId)
    return {
      ok: true,
      result: {
        athlete,
        planner: createBlankPlannerState({
          athleteId: athlete.id,
          weekStart,
          weekPlanId,
          title: `Week of ${weekStart}`,
          goal: athlete.goal,
        }),
      },
    }
  }

  const weekPlan = await repository.saveWeekPlan(parseWeekPlan({
    version: DOMAIN_VERSION,
    id: weekPlanId,
    athleteId: athlete.id,
    weekStart,
    title: `Week of ${weekStart}`,
    goal: athlete.goal,
    workouts: clubWorkouts,
  }))
  await repository.deleteOnboardingDraft(state.identity.draftId)

  return { ok: true, result: { athlete, planner: createPlannerStateFromWeekPlan(weekPlan), weekPlan } }
}

export async function applyWeekImport(
  repository: HybridCoachRepository,
  bundle: WeekImportBundle,
): Promise<{ readonly weekPlan: WeekPlan; readonly logs: readonly WorkoutLog[] }> {
  const imported = await repository.importWeek(bundle)
  const logs = await repository.listWorkoutLogs({
    athleteId: imported.weekPlan.athleteId,
    weekPlanId: imported.weekPlan.id,
  })
  return { weekPlan: imported.weekPlan, logs }
}

export async function saveReviewWorkoutLog(
  repository: HybridCoachRepository,
  review: WorkoutReviewState,
  workoutId: string,
): Promise<{ readonly log: WorkoutLog; readonly logs: readonly WorkoutLog[] }> {
  const log = buildWorkoutReviewLog(review, workoutId)
  const saved = await repository.saveWorkoutLog(log)
  const logs = await repository.listWorkoutLogs({ athleteId: saved.athleteId, weekPlanId: saved.weekPlanId })
  return { log: saved, logs }
}

export async function savePendingReviewWorkoutLogs(
  repository: HybridCoachRepository,
  review: WorkoutReviewState,
): Promise<{ readonly logs: readonly WorkoutLog[]; readonly savedWorkoutIds: readonly string[] }> {
  const savedWorkoutIds = getDirtyWorkoutReviewIds(review)
  const pending = savedWorkoutIds.map(workoutId => buildWorkoutReviewLog(review, workoutId))
  for (const log of pending) await repository.saveWorkoutLog(log)
  const logs = await repository.listWorkoutLogs({ athleteId: review.weekPlan.athleteId, weekPlanId: review.weekPlan.id })
  return { logs, savedWorkoutIds }
}
