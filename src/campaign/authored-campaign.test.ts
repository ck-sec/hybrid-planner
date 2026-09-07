import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAuthoredWeek } from '../../engine/authored-week.ts'
import type { AuthoredSessionProposal, AuthoredWorkoutBlock } from '../../engine/authored-week.ts'
import { proposalForSessions, refreshAuthoredCalendar } from './authored-calendar.ts'
import { swapChoices, swapWorkoutExercise } from './exercise-swaps.ts'
import { adaptCampaign, buildCampaign, completeCampaignSession, confirmSetupEquipment, emptyCampaign, logCampaignBlockSet, nextCampaignWeek, normalizeRecommendedDraft, parseCampaign } from './model.ts'
import { finishWithFeedback } from './training-feedback.ts'
import type { CampaignState } from './types.ts'

function strictAuthoredCampaign(state: CampaignState): CampaignState {
  const { pendingWeek, ...source } = state
  assert.ok(pendingWeek)
  const built = buildCampaign(source)
  const original = built.weeks[0]!
  const week = refreshAuthoredCalendar({
    ...original, authored: pendingWeek, plan: buildAuthoredWeek(original.input, pendingWeek),
  })
  return parseCampaign({ ...built, weeks: [week] })
}

function setup() {
  const state = confirmSetupEquipment(emptyCampaign('2026-09-07'), ['floor_space', 'dumbbell'])
  return {
    ...state, draft: normalizeRecommendedDraft({
      ...state.draft, runsPerWeek: 2, liftsPerWeek: 2, liftDurationMin: 45, confirmed: true,
      recommendedSetup: { ...state.draft.recommendedSetup!, typicalRunMinutes: 30 },
    }),
  }
}

function builtInState(warmed = false) {
  let built = buildCampaign(setup())
  if (warmed) {
    for (const session of built.weeks[0]!.plan.sessions) {
      if (session.kind !== 'workout') continue
      for (const [index, block] of session.blocks.entries()) {
        if (block.unit !== 'reps') continue
        for (let set = 0; set < block.sets; set++) built = logCampaignBlockSet(built, session.id, index, set, { weight: '10', reps: String(block.reps), effort: '6' })
      }
      built = completeCampaignSession(built, session.id, session.durationMin, 5, false)
    }
    built = nextCampaignWeek(built)
  }
  return built
}

function authoredState(warmed = false) {
  const built = builtInState(warmed)
  const week = built.weeks[built.selectedWeek]!
  const original = proposalForSessions(week.plan.weekStart, week.plan.sessions)
  const authored = warmed ? {
    ...original, sessions: original.sessions.map(session => {
      if (session.kind !== 'workout' || session.blocks[0]?.unit !== 'reps') return session
      return { ...session, blocks: [{ ...session.blocks[0], sets: 2 }, ...session.blocks.slice(1, -1)] }
    }),
  } : original
  const plan = buildAuthoredWeek(week.input, authored)
  assert.deepEqual(plan.safety.violations, [])
  return parseCampaign({ ...built, weeks: built.weeks.map((item, index) => index === built.selectedWeek ? refreshAuthoredCalendar({ ...week, authored, plan }) : item) })
}

test('a reviewed complete week survives creation, reload and strict backup validation', () => {
  const state = authoredState()
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(state))), state)
  const built = buildCampaign({ ...setup(), pendingWeek: state.weeks[0]!.authored })
  assert.ok(built.weeks[0]!.authored)
  assert.equal(built.pendingWeek, undefined)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(built))), built)
  const corrupt = structuredClone(state)
  const session = corrupt.weeks[0]!.plan.sessions.find(item => item.kind === 'workout')!
  assert.equal(session.kind, 'workout')
  session.durationMin += 1
  assert.throws(() => parseCampaign(corrupt), /prescription|derived|checked|authored/i)
})

test('an unstarted card can be swapped without retaining a different movement weight draft', () => {
  const state = authoredState()
  const session = state.weeks[0]!.plan.sessions.find(item => item.kind === 'workout')!
  assert.equal(session.kind, 'workout')
  const blockIndex = session.blocks.findIndex((_, index) => swapChoices(state, session.id, index).length > 0)
  assert.ok(blockIndex >= 0)
  const replacement = swapChoices(state, session.id, blockIndex)[0]!
  state.setDrafts[`${session.id}:block-${blockIndex}:0`] = { weight: '50', reps: '8', effort: '6' }
  const before = structuredClone(state)
  const next = swapWorkoutExercise(state, session.id, blockIndex, replacement.id, 'equipment', false)
  assert.deepEqual(state, before)
  assert.equal(next.setDrafts[`${session.id}:block-${blockIndex}:0`], undefined)
  assert.equal(next.weeks[0]!.authoredHistory!.length, 1)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(next))), next)
})

