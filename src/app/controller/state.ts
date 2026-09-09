import type { WeekPromptKind } from '../../ai/index.ts'
import type { AthleteProfile, OnboardingDraft, WeekPlan, Workout, WorkoutLog } from '../../domain/contracts.ts'
import type { LocalDateString } from '../../domain/local-date.ts'
import type { FormMessage, WorkoutSectionId } from '../features/models.ts'
import type { JsonHandoffPreviewState } from '../state/ai-handoff.ts'
import {
  reduceGuidedOnboardingState,
  type GuidedOnboardingAction,
  type GuidedOnboardingState,
} from '../state/onboarding.ts'
import type { PlannerState } from '../state/planner.ts'
import { createWorkoutReviewState, mergeSavedWorkoutReviewLogs, rebaseWorkoutReviewState, reduceInlineWorkoutReviewState, reduceWorkoutReviewState, type WorkoutReviewAction, type WorkoutReviewState } from '../state/review.ts'
import type {
  SettingsAthleteProfileDraft,
  SettingsBackupExportAdapter,
  SettingsResetRequest,
  SettingsRestorePreviewState,
} from '../state/settings.ts'
import {
  addEditorStep,
  moveEditorStep,
  updateEditorSections,
  type WorkoutEditorState,
} from './workoutDraft.ts'
import type { WorkoutEditorDraft, WorkoutStepDraft } from '../features/models.ts'

export type AppRoute = 'start' | 'onboarding' | 'planner' | 'ai' | 'log' | 'review' | 'settings'

export interface EditorSlice {
  readonly mode: 'create' | 'edit'
  readonly localId?: string
  readonly existing?: Workout
  readonly state: WorkoutEditorState
  readonly messages: readonly FormMessage[]
}

export interface HandoffSlice {
  readonly kind: WeekPromptKind
  readonly targetWeekStart?: LocalDateString
  readonly promptText: string
  readonly jsonText: string
  readonly preview: JsonHandoffPreviewState | null
  readonly messages: readonly FormMessage[]
}

export interface SettingsSlice {
  readonly profileDraft?: SettingsAthleteProfileDraft
  readonly backup?: SettingsBackupExportAdapter
  readonly restoreJson: string
  readonly restorePreview: SettingsRestorePreviewState | null
  readonly restoreConfirmation: string
  readonly pendingReset?: SettingsResetRequest
  readonly resetConfirmation: string
  readonly messages: readonly FormMessage[]
}

export interface AppState {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly route: AppRoute
  readonly loadError?: string
  readonly busy: boolean
  readonly storageRevision: number
  readonly status: FormMessage | null
  readonly athlete?: AthleteProfile
  readonly planner?: PlannerState
  readonly savedWeek?: WeekPlan
  readonly unsavedWeek: boolean
  readonly logs: readonly WorkoutLog[]
  readonly resumableDraft?: OnboardingDraft
  readonly onboarding?: GuidedOnboardingState
  readonly review?: WorkoutReviewState
  readonly activeLogWorkoutId?: string
  readonly editor?: EditorSlice
  readonly movePickerLocalId?: string
  readonly handoff: HandoffSlice
  readonly settings: SettingsSlice
}

