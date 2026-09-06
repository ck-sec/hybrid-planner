import assert from 'node:assert/strict'
import test from 'node:test'
import { adaptCampaign, buildCampaign, campaignDraftForWeek, completeCampaignSession, exampleCampaign, logCampaignSet, nextCampaignWeek, parseCampaign } from './model.ts'
import type { CampaignDraft, CampaignState } from './types.ts'

function campaign(): CampaignState {
  const state = exampleCampaign('2026-09-07')
  return buildCampaign({ ...state, sample: false, draft: { ...state.draft, confirmed: true } })
}

function revisedDraft(state: CampaignState): CampaignDraft {
  return {
    ...state.draft,
    recommendedSetup: { ...state.draft.recommendedSetup!, exerciseIds: ['split-squat', 'dumbbell-row', 'push-up', 'dead-bug'] },
  }
}

test('a reviewed exercise revision starts next week and preserves previous prescriptions and actuals', () => {
  let state = campaign()
  const session = state.weeks[0].plan.sessions.find(item => item.kind === 'strength')
  assert.ok(session && session.kind === 'strength')
  state = logCampaignSet(state, session.id, session.strengthPrescription[0].exerciseId, 0, { weight: '0', reps: '8', effort: '6' })
  state = completeCampaignSession(state, session.id, session.durationMin, 4, false)
  const before = structuredClone(state)
  const draft = revisedDraft(state)
  const next = nextCampaignWeek(state, draft)
  assert.deepEqual(next.weeks[0], before.weeks[0])
  assert.deepEqual(state, before)
  assert.equal(next.selectedWeek, 1)
  assert.deepEqual(next.revisions, [{ weekIndex: 0, draft: before.draft }, { weekIndex: 1, draft }])
  assert.deepEqual(campaignDraftForWeek(next, 0), before.draft)
  assert.deepEqual(campaignDraftForWeek(next, 1), draft)
  assert.ok(next.weeks[1].input.context.recentSessions.some(item => item.session.id === session.id && item.log?.status === 'completed'))
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(next))), next)
  assert.deepEqual(parseCampaign(nextCampaignWeek(next)), nextCampaignWeek(next))
})

test('exercise revisions cannot reset health holds, fatigue reductions or unfinished logs', () => {
  const state = campaign()
  const session = state.weeks[0].plan.sessions.find(item => item.kind === 'strength')
  assert.ok(session && session.kind === 'strength')
  const partial = logCampaignSet(state, session.id, session.strengthPrescription[0].exerciseId, 0, { weight: '0', reps: '8', effort: '6' })
  assert.throws(() => nextCampaignWeek(partial, revisedDraft(partial)), /in-progress/)
  const held = completeCampaignSession(state, session.id, session.durationMin, 5, true)
  assert.throws(() => nextCampaignWeek(held, revisedDraft(held)), /health hold|Pain/)
  const tired = adaptCampaign(state, { type: 'skip', sessionId: session.id, reason: 'too_tired' })
  const normalNext = nextCampaignWeek(tired)
  const revisedNext = nextCampaignWeek(tired, revisedDraft(tired))
  assert.deepEqual(revisedNext.weeks[1].input.context.recentSessions, normalNext.weeks[1].input.context.recentSessions)
  assert.deepEqual(revisedNext.weeks[1].input.athlete.residual, normalNext.weeks[1].input.athlete.residual)
  assert.ok(revisedNext.weeks[1].plan.warnings.some(warning => /fatigue/i.test(warning)))
  assert.deepEqual(parseCampaign(revisedNext), revisedNext)
})

test('revision validation rejects hidden baseline increases, reordered history and forged revision dates', () => {
  const state = campaign()
  assert.throws(() => nextCampaignWeek(state, { ...revisedDraft(state), liftDurationMin: 180 }), /Revision/)
  assert.throws(() => nextCampaignWeek(state, { ...revisedDraft(state), practiceDuration: 180 }), /Revision/)
  assert.throws(() => nextCampaignWeek(state, { ...revisedDraft(state), confirmed: false }), /Confirm/)
  const next = nextCampaignWeek(state, revisedDraft(state))
  assert.throws(() => parseCampaign({ ...next, revisions: [...next.revisions!].reverse() }), /original setup|ascending/)
  assert.throws(() => parseCampaign({ ...next, revisions: [{ weekIndex: 0, draft: state.draft }] }), /explicit change/)
  assert.throws(() => parseCampaign({ ...next, draft: state.draft }), /Latest reviewed setup/)
  const forged = structuredClone(next)
  forged.weeks[0].input.athlete.recommendedExerciseIds = ['split-squat']
  assert.throws(() => parseCampaign(forged))
})
