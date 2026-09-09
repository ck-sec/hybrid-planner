import { useEffect, useMemo, useReducer, useRef, useState, type DragEvent, type ReactElement } from 'react'
import { buildContinuationWeekPrompt, buildInitialWeekPrompt } from '../../ai/index.ts'
import type { AthleteProfile, Workout, WorkoutLog } from '../../domain/contracts.ts'
import { isFullySpecifiedClubSession } from '../../domain/contracts.ts'
import { localDateDayOfWeek } from '../../domain/local-date.ts'
import type { LocalDateString } from '../../domain/local-date.ts'
import { createHybridCoachRepository, type HybridCoachRepository } from '../../storage/indexeddb-repository.ts'
import { ActionButton } from '../components/ActionButton.tsx'
import { AppHeader, type AppHeaderProps } from '../components/AppHeader.tsx'
import { SessionCard } from '../components/SessionCard.tsx'
import { StartScreen } from '../components/StartScreen.tsx'
import { Icon } from '../components/Icon.tsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { ModalSurface } from '../components/Surfaces.tsx'
import { DayColumn } from '../components/WeekBoard.tsx'
import {
  GuidedOnboardingScreen,
  JsonHandoffScreen,
  SettingsBackupScreen,
  WeeklyReviewScreen,
  WorkoutEditorScreen,
  WorkoutLogScreen,
} from '../features/index.ts'
import type { FormMessage, WorkoutCompletionStatus } from '../features/models.ts'
import { InlineWorkoutLog } from '../features/inlineWorkoutLog.ts'
import { actionBar, h, sectionCard, selectInput, textArea, textInput } from '../features/ui.ts'
import { writeTextToClipboard } from '../state/ai-clipboard.ts'
import {
  buildInitialPromptInputFromAthleteProfile,
  previewAiWeekHandoff,
} from '../state/ai-handoff.ts'
import {
  createGuidedOnboardingScreenProps,
  createGuidedOnboardingState,
  restoreGuidedOnboardingStateFromDraft,
} from '../state/onboarding.ts'
import {
  createPlannerStateFromWeekPlan,
  deletePlannerWorkout,
  duplicatePlannerWorkout,
  addPlannerWorkout,
  movePlannerWorkout,
  plannerStateToWeekPlan,
  updatePlannerWorkout,
  type PlannerState,
  type PlannerWorkoutChanges,
  type PlannerWorkoutEntry,
} from '../state/planner.ts'
import {
  buildWorkoutReviewPayload,
  createWeeklyReviewScreenProps,
  createWorkoutLogScreenProps,
  createWorkoutReviewState,
  getDirtyWorkoutReviewIds,
  startWorkoutReviewLog,
  validateWorkoutReviewState,
  type WorkoutReviewAction,
  type WorkoutReviewState,
} from '../state/review.ts'
import {
  applyConfirmedReset,
  applyPreviewedBackupRestore,
  canApplyConfirmedReset,
  canApplyPreviewedBackupRestore,
  createAthleteProfileEditingDraft,
  createBackupDownload,
  createSettingsPrivacyMessages,
  createSettingsResetActions,
  exportRepositoryBackup,
  parseAthleteProfileEditingDraft,
  previewRestoreBackupJson,
  requestResetConfirmation,
  type SettingsAthleteProfileDraft,
} from '../state/settings.ts'
import { currentWeekStart, followingWeekStart, formatDateShort, formatDayLabel, formatWeekRange, formatWeekday, listWeekDates, todayLocalDate } from './dates.ts'
import {
  applyWeekImport,
  bootstrapApp,
  finalizeGuidedOnboarding,
  persistPlannerWeek,
  saveOnboardingDraftState,
  saveReviewWorkoutLog,
  savePendingReviewWorkoutLogs,
  startManualWeek,
} from './effects.ts'
import { createControllerId } from './ids.ts'
import { appReducer, createInitialAppState, type AppRoute, type AppState } from './state.ts'
import {
  buildDayOptions,
  buildHeaderProps,
  buildStartScreenProps,
} from './viewModel.ts'
import {
  WORKOUT_CATEGORY_OPTIONS,
  WORKOUT_MODALITY_OPTIONS,
  WORKOUT_SOURCE_OPTIONS,
  buildWorkoutDefinition,
  createBlankWorkoutEditorState,
  workoutToEditorState,
} from './workoutDraft.ts'

const COMPLETION_OPTIONS: readonly { id: WorkoutCompletionStatus; label: string }[] = [
  { id: 'completed', label: 'Completed' },
  { id: 'partial', label: 'Partial' },
  { id: 'skipped', label: 'Skipped' },
]

