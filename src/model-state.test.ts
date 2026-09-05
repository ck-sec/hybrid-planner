import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AthleteState, Goal, Session, SessionLog } from '../engine/types.ts'
import { planWeek } from '../engine/planner.ts'
import { addWeek, emptyState as emptyLegacy, exportBackupText as exportLegacy, planForInput, updateLog } from './state.ts'
import { contextForWeek, emptyState, exportBackupText, inputForWeek, modelWeekKey, parseAppState, parseBackupText, planForModelInput, previewForModelInput, saveModelWeek, startBlock, updateModelLog } from './model-state.ts'
import type { AppState } from './model-state.ts'

function athlete(): AthleteState {
  return {
    baseline: {
      asOf: '2026-09-01', weeklyRunMinutes: 60, longestRunMinutes: 35, runsPerWeek: 2,
      liftsPerWeek: 1, liftDurationMin: 45,
      exercises: [{ exerciseId: 'back-squat', date: '2026-09-01', weightKg: 40, sets: 3, reps: 5, actualRPE: 8, experienceMonths: 24 }],
    },
    calibration: { version: 1, costMultiplier: 1, observationCount: 0 },
    availableDays: [0, 2, 4, 6], equipment: ['barbell'],
    weeklyTimeBudgetMin: 300, defaultStartTime: '18:00', aggressiveness: 'standard',
    residual: { asOfDate: '2026-09-07', asOfTime: '00:00', load: { systemic: 0, structural: 0 } },
    safetyHold: null,
  }
}

const goal: Goal = {
  label: 'Established autumn training', peakDate: '2026-11-01', qualityBias: ['aerobic_base'],
  protectedExerciseIds: ['back-squat'], fixedCommitments: [],
}

function blockState(person = athlete(), start = '2026-09-07'): AppState {
  return startBlock(emptyState(), person, goal, start, true)
}

function savedState(): AppState {
  const state = blockState()
  return saveModelWeek(state, inputForWeek(state, 0), true)
}

function completed(session: Session): SessionLog {
  return { sessionId: session.id, status: 'completed', actualDurationMin: session.durationMin, actualEffort: 3, painFlag: false, notes: '  My exact note\nNo rewritten history.  ' }
}

test('schema 1 migrates only in memory and preserves Monday-zero input and historical logs exactly', () => {
  let archive = addWeek(emptyLegacy(), '2026-08-31', {
    weeklyRunMinutes: 30, longestRunMinutes: 30, runsPerWeek: 1, liftsPerWeek: 1,
    availableDays: [0, 6], exercises: [{ name: '  Own squat ', sets: 2, reps: 5, loadKg: 40 }],
  })
  const id = planForInput(archive.weeks[0].input).sessions[0].id
  archive = updateLog(archive, '2026-08-31', id, { status: 'skipped', notes: '  exact\nuser note  ' })
  const original = exportLegacy(archive)
  const upgraded = parseBackupText(original)
  assert.equal(upgraded.schemaVersion, 2)
  assert.equal(exportLegacy(upgraded.legacy), original)
  assert.equal(exportLegacy(archive), original)
  assert.deepEqual(upgraded.legacy.weeks[0].input.baseline.availableDays, [0, 6])
  assert.deepEqual(upgraded.modelWeeks, [])
  assert.equal(upgraded.athlete, null)
  assert.equal(exportLegacy(parseBackupText(exportBackupText(upgraded)).legacy), original)
})

