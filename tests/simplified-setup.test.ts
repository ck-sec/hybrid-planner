import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GuidedOnboardingScreen } from '../src/app/features/guidedOnboardingScreen.ts'
import { equipmentPresets } from '../src/app/features/equipmentPresets.ts'
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
} from '../src/app/state/onboarding.ts'
import { buildInitialPromptInputFromAthleteProfile } from '../src/app/state/ai-handoff.ts'
import { buildInitialWeekPrompt } from '../src/ai/prompts.ts'
import { parseLocalDate } from '../src/domain/local-date.ts'

const noop = () => undefined
const weekStart = parseLocalDate('2026-09-14')
const initial = () => createGuidedOnboardingState({
  athleteId: 'simple-athlete', draftId: 'simple-draft', athleteName: 'Alex',
  createdOn: '2026-09-09', startingWeek: '2026-09-14',
})
const apply = (state: GuidedOnboardingState, ...actions: GuidedOnboardingAction[]) =>
  actions.reduce(reduceGuidedOnboardingState, state)

function readyState() {
  return apply(initial(),
    { type: 'setGoalSummary', value: 'Enjoy a consistent hybrid week' },
    { type: 'setCategoryCount', category: 'aerobic', value: '3' },
    { type: 'toggleCategoryDay', category: 'aerobic', day: 'monday' },
    { type: 'toggleCategoryDay', category: 'aerobic', day: 'wednesday' },
    { type: 'toggleCategoryDay', category: 'aerobic', day: 'friday' },
    { type: 'setAerobicExercises', value: 'Trail running, SkiErg; open-water swimming' },
    { type: 'setEquipmentMode', id: 'home' },
  )
}

test('four-step setup completes without clubs or a strength-programming preference', () => {
  const state = readyState()
  const props = createGuidedOnboardingScreenProps(state, noop)
  assert.deepEqual(props.steps.map(step => step.id), ['goal', 'schedule', 'equipment', 'review'])
  assert.equal(validateGuidedOnboardingState(state).issues.length, 0)
  const result = createAthleteProfileFromGuidedOnboardingState(state, { updatedOn: '2026-09-09' })
  assert.ok(result.ok)
  assert.ok(result.value)
  assert.equal(result.value.strengthPreference, undefined)
  assert.deepEqual(result.value.clubSessions, [])
  assert.deepEqual(result.value.sports, ['Trail running', 'SkiErg', 'open-water swimming'])
  const input = buildInitialPromptInputFromAthleteProfile(result.value, weekStart)
  assert.equal(input.preferences.strengthPreference, undefined)
  assert.match(buildInitialWeekPrompt(input).prompt, /SkiErg/)
})

test('an empty week is caught on the week screen, not at the end of setup', () => {
  const state = apply(initial(),
    { type: 'setGoalSummary', value: 'Train consistently' },
    { type: 'next' },
  )
  const props = createGuidedOnboardingScreenProps(state, noop)
  assert.equal(state.currentStep, 'schedule')
  assert.equal(props.canGoNext, false)
  assert.ok(props.messages?.some(message => message.text.includes('Choose a training type')))
  assert.equal(reduceGuidedOnboardingState(state, { type: 'next' }).currentStep, 'schedule')
})

test('equipment preset contents are explicit, editable, and preserved in the AI brief', () => {
  let state = readyState()
  assert.deepEqual(state.equipmentItems, equipmentPresets.home.items)
  state = apply(state,
    { type: 'toggleEquipmentItem', item: 'Adjustable bench' },
    { type: 'setEquipmentDetails', value: 'Pull-up bar, 16 kg kettlebell only' },
  )
  const result = createAthleteProfileFromGuidedOnboardingState(state, { updatedOn: '2026-09-09' })
  assert.ok(result.value)
  const equipment = result.value.equipmentDetails.map(item => item.label)
  assert.ok(equipment.includes('Dumbbells'))
  assert.ok(equipment.includes('Pull-up bar'))
  assert.ok(!equipment.includes('Adjustable bench'))
  const prompt = buildInitialWeekPrompt(buildInitialPromptInputFromAthleteProfile(result.value, weekStart)).prompt
  assert.match(prompt, /Pull-up bar/)
  assert.doesNotMatch(prompt, /Adjustable bench/)
  const saved = createResumableOnboardingDraft(state, { updatedOn: '2026-09-09' })
  assert.ok(saved.value)
  const restored = restoreGuidedOnboardingStateFromDraft(saved.value)
  assert.deepEqual(restored.equipmentItems, state.equipmentItems)
  assert.equal(restored.draft.aerobicExercises, state.draft.aerobicExercises)
  assert.deepEqual(restored.selectedDays, state.selectedDays)
  const commercial = apply(restored, { type: 'setEquipmentMode', id: 'commercial' })
  assert.deepEqual(commercial.equipmentItems, equipmentPresets.commercial.items)
})