export interface AppControllerProps {
  readonly repository?: HybridCoachRepository
  readonly now?: () => Date
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function message(id: string, tone: FormMessage['tone'], text: string): FormMessage {
  return { id, tone, text }
}

export function AppController({ repository: injectedRepository, now = () => new Date() }: AppControllerProps = {}) {
  const repository = useMemo(() => injectedRepository ?? createHybridCoachRepository(), [injectedRepository])
  const [state, dispatch] = useReducer(appReducer, createInitialAppState())
  const [pendingDeleteLocalId, setPendingDeleteLocalId] = useState<string | null>(null)
  const [moveTargetDate, setMoveTargetDate] = useState('')
  const [draggingLocalId, setDraggingLocalId] = useState<string | null>(null)
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dirtyWorkoutIds = useMemo(() => state.review ? getDirtyWorkoutReviewIds(state.review) : [], [state.review])

  const today = todayLocalDate(now())

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const snapshot = await bootstrapApp(repository)
        if (!active) return
        const planner = snapshot.weekPlan ? createPlannerStateFromWeekPlan(snapshot.weekPlan) : undefined
        dispatch({
          type: 'bootstrapped',
          athlete: snapshot.athlete,
          planner,
          savedWeek: snapshot.weekPlan,
          logs: snapshot.logs,
          draft: snapshot.draft,
        })
      } catch (error) {
        if (!active) return
        dispatch({ type: 'bootstrapFailed', message: errorText(error, 'Local training storage could not be opened.') })
      }
    })()
    return () => {
      active = false
    }
  }, [repository])

  useEffect(() => {
    if (state.phase !== 'ready') return
    const main = document.getElementById('main')
    main?.focus({ preventScroll: true })
    globalThis.scrollTo({ top: 0, behavior: 'instant' })
  }, [state.route, state.phase, state.editor?.localId, state.editor?.mode, state.onboarding?.currentStep])

  useEffect(() => {
    if (!dirtyWorkoutIds.length) return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = true
    }
    globalThis.addEventListener('beforeunload', warnBeforeLeaving)
    return () => globalThis.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [dirtyWorkoutIds.length])

  const setStatus = (tone: FormMessage['tone'], text: string, id = 'app-status') => {
    dispatch({ type: 'status', message: message(id, tone, text) })
  }

  const runTask = async (fallback: string, task: () => Promise<void>) => {
    dispatch({ type: 'busy', value: true })
    try {
      await task()
    } catch (error) {
      setStatus('error', errorText(error, fallback))
    } finally {
      dispatch({ type: 'busy', value: false })
    }
  }

  const navigate = (route: AppRoute) => dispatch({ type: 'navigate', route })

  const persistWeek = async (planner: PlannerState, successText: string) => {
    if (!planner.present.week.workouts.length) {
      dispatch({ type: 'setPlanner', planner, unsaved: true })
      setStatus(
        'error',
        state.savedWeek
          ? 'A week needs at least one workout to be saved. The previously saved week is unchanged until you add a session.'
          : 'A week needs at least one workout before it can be saved in this browser.',
      )
      return
    }
    try {
      const weekPlan = await persistPlannerWeek(repository, planner)
      dispatch({ type: 'weekPersisted', weekPlan })
      setStatus('success', successText)
    } catch (error) {
      setStatus('error', `The week could not be saved locally: ${errorText(error, 'unknown storage failure')}`)
    }
  }

  const persistPendingLogs = async (review = state.review) => {
    if (!review || !getDirtyWorkoutReviewIds(review).length) return
    const result = await savePendingReviewWorkoutLogs(repository, review)
    dispatch({ type: 'reviewLogsSaved', submitted: review, ...result })
  }

  const applyPlannerChange = (change: (planner: PlannerState) => PlannerState, successText: string) => {
    const planner = state.planner
    if (!planner) return
    void runTask('The week could not be saved locally.', async () => {
      await persistPendingLogs()
      const next = change(planner)
      dispatch({ type: 'setPlanner', planner: next, unsaved: true })
      await persistWeek(next, successText)
    })
  }

  const entryByLocalId = (localId: string | undefined): PlannerWorkoutEntry | undefined =>
    localId === undefined ? undefined : state.planner?.present.week.workouts.find(entry => entry.localId === localId)

  const handleManualStart = () => {
    void runTask('The blank week could not be created.', async () => {
      await persistPendingLogs()
      const result = await startManualWeek(repository, {
        today,
        weekStart: currentWeekStart(now()),
        ...(state.athlete ? { athlete: state.athlete } : {}),
      })
      dispatch({ type: 'setAthlete', athlete: result.athlete })
      dispatch({ type: 'setLogs', logs: [] })
      dispatch({ type: 'setPlanner', planner: result.planner, unsaved: true })
      navigate('planner')
      setStatus('info', 'Blank week ready. Add the first session to save it in this browser.')
    })
  }

  const handleGuidedStart = () => {
    if (state.resumableDraft) {
      handleResumeDraft()
      return
    }
    dispatch({
      type: 'startOnboarding',
      onboarding: createGuidedOnboardingState({
        athleteId: state.athlete?.id ?? createControllerId('athlete'),
        draftId: createControllerId('draft'),
        athleteName: state.athlete?.name ?? 'Local athlete',
        createdOn: today,
        startingWeek: currentWeekStart(now()),
      }),
    })
  }

  const handleResumeDraft = () => {
    if (!state.resumableDraft) {
      dispatch({
        type: 'startOnboarding',
        onboarding: createGuidedOnboardingState({
          athleteId: state.athlete?.id ?? createControllerId('athlete'),
          draftId: createControllerId('draft'),
          athleteName: state.athlete?.name ?? 'Local athlete',
          createdOn: today,
          startingWeek: currentWeekStart(now()),
        }),
      })
      return
    }
    try {
      dispatch({ type: 'startOnboarding', onboarding: restoreGuidedOnboardingStateFromDraft(state.resumableDraft) })
    } catch (error) {
      setStatus('error', errorText(error, 'The saved setup draft could not be restored.'))
    }
  }

  useEffect(() => {
    const onboarding = state.onboarding
    if (!onboarding) return
    let active = true
    draftSaveTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const result = await saveOnboardingDraftState(repository, onboarding, today)
          if (result.ok && active) dispatch({ type: 'status', message: message('draft-saved', 'success', 'Setup draft saved in this browser.') })
        } catch (error) {
          dispatch({ type: 'status', message: message('draft-error', 'error', `The setup draft could not be saved: ${errorText(error, 'unknown storage failure')}`) })
        }
      })()
    }, 900)
    return () => {
      active = false
      if (draftSaveTimer.current !== undefined) clearTimeout(draftSaveTimer.current)
    }
  }, [state.onboarding, repository, today])

  const handleFinishOnboarding = () => {
    const onboarding = state.onboarding
    if (!onboarding) return
    void runTask('Guided setup could not be finished.', async () => {
      await persistPendingLogs()
      if (draftSaveTimer.current !== undefined) clearTimeout(draftSaveTimer.current)
      const outcome = await finalizeGuidedOnboarding(repository, onboarding, today)
      if (!outcome.ok) {
        setStatus('error', outcome.issues[0]?.message ?? 'Guided setup is not complete yet.')
        return
      }
      dispatch({
        type: 'onboardingFinished',
        athlete: outcome.result.athlete,
        planner: outcome.result.planner,
        savedWeek: outcome.result.weekPlan,
      })
      const targetWeekStart = outcome.result.planner.present.week.weekStart
      const promptPackage = buildInitialWeekPrompt(buildInitialPromptInputFromAthleteProfile(outcome.result.athlete, targetWeekStart))
      dispatch({ type: 'setPrompt', kind: 'initial', targetWeekStart, promptText: promptPackage.prompt })
      dispatch({ type: 'clearHandoff' })
      navigate('ai')
      setStatus('success', 'Your brief is ready. Copy it into your AI chat to plan the week together.')
    })
  }

  const openCreateEditor = (scheduledDate: LocalDateString) => {
    dispatch({
      type: 'openEditor',
      editor: { mode: 'create', state: createBlankWorkoutEditorState(scheduledDate), messages: [] },
    })
  }

  const openEditEditor = (entry: PlannerWorkoutEntry) => {
    dispatch({
      type: 'openEditor',
      editor: {
        mode: 'edit',
        localId: entry.localId,
        existing: entry.workout,
        state: workoutToEditorState(entry.workout),
        messages: entry.workout.source === 'club'
          ? [message('club-locked', 'info', 'Fixed club sessions keep their day, time, duration, and category. Edit the content or delete the session instead.')]
          : [],
      },
    })
  }

  const handleSaveEditor = () => {
    const editor = state.editor
    if (!editor) return
    const result = buildWorkoutDefinition(editor.state, editor.existing ? { existing: editor.existing } : {})
    if (!result.ok) {
      dispatch({ type: 'editorMessages', messages: result.messages })
      return
    }
    const definition = result.definition
    dispatch({ type: 'closeEditor' })

    if (editor.mode === 'create') {
      applyPlannerChange(planner => addPlannerWorkout(planner, definition), 'Session added and the week was saved.')
      return
    }

    const localId = editor.localId
    if (localId === undefined) return
    const changes: PlannerWorkoutChanges = {
      scheduledDate: definition.scheduledDate,
      startTime: definition.startTime,
      category: definition.category,
      source: definition.source,
      title: definition.title,
      purpose: definition.purpose,
      expectedDurationMin: definition.expectedDurationMin,
      warmup: definition.warmup ?? [],
      main: definition.main,
      cooldown: definition.cooldown ?? [],
      notes: definition.notes,
    }
    applyPlannerChange(
      planner => updatePlannerWorkout(planner, {
        localId,
        changes,
        ...(editor.existing?.fixedClubSession ? { fixedClubSession: { kind: 'preserve' as const } } : {}),
      }),
      'Session updated and the week was saved.',
    )
  }

  const handleDuplicate = (entry: PlannerWorkoutEntry) => {
    applyPlannerChange(
      planner => duplicatePlannerWorkout(planner, { localId: entry.localId }),
      'Session duplicated and the week was saved.',
    )
  }

  const handleConfirmDelete = () => {
    const localId = pendingDeleteLocalId
    setPendingDeleteLocalId(null)
    if (!localId) return
    applyPlannerChange(planner => deletePlannerWorkout(planner, localId), 'Session deleted and the week was saved.')
  }

  const handleMove = (localId: string, scheduledDate: string) => {
    const entry = entryByLocalId(localId)
    if (!entry) return
    dispatch({ type: 'closeMovePicker' })
    applyPlannerChange(
      planner => movePlannerWorkout(planner, { localId, scheduledDate }),
      `Session moved to ${formatDayLabel(scheduledDate)} and the week was saved.`,
    )
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>, scheduledDate: LocalDateString) => {
    event.preventDefault()
    const localId = draggingLocalId ?? event.dataTransfer.getData('text/plain')
    setDraggingLocalId(null)
    if (localId) handleMove(localId, scheduledDate)
  }

  const ensureReviewState = () => {
    if (state.review || !state.planner) return
    try {
      const weekPlan = plannerStateToWeekPlan(state.planner)
      dispatch({ type: 'setReview', review: createWorkoutReviewState({ weekPlan, workoutLogs: state.logs }) })
    } catch (error) {
      setStatus('error', errorText(error, 'The review could not be prepared for this week.'))
    }
  }

  useEffect(() => {
    if (state.route !== 'review' && state.route !== 'log' && state.route !== 'planner') return
    if (state.review || !state.planner || !state.savedWeek || state.unsavedWeek) return
    try {
      const weekPlan = plannerStateToWeekPlan(state.planner)
      dispatch({ type: 'setReview', review: createWorkoutReviewState({ weekPlan, workoutLogs: state.logs }) })
    } catch (error) {
      dispatch({ type: 'status', message: message('review-error', 'error', errorText(error, 'The review could not be prepared for this week.')) })
    }
  }, [state.route, state.review, state.planner, state.logs, state.savedWeek, state.unsavedWeek])

  const handleOpenLog = (workout: Workout) => {
    if (state.unsavedWeek || !state.savedWeek) {
      setStatus('error', 'Save the week before logging a session. Add at least one workout so the week can be stored.')
      return
    }
    ensureReviewState()
    dispatch({ type: 'openLog', workoutId: workout.id })
  }

  const handleStartLog = (workoutId: string, outcome: WorkoutCompletionStatus) => {
    if (!state.review) return
    try {
      dispatch({ type: 'setReview', review: startWorkoutReviewLog(state.review, workoutId, outcome) })
    } catch (error) {
      setStatus('error', errorText(error, 'The log could not be started.'))
    }
  }

  const handleSaveLog = (workoutId: string) => {
    const review = state.review
    if (!review) return
    void runTask('The workout log could not be saved.', async () => {
      const result = await saveReviewWorkoutLog(repository, review, workoutId)
      dispatch({ type: 'reviewLogsSaved', submitted: review, logs: result.logs, savedWorkoutIds: [workoutId] })
      setStatus('success', 'Workout log saved in this browser.')
    })
  }

  const handleSaveReview = () => {
    const review = state.review
    const athlete = state.athlete
    if (!review || !athlete) return
    void runTask('The weekly review could not be completed.', async () => {
      const payload = buildWorkoutReviewPayload(review)
      await persistPendingLogs(review)
      const targetWeekStart = followingWeekStart(review.weekPlan.weekStart)
      const promptPackage = buildContinuationWeekPrompt({
        ...buildInitialPromptInputFromAthleteProfile(athlete, targetWeekStart),
        previousWeek: payload.previousWeek,
      })
      dispatch({ type: 'setPrompt', kind: 'continuation', targetWeekStart, promptText: promptPackage.prompt })
      dispatch({ type: 'clearHandoff' })
      navigate('ai')
      setStatus('success', `Next-week prompt ready for ${formatWeekRange(targetWeekStart)}. Copy it into any AI chat you trust.`)
    })
  }

  const handleBuildInitialPrompt = () => {
    const athlete = state.athlete
    if (!athlete) return
    try {
      const targetWeekStart = state.planner?.present.week.weekStart ?? currentWeekStart(now())
      const promptPackage = buildInitialWeekPrompt(buildInitialPromptInputFromAthleteProfile(athlete, targetWeekStart))
      dispatch({ type: 'setPrompt', kind: 'initial', targetWeekStart, promptText: promptPackage.prompt })
      setStatus('success', `Prompt ready for ${formatWeekRange(targetWeekStart)}.`)
    } catch (error) {
      setStatus('error', errorText(error, 'The prompt could not be generated.'))
    }
  }

  const copyText = (text: string, emptyText: string) => {
    void runTask('The text could not be copied.', async () => {
      if (!text.trim()) {
        setStatus('error', emptyText)
        return
      }
      const result = await writeTextToClipboard(text)
      setStatus(result.ok ? 'success' : 'error', result.message)
    })
  }

  const handlePreviewImport = () => {
    const athlete = state.athlete
    if (!athlete) {
      setStatus('error', 'Create a profile before importing a planned week.')
      return
    }
    const targetWeekStart = state.handoff.targetWeekStart
      ?? state.planner?.present.week.weekStart
      ?? currentWeekStart(now())
    try {
      const preview = previewAiWeekHandoff(state.handoff.jsonText, {
        athlete,
        targetWeekStart,
        expectedWeekType: state.handoff.kind,
        weekPlanId: createControllerId('week'),
        weekTitle: `Week of ${targetWeekStart}`,
      })
      dispatch({ type: 'setHandoffPreview', preview })
      dispatch({
        type: 'handoffMessages',
        messages: preview.ok
          ? [message('handoff-ready', 'success', 'The pasted week matches the contract. Review the preview, then apply it.')]
          : [message('handoff-issues', 'error', 'The pasted week was rejected. Fix the listed issues and preview again.')],
      })
    } catch (error) {
      dispatch({ type: 'setHandoffPreview', preview: null })
      dispatch({ type: 'handoffMessages', messages: [message('handoff-error', 'error', errorText(error, 'The pasted week could not be validated.'))] })
    }
  }

  const handleApplyImport = () => {
    const preview = state.handoff.preview
    if (!preview?.ok) return
    void runTask('The week could not be imported.', async () => {
      await persistPendingLogs()
      const result = await applyWeekImport(repository, preview.bundle)
      dispatch({
        type: 'weekImported',
        planner: createPlannerStateFromWeekPlan(result.weekPlan),
        weekPlan: result.weekPlan,
        logs: result.logs,
      })
      dispatch({ type: 'clearHandoff' })
      setStatus('success', 'Your week is saved. Record weights and comments on the main exercises as you train.')
    })
  }

  useEffect(() => {
    if (state.route !== 'settings' || !state.athlete) return
    if (state.settings.backup && state.settings.profileDraft) return
    void (async () => {
      try {
        const backup = await exportRepositoryBackup(repository)
        dispatch({
          type: 'settings',
          patch: {
            backup,
            ...(state.settings.profileDraft ? {} : { profileDraft: createAthleteProfileEditingDraft(state.athlete!) }),
            messages: createSettingsPrivacyMessages(),
          },
        })
      } catch (error) {
        dispatch({ type: 'status', message: message('backup-error', 'error', `The local backup could not be read: ${errorText(error, 'unknown storage failure')}`) })
      }
    })()
  }, [state.route, state.athlete, state.settings.backup, state.settings.profileDraft, repository])

  const patchProfileDraft = (patch: Partial<SettingsAthleteProfileDraft>) => {
    const profileDraft = state.settings.profileDraft
    if (!profileDraft) return
    dispatch({ type: 'settings', patch: { profileDraft: { ...profileDraft, ...patch } } })
  }

  const handleSaveProfile = () => {
    const profileDraft = state.settings.profileDraft
    if (!profileDraft) return
    void runTask('The profile could not be saved.', async () => {
      let profile: AthleteProfile
      try {
        profile = parseAthleteProfileEditingDraft({ ...profileDraft, updatedOn: today })
      } catch (error) {
        setStatus('error', errorText(error, 'The profile is not valid yet.'))
        return
      }
      const saved = await repository.saveAthleteProfile(profile)
      dispatch({ type: 'setAthlete', athlete: saved })
      dispatch({ type: 'settings', patch: { profileDraft: createAthleteProfileEditingDraft(saved), backup: undefined } })
      setStatus('success', 'Profile saved in this browser.')
    })
  }

  const handleDownloadBackup = () => {
    const backup = state.settings.backup
    if (!backup) return
    try {
      const download = createBackupDownload(backup)
      const anchor = document.createElement('a')
      anchor.href = download.href
      anchor.download = download.download
      anchor.rel = 'noopener'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => download.release(), 1_000)
      setStatus('success', `Backup file ${download.download} was offered for download.`)
    } catch (error) {
      setStatus('error', errorText(error, 'The backup download is unavailable here. Copy the JSON instead.'))
    }
  }

  const handlePreviewRestore = () => {
    const preview = previewRestoreBackupJson(state.settings.restoreJson)
    dispatch({ type: 'settings', patch: { restorePreview: preview, restoreConfirmation: '' } })
  }

  const handleApplyRestore = () => {
    const preview = state.settings.restorePreview
    if (!preview) return
    void runTask('The backup could not be restored.', async () => {
      const outcome = await applyPreviewedBackupRestore(repository, preview, state.settings.restoreConfirmation)
      const snapshot = await bootstrapApp(repository)
      dispatch({
        type: 'bootstrapped',
        athlete: snapshot.athlete,
        planner: snapshot.weekPlan ? createPlannerStateFromWeekPlan(snapshot.weekPlan) : undefined,
        savedWeek: snapshot.weekPlan,
        logs: snapshot.logs,
        draft: snapshot.draft,
      })
      dispatch({
        type: 'settings',
        patch: { restoreJson: '', restorePreview: null, restoreConfirmation: '', backup: undefined, profileDraft: undefined },
      })
      setStatus(outcome.message.tone, outcome.message.text)
    })
  }

  const handleReset = (actionId: string) => {
    try {
      dispatch({ type: 'settings', patch: { pendingReset: requestResetConfirmation(actionId), resetConfirmation: '' } })
    } catch (error) {
      setStatus('error', errorText(error, 'That reset action is unknown.'))
    }
  }

  const handleConfirmReset = () => {
    const pendingReset = state.settings.pendingReset
    if (!pendingReset) return
    void runTask('Local data could not be reset.', async () => {
      const outcome = await applyConfirmedReset(repository, pendingReset, state.settings.resetConfirmation)
      dispatch({ type: 'bootstrapped', logs: [] })
      dispatch({
        type: 'settings',
        patch: {
          pendingReset: undefined,
          resetConfirmation: '',
          backup: undefined,
          profileDraft: undefined,
          restoreJson: '',
          restorePreview: null,
          restoreConfirmation: '',
        },
      })
      navigate('start')
      setStatus(outcome.message.tone, outcome.message.text)
    })
  }

  const headerProps = buildHeaderProps(state, {
    onNavigate: navigate,
    onSettings: () => navigate('settings'),
    onReview: () => navigate('review'),
  })

  const statusRegion = (
    <div className="app-statusRegion" aria-live="polite">
      {state.status && !(state.route === 'onboarding' && state.status.id === 'draft-saved') ? (
        <p className={`app-status is-${state.status.tone}`} {...(state.status.tone === 'error' ? { role: 'alert' } : {})}>
          {state.status.text}
        </p>
      ) : null}
      {state.busy ? <p className="app-status is-info">Working…</p> : null}
    </div>
  )

  if (state.phase === 'loading') {
    return (
      <div className="hc-shell">
        <main className="hc-main" id="main" tabIndex={-1}>
          <div className="hc-mainStack">
            <LoadingState title="Loading your planner" message="Reading the training data saved in this browser." />
          </div>
        </main>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="hc-shell">
        <main className="hc-main" id="main" tabIndex={-1}>
          <div className="hc-mainStack">
            <ErrorState
              title="Local storage unavailable"
              message={state.loadError ?? 'The planner could not open local storage in this browser.'}
              recoveryHint="Close other planner tabs, leave private browsing, then reload this page."
              action={{ label: 'Reload', onClick: () => globalThis.location.reload() }}
            />
          </div>
        </main>
      </div>
    )
  }

  const renderScreen = (screen: ReactElement, extras?: ReactElement) => (
    <div className="hc-shell">
      <a className="hc-skipLink" href="#main">Skip to content</a>
      <AppHeader {...headerProps} />
      <div className={`app-screen app-screen--${state.route}`} id="main" tabIndex={-1}>
        {statusRegion}
        {screen}
        {extras}
      </div>
    </div>
  )

  if (state.route === 'start') {
    return (
      <StartShell
        state={state}
        header={headerProps}
        statusRegion={statusRegion}
        onContinue={() => navigate('planner')}
        onGuidedStart={handleGuidedStart}
        onManualStart={handleManualStart}
        onResumeDraft={handleResumeDraft}
      />
    )
  }

  if (state.route === 'onboarding' && state.onboarding) {
    const onboardingProps = createGuidedOnboardingScreenProps(state.onboarding, action => dispatch({ type: 'onboarding', action }))
    return renderScreen(
      <GuidedOnboardingScreen {...onboardingProps} canFinish={onboardingProps.canFinish && !state.busy} onFinish={handleFinishOnboarding} />,
      <p className="setup-quietHint" aria-live="polite">{state.status?.id === 'draft-saved' ? 'Draft saved automatically in this browser.' : 'Your answers stay in this browser.'}</p>,
    )
  }

  if (state.route === 'planner' && state.editor) {
    const editor = state.editor
    return renderScreen(
      <WorkoutEditorScreen
        draft={editor.state.draft}
        sections={editor.state.sections}
        categoryOptions={WORKOUT_CATEGORY_OPTIONS}
        modalityOptions={WORKOUT_MODALITY_OPTIONS}
        sourceOptions={WORKOUT_SOURCE_OPTIONS}
        messages={editor.messages}
        onWorkoutFieldChange={(field, value) => dispatch({ type: 'editorField', field, value })}
        onStepChange={(sectionId, stepId, field, value) => dispatch({ type: 'editorStepField', sectionId, stepId, field, value })}
        onAddStep={sectionId => dispatch({ type: 'editorAddStep', sectionId })}
        onMoveStep={(sectionId, stepId, direction) => dispatch({ type: 'editorMoveStep', sectionId, stepId, direction })}
        onRemoveStep={(sectionId, stepId) => dispatch({ type: 'editorRemoveStep', sectionId, stepId })}
        onSave={handleSaveEditor}
      />,
      <div className="app-screenActions">
        <ActionButton label="Cancel" tone="ghost" onClick={() => dispatch({ type: 'closeEditor' })} />
      </div>,
    )
  }

  if (state.route === 'planner') {
    return (
      <div className="hc-shell">
        <a className="hc-skipLink" href="#main">Skip to content</a>
        <AppHeader {...headerProps} />
        <main className="hc-main" id="main" tabIndex={-1}>
          <div className="hc-mainStack">
            {statusRegion}
            {state.planner ? (
              <PlannerBoard
                planner={state.planner}
                clubs={state.athlete?.clubSessions.filter(session => !isFullySpecifiedClubSession(session)) ?? []}
                logs={state.logs}
                review={state.review}
                dirtyWorkoutIds={dirtyWorkoutIds}
                busy={state.busy}
                onReviewAction={action => dispatch({ type: 'inlineReview', action })}
                onSaveLog={handleSaveLog}
                today={today}
                onReview={() => navigate('review')}
                onAdd={openCreateEditor}
                onEdit={openEditEditor}
                onDuplicate={handleDuplicate}
                onMove={localId => {
                  setMoveTargetDate('')
                  dispatch({ type: 'openMovePicker', localId })
                }}
                onDelete={localId => setPendingDeleteLocalId(localId)}
                onLog={handleOpenLog}
                onDragStart={setDraggingLocalId}
                onDropOnDay={handleDrop}
              />
            ) : (
              <EmptyState
                title="No week yet"
                message="Start a blank week or finish guided setup to build your first seven-day plan."
                action={{ label: 'Start a blank week', onClick: handleManualStart }}
                secondaryAction={{ label: 'Guided setup', onClick: handleGuidedStart, tone: 'secondary' }}
              />
            )}
          </div>
        </main>
        <MovePickerModal
          state={state}
          value={moveTargetDate}
          onChange={setMoveTargetDate}
          onCancel={() => dispatch({ type: 'closeMovePicker' })}
          onConfirm={date => handleMove(state.movePickerLocalId!, date)}
        />
        <ModalSurface
          open={pendingDeleteLocalId !== null}
          title="Delete this session?"
          description="The session is removed from the week and the saved week is updated in this browser."
          dismissAction={{ label: 'Close', onClick: () => setPendingDeleteLocalId(null), tone: 'ghost' }}
          secondaryAction={{ label: 'Keep session', onClick: () => setPendingDeleteLocalId(null) }}
          primaryAction={{ label: 'Delete session', onClick: handleConfirmDelete }}
        />
      </div>
    )
  }

  if (state.route === 'log') {
    const workoutId = state.activeLogWorkoutId
    const review = state.review
    const workoutState = review?.workouts.find(entry => entry.workout.id === workoutId)
    if (!review || !workoutId || !workoutState) {
      return renderScreen(
        <EmptyState
          title="Nothing to log yet"
          message="Open a saved week and choose a session to record what actually happened."
          action={{ label: 'Back to the week', onClick: () => navigate('planner') }}
        />,
      )
    }

    if (!workoutState.isLogged) {
      return renderScreen(
        <EmptyState
          title={`How did "${workoutState.workout.title}" go?`}
          message="Choose an outcome, then add any numbers or notes you tracked."
          action={{ label: 'Back to the week', onClick: () => navigate('planner'), tone: 'ghost' }}
        />,
        <div className="app-screenActions">
          {COMPLETION_OPTIONS.map(option => (
            <ActionButton
              key={option.id}
              label={option.label}
              tone={option.id === 'completed' ? 'primary' : 'secondary'}
              onClick={() => handleStartLog(workoutId, option.id)}
            />
          ))}
        </div>,
      )
    }

    const logProps = createWorkoutLogScreenProps(review, workoutId, action => dispatch({ type: 'review', action }))
    return renderScreen(
      <WorkoutLogScreen {...logProps} canSave={!state.busy} onSave={() => handleSaveLog(workoutId)} />,
      <div className="app-screenActions">
        <ActionButton label="Back to the week" tone="ghost" onClick={() => dispatch({ type: 'closeLog' })} />
      </div>,
    )
  }

  if (state.route === 'review') {
    if (!state.review) {
      return renderScreen(
        <EmptyState
          title="No week to review"
          message="Save a week with at least one session before closing it out."
          action={{ label: 'Back to the week', onClick: () => navigate('planner') }}
        />,
      )
    }
    const reviewProps = createWeeklyReviewScreenProps(state.review, action => dispatch({ type: 'review', action }))
    return renderScreen(
      <WeeklyReviewScreen {...reviewProps} onSave={handleSaveReview} />,
      <div className="app-screenActions">
        <ActionButton label="Back to the week" tone="ghost" onClick={() => navigate('planner')} />
        <p className="app-hint">Saving the review builds a next-week prompt you can copy into any AI chat.</p>
      </div>,
    )
  }

  if (state.route === 'ai') {
    const preview = state.handoff.preview
    return renderScreen(
      <JsonHandoffScreen
        promptContent={<section key="planning-brief" className="feature-card app-promptCard" aria-labelledby="prompt-heading">
          <p className="hc-eyebrow">01 / YOUR PLANNING BRIEF</p>
          <h2 id="prompt-heading">A good plan starts with your story.</h2>
          <p>Your goal, preferences, and equipment, ready for ChatGPT, Claude, Gemini, or another chat you choose.</p>
          <div className="feature-actions">
            <ActionButton label={state.handoff.promptText ? 'Refresh brief' : 'Prepare my brief'} tone={state.handoff.promptText ? 'secondary' : 'primary'} onClick={handleBuildInitialPrompt} />
            {state.handoff.promptText && <ActionButton label="Copy brief" onClick={() => copyText(state.handoff.promptText, 'Prepare your brief first.')} />}
            {state.planner?.present.week.workouts.length ? <ActionButton label="Use this week's feedback" tone="ghost" onClick={() => navigate('review')} /> : null}
          </div>
          {state.handoff.promptText && <details className="feature-advanced"><summary>Read or copy your brief manually</summary>
            {textArea({ id: 'ai-prompt-text', label: `Brief for ${state.handoff.targetWeekStart ? formatWeekRange(state.handoff.targetWeekStart) : 'this week'}`, value: state.handoff.promptText, onChange: () => undefined, readOnly: true, rows: 8 })}
          </details>}
          <aside className="app-chatTip"><span className="hc-pathIcon"><Icon name="ai" /></span><div><strong>02 / Make it a conversation</strong><p>Paste your brief into your AI chat. Discuss the plan, then ask for the final week as JSON and bring it back below.</p></div></aside>
        </section>}
        jsonText={state.handoff.jsonText}
        preview={preview?.ok ? preview.preview : null}
        issues={preview?.issues ?? []}
        messages={state.handoff.messages}
        canApply={Boolean(preview?.ok) && !state.busy}
        onJsonTextChange={value => dispatch({ type: 'setHandoffJson', value })}
        onCopyTemplate={() => copyText(state.handoff.promptText, 'Generate a prompt first, then copy it.')}
        onPreviewImport={handlePreviewImport}
        onApplyImport={handleApplyImport}
        onClear={() => dispatch({ type: 'clearHandoff' })}
      />,
      <div className="app-screenActions app-screenActions--stack">
        <ActionButton label="Back to the week" tone="ghost" onClick={() => navigate(state.planner ? 'planner' : 'start')} />
      </div>,
    )
  }

  const settingsPreview = state.settings.restorePreview
  const settingsMessages: readonly FormMessage[] = [
    ...createSettingsPrivacyMessages(),
    ...(settingsPreview?.messages ?? []),
    ...(state.settings.pendingReset ? [state.settings.pendingReset.warning] : []),
  ]

  const profileContent = state.settings.profileDraft
        ? sectionCard('settings-profile', 'About you', 'These preferences help your AI plan around your life.', [
          textInput({
            id: 'profile-name',
            label: 'Name',
            value: state.settings.profileDraft.name,
            onChange: value => patchProfileDraft({ name: value }),
          }),
          textInput({
            id: 'profile-goal',
            label: 'Goal',
            value: state.settings.profileDraft.goal,
            onChange: value => patchProfileDraft({ goal: value }),
          }),
          textInput({
            id: 'profile-goal-date',
            label: 'Goal date',
            type: 'date',
            value: state.settings.profileDraft.goalDate,
            onChange: value => patchProfileDraft({ goalDate: value }),
          }),
          textInput({
            id: 'profile-sports',
            label: 'Sports',
            description: 'Comma separated, for example: running, cycling.',
            value: state.settings.profileDraft.sports.join(', '),
            onChange: value => patchProfileDraft({ sports: splitList(value) }),
          }),
          textInput({
            id: 'profile-constraints',
            label: 'Constraints',
            description: 'Comma separated, for example: no running on Mondays.',
            value: state.settings.profileDraft.constraints.join(', '),
            onChange: value => patchProfileDraft({ constraints: splitList(value) }),
          }),
          textArea({
            id: 'profile-notes',
            label: 'Notes',
            value: state.settings.profileDraft.notes,
            onChange: value => patchProfileDraft({ notes: value }),
            rows: 3,
          }),
          actionBar('settings-profile-actions', [
            h('button', { key: 'save', type: 'button', className: 'feature-actions__button', onClick: handleSaveProfile }, 'Save profile'),
          ]),
        ])
        : null

  return renderScreen(
    <SettingsBackupScreen
      profileContent={profileContent}
      onDownloadBackup={handleDownloadBackup}
      backupJson={state.settings.backup?.backupJson ?? ''}
      lastSavedAt={state.settings.backup?.lastSavedAt ?? 'Not exported yet'}
      restoreJson={state.settings.restoreJson}
      preview={settingsPreview?.preview ?? null}
      issues={settingsPreview?.issues ?? []}
      resetActions={createSettingsResetActions()}
      messages={settingsMessages}
      canApplyRestore={settingsPreview ? canApplyPreviewedBackupRestore(settingsPreview, state.settings.restoreConfirmation) : false}
      onCopyBackup={() => copyText(state.settings.backup?.backupJson ?? '', 'The backup is still loading.')}
      onRestoreJsonChange={value => dispatch({ type: 'settings', patch: { restoreJson: value } })}
      onPreviewRestore={handlePreviewRestore}
      onApplyRestore={handleApplyRestore}
      onReset={handleReset}
    />,
    <div className="app-screenActions app-screenActions--stack">
      {settingsPreview?.confirmationRequirement
        ? sectionCard('settings-restore-confirm', settingsPreview.confirmationRequirement.title, settingsPreview.confirmationRequirement.message, [
          textInput({
            id: 'restore-confirmation',
            label: `Type ${settingsPreview.confirmationRequirement.phrase} to confirm`,
            value: state.settings.restoreConfirmation,
            onChange: value => dispatch({ type: 'settings', patch: { restoreConfirmation: value } }),
          }),
        ])
        : null}
      {state.settings.pendingReset
        ? sectionCard('settings-reset-confirm', state.settings.pendingReset.confirmationRequirement.title, state.settings.pendingReset.confirmationRequirement.message, [
          textInput({
            id: 'reset-confirmation',
            label: `Type ${state.settings.pendingReset.confirmationRequirement.phrase} to confirm`,
            value: state.settings.resetConfirmation,
            onChange: value => dispatch({ type: 'settings', patch: { resetConfirmation: value } }),
          }),
          actionBar('settings-reset-actions', [
            h('button', {
              key: 'cancel',
              type: 'button',
              className: 'feature-actions__button',
              onClick: () => dispatch({ type: 'settings', patch: { pendingReset: undefined, resetConfirmation: '' } }),
            }, 'Cancel reset'),
            h('button', {
              key: 'confirm',
              type: 'button',
              className: 'feature-actions__button',
              disabled: !canApplyConfirmedReset(state.settings.pendingReset, state.settings.resetConfirmation),
              onClick: handleConfirmReset,
            }, 'Reset local data'),
          ]),
        ])
        : null}
      <ActionButton label="Back to the week" tone="ghost" onClick={() => navigate(state.planner ? 'planner' : 'start')} />
    </div>,
  )
}

