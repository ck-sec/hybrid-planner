import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHandoff, parseHandoffReply } from './handoff.ts'
import { buildCampaign, confirmSetupEquipment, emptyCampaign, exampleCampaign, normalizeRecommendedDraft, parseCampaign } from './model.ts'
import { applySetupProposal } from './setup-proposal.ts'
import { RESOURCE_PRESETS } from './equipment.ts'

const scope = { purpose: 'interpret_goal' as const }

test('confirming equipment uses the expanded library by default without AI or invented observations', t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Equipment confirmation is local'))
  for (const preset of RESOURCE_PRESETS) {
    const original = emptyCampaign('2026-09-07')
    const before = structuredClone(original)
    const next = confirmSetupEquipment(original, preset.resources)
    assert.equal(next.draft.program?.libraryVersion, 'exercise-profiles-1')
    assert.ok(next.draft.recommendedSetup!.exerciseIds.length >= 4)
    assert.deepEqual(next.draft.exercises, [])
    assert.equal(next.draft.weeklyRunMinutes, 0)
    assert.equal(next.draft.confirmed, false)
    assert.deepEqual(next.weeks, [])
    assert.deepEqual(parseCampaign(next), next)
    assert.deepEqual(confirmSetupEquipment(original, preset.resources), next)
    assert.deepEqual(original, before)
  }
})

test('the standard pre-goal handoff includes equipped kettlebells before any optional switch', () => {
  let state = confirmSetupEquipment(emptyCampaign('2026-09-07'), ['kettlebell', 'floor_space', 'carry_space'])
  state = { ...state, step: 1, draft: { ...state.draft, eventDate: '2026-12-04', recommendedSetup: {
    ...state.draft.recommendedSetup!, mode: 'assisted', goalText: 'Dodgeball worlds in Bangkok; I like kettlebells.',
  } } }
  const handoff = buildHandoff(state, scope)
  assert.equal(handoff.context.catalog.label, 'Expanded exercise library')
  assert.equal(handoff.context.catalog.maximumSelection, 7)
  assert.ok(handoff.context.allowedCatalog.some(item => item.id === 'kettlebell-goblet-squat'))
  assert.ok(handoff.context.allowedCatalog.some(item => item.id === 'kettlebell-suitcase-carry'))
  assert.equal(handoff.context.goal.date, '2026-12-04')
  const proposal = { ...handoff.example.proposal!, goalKind: 'dodgeball' as const, label: 'Dodgeball worlds', location: 'Bangkok' }
  const next = applySetupProposal(state, proposal, 'interpret_goal', '2026-12-04')
  assert.equal(next.draft.program?.goal, 'dodgeball')
  assert.equal(next.draft.eventDate, '2026-12-04')
  assert.equal(next.draft.weeklyRunMinutes, 0)
  assert.deepEqual(parseCampaign(next), next)
})

test('unfinished old drafts upgrade explicitly and invalidate their older AI reply', () => {
  const original = exampleCampaign('2026-09-07')
  const old = buildHandoff(original, scope)
  const next = confirmSetupEquipment(original, ['dumbbell', 'floor_space', 'kettlebell'])
  assert.equal(original.draft.program, undefined)
  assert.equal(next.draft.goalLabel, original.draft.goalLabel)
  assert.equal(next.draft.eventDate, original.draft.eventDate)
  assert.equal(next.draft.recommendedSetup!.goalText, original.draft.recommendedSetup!.goalText)
  assert.equal(next.draft.weeklyRunMinutes, original.draft.weeklyRunMinutes)
  assert.throws(() => parseHandoffReply(JSON.stringify(old.example), next, scope), /changed|old|different|match/i)
})

test('expanded equipment confirmation preserves chosen variants and modality baselines', () => {
  const original = confirmSetupEquipment(exampleCampaign('2026-09-07'), ['kettlebell', 'floor_space', 'carry_space', 'rower'])
  const draft = normalizeRecommendedDraft({ ...original.draft, program: {
    ...original.draft.program!, conditioningBaselines: [{ modality: 'row', weeklyMinutes: 20, longestSessionMinutes: 20, sessionsPerWeek: 1 }],
  } })
  const next = confirmSetupEquipment({ ...original, draft }, draft.resources!)
  assert.deepEqual(next.draft.program, draft.program)
})

test('equipment confirmation cannot rewrite existing weeks or assume absent supports', () => {
  const sample = exampleCampaign('2026-09-07')
  const committed = buildCampaign({ ...sample, draft: { ...sample.draft, confirmed: true } })
  const before = structuredClone(committed)
  assert.throws(() => confirmSetupEquipment(committed, ['kettlebell', 'floor_space']), /next-week revision/)
  assert.deepEqual(committed, before)
  assert.throws(() => confirmSetupEquipment({ ...committed, setupComplete: false }, ['floor_space']), /next-week revision/)
  assert.throws(() => confirmSetupEquipment(emptyCampaign('2026-09-07'), []), /Resources/)
})

test('refining an unchanged goal preserves the explicitly selected programming emphasis', () => {
  let state = confirmSetupEquipment(exampleCampaign('2026-09-07'), ['floor_space', 'kettlebell'])
  state = { ...state, draft: { ...state.draft, program: { ...state.draft.program!, goal: 'strength' } } }
  const proposal = buildHandoff(state, scope).example.proposal!
  const next = applySetupProposal(state, proposal, 'interpret_goal', state.draft.eventDate)
  assert.equal(next.draft.program?.goal, 'strength')
})
