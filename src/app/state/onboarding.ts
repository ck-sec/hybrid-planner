import type { GuidedOnboardingScreenProps, OnboardingStepSummary } from '../features/guidedOnboardingScreen.ts'
import { equipmentPresets } from '../features/equipmentPresets.ts'
import type {
  ChoiceOption,
  ClubSessionDraft,
  DayOfWeek,
  EquipmentMode,
  FormMessage,
  OnboardingDraft as FeatureOnboardingDraft,
  OnboardingStepId,
  SelectOption,
} from '../features/models.ts'
import {
  parseAthleteProfile,
  parseOnboardingDraft as parseDomainOnboardingDraft,
  parseWorkout,
  isFullySpecifiedClubSession,
  type AthleteProfile,
  type EquipmentDetail,
  type OnboardingDraft as DomainOnboardingDraft,
  type PreferredTrainingDay,
  type RecurringClubSession,
  type StrengthPreference,
  type Workout,
  type WorkoutCategory,
} from '../../domain/contracts.ts'
import { addDaysToLocalDate, localDateDayOfWeek, parseClockTime, parseLocalDate, type LocalDateString } from '../../domain/local-date.ts'
import { parseStableIdentity, type StableIdentity } from '../../domain/identity.ts'

export const GUIDED_ONBOARDING_STEP_ORDER: readonly OnboardingStepId[] = [
  'goal',
  'schedule',
  'equipment',
  'review',
] as const satisfies readonly OnboardingStepId[]

const CATEGORY_ORDER = ['aerobic', 'strength', 'mobility'] as const satisfies readonly WorkoutCategory[]
const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const satisfies readonly DayOfWeek[]
const STRENGTH_PREFERENCE_ORDER = ['full_body', 'upper_lower', 'push_pull_legs', 'mixed'] as const satisfies readonly StrengthPreference[]
const DEFAULT_AEROBIC_MODALITY_IDS = ['running', 'cycling', 'swimming', 'rowing', 'hiking'] as const
const DEFAULT_CLUB_SCOPES = [
  'Primary weekly anchor',
  'Supporting session',
  'Skills or social session',
  'Recovery anchor',
] as const

const FEATURE_DAY_TO_DOMAIN_DAY: Record<DayOfWeek, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
}

const DOMAIN_DAY_TO_FEATURE_DAY: Record<number, DayOfWeek> = {
  0: 'sunday',
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
}

const COUNT_FIELD_BY_CATEGORY = {
  aerobic: 'aerobicSessionCount',
  strength: 'strengthSessionCount',
  mobility: 'mobilitySessionCount',
} as const satisfies Record<WorkoutCategory, keyof FeatureOnboardingDraft>

const EQUIPMENT_MODE_LABELS: Record<EquipmentMode, string> = {
  bodyweight: 'Bodyweight access',
  home: 'Home gym access',
  commercial: 'Commercial gym access',
}

const NOTES_METADATA_PREFIX = '@guided-onboarding '
const CLUB_METADATA_PREFIX = '@guided-onboarding-club '

export interface GuidedOnboardingIdentity {
  athleteId: StableIdentity
  draftId: StableIdentity
  athleteName?: string
  createdOn: LocalDateString
  startingWeek: LocalDateString
}

export interface GuidedOnboardingState {
  readonly identity: GuidedOnboardingIdentity
  readonly currentStep: OnboardingStepId
  readonly draft: FeatureOnboardingDraft
  readonly selectedDays: Readonly<Record<WorkoutCategory, readonly DayOfWeek[]>>
  readonly aerobicModalities: readonly string[]
  readonly strengthPreference: StrengthPreference | ''
  readonly equipmentItems: readonly string[]
  readonly clubSessions: readonly ClubSessionDraft[]
  readonly nextClubSessionSequence: number
  readonly hydrationMessages: readonly FormMessage[]
}

export interface GuidedOnboardingIssue {
  id: string
  stepId: OnboardingStepId
  field: string
  message: string
}

export interface GuidedOnboardingValidation {
  readonly issues: readonly GuidedOnboardingIssue[]
  readonly issuesByStep: Readonly<Record<OnboardingStepId, readonly GuidedOnboardingIssue[]>>
}

export interface GuidedOnboardingResult<T> {
  readonly ok: boolean
  readonly value?: T
  readonly issues: readonly GuidedOnboardingIssue[]
}

export interface GuidedOnboardingScreenAdapterProps extends GuidedOnboardingScreenProps {}

export type GuidedOnboardingAction =
  | { type: 'selectStep'; stepId: OnboardingStepId }
  | { type: 'setGoalSummary'; value: string }
  | { type: 'setTargetDate'; value: string }
  | { type: 'setGoalNotes'; value: string }
  | { type: 'setCategoryCount'; category: WorkoutCategory; value: string }
  | { type: 'toggleCategoryDay'; category: WorkoutCategory; day: DayOfWeek }
  | { type: 'toggleAerobicModality'; id: string }
  | { type: 'setAerobicExercises'; value: string }
  | { type: 'setStrengthPreference'; id: StrengthPreference | '' }
  | { type: 'setEquipmentMode'; id: EquipmentMode | '' }
  | { type: 'setEquipmentDetails'; value: string }
  | { type: 'toggleEquipmentItem'; item: string }
  | { type: 'setClubSessionField'; sessionId: string; field: keyof Omit<ClubSessionDraft, 'id'>; value: string }
  | { type: 'addClubSession' }
  | { type: 'removeClubSession'; sessionId: string }
  | { type: 'setReviewNotes'; value: string }
  | { type: 'back' }
  | { type: 'next' }

interface GuidedOnboardingMetadata {
  version: 1
  currentStep: OnboardingStepId
  counts: Record<WorkoutCategory, string>
  aerobicModalities: string[]
  aerobicExercises?: string
  equipmentItems?: string[]
  selectedDays?: Record<WorkoutCategory, DayOfWeek[]>
  goalNotes: string
  reviewNotes: string
  equipmentMode: EquipmentMode | ''
  equipmentDetailsText: string
  nextClubSessionSequence: number
  pendingClubSessions: ClubSessionDraft[]
}

interface CreateGuidedOnboardingStateInput {
  athleteId: string
  draftId: string
  athleteName?: string
  createdOn: string
  startingWeek: string
}

interface SaveDraftOptions {
  updatedOn: string
}

interface FinalizeAthleteOptions {
  updatedOn: string
  athleteName?: string
}

