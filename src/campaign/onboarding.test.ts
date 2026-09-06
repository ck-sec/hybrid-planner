import assert from 'node:assert/strict'
import test from 'node:test'
import { LIMITS } from '../../engine/constants.ts'
import type { CustomExerciseSpec } from '../../engine/types.ts'
import { equipmentForResources, RESOURCE_CATALOG } from './equipment.ts'
import { emptyCampaign, parseCampaign } from './model.ts'
import { addOnboardingCustomExercise, advanceOnboarding, goalLabelFromText, ONBOARDING_STEPS, onboardingGoalText, onboardingReviewDate, onboardingStep, patchOnboardingDraft } from './onboarding.ts'
import { programmingChoices, selectProgramExercises } from './programming.ts'

function answeredRoutine() {
  const state = emptyCampaign('2026-09-07')
  return {
    ...state, step: 2,
    draft: patchOnboardingDraft(state.draft, {
      runsPerWeek: 3, liftsPerWeek: 2, liftDurationMin: 45, resources: ['floor_space'], equipment: ['bodyweight'],
    }, { goalText: 'Get stronger and enjoy running', typicalRunMinutes: 30 }),
  }
}

test('three onboarding stages map historical unfinished step numbers', () => {
  assert.deepEqual(ONBOARDING_STEPS.map(step => step.value), [1, 2, 5])
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(onboardingStep), [1, 1, 2, 5, 2, 5, 2])
})

test('free goal labels are bounded and neutral; edits preserve an explicitly chosen date', () => {
  const state = emptyCampaign('2026-09-07')
  const draft = patchOnboardingDraft(state.draft, { eventDate: '2026-10-18' }, { goalText: '  Stay fit\n  and enjoy the outdoors ' })
  assert.equal(draft.goalLabel, 'Stay fit and enjoy the outdoors')
  assert.equal(draft.goalKind, 'custom')
  assert.equal(draft.recommendedSetup!.mode, 'assisted')
  const edited = patchOnboardingDraft(draft, {}, { goalText: 'I would like to prepare for an event next summer' })
  assert.equal(edited.eventDate, '2026-10-18')
  assert.equal(edited.location, '')
  assert.equal(goalLabelFromText('x'.repeat(100)).length, 80)
  assert.throws(() => patchOnboardingDraft(draft, {}, { goalText: 'x'.repeat(10_000) }), /Shorten/)
  assert.equal(state.draft.goalLabel, 'Run + lift')
})

test('a goal can continue without AI or an event date, using the displayed review date', t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No model calls during goal setup'))
  const state = emptyCampaign('2026-09-07')
  assert.throws(() => advanceOnboarding(state), /what you want to work toward/)
  const draft = patchOnboardingDraft(state.draft, { eventDate: '' }, { goalText: 'Feel better on long walks' })
  const next = advanceOnboarding({ ...state, draft })
  assert.equal(next.step, 2)
  assert.equal(next.draft.eventDate, '2026-11-29')
  assert.equal(next.draft.goalLabel, draft.goalLabel)
  assert.equal(next.draft.exercises.length, 0)
  assert.equal(next.draft.runsPerWeek, 0)
})

test('changing a block start updates only its default review, never a user event', () => {
  const draft = answeredRoutine().draft
  assert.equal(patchOnboardingDraft(draft, { startDate: '2026-09-14' }).eventDate, '2026-12-06')
  assert.equal(patchOnboardingDraft({ ...draft, eventDate: '2027-01-02' }, { startDate: '2026-09-14' }).eventDate, '2027-01-02')
  assert.equal(onboardingReviewDate(''), '')
  assert.throws(() => advanceOnboarding({ ...answeredRoutine(), step: 1, draft: { ...draft, eventDate: '2026-09-01' } }), /Choose a date/)
  assert.throws(() => advanceOnboarding({ ...answeredRoutine(), step: 1, draft: { ...draft, eventDate: '2026-02-31' } }), /including the year/)
})

test('routine validates real answers and gives missing floor-space feedback', () => {
  const state = answeredRoutine()
  for (const change of [{ runsPerWeek: 0 }, { liftsPerWeek: -1 }, { liftDurationMin: 0 }, { availableDays: [] }]) {
    assert.throws(() => advanceOnboarding({ ...state, draft: { ...state.draft, ...change } }), /Choose/)
  }
  assert.throws(() => advanceOnboarding({ ...state, draft: { ...state.draft, resources: [], equipment: ['bodyweight'] } }), /floor space/)
  assert.throws(() => advanceOnboarding({ ...state, draft: { ...state.draft, practiceDays: [1], practiceDuration: 0 } }), /usual length/)
})