test('swapping remaining sets preserves actual identity and a finalized early finish can advance', () => {
  let state = authoredState(true)
  const weekIndex = state.selectedWeek
  const session = state.weeks[weekIndex]!.plan.sessions.find(item => item.kind === 'workout')!
  assert.equal(session.kind, 'workout')
  const index = session.blocks.findIndex((block, index) => block.unit === 'reps' && block.sets > 1 && swapChoices(state, session.id, index).length > 0)
  assert.ok(index >= 0)
  const block = session.blocks[index]!
  assert.equal(block.unit, 'reps')
  state = logCampaignBlockSet(state, session.id, index, 0, { weight: '10', reps: String(block.reps), effort: '6' })
  const logs = structuredClone(state.weeks[weekIndex]!.logs)
  const replacement = swapChoices(state, session.id, index)[0]!
  state = swapWorkoutExercise(state, session.id, index, replacement.id, 'preference', true)
  assert.deepEqual(state.weeks[weekIndex]!.logs, logs)
  state = finishWithFeedback(state, session.id, 20, 6, false, { version: 1, feeling: 'harder', outcome: 'finished_early' })
  assert.throws(() => swapWorkoutExercise(state, session.id, index, replacement.id, 'preference', true), /finished/i)
  const next = nextCampaignWeek(state)
  assert.deepEqual(next.weeks[weekIndex], state.weeks[weekIndex])
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(next))), next)
})

test('authored time skips stay unknown actuals, while pain holds cannot be cleared by swaps', () => {
  const state = authoredState()
  const run = state.weeks[0]!.plan.sessions.find(item => item.discipline === 'run')!
  const skipped = adaptCampaign(state, { type: 'skip', sessionId: run.id, reason: 'life' })
  assert.equal(skipped.weeks[0]!.logs[run.id]!.actualDurationMin, undefined)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(skipped))), skipped)
  const session = state.weeks[0]!.plan.sessions.find(item => item.kind === 'workout')!
  const held = completeCampaignSession(state, session.id, 20, 5, true)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(held))), held)
  assert.throws(() => nextCampaignWeek(held), /hold/i)
})

function twoRunWeek() {
  const run = (id: string, date: string): AuthoredSessionProposal => ({
    id, kind: 'run', label: 'Easy run', date, startTime: '07:00', durationMin: 20, modality: 'run_road', intent: 'easy',
  })
  return strictAuthoredCampaign({
    ...setup(),
    pendingWeek: { version: 1, weekStart: '2026-09-07', sessions: [run('run-a', '2026-09-07'), run('run-b', '2026-09-09')] },
  })
}

test('authored edits respect recorded overruns without rejecting honest logs or their restoration', () => {
  const state = completeCampaignSession(twoRunWeek(), 'run-a', 60, 5, false)
  const restored = parseCampaign(JSON.parse(JSON.stringify(state)))
  assert.equal(restored.weeks[0]!.logs['run-a']!.actualDurationMin, 60)
  assert.equal(restored.weeks[0]!.plan.safety.passed, false)
  const before = structuredClone(state)
  assert.throws(() => adaptCampaign(state, {
    type: 'move', sessionId: 'run-b', date: '2026-09-07', startTime: '07:30',
  }), /overlap|actual|volume/i)
  assert.deepEqual(state, before)
  const reduced = adaptCampaign(state, { type: 'delete', sessionId: 'run-b' })
  assert.deepEqual(reduced.weeks[0]!.plan.sessions.map(session => session.id), ['run-a'])
  assert.equal(reduced.weeks[0]!.logs['run-a']!.actualDurationMin, 60)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(reduced))), reduced)
})

test('authored moves reject actual time overlaps even when recorded volume remains within baseline', () => {
  const state = completeCampaignSession(twoRunWeek(), 'run-a', 25, 5, false)
  assert.equal(state.weeks[0]!.plan.safety.passed, true)
  assert.throws(() => adaptCampaign(state, {
    type: 'move', sessionId: 'run-b', date: '2026-09-07', startTime: '07:22',
  }), /overlap/i)
})