interface FixedClubWorkoutOptions {
  athleteId: string
  weekPlanId: string
  weekStart: string
}

interface ClubNotesPayload {
  location: string
}

export function createGuidedOnboardingState(input: CreateGuidedOnboardingStateInput): GuidedOnboardingState {
  return {
    identity: {
      athleteId: parseStableIdentity(input.athleteId, 'GuidedOnboardingIdentity.athleteId'),
      draftId: parseStableIdentity(input.draftId, 'GuidedOnboardingIdentity.draftId'),
      athleteName: normalizeOptionalText(input.athleteName),
      createdOn: parseLocalDate(input.createdOn, 'GuidedOnboardingIdentity.createdOn'),
      startingWeek: parseLocalDate(input.startingWeek, 'GuidedOnboardingIdentity.startingWeek'),
    },
    currentStep: 'goal',
    draft: emptyFeatureDraft(),
    selectedDays: { aerobic: [], strength: [], mobility: [] },
    aerobicModalities: [],
    strengthPreference: '',
    equipmentItems: [],
    clubSessions: [],
    nextClubSessionSequence: 1,
    hydrationMessages: [],
  }
}

export function reduceGuidedOnboardingState(
  state: GuidedOnboardingState,
  action: GuidedOnboardingAction,
): GuidedOnboardingState {
  switch (action.type) {
    case 'selectStep': {
      const available = buildStepSummaries(state).some(step => step.id === action.stepId && step.isAvailable)
      return available ? { ...state, currentStep: action.stepId } : state
    }
    case 'setGoalSummary':
      return { ...state, draft: { ...state.draft, goalSummary: action.value } }
    case 'setTargetDate':
      return { ...state, draft: { ...state.draft, targetDate: action.value } }
    case 'setGoalNotes':
      return { ...state, draft: { ...state.draft, goalNotes: action.value } }
    case 'setCategoryCount':
      return {
        ...state,
        draft: { ...state.draft, [COUNT_FIELD_BY_CATEGORY[action.category]]: action.value },
        selectedDays: action.value === '0' ? { ...state.selectedDays, [action.category]: [] } : state.selectedDays,
      }
    case 'toggleCategoryDay':
      return {
        ...state,
        selectedDays: {
          ...state.selectedDays,
          [action.category]: toggleDay(state.selectedDays[action.category], action.day),
        },
      }
    case 'toggleAerobicModality':
      return { ...state, aerobicModalities: toggleString(state.aerobicModalities, action.id), draft: { ...state.draft, aerobicExercises: toggleString(state.aerobicModalities, action.id).join(', ') } }
    case 'setAerobicExercises':
      return { ...state, draft: { ...state.draft, aerobicExercises: action.value }, aerobicModalities: action.value.split(/[,;\n]/).map(value => value.trim()).filter(Boolean) }
    case 'setStrengthPreference':
      return { ...state, strengthPreference: action.id }
    case 'setEquipmentMode':
      return { ...state, draft: { ...state.draft, equipmentMode: action.id }, equipmentItems: action.id ? [...equipmentPresets[action.id].items] : [] }
    case 'setEquipmentDetails':
      return { ...state, draft: { ...state.draft, equipmentDetails: action.value } }
    case 'toggleEquipmentItem':
      return { ...state, equipmentItems: toggleString(state.equipmentItems, action.item) }
    case 'setClubSessionField':
      return {
        ...state,
        clubSessions: state.clubSessions.map(session =>
          session.id === action.sessionId ? { ...session, [action.field]: action.value } : session,
        ),
      }
    case 'addClubSession': {
      const sessionId = createStableId('club-session', String(state.nextClubSessionSequence))
      return {
        ...state,
        clubSessions: [...state.clubSessions, emptyClubSessionDraft(sessionId)],
        nextClubSessionSequence: state.nextClubSessionSequence + 1,
      }
    }
    case 'removeClubSession':
      return { ...state, clubSessions: state.clubSessions.filter(session => session.id !== action.sessionId) }
    case 'setReviewNotes':
      return { ...state, draft: { ...state.draft, reviewNotes: action.value } }
    case 'back': {
      const index = GUIDED_ONBOARDING_STEP_ORDER.indexOf(state.currentStep)
      return index > 0 ? { ...state, currentStep: GUIDED_ONBOARDING_STEP_ORDER[index - 1]! } : state
    }
    case 'next': {
      const props = createGuidedOnboardingScreenProps(state, () => undefined)
      if (!props.canGoNext) return state
      const index = GUIDED_ONBOARDING_STEP_ORDER.indexOf(state.currentStep)
      return index >= 0 && index < GUIDED_ONBOARDING_STEP_ORDER.length - 1
        ? { ...state, currentStep: GUIDED_ONBOARDING_STEP_ORDER[index + 1]! }
        : state
    }
  }
}