export type AppAction =
  | { readonly type: 'bootstrapped'; readonly athlete?: AthleteProfile; readonly planner?: PlannerState; readonly savedWeek?: WeekPlan; readonly logs: readonly WorkoutLog[]; readonly draft?: OnboardingDraft }
  | { readonly type: 'bootstrapFailed'; readonly message: string }
  | { readonly type: 'navigate'; readonly route: AppRoute }
  | { readonly type: 'status'; readonly message: FormMessage | null }
  | { readonly type: 'busy'; readonly value: boolean }
  | { readonly type: 'storageChanged' }
  | { readonly type: 'startOnboarding'; readonly onboarding: GuidedOnboardingState }
  | { readonly type: 'onboarding'; readonly action: GuidedOnboardingAction }
  | { readonly type: 'onboardingFinished'; readonly athlete: AthleteProfile; readonly planner: PlannerState; readonly savedWeek?: WeekPlan }
  | { readonly type: 'setAthlete'; readonly athlete: AthleteProfile }
  | { readonly type: 'setPlanner'; readonly planner: PlannerState; readonly unsaved?: boolean }
  | { readonly type: 'weekPersisted'; readonly weekPlan: WeekPlan }
  | { readonly type: 'weekImported'; readonly planner: PlannerState; readonly weekPlan: WeekPlan; readonly logs: readonly WorkoutLog[]; readonly athleteProfile?: AthleteProfile }
  | { readonly type: 'workoutDeleted'; readonly planner: PlannerState; readonly weekPlan: WeekPlan; readonly logs: readonly WorkoutLog[] }
  | { readonly type: 'reviewWeekSaved'; readonly weekPlan: WeekPlan }
  | { readonly type: 'openEditor'; readonly editor: EditorSlice }
  | { readonly type: 'closeEditor' }
  | { readonly type: 'editorField'; readonly field: keyof WorkoutEditorDraft; readonly value: string }
  | { readonly type: 'editorStepField'; readonly sectionId: WorkoutSectionId; readonly stepId: string; readonly field: Exclude<keyof WorkoutStepDraft, 'id'>; readonly value: string }
  | { readonly type: 'editorAddStep'; readonly sectionId: WorkoutSectionId }
  | { readonly type: 'editorMoveStep'; readonly sectionId: WorkoutSectionId; readonly stepId: string; readonly direction: 'down' | 'up' }
  | { readonly type: 'editorRemoveStep'; readonly sectionId: WorkoutSectionId; readonly stepId: string }
  | { readonly type: 'editorMessages'; readonly messages: readonly FormMessage[] }
  | { readonly type: 'openMovePicker'; readonly localId: string }
  | { readonly type: 'closeMovePicker' }
  | { readonly type: 'setHandoffJson'; readonly value: string }
  | { readonly type: 'setHandoffPreview'; readonly preview: JsonHandoffPreviewState | null }
  | { readonly type: 'setPrompt'; readonly kind: WeekPromptKind; readonly targetWeekStart: LocalDateString; readonly promptText: string }
  | { readonly type: 'handoffMessages'; readonly messages: readonly FormMessage[] }
  | { readonly type: 'clearHandoff' }
  | { readonly type: 'setReview'; readonly review: WorkoutReviewState }
  | { readonly type: 'review'; readonly action: WorkoutReviewAction }
  | { readonly type: 'inlineReview'; readonly action: WorkoutReviewAction }
  | { readonly type: 'reviewLogsSaved'; readonly submitted: WorkoutReviewState; readonly logs: readonly WorkoutLog[]; readonly savedWorkoutIds: readonly string[] }
  | { readonly type: 'openLog'; readonly workoutId: string }
  | { readonly type: 'closeLog' }
  | { readonly type: 'setLogs'; readonly logs: readonly WorkoutLog[] }
  | { readonly type: 'settings'; readonly patch: Partial<SettingsSlice> }

export function createInitialAppState(): AppState {
  return {
    phase: 'loading',
    route: 'start',
    busy: false,
    storageRevision: 0,
    status: null,
    unsavedWeek: false,
    logs: [],
    handoff: {
      kind: 'initial',
      promptText: '',
      jsonText: '',
      preview: null,
      messages: [],
    },
    settings: {
      restoreJson: '',
      restorePreview: null,
      restoreConfirmation: '',
      resetConfirmation: '',
      messages: [],
    },
  }
}