test('schema 2 validates exact fields and all engine, policy and library versions', () => {
  const state = savedState()
  const unchanged = JSON.stringify(state)
  assert.deepEqual(parseBackupText(exportBackupText(state)), state)
  assert.throws(() => parseAppState({ ...state, unsupported: true }), /unsupported fields/)
  assert.throws(() => parseAppState({ ...state, engineVersion: '9.0.0' }), /Unsupported engine/)
  for (const field of ['engineVersion', 'policyVersion', 'libraryVersion']) {
    const bad = structuredClone(state)
    Object.assign(bad.blockHistory[0], { [field]: 'unsupported' })
    assert.throws(() => parseAppState(bad), /version|supported/i)
  }
  const nested = structuredClone(state)
  Object.assign(nested.modelWeeks[0].input.athlete.baseline, { readiness: 99 })
  assert.throws(() => parseAppState(nested), /unknown field/)
  const modifiedLibrary = structuredClone(state)
  Object.assign(modifiedLibrary.modelWeeks[0].input.library.exercises[0].coefficients, { systemic: 1 })
  assert.throws(() => parseAppState(modifiedLibrary), /library/i)
  assert.equal(JSON.stringify(state), unchanged)
  const learned = structuredClone(state)
  learned.athlete!.calibration.costMultiplier = 1.2
  learned.athlete!.calibration.observationCount = 10
  assert.deepEqual(parseAppState(learned).athlete?.calibration, learned.athlete?.calibration)
  learned.athlete!.calibration.costMultiplier = 1.5
  assert.throws(() => parseAppState(learned), /costMultiplier/)
})

test('creating new blocks and logging retain immutable original model inputs, anchors and logs', () => {
  let state = savedState()
  const week = state.modelWeeks[0]
  const originalInput = JSON.stringify(week.input)
  const originalBlock = JSON.stringify(week.input.block)
  const session = planForModelInput(week.input).sessions[0]
  state = updateModelLog(state, modelWeekKey(week.input), completed(session))
  const logged = JSON.stringify(state.modelWeeks[0].logs)
  state = startBlock(state, athlete(), { ...goal, label: 'Second block' }, '2026-10-05', true)
  assert.equal(state.blockHistory.length, 2)
  assert.equal(JSON.stringify(state.blockHistory[0]), originalBlock)
  assert.equal(JSON.stringify(state.modelWeeks[0].input), originalInput)
  assert.equal(JSON.stringify(state.modelWeeks[0].logs), logged)
  assert.throws(() => saveModelWeek(state, week.input, true), /different block/)
  assert.deepEqual(parseBackupText(exportBackupText(state)), state)
})

test('duplicate weeks and unsafe independent neighboring imports are rejected without rewriting history', () => {
  const onlyLifts = athlete()
  onlyLifts.baseline = { ...onlyLifts.baseline, weeklyRunMinutes: 20, longestRunMinutes: 20, runsPerWeek: 1 }
  let left = blockState(onlyLifts)
  const first = inputForWeek(left, 0)
  const leftSession = planForModelInput(first).sessions.find(session => session.kind === 'strength')!
  left = saveModelWeek(left, inputForWeek(left, 0, undefined, [{ ...leftSession, date: '2026-09-13', startTime: '23:00', pinned: true }]), true)
  assert.throws(() => saveModelWeek(left, left.modelWeeks[0].input, true), /Duplicate/)

  let right = blockState(onlyLifts, '2026-09-14')
  const second = inputForWeek(right, 0)
  const rightSession = planForModelInput(second).sessions.find(session => session.kind === 'strength')!
  right = saveModelWeek(right, inputForWeek(right, 0, undefined, [{ ...rightSession, date: '2026-09-14', startTime: '06:00', pinned: true }]), true)
  const original = JSON.stringify(left)
  assert.throws(() => parseAppState({ ...right, blockHistory: [...left.blockHistory, ...right.blockHistory], modelWeeks: [...left.modelWeeks, ...right.modelWeeks] }), /neighbor|gap|conflict/i)
  assert.equal(JSON.stringify(left), original)
})