test('optional club training needs only a day and time and does not invent workout details', () => {
  let state = apply(readyState(), { type: 'addClubSession' })
  const id = state.clubSessions[0]!.id
  assert.ok(validateGuidedOnboardingState(state).issues.some(issue => issue.field.endsWith('.day')))
  state = apply(state,
    { type: 'setClubSessionField', sessionId: id, field: 'day', value: 'tuesday' },
    { type: 'setClubSessionField', sessionId: id, field: 'startTime', value: '18:30' },
  )
  assert.deepEqual(validateGuidedOnboardingState(state).issues, [])
  const result = createAthleteProfileFromGuidedOnboardingState(state, { updatedOn: '2026-09-09' })
  assert.ok(result.value)
  const club = result.value.clubSessions[0]!
  assert.equal(club.title, 'Club training')
  assert.equal(club.category, undefined)
  assert.equal(club.scope, undefined)
  assert.equal(club.durationMin, undefined)
  const input = buildInitialPromptInputFromAthleteProfile(result.value, weekStart)
  assert.equal(input.fixedClubSessions.length, 0)
  assert.equal(input.clubTimetableCommitments?.[0]?.startTime, '18:30')
  assert.equal(input.clubTimetableCommitments?.[0]?.date, '2026-09-15')
  assert.deepEqual(createFixedClubWorkoutsForTargetWeek(result.value, { athleteId: result.value.id, weekPlanId: 'simple-week', weekStart: '2026-09-14' }), [])
  const saved = createResumableOnboardingDraft(state, { updatedOn: '2026-09-09' })
  assert.ok(saved.value)
  assert.equal(restoreGuidedOnboardingStateFromDraft(saved.value).clubSessions[0]?.startTime, '18:30')
  state = apply(state, { type: 'removeClubSession', sessionId: id })
  assert.deepEqual(state.clubSessions, [])
  assert.deepEqual(validateGuidedOnboardingState(state).issues, [])
})

test('club-only schedules remain valid without assigning a training category', () => {
  let state = apply(initial(), { type: 'setGoalSummary', value: 'Stay active with my club' }, { type: 'setEquipmentMode', id: 'bodyweight' }, { type: 'addClubSession' })
  state = apply(state,
    { type: 'setClubSessionField', sessionId: state.clubSessions[0]!.id, field: 'day', value: 'wednesday' },
    { type: 'setClubSessionField', sessionId: state.clubSessions[0]!.id, field: 'startTime', value: '19:00' },
  )
  const result = createAthleteProfileFromGuidedOnboardingState(state, { updatedOn: '2026-09-09' })
  assert.ok(result.value)
  assert.deepEqual(result.value.preferredWeeklyStructure, [])
  assert.deepEqual(result.value.sports, ['Club training'])
})

test('old removed steps migrate to the matching new screen without losing draft answers', () => {
  const state = readyState()
  const saved = createResumableOnboardingDraft(state, { updatedOn: '2026-09-09' })
  assert.ok(saved.value)
  const prefix = '@guided-onboarding '
  const metadata = JSON.parse(saved.value.notes!.slice(prefix.length))
  for (const [oldStep, newStep] of [['modalities', 'schedule'], ['strength', 'equipment'], ['club', 'schedule']]) {
    const restored = restoreGuidedOnboardingStateFromDraft({ ...saved.value, notes: `${prefix}${JSON.stringify({ ...metadata, currentStep: oldStep })}` })
    assert.equal(restored.currentStep, newStep)
    assert.equal(restored.draft.goalSummary, state.draft.goalSummary)
    assert.equal(restored.draft.aerobicExercises, state.draft.aerobicExercises)
    assert.deepEqual(restored.equipmentItems, state.equipmentItems)
  }
})

test('visual controls expand selected training only and omit obsolete club and strength fields', () => {
  const state = apply(readyState(), { type: 'selectStep', stepId: 'schedule' })
  const html = renderToStaticMarkup(createElement(GuidedOnboardingScreen, createGuidedOnboardingScreenProps(state, noop)))
  assert.match(html, /Step 2 of 4/)
  assert.match(html, /type="range"/)
  assert.match(html, /id="aerobic-exercises"/)
  assert.match(html, /Club training/)
  assert.match(html, /Optional/)
  assert.doesNotMatch(html, /strength-sessions|mobility-sessions|Strength approach|aerobic-modalities/)
  const withClub = apply(state, { type: 'addClubSession' })
  const clubHtml = renderToStaticMarkup(createElement(GuidedOnboardingScreen, createGuidedOnboardingScreenProps(withClub, noop)))
  assert.match(clubHtml, /Short description \(optional\)/)
  assert.doesNotMatch(clubHtml, />Scope<|>Location<|>Duration in minutes<|>Category</)
  const equipmentState = apply(state, { type: 'selectStep', stepId: 'equipment' })
  const equipmentHtml = renderToStaticMarkup(createElement(GuidedOnboardingScreen, createGuidedOnboardingScreenProps(equipmentState, noop)))
  assert.match(equipmentHtml, /Home gym/)
  assert.match(equipmentHtml, /Dumbbells/)
  assert.match(equipmentHtml, /Commercial gym/)
  assert.match(equipmentHtml, /Cable machine/)
})

test('turning a category off clears its days and excludes inactive preferences from the brief', () => {
  const state = apply(readyState(),
    { type: 'setCategoryCount', category: 'aerobic', value: '0' },
    { type: 'setCategoryCount', category: 'strength', value: '2' },
    { type: 'toggleCategoryDay', category: 'strength', day: 'tuesday' },
  )
  assert.deepEqual(state.selectedDays.aerobic, [])
  assert.equal(state.draft.aerobicSessionCount, '0')
  assert.ok(!validateGuidedOnboardingState(state).issues.some(issue => issue.field === 'aerobicDays'))
  const profile = createAthleteProfileFromGuidedOnboardingState(state, { updatedOn: '2026-09-09' })
  assert.ok(profile.value)
  assert.deepEqual(profile.value.sports, ['strength'])
  const prompt = buildInitialWeekPrompt(buildInitialPromptInputFromAthleteProfile(profile.value, weekStart)).prompt
  assert.doesNotMatch(prompt, /Trail running|SkiErg|open-water swimming/)
  const saved = createResumableOnboardingDraft(state, { updatedOn: '2026-09-09' })
  assert.ok(saved.value)
  assert.equal(restoreGuidedOnboardingStateFromDraft(saved.value).draft.aerobicExercises, state.draft.aerobicExercises)
})
