import assert from 'node:assert/strict'
import test from 'node:test'
import type { Session, SessionLog, WorkoutSession } from '../../engine/types.ts'
import { adaptCampaign, buildCampaign, exampleCampaign, nextCampaignWeek, parseCampaign } from './model.ts'
import { buildWeekReview } from './week-review.ts'

function fixture() {
  const initial = exampleCampaign('2026-09-07')
  const state = buildCampaign({ ...initial, draft: { ...initial.draft, confirmed: true } })
  const base = {
    date: '2026-09-07', startTime: '18:00', durationMin: 30, predictedLoad: { systemic: 1, structural: 1 },
    reason: 'Planned context', pinned: false, isCalibration: false,
  }
  const workout: WorkoutSession = {
    ...base, id: 'partial-workout', kind: 'workout', discipline: 'strength', modality: 'lifting', label: 'Strength A',
    blocks: [
      { unit: 'reps', exerciseId: 'push-up', sets: 3, reps: 8, targetRPE: 6, role: 'anchor', executionStyle: 'controlled' },
      { unit: 'seconds', exerciseId: 'dumbbell-farmer-carry', sets: 2, seconds: 20, role: 'carry', executionStyle: 'controlled' },
      { unit: 'seconds', exerciseId: 'standing-calf-stretch', sets: 1, seconds: 20, role: 'mobility', executionStyle: 'controlled' },
      { unit: 'throws', drillId: 'dodgeball-controlled-target-throw', throws: 30, intent: 'controlled_technique', embedded: true },
    ],
  }
  const run = (id: string): Session => ({
    ...base, id, kind: 'run', discipline: 'run', modality: 'run_road',
    endurancePrescription: { intent: 'easy', effort: 'conversational' },
  })
  const log = (sessionId: string, status: SessionLog['status']): SessionLog => ({ sessionId, status, painFlag: false, notes: '' })
  state.weeks[0].plan = {
    ...state.weeks[0].plan,
    sessions: [workout, run('complete-unknown'), run('unlogged')],
    omitted: [{ sessionId: 'omitted-lift', reason: 'No feasible placement.' }],
  }
  state.weeks[0].removed = [run('removed-run'), run('time-skip'), run('fatigue-skip')]
  state.weeks[0].logs = {
    'partial-workout': {
      ...log('partial-workout', 'partial'), actualDurationMin: 45, actualEffort: 7, painFlag: true, notes: 'Reported shoulder discomfort.',
      blockLogs: [
        { unit: 'reps', blockIndex: 0, exerciseId: 'push-up', sets: [
          { exerciseId: 'push-up', weightKg: 0, reps: 5, actualRPE: 6.5 },
          { exerciseId: 'push-up', weightKg: 2, reps: 4, actualRPE: 7 },
        ] },
        { unit: 'seconds', blockIndex: 1, exerciseId: 'dumbbell-farmer-carry', seconds: 12, weightKg: 16 },
        { unit: 'seconds', blockIndex: 2, exerciseId: 'standing-calf-stretch', seconds: 8 },
        { unit: 'throws', blockIndex: 3, drillId: 'dodgeball-controlled-target-throw', throws: 11 },
      ],
    },
    'complete-unknown': log('complete-unknown', 'completed'),
    'time-skip': { ...log('time-skip', 'skipped'), skipReason: 'life' },
    'fatigue-skip': { ...log('fatigue-skip', 'skipped'), skipReason: 'too_tired' },
    'not-in-week': { ...log('not-in-week', 'completed'), notes: 'UNRELATED LOG SECRET' },
  }
  return state
}

test('one-week review counts explicit outcomes, removals and omissions without inferring completion', () => {
  const state = fixture()
  const before = structuredClone(state)
  const review = buildWeekReview(state)!
  assert.deepEqual(review.counts, {
    completed: 1, partial: 1, skipped: 2, skippedTime: 1, skippedFatigue: 1,
    removed: 1, unlogged: 1, omitted: 1,
  })

  assert.deepEqual(review.omitted, [{ sessionId: 'omitted-lift', reason: 'No feasible placement.' }])
  assert.equal(review.sessions.some(item => item.id === 'omitted-lift'), false)
  assert.equal(review.weekIndex, 0)
  assert.equal(review.weekStart, '2026-09-07')
  assert.doesNotMatch(JSON.stringify(review), /UNRELATED LOG SECRET|predictedLoad|calibration|residual|setDrafts/)
  assert.deepEqual(buildWeekReview(state), review)
  assert.deepEqual(state, before)
})