test('context uses only prior 14 days, fully accounted weeks, actual completed minutes and planned neighbors', () => {
  let state = savedState()
  const input = state.modelWeeks[0].input
  const sessions = planForModelInput(input).sessions
  assert.deepEqual(contextForWeek(state, input.block, 1).completedWeeks, [])
  for (const session of sessions) state = updateModelLog(state, modelWeekKey(input), completed(session))
  const next = inputForWeek(state, 1)
  assert.equal(next.context.recentSessions.length, sessions.length)
  assert.ok(next.context.recentSessions.every(item => item.session.date < '2026-09-14'))
  assert.equal(next.athlete.residual.asOfDate, next.context.recentSessions[0].session.date)
  assert.deepEqual(next.athlete.residual.load, { systemic: 0, structural: 0 })
  assert.equal(next.context.completedWeeks[0].runMinutes, sessions.filter(session => session.kind === 'run').reduce((sum, session) => sum + session.durationMin, 0))
  assert.equal(next.context.completedWeeks[0].plannedDeload, true)
  const nextMinutes = planForModelInput(next).sessions.filter(session => session.kind === 'run').reduce((sum, session) => sum + session.durationMin, 0)
  assert.equal(nextMinutes, athlete().baseline.weeklyRunMinutes * 0.9)
  const run = sessions.find(session => session.kind === 'run')!
  state = updateModelLog(state, modelWeekKey(input), { sessionId: run.id, status: 'skipped', skipReason: 'life', painFlag: false, notes: '' })
  const skipped = contextForWeek(state, input.block, 1)
  assert.equal(skipped.completedWeeks[0].disrupted, false)
  assert.equal(skipped.completedWeeks[0].runMinutes, next.context.completedWeeks[0].runMinutes - run.durationMin)
  assert.equal(skipped.recentSessions.find(item => item.session.id === run.id)?.log?.status, 'skipped')
  assert.equal(state.athlete?.safetyHold, null)
  assert.ok(planForModelInput(inputForWeek(state, 1)).sessions.some(session => session.kind === 'strength'))
  assert.equal(contextForWeek(state, input.block, 4).recentSessions.length, 0)
  assert.equal(contextForWeek(state, input.block, 0).recentSessions.length, 0)
  state = updateModelLog(state, modelWeekKey(input), { ...completed(run), status: 'partial' })
  assert.deepEqual(contextForWeek(state, input.block, 1).completedWeeks, [])
})

test('pins go through the engine again; positions persist without altering an existing saved week', () => {
  const state = blockState()
  const input = inputForWeek(state, 0)
  const plan = planForModelInput(input)
  const run = plan.sessions.find(session => session.kind === 'run')!
  const pinned = inputForWeek(state, 0, undefined, [{ ...run, startTime: '09:00', pinned: true }])
  const preview = planForModelInput(pinned)
  assert.deepEqual(preview, planWeek(pinned))
  assert.equal(preview.sessions.find(session => session.id === run.id)?.startTime, '09:00')
  assert.notEqual(JSON.stringify(pinned), JSON.stringify(input))
  const saved = saveModelWeek(state, pinned, true)
  assert.equal(saved.modelWeeks[0].input.context.pinnedSessions[0].startTime, '09:00')
  assert.deepEqual(planForModelInput(saved.modelWeeks[0].input), preview)
  assert.equal(state.modelWeeks.length, 0)
})