test('removed unperformed sessions free their slots but retain exact historical prescriptions', () => {
  const deleted = adaptCampaign(twoRunWeek(), { type: 'delete', sessionId: 'run-a' })
  const moved = adaptCampaign(deleted, { type: 'move', sessionId: 'run-b', date: '2026-09-07', startTime: '07:00' })
  const week = moved.weeks[0]!
  assert.deepEqual(week.plan.sessions.map(session => session.id), ['run-b'])
  assert.equal(week.plan.sessions[0]!.date, '2026-09-07')
  assert.equal(week.plan.sessions[0]!.startTime, '07:00')
  assert.deepEqual(week.removed, deleted.weeks[0]!.removed)
  assert.deepEqual(week.logs, {})
  assert.equal(week.plan.safety.passed, true)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(moved))), moved)
  const corrupt = structuredClone(moved)
  corrupt.weeks[0]!.removed[0]!.durationMin++
  assert.throws(() => parseCampaign(corrupt), /removed.*prescription/i)
})

test('restore cannot discard a removed identity and its fatigue history', () => {
  const skipped = adaptCampaign(twoRunWeek(), { type: 'skip', sessionId: 'run-a', reason: 'too_tired' })
  const corrupt = structuredClone(skipped)
  corrupt.weeks[0]!.removed = []
  delete corrupt.weeks[0]!.logs['run-a']
  assert.throws(() => parseCampaign(corrupt), /retain every approved identity/i)
})

test('partial overrun logs and corrections always retain persistable derived safety', () => {
  let state = strictAuthoredCampaign({
    ...setup(), pendingWeek: { version: 1, weekStart: '2026-09-07', sessions: [{
      id: 'partial-overrun', kind: 'workout', label: 'Familiar squat', date: '2026-09-07', startTime: '08:00', durationMin: 30,
      blocks: [{ unit: 'reps', exerciseId: 'bodyweight-squat', sets: 1, reps: 8, targetRPE: 6 }],
    }] },
  })
  for (let index = 0; index < 9; index++) {
    state = logCampaignBlockSet(state, 'partial-overrun', 0, index, { weight: '0', reps: '8', effort: '6' })
    assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(state))), state)
  }
  assert.equal(state.weeks[0]!.plan.safety.passed, false)
  state = logCampaignBlockSet(state, 'partial-overrun', 0, 0, { weight: '0', reps: '7', effort: '6' })
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(state))), state)
})

test('a lower-cost swap cannot hide an actual repetition overrun in its retained block', () => {
  const initial = confirmSetupEquipment(setup(), ['floor_space', 'dumbbell', 'bench'])
  let state = strictAuthoredCampaign({
    ...initial, draft: { ...initial.draft, confirmed: true }, pendingWeek: { version: 1, weekStart: '2026-09-07', sessions: [{
      id: 'quantity-bound', kind: 'workout', label: 'Familiar lifts', date: '2026-09-07', startTime: '08:00', durationMin: 45,
      blocks: ['goblet-squat', 'dumbbell-row', 'dumbbell-overhead-press', 'dumbbell-romanian-deadlift'].map((exerciseId): AuthoredWorkoutBlock => ({
        unit: 'reps', exerciseId, sets: 2, reps: 8, targetRPE: 6,
      })),
    }] },
  })
  state = logCampaignBlockSet(state, 'quantity-bound', 0, 0, { weight: '10', reps: '9', effort: '6' })
  const before = structuredClone(state)
  assert.throws(() => swapWorkoutExercise(state, 'quantity-bound', 0, 'bodyweight-squat', 'difficulty', false), /actual|quantity|repetition/i)
  assert.deepEqual(state, before)
})

