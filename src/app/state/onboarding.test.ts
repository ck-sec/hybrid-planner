import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createAthleteProfileFromGuidedOnboardingState,
  createFixedClubWorkoutsForTargetWeek,
  createGuidedOnboardingScreenProps,
  createGuidedOnboardingState,
  createResumableOnboardingDraft,
  reduceGuidedOnboardingState,
  restoreGuidedOnboardingStateFromDraft,
  validateGuidedOnboardingState,
  type GuidedOnboardingAction,
  type GuidedOnboardingState,
} from './onboarding.ts'

function apply(state: GuidedOnboardingState, ...actions: GuidedOnboardingAction[]) {
  return actions.reduce((current, action) => reduceGuidedOnboardingState(current, action), state)
}

function buildCompleteState() {
  let state = createGuidedOnboardingState({
    athleteId: 'athlete-amy',
    draftId: 'draft-amy',
    athleteName: 'Amy',
    createdOn: '2026-09-09',
    startingWeek: '2026-09-14',
  })

  state = apply(
    state,
    { type: 'setGoalSummary', value: 'Build a balanced running and lifting week.' },
    { type: 'setTargetDate', value: '2026-12-06' },
    { type: 'setGoalNotes', value: 'Keep the weekly load steady around the Tuesday club workout.' },
    { type: 'setCategoryCount', category: 'aerobic', value: '4' },
    { type: 'setCategoryCount', category: 'strength', value: '2' },
    { type: 'setCategoryCount', category: 'mobility', value: '3' },
    { type: 'toggleCategoryDay', category: 'aerobic', day: 'tuesday' },
    { type: 'toggleCategoryDay', category: 'aerobic', day: 'thursday' },
    { type: 'toggleCategoryDay', category: 'strength', day: 'monday' },
    { type: 'toggleCategoryDay', category: 'strength', day: 'friday' },
    { type: 'toggleCategoryDay', category: 'mobility', day: 'wednesday' },
    { type: 'toggleAerobicModality', id: 'running' },
    { type: 'toggleAerobicModality', id: 'cycling' },
    { type: 'setStrengthPreference', id: 'upper_lower' },
    { type: 'setEquipmentMode', id: 'home' },
    { type: 'setEquipmentDetails', value: 'Kettlebells\nBands\nCommercial gym on Fridays' },
    { type: 'setReviewNotes', value: 'Travel starts the following Monday.' },
  )

  state = reduceGuidedOnboardingState(state, { type: 'addClubSession' })
  const clubId = state.clubSessions[0]!.id

  return apply(
    state,
    { type: 'setClubSessionField', sessionId: clubId, field: 'category', value: 'aerobic' },
    { type: 'setClubSessionField', sessionId: clubId, field: 'activity', value: 'Track Club' },
    { type: 'setClubSessionField', sessionId: clubId, field: 'scope', value: 'Primary weekly anchor' },
    { type: 'setClubSessionField', sessionId: clubId, field: 'location', value: 'City track' },
    { type: 'setClubSessionField', sessionId: clubId, field: 'day', value: 'tuesday' },
    { type: 'setClubSessionField', sessionId: clubId, field: 'startTime', value: '19:00' },
    { type: 'setClubSessionField', sessionId: clubId, field: 'durationMinutes', value: '75' },
    { type: 'setClubSessionField', sessionId: clubId, field: 'notes', value: 'Hard intervals most weeks.' },
  )
}

test('screen adapter exposes step gating, messages, and controlled callbacks', () => {
  let state = createGuidedOnboardingState({
    athleteId: 'athlete-amy',
    draftId: 'draft-amy',
    athleteName: 'Amy',
    createdOn: '2026-09-09',
    startingWeek: '2026-09-14',
  })

  const initialProps = createGuidedOnboardingScreenProps(state, () => undefined)
  assert.equal(initialProps.currentStep, 'goal')
  assert.equal(initialProps.canGoNext, false)
  assert.equal(initialProps.steps.find(step => step.id === 'schedule')?.isAvailable, false)
  assert.match(initialProps.messages?.[0]?.text ?? '', /primary goal/i)
  assert.equal(initialProps.messages?.[0]?.tone, 'info')

  let dispatched: GuidedOnboardingAction | undefined
  createGuidedOnboardingScreenProps(state, action => { dispatched = action }).onGoalSummaryChange('Finish strong')
  assert.deepEqual(dispatched, { type: 'setGoalSummary', value: 'Finish strong' })

  state = apply(
    state,
    { type: 'setGoalSummary', value: 'Finish a spring build healthy.' },
    { type: 'setTargetDate', value: '2026-12-06' },
  )
  const goalProps = createGuidedOnboardingScreenProps(state, () => undefined)
  assert.equal(goalProps.canGoNext, true)
  const invalidDateState = reduceGuidedOnboardingState(state, { type: 'setTargetDate', value: '2025-01-01' })
  const invalidDateProps = createGuidedOnboardingScreenProps(invalidDateState, () => undefined)
  assert.equal(invalidDateProps.canGoNext, false)
  assert.equal(invalidDateProps.messages?.find(message => message.text.includes('earlier'))?.tone, 'error')
  state = reduceGuidedOnboardingState(state, { type: 'next' })
  assert.equal(state.currentStep, 'schedule')
  const scheduleSummary = createGuidedOnboardingScreenProps(state, () => undefined).steps.find(step => step.id === 'schedule')
  assert.equal(scheduleSummary?.isAvailable, true)
})