export function validateGuidedOnboardingState(state: GuidedOnboardingState): GuidedOnboardingValidation {
  const issuesByStep: Record<OnboardingStepId, GuidedOnboardingIssue[]> = {
    goal: [],
    schedule: [],
    modalities: [],
    strength: [],
    equipment: [],
    club: [],
    review: [],
  }

  const goalSummary = normalizeOptionalText(state.draft.goalSummary)
  if (!goalSummary) addIssue(issuesByStep, 'goal', 'goalSummary', 'Add a primary goal before moving on.')
  if (goalSummary && goalSummary.length > 500) {
    addIssue(issuesByStep, 'goal', 'goalSummary', 'Keep the primary goal to 500 characters or fewer.')
  }

  if (state.draft.targetDate.trim()) {
    try {
      const date = parseLocalDate(state.draft.targetDate, 'GuidedOnboarding.targetDate')
      if (date < state.identity.startingWeek) {
        addIssue(issuesByStep, 'goal', 'targetDate', 'Target date cannot be earlier than the starting week.')
      }
    } catch {
      addIssue(issuesByStep, 'goal', 'targetDate', 'Use a real YYYY-MM-DD target date.')
    }
  }

  if (state.draft.goalNotes.trim().length > 2_000) {
    addIssue(issuesByStep, 'goal', 'goalNotes', 'Keep coach context to 2000 characters or fewer.')
  }

  for (const category of CATEGORY_ORDER) {
    const countLabel = `${capitalize(category)} sessions per week`
    const rawCount = state.draft[COUNT_FIELD_BY_CATEGORY[category]]
    const parsedCount = parseCount(rawCount)
    if (!parsedCount.ok) {
      addIssue(issuesByStep, 'schedule', COUNT_FIELD_BY_CATEGORY[category], `${countLabel} must be a whole number from 0 to 14.`)
      continue
    }
    if (parsedCount.value === 0 && state.selectedDays[category].length) {
      addIssue(issuesByStep, 'schedule', `${category}Days`, `Clear ${category} preferred days or raise the ${category} session count above zero.`)
    }
    if (parsedCount.value > 0 && state.selectedDays[category].length === 0) {
      addIssue(issuesByStep, 'schedule', `${category}Days`, `Pick at least one preferred day for ${category} sessions.`)
    }
  }

  if (CATEGORY_ORDER.every(category => countValue(state, category) === 0) && !state.clubSessions.length) {
    addIssue(issuesByStep, 'schedule', 'trainingSelection', 'Choose a training type or add club training to continue.')
  }

  if (countValue(state, 'aerobic') > 0 && (state.aerobicModalities.length > 12 || state.aerobicModalities.some(activity => activity.length > 80))) {
    addIssue(issuesByStep, 'schedule', 'aerobicExercises', 'Use up to 12 activities, with each name under 80 characters.')
  }

  if (!state.draft.equipmentMode) {
    addIssue(issuesByStep, 'equipment', 'equipmentMode', 'Choose the equipment access mode.')
  }
  if (state.draft.equipmentDetails.trim().length > 2_000) {
    addIssue(issuesByStep, 'equipment', 'equipmentDetails', 'Keep equipment details to 2000 characters or fewer.')
  }
  const extraEquipment = splitMultilineText(state.draft.equipmentDetails)
  if (extraEquipment.some(item => item.length > 80) || state.equipmentItems.length + extraEquipment.length > 23) {
    addIssue(issuesByStep, 'equipment', 'equipmentDetails', 'List up to 23 pieces of equipment. Keep each item under 80 characters and separate items with commas.')
  }

  state.clubSessions.forEach((session, index) => {
    if (session.category && !isWorkoutCategory(session.category)) {
      addIssue(issuesByStep, 'schedule', `clubSessions[${index}].category`, 'This saved club category is not recognised. Remove this card and add it again.')
    }
    if (!session.day) addIssue(issuesByStep, 'schedule', `clubSessions[${index}].day`, `Choose a day for club training ${index + 1}.`)
    if (!session.startTime.trim()) {
      addIssue(issuesByStep, 'schedule', `clubSessions[${index}].startTime`, `Add a time for club training ${index + 1}.`)
    } else {
      try {
        parseClockTime(session.startTime, `GuidedOnboarding.clubSessions[${index}].startTime`)
      } catch {
        addIssue(issuesByStep, 'schedule', `clubSessions[${index}].startTime`, `Use a valid time for club training ${index + 1}.`)
      }
    }
    const duration = parseCount(session.durationMinutes, 1, 1_440)
    if (session.durationMinutes && !duration.ok) {
      addIssue(issuesByStep, 'schedule', `clubSessions[${index}].durationMinutes`, `Saved duration for club training ${index + 1} is invalid.`)
    }
    if (session.activity.length > 120) addIssue(issuesByStep, 'schedule', `clubSessions[${index}].activity`, 'Keep the club description under 120 characters.')
    const projected = tryProjectRecurringClubSession(session)
    if (!projected.ok && projected.issues.some(issue => issue.field === 'notes')) {
      addIssue(issuesByStep, 'schedule', `clubSessions[${index}].notes`, `Club training ${index + 1} notes are too long.`)
    }
  })

  if (state.draft.reviewNotes.trim().length > 2_000) {
    addIssue(issuesByStep, 'review', 'reviewNotes', 'Keep review notes to 2000 characters or fewer.')
  }

  return {
    issues: GUIDED_ONBOARDING_STEP_ORDER.flatMap(stepId => issuesByStep[stepId]),
    issuesByStep,
  }
}

export function createGuidedOnboardingScreenProps(
  state: GuidedOnboardingState,
  dispatch: (action: GuidedOnboardingAction) => void,
): GuidedOnboardingScreenAdapterProps {
  const validation = validateGuidedOnboardingState(state)
  const stepSummaries = buildStepSummaries(state, validation)
  const currentStepIssues = state.currentStep === 'review'
    ? completionIssues(state)
    : validation.issuesByStep[state.currentStep]
  const emptyFields = new Set(Object.entries(state.draft).filter(([, value]) => !value?.trim()).map(([field]) => field))
  const currentStepMessages: FormMessage[] = currentStepIssues.map(issue => ({
    id: issue.id,
    tone: state.currentStep !== 'review' && (emptyFields.has(issue.field) || issue.field === 'trainingSelection') ? 'info' : 'error',
    text: issue.message,
  }))

  return {
    steps: stepSummaries,
    currentStep: state.currentStep,
    draft: state.draft,
    aerobicDayOptions: buildDayOptions(state.selectedDays.aerobic),
    strengthDayOptions: buildDayOptions(state.selectedDays.strength),
    mobilityDayOptions: buildDayOptions(state.selectedDays.mobility),
    aerobicModalityOptions: buildModalityOptions(state.aerobicModalities),
    strengthOptions: buildStrengthOptions(state.strengthPreference),
    equipmentModeOptions: buildEquipmentModeOptions(state.draft.equipmentMode),
    equipmentItems: state.equipmentItems,
    clubCategoryOptions: buildCategoryOptions(),
    clubScopeOptions: buildClubScopeOptions(state.clubSessions),
    clubSessions: state.clubSessions,
    messages: [...state.hydrationMessages, ...currentStepMessages],
    canGoBack: GUIDED_ONBOARDING_STEP_ORDER.indexOf(state.currentStep) > 0,
    canGoNext: state.currentStep !== 'review'
      && validation.issuesByStep[state.currentStep].length === 0
      && isNextStepAvailable(stepSummaries, state.currentStep),
    canFinish: state.currentStep === 'review' && completionIssues(state).length === 0,
    onSelectStep: stepId => dispatch({ type: 'selectStep', stepId }),
    onGoalSummaryChange: value => dispatch({ type: 'setGoalSummary', value }),
    onTargetDateChange: value => dispatch({ type: 'setTargetDate', value }),
    onGoalNotesChange: value => dispatch({ type: 'setGoalNotes', value }),
    onCategoryCountChange: (category, value) => dispatch({ type: 'setCategoryCount', category, value }),
    onToggleCategoryDay: (category, day) => dispatch({ type: 'toggleCategoryDay', category, day }),
    onToggleAerobicModality: id => dispatch({ type: 'toggleAerobicModality', id }),
    onAerobicExercisesChange: value => dispatch({ type: 'setAerobicExercises', value }),
    onStrengthPreferenceChange: id => dispatch({ type: 'setStrengthPreference', id: id as StrengthPreference }),
    onEquipmentModeChange: id => dispatch({ type: 'setEquipmentMode', id }),
    onEquipmentDetailsChange: value => dispatch({ type: 'setEquipmentDetails', value }),
    onToggleEquipmentItem: item => dispatch({ type: 'toggleEquipmentItem', item }),
    onClubSessionChange: (sessionId, field, value) => dispatch({ type: 'setClubSessionField', sessionId, field, value }),
    onAddClubSession: () => dispatch({ type: 'addClubSession' }),
    onRemoveClubSession: sessionId => dispatch({ type: 'removeClubSession', sessionId }),
    onReviewNotesChange: value => dispatch({ type: 'setReviewNotes', value }),
    onBack: () => dispatch({ type: 'back' }),
    onNext: () => dispatch({ type: 'next' }),
    onFinish: () => undefined,
  }
}