test('pain and illness hold generation until explicit rebaseline; flags and history are not auto-cleared', () => {
  let state = savedState()
  const input = state.modelWeeks[0].input
  const session = planForModelInput(input).sessions[0]
  const key = modelWeekKey(input)
  state = updateModelLog(state, key, { ...completed(session), painFlag: true })
  assert.equal(state.athlete?.safetyHold?.reason, 'pain')
  const heldPlan = planForModelInput(inputForWeek(state, 1))
  assert.equal(heldPlan.sessions.filter(item => item.kind !== 'commitment').length, 0)
  assert.throws(() => saveModelWeek(state, inputForWeek(state, 1), true), /hold/)
  state = updateModelLog(state, key, completed(session))
  assert.equal(state.athlete?.safetyHold?.reason, 'pain')
  assert.throws(() => startBlock(state, athlete(), goal, '2026-09-14', false), /Confirm/)
  assert.throws(() => startBlock(state, athlete(), goal, '2026-09-14', true), /after/)
  const sameDay = athlete()
  sameDay.baseline = { ...sameDay.baseline, asOf: session.date }
  assert.throws(() => startBlock(state, sameDay, goal, '2026-09-14', true), /after/)
  state = updateModelLog(state, key, { sessionId: session.id, status: 'skipped', skipReason: 'illness', painFlag: false, notes: 'Keep illness note.' })
  const oldInput = JSON.stringify(state.modelWeeks[0].input)
  const oldLogs = JSON.stringify(state.modelWeeks[0].logs)
  const newAthlete = athlete()
  newAthlete.baseline = { ...newAthlete.baseline, asOf: '2026-09-14' }
  state = startBlock(state, newAthlete, goal, '2026-09-14', true)
  assert.equal(state.athlete?.safetyHold, null)
  assert.equal(JSON.stringify(state.modelWeeks[0].input), oldInput)
  assert.equal(JSON.stringify(state.modelWeeks[0].logs), oldLogs)
  const fresh = inputForWeek(state, 0)
  assert.ok(fresh.context.recentSessions.some(item => item.log?.skipReason === 'illness'))
  assert.ok(planForModelInput(fresh).sessions.some(item => item.kind === 'run'))
})

test('logs validate session and exercise associations, status, unknown fields and persistent hold integrity', () => {
  const state = savedState()
  const input = state.modelWeeks[0].input
  const session = planForModelInput(input).sessions[0]
  const key = modelWeekKey(input)
  assert.throws(() => updateModelLog(state, key, { ...completed(session), unknown: true }), /unknown/)
  assert.throws(() => updateModelLog(state, key, { ...completed(session), sessionId: 'missing' }), /scheduled/)
  assert.throws(() => updateModelLog(state, key, { ...completed(session), status: 'skipped' }), /skipReason/)
  const invalid = structuredClone(state)
  invalid.modelWeeks[0].logs[session.id] = { ...completed(session), painFlag: true }
  assert.throws(() => parseAppState(invalid), /hold/)
})

test('unsafe previews cannot be saved and safe omissions require explicit acknowledgement', () => {
  const person = athlete()
  person.availableDays = [0]
  const state = blockState(person)
  const input = inputForWeek(state, 0)
  const preview = planForModelInput(input)
  assert.equal(preview.safety.passed, true)
  assert.ok(preview.omitted.length > 0)
  assert.throws(() => saveModelWeek(state, input, false), /acknowledge omitted/)
  assert.equal(saveModelWeek(state, input, true).modelWeeks.length, 1)
  const badGoal: Goal = {
    ...goal,
    fixedCommitments: [{ id: 'fixed-sport', label: 'Own court practice', dayOfWeek: 1, startTime: '18:00', durationMin: 30, discipline: 'sport', modality: 'court_sport', estimatedLoad: { systemic: 100, structural: 100 } }],
  }
  const unsafeState = startBlock(emptyState(), person, badGoal, '2026-09-07', true)
  const unsafeInput = inputForWeek(unsafeState, 0)
  assert.equal(planForModelInput(unsafeInput).safety.passed, false)
  assert.throws(() => saveModelWeek(unsafeState, unsafeInput, true), /safety/)
  assert.equal(unsafeState.modelWeeks.length, 0)
})

test('future saved training is a neighbor only, never completed history or residual history', () => {
  let state = blockState()
  state = saveModelWeek(state, inputForWeek(state, 2), true)
  const future = state.modelWeeks[0]
  for (const session of planForModelInput(future.input).sessions) {
    state = updateModelLog(state, modelWeekKey(future.input), completed(session))
  }
  const earlier = inputForWeek(state, 1)
  assert.deepEqual(earlier.context.recentSessions, [])
  assert.deepEqual(earlier.context.completedWeeks, [])
  assert.ok(earlier.context.neighboringSessions.length > 0)
  assert.equal(earlier.athlete.residual.asOfDate, '2026-09-14')
})

