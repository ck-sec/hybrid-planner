import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  GuidedOnboardingScreen,
  JsonHandoffScreen,
  SettingsBackupScreen,
  WeeklyReviewScreen,
  WorkoutEditorScreen,
  WorkoutLogScreen,
  type ChoiceOption,
  type ClubSessionDraft,
  type DayOfWeek,
  type JsonImportPreview,
  type OnboardingDraft,
  type OnboardingStepId,
  type WeeklyMetricDraft,
  type WeeklyReviewDraft,
  type WorkoutEditorDraft,
  type WorkoutLogStepResultDraft,
  type WorkoutSectionDraft,
} from '../src/app/features/index.ts'

const noop = () => undefined

test('guided onboarding renders training sliders and compact optional club cards', () => {
  const steps: { id: OnboardingStepId; title: string; description: string; isAvailable: boolean; isComplete: boolean }[] = [
    { id: 'goal', title: 'Goal', description: 'Set the outcome.', isAvailable: true, isComplete: true },
    { id: 'schedule', title: 'Schedule', description: 'Pick days.', isAvailable: true, isComplete: true },
    { id: 'modalities', title: 'Modalities', description: 'Pick training types.', isAvailable: true, isComplete: true },
    { id: 'strength', title: 'Strength', description: 'Choose support work.', isAvailable: true, isComplete: true },
    { id: 'equipment', title: 'Equipment', description: 'Set access mode.', isAvailable: true, isComplete: true },
    { id: 'club', title: 'Club', description: 'Block fixed sessions.', isAvailable: true, isComplete: false },
    { id: 'review', title: 'Review', description: 'Confirm the setup.', isAvailable: true, isComplete: false },
  ]
  const draft: OnboardingDraft = {
    goalSummary: 'Finish a spring half marathon comfortably',
    targetDate: '2027-04-18',
    goalNotes: 'Coming back after a light summer block.',
    aerobicSessionCount: '4',
    strengthSessionCount: '2',
    mobilitySessionCount: '3',
    equipmentMode: 'home',
    equipmentDetails: 'Kettlebells and bands at home; gym access on Fridays.',
    reviewNotes: '',
  }
  const aerobicDays: ChoiceOption<DayOfWeek>[] = [
    { id: 'tuesday', label: 'Tuesday', selected: true },
    { id: 'thursday', label: 'Thursday', selected: true },
    { id: 'sunday', label: 'Sunday', selected: true },
  ]
  const strengthDays: ChoiceOption<DayOfWeek>[] = [
    { id: 'monday', label: 'Monday', selected: true },
    { id: 'friday', label: 'Friday', selected: true },
  ]
  const mobilityDays: ChoiceOption<DayOfWeek>[] = [
    { id: 'wednesday', label: 'Wednesday', selected: true },
    { id: 'saturday', label: 'Saturday', selected: true },
  ]
  const clubSessions: ClubSessionDraft[] = [
    {
      id: 'ride',
      category: 'Aerobic',
      activity: 'Lunch Ride',
      scope: 'Fixed weekly session',
      location: 'City loop',
      day: 'tuesday',
      startTime: '12:15',
      durationMinutes: '60',
      notes: 'Usually moderate pace.',
    },
  ]

  const html = renderToStaticMarkup(
    createElement(GuidedOnboardingScreen, {
      steps: steps.filter(step => step.id !== 'modalities' && step.id !== 'strength' && step.id !== 'club'),
      currentStep: 'schedule',
      draft,
      aerobicDayOptions: aerobicDays,
      strengthDayOptions: strengthDays,
      mobilityDayOptions: mobilityDays,
      aerobicModalityOptions: [
        { id: 'run', label: 'Running', selected: true },
        { id: 'bike', label: 'Cycling', selected: true },
      ],
      strengthOptions: [{ id: 'maintain', label: 'Maintain', selected: true }],
      equipmentModeOptions: [
        { id: 'bodyweight', label: 'Bodyweight only', selected: false },
        { id: 'home', label: 'Home gym', selected: true },
        { id: 'commercial', label: 'Commercial gym', selected: false },
      ],
      clubCategoryOptions: [
        { value: '', label: 'Select category' },
        { value: 'Aerobic', label: 'Aerobic' },
      ],
      clubScopeOptions: [
        { value: '', label: 'Select scope' },
        { value: 'Fixed weekly session', label: 'Fixed weekly session' },
      ],
      clubSessions,
      messages: [{ id: 'hint', tone: 'info', text: 'Keep recurring sessions brief and specific.' }],
      canGoBack: true,
      canGoNext: true,
      onSelectStep: noop,
      onGoalSummaryChange: noop,
      onTargetDateChange: noop,
      onGoalNotesChange: noop,
      onCategoryCountChange: noop,
      onToggleCategoryDay: noop,
      onToggleAerobicModality: noop,
      onStrengthPreferenceChange: noop,
      onEquipmentModeChange: noop,
      onEquipmentDetailsChange: noop,
      onClubSessionChange: noop,
      onAddClubSession: noop,
      onRemoveClubSession: noop,
      onReviewNotesChange: noop,
      onBack: noop,
      onNext: noop,
      onFinish: noop,
    }),
  )

  assert.match(html, /class="feature-screen guided-onboarding setup-wizard"/)
  assert.match(html, /Club training 1/)
  assert.match(html, /Short description \(optional\)/)
  assert.doesNotMatch(html, />Scope<|>Location<|>Duration in minutes</)
  assert.match(html, /type="range"/)
  assert.match(html, /guided-onboarding__club-card/)
  assert.match(html, /Lunch Ride/)
})

