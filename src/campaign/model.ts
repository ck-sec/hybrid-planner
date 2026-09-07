import { generateBlock } from '../../engine/block.ts'
import {
  adaptCalendarWeek, applyCalendarPainHold, calendarSafety, calendarSessionLabel,
  followingCommitments, nextCalendarInput,
} from '../../engine/calendar.ts'
import { AI_ADVISORY_LIMITS, CAMPAIGN_POLICY, LIMITS, MAX_LOGGED_SETS_PER_BLOCK, RECOMMENDATION_POLICY } from '../../engine/constants.ts'
import { addDays, dayNumber, dayOfWeek, parseISODate, timeMinutes } from '../../engine/dates.ts'
import { DEFAULT_LIBRARY, LEGACY_LIBRARY, libraryForVersion, resolveProgramLibrary } from '../../engine/library.ts'
import { predictSessionLoad } from '../../engine/load.ts'
import { fixedSessions, planWeek, requestedSessions } from '../../engine/planner.ts'
import { recommendationForExercise, recommendedExercises } from '../../engine/recommendations.ts'
import { availableExerciseMetadata, exerciseDefaultPrescription } from '../../engine/program.ts'
import { scoreSessions } from '../../engine/scoring.ts'
import type {
  AthleteState, BlockLog, Day, Equipment, ExerciseObservation, Goal, PlanWeekInput, Quality,
  Session, SessionLog, SetLog, TargetRPE, WeekPlan, WorkoutSession,
} from '../../engine/types.ts'
import {
  parseAthleteWithOptions, parseBlockLogWithOptions, parsePlanWeekInputWithOptions, parseProgramConfigWithOptions,
  parseSession, parseSessionLog, parseSessionLogWithOptions, validateBlockLogs,
} from '../../engine/validation.ts'
import type { ValidationOptions } from '../../engine/validation.ts'
import { CAMPAIGN_TEXT_LIMITS } from './draft-limits.ts'
import { equipmentForResources, exerciseAvailable, parseResources, programResources, resourcesForEquipment } from './equipment.ts'
import { parseWorkoutCards } from './workout-cards.ts'
import { enableTemplateProgramming } from './programming.ts'
import { assertCurrentTrainingDate, parseCurrentTraining, parseTrainingPreferences } from './training-baseline.ts'
import type { TrainingPreferences } from './training-baseline.ts'
import { parseTrainingHistory } from './garmin-import.ts'
import { parseSessionFeedback } from './training-feedback.ts'
import { authoredCommitmentSessionId, buildAuthoredWeek, parseAuthoredWeekProposal } from '../../engine/authored-week.ts'
import type { AuthoredWeekProposal } from '../../engine/authored-week.ts'
import { parseAuthoredCalendar, proposalForSessions, refreshAuthoredCalendar } from './authored-calendar.ts'
import { adaptAuthoredCampaign } from './exercise-swaps.ts'
import { AI_PLANNING_OPTIONS, authoredPolicyOptions, policyForWeek } from './authored-policy.ts'
import type { ResourceId } from './equipment.ts'
import type { CalendarAction, CampaignDraft, CampaignRevision, CampaignState, CampaignWeek, RecommendedSetup, SavedPlan, SetDraft, WorkoutContent } from './types.ts'

export const MAX_PAST_PLANS = 100
export const CAMPAIGN_BACKUP_LIMIT = 50_000_000

const EQUIPMENT: readonly Equipment[] = ['barbell', 'dumbbell', 'kettlebell', 'machine', 'cable', 'bodyweight', 'bands', 'none']
const QUALITIES: readonly Quality[] = ['aerobic_base', 'threshold', 'vo2max', 'repeat_sprint', 'change_of_direction', 'max_strength', 'power', 'strength_endurance', 'shoulder_durability']
const GOALS = ['dodgeball', 'running', 'hybrid', 'custom'] as const
const DRAFT_FIELDS = ['goalKind', 'goalLabel', 'location', 'eventDate', 'startDate', 'priorities', 'availableDays', 'practiceDays', 'practiceTime', 'practiceDuration', 'weeklyRunMinutes', 'runsPerWeek', 'liftsPerWeek', 'liftDurationMin', 'weeklyTimeBudgetMin', 'equipment', 'exercises', 'confirmed']
const ASSUMPTIONS = [
  'The longest-run cap is the conservative average of your confirmed comfortable weekly minutes and run count, not an observed longest run.',
  `Practice scheduling costs are a fixed duration-based heuristic (${CAMPAIGN_POLICY.practiceCostPerMinute.systemic} systemic / ${CAMPAIGN_POLICY.practiceCostPerMinute.structural} structural AU per minute), not measured fatigue or an observed training baseline. Campaign policy: ${CAMPAIGN_POLICY.version}.`,
  'No unlogged session or suggested weight is counted as completed work. Workloads do not automatically progress.',
]