export function createResumableOnboardingDraft(
  state: GuidedOnboardingState,
  options: SaveDraftOptions,
): GuidedOnboardingResult<DomainOnboardingDraft> {
  const goal = normalizeOptionalText(state.draft.goalSummary)
  if (!goal) {
    return { ok: false, issues: [singleIssue('goal', 'goalSummary', 'A resumable draft still needs a primary goal.')] }
  }

  const metadata = encodeGuidedOnboardingMetadata(state)
  const projectedDraft = {
    version: 1 as const,
    id: state.identity.draftId,
    athleteId: state.identity.athleteId,
    createdOn: state.identity.createdOn,
    updatedOn: parseLocalDate(options.updatedOn, 'GuidedOnboardingDraft.updatedOn'),
    startingWeek: state.identity.startingWeek,
    name: state.identity.athleteName,
    goal,
    goalDate: parseOptionalLocalDate(state.draft.targetDate),
    sports: [...state.aerobicModalities],
    preferredWeeklyStructure: buildPreferredWeeklyStructure(state),
    strengthPreference: state.strengthPreference || undefined,
    equipmentDetails: buildEquipmentDetails(state),
    constraints: [],
    clubSessions: projectCompleteClubSessions(state.clubSessions),
    notes: metadata,
  }

  try {
    return { ok: true, value: parseDomainOnboardingDraft(projectedDraft), issues: [] }
  } catch (error) {
    return { ok: false, issues: [singleIssue('review', 'draft', asErrorMessage(error, 'Could not create the onboarding draft.'))] }
  }
}

export function restoreGuidedOnboardingStateFromDraft(draft: DomainOnboardingDraft): GuidedOnboardingState {
  const metadata = parseGuidedOnboardingMetadata(draft.notes)
  const derivedDays = metadata?.selectedDays ?? deriveSelectedDays(draft.preferredWeeklyStructure)
  const derivedCounts = deriveCounts(derivedDays)
  const restoredClubSessions = [
    ...draft.clubSessions.map(restoreClubSessionDraft),
    ...(metadata?.pendingClubSessions ?? []),
  ]
  const currentStep = metadata?.currentStep ?? firstIncompleteStep({
    identity: {
      athleteId: draft.athleteId as StableIdentity,
      draftId: draft.id as StableIdentity,
      athleteName: draft.name,
      createdOn: draft.createdOn,
      startingWeek: draft.startingWeek,
    },
    currentStep: 'goal',
    draft: emptyFeatureDraft(),
    selectedDays: derivedDays,
    aerobicModalities: metadata?.aerobicModalities ?? inferAerobicModalities(draft.sports),
    strengthPreference: draft.strengthPreference ?? '',
    equipmentItems: metadata?.equipmentItems ?? [],
    clubSessions: restoredClubSessions,
    nextClubSessionSequence: metadata?.nextClubSessionSequence ?? inferNextClubSessionSequence(restoredClubSessions),
    hydrationMessages: [],
  })

  return {
    identity: {
      athleteId: draft.athleteId as StableIdentity,
      draftId: draft.id as StableIdentity,
      athleteName: draft.name,
      createdOn: draft.createdOn,
      startingWeek: draft.startingWeek,
    },
    currentStep,
    draft: {
      goalSummary: draft.goal,
      targetDate: draft.goalDate ?? '',
      goalNotes: metadata?.goalNotes ?? '',
      aerobicSessionCount: metadata?.counts.aerobic ?? derivedCounts.aerobic,
      aerobicExercises: metadata?.aerobicExercises ?? (metadata?.aerobicModalities ?? inferAerobicModalities(draft.sports)).join(', '),
      strengthSessionCount: metadata?.counts.strength ?? derivedCounts.strength,
      mobilitySessionCount: metadata?.counts.mobility ?? derivedCounts.mobility,
      equipmentMode: metadata?.equipmentMode ?? inferEquipmentMode(draft.equipmentDetails),
      equipmentDetails: metadata?.equipmentDetailsText ?? deriveEquipmentDetailsText(draft.equipmentDetails),
      reviewNotes: metadata?.reviewNotes ?? '',
    },
    selectedDays: derivedDays,
    aerobicModalities: metadata?.aerobicModalities ?? inferAerobicModalities(draft.sports),
    strengthPreference: draft.strengthPreference ?? '',
    equipmentItems: metadata?.equipmentItems ?? [],
    clubSessions: restoredClubSessions,
    nextClubSessionSequence: Math.max(metadata?.nextClubSessionSequence ?? 1, inferNextClubSessionSequence(restoredClubSessions)),
    hydrationMessages: metadata
      ? []
      : [{ id: 'guided-onboarding-hydration', tone: 'info', text: 'Loaded a draft without onboarding metadata; counts and options were derived conservatively.' }],
  }
}