function withEditorSteps(
  state: AppState,
  sectionId: WorkoutSectionId,
  update: (steps: readonly WorkoutStepDraft[]) => readonly WorkoutStepDraft[],
): AppState {
  if (!state.editor) return state
  return {
    ...state,
    editor: {
      ...state.editor,
      state: {
        ...state.editor.state,
        sections: updateEditorSections(state.editor.state.sections, sectionId, update),
      },
    },
  }
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'bootstrapped':
      return {
        ...createInitialAppState(),
        phase: 'ready',
        storageRevision: state.storageRevision + 1,
        athlete: action.athlete,
        planner: action.planner,
        savedWeek: action.savedWeek,
        unsavedWeek: false,
        logs: action.logs,
        resumableDraft: action.draft,
      }
    case 'bootstrapFailed':
      return { ...state, phase: 'error', loadError: action.message }
    case 'navigate':
      return { ...state, route: action.route, status: null }
    case 'status':
      return { ...state, status: action.message }
    case 'busy':
      return { ...state, busy: action.value }
    case 'storageChanged':
      return { ...state, storageRevision: state.storageRevision + 1, settings: { ...state.settings, backup: undefined } }
    case 'startOnboarding':
      return { ...state, onboarding: action.onboarding, route: 'onboarding', status: null }
    case 'onboarding':
      return state.onboarding
        ? { ...state, onboarding: reduceGuidedOnboardingState(state.onboarding, action.action) }
        : state
    case 'onboardingFinished':
      return {
        ...createInitialAppState(),
        phase: 'ready',
        busy: state.busy,
        storageRevision: state.storageRevision + 1,
        athlete: action.athlete,
        planner: action.planner,
        savedWeek: action.savedWeek,
        unsavedWeek: !action.savedWeek,
        onboarding: undefined,
        resumableDraft: undefined,
        review: undefined,
        logs: [],
        route: 'planner',
      }
    case 'setAthlete':
      return {
        ...state, athlete: action.athlete, storageRevision: state.storageRevision + 1,
        settings: { ...state.settings, backup: undefined, profileDraft: undefined },
        handoff: { ...state.handoff, promptText: '', preview: null, messages: [] },
      }
    case 'setPlanner': {
      const sameWeek = state.planner?.present.week.id === action.planner.present.week.id
      return {
        ...state, planner: action.planner, unsavedWeek: action.unsaved ?? state.unsavedWeek,
        ...(sameWeek ? {} : {
          review: undefined, savedWeek: undefined, logs: [], activeLogWorkoutId: undefined,
          editor: undefined, movePickerLocalId: undefined, handoff: createInitialAppState().handoff,
        }),
      }
    }
    case 'weekPersisted':
      return {
        ...state, savedWeek: action.weekPlan, unsavedWeek: false,
        storageRevision: state.storageRevision + 1, settings: { ...state.settings, backup: undefined },
        review: state.review ? rebaseWorkoutReviewState(state.review, action.weekPlan, state.logs) : undefined,
      }
    case 'weekImported':
      return {
        ...state,
        ...(action.athleteProfile ? { athlete: action.athleteProfile } : {}),
        planner: action.planner,
        savedWeek: action.weekPlan,
        logs: action.logs,
        unsavedWeek: false,
        review: undefined,
        editor: undefined,
        activeLogWorkoutId: undefined,
        movePickerLocalId: undefined,
        onboarding: undefined,
        handoff: createInitialAppState().handoff,
        settings: { ...state.settings, backup: undefined, profileDraft: undefined },
        storageRevision: state.storageRevision + 1,
        route: 'planner',
      }
    case 'workoutDeleted':
      return {
        ...state, planner: action.planner, savedWeek: action.weekPlan, logs: action.logs,
        unsavedWeek: false, editor: undefined, activeLogWorkoutId: undefined, movePickerLocalId: undefined,
        storageRevision: state.storageRevision + 1, settings: { ...state.settings, backup: undefined },
        review: state.review
          ? rebaseWorkoutReviewState(state.review, action.weekPlan, action.logs)
          : createWorkoutReviewState({ weekPlan: action.weekPlan, workoutLogs: action.logs }),
      }
    case 'reviewWeekSaved':
      if (state.planner?.present.week.id !== action.weekPlan.id) return state
      return {
        ...state, savedWeek: action.weekPlan,
        planner: { ...state.planner, present: { week: { ...state.planner.present.week, review: action.weekPlan.review } } },
        review: state.review ? { ...state.review, weekPlan: action.weekPlan } : undefined,
        storageRevision: state.storageRevision + 1, settings: { ...state.settings, backup: undefined },
      }
    case 'openEditor':
      return { ...state, editor: action.editor }
    case 'closeEditor':
      return { ...state, editor: undefined }
    case 'editorField':
      return state.editor
        ? {
          ...state,
          editor: {
            ...state.editor,
            state: { ...state.editor.state, draft: { ...state.editor.state.draft, [action.field]: action.value } },
          },
        }
        : state
    case 'editorStepField':
      return withEditorSteps(state, action.sectionId, steps =>
        steps.map(step => (step.id === action.stepId ? { ...step, [action.field]: action.value } : step)))
    case 'editorAddStep':
      return withEditorSteps(state, action.sectionId, addEditorStep)
    case 'editorMoveStep':
      return withEditorSteps(state, action.sectionId, steps => moveEditorStep(steps, action.stepId, action.direction))
    case 'editorRemoveStep':
      return withEditorSteps(state, action.sectionId, steps => steps.filter(step => step.id !== action.stepId))
    case 'editorMessages':
      return state.editor ? { ...state, editor: { ...state.editor, messages: action.messages } } : state
    case 'openMovePicker':
      return { ...state, movePickerLocalId: action.localId }
    case 'closeMovePicker':
      return { ...state, movePickerLocalId: undefined }
    case 'setHandoffJson':
      return { ...state, handoff: { ...state.handoff, jsonText: action.value, preview: null, messages: [] } }
    case 'setHandoffPreview':
      return { ...state, handoff: { ...state.handoff, preview: action.preview } }
    case 'setPrompt':
      return {
        ...state,
        handoff: {
          ...state.handoff,
          kind: action.kind,
          targetWeekStart: action.targetWeekStart,
          promptText: action.promptText,
          preview: null,
          messages: [],
        },
      }
    case 'handoffMessages':
      return { ...state, handoff: { ...state.handoff, messages: action.messages } }
    case 'clearHandoff':
      return { ...state, handoff: { ...state.handoff, jsonText: '', preview: null, messages: [] } }
    case 'setReview':
      return { ...state, review: action.review }
    case 'review':
      return state.review ? { ...state, review: reduceWorkoutReviewState(state.review, action.action) } : state
    case 'inlineReview':
      if (!state.review) throw new Error('Prepare the week before recording exercises.')
      return { ...state, review: reduceInlineWorkoutReviewState(state.review, action.action) }
    case 'reviewLogsSaved': {
      if (!state.review || state.review.weekPlan.id !== action.submitted.weekPlan.id) return state
      const review = mergeSavedWorkoutReviewLogs(state.review, action.submitted, action.logs, action.savedWorkoutIds)
      return {
        ...state,
        logs: review.sourceLogs,
        review,
        storageRevision: state.storageRevision + 1, settings: { ...state.settings, backup: undefined },
      }
    }
    case 'openLog':
      return { ...state, activeLogWorkoutId: action.workoutId, route: 'log', status: null }
    case 'closeLog':
      return { ...state, activeLogWorkoutId: undefined, route: 'planner' }
    case 'setLogs':
      return { ...state, logs: action.logs }
    case 'settings':
      return {
        ...state,
        settings: {
          ...state.settings, ...action.patch,
          ...(action.patch.restoreJson !== undefined && action.patch.restoreJson !== state.settings.restoreJson
            ? { restorePreview: null, restoreConfirmation: '' }
            : {}),
        },
      }
  }
}