test('resumable drafts round-trip partial feature state without losing pending club edits', () => {
  let state = createGuidedOnboardingState({
    athleteId: 'athlete-amy',
    draftId: 'draft-amy',
    athleteName: 'Amy',
    createdOn: '2026-09-09',
    startingWeek: '2026-09-14',
  })

  state = apply(
    state,
    { type: 'setGoalSummary', value: 'Stay consistent.' },
    { type: 'setTargetDate', value: '2026-12-06' },
    { type: 'setGoalNotes', value: 'Prefer steady work over spikes.' },
    { type: 'setCategoryCount', category: 'aerobic', value: '3' },
    { type: 'setCategoryCount', category: 'strength', value: '1' },
    { type: 'setCategoryCount', category: 'mobility', value: '2' },
    { type: 'toggleCategoryDay', category: 'aerobic', day: 'tuesday' },
    { type: 'toggleCategoryDay', category: 'strength', day: 'friday' },
    { type: 'toggleCategoryDay', category: 'mobility', day: 'sunday' },
    { type: 'toggleAerobicModality', id: 'running' },
    { type: 'setStrengthPreference', id: 'full_body' },
    { type: 'setEquipmentMode', id: 'commercial' },
    { type: 'setEquipmentDetails', value: 'Rack and rowing erg available.' },
    { type: 'setReviewNotes', value: 'Review travel weeks later.' },
  )
  state = apply(state, { type: 'selectStep', stepId: 'schedule' })
  state = reduceGuidedOnboardingState(state, { type: 'addClubSession' })
  const clubId = state.clubSessions[0]!.id
  state = apply(
    state,
    { type: 'setClubSessionField', sessionId: clubId, field: 'category', value: 'aerobic' },
    { type: 'setClubSessionField', sessionId: clubId, field: 'activity', value: 'Lunch Ride' },
    { type: 'setClubSessionField', sessionId: clubId, field: 'location', value: 'River path' },
  )

  const saved = createResumableOnboardingDraft(state, { updatedOn: '2026-09-10' })
  assert.equal(saved.ok, true)
  if (!saved.ok) return
  const savedDraft = saved.value
  assert.ok(savedDraft)

  const restored = restoreGuidedOnboardingStateFromDraft(savedDraft)
  assert.equal(restored.currentStep, 'schedule')
  assert.equal(restored.draft.goalNotes, 'Prefer steady work over spikes.')
  assert.equal(restored.draft.equipmentMode, 'commercial')
  assert.equal(restored.clubSessions[0]?.activity, 'Lunch Ride')
  assert.equal(restored.clubSessions[0]?.location, 'River path')
  assert.equal(restored.clubSessions[0]?.scope, '')
  assert.equal(restored.nextClubSessionSequence, 2)
})

test('final athlete projection and fixed club workouts are deterministic and domain-valid', () => {
  const state = buildCompleteState()
  const validation = validateGuidedOnboardingState(state)
  assert.equal(validation.issues.length, 0)

  const finalized = createAthleteProfileFromGuidedOnboardingState(state, { updatedOn: '2026-09-10' })
  assert.equal(finalized.ok, true)
  if (!finalized.ok) return
  const profile = finalized.value
  assert.ok(profile)

  assert.deepEqual(profile.sports, ['running', 'cycling'])
  assert.equal(profile.preferredWeeklyStructure[1]?.dayOfWeek, 2)
  assert.equal(profile.preferredWeeklyStructure[1]?.preferredStartTime, '19:00')
  assert.equal(profile.equipmentDetails[0]?.id, 'equipment-mode-home')
  assert.match(profile.notes ?? '', /@guided-onboarding /)
  assert.match(profile.clubSessions[0]?.notes ?? '', /@guided-onboarding-club /)

  const weekA = createFixedClubWorkoutsForTargetWeek(profile, {
    athleteId: 'athlete-amy',
    weekPlanId: 'week-2026-09-21',
    weekStart: '2026-09-21',
  })
  const weekB = createFixedClubWorkoutsForTargetWeek(profile, {
    athleteId: 'athlete-amy',
    weekPlanId: 'week-2026-09-21',
    weekStart: '2026-09-21',
  })

  assert.deepEqual(weekA, weekB)
  assert.equal(weekA[0]?.id, 'club-2026-09-21-club-session-1')
  assert.equal(weekA[0]?.scheduledDate, '2026-09-22')
  assert.equal(weekA[0]?.fixedClubSession?.recurringSessionId, profile.clubSessions[0]?.id)
  assert.equal(weekA[0]?.main[0]?.target?.minutes, 75)
})

test('finalization blocks missing preferences instead of inventing defaults', () => {
  const state = apply(
    createGuidedOnboardingState({
      athleteId: 'athlete-amy',
      draftId: 'draft-amy',
      athleteName: 'Amy',
      createdOn: '2026-09-09',
      startingWeek: '2026-09-14',
    }),
    { type: 'setGoalSummary', value: 'Get moving again.' },
    { type: 'setCategoryCount', category: 'aerobic', value: '2' },
    { type: 'toggleCategoryDay', category: 'aerobic', day: 'monday' },
  )

  const finalized = createAthleteProfileFromGuidedOnboardingState(state, { updatedOn: '2026-09-10' })
  assert.equal(finalized.ok, false)
  if (finalized.ok) return
  assert.doesNotMatch(finalized.issues.map(issue => issue.message).join('\n'), /strength preference/i)
  assert.match(finalized.issues.map(issue => issue.message).join('\n'), /equipment access mode/i)
})