export function createAthleteProfileFromGuidedOnboardingState(
  state: GuidedOnboardingState,
  options: FinalizeAthleteOptions,
): GuidedOnboardingResult<AthleteProfile> {
  const issues = completionIssues(state)
  if (issues.length) return { ok: false, issues }

  const athleteName = normalizeOptionalText(options.athleteName) ?? state.identity.athleteName
  if (!athleteName) {
    return { ok: false, issues: [singleIssue('review', 'athleteName', 'Finalizing the athlete profile requires an athlete name.')] }
  }

  const projectedProfile = {
    version: 1 as const,
    id: state.identity.athleteId,
    createdOn: state.identity.createdOn,
    updatedOn: parseLocalDate(options.updatedOn, 'AthleteProfile.updatedOn'),
    name: athleteName,
    goal: normalizeOptionalText(state.draft.goalSummary)!,
    goalDate: parseOptionalLocalDate(state.draft.targetDate),
    sports: buildAthleteSports(state),
    preferredWeeklyStructure: buildPreferredWeeklyStructure(state),
    strengthPreference: state.strengthPreference || undefined,
    equipmentDetails: buildEquipmentDetails(state),
    constraints: [],
    clubSessions: projectCompleteClubSessions(state.clubSessions),
    notes: encodeGuidedOnboardingMetadata(state, { activeChoicesOnly: true }),
  }

  try {
    return { ok: true, value: parseAthleteProfile(projectedProfile), issues: [] }
  } catch (error) {
    return { ok: false, issues: [singleIssue('review', 'athleteProfile', asErrorMessage(error, 'Could not create the athlete profile.'))] }
  }
}

export function createFixedClubWorkoutsForTargetWeek(
  source: Pick<AthleteProfile | DomainOnboardingDraft, 'clubSessions'>,
  options: FixedClubWorkoutOptions,
): Workout[] {
  const weekStart = parseLocalDate(options.weekStart, 'FixedClubWorkouts.weekStart')
  const athleteId = parseStableIdentity(options.athleteId, 'FixedClubWorkouts.athleteId')
  const weekPlanId = parseStableIdentity(options.weekPlanId, 'FixedClubWorkouts.weekPlanId')

  return [...source.clubSessions]
    .filter(isFullySpecifiedClubSession)
    .sort((left, right) => left.dayOfWeek - right.dayOfWeek || left.startTime.localeCompare(right.startTime) || left.id.localeCompare(right.id))
    .map(session => {
      const scheduledDate = resolveSessionDateInTargetWeek(weekStart, session.dayOfWeek)
      const workoutId = createStableId('club', weekStart, session.id)
      return parseWorkout({
        version: 1,
        id: workoutId,
        athleteId,
        weekPlanId,
        scheduledDate,
        startTime: session.startTime,
        category: session.category,
        source: 'club',
        title: session.title,
        purpose: `Fixed club session for ${session.scope}.`,
        expectedDurationMin: session.durationMin,
        warmup: [],
        main: [{ id: createStableId(workoutId, 'main'), title: `Attend ${session.title}`, detail: session.scope, target: { minutes: session.durationMin } }],
        cooldown: [],
        fixedClubSession: {
          recurringSessionId: session.id,
          title: session.title,
          scope: session.scope,
          category: session.category,
          dayOfWeek: session.dayOfWeek,
          startTime: session.startTime,
          durationMin: session.durationMin,
        },
        notes: session.notes,
      })
    })
}

function completionIssues(state: GuidedOnboardingState): GuidedOnboardingIssue[] {
  const validation = validateGuidedOnboardingState(state)
  const issues = [...validation.issues]
  if (!buildPreferredWeeklyStructure(state).length && !projectCompleteClubSessions(state.clubSessions).length) {
    issues.push(singleIssue('schedule', 'preferredWeeklyStructure', 'Add preferred training days or recurring club sessions before finishing.'))
  }
  if (!buildAthleteSports(state).length) {
    issues.push(singleIssue('schedule', 'sports', 'Add some training to your week before finishing.'))
  }
  return issues
}

function buildStepSummaries(
  state: GuidedOnboardingState,
  validation = validateGuidedOnboardingState(state),
): OnboardingStepSummary[] {
  const sequentialAvailability = computeSequentialAvailability(validation)
  const currentIndex = GUIDED_ONBOARDING_STEP_ORDER.indexOf(state.currentStep)

  return GUIDED_ONBOARDING_STEP_ORDER.map((stepId, index) => ({
    id: stepId,
    title: stepTitle(stepId),
    description: stepDescription(stepId),
    isAvailable: index <= sequentialAvailability || index === currentIndex,
    isComplete: stepId === 'review' ? completionIssues(state).length === 0 : validation.issuesByStep[stepId].length === 0,
  }))
}

function computeSequentialAvailability(validation: GuidedOnboardingValidation): number {
  let lastAvailableIndex = 0
  for (let index = 0; index < GUIDED_ONBOARDING_STEP_ORDER.length - 1; index += 1) {
    if (validation.issuesByStep[GUIDED_ONBOARDING_STEP_ORDER[index]!].length > 0) return lastAvailableIndex
    lastAvailableIndex = index + 1
  }
  return lastAvailableIndex
}

function firstIncompleteStep(state: GuidedOnboardingState): OnboardingStepId {
  const validation = validateGuidedOnboardingState(state)
  return GUIDED_ONBOARDING_STEP_ORDER.find(stepId => validation.issuesByStep[stepId].length > 0) ?? 'review'
}

function stepTitle(stepId: OnboardingStepId): string {
  switch (stepId) {
    case 'goal': return 'Goal'
    case 'schedule': return 'Schedule'
    case 'modalities': return 'Modalities'
    case 'strength': return 'Strength'
    case 'equipment': return 'Equipment'
    case 'club': return 'Club'
    case 'review': return 'Review'
  }
}

function stepDescription(stepId: OnboardingStepId): string {
  switch (stepId) {
    case 'goal': return 'Set the primary outcome and timing.'
    case 'schedule': return 'Capture counts and preferred days.'
    case 'modalities': return 'Select aerobic modalities.'
    case 'strength': return 'Choose the strength approach.'
    case 'equipment': return 'Declare default equipment access.'
    case 'club': return 'Anchor recurring fixed sessions.'
    case 'review': return 'Confirm the profile before saving.'
  }
}

function buildDayOptions(selectedDays: readonly DayOfWeek[]): ChoiceOption<DayOfWeek>[] {
  return DAY_ORDER.map(day => ({
    id: day,
    label: capitalize(day),
    selected: selectedDays.includes(day),
  }))
}

function buildModalityOptions(selectedIds: readonly string[]): ChoiceOption[] {
  const ordered = [...new Set([...DEFAULT_AEROBIC_MODALITY_IDS, ...selectedIds])]
  return ordered.map(id => ({ id, label: humanizeToken(id), selected: selectedIds.includes(id) }))
}