test('built-in conversion preserves completed and removed records while swapping other work', () => {
  for (const action of ['complete', 'delete'] as const) {
    let state = buildCampaign(setup())
    const run = state.weeks[0]!.plan.sessions.find(session => session.discipline === 'run')!
    state = action === 'complete' ? completeCampaignSession(state, run.id, 20, 5, false)
      : adaptCampaign(state, { type: 'delete', sessionId: run.id })
    const before = structuredClone(state.weeks[0]!)
    const workout = before.plan.sessions.find(session => session.kind === 'workout')!
    assert.equal(workout.kind, 'workout')
    const blockIndex = workout.blocks.findIndex((_, index) => swapChoices(state, workout.id, index).length > 0)
    const replacement = swapChoices(state, workout.id, blockIndex)[0]!
    const swapped = swapWorkoutExercise(state, workout.id, blockIndex, replacement.id, 'equipment', false)
    assert.deepEqual(swapped.weeks[0]!.logs, before.logs)
    assert.deepEqual(swapped.weeks[0]!.removed, before.removed)
    if (action === 'complete') assert.deepEqual(swapped.weeks[0]!.plan.sessions.find(session => session.id === run.id), run)
    assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(swapped))), swapped)
  }
})

test('converting later built-in weeks retains historically supported suggestions on completed and removed workouts', () => {
  for (const action of ['complete', 'delete'] as const) {
    let state = builtInState(true)
    const index = state.selectedWeek
    const workout = state.weeks[index]!.plan.sessions.find(session => session.kind === 'workout')!
    assert.equal(workout.kind, 'workout')
    assert.ok(workout.blocks.some(block => block.unit === 'reps' && block.suggestedWeightKg === 10))
    state = action === 'complete' ? completeCampaignSession(state, workout.id, 20, 5, false)
      : adaptCampaign(state, { type: 'delete', sessionId: workout.id })
    const before = structuredClone(state.weeks[index]!)
    const other = before.plan.sessions.find(session => session.kind === 'workout' && session.id !== workout.id)!
    assert.equal(other.kind, 'workout')
    const blockIndex = other.blocks.findIndex((_, block) => swapChoices(state, other.id, block).length > 0)
    const replacement = swapChoices(state, other.id, blockIndex)[0]!
    const swapped = swapWorkoutExercise(state, other.id, blockIndex, replacement.id, 'equipment', false)
    assert.deepEqual(swapped.weeks[index]!.logs, before.logs)
    assert.deepEqual(swapped.weeks[index]!.removed, before.removed)
    if (action === 'complete') assert.deepEqual(swapped.weeks[index]!.plan.sessions.find(session => session.id === workout.id), workout)
    assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(swapped))), swapped)
    const moved = adaptCampaign(swapped, { type: 'move', sessionId: other.id, date: other.date, startTime: other.startTime! })
    assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(moved))), moved)
    const corrupt = structuredClone(swapped)
    const preserved = [...corrupt.weeks[index]!.plan.sessions, ...corrupt.weeks[index]!.removed].find(session => session.id === workout.id)!
    assert.equal(preserved.kind, 'workout')
    const block = preserved.blocks.find(block => block.unit === 'reps' && block.suggestedWeightKg !== undefined)!
    assert.equal(block.unit, 'reps')
    block.suggestedWeightKg = 99
    assert.throws(() => parseCampaign(corrupt), /prescription/i)
  }
})

test('converting a partially logged built-in workout retains its own historical weights, never the replacement weight', () => {
  let state = builtInState(true)
  const index = state.selectedWeek
  const workout = state.weeks[index]!.plan.sessions.find(session => session.kind === 'workout')!
  assert.equal(workout.kind, 'workout')
  const loggedBlock = workout.blocks[0]!
  assert.equal(loggedBlock.unit, 'reps')
  assert.equal(loggedBlock.suggestedWeightKg, 10)
  state = logCampaignBlockSet(state, workout.id, 0, 0, { weight: '10', reps: String(loggedBlock.reps), effort: '6' })
  const blockIndex = workout.blocks.findIndex((_, block) => block > 0 && swapChoices(state, workout.id, block).length > 0)
  assert.ok(blockIndex > 0)
  const replacement = swapChoices(state, workout.id, blockIndex)[0]!
  const swapped = swapWorkoutExercise(state, workout.id, blockIndex, replacement.id, 'equipment', false)
  const updated = swapped.weeks[index]!.plan.sessions.find(session => session.id === workout.id)!
  assert.equal(updated.kind, 'workout')
  assert.deepEqual(updated.blocks[0], loggedBlock)
  const changedBlock = updated.blocks[blockIndex]!
  assert.equal(changedBlock.unit, 'reps')
  assert.equal(changedBlock.suggestedWeightKg, undefined)
  assert.deepEqual(swapped.weeks[index]!.logs, state.weeks[index]!.logs)
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(swapped))), swapped)
})