test('baseline inputs stay literal; missing and blank numeric fields cannot invent workload', () => {
  const person = athlete()
  const invalid = structuredClone(person) as unknown as { baseline: Record<string, unknown> }
  invalid.baseline.weeklyRunMinutes = ''
  assert.throws(() => startBlock(emptyState(), invalid, goal, '2026-09-07', true), /weeklyRunMinutes/)
  assert.throws(() => startBlock(emptyState(), person, goal, '2026-09-08', true), /Monday/)
  assert.equal(emptyState().athlete, null)
})

test('unknown-time legacy lifts veto conflicting model previews and imports without inferred exercise loads', () => {
  const archive = addWeek(emptyLegacy(), '2026-08-31', {
    weeklyRunMinutes: 10, longestRunMinutes: 10, runsPerWeek: 1, liftsPerWeek: 1,
    availableDays: [6], exercises: [{ name: 'Own established lift', sets: 3, reps: 5, loadKg: 40 }],
  })
  const original = JSON.stringify(archive)
  const state = startBlock({ ...emptyState(), legacy: archive }, athlete(), goal, '2026-09-07', true)
  const base = inputForWeek(state, 0)
  assert.ok(!base.context.neighboringSessions.some(session => session.id.startsWith('legacy-')))
  assert.deepEqual(base.context.recentSessions, [])
  const lift = planForModelInput(base).sessions.find(session => session.kind === 'strength')!
  const candidate = inputForWeek(state, 0, undefined, [{ ...lift, date: '2026-09-07', startTime: '18:00', pinned: true }])
  const preview = previewForModelInput(state, candidate)
  assert.equal(preview.safety.passed, false)
  assert.ok(preview.safety.violations.some(issue => issue.rule === 'legacyBoundary'))
  assert.throws(() => saveModelWeek(state, candidate, true), /safety|version 0.1/i)
  assert.equal(JSON.stringify(state.legacy), original)
})

test('logging never auto-updates an explicit experimental multiplier or informational observation count', () => {
  const person = athlete()
  person.calibration = { version: 1, costMultiplier: 1.2, observationCount: 7 }
  let state = blockState(person)
  state = saveModelWeek(state, inputForWeek(state, 0), true)
  const week = state.modelWeeks[0]
  const session = planForModelInput(week.input).sessions[0]
  state = updateModelLog(state, modelWeekKey(week.input), { ...completed(session), actualEffort: 10 })
  assert.deepEqual(state.athlete?.calibration, person.calibration)
  assert.deepEqual(state.modelWeeks[0].input.athlete.calibration, person.calibration)
})

test('completed-week accounting excludes unknown durations and treats only health interruptions as disrupted', () => {
  let state = savedState()
  const input = state.modelWeeks[0].input
  const sessions = planForModelInput(input).sessions
  for (const session of sessions) state = updateModelLog(state, modelWeekKey(input), completed(session))
  const lift = sessions.find(session => session.kind === 'strength')!
  state = updateModelLog(state, modelWeekKey(input), { sessionId: lift.id, status: 'completed', painFlag: false, notes: 'Duration not recorded.' })
  assert.deepEqual(contextForWeek(state, input.block, 1).completedWeeks, [])
  for (const skipReason of ['life', 'weather', 'other', 'too_tired'] as const) {
    state = updateModelLog(state, modelWeekKey(input), { sessionId: lift.id, status: 'skipped', skipReason, painFlag: false, notes: '' })
    assert.equal(contextForWeek(state, input.block, 1).completedWeeks[0].disrupted, false)
    assert.equal(state.athlete?.safetyHold, null)
  }
  state = updateModelLog(state, modelWeekKey(input), { sessionId: lift.id, status: 'skipped', skipReason: 'illness', painFlag: false, notes: '' })
  assert.equal(contextForWeek(state, input.block, 1).completedWeeks[0].disrupted, true)
  assert.equal(state.athlete?.safetyHold?.reason, 'illness')
})