function buildStrengthOptions(selectedId: StrengthPreference | ''): ChoiceOption[] {
  return STRENGTH_PREFERENCE_ORDER.map(id => ({
    id,
    label: humanizeToken(id),
    selected: selectedId === id,
  }))
}

function buildEquipmentModeOptions(selectedId: EquipmentMode | ''): ChoiceOption<EquipmentMode>[] {
  return (Object.keys(EQUIPMENT_MODE_LABELS) as EquipmentMode[]).map(id => ({
    id,
    label: EQUIPMENT_MODE_LABELS[id],
    selected: selectedId === id,
  }))
}

function buildCategoryOptions(): SelectOption[] {
  return [{ value: '', label: 'Select category' }, ...CATEGORY_ORDER.map(category => ({ value: category, label: capitalize(category) }))]
}

function buildClubScopeOptions(clubSessions: readonly ClubSessionDraft[]): SelectOption[] {
  const customScopes = clubSessions
    .map(session => normalizeOptionalText(session.scope))
    .filter((value): value is string => Boolean(value))
  const scopes = [...new Set([...DEFAULT_CLUB_SCOPES, ...customScopes])]
  return [{ value: '', label: 'Select scope' }, ...scopes.map(scope => ({ value: scope, label: scope }))]
}

function buildPreferredWeeklyStructure(state: GuidedOnboardingState): PreferredTrainingDay[] {
  const byDay = new Map<number, { modalities: Set<WorkoutCategory>; clubSessions: RecurringClubSession[] }>()

  for (const category of CATEGORY_ORDER) {
    for (const day of state.selectedDays[category]) {
      const dayOfWeek = FEATURE_DAY_TO_DOMAIN_DAY[day]
      if (!byDay.has(dayOfWeek)) byDay.set(dayOfWeek, { modalities: new Set<WorkoutCategory>(), clubSessions: [] })
      byDay.get(dayOfWeek)!.modalities.add(category)
    }
  }

  for (const session of projectCompleteClubSessions(state.clubSessions)) {
    if (!session.category) continue
    if (!byDay.has(session.dayOfWeek)) byDay.set(session.dayOfWeek, { modalities: new Set<WorkoutCategory>(), clubSessions: [] })
    const entry = byDay.get(session.dayOfWeek)!
    entry.modalities.add(session.category)
    entry.clubSessions.push(session)
  }

  return [...byDay.entries()]
    .sort(([left], [right]) => left - right)
    .map(([dayOfWeek, value]) => {
      const anchoredSession = value.clubSessions.length === 1 ? value.clubSessions[0] : undefined
      return {
        dayOfWeek,
        modalities: CATEGORY_ORDER.filter(category => value.modalities.has(category)),
        preferredStartTime: anchoredSession?.startTime,
        expectedDurationMin: anchoredSession?.durationMin,
        notes: anchoredSession ? `Anchored by ${anchoredSession.title}.` : undefined,
      }
    })
}

function buildAthleteSports(state: GuidedOnboardingState): string[] {
  const completeClubSessions = projectCompleteClubSessions(state.clubSessions)
  const categorySignals: Record<WorkoutCategory, boolean> = {
    aerobic: countValue(state, 'aerobic') > 0 || completeClubSessions.some(session => session.category === 'aerobic'),
    strength: countValue(state, 'strength') > 0 || completeClubSessions.some(session => session.category === 'strength'),
    mobility: countValue(state, 'mobility') > 0 || completeClubSessions.some(session => session.category === 'mobility'),
  }
  const sports = categorySignals.aerobic ? [...state.aerobicModalities] : []

  if (!sports.length) {
    for (const category of CATEGORY_ORDER) {
      if (categorySignals[category]) sports.push(category)
    }
    if (!sports.length && completeClubSessions.length) sports.push('Club training')
  }

  return [...new Set(sports)]
}

function buildEquipmentDetails(state: GuidedOnboardingState): EquipmentDetail[] {
  const details: EquipmentDetail[] = []
  if (state.draft.equipmentMode) {
    details.push({
      id: createStableId('equipment-mode', state.draft.equipmentMode),
      label: EQUIPMENT_MODE_LABELS[state.draft.equipmentMode],
      constraints: [],
    })
  }
  state.equipmentItems.forEach((item, index) => details.push({
    id: createStableId('equipment-item', String(index + 1), item),
    label: item,
    constraints: [],
  }))
  splitMultilineText(state.draft.equipmentDetails).forEach((line, index) => {
    details.push({
      id: createStableId('equipment-detail', String(index + 1), line),
      label: line,
      constraints: [],
    })
  })
  return details
}

function projectCompleteClubSessions(clubSessions: readonly ClubSessionDraft[]): RecurringClubSession[] {
  return clubSessions.flatMap(session => {
    const projected = tryProjectRecurringClubSession(session)
    return projected.ok && projected.value ? [projected.value] : []
  })
}

function tryProjectRecurringClubSession(session: ClubSessionDraft): GuidedOnboardingResult<RecurringClubSession> {
  const issues: GuidedOnboardingIssue[] = []
  const category = isWorkoutCategory(session.category) ? session.category : undefined
  const activity = normalizeOptionalText(session.activity)
  const scope = normalizeOptionalText(session.scope)
  const location = normalizeOptionalText(session.location)
  const day = session.day ? FEATURE_DAY_TO_DOMAIN_DAY[session.day] : undefined
  const startTime = session.startTime.trim() ? safeParseClockTime(session.startTime) : undefined
  const duration = session.durationMinutes ? parseCount(session.durationMinutes, 1, 1_440) : undefined

  if (day === undefined || !startTime || (duration && !duration.ok)) {
    return { ok: false, issues }
  }

  const notes = location ? encodeClubSessionNotes(location, session.notes) : normalizeOptionalText(session.notes)
  if (notes && notes.length > 500) {
    issues.push(singleIssue('club', 'notes', 'Club session notes exceed the domain limit once location metadata is stored.'))
    return { ok: false, issues }
  }

  return {
    ok: true,
    value: {
      id: parseStableIdentity(session.id, 'GuidedOnboarding.clubSession.id'),
      title: activity ?? 'Club training',
      scope,
      category,
      dayOfWeek: day,
      startTime,
      durationMin: duration?.ok ? duration.value : undefined,
      notes,
    },
    issues: [],
  }
}