test('actual calendar skips remain time or fatigue skips through deletion, restore and archival', () => {
  for (const reason of ['life', 'too_tired'] as const) {
    const initial = exampleCampaign('2026-09-07')
    let state = buildCampaign({ ...initial, draft: { ...initial.draft, confirmed: true } })
    const skipped = state.weeks[0].plan.sessions.find(session => !session.pinned)!
    state = parseCampaign(adaptCampaign(state, { type: 'skip', sessionId: skipped.id, reason }))
    assert.ok(state.weeks[0].removed.some(session => session.id === skipped.id))
    const deleted = state.weeks[0].plan.sessions.find(session => !session.pinned)!
    state = parseCampaign(adaptCampaign(state, { type: 'delete', sessionId: deleted.id }))
    const review = buildWeekReview(state)!
    assert.equal(review.counts.skipped, 1)
    assert.equal(review.counts.skippedTime, Number(reason === 'life'))
    assert.equal(review.counts.skippedFatigue, Number(reason === 'too_tired'))
    assert.equal(review.counts.removed, state.weeks[0].removed.length - 1)
    assert.equal(review.sessions.find(session => session.id === skipped.id)?.status, 'skipped')
    assert.equal(review.sessions.find(session => session.id === skipped.id)?.skipReason, reason)
    assert.equal(review.sessions.find(session => session.id === deleted.id)?.status, 'removed')
    assert.deepEqual(buildWeekReview(parseCampaign(JSON.parse(JSON.stringify(state)))), review)
    assert.deepEqual(buildWeekReview(parseCampaign(nextCampaignWeek(state)), 0), review)
  }
})

test('review preserves actual partial sets, loads, RPE, timed work, throws and overruns exactly', () => {
  const state = fixture()
  const review = buildWeekReview(state)!
  const partial = review.sessions.find(item => item.id === 'partial-workout')!
  assert.equal(partial.status, 'partial')
  assert.equal(partial.actualDurationMin, 45)
  assert.equal(partial.durationOverrunMin, 15)
  assert.equal(partial.actualEffort, 7)
  assert.equal(partial.painFlag, true)
  assert.equal(partial.notes, 'Reported shoulder discomfort.')
  assert.deepEqual(partial.blockLogs?.[0], state.weeks[0].logs['partial-workout'].blockLogs?.[0])
  assert.deepEqual(partial.blockLogs?.[1], { unit: 'seconds', blockIndex: 1, exerciseId: 'dumbbell-farmer-carry', seconds: 12, weightKg: 16 })
  assert.deepEqual(partial.blockLogs?.[2], { unit: 'seconds', blockIndex: 2, exerciseId: 'standing-calf-stretch', seconds: 8, weightKg: null })
  assert.deepEqual(partial.blockLogs?.[3], state.weeks[0].logs['partial-workout'].blockLogs?.[3])
  assert.equal(partial.sets, null)
  assert.equal(partial.plannedBlocks?.length, 4)
})

test('unknown actuals stay null even after completion; missing pain flags and notes are not fabricated', () => {
  const review = buildWeekReview(fixture())!
  for (const id of ['complete-unknown', 'unlogged', 'removed-run', 'time-skip']) {
    const session = review.sessions.find(item => item.id === id)!
    for (const key of ['actualDurationMin', 'actualEffort', 'durationOverrunMin', 'sets', 'blockLogs'] as const) {
      assert.equal(session[key], null, `${id}.${key}`)
    }
  }
  const unknown = review.sessions.find(item => item.id === 'unlogged')!
  assert.equal(Object.hasOwn(unknown, 'painFlag'), false)
  assert.equal(Object.hasOwn(unknown, 'notes'), false)
  assert.equal(review.sessions.find(item => item.id === 'complete-unknown')?.painFlag, false)
})

test('legacy logged sets and explicit zero observations remain actual values, not inferred targets', () => {
  const state = fixture()
  state.weeks[0].logs['complete-unknown'] = {
    ...state.weeks[0].logs['complete-unknown'], actualDurationMin: 0, actualEffort: 0,
    sets: [{ exerciseId: 'push-up', weightKg: 0, reps: 3, actualRPE: 6 }],
  }
  const session = buildWeekReview(state)!.sessions.find(item => item.id === 'complete-unknown')!
  assert.equal(session.actualDurationMin, 0)
  assert.equal(session.actualEffort, 0)
  assert.equal(session.durationOverrunMin, 0)
  assert.deepEqual(session.sets, state.weeks[0].logs['complete-unknown'].sets)
})

test('default review is latest, explicit index is exact, and no history produces no review', () => {
  const state = fixture()
  const next = structuredClone(state.weeks[0])
  next.plan.weekIndex = 1
  next.plan.weekStart = '2026-09-14'
  next.logs['partial-workout'].notes = 'LATEST ONLY'
  state.weeks.push(next)
  assert.match(JSON.stringify(buildWeekReview(state)), /LATEST ONLY/)
  assert.doesNotMatch(JSON.stringify(buildWeekReview(state, 0)), /LATEST ONLY/)
  assert.equal(buildWeekReview(state)?.weekIndex, 1)
  assert.throws(() => buildWeekReview(state, 10), /existing week/)
  assert.equal(buildWeekReview(exampleCampaign('2026-09-07')), undefined)
})