test('guided onboarding review renders per-category counts and preferred days', () => {
  const html = renderToStaticMarkup(
    createElement(GuidedOnboardingScreen, {
      steps: [
        { id: 'goal', title: 'Goal', description: 'Set the outcome.', isAvailable: true, isComplete: true },
        { id: 'schedule', title: 'Schedule', description: 'Pick days.', isAvailable: true, isComplete: true },
        { id: 'modalities', title: 'Modalities', description: 'Pick training types.', isAvailable: true, isComplete: true },
        { id: 'strength', title: 'Strength', description: 'Choose support work.', isAvailable: true, isComplete: true },
        { id: 'equipment', title: 'Equipment', description: 'Set access mode.', isAvailable: true, isComplete: true },
        { id: 'club', title: 'Club', description: 'Block fixed sessions.', isAvailable: true, isComplete: true },
        { id: 'review', title: 'Review', description: 'Confirm the setup.', isAvailable: true, isComplete: false },
      ],
      currentStep: 'review',
      draft: {
        goalSummary: 'Stay consistent',
        targetDate: '',
        goalNotes: '',
        aerobicSessionCount: '3',
        strengthSessionCount: '2',
        mobilitySessionCount: '4',
        equipmentMode: 'bodyweight',
        equipmentDetails: 'Bands only',
        reviewNotes: 'Travel next week.',
      },
      aerobicDayOptions: [
        { id: 'monday', label: 'Monday', selected: true },
        { id: 'thursday', label: 'Thursday', selected: true },
      ],
      strengthDayOptions: [{ id: 'tuesday', label: 'Tuesday', selected: true }],
      mobilityDayOptions: [{ id: 'sunday', label: 'Sunday', selected: true }],
      aerobicModalityOptions: [{ id: 'run', label: 'Running', selected: true }],
      strengthOptions: [{ id: 'build', label: 'Build', selected: true }],
      equipmentModeOptions: [{ id: 'bodyweight', label: 'Bodyweight only', selected: true }],
      clubCategoryOptions: [{ value: '', label: 'Select category' }],
      clubScopeOptions: [{ value: '', label: 'Select scope' }],
      clubSessions: [],
      canGoBack: true,
      canFinish: true,
      onSelectStep: noop,
      onGoalSummaryChange: noop,
      onTargetDateChange: noop,
      onGoalNotesChange: noop,
      onCategoryCountChange: noop,
      onToggleCategoryDay: noop,
      onToggleAerobicModality: noop,
      onStrengthPreferenceChange: noop,
      onEquipmentModeChange: noop,
      onEquipmentDetailsChange: noop,
      onClubSessionChange: noop,
      onAddClubSession: noop,
      onRemoveClubSession: noop,
      onReviewNotesChange: noop,
      onBack: noop,
      onNext: noop,
      onFinish: noop,
    }),
  )

  assert.match(html, /3 aerobic/)
  assert.match(html, /Monday, Thursday/)
  assert.match(html, /2 strength/)
  assert.match(html, /4 mobility/)
  assert.match(html, /Bodyweight/)
  assert.doesNotMatch(html, /Strength focus|Strength approach/)
})