function restoreClubSessionDraft(session: RecurringClubSession): ClubSessionDraft {
  const decoded = decodeClubSessionNotes(session.notes)
  const day = DOMAIN_DAY_TO_FEATURE_DAY[session.dayOfWeek]
  if (!day) throw new Error(`Unsupported club session day ${session.dayOfWeek}.`)
  return {
    id: session.id,
    category: session.category ?? '',
    activity: session.title,
    scope: session.scope ?? '',
    location: decoded.location,
    day,
    startTime: session.startTime,
    durationMinutes: session.durationMin === undefined ? '' : String(session.durationMin),
    notes: decoded.notes,
  }
}

function encodeGuidedOnboardingMetadata(state: GuidedOnboardingState, options: { activeChoicesOnly?: boolean } = {}): string {
  const includeAerobic = !options.activeChoicesOnly || countValue(state, 'aerobic') > 0
  const metadata: GuidedOnboardingMetadata = {
    version: 1,
    currentStep: state.currentStep,
    counts: {
      aerobic: state.draft.aerobicSessionCount,
      strength: state.draft.strengthSessionCount,
      mobility: state.draft.mobilitySessionCount,
    },
    aerobicModalities: includeAerobic ? [...state.aerobicModalities] : [],
    aerobicExercises: includeAerobic ? state.draft.aerobicExercises ?? state.aerobicModalities.join(', ') : '',
    equipmentItems: [...state.equipmentItems],
    selectedDays: { aerobic: [...state.selectedDays.aerobic], strength: [...state.selectedDays.strength], mobility: [...state.selectedDays.mobility] },
    goalNotes: state.draft.goalNotes,
    reviewNotes: state.draft.reviewNotes,
    equipmentMode: state.draft.equipmentMode,
    equipmentDetailsText: state.draft.equipmentDetails,
    nextClubSessionSequence: state.nextClubSessionSequence,
    pendingClubSessions: state.clubSessions.filter(session => !tryProjectRecurringClubSession(session).ok),
  }

  return `${NOTES_METADATA_PREFIX}${JSON.stringify(metadata)}`
}

export function readGuidedSessionCounts(notes: string | undefined): Partial<Record<WorkoutCategory, number>> {
  const metadata = parseGuidedOnboardingMetadata(notes)
  const counts: Partial<Record<WorkoutCategory, number>> = {}
  if (metadata) {
    for (const category of CATEGORY_ORDER) {
      const parsed = parseCount(metadata.counts[category])
      if (parsed.ok) counts[category] = parsed.value
    }
  }
  return counts
}

function parseGuidedOnboardingMetadata(value: string | undefined): GuidedOnboardingMetadata | undefined {
  if (!value?.startsWith(NOTES_METADATA_PREFIX)) return undefined
  try {
    const parsed = JSON.parse(value.slice(NOTES_METADATA_PREFIX.length)) as Partial<GuidedOnboardingMetadata>
    if (parsed.version !== 1) return undefined
    const currentStep = parsed.currentStep === 'modalities' || parsed.currentStep === 'club' ? 'schedule' : parsed.currentStep === 'strength' ? 'equipment' : parsed.currentStep
    if (!GUIDED_ONBOARDING_STEP_ORDER.includes(currentStep as OnboardingStepId)) return undefined
    return {
      version: 1,
      currentStep: currentStep as OnboardingStepId,
      counts: {
        aerobic: typeof parsed.counts?.aerobic === 'string' ? parsed.counts.aerobic : '',
        strength: typeof parsed.counts?.strength === 'string' ? parsed.counts.strength : '',
        mobility: typeof parsed.counts?.mobility === 'string' ? parsed.counts.mobility : '',
      },
      aerobicModalities: Array.isArray(parsed.aerobicModalities) ? parsed.aerobicModalities.filter(entry => typeof entry === 'string') : [],
      aerobicExercises: typeof parsed.aerobicExercises === 'string' ? parsed.aerobicExercises : undefined,
      equipmentItems: Array.isArray(parsed.equipmentItems) ? parsed.equipmentItems.filter(entry => typeof entry === 'string') : undefined,
      selectedDays: parsed.selectedDays && CATEGORY_ORDER.every(category => Array.isArray(parsed.selectedDays?.[category]) && parsed.selectedDays[category].every(day => DAY_ORDER.includes(day))) ? parsed.selectedDays : undefined,
      goalNotes: typeof parsed.goalNotes === 'string' ? parsed.goalNotes : '',
      reviewNotes: typeof parsed.reviewNotes === 'string' ? parsed.reviewNotes : '',
      equipmentMode: parsed.equipmentMode === 'bodyweight' || parsed.equipmentMode === 'home' || parsed.equipmentMode === 'commercial'
        ? parsed.equipmentMode
        : '',
      equipmentDetailsText: typeof parsed.equipmentDetailsText === 'string' ? parsed.equipmentDetailsText : '',
      nextClubSessionSequence: typeof parsed.nextClubSessionSequence === 'number' && Number.isSafeInteger(parsed.nextClubSessionSequence) && parsed.nextClubSessionSequence > 0
        ? parsed.nextClubSessionSequence
        : 1,
      pendingClubSessions: Array.isArray(parsed.pendingClubSessions)
        ? parsed.pendingClubSessions.flatMap(entry => isClubSessionDraft(entry) ? [entry] : [])
        : [],
    }
  } catch {
    return undefined
  }
}

function encodeClubSessionNotes(location: string, notes: string): string | undefined {
  const normalizedNotes = normalizeOptionalText(notes)
  const payload: ClubNotesPayload = { location }
  const parts = [`${CLUB_METADATA_PREFIX}${JSON.stringify(payload)}`]
  if (normalizedNotes) parts.push(normalizedNotes)
  return parts.join('\n\n')
}

function decodeClubSessionNotes(value: string | undefined): { location: string; notes: string } {
  if (!value) return { location: '', notes: '' }
  if (!value.startsWith(CLUB_METADATA_PREFIX)) return { location: '', notes: value }
  const [header, ...rest] = value.split('\n\n')
  if (!header) return { location: '', notes: rest.join('\n\n') }
  try {
    const parsed = JSON.parse(header.slice(CLUB_METADATA_PREFIX.length)) as Partial<ClubNotesPayload>
    return {
      location: typeof parsed.location === 'string' ? parsed.location : '',
      notes: rest.join('\n\n'),
    }
  } catch {
    return { location: '', notes: value }
  }
}

