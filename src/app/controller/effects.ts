import {
  DOMAIN_VERSION,
  parseAthleteProfile,
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
  deletePlannerWorkout,
  type PlannerState,
} from '../state/planner.ts'
import { buildWorkoutReviewLog, buildWorkoutReviewPayload, getDirtyWorkoutReviewIds, type WorkoutReviewState } from '../state/review.ts'
import { buildContinuationWeekPrompt, buildInitialWeekPrompt } from '../../ai/index.ts'
import { buildInitialPromptInputFromAthleteProfile } from '../state/ai-handoff.ts'
import type { HandoffSlice } from './state.ts'
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
  expectedAthleteProfile?: AthleteProfile,
): Promise<{ readonly weekPlan: WeekPlan; readonly logs: readonly WorkoutLog[]; readonly athleteProfile?: AthleteProfile }> {
  const current = await repository.getAthleteProfile(bundle.weekPlan.athleteId)
  if (!current) throw new Error('Create an athlete profile before applying a week.')
  const currentProfile = parseAthleteProfile(current)
  const expected = expectedAthleteProfile === undefined ? currentProfile : parseAthleteProfile(expectedAthleteProfile)
  if (JSON.stringify(expected) !== JSON.stringify(currentProfile)) {
    throw new Error('The athlete profile changed after preview. Preview the week again before applying it.')
  }
  if (bundle.athleteProfile) {
    const { planningContext: _proposedContext, updatedOn: proposedUpdatedOn, ...proposedFields } = parseAthleteProfile(bundle.athleteProfile)
    const { planningContext: _currentContext, updatedOn: currentUpdatedOn, ...currentFields } = currentProfile
    if (JSON.stringify(proposedFields) !== JSON.stringify(currentFields) || proposedUpdatedOn < currentUpdatedOn) {
      throw new Error('The athlete profile changed after preview. Preview the week again before applying it.')
    }
  }
  const imported = await repository.importWeek(bundle, { expectedAthleteProfile: expected })
  return { weekPlan: imported.weekPlan, logs: imported.workoutLogs, ...(imported.athleteProfile ? { athleteProfile: imported.athleteProfile } : {}) }
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
  if (pending.length) {
    const weekPlan = await repository.getWeekPlan(review.weekPlan.id)
    if (!weekPlan) throw new Error('Save the week before saving its workout logs.')
    const imported = await repository.importWeek({ weekPlan, workoutLogs: pending })
    return { logs: imported.workoutLogs, savedWorkoutIds }
  }
  const logs = await repository.listWorkoutLogs({ athleteId: review.weekPlan.athleteId, weekPlanId: review.weekPlan.id })
  return { logs, savedWorkoutIds }
}

export async function saveReviewWeek(repository: HybridCoachRepository, review: WorkoutReviewState) {
  const payload = buildWorkoutReviewPayload(review)
  const imported = await repository.importWeek({ weekPlan: payload.weekPlan, workoutLogs: [...payload.workoutLogs] })
  return { weekPlan: imported.weekPlan, logs: imported.workoutLogs, savedWorkoutIds: review.workouts.filter(workout => workout.isLogged).map(workout => workout.workout.id) }
}

export async function deleteRecordedPlannerWorkout(repository: HybridCoachRepository, planner: PlannerState, localId: string) {
  const entry = planner.present.week.workouts.find(workout => workout.localId === localId)
  if (!entry) throw new Error('The workout to delete no longer exists in this week.')
  const next = deletePlannerWorkout(planner, localId)
  const weekPlan = plannerStateToWeekPlan(next)
  const imported = await repository.importWeek({ weekPlan, workoutLogs: [] }, { deleteWorkoutIds: [entry.workout.id] })
  return { planner: next, weekPlan: imported.weekPlan, logs: imported.workoutLogs }
}

export function refreshHandoffPrompt(
  athlete: AthleteProfile,
  handoff: HandoffSlice,
  defaultWeekStart: LocalDateString,
  review?: WorkoutReviewState,
) {
  const targetWeekStart = handoff.targetWeekStart ?? defaultWeekStart
  const input = buildInitialPromptInputFromAthleteProfile(athlete, targetWeekStart)
  if (handoff.kind === 'continuation') {
    if (!review) throw new Error('Open the previous week review before refreshing its continuation brief.')
    const payload = buildWorkoutReviewPayload(review)
    return { kind: handoff.kind, targetWeekStart, promptText: buildContinuationWeekPrompt({ ...input, previousWeek: payload.previousWeek }).prompt }
  }
  return { kind: handoff.kind, targetWeekStart, promptText: buildInitialWeekPrompt(input).prompt }
}
