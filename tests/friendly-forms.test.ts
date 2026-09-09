import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GuidedOnboardingScreen } from '../src/app/features/guidedOnboardingScreen.ts'
import {
  parseStructuredMetricText,
  updateStructuredMetricAdvancedText,
  updateStructuredMetricField,
  workoutActualMetricFields,
  workoutStepActualFields,
} from '../src/app/features/metricFields.ts'
import { WeeklyReviewScreen } from '../src/app/features/weeklyReviewScreen.ts'
import { WorkoutEditorScreen } from '../src/app/features/workoutEditorScreen.ts'
import { WorkoutLogScreen } from '../src/app/features/workoutLogScreen.ts'
import type {
  ChoiceOption,
  ClubSessionDraft,
  DayOfWeek,
  OnboardingDraft,
  OnboardingStepId,
  WeeklyMetricDraft,
  WeeklyReviewDraft,
  WorkoutEditorDraft,
  WorkoutLogStepResultDraft,
  WorkoutSectionDraft,
} from '../src/app/features/models.ts'

const noop = () => undefined

test('friendly metric helpers keep supported fields, blank values, and advanced lines intact', () => {
  const sessionModel = parseStructuredMetricText(
    'durationMin:\npace: 5:05/km\nweather: indoors\nnote without colon',
    workoutActualMetricFields,
  )

  assert.equal(sessionModel.fields.find(field => field.key === 'durationMin')?.value, '')
  assert.equal(sessionModel.fields.find(field => field.key === 'paceSecondsPerKm')?.value, '5:05/km')
  assert.equal(sessionModel.advancedText, 'weather: indoors\nnote without colon')

  assert.equal(
    updateStructuredMetricAdvancedText(sessionModel, 'weather: windy'),
    'durationMin:\npace: 5:05/km\nweather: windy',
  )

  assert.equal(
    updateStructuredMetricField(sessionModel, 'distanceMeters', '5200'),
    'durationMin:\npace: 5:05/km\ndistanceMeters: 5200\nweather: indoors\nnote without colon',
  )

  assert.equal(
    updateStructuredMetricField(sessionModel, 'durationMin', ''),
    'pace: 5:05/km\nweather: indoors\nnote without colon',
  )

  const stepModel = parseStructuredMetricText('load: 24\nseconds: 90\ncoachFlag: hot', workoutStepActualFields)
  assert.equal(stepModel.fields.find(field => field.key === 'loadKg')?.value, '24')
  assert.equal(stepModel.fields.find(field => field.key === 'seconds')?.value, '90')
  assert.equal(stepModel.advancedText, 'coachFlag: hot')
})

test('friendly form screens expose compact progress and advanced sections', () => {
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

  const onboardingHtml = renderToStaticMarkup(
    createElement(GuidedOnboardingScreen, {
      steps: steps.filter(step => step.id !== 'modalities' && step.id !== 'strength' && step.id !== 'club'),
      currentStep: 'schedule',
      draft,
      aerobicDayOptions: [
        { id: 'tuesday', label: 'Tuesday', selected: true },
        { id: 'thursday', label: 'Thursday', selected: true },
      ] satisfies ChoiceOption<DayOfWeek>[],
      strengthDayOptions: [{ id: 'monday', label: 'Monday', selected: true }] satisfies ChoiceOption<DayOfWeek>[],
      mobilityDayOptions: [{ id: 'sunday', label: 'Sunday', selected: true }] satisfies ChoiceOption<DayOfWeek>[],
      aerobicModalityOptions: [{ id: 'run', label: 'Running', selected: true }],
      strengthOptions: [{ id: 'maintain', label: 'Maintain', selected: true }],
      equipmentModeOptions: [{ id: 'home', label: 'Home gym', selected: true }],
      clubCategoryOptions: [
        { value: '', label: 'Select category' },
        { value: 'Aerobic', label: 'Aerobic' },
      ],
      clubScopeOptions: [
        { value: '', label: 'Select scope' },
        { value: 'Fixed weekly session', label: 'Fixed weekly session' },
      ],
      clubSessions,
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

  assert.match(onboardingHtml, /guided-onboarding__progress/)
  assert.match(onboardingHtml, /Step 2 of 4/)
  assert.match(onboardingHtml, /Club training 1/)

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
  ]
  const stepResults: WorkoutLogStepResultDraft[] = [
    {
      id: 'main-1',
      title: 'Tempo block',
      status: 'trimmed',
      actualResult: 'sets: 2\npace: 4:\ncoachFlag: moved indoors',
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
      actualSummary: 'durationMin: 52\npace: 4:55/km\nweather: hot',
      notes: 'Adjusted for weather.',
      stepResults,
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
      onFieldChange: noop,
      onMetricChange: noop,
      onSave: noop,
    }),
  )

  assert.match(editorHtml, /feature-advanced workout-editor__advanced/)
  assert.match(editorHtml, /Advanced workout details/)
  assert.match(logHtml, /feature-metric-grid/)
  assert.match(logHtml, /Advanced raw lines/)
  assert.match(logHtml, /weather: hot/)
  assert.match(reviewHtml, /Optional details/)
  assert.match(reviewHtml, /Optional note/)
})