test('routine confirms equipment before review, and offline building requires baseline confirmation', t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('The built-in plan must work without AI'))
  const state = answeredRoutine()
  const next = advanceOnboarding(state)
  assert.equal(next.step, 5)
  assert.ok(next.draft.program)
  assert.ok(next.draft.recommendedSetup!.exerciseIds.length)
  assert.deepEqual(next.draft.exercises, [])
  assert.equal(next.draft.confirmed, false)
  assert.throws(() => advanceOnboarding(next), /Confirm that these are your recent/)
  const built = advanceOnboarding({ ...next, draft: { ...next.draft, confirmed: true } })
  assert.equal(built.setupComplete, true)
  assert.equal(built.weeks.length, 1)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(built))), built)
})

test('an older classic routine retains its goal and can resume the new flow', () => {
  const state = answeredRoutine()
  state.draft.recommendedSetup = { ...state.draft.recommendedSetup!, mode: 'classic', goalText: '' }
  state.draft.goalLabel = 'Run + lift'
  state.draft.goalKind = 'hybrid'
  assert.equal(onboardingGoalText(state.draft), 'Run + lift')
  const before = structuredClone(state)
  const next = advanceOnboarding({ ...state, step: 6 })
  assert.equal(next.step, 5)
  assert.equal(next.draft.goalLabel, 'Run + lift')
  assert.deepEqual(state, before)
})

test('an unfinished old AI brief becomes an ordinary goal without requiring an AI response', () => {
  const state = answeredRoutine()
  state.draft.goalLabel = ''
  state.draft.eventDate = ''
  const next = advanceOnboarding({ ...state, step: 1 })
  assert.equal(next.step, 2)
  assert.equal(next.draft.goalLabel, 'Get stronger and enjoy running')
  assert.equal(next.draft.eventDate, '2026-11-29')
  assert.equal(next.draft.goalKind, 'custom')
})

test('custom gear survives equipment confirmation and saved campaign parsing', () => {
  const state = answeredRoutine()
  const next = advanceOnboarding({ ...state, draft: { ...state.draft, resources: ['floor_space', 'custom:ball', 'custom:mat'] } })
  assert.deepEqual(next.draft.resources, ['custom:ball', 'custom:mat', 'floor_space'])
  assert.deepEqual(next.draft.program!.resources, ['bodyweight', 'custom:ball', 'custom:mat', 'floor_space'])
  assert.deepEqual(next.draft.equipment, ['bodyweight'])
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(next))), next)
})

const customExercise: CustomExerciseSpec = {
  version: 1, id: 'custom-mat-squat', name: 'Mat stance squat', profileId: 'controlled_squat',
  requirements: ['bodyweight', 'floor_space'],
  description: 'Stand comfortably and squat with control.', focus: 'Use a comfortable range.',
  why: 'A familiar controlled movement for this goal.',
}

test('a reviewed custom exercise is selected when the lineup has room, without observations or loads', () => {
  const state = advanceOnboarding(answeredRoutine())
  const before = structuredClone(state)
  const result = addOnboardingCustomExercise(state.draft, customExercise)
  assert.equal(result.selected, true)
  assert.ok(result.draft.recommendedSetup!.exerciseIds.includes(customExercise.id))
  assert.equal(result.draft.program!.customExercises!.length, 1)
  assert.deepEqual(result.draft.exercises, [])
  assert.equal(result.draft.confirmed, false)
  assert.deepEqual(state, before)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify({ ...state, draft: result.draft }))).draft, result.draft)
})

test('a full lineup retains a new definition without silently replacing an active exercise', () => {
  const state = answeredRoutine()
  const resources = RESOURCE_CATALOG.map(resource => resource.id)
  const ready = advanceOnboarding({ ...state, draft: { ...state.draft, resources, equipment: equipmentForResources(resources) } })
  const selected = programmingChoices(ready.draft).slice(0, LIMITS.maxProgramExercises).map(choice => choice.exercise.id)
  assert.equal(selected.length, LIMITS.maxProgramExercises)
  const full = patchOnboardingDraft(selectProgramExercises(ready.draft, selected))
  const result = addOnboardingCustomExercise(full, customExercise)
  assert.equal(result.selected, false)
  assert.deepEqual(result.draft.recommendedSetup!.exerciseIds, selected)
  assert.equal(result.draft.program!.customExercises![0]!.id, customExercise.id)
})

test('custom exercise staging rejects unavailable gear and prescription prose without changing the draft', () => {
  const draft = advanceOnboarding(answeredRoutine()).draft
  const before = structuredClone(draft)
  assert.throws(() => addOnboardingCustomExercise(draft, { ...customExercise, requirements: ['custom:missing-mat'] }), /resource|available|confirmed|require/i)
  assert.throws(() => addOnboardingCustomExercise(draft, { ...customExercise, description: 'Perform 20 reps.' }), /cannot prescribe/)
  assert.deepEqual(draft, before)
})