function deriveSelectedDays(structure: readonly PreferredTrainingDay[]): Record<WorkoutCategory, DayOfWeek[]> {
  const selectedDays: Record<WorkoutCategory, DayOfWeek[]> = { aerobic: [], strength: [], mobility: [] }
  for (const day of structure) {
    const featureDay = DOMAIN_DAY_TO_FEATURE_DAY[day.dayOfWeek]
    if (!featureDay) continue
    for (const category of day.modalities) {
      if (!selectedDays[category].includes(featureDay)) selectedDays[category].push(featureDay)
    }
  }
  return {
    aerobic: sortDays(selectedDays.aerobic),
    strength: sortDays(selectedDays.strength),
    mobility: sortDays(selectedDays.mobility),
  }
}

function deriveCounts(selectedDays: Readonly<Record<WorkoutCategory, readonly DayOfWeek[]>>): Record<WorkoutCategory, string> {
  return {
    aerobic: String(selectedDays.aerobic.length),
    strength: String(selectedDays.strength.length),
    mobility: String(selectedDays.mobility.length),
  }
}

function inferAerobicModalities(sports: readonly string[]): string[] {
  return sports.filter(sport => sport !== 'aerobic' && sport !== 'strength' && sport !== 'mobility')
}

function inferEquipmentMode(details: readonly EquipmentDetail[]): EquipmentMode | '' {
  const modeEntry = details.find(detail => detail.id.startsWith('equipment-mode-'))
  if (!modeEntry) return ''
  if (modeEntry.id.endsWith('bodyweight')) return 'bodyweight'
  if (modeEntry.id.endsWith('home')) return 'home'
  if (modeEntry.id.endsWith('commercial')) return 'commercial'
  return ''
}

function deriveEquipmentDetailsText(details: readonly EquipmentDetail[]): string {
  return details
    .filter(detail => !detail.id.startsWith('equipment-mode-'))
    .map(detail => detail.label)
    .join('\n')
}

function resolveSessionDateInTargetWeek(weekStart: LocalDateString, targetDayOfWeek: number): LocalDateString {
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDaysToLocalDate(weekStart, offset)
    if (localDateDayOfWeek(date) === targetDayOfWeek) return date
  }
  throw new Error(`Could not resolve day ${targetDayOfWeek} inside target week ${weekStart}.`)
}

function countValue(state: GuidedOnboardingState, category: WorkoutCategory): number {
  const parsed = parseCount(state.draft[COUNT_FIELD_BY_CATEGORY[category]])
  return parsed.ok ? parsed.value : 0
}

function parseCount(value: string, minimum = 0, maximum = 14): { ok: true; value: number } | { ok: false } {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return { ok: false }
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return { ok: false }
  return { ok: true, value: parsed }
}

function parseOptionalLocalDate(value: string): LocalDateString | undefined {
  const normalized = value.trim()
  return normalized ? parseLocalDate(normalized, 'GuidedOnboarding.optionalDate') : undefined
}

function safeParseClockTime(value: string): string | undefined {
  try {
    return parseClockTime(value, 'GuidedOnboarding.time')
  } catch {
    return undefined
  }
}

function emptyFeatureDraft(): FeatureOnboardingDraft {
  return {
    goalSummary: '',
    targetDate: '',
    goalNotes: '',
    aerobicSessionCount: '0',
    aerobicExercises: '',
    strengthSessionCount: '0',
    mobilitySessionCount: '0',
    equipmentMode: '',
    equipmentDetails: '',
    reviewNotes: '',
  }
}

function emptyClubSessionDraft(id: StableIdentity): ClubSessionDraft {
  return {
    id,
    category: '',
    activity: '',
    scope: '',
    location: '',
    day: '',
    startTime: '',
    durationMinutes: '',
    notes: '',
  }
}

function toggleDay(days: readonly DayOfWeek[], day: DayOfWeek): DayOfWeek[] {
  return sortDays(toggleString(days, day))
}

function sortDays(days: readonly DayOfWeek[]): DayOfWeek[] {
  return [...days].sort((left, right) => DAY_ORDER.indexOf(left) - DAY_ORDER.indexOf(right))
}

function toggleString<T extends string>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter(entry => entry !== value) : [...values, value]
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function humanizeToken(value: string): string {
  return value.split('-').join(' ').split('_').join(' ').replace(/\b\w/g, char => char.toUpperCase())
}

function splitMultilineText(value: string): string[] {
  return value.split(/[,;\r\n]/u).map(line => line.trim()).filter(Boolean)
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function createStableId(prefix: string, ...parts: string[]): StableIdentity {
  const normalized = [prefix, ...parts]
    .flatMap(part => part.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-'))
    .filter(Boolean)
    .join('-')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '')

  return parseStableIdentity(normalized, 'generated id')
}

function isWorkoutCategory(value: string): value is WorkoutCategory {
  return CATEGORY_ORDER.includes(value as WorkoutCategory)
}

function addIssue(
  issuesByStep: Record<OnboardingStepId, GuidedOnboardingIssue[]>,
  stepId: OnboardingStepId,
  field: string,
  message: string,
): void {
  issuesByStep[stepId].push({
    id: `${stepId}:${field}:${issuesByStep[stepId].length + 1}`,
    stepId,
    field,
    message,
  })
}

function singleIssue(stepId: OnboardingStepId, field: string, message: string): GuidedOnboardingIssue {
  return { id: `${stepId}:${field}:1`, stepId, field, message }
}

function asErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function inferNextClubSessionSequence(clubSessions: readonly ClubSessionDraft[]): number {
  const maxSequence = clubSessions.reduce((highest, session) => {
    const match = /^club-session-(\d+)$/u.exec(session.id)
    return match ? Math.max(highest, Number(match[1])) : highest
  }, 0)
  return maxSequence + 1
}

function isNextStepAvailable(steps: readonly OnboardingStepSummary[], currentStep: OnboardingStepId): boolean {
  const currentIndex = GUIDED_ONBOARDING_STEP_ORDER.indexOf(currentStep)
  const nextStepId = GUIDED_ONBOARDING_STEP_ORDER[currentIndex + 1]
  return nextStepId ? steps.some(step => step.id === nextStepId && step.isAvailable) : false
}

function isClubSessionDraft(value: unknown): value is ClubSessionDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<ClubSessionDraft>
  return typeof candidate.id === 'string'
    && typeof candidate.category === 'string'
    && typeof candidate.activity === 'string'
    && typeof candidate.scope === 'string'
    && typeof candidate.location === 'string'
    && (candidate.day === '' || DAY_ORDER.includes(candidate.day as DayOfWeek))
    && typeof candidate.startTime === 'string'
    && typeof candidate.durationMinutes === 'string'
    && typeof candidate.notes === 'string'
}