test('json handoff and settings screens expose previews, actionable errors, and style hooks', () => {
  const preview: JsonImportPreview = {
    title: 'Import preview',
    summary: ['1 athlete profile', '4 training days'],
    groups: [
      {
        id: 'athlete',
        title: 'Athlete',
        items: [
          { label: 'Goal', value: 'Half marathon' },
          { label: 'Target date', value: '2027-04-18' },
        ],
      },
    ],
  }

  const handoffHtml = renderToStaticMarkup(
    createElement(JsonHandoffScreen, {
      promptContent: createElement('section', { key: 'brief' }, 'Planning brief goes first'),
      jsonText: '{ "goal": "Half marathon" }',
      templateJson: '{\n  "goal": "Half marathon"\n}',
      preview,
      issues: [
        {
          id: 'trailing-comma',
          severity: 'error',
          message: 'JSON parsing failed.',
          path: '$.plan',
          suggestion: 'Remove trailing commas before retrying.',
        },
      ],
      messages: [{ id: 'ready', tone: 'success', text: 'Preview is safe to apply.' }],
      canApply: true,
      onJsonTextChange: noop,
      onCopyTemplate: noop,
      onPreviewImport: noop,
      onApplyImport: noop,
      onClear: noop,
    }),
  )

  const settingsHtml = renderToStaticMarkup(
    createElement(SettingsBackupScreen, {
      profileContent: createElement('section', { key: 'profile' }, 'Your personal preferences'),
      onDownloadBackup: noop,
      backupJson: '{ "version": 1 }',
      lastSavedAt: '2026-09-09 08:00',
      restoreJson: '{ "version": 2 }',
      preview,
      issues: [],
      resetActions: [
        {
          id: 'wipe-plan',
          label: 'Reset plan data',
          description: 'Remove generated plans but keep profile settings.',
          confirmationLabel: 'Reset plan data',
        },
      ],
      messages: [{ id: 'note', tone: 'info', text: 'Restore preview only updates mapped fields.' }],
      canApplyRestore: true,
      onCopyBackup: noop,
      onRestoreJsonChange: noop,
      onPreviewRestore: noop,
      onApplyRestore: noop,
      onReset: noop,
    }),
  )

  assert.match(handoffHtml, /Try: Remove trailing commas before retrying\./)
  assert.match(handoffHtml, /class="feature-actions json-handoff__actions"/)
  assert.ok(handoffHtml.indexOf('Planning brief goes first') < handoffHtml.indexOf('03 / Bring your week back'))
  assert.match(handoffHtml, /Preview my week/)
  assert.match(handoffHtml, /Looks good - take me to my week/)
  assert.ok(handoffHtml.indexOf('Looks good - take me to my week') > handoffHtml.indexOf('feature-preview'))
  assert.match(settingsHtml, /Restore backup/)
  assert.match(settingsHtml, /settings-backup__reset-list/)
  assert.ok(settingsHtml.indexOf('Your personal preferences') < settingsHtml.indexOf('Take your progress with you'))
  assert.match(settingsHtml, /Download backup/)
  assert.match(settingsHtml, /<details class="feature-advanced"><summary>View or copy backup JSON/)
})