test('rebaseline refresh excludes a resolved health week even when observation precedes that week end', () => {
  let state = savedState()
  const input = state.modelWeeks[0].input
  const sessions = planForModelInput(input).sessions
  for (const session of sessions) state = updateModelLog(state, modelWeekKey(input), completed(session))
  const earlier = sessions.find(session => session.date < '2026-09-10')
  assert.ok(earlier)
  state = updateModelLog(state, modelWeekKey(input), { ...completed(earlier), painFlag: true })
  assert.equal(contextForWeek(state, input.block, 1).completedWeeks[0].disrupted, true)
  const baseline = athlete()
  baseline.baseline = { ...baseline.baseline, asOf: '2026-09-10' }
  const originalHistory = JSON.stringify(state.modelWeeks)
  state = startBlock(state, baseline, goal, '2026-09-14', true)
  const next = inputForWeek(state, 0)
  assert.deepEqual(next.context.completedWeeks, [])
  assert.ok(next.context.recentSessions.some(item => item.log?.painFlag))
  assert.ok(planForModelInput(next).sessions.some(session => session.kind === 'run'))
  assert.equal(JSON.stringify(state.modelWeeks), originalHistory)
})

test('completed run minutes include actual running-discipline fixed commitments', () => {
  const runningGoal: Goal = {
    ...goal,
    fixedCommitments: [{
      id: 'established-run', label: 'Established club run', dayOfWeek: 0, startTime: '06:00',
      durationMin: 10, discipline: 'run', modality: 'run_road', estimatedLoad: { systemic: 30, structural: 20 },
    }],
  }
  let state = startBlock(emptyState(), athlete(), runningGoal, '2026-09-07', true)
  state = saveModelWeek(state, inputForWeek(state, 0), true)
  const input = state.modelWeeks[0].input
  const sessions = planForModelInput(input).sessions
  const fixedRun = sessions.find(session => session.kind === 'commitment' && session.discipline === 'run')
  assert.ok(fixedRun)
  for (const session of sessions) {
    state = updateModelLog(state, modelWeekKey(input), {
      ...completed(session), actualDurationMin: session.id === fixedRun.id ? 12 : session.durationMin,
    })
  }
  const generatedMinutes = sessions.filter(session => session.kind === 'run').reduce((sum, session) => sum + session.durationMin, 0)
  assert.equal(contextForWeek(state, input.block, 1).completedWeeks[0].runMinutes, generatedMinutes + 12)
})

test('a prior-block taper remains a planned reduction rather than a normal-volume reference', () => {
  let state = blockState()
  const block = state.activeBlock!
  const taperIndex = block.phases.find(phase => phase.kind === 'taper')!.startWeekIndex
  state = saveModelWeek(state, inputForWeek(state, taperIndex), true)
  const input = state.modelWeeks[0].input
  assert.equal(planForModelInput(input).phase, 'taper')
  for (const session of planForModelInput(input).sessions) {
    state = updateModelLog(state, modelWeekKey(input), completed(session))
  }
  const nextAthlete = athlete()
  nextAthlete.baseline = { ...nextAthlete.baseline, asOf: '2026-11-02' }
  state = startBlock(state, nextAthlete, { ...goal, peakDate: '2026-12-27' }, '2026-11-02', true)
  const context = inputForWeek(state, 0).context
  assert.equal(context.completedWeeks.length, 1)
  assert.equal(context.completedWeeks[0].plannedDeload, true)
  assert.equal(context.completedWeeks[0].weekStart, planForModelInput(input).weekStart)
})
