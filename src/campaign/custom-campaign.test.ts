import assert from 'node:assert/strict'
import test from 'node:test'
import type { CustomExerciseSpec } from '../../engine/types.ts'
import { stageCustomExercises } from './custom-exercises.ts'
import { equipmentForResources } from './equipment.ts'
import { exerciseGuidance } from './exercise-guidance.ts'
import {
  buildCampaign, campaignDraftForWeek, completeCampaignSession, exampleCampaign,
  logCampaignBlockSet, nextCampaignWeek, normalizeRecommendedDraft, parseCampaign,
} from './model.ts'
import { enableTemplateProgramming, programmingChoices, selectProgramExercises } from './programming.ts'
import type { CampaignDraft, CampaignState } from './types.ts'

const CUSTOM: CustomExerciseSpec = {
  version: 1,
  id: 'custom-band-bracing',
  name: 'Band-resisted dead bug',
  profileId: 'controlled_core',
  requirements: ['bands', 'floor_space'],
  description: 'Lie on your back holding a secure band and move one heel away while keeping your trunk still.',
  focus: 'Use a comfortable range and keep the ribs and pelvis steady.',
  why: 'An alternative trunk-control movement using the available band.',
}

function prepared(): CampaignState {
  const source = exampleCampaign('2026-09-07')
  const resources = ['dumbbell', 'bench', 'bands', 'floor_space'] as const
  let draft = enableTemplateProgramming({
    ...source.draft, goalKind: 'hybrid', goalLabel: 'Balanced fitness', location: '', practiceDays: [],
    priorities: ['aerobic_base', 'max_strength'], resources: [...resources], equipment: equipmentForResources(resources),
    recommendedSetup: { ...source.draft.recommendedSetup!, mode: 'assisted', goalText: 'Build balanced fitness' },
  })
  draft = stageCustomExercises(draft, [CUSTOM])
  draft = selectProgramExercises(draft, ['goblet-squat', 'dumbbell-bench-press', 'dumbbell-row', CUSTOM.id])
  return { ...source, sample: false, draft: normalizeRecommendedDraft({ ...draft, confirmed: true }) }
}

function customSession(state: CampaignState, id = CUSTOM.id) {
  const session = state.weeks.at(-1)!.plan.sessions.find(item => item.kind === 'workout'
    && item.blocks.some(block => block.unit === 'reps' && block.exerciseId === id))
  assert.ok(session?.kind === 'workout', 'The custom exercise must appear in the saved calendar, not only in the catalog')
  const index = session.blocks.findIndex(block => block.unit === 'reps' && block.exerciseId === id)
  const block = session.blocks[index]
  assert.ok(block.unit === 'reps')
  return { session, index, block }
}

test('approved custom exercises are deterministic, scheduled, guided and durably logged', () => {
  const setup = prepared()
  let state = buildCampaign(setup)
  assert.deepEqual(state, buildCampaign(setup))
  assert.ok(programmingChoices(setup.draft).some(item => item.exercise.id === CUSTOM.id))
  const { session, index, block } = customSession(state)
  assert.equal(block.suggestedWeightKg, undefined)
  const exercise = state.weeks[0].input.library.exercises.find(item => item.id === CUSTOM.id)!
  const guidance = exerciseGuidance(exercise, { customExercise: CUSTOM })
  assert.equal(guidance.description, CUSTOM.description)
  assert.deepEqual(guidance.focus, [CUSTOM.focus])
  assert.equal(guidance.why, CUSTOM.why)
  assert.throws(() => exerciseGuidance(exercise), /saved definition/)
  state = logCampaignBlockSet(state, session.id, index, 0, { weight: '0', reps: String(block.reps), effort: '6' })
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(state))), state)
  state = completeCampaignSession(state, session.id, session.durationMin, 4, false)
  const next = nextCampaignWeek(state)
  assert.deepEqual(next.weeks[0], state.weeks[0])
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(next))), next)
  assert.ok(next.weeks[1].input.library.exercises.some(item => item.id === CUSTOM.id))
})

test('revising a custom movement requires a new identity and never rewrites old records', () => {
  let state = buildCampaign(prepared())
  const { session, index, block } = customSession(state)
  state = logCampaignBlockSet(state, session.id, index, 0, { weight: '3', reps: String(block.reps), effort: '6' })
  state = completeCampaignSession(state, session.id, session.durationMin, 4, false)
  const forged = structuredClone(state.draft)
  forged.program!.customExercises = [{ ...CUSTOM, focus: 'Different execution under the old identity' }]
  assert.throws(() => nextCampaignWeek(state, forged), /Saved custom exercise/)
  const revised = { ...CUSTOM, id: 'custom-band-bracing-revision', name: 'Revised band bracing', focus: 'Keep the heel nearer the body.' }
  let draft = stageCustomExercises(state.draft, [revised])
  draft = selectProgramExercises(draft, draft.recommendedSetup!.exerciseIds.map(id => id === CUSTOM.id ? revised.id : id))
  const next = nextCampaignWeek(state, { ...draft, confirmed: true })
  assert.deepEqual(next.weeks[0], state.weeks[0])
  assert.deepEqual(campaignDraftForWeek(next, 0).program!.customExercises, [CUSTOM])
  assert.equal(customSession(next, revised.id).block.suggestedWeightKg, undefined)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(next))), next)
})

test('unused custom definitions survive equipment changes without implying that gear is available', () => {
  const state = buildCampaign(prepared())
  const resources = ['dumbbell', 'bench', 'floor_space'] as const
  let draft: CampaignDraft = {
    ...state.draft, resources: [...resources], equipment: equipmentForResources(resources),
  }
  draft = selectProgramExercises(draft, draft.recommendedSetup!.exerciseIds.map(id => id === CUSTOM.id ? 'dead-bug' : id))
  const next = nextCampaignWeek(state, { ...draft, confirmed: true })
  assert.deepEqual(next.draft.program!.customExercises, [CUSTOM])
  assert.ok(!programmingChoices(next.draft).some(item => item.exercise.id === CUSTOM.id))
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(next))), next)
})

test('backup restore rejects forged custom library content and missing approved definitions', () => {
  const state = buildCampaign(prepared())
  const forged = structuredClone(state)
  const custom = forged.weeks[0].input.library.exercises.find(item => item.id === CUSTOM.id)!
  custom.name = 'Forged library name'
  assert.throws(() => parseCampaign(forged))
  const removed = structuredClone(state)
  removed.draft.program!.customExercises = []
  assert.throws(() => parseCampaign(removed))
})