test('workout editor, log, and weekly review render expanded workout metadata and flexible actuals', () => {
  const workoutDraft: WorkoutEditorDraft = {
    workoutTitle: 'Tempo Tuesday',
    category: 'key-session',
    scheduledDate: '2026-09-15',
    scheduledTime: '07:00',
    purpose: 'Threshold support',
    expectedDuration: '55 min',
    modality: 'run',
    source: 'coach-authored',
    fixedClubSessionId: 'club-track',
    notes: 'Short and sharp.',
  }
  const sections: WorkoutSectionDraft[] = [
    {
      id: 'warmup',
      label: 'Warmup',
      steps: [
        {
          id: 'wu-1',
          title: 'Easy jog',
          instructions: 'Stay relaxed.',
          target: 'Zone 1',
          duration: '10 min',
          rest: '',
          notes: '',
        },
      ],
    },
    {
      id: 'main',
      label: 'Main',
      steps: [
        {
          id: 'main-1',
          title: 'Tempo block',
          instructions: 'Settle into half marathon effort.',
          target: '3 x 8 min',
          duration: '24 min',
          rest: '2 min easy',
          notes: 'Smooth pacing.',
        },
      ],
    },
    {
      id: 'cooldown',
      label: 'Cooldown',
      steps: [
        {
          id: 'cd-1',
          title: 'Walk and mobility',
          instructions: 'Bring the heart rate down.',
          target: 'Easy',
          duration: '8 min',
          rest: '',
          notes: '',
        },
      ],
    },
  ]
  const stepResults: WorkoutLogStepResultDraft[] = [
    {
      id: 'main-1',
      title: 'Tempo block',
      status: 'trimmed',
      actualResult: 'Completed 2 x 8 min after moving to the treadmill.',
      effort: '7',
      notes: 'Stopped early because of heat.',
    },
  ]
  const reviewDraft: WeeklyReviewDraft = {
    weekLabel: '9 to 15 September',
    reflection: 'Training felt solid but warm.',
    energy: '4',
    recovery: '3',
    wins: 'Hit both key runs.',
    blockers: 'Heat limited pace.',
    nextFocus: 'Hydrate earlier and protect sleep.',
    coachNotes: 'Keep the long run easy.',
  }
  const metrics: WeeklyMetricDraft[] = [
    { id: 'runs', label: 'Runs', planned: '4', completed: '3', note: 'Missed one easy run.' },
  ]

  const editorHtml = renderToStaticMarkup(
    createElement(WorkoutEditorScreen, {
      draft: workoutDraft,
      sections,
      categoryOptions: [
        { value: '', label: 'Select category' },
        { value: 'key-session', label: 'Key session' },
      ],
      modalityOptions: [
        { value: '', label: 'Select modality' },
        { value: 'run', label: 'Running' },
      ],
      sourceOptions: [
        { value: '', label: 'Select source' },
        { value: 'coach-authored', label: 'Coach authored' },
      ],
      fixedClubSessionOptions: [
        { value: '', label: 'No club session' },
        { value: 'club-track', label: 'Club track session' },
      ],
      messages: [{ id: 'hint', tone: 'info', text: 'Use target for either time, distance, or reps.' }],
      onWorkoutFieldChange: noop,
      onStepChange: noop,
      onAddStep: noop,
      onMoveStep: noop,
      onRemoveStep: noop,
      onSave: noop,
    }),
  )
  const logHtml = renderToStaticMarkup(
    createElement(WorkoutLogScreen, {
      workoutTitle: 'Tempo Tuesday',
      performedOn: '2026-09-15',
      completionStatus: 'partial',
      sessionRpe: '7',
      actualSummary: 'Moved indoors and cut one rep.',
      notes: 'Adjusted for weather.',
      stepResults,
      messages: [{ id: 'hint', tone: 'info', text: 'Partial workouts still inform future plans.' }],
      onCompletionStatusChange: noop,
      onSessionRpeChange: noop,
      onActualSummaryChange: noop,
      onNotesChange: noop,
      onStepResultChange: noop,
      onSave: noop,
    }),
  )
  const reviewHtml = renderToStaticMarkup(
    createElement(WeeklyReviewScreen, {
      draft: reviewDraft,
      metrics,
      messages: [{ id: 'ready', tone: 'success', text: 'Review is ready to save.' }],
      onFieldChange: noop,
      onMetricChange: noop,
      onSave: noop,
    }),
  )

  assert.match(editorHtml, /Scheduled time/)
  assert.match(editorHtml, /Fixed club session/)
  assert.match(editorHtml, /class="feature-screen workout-editor"/)
  assert.match(logHtml, /Session RPE/)
  assert.match(logHtml, /Actuals/)
  assert.match(logHtml, /class="workout-exercise"/)
  assert.match(logHtml, /Weight \(kg\)/)
  assert.match(logHtml, />Comments</)
  assert.match(reviewHtml, /weekly-review__metric-list/)
  assert.match(reviewHtml, /Next week focus/)
})
