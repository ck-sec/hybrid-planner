import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_LIBRARY } from '../../engine/library.ts'
import { emptyCampaign, normalizeRecommendedDraft, parseCampaign } from './model.ts'
import { CAMPAIGN_TEXT_LIMITS } from './draft-limits.ts'
import { applySetupProposal } from './setup-proposal.ts'
import type { GoalProposal } from './setup-assistant.ts'

function draft() {
  const state = emptyCampaign('2026-09-07')
  assert.ok(state.draft.recommendedSetup)
  state.draft.recommendedSetup.mode = 'assisted'
  state.draft.recommendedSetup.goalText = 'Dodgeball World Championships, Bangkok, 29 November 2026.'
  state.draft.recommendedSetup.typicalRunMinutes = 30
  state.draft.goalKind = 'dodgeball'
  state.draft.goalLabel = 'My reviewed championship goal'
  state.draft.location = 'Bangkok'
  state.draft.eventDate = '2026-11-29'
  state.draft.priorities = ['repeat_sprint']
  state.draft.runsPerWeek = 3
  state.draft.liftsPerWeek = 2
  state.draft.liftDurationMin = 30
  state.draft = normalizeRecommendedDraft(state.draft)
  return state
}

function proposal(): GoalProposal {
  const state = draft()
  assert.ok(state.draft.recommendedSetup)
  return {
    goalKind: 'custom', label: 'Interpreted sporting goal', location: 'A reviewed location',
    eventDate: '2026-11-29', priorities: ['shoulder_durability'],
    exerciseIds: [...state.draft.recommendedSetup.exerciseIds],
  }
}

test('exercise-only review preserves the confirmed goal, date and user-entered quantities', () => {
  const state = draft()
  const before = structuredClone(state)
  const next = applySetupProposal(state, { ...proposal(), eventDate: null }, 'suggest_exercises')
  for (const field of ['goalKind', 'goalLabel', 'location', 'eventDate', 'priorities', 'weeklyRunMinutes', 'runsPerWeek', 'liftsPerWeek', 'liftDurationMin', 'weeklyTimeBudgetMin', 'exercises', 'practiceDays'] as const) {
    assert.deepEqual(next.draft[field], before.draft[field], field)
  }
  assert.equal(next.draft.confirmed, false)
  assert.deepEqual(state, before)
})

test('goal interpretation updates only reviewed intent and exercise identities', () => {
  const state = draft()
  state.draft.eventDate = '2026-11-22'
  const next = applySetupProposal(state, proposal(), 'interpret_goal')
  assert.equal(next.draft.goalLabel, 'Interpreted sporting goal')
  assert.equal(next.draft.eventDate, '2026-11-29')
  assert.deepEqual(next.draft.priorities, ['shoulder_durability'])
  assert.equal(next.draft.weeklyRunMinutes, 90)
  assert.deepEqual(next.draft.exercises, [])
  assert.deepEqual(next.weeks, [])
  const unknownDate = draft()
  unknownDate.draft.eventDate = ''
  assert.equal(applySetupProposal(unknownDate, { ...proposal(), eventDate: null }, 'interpret_goal').draft.eventDate, '')
})

test('proposal application revalidates against current equipment and never edits committed blocks', () => {
  const state = draft()
  const unavailable = DEFAULT_LIBRARY.exercises.find(exercise => !exercise.highSkill && exercise.equipment.includes('barbell'))
  assert.ok(unavailable)
  assert.throws(() => applySetupProposal(state, { ...proposal(), exerciseIds: [unavailable.id] }, 'suggest_exercises'), /equipped/)
  assert.throws(() => applySetupProposal(state, { ...proposal(), ...{ sets: 100 } }, 'interpret_goal'), /only/)
  assert.throws(() => applySetupProposal({ ...state, setupComplete: true }, proposal(), 'interpret_goal'), /committed/)
})

test('AI text bounds match persisted campaign bounds before applying a proposal', () => {
  const state = draft()
  const maximum = {
    ...proposal(), label: 'G'.repeat(CAMPAIGN_TEXT_LIMITS.goalLabel),
    location: 'L'.repeat(CAMPAIGN_TEXT_LIMITS.location),
  }
  const applied = applySetupProposal(state, maximum, 'interpret_goal')
  assert.doesNotThrow(() => parseCampaign(JSON.parse(JSON.stringify(applied))))
  assert.throws(() => applySetupProposal(state, { ...maximum, label: `${maximum.label}G` }, 'interpret_goal'), /goal name/)
  assert.throws(() => applySetupProposal(state, { ...maximum, location: `${maximum.location}L` }, 'interpret_goal'), /location/)
})