function fail(message: string): never { throw new Error(message) }
function object(value: unknown, label: string, fields?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) fail(`${label} must be a plain object.`)
  const data = value as Record<string, unknown>
  for (const key of Reflect.ownKeys(data)) {
    const descriptor = Object.getOwnPropertyDescriptor(data, key)
    if (typeof key !== 'string' || !descriptor || !('value' in descriptor)) fail(`${label} has unsupported properties.`)
  }
  if (fields && (fields.some(key => !Object.hasOwn(data, key)) || Object.keys(data).some(key => !fields.includes(key)))) {
    fail(`${label} has missing or unsupported fields.`)
  }
  return data
}
function array(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) fail(`${label} must be a bounded array.`)
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !('value' in descriptor)) fail(`${label} cannot have missing or accessor elements.`)
  }
  if (Reflect.ownKeys(value).length !== value.length + 1) fail(`${label} has unsupported array fields.`)
  return value as unknown[]
}
function number(value: unknown, label: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    fail(`${label} must be a finite ${integer ? 'whole ' : ''}number from ${min} to ${max}.`)
  }
  return value
}
function text(value: unknown, label: string, max = 4000): string {
  if (typeof value !== 'string' || value.length > max) fail(`${label} must be text of at most ${max} characters.`)
  return value
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} must be true or false.`)
  return value
}
function choice<T extends string>(value: unknown, label: string, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) fail(`${label} is not supported.`)
  return value as T
}
function unique<T>(values: T[], label: string): T[] {
  if (new Set(values).size !== values.length) fail(`${label} contains duplicates.`)
  return values
}
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}
function equal(left: unknown, right: unknown, label: string): void {
  if (stable(left) !== stable(right)) fail(`${label} does not match its validated derived values.`)
}

function monday(value: unknown): string {
  const date = parseISODate(value)
  if (dayOfWeek(date) !== 0) fail('The campaign must start on a Monday.')
  return date
}

export function emptyCampaign(startMonday: string): CampaignState {
  const start = monday(startMonday)
  return {
    version: 1, step: 0, setupComplete: false, sample: false, weeks: [], selectedWeek: 0, setDrafts: {},
    draft: {
      goalKind: 'hybrid', goalLabel: 'Run + lift', location: '', eventDate: addDays(start, RECOMMENDATION_POLICY.classicReviewOffsetDays), startDate: start,
      priorities: [...RECOMMENDATION_POLICY.classicQualityBias], availableDays: [0, 1, 2, 3, 4, 5, 6],
      practiceDays: [], practiceTime: '19:00', practiceDuration: 0,
      weeklyRunMinutes: 0, runsPerWeek: 0, liftsPerWeek: 0, liftDurationMin: 0,
      weeklyTimeBudgetMin: 0, equipment: ['bodyweight'], exercises: [], confirmed: false,
      recommendedSetup: {
        version: 1, mode: 'classic', goalText: '', typicalRunMinutes: 0,
        exerciseIds: [...recommendedExercises(['bodyweight'])],
      },
    },
  }
}

/** Deliberately labelled fictional inputs; loading them does not confirm or log them. */
export function exampleCampaign(startMonday: string): CampaignState {
  const state = emptyCampaign(startMonday)
  return {
    ...state, sample: true, step: 1,
    draft: normalizeRecommendedDraft({
      ...state.draft, goalKind: 'dodgeball', goalLabel: 'Sample: Bangkok dodgeball tournament', location: 'Bangkok',
      priorities: ['repeat_sprint', 'change_of_direction', 'shoulder_durability', 'power'],
      practiceDays: [1, 3], practiceTime: '19:00', practiceDuration: 90,
      weeklyRunMinutes: 90, runsPerWeek: 3, liftsPerWeek: 2, liftDurationMin: 45,
      weeklyTimeBudgetMin: 360, equipment: ['dumbbell', 'bodyweight'],
      exercises: [],
      recommendedSetup: {
        version: 1, mode: 'assisted',
        goalText: 'I’m preparing for the Dodgeball World Championships in Bangkok. I want to keep running and lifting around practice.',
        typicalRunMinutes: 30, exerciseIds: [...recommendedExercises(['dumbbell', 'bodyweight'])],
      },
    }),
  }
}

export function confirmSetupEquipment(state: CampaignState, resources: readonly ResourceId[]): CampaignState {
  if (state.setupComplete || state.weeks.length) fail('Existing plans can only change through a reviewed next-week revision.')
  const prepared = prepareRecommendedSetup(state)
  const selected = parseResources([...resources])
  const draft = { ...prepared.draft, resources: selected, equipment: equipmentForResources(selected), confirmed: false }
  return { ...prepared, draft: normalizeRecommendedDraft(draft.program ? draft : enableTemplateProgramming(draft)) }
}

/** Only recommended drafts derive totals; legacy observed drafts are returned unchanged. */
export function normalizeRecommendedDraft(draft: CampaignDraft): CampaignDraft {
  if (!draft.recommendedSetup) return draft
  if (draft.currentTraining) {
    const reported = parseCurrentTraining(draft.currentTraining)
    draft = {
      ...draft, currentTraining: reported, weeklyRunMinutes: reported.weeklyRunMinutes,
      runsPerWeek: reported.runsPerWeek, liftsPerWeek: reported.liftsPerWeek, liftDurationMin: reported.liftDurationMin,
      recommendedSetup: { ...draft.recommendedSetup, typicalRunMinutes: reported.longestRunMinutes },
    }
  }
  const weeklyRunMinutes = draft.currentTraining?.weeklyRunMinutes
    ?? draft.recommendedSetup!.typicalRunMinutes * draft.runsPerWeek
  const weeklyTimeBudgetMin = weeklyRunMinutes + draft.liftsPerWeek * draft.liftDurationMin
    + draft.practiceDays.length * draft.practiceDuration
    + (draft.program?.conditioningBaselines.reduce((sum, item) => sum + (item.modality.startsWith('run_') ? 0 : item.weeklyMinutes), 0) ?? 0)
  number(weeklyRunMinutes, 'Derived weekly running time', -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  number(weeklyTimeBudgetMin, 'Derived normal training time', -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  const normalized: CampaignDraft = {
    ...draft, weeklyRunMinutes, weeklyTimeBudgetMin,
    ...(draft.program ? { program: {
      ...draft.program,
      resources: programResources(draft.resources ?? resourcesForEquipment(draft.equipment)),
      selectedExerciseIds: draft.recommendedSetup!.exerciseIds.toSorted(),
      conditioningBaselines: draft.program.conditioningBaselines.toSorted((a, b) => a.modality.localeCompare(b.modality)),
    } } : {}),
  }
  if (draft.recommendedSetup!.mode === 'classic') {
    normalized.goalKind = 'hybrid'
    normalized.priorities = [...RECOMMENDATION_POLICY.classicQualityBias]
    try {
      normalized.eventDate = addDays(draft.startDate, RECOMMENDATION_POLICY.classicReviewOffsetDays)
    } catch {
      normalized.eventDate = ''
    }
  }
  if (normalized.program) {
    normalized.program = parseProgramConfigWithOptions(normalized.program, AI_PLANNING_OPTIONS)
    if (normalized.program.comfortableThrowsPerPractice !== undefined && ((normalized.goalKind !== 'dodgeball' && normalized.practiceProfile !== 'controlled_target_throw') || !normalized.practiceDays.length)) {
      fail('Remove the generated throwing block before removing its established dodgeball practice or changing sport.')
    }
  }
  return normalized
}

/** An explicit onboarding upgrade, never an implicit rewrite of saved calendars. */
export function prepareRecommendedSetup(state: CampaignState): CampaignState {
  if (state.setupComplete || state.weeks.length || state.draft.recommendedSetup) return state
  const draft = parseDraft(state.draft)
  const equipment: Equipment[] = draft.equipment.length ? [...draft.equipment] : ['bodyweight']
  const selected = draft.exercises.filter(item => {
    const exercise = DEFAULT_LIBRARY.exercises.find(exercise => exercise.id === item.exerciseId)
    return exercise && !exercise.highSkill
      && (RECOMMENDATION_POLICY.supportedExerciseIds as readonly string[]).includes(exercise.id)
      && exercise.equipment.every(item => item === 'none' || equipment.includes(item))
  }).map(item => item.exerciseId)
  const exerciseIds = selected.length ? selected : [...recommendedExercises(equipment)]
  const exercises = draft.exercises.filter(item => {
    if (!exerciseIds.includes(item.exerciseId)) return false
    try {
      const age = dayNumber(draft.startDate) - dayNumber(item.date)
      return age >= 0 && age <= CAMPAIGN_POLICY.maximumBaselineObservationAgeDays
        && item.sets >= 1 && item.sets <= 10 && Number.isInteger(item.sets)
        && item.reps >= 1 && item.reps <= 50 && Number.isInteger(item.reps)
        && item.weightKg >= 0 && item.weightKg <= 500 && item.experienceMonths >= 0 && item.experienceMonths <= 1200
        && item.actualRPE >= 6 && item.actualRPE <= CAMPAIGN_POLICY.comfortableObservationRpeMax && Number.isInteger(item.actualRPE * 2)
    } catch { return false }
  })
  return { ...state, draft: normalizeRecommendedDraft({
    ...draft, equipment, exercises, confirmed: false, goalLabel: draft.goalLabel || 'Run + lift',
    recommendedSetup: {
      version: 1, mode: draft.goalKind === 'hybrid' ? 'classic' : 'assisted', goalText: draft.goalLabel,
      typicalRunMinutes: draft.runsPerWeek > 0 ? Math.min(LIMITS.maxRunMinutes, Math.max(0, Math.floor(draft.weeklyRunMinutes / draft.runsPerWeek))) : 0,
      exerciseIds,
    },
  }) }
}

function parseDraft(value: unknown, ready = false): CampaignDraft {
  const candidate = object(value, 'Campaign draft')
  const raw = object(candidate, 'Campaign draft', [...DRAFT_FIELDS, ...['recommendedSetup', 'resources', 'program', 'trainingPreferences', 'currentTraining', 'trainingHistory', 'practiceProfile'].filter(key => Object.hasOwn(candidate, key))])
  const program = Object.hasOwn(raw, 'program') ? parseProgramConfigWithOptions(raw.program, AI_PLANNING_OPTIONS) : undefined
  const library = program ? resolveProgramLibrary(program, AI_PLANNING_OPTIONS) : DEFAULT_LIBRARY
  const draftNumber = (value: unknown, label: string, min: number, max: number, integer = false): number =>
    ready ? number(value, label, min, max, integer) : number(value, label, -1_000_000, 1_000_000)
  const draftDate = (value: unknown, label: string): string =>
    ready ? parseISODate(value) : text(value, label, 10)
  let recommendedSetup: RecommendedSetup | undefined
  if (Object.hasOwn(raw, 'recommendedSetup')) {
    const setup = object(raw.recommendedSetup, 'Recommended setup', ['version', 'mode', 'goalText', 'typicalRunMinutes', 'exerciseIds'])
    if (setup.version !== 1) fail('Unsupported recommended setup version.')
    const exerciseIds = unique(array(setup.exerciseIds, 'Recommended exercises', program ? LIMITS.maxProgramExercises : RECOMMENDATION_POLICY.maxExercises).map(value => {
      const id = text(value, 'Recommended exercise ID', 80)
      if (program) exerciseDefaultPrescription(id, library)
      else recommendationForExercise(id)
      return id
    }), 'Recommended exercises')
    if (ready && !exerciseIds.length) fail('Choose at least one recommended exercise.')
    recommendedSetup = {
      version: 1, mode: choice(setup.mode, 'Setup mode', ['classic', 'assisted']),
      goalText: text(setup.goalText, 'Goal description', LIMITS.maxNotesLength),
      typicalRunMinutes: draftNumber(setup.typicalRunMinutes, 'Usual run duration', Object.hasOwn(raw, 'currentTraining') ? 0 : 1, AI_ADVISORY_LIMITS.maxRunMinutes),
      exerciseIds,
    }
  }
  const exercises = array(raw.exercises, 'Exercise observations', LIMITS.maxExercises).map((value): ExerciseObservation => {
    const item = object(value, 'Exercise observation', ['exerciseId', 'date', 'weightKg', 'sets', 'reps', 'actualRPE', 'experienceMonths'])
    const exerciseId = text(item.exerciseId, 'Exercise ID', 80)
    if (!library.exercises.some(exercise => exercise.id === exerciseId)) fail(`Unknown exercise ${exerciseId}.`)
    const actualRPE = draftNumber(item.actualRPE, 'Observed set RPE', 6, 10)
    if (ready && !Number.isInteger(actualRPE * 2)) fail('Observed set RPE must use half-point steps.')
    return {
      exerciseId, date: draftDate(item.date, 'Observation date'), weightKg: draftNumber(item.weightKg, 'Observed weight', 0, 500),
      sets: draftNumber(item.sets, 'Observed sets', 1, 10, true), reps: draftNumber(item.reps, 'Observed reps', 1, 50, true),
      actualRPE: actualRPE as TargetRPE, experienceMonths: draftNumber(item.experienceMonths, 'Exercise experience', 0, 1200),
    }
  })
  unique(exercises.map(exercise => exercise.exerciseId), 'Exercise observations')
  const days = (value: unknown, label: string): Day[] => unique(array(value, label, 7).map(day => number(day, label, 0, 6, true) as Day), label)
  const practiceTime = text(raw.practiceTime, 'Practice time', 5)
  if (ready) timeMinutes(practiceTime)
  const result: CampaignDraft = {
    goalKind: choice(raw.goalKind, 'Goal type', GOALS), goalLabel: text(raw.goalLabel, 'Goal label', CAMPAIGN_TEXT_LIMITS.goalLabel),
    location: text(raw.location, 'Location', CAMPAIGN_TEXT_LIMITS.location), startDate: ready ? monday(raw.startDate) : draftDate(raw.startDate, 'Block start date'),
    eventDate: draftDate(raw.eventDate, 'Event date'),
    priorities: unique(array(raw.priorities, 'Priorities', QUALITIES.length).map(value => choice(value, 'Priority', QUALITIES)), 'Priorities'),
    availableDays: days(raw.availableDays, 'Available days'), practiceDays: days(raw.practiceDays, 'Practice days'),
    practiceTime, practiceDuration: draftNumber(raw.practiceDuration, 'Practice duration', 0, 1440),
    weeklyRunMinutes: draftNumber(raw.weeklyRunMinutes, 'Weekly run minutes', 0, AI_ADVISORY_LIMITS.maxWeeklyRunMinutes),
    runsPerWeek: draftNumber(raw.runsPerWeek, 'Runs per week', 0, AI_ADVISORY_LIMITS.maxRuns, true),
    liftsPerWeek: draftNumber(raw.liftsPerWeek, 'Lifts per week', 0, AI_ADVISORY_LIMITS.maxLifts, true),
    liftDurationMin: draftNumber(raw.liftDurationMin, 'Lift duration', 0, AI_ADVISORY_LIMITS.maxLiftMinutes),
    weeklyTimeBudgetMin: draftNumber(raw.weeklyTimeBudgetMin, 'Weekly time budget', 0, AI_ADVISORY_LIMITS.maxWeeklyRunMinutes),
    equipment: unique(array(raw.equipment, 'Equipment', EQUIPMENT.length).map(value => choice(value, 'Equipment', EQUIPMENT)), 'Equipment'),
    ...(Object.hasOwn(raw, 'resources') ? { resources: parseResources(raw.resources) } : {}),
    ...(program ? { program } : {}),
    exercises, confirmed: boolean(raw.confirmed, 'Baseline confirmation'),
    ...(recommendedSetup ? { recommendedSetup } : {}),
    ...(Object.hasOwn(raw, 'trainingPreferences') ? { trainingPreferences: parseTrainingPreferences(raw.trainingPreferences) } : {}),
    ...(Object.hasOwn(raw, 'currentTraining') ? { currentTraining: parseCurrentTraining(raw.currentTraining) } : {}),
    ...(Object.hasOwn(raw, 'trainingHistory') ? { trainingHistory: parseTrainingHistory(raw.trainingHistory) } : {}),
    ...(Object.hasOwn(raw, 'practiceProfile') ? { practiceProfile: choice(raw.practiceProfile, 'Practice profile', ['controlled_target_throw'] as const) } : {}),
  }
  if (result.currentTraining) {
    equal([result.weeklyRunMinutes, result.runsPerWeek, result.liftsPerWeek, result.liftDurationMin, result.recommendedSetup?.typicalRunMinutes],
      [result.currentTraining.weeklyRunMinutes, result.currentTraining.runsPerWeek, result.currentTraining.liftsPerWeek, result.currentTraining.liftDurationMin, result.currentTraining.longestRunMinutes],
      'Reported baseline')
  }
  if (result.resources) equal(result.equipment.toSorted(), equipmentForResources(result.resources).toSorted(), 'Equipment capabilities')
  if (program) {
    equal(program.resources.toSorted(), programResources(result.resources ?? resourcesForEquipment(result.equipment)).toSorted(), 'Program resource capabilities')
    equal(program.selectedExerciseIds?.toSorted(), recommendedSetup?.exerciseIds.toSorted(), 'Program exercise selection')
    if (program.comfortableThrowsPerPractice !== undefined && ((result.goalKind !== 'dodgeball' && result.practiceProfile !== 'controlled_target_throw') || !result.practiceDays.length)) {
      fail('Throwing blocks need an established dodgeball practice, not a standalone extra session.')
    }
    for (const baseline of program.conditioningBaselines) {
      const resource = baseline.modality === 'row' ? 'rower' : baseline.modality === 'ski_erg' ? 'ski_erg' : baseline.modality.startsWith('bike_') ? 'bike' : null
      if (resource && !result.resources?.includes(resource)) fail(`The ${baseline.modality} baseline requires its explicitly selected equipment.`)
      if (baseline.modality.startsWith('run_')) {
        equal(baseline, {
          modality: baseline.modality, weeklyMinutes: result.weeklyRunMinutes,
          longestSessionMinutes: recommendedSetup?.typicalRunMinutes,
          sessionsPerWeek: result.runsPerWeek,
        }, 'Program running baseline')
      }
    }
  }
  if (ready && recommendedSetup) {
    const derived = normalizeRecommendedDraft(result)
    equal(result.weeklyRunMinutes, derived.weeklyRunMinutes, 'Derived weekly running time')
    equal(result.weeklyTimeBudgetMin, derived.weeklyTimeBudgetMin, 'Derived normal training time')
    for (const id of recommendedSetup.exerciseIds) {
      const exercise = library.exercises.find(item => item.id === id)!
      if (!exercise.equipment.every(item => item === 'none' || result.equipment.includes(item))) {
        fail(`Your equipment does not support the selected ${exercise.name}. Choose another card or correct the available equipment.`)
      }
      if (program && !availableExerciseMetadata(program.resources, library).some(item => item.id === id)) {
        fail(`Your equipment or space does not support ${exercise.name}. Review its template requirements before planning.`)
      }
      if (!program && result.resources && !exerciseAvailable(id, result.resources)) {
        fail(`Your equipment or space does not support ${exercise.name}. Review the card or equipment before planning.`)
      }
    }
  }
  return result
}

function baselineForDraft(draft: CampaignDraft, options: ValidationOptions = {}): AthleteState {
  if (!draft.confirmed) fail('Confirm that these are your recent, comfortable training inputs before creating a calendar.')
  if (draft.trainingPreferences && !draft.currentTraining) {
    fail('Your desired routine is not a baseline. Discuss current training in chat or enter it in the local assessment before building.')
  }
  if (draft.currentTraining) assertCurrentTrainingDate(draft.currentTraining, draft.startDate)
  if (!draft.goalLabel.trim() || !draft.priorities.length) fail('Name your goal and choose at least one priority.')
  if (options.policy !== 'ai-advisory' && (!draft.weeklyRunMinutes || !draft.runsPerWeek || !draft.liftsPerWeek || !draft.liftDurationMin)) {
    if (draft.currentTraining) fail('The built-in planner requires nonzero running and lifting baselines. Keep your truthful report and review an AI-authored week instead; no capacity is invented.')
    if (draft.recommendedSetup) fail('Confirm your usual run duration, runs and lifts per week, and lifting session length. Unknown zero values cannot become invented training observations.')
    fail('A confirmed recent running and lifting baseline, including a known exercise, is required by this engine. Unknown zero values cannot become invented training observations.')
  }
  if (options.policy !== 'ai-advisory' && !draft.recommendedSetup && !draft.exercises.length) {
    fail('A confirmed recent running and lifting baseline, including a known exercise, is required by this engine. Unknown zero values cannot become invented training observations.')
  }
  for (const observation of draft.exercises) {
    const age = dayNumber(draft.startDate) - dayNumber(observation.date)
    if (age < 0 || age > CAMPAIGN_POLICY.maximumBaselineObservationAgeDays) {
      fail(`Exercise observations must be from the ${CAMPAIGN_POLICY.maximumBaselineObservationAgeDays} days before the campaign starts.`)
    }
    if (options.policy !== 'ai-advisory' && observation.actualRPE > CAMPAIGN_POLICY.comfortableObservationRpeMax) {
      fail(`Use a recent comfortable exercise observation at RPE ${CAMPAIGN_POLICY.comfortableObservationRpeMax} or lower, not a maximal test.`)
    }
  }
  if (draft.practiceDays.length > LIMITS.maxCommitments) fail(`Choose at most ${LIMITS.maxCommitments} fixed practices.`)
  if (draft.practiceDays.length && draft.practiceDuration <= 0) fail('Fixed practices need an explicit positive duration.')
  if (options.policy !== 'ai-advisory' && (draft.runsPerWeek > LIMITS.maxRuns || draft.liftsPerWeek > LIMITS.maxLifts
    || draft.weeklyRunMinutes > LIMITS.maxWeeklyRunMinutes || (draft.recommendedSetup?.typicalRunMinutes ?? 0) > LIMITS.maxRunMinutes
    || draft.liftDurationMin > 180)) {
    fail('This reported baseline exceeds the built-in planner’s supported limits. Keep the facts unchanged and review an AI-authored week instead.')
  }
  const program = draft.program && options.policy === 'ai-advisory' ? {
    ...draft.program, resources: programResources(draft.resources ?? resourcesForEquipment(draft.equipment), options),
  } : draft.program
  return parseAthleteWithOptions({
    baseline: {
      asOf: draft.currentTraining?.asOf ?? draft.startDate, weeklyRunMinutes: draft.weeklyRunMinutes,
      longestRunMinutes: draft.recommendedSetup?.typicalRunMinutes
        ?? Math.min(LIMITS.maxRunMinutes, Math.floor(draft.weeklyRunMinutes / draft.runsPerWeek)),
      runsPerWeek: draft.runsPerWeek, liftsPerWeek: draft.liftsPerWeek, liftDurationMin: draft.liftDurationMin,
      exercises: draft.exercises,
    },
    calibration: { version: 1, costMultiplier: 1, observationCount: 0 },
    availableDays: draft.availableDays, equipment: draft.equipment, weeklyTimeBudgetMin: draft.weeklyTimeBudgetMin,
    defaultStartTime: '07:00', aggressiveness: 'conservative',
    residual: { asOfDate: draft.startDate, asOfTime: '00:00', load: { systemic: 0, structural: 0 } },
    safetyHold: null,
    ...(program ? { program } : draft.recommendedSetup ? { recommendedExerciseIds: draft.recommendedSetup.exerciseIds } : {}),
  }, options)
}

function goalForDraft(draft: CampaignDraft): Goal {
  return {
    label: draft.goalLabel.trim(), peakDate: draft.eventDate, qualityBias: draft.priorities, protectedExerciseIds: [],
    fixedCommitments: [...draft.practiceDays].sort((a, b) => a - b).map(day => ({
      id: `practice-${day}`, label: draft.goalKind === 'dodgeball' ? 'Dodgeball practice' : `${draft.goalKind === 'custom' ? 'Goal' : draft.goalKind[0]!.toUpperCase() + draft.goalKind.slice(1)} practice`,
      dayOfWeek: day, startTime: draft.practiceTime, durationMin: draft.practiceDuration,
      discipline: 'sport', modality: draft.goalKind === 'dodgeball' || draft.practiceProfile === 'controlled_target_throw' ? 'court_sport' : 'other',
      estimatedLoad: {
        systemic: draft.practiceDuration * CAMPAIGN_POLICY.practiceCostPerMinute.systemic,
        structural: draft.practiceDuration * CAMPAIGN_POLICY.practiceCostPerMinute.structural,
      },
    })),
  }
}

function campaignPlanCopy(plan: WeekPlan): WeekPlan {
  return { ...plan, feasibility: { ...plan.feasibility,
    issues: [...plan.safety.violations.map(item => item.message), ...plan.omitted.map(item => item.reason)],
  } }
}

function assumptionsForDraft(draft: CampaignDraft): readonly string[] {
  return draft.recommendedSetup ? [
    draft.currentTraining
      ? 'Reported weekly running time and longest comfortable run remain independent observations. Desired average durations are preferences, not caps on individual sessions.'
      : 'Running totals and the normal training-time budget come from your confirmed usual session lengths and frequencies, not a separate weekly-minute estimate.',
    ...ASSUMPTIONS.slice(1),
    draft.program
      ? 'Exercise templates have separate doses, logging units and execution styles. Scheduling coefficients are hand-authored estimates, not measured fatigue or injury risk. No starting kilograms are invented.'
      : `Exercise recommendations use policy ${RECOMMENDATION_POLICY.version}. They are not observations; kilograms are never invented, including for bodyweight movements.`,
  ] : ASSUMPTIONS
}

export function budgetBuiltInSessions(planned: readonly Session[], preferences: TrainingPreferences): Session[] {
  const desired = parseTrainingPreferences(preferences)
  let runs = 0, lifts = 0
  const sessions = planned.filter(session => {
    if (session.kind === 'commitment' || (session.kind === 'workout' && session.sourceCommitmentId)) return true
    if (session.discipline === 'run') return desired.runDurationMin > 0 && ++runs <= desired.runsPerWeek
    if (session.discipline === 'strength') return desired.liftDurationMin > 0 && ++lifts <= desired.liftsPerWeek
    return true
  })
  const total = (discipline: Session['discipline']) => sessions.reduce((sum, session) =>
    sum + (session.discipline === discipline ? session.durationMin : 0), 0)
  const runBudget = desired.runDurationMin * desired.runsPerWeek
  const liftBudget = desired.liftDurationMin * desired.liftsPerWeek
  const runScale = Math.min(1, runBudget / (total('run') || 1))
  const liftScale = Math.min(1, liftBudget / (total('strength') || 1))
  return sessions.map(session => {
    if (session.kind === 'commitment' || (session.kind === 'workout' && session.sourceCommitmentId)) return session
    const scale = session.discipline === 'run' ? runScale : session.discipline === 'strength' ? liftScale : 1
    return scale < 1 ? { ...session, durationMin: Math.floor(session.durationMin * scale) } : session
  }).filter(session => session.durationMin > 0)
}

function builtInWeekForDraft(input: PlanWeekInput, draft: CampaignDraft): { plan: WeekPlan; authored?: AuthoredWeekProposal } {
  const plan = planWeek(input)
  const desired = draft.trainingPreferences
  if (!desired || !draft.program) return { plan }
  const budgeted = budgetBuiltInSessions(plan.sessions, desired)
  if (stable(budgeted) === stable(plan.sessions)) return { plan }
  const authored = proposalForSessions(plan.weekStart, budgeted)
  return { authored, plan: buildAuthoredWeek(input, authored) }
}

export function buildCampaign(state: CampaignState): CampaignState {
  if (state.weeks.length || state.setupComplete) fail('An existing campaign cannot be overwritten. Start a new campaign to confirm a new baseline.')
  if (!state.draft.confirmed) fail('Confirm that these are your recent, comfortable training inputs before creating a calendar.')
  const draft = parseDraft(normalizeRecommendedDraft(parseDraft(state.draft)), true)
  const options: ValidationOptions = state.pendingWeek ? AI_PLANNING_OPTIONS : {}
  const input = initialCampaignInput(draft, options)
  const builtIn = state.pendingWeek ? undefined : builtInWeekForDraft(input, draft)
  const authored = state.pendingWeek ? parseAuthoredWeekProposal(state.pendingWeek, options) : builtIn?.authored
  const planned = campaignPlanCopy(authored ? buildAuthoredWeek(input, authored, options) : builtIn!.plan)
  if (!planned.safety.passed) fail(`${state.pendingWeek ? 'No calendar can be saved until hard app checks pass' : 'No safe calendar can be saved'}: ${planned.safety.violations.map(item => item.message).join(' ')}`)
  const plan = { ...planned, warnings: [...planned.warnings, ...assumptionsForDraft(draft),
    ...(state.sample ? ['Sample campaign: all baseline examples are fictional, not your observed history.'] : []),
    ...(!planned.feasibility.fits ? ['The safe calendar omits work. Review the visible feasibility issues before following it.'] : []),
  ] }
  const next: CampaignState = { ...state, draft, setupComplete: true, step: 5, selectedWeek: 0,
    weeks: [{ input, plan, logs: {}, removed: [], ...(authored ? { authored } : {}),
      changes: [{ id: 'change-0-1', message: authored
        ? 'Approved the proposed week after deterministic app checks. This is not medical clearance; no workouts are logged automatically.'
        : 'Created a baseline-bounded calendar. Fixed practices are pinned; no workouts are logged automatically.' }] }] }
  delete next.pendingWeek
  return next
}

function initialCampaignInput(draft: CampaignDraft, options: ValidationOptions = {}): PlanWeekInput {
  const athlete = baselineForDraft(draft, options)
  const library = athlete.program ? resolveProgramLibrary(athlete.program, options) : LEGACY_LIBRARY
  const block = generateBlock(athlete, goalForDraft(draft), draft.startDate, library, options)
  const input: PlanWeekInput = { athlete, block, weekIndex: 0, library,
    context: { recentSessions: [], completedWeeks: [], neighboringSessions: [], pinnedSessions: [] } }
  return parsePlanWeekInputWithOptions({ ...input, context: { ...input.context, neighboringSessions: followingCommitments(input, options) } }, options)
}

export function campaignDraftForWeek(state: CampaignState, weekIndex = state.selectedWeek): CampaignDraft {
  return state.revisions?.findLast(revision => revision.weekIndex <= weekIndex)?.draft ?? state.draft
}

function revisedCampaignInput(weeks: CampaignWeek[], previousDraft: CampaignDraft, draft: CampaignDraft, options: ValidationOptions = {}): PlanWeekInput {
  const fixedFields = [
    'goalKind', 'goalLabel', 'location', 'eventDate', 'startDate', 'priorities',
    'practiceDays', 'practiceTime', 'practiceDuration', 'weeklyRunMinutes', 'runsPerWeek',
    'liftsPerWeek', 'liftDurationMin', 'weeklyTimeBudgetMin', 'exercises', 'currentTraining', 'practiceProfile',
  ] as const
  for (const key of fixedFields) equal(draft[key], previousDraft[key], `Revision ${key}`)
  for (const exercise of previousDraft.program?.customExercises ?? []) {
    equal(draft.program?.customExercises?.find(item => item.id === exercise.id), exercise, `Saved custom exercise ${exercise.id}`)
  }
  for (const drill of previousDraft.program?.customSportDrills ?? []) {
    equal(draft.program?.customSportDrills?.find(item => item.id === drill.id), drill, `Saved custom drill ${drill.id}`)
  }
  if (!draft.recommendedSetup || !previousDraft.recommendedSetup) fail('Revisions require a recommended exercise selection.')
  equal(draft.recommendedSetup.typicalRunMinutes, previousDraft.recommendedSetup.typicalRunMinutes, 'Revision running baseline')
  const carried = nextCalendarInput(weeks, options)
  if (carried.athlete.safetyHold && options.policy !== 'ai-advisory') fail('A health hold blocks programming revisions. It cannot be cleared by selecting different exercises.')
  const initial = initialCampaignInput(draft, options)
  const athlete = {
    ...initial.athlete,
    baseline: carried.athlete.baseline,
    residual: carried.athlete.residual,
    calibration: carried.athlete.calibration,
    safetyHold: carried.athlete.safetyHold,
  }
  const block = { ...generateBlock(athlete, goalForDraft(draft), draft.startDate, initial.library, options), phases: carried.block.phases }
  const input: PlanWeekInput = { ...carried, athlete, block, library: initial.library }
  const weekStart = addDays(block.startDate, input.weekIndex * 7)
  return parsePlanWeekInputWithOptions({ ...input, context: { ...input.context, neighboringSessions: [
    ...carried.context.neighboringSessions.filter(session => session.date < weekStart),
    ...followingCommitments(input, options),
  ] } }, options)
}

function activeWeek(state: CampaignState): CampaignWeek {
  if (!state.setupComplete || !state.weeks[state.selectedWeek]) fail('Create a calendar before editing or logging a session.')
  return state.weeks[state.selectedWeek]!
}
function replaceWeek(state: CampaignState, week: CampaignWeek): CampaignState {
  return { ...state, weeks: state.weeks.map((previous, index) => index === state.selectedWeek ? week : previous) }
}
function editableWeek(state: CampaignState): CampaignWeek {
  const week = activeWeek(state)
  if (state.selectedWeek !== state.weeks.length - 1) fail('Earlier weeks are archived. Their sessions and logs cannot be rewritten.')
  return week
}

/** Pins remain visible for review, but a pain report is not permission to train. */
export function campaignSessionOnHold(state: CampaignState, session: Session): boolean {
  const week = activeWeek(state)
  if (policyForWeek(week).policy === 'ai-advisory') return false
  if (week.input.athlete.safetyHold) return true
  const position = (item: Session): string => `${item.date}|${item.startTime ?? '00:00'}`
  return week.plan.sessions.some(item => week.logs[item.id]?.painFlag && position(item) <= position(session))
}

export function adaptCampaign(state: CampaignState, action: CalendarAction, notBeforeDate?: string): CampaignState {
  const week = editableWeek(state)
  if (week.authored) return adaptAuthoredCampaign(state, action, notBeforeDate)
  return replaceWeek(state, adaptCalendarWeek(week, action, notBeforeDate))
}

function parseSetDraft(value: unknown): SetDraft {
  const raw = object(value, 'Set draft', ['weight', 'reps', 'effort'])
  return { weight: text(raw.weight, 'Set weight', 30), reps: text(raw.reps, 'Set reps', 30), effort: text(raw.effort, 'Set effort', 30) }
}
function typedNumber(value: string, label: string): number {
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) fail(`${label} must be entered explicitly as a finite number.`)
  return Number(value)
}

/** index is zero-based within this exercise; other exercise groups remain untouched. */
export function logCampaignSet(
  state: CampaignState, sessionId: string, exerciseId: string, index: number, value: SetDraft,
): CampaignState {
  const week = editableWeek(state)
  const session = week.plan.sessions.find(session => session.id === sessionId)
  if (!session || session.kind !== 'strength') fail('Sets can only be logged for a visible strength session.')
  if (campaignSessionOnHold(state, session)) fail('Pain has put this session on hold. Further training cannot be logged as a recommendation; confirm an appropriate new baseline first.')
  const prescription = session.strengthPrescription.find(item => item.exerciseId === exerciseId)
  if (!prescription) fail('That exercise is not prescribed in this session.')
  number(index, 'Set index', 0, prescription.sets - 1, true)
  const previous = week.logs[sessionId]
  if (previous && previous.status !== 'partial') fail('Only a not-yet-completed session can accept set logs.')
  const draft = parseSetDraft(value)
  const set: SetLog = {
    exerciseId, weightKg: typedNumber(draft.weight, 'Actual weight'), reps: typedNumber(draft.reps, 'Actual reps'),
    actualRPE: typedNumber(draft.effort, 'Actual set RPE') as TargetRPE,
  }
  const ownSets = [...(previous?.sets ?? []).filter(item => item.exerciseId === exerciseId)]
  if (index > ownSets.length) fail('Log sets in order within each exercise; an unlogged earlier set cannot be filled with a suggestion.')
  ownSets[index] = set
  const sets = session.strengthPrescription.flatMap(item => item.exerciseId === exerciseId
    ? ownSets : (previous?.sets ?? []).filter(set => set.exerciseId === item.exerciseId))
  const log = parseSessionLogWithOptions({ sessionId, status: 'partial', sets, painFlag: previous?.painFlag ?? false, notes: previous?.notes ?? '' }, policyForWeek(week))
  const setDrafts = { ...state.setDrafts }
  delete setDrafts[`${sessionId}:${exerciseId}:${index}`]
  return { ...replaceWeek(state, { ...week, logs: { ...week.logs, [sessionId]: log } }), setDrafts }
}

function editableWorkout(state: CampaignState, sessionId: string): { week: CampaignWeek; session: WorkoutSession } {
  const week = editableWeek(state)
  const session = week.plan.sessions.find(item => item.id === sessionId)
  if (!session || session.kind !== 'workout') fail('Block logs require a visible template workout.')
  if (campaignSessionOnHold(state, session)) fail('A health hold blocks further workout logging as a recommendation.')
  const previous = week.logs[sessionId]
  if (previous && previous.status !== 'partial') fail('Only a not-yet-completed workout can accept block logs.')
  return { week, session }
}

function saveCampaignBlock(state: CampaignState, session: WorkoutSession, week: CampaignWeek, blockLog: BlockLog, draftKey: string): CampaignState {
  const previous = week.logs[session.id]
  const blockLogs = [...(previous?.blockLogs ?? []).filter(item => item.blockIndex !== blockLog.blockIndex), blockLog]
    .sort((a, b) => a.blockIndex - b.blockIndex)
  const log = parseSessionLogWithOptions({ ...previous, sessionId: session.id, status: 'partial', blockLogs, painFlag: previous?.painFlag ?? false, notes: previous?.notes ?? '' }, policyForWeek(week))
  validateSets(session, log, policyForWeek(week))
  const setDrafts = { ...state.setDrafts }
  delete setDrafts[draftKey]
  const updated = { ...week, logs: { ...week.logs, [session.id]: log } }
  return { ...replaceWeek(state, updated.authored ? refreshAuthoredCalendar(updated) : updated), setDrafts }
}

export function logCampaignBlockSet(state: CampaignState, sessionId: string, blockIndex: number, setIndex: number, value: SetDraft): CampaignState {
  const { week, session } = editableWorkout(state, sessionId)
  const block = session.blocks[blockIndex]
  if (!block || block.unit !== 'reps') fail('Choose a repetition block before logging a set.')
  number(setIndex, 'Set index', 0, MAX_LOGGED_SETS_PER_BLOCK - 1, true)
  const previous = week.logs[sessionId]?.blockLogs?.find(item => item.blockIndex === blockIndex)
  const sets = previous?.unit === 'reps' ? [...previous.sets] : []
  if (setIndex > sets.length) fail('Log sets in order; no unrecorded performance is filled automatically.')
  const draft = parseSetDraft(value)
  sets[setIndex] = {
    exerciseId: block.exerciseId, weightKg: typedNumber(draft.weight, 'Actual weight'),
    reps: typedNumber(draft.reps, 'Actual repetitions'), actualRPE: typedNumber(draft.effort, 'Actual set RPE') as TargetRPE,
  }
  return saveCampaignBlock(state, session, week, parseBlockLogWithOptions({ unit: 'reps', blockIndex, exerciseId: block.exerciseId, sets }, policyForWeek(week)), `${sessionId}:block-${blockIndex}:${setIndex}`)
}

export function logCampaignBlockAmount(state: CampaignState, sessionId: string, blockIndex: number, amount: string, weight?: string): CampaignState {
  const { week, session } = editableWorkout(state, sessionId)
  const block = session.blocks[blockIndex]
  if (!block || block.unit === 'reps') fail('Choose a timed or throwing block before logging its total.')
  const actual = typedNumber(amount, block.unit === 'seconds' ? 'Actual total seconds' : 'Actual practice throws')
  const entry = block.unit === 'seconds'
    ? { unit: 'seconds', blockIndex, exerciseId: block.exerciseId, seconds: actual, ...(weight !== undefined ? { weightKg: typedNumber(weight, 'Actual carry weight') } : {}) }
    : { unit: 'throws', blockIndex, drillId: block.drillId, throws: actual }
  return saveCampaignBlock(state, session, week, parseBlockLogWithOptions(entry, policyForWeek(week)), `${sessionId}:block-${blockIndex}:total`)
}

export function completeCampaignSession(
  state: CampaignState, sessionId: string, actualDuration: number, effort: number, pain: boolean,
): CampaignState {
  const week = editableWeek(state)
  const session = week.plan.sessions.find(session => session.id === sessionId)
  if (!session) fail('Only a visible session can be explicitly completed.')
  if (campaignSessionOnHold(state, session)) fail('Pain has put this session on hold. Further session completion is blocked until an appropriate new baseline is confirmed.')
  const previous = week.logs[sessionId]
  if (previous?.status === 'completed' || previous?.status === 'skipped') fail('This session is already completed or skipped.')
  number(actualDuration, 'Actual duration', 1, 1440)
  number(effort, 'Whole-session effort', 0, 10)
  boolean(pain, 'Pain flag')
  const log = parseSessionLogWithOptions({
    ...previous, sessionId, status: 'completed', actualDurationMin: actualDuration, actualEffort: effort,
    painFlag: pain || previous?.painFlag === true, notes: previous?.notes ?? '',
  }, policyForWeek(week))
  const updated = { ...week, logs: { ...week.logs, [sessionId]: log },
    changes: [...week.changes, { id: `change-${week.plan.weekIndex}-${week.changes.length + 1}`, message: `Completed ${calendarSessionLabel(session)}. Recorded only the sets and session details you entered.` }] }
  return replaceWeek(state, updated.authored ? refreshAuthoredCalendar(updated) : pain ? applyCalendarPainHold(updated, sessionId) : updated)
}

function repeatApprovedAuthoredWeek(current: CampaignWeek, input: PlanWeekInput): AuthoredWeekProposal {
  // A this-week skip or partial-work swap is not approval to rewrite the recurring pattern.
  const source = current.authoredHistory?.[0]?.proposal ?? current.authored
  if (!source) fail('This advisory week has no approved prescription to repeat.')
  const weekStart = addDays(input.block.startDate, input.weekIndex * 7)
  const offset = dayNumber(weekStart) - dayNumber(source.weekStart)
  return parseAuthoredWeekProposal({
    version: 1, weekStart,
    sessions: source.sessions.map((session, index) => {
      const date = addDays(session.date, offset)
      if (session.kind === 'workout' && session.sourceCommitmentId) {
        return { ...session, id: authoredCommitmentSessionId(input, session.sourceCommitmentId), date }
      }
      return { ...session, id: `repeat-${input.weekIndex}-${index + 1}-${weekStart}`, date }
    }),
  }, AI_PLANNING_OPTIONS)
}

export function nextCampaignWeek(state: CampaignState, revisionDraft?: CampaignDraft, proposal?: AuthoredWeekProposal): CampaignState {
  const current = editableWeek(state)
  if (Object.values(current.logs).some(log => log.status === 'partial')) {
    fail('Finish each in-progress session in this week before building the next week. Your logged sets remain saved and editable.')
  }
  const draft = revisionDraft ? parseDraft(normalizeRecommendedDraft(revisionDraft), true) : state.draft
  const repeatApproved = !proposal && policyForWeek(current).policy === 'ai-advisory'
  const advisory = Boolean(proposal) || repeatApproved
  const options: ValidationOptions = advisory ? AI_PLANNING_OPTIONS : {}
  const resourceRevision = advisory && current.input.athlete.program !== undefined
    && stable(current.input.athlete.program.resources) !== stable(programResources(draft.resources ?? resourcesForEquipment(draft.equipment), options))
  const inputRevision = revisionDraft !== undefined || resourceRevision
  if (!advisory) baselineForDraft(draft)
  const input = inputRevision ? revisedCampaignInput(state.weeks, state.draft, draft, options) : nextCalendarInput(state.weeks, options)
  if (input.athlete.safetyHold && options.policy !== 'ai-advisory') fail('Pain or another unresolved health hold blocks the next week. Confirm an appropriate new baseline before further planning; no return-to-training advice is inferred.')
  const builtIn = advisory ? undefined : builtInWeekForDraft(input, draft)
  const authored = proposal ? parseAuthoredWeekProposal(proposal, options)
    : repeatApproved ? repeatApprovedAuthoredWeek(current, input) : builtIn?.authored
  const planned = campaignPlanCopy(authored ? buildAuthoredWeek(input, authored, options) : builtIn!.plan)
  if (!planned.safety.passed) fail(`The next week fails app checks: ${planned.safety.violations.map(item => item.message).join(' ')}`)
  const fatigue = state.weeks.some(week => Object.values(week.logs).some(log => log.skipReason === 'too_tired'))
  const plan = { ...planned, warnings: [...planned.warnings, ...assumptionsForDraft(draft),
    ...(repeatApproved ? ['Repeated the originally approved AI weekly pattern with unchanged quantities and corresponding new dates. This-week skips, moves and swaps do not automatically change future training; review this preview before approving. No new AI request was made.'] : []),
    ...(fatigue ? [advisory ? 'Reported fatigue remains visible for AI and human review; ordinary time skips do not signal fatigue.'
      : 'A fatigue skip keeps future optional workload conservatively capped until a newly confirmed baseline; ordinary time skips do not signal fatigue.'] : []),
    ...(input.athlete.safetyHold ? [advisory ? 'An unresolved health report carries forward. Approval is not medical clearance, and does not clear the report.'
      : 'An unresolved health hold blocks generated running and lifting. Fixed practices are only existing commitments, not advice to continue them.'] : []),
    advisory
      ? 'Unlogged prior sessions remain unlogged. Entered actuals and neighboring planned sessions inform training advice.'
      : 'Unlogged prior sessions remain unlogged. Recovery uses entered completed/partial history; neighboring planned sessions retain conservative timing checks.',
  ] }
  const revisions: CampaignRevision[] | undefined = inputRevision
    ? [...(state.revisions ?? [{ weekIndex: 0, draft: state.draft }]), { weekIndex: state.weeks.length, draft }]
    : state.revisions
  return { ...state, draft, selectedWeek: state.weeks.length, ...(revisions ? { revisions } : {}),
    weeks: [...state.weeks, { input, plan, logs: {}, removed: [], ...(authored ? { authored } : {}), changes: [{ id: `change-${input.weekIndex}-1`,
      message: repeatApproved
        ? 'Repeated the originally approved AI week for explicit review, without reducing quantities or calling AI. Earlier prescriptions, actuals and one-week changes remain unchanged.'
        : advisory
        ? 'Applied the reviewed AI week. Earlier prescriptions, actuals and reported health concerns remain unchanged.'
        : revisionDraft
        ? 'Applied the reviewed exercise revision to this week. Earlier prescriptions and logs are unchanged; recovery, fatigue and health holds carry forward.'
        : 'Created the next week from the unchanged observed baseline, carried recovery/history, and conservative workload caps. Earlier weeks are preserved.' }] }] }
}

function strings(value: unknown, label: string, max = 1000): string[] {
  return array(value, label, max).map(item => text(item, label, 8000))
}
function validateSets(session: Session, log: SessionLog, options: ValidationOptions = {}): void {
  if (log.blockLogs) {
    validateBlockLogs(session, log, options)
  }
  if (!log.sets) return
  if (session.kind !== 'strength') fail('Non-strength sessions cannot contain set logs.')
  let previousIndex = -1
  const counts = new Map<string, number>()
  for (const set of log.sets) {
    const index = session.strengthPrescription.findIndex(item => item.exerciseId === set.exerciseId)
    if (index < previousIndex || index < 0) fail('Logged sets must follow prescription exercise order.')
    const count = (counts.get(set.exerciseId) ?? 0) + 1
    if (count > session.strengthPrescription[index]!.sets) fail('Logged set count exceeds its exercise prescription.')
    counts.set(set.exerciseId, count)
    previousIndex = index
  }
}

function parseWeek(value: unknown): CampaignWeek {
  const candidate = object(value, 'Campaign week')
  const raw = object(candidate, 'Campaign week', ['input', 'plan', 'logs', 'removed', 'changes', ...['authored', 'feedback', 'authoredHistory'].filter(key => Object.hasOwn(candidate, key))])
  const options: ValidationOptions = Object.hasOwn(raw, 'authored') ? authoredPolicyOptions(object(raw.plan, 'Stored plan').policyVersion) : {}
  const input = parsePlanWeekInputWithOptions(raw.input, options)
  equal(input.library, input.athlete.program ? resolveProgramLibrary(input.athlete.program, options) : libraryForVersion(input.library.version), 'Stored exercise library')
  equal(input.athlete.calibration, { version: 1, costMultiplier: 1, observationCount: 0 }, 'Disabled calibration')
  if (Object.hasOwn(raw, 'authored')) return parseAuthoredCalendar(raw, input)
  if (Object.hasOwn(raw, 'authoredHistory')) fail('Authored prescription history requires an authored calendar.')
  const p = object(raw.plan, 'Stored plan', ['engineVersion', 'policyVersion', 'libraryVersion', 'weekIndex', 'weekStart', 'phase', 'intent', 'sessions', 'totalScore', 'penalties', 'warnings', 'omitted', 'feasibility', 'safety', 'audit'])
  const sessions = array(p.sessions, 'Scheduled sessions', 20).map(parseSession)
  const removed = array(raw.removed, 'Removed sessions', 20).map(parseSession)
  unique([...sessions, ...removed].map(session => session.id), 'Scheduled and removed session IDs')
  const templates = [...requestedSessions(input), ...fixedSessions(input)]
  for (const session of [...sessions, ...removed]) {
    const template = templates.find(item => item.id === session.id)
    if (!template || template.kind !== session.kind || template.discipline !== session.discipline || template.modality !== session.modality
      || session.durationMin > template.durationMin || session.isCalibration !== template.isCalibration) fail('Stored session does not match its engine template.')
    if (session.date < addDays(input.block.startDate, input.weekIndex * 7) || session.date > addDays(input.block.startDate, input.weekIndex * 7 + 6)) fail('Stored session is outside its week.')
    equal(session.predictedLoad, predictSessionLoad(session, input.athlete, input.library), 'Stored scheduling cost')
    if (session.kind === 'strength' && template.kind === 'strength') {
      if (session.strengthPrescription.length !== template.strengthPrescription.length) fail('Stored exercise prescription is incomplete.')
      session.strengthPrescription.forEach((item, index) => {
        const expected = template.strengthPrescription[index]!
        if (item.sets > expected.sets) fail('Stored strength work exceeds its engine prescription.')
        equal({ ...item, sets: expected.sets }, expected, 'Stored strength prescription')
      })
    }
    if (session.kind === 'run' && template.kind === 'run') equal(session.endurancePrescription, template.endurancePrescription, 'Stored run prescription')
    if (session.kind === 'conditioning' && template.kind === 'conditioning') equal(session.conditioningPrescription, template.conditioningPrescription, 'Stored conditioning prescription')
    if (session.kind === 'workout' && template.kind === 'workout') {
      equal(session.label, template.label, 'Stored workout label')
      equal(session.sourceCommitmentId, template.sourceCommitmentId, 'Stored practice identity')
      if (session.blocks.length !== template.blocks.length) fail('Stored workout blocks do not match the engine template.')
      session.blocks.forEach((block, index) => {
        const expected = template.blocks[index]!
        if (block.unit === 'reps' && expected.unit === 'reps') {
          if (block.sets > expected.sets) fail('Stored work exceeds the engine set ceiling.')
          equal({ ...block, sets: expected.sets }, expected, 'Stored repetition block')
        } else if (block.unit === 'seconds' && expected.unit === 'seconds') {
          if (block.seconds > expected.seconds || block.sets > expected.sets) fail('Stored timed work exceeds the engine ceiling.')
          equal({ ...block, sets: expected.sets, seconds: expected.seconds }, expected, 'Stored timed block')
        } else equal(block, expected, 'Stored throwing block')
      })
      if (session.sourceCommitmentId) equal({ ...session, date: template.date, startTime: template.startTime, reason: template.reason }, template, 'Stored practice workload')
    }
    if (session.kind === 'commitment' && template.kind === 'commitment') {
      equal({ ...session, date: template.date, startTime: template.startTime, reason: template.reason }, template, 'Stored fixed commitment workload')
    }
  }
  const rawLogs = object(raw.logs, 'Session logs')
  const logs: Record<string, SessionLog> = {}
  for (const [id, value] of Object.entries(rawLogs)) {
    const session = [...sessions, ...removed].find(session => session.id === id)
    const log = parseSessionLog(value)
    if (!session || log.sessionId !== id) fail('A log references an unknown session.')
    if (log.status === 'skipped' ? !removed.some(item => item.id === id) : !sessions.some(item => item.id === id)) fail('Log status conflicts with the visible calendar.')
    if (log.status === 'completed' && (log.actualDurationMin === undefined || log.actualEffort === undefined)) fail('Completed sessions require explicit actual duration and effort.')
    validateSets(session, log)
    Object.defineProperty(logs, id, { value: log, enumerable: true, writable: true, configurable: true })
  }
  const omitted = array(p.omitted, 'Omitted sessions', 20).map(value => {
    const item = object(value, 'Omission', ['sessionId', 'reason'])
    const sessionId = text(item.sessionId, 'Omitted session ID', 80)
    if (!templates.some(item => item.id === sessionId) || sessions.some(session => session.id === sessionId)) fail('Invalid or reintroduced omitted session.')
    return { sessionId, reason: text(item.reason, 'Omission reason') }
  })
  unique(omitted.map(item => item.sessionId), 'Omitted session IDs')
  for (const template of templates) if (!sessions.some(item => item.id === template.id) && !omitted.some(item => item.sessionId === template.id)) fail('Stored calendar silently dropped requested work.')
  for (const session of removed) if (!omitted.some(item => item.sessionId === session.id)) fail('A removal is missing its durable omission record.')
  for (const template of templates.filter(item => item.kind === 'commitment' || (item.kind === 'workout' && item.sourceCommitmentId))) {
    if (!sessions.some(item => item.id === template.id) && !removed.some(item => item.id === template.id)) fail('A fixed commitment is missing without a retained removal record.')
  }
  const penalties = scoreSessions(input, sessions)
  const safety = calendarSafety(input, sessions, logs)
  if (safety.violations.some(item => item.rule !== 'calendarPainHold')) fail('Stored calendar fails the independent engine safety floor.')
  equal(p.penalties, penalties, 'Stored penalties')
  const totalScore = number(p.totalScore, 'Stored total score', 0, 1_000_000)
  equal(totalScore, penalties.reduce((sum, item) => sum + item.score, 0), 'Stored score')
  equal(p.safety, safety, 'Stored safety result')
  const feasibility = object(p.feasibility, 'Feasibility', ['fits', 'issues', 'suggestions'])
  const fits = safety.passed && omitted.length === 0
  equal(feasibility.fits, fits, 'Stored feasibility')
  const issues = strings(feasibility.issues, 'Feasibility issues')
  if ((!safety.passed || omitted.length > 0) && !issues.length) fail('Failed feasibility must have visible issues.')
  const suggestions = strings(feasibility.suggestions, 'Feasibility suggestions')
  const audit = object(p.audit, 'Search audit', ['candidatesScored', 'rejectedBySafety'])
  const candidatesScored = number(audit.candidatesScored, 'Scored candidates', 0, LIMITS.maxCandidates, true)
  const rejectedBySafety = number(audit.rejectedBySafety, 'Rejected candidates', 0, candidatesScored, true)
  equal(p.engineVersion, input.block.engineVersion, 'Engine version')
  equal(p.policyVersion, input.block.policyVersion, 'Policy version')
  equal(p.libraryVersion, input.library.version, 'Library version')
  equal(p.weekIndex, input.weekIndex, 'Week index')
  const weekStart = addDays(input.block.startDate, input.weekIndex * 7)
  equal(p.weekStart, weekStart, 'Week start')
  const phase = input.block.phases.find(phase => phase.startWeekIndex <= input.weekIndex && phase.endWeekIndex >= input.weekIndex)?.kind
  if (!phase) fail('No block phase covers this stored week.')
  equal(p.phase, phase, 'Block phase')
  const intent = text(p.intent, 'Plan intent')
  const warnings = strings(p.warnings, 'Plan warnings')
  if (!safety.passed && !warnings.length) fail('An unsafe stored calendar needs a visible warning.')
  const changes = array(raw.changes, 'Calendar changes', 10000).map(value => {
    const item = object(value, 'Calendar change', ['id', 'message'])
    return { id: text(item.id, 'Change ID', 80), message: text(item.message, 'Change message') }
  })
  unique(changes.map(change => change.id), 'Change IDs')
  const plan: WeekPlan = {
    engineVersion: input.block.engineVersion,
    policyVersion: input.block.policyVersion,
    libraryVersion: input.library.version,
    weekIndex: input.weekIndex,
    weekStart,
    phase,
    intent,
    sessions,
    totalScore,
    penalties,
    warnings,
    omitted,
    feasibility: { fits, issues, suggestions },
    safety,
    audit: { candidatesScored, rejectedBySafety },
  }
  return { input, plan, logs, removed, changes, ...parseWeekFeedback(raw, logs) }
}

function parseWeekFeedback(raw: Record<string, unknown>, logs: Record<string, SessionLog>): Pick<CampaignWeek, 'feedback'> {
  if (!Object.hasOwn(raw, 'feedback')) return {}
  const feedback: NonNullable<CampaignWeek['feedback']> = {}
  const records = object(raw.feedback, 'Session feedback')
  if (Object.keys(records).length > 100) fail('Too many session feedback records.')
  for (const [id, value] of Object.entries(records)) {
    if (!Object.hasOwn(logs, id) || logs[id]?.status !== 'completed') fail('Feedback must reference an explicitly finished session.')
    Object.defineProperty(feedback, id, { value: parseSessionFeedback(value), enumerable: true, configurable: true, writable: true })
  }
  return { feedback }
}

function parseSavedPlan(value: unknown): SavedPlan {
  const candidate = object(value, 'Campaign')
  const raw = object(candidate, 'Campaign', ['version', 'step', 'setupComplete', 'sample', 'draft', 'weeks', 'selectedWeek', 'setDrafts', ...['cards', 'revisions', 'pendingWeek'].filter(key => Object.hasOwn(candidate, key))])
  if (raw.version !== 1) fail('Unsupported campaign version; saved data has not been replaced.')
  const setupComplete = boolean(raw.setupComplete, 'Setup complete')
  const draft = parseDraft(raw.draft, setupComplete)
  const weeks = array(raw.weeks, 'Campaign weeks', LIMITS.maxWeeks).map(parseWeek)
  const revisions: CampaignRevision[] | undefined = Object.hasOwn(raw, 'revisions')
    ? array(raw.revisions, 'Programming revisions', LIMITS.maxWeeks).map(value => {
      const item = object(value, 'Programming revision', ['weekIndex', 'draft'])
      return { weekIndex: number(item.weekIndex, 'Revision week', 0, weeks.length - 1, true), draft: parseDraft(item.draft, true) }
    }) : undefined
  if (revisions) {
    if (revisions.length < 2 || revisions[0]?.weekIndex !== 0) fail('Programming revisions must preserve the original setup and at least one explicit change.')
    for (let index = 1; index < revisions.length; index++) {
      if (revisions[index]!.weekIndex <= revisions[index - 1]!.weekIndex) fail('Programming revisions must be in ascending week order.')
    }
    equal(draft, revisions.at(-1)!.draft, 'Latest reviewed setup')
  }
  if (setupComplete !== (weeks.length > 0)) fail('Saved setup status conflicts with the calendar.')
  if (setupComplete && Object.hasOwn(raw, 'pendingWeek')) fail('A proposed week must be reviewed in a separate draft, not overwrite a saved week.')
  if (weeks.length) {
    const firstDraft = revisions?.[0]?.draft ?? draft
    const initial = initialCampaignInput(firstDraft, policyForWeek(weeks[0]!))
    equal(weeks[0]!.input, initial, 'Initial confirmed planning input')
    let expected = initial.block
    let activeDraft = firstDraft
    for (const [index, week] of weeks.entries()) {
      const revision = revisions?.find(item => item.weekIndex === index && index > 0)
      if (revision) {
        const input = revisedCampaignInput(weeks.slice(0, index), activeDraft, revision.draft, policyForWeek(week))
        equal(week.input, input, 'Reviewed programming revision')
        expected = input.block
        activeDraft = revision.draft
      } else if (index > 0) equal(week.input, nextCalendarInput(weeks.slice(0, index), policyForWeek(week)), 'Next-week history and safety context')
      if (week.input.weekIndex !== index || week.input.block.id !== expected.id) fail('Stored campaign weeks are missing, duplicated or belong to another goal.')
      equal(week.input.athlete.baseline, baselineForDraft(activeDraft, policyForWeek(week)).baseline, 'Confirmed baseline')
      equal(week.input.block.goal, expected.goal, 'Confirmed goal')
      equal(week.input.block.anchors, expected.anchors, 'Confirmed exercise anchors')
    }
  }
  const setDrafts: Record<string, SetDraft> = {}
  const drafts = object(raw.setDrafts, 'Unsubmitted set drafts')
  if (Object.keys(drafts).length > 5000) fail('Too many unsubmitted set drafts.')
  for (const [key, value] of Object.entries(drafts)) {
    if (!key || key.length > 300 || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('Invalid set draft key.')
    Object.defineProperty(setDrafts, key, { value: parseSetDraft(value), enumerable: true, writable: true, configurable: true })
  }
  return {
    version: 1, step: number(raw.step, 'Setup step', 0, 10, true), setupComplete,
    sample: boolean(raw.sample, 'Sample flag'), draft, weeks,
    selectedWeek: number(raw.selectedWeek, 'Selected week', 0, Math.max(0, weeks.length - 1), true), setDrafts,
    ...(Object.hasOwn(raw, 'cards') ? { cards: parseWorkoutCards(raw.cards, draft.program) } : {}),
    ...(revisions ? { revisions } : {}),
    ...(Object.hasOwn(raw, 'pendingWeek') ? { pendingWeek: parseAuthoredWeekProposal(raw.pendingWeek, AI_PLANNING_OPTIONS) } : {}),
  }
}

export function parseCampaign(value: unknown): CampaignState {
  const candidate = object(value, 'Campaign')
  if (!Object.hasOwn(candidate, 'pastPlans')) return parseSavedPlan(candidate)
  const { pastPlans: history, ...current } = candidate
  const pastPlans = array(history, 'Previous plans', MAX_PAST_PLANS).map(value => {
    const plan = parseSavedPlan(value)
    if (!plan.setupComplete) fail('Previous plans must contain a saved calendar, not an unfinished setup.')
    return plan
  })
  return { ...parseSavedPlan(current), pastPlans }
}

const FOCUS: Record<CampaignDraft['goalKind'], { run: string; strength: string; practice: string }> = {
  dodgeball: {
    run: 'Build a comfortable aerobic foundation around court practices; this is not a sprint prescription.',
    strength: 'Maintain controlled leg strength and upper-body capacity around throwing and changes of direction.',
    practice: 'Use your existing team practice for court skills, positioning and decision-making; the engine does not invent drills or throwing volume.',
  },
  running: {
    run: 'Keep an easy conversational rhythm and finish with control; the event label does not turn this into a speed session.',
    strength: 'Maintain familiar strength movements that support consistent running without adding soreness-seeking work.',
    practice: 'Keep this established practice separate from the prescribed easy running; no race pace is inferred.',
  },
  hybrid: {
    run: 'Keep the aerobic work comfortable enough to coexist with the lifting you already tolerate.',
    strength: 'Balance familiar movement patterns while keeping the next run in mind; do not add sets to catch up.',
    practice: 'Protect your established practice while keeping optional running and lifting within the same time budget.',
  },
  custom: {
    run: 'Use comfortable aerobic work as general preparation for your selected priorities, not an invented sport-specific protocol.',
    strength: 'Use your observed exercises as general preparation; only your selected priorities influence scheduling.',
    practice: 'Follow the established activity you entered; specialist technique and sport-specific workload are not inferred.',
  },
}

export function workoutContent(state: CampaignState, session: Session): WorkoutContent {
  const focus = FOCUS[state.draft.goalKind]
  const priorities = state.draft.priorities.map(item => item.replaceAll('_', ' ')).join(', ')
  if (session.kind === 'commitment') return {
    title: session.label, focus: focus.practice,
    cues: ['Pinned existing commitment, not a generated exercise prescription.', `Your selected priorities: ${priorities}.`, 'If pain or illness changes your situation, review the commitment rather than treating the calendar as clearance.'],
  }
  if (session.kind === 'run') return {
    title: state.draft.goalKind === 'dodgeball' ? 'Easy aerobic support' : state.draft.goalKind === 'running' ? 'Conversational run' : 'Easy aerobic run',
    focus: focus.run, cues: ['Keep a pace at which you can speak comfortably.', 'Use relaxed shoulders and a natural stride; do not force speed to match the goal.', `Priorities: ${priorities}. Duration and effort are exactly the engine prescription.`],
  }
  if (session.kind === 'conditioning') return {
    title: session.modality === 'row' ? 'Easy rowing' : session.modality === 'ski_erg' ? 'Easy SkiErg' : 'Easy conditioning',
    focus: 'Comfortable aerobic work from your explicit baseline for this modality, not converted from running.',
    cues: ['Keep a conversational effort.', 'Use only the displayed duration; this does not add work outside the weekly budget.', 'Running and non-running modalities retain separate scheduling estimates.'],
  }
  if (session.kind === 'workout') return {
    title: session.label,
    focus: session.sourceCommitmentId
      ? 'Controlled target throws are allocated inside your established practice, not added to it. The usual throw count is an exposure ceiling, not a validated injury-safe dose.'
      : `${session.label} uses complementary movement slots for ${state.draft.goalLabel}. Each block keeps its own execution, dose and logging unit.`,
    cues: session.sourceCommitmentId
      ? ['Keep technique deliberate and submaximal.', 'Count all throws in the practice, not only target-drill attempts.', 'Pain or a health hold is not cleared by a count being below its ceiling.']
      : ['A slower lowering phase and fast upward intent are separate supported variants, not interchangeable notes.', 'Starting weights come only from your own compatible, same-variant records.', 'Timed work is logged in seconds, not fabricated repetitions or RIR.'],
  }
  const patterns = session.strengthPrescription.map(item => DEFAULT_LIBRARY.exercises.find(exercise => exercise.id === item.exerciseId)?.pattern)
  return {
    title: state.draft.goalKind === 'dodgeball' ? 'Court-support strength' : state.draft.goalKind === 'running' ? 'Running-support strength' : 'Baseline strength',
    focus: state.draft.recommendedSetup
      ? `Introduce the selected strength movements conservatively in support of ${state.draft.goalLabel}. No previous lifting numbers are assumed.`
      : focus.strength,
    cues: [
      ...(state.draft.recommendedSetup
        ? ['Recommended exercises are not recorded lifting history. Use only the engine prescription and choose a manageable resistance; no starting kilograms are assumed.'] : []),
      ...(patterns.some(pattern => ['knee_dominant', 'hip_dominant', 'unilateral_lower'].includes(pattern ?? ''))
        ? ['Use a controlled lower-body range you know; keep your balance and stop a set if technique changes.'] : []),
      ...(patterns.some(pattern => ['horizontal_pull', 'horizontal_push', 'vertical_push', 'vertical_pull'].includes(pattern ?? ''))
        ? ['Move the shoulder comfortably without forcing range; keep repetitions controlled.'] : []),
      ...(patterns.includes('rotational') ? ['Rotate under control rather than chasing throwing speed with the resistance.'] : []),
      `Priorities: ${priorities}. Use only the displayed engine sets, repetitions and target effort; suggested weights are not logged results.`,
    ],
  }
}