function splitList(value: string): string[] {
  return value.split(',').map(entry => entry.trim()).filter(Boolean)
}

function StartShell({
  state,
  header,
  statusRegion,
  onContinue,
  onGuidedStart,
  onManualStart,
  onResumeDraft,
}: {
  state: AppState
  header: AppHeaderProps
  statusRegion: ReactElement
  onContinue: () => void
  onGuidedStart: () => void
  onManualStart: () => void
  onResumeDraft: () => void
}) {
  return (
    <div className="hc-shell">
      <a className="hc-skipLink" href="#main">Skip to planner</a>
      <AppHeader {...header} />
      <main className="hc-main" id="main" tabIndex={-1}>
        {statusRegion}
        <StartScreen {...buildStartScreenProps(state, { onContinue, onGuidedStart, onManualStart, onResumeDraft })} />
      </main>
    </div>
  )
}

function PlannerBoard({
  planner,
  clubs,
  logs,
  review,
  dirtyWorkoutIds,
  busy,
  onReviewAction,
  onSaveLog,
  today,
  onReview,
  onAdd,
  onEdit,
  onDuplicate,
  onMove,
  onDelete,
  onLog,
  onDragStart,
  onDropOnDay,
}: {
  planner: PlannerState
  clubs: AthleteProfile['clubSessions']
  logs: readonly WorkoutLog[]
  review?: WorkoutReviewState
  dirtyWorkoutIds: readonly string[]
  busy: boolean
  onReviewAction: (action: WorkoutReviewAction) => void
  onSaveLog: (workoutId: string) => void
  today: LocalDateString
  onReview: () => void
  onAdd: (date: LocalDateString) => void
  onEdit: (entry: PlannerWorkoutEntry) => void
  onDuplicate: (entry: PlannerWorkoutEntry) => void
  onMove: (localId: string) => void
  onDelete: (localId: string) => void
  onLog: (workout: Workout) => void
  onDragStart: (localId: string | null) => void
  onDropOnDay: (event: DragEvent<HTMLDivElement>, date: LocalDateString) => void
}) {
  const week = planner.present.week
  const logValidation = useMemo(() => review ? validateWorkoutReviewState(review) : undefined, [review])
  const reviewByWorkout = useMemo(() => new Map(review?.workouts.map(item => [item.workout.id, item]) ?? []), [review])
  const latestLog = (workoutId: string) => reviewByWorkout.get(workoutId)?.logHistory[0] ?? logs.find(log => log.workoutId === workoutId)
  const completed = week.workouts.filter(entry => latestLog(entry.workout.id)?.outcome === 'completed').length
  const totalMinutes = week.workouts.reduce((sum, entry) => sum + entry.workout.expectedDurationMin, 0)
  return (
    <section className="hc-board app-board" aria-labelledby="planner-week-title">
      <div className="app-weekHeading">
        <div className="hc-sectionHeading">
          <p className="hc-eyebrow">YOUR TRAINING WEEK</p>
          <h1 id="planner-week-title">{formatWeekRange(week.weekStart)}</h1>
          <p className="hc-bodyCopy">{week.goal}</p>
        </div>
        <ActionButton label="Review week" onClick={onReview} tone="secondary" disabled={busy || !week.workouts.length} />
      </div>
      <div className="app-weekStats" aria-label="Week summary">
        <div><Icon name="week" /><strong>{week.workouts.length}</strong><span>sessions</span></div>
        <div><Icon name="clock" /><strong>{totalMinutes}</strong><span>minutes planned</span></div>
        <div><Icon name="check" /><strong>{completed}/{week.workouts.length}</strong><span>completed</span></div>
      </div>
      <nav className="app-dayNav" aria-label="Jump to a day">
        {listWeekDates(week.weekStart).map(date => <a href={`#planner-day-${date}`} key={date} aria-current={date === today ? 'date' : undefined}>{formatWeekday(date).slice(0, 3)}<strong>{Number(date.slice(-2))}</strong><span className={week.workouts.some(entry => entry.workout.scheduledDate === date) || clubs.some(club => club.dayOfWeek === localDateDayOfWeek(date)) ? 'has-session' : ''} /></a>)}
      </nav>
      <div className="app-categoryLegend"><span className="is-aerobic">Aerobic</span><span className="is-strength">Strength</span><span className="is-mobility">Mobility</span><p>Move sessions whenever life changes.</p></div>
      <p className="app-hint">Your plan stays visible. Log weights and comments on the main exercises, then save the session for next week's planning.</p>
      <div className="hc-boardGrid">
        {listWeekDates(week.weekStart).map(date => {
          const entries = week.workouts.filter(entry => entry.workout.scheduledDate === date)
          const dayClubs = clubs.filter(club => club.dayOfWeek === localDateDayOfWeek(date))
          const totalMinutes = entries.reduce((sum, entry) => sum + entry.workout.expectedDurationMin, 0)
          return (
            <DayColumn
              key={date}
              id={`planner-day-${date}`}
              label={formatWeekday(date)}
              dateLabel={formatDateShort(date)}
              {...(entries.length ? { summary: `${entries.length} session${entries.length === 1 ? '' : 's'} · ${totalMinutes} min` } : {})}
            >
              {dayClubs.map(club => <article className="app-clubCommitment" key={club.id}>
                <p className="hc-eyebrow">Club training</p>
                <h3>{club.title}</h3>
                <p className="hc-cardMeta">{club.startTime}</p>
                {club.notes && <p className="hc-supportCopy">{club.notes}</p>}
              </article>)}
              <div
                className="app-dayDrop"
                onDragOver={event => event.preventDefault()}
                onDrop={event => onDropOnDay(event, date)}
              >
                {entries.length
                  ? <div className="app-sessionGrid">{entries.map(entry => {
                    const workoutReview = reviewByWorkout.get(entry.workout.id)
                    const logProps = review ? createWorkoutLogScreenProps(review, entry.workout.id, onReviewAction, logValidation) : undefined
                    return <article
                      className="app-cardWrap"
                      key={entry.localId}
                      data-workout-id={entry.workout.id}
                      aria-label={`${entry.workout.title} workout`}
                    >
                      <div className="app-sessionHandle"
                        draggable={!busy && entry.workout.source !== 'club'}
                        onDragStart={event => {
                          event.dataTransfer.setData('text/plain', entry.localId)
                          onDragStart(entry.localId)
                        }}
                        onDragEnd={() => onDragStart(null)}
                      >
                        <SessionCard
                          title={entry.workout.title}
                          kind={entry.workout.category}
                          timeLabel={entry.workout.startTime
                            ? `${entry.workout.startTime} · ${entry.workout.expectedDurationMin} min`
                            : `${entry.workout.expectedDurationMin} min`}
                          status={latestLog(entry.workout.id)?.outcome}
                          {...(entry.workout.fixedClubSession
                            ? { clubBadgeLabel: 'Club', fixed: true }
                            : {})}
                        />
                      </div>
                      <InlineWorkoutLog workout={entry.workout} log={logProps}
                        hasLog={workoutReview?.isLogged ?? false}
                        dirty={dirtyWorkoutIds.includes(entry.workout.id)}
                        disabled={busy}
                        onSave={() => onSaveLog(entry.workout.id)}
                      />
                      <div className="app-cardActions">
                        <ActionButton label="Session totals & effort" tone="ghost" ariaLabel={`Session totals and effort for ${entry.workout.title}`} disabled={busy} onClick={() => onLog(entry.workout)} />
                        <details className="app-cardMenu"><summary aria-label={`More actions for ${entry.workout.title}`}>More <span aria-hidden="true">···</span></summary><div>
                        <ActionButton label="Edit workout" tone="ghost" ariaLabel={`Edit ${entry.workout.title}`} disabled={busy} onClick={() => onEdit(entry)} />
                        <ActionButton
                          label="Duplicate"
                          tone="ghost"
                          ariaLabel={`Duplicate ${entry.workout.title}`}
                          disabled={busy || entry.workout.source === 'club'}
                          onClick={() => onDuplicate(entry)}
                        />
                        <ActionButton
                          label="Move"
                          tone="ghost"
                          ariaLabel={`Move ${entry.workout.title} to another day`}
                          disabled={busy || entry.workout.source === 'club'}
                          onClick={() => onMove(entry.localId)}
                        />
                        <ActionButton label="Delete" tone="ghost" ariaLabel={`Delete ${entry.workout.title}`} disabled={busy} onClick={() => onDelete(entry.localId)} />
                        </div></details>
                      </div>
                    </article>
                  })}</div>
                  : !dayClubs.length ? <p className="hc-emptySlot">Room to train.<br />Or to recharge.</p> : null}
                <ActionButton
                  label="+ Add session"
                  tone="secondary"
                  ariaLabel={`Add a session on ${formatDayLabel(date)}`}
                  disabled={busy}
                  onClick={() => onAdd(date)}
                />
              </div>
            </DayColumn>
          )
        })}
      </div>
    </section>
  )
}

function MovePickerModal({
  state,
  value,
  onChange,
  onCancel,
  onConfirm,
}: {
  state: AppState
  value: string
  onChange: (value: string) => void
  onCancel: () => void
  onConfirm: (date: string) => void
}) {
  const planner = state.planner
  const localId = state.movePickerLocalId
  if (!planner || !localId) return null
  const entry = planner.present.week.workouts.find(item => item.localId === localId)
  if (!entry) return null
  const options = buildDayOptions(planner)
  const selected = value || entry.workout.scheduledDate

  return (
    <ModalSurface
      open
      title={`Move "${entry.workout.title}"`}
      description="Choose a new day. Your workout details stay the same."
      dismissAction={{ label: 'Close', onClick: onCancel, tone: 'ghost' }}
      secondaryAction={{ label: 'Cancel', onClick: onCancel }}
      primaryAction={{ label: 'Move session', onClick: () => onConfirm(selected) }}
    >
      {selectInput({
        id: 'move-day-picker',
        label: 'New day',
        value: selected,
        onChange,
        options,
      })}
    </ModalSurface>
  )
}
