import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateBlock } from './block.ts'
import { adaptCalendarWeek, calendarSafety, followingCommitments, nextCalendarInput } from './calendar.ts'
import type { CalendarWeek } from './calendar.ts'
import { DEFAULT_LIBRARY } from './library.ts'
import { planWeek } from './planner.ts'
import type { AthleteState, PlanWeekInput, Session } from './types.ts'

function fixture(): CalendarWeek {
  const athlete: AthleteState = {
    baseline: { asOf: '2026-09-07', weeklyRunMinutes: 90, longestRunMinutes: 30, runsPerWeek: 3, liftsPerWeek: 2, liftDurationMin: 45,
      exercises: [{ exerciseId: 'back-squat', date: '2026-09-01', weightKg: 40, sets: 5, reps: 5, actualRPE: 7, experienceMonths: 24 }] },
    calibration: { version: 1, costMultiplier: 1, observationCount: 0 }, availableDays: [0, 1, 2, 3, 4, 5, 6],
    equipment: ['barbell'], weeklyTimeBudgetMin: 400, defaultStartTime: '07:00', aggressiveness: 'conservative',
    residual: { asOfDate: '2026-09-07', asOfTime: '00:00', load: { systemic: 0, structural: 0 } }, safetyHold: null,
  }
  const block = generateBlock(athlete, {
    label: 'Court competition', peakDate: '2026-11-29', qualityBias: ['power', 'aerobic_base'], protectedExerciseIds: [],
    fixedCommitments: [1, 3].map((day, index) => ({
      id: `practice-${index}`, label: 'Court practice', dayOfWeek: day as 1 | 3, durationMin: 90,
      startTime: '19:00', discipline: 'sport', modality: 'court_sport', estimatedLoad: { systemic: 360, structural: 270 },
    })),
  }, '2026-09-07', DEFAULT_LIBRARY)
  const input: PlanWeekInput = {
    athlete, block, weekIndex: 0, library: DEFAULT_LIBRARY,
    context: { recentSessions: [], completedWeeks: [], neighboringSessions: [], pinnedSessions: [] },
  }
  input.context = { ...input.context, neighboringSessions: followingCommitments(input) }
  return { input, plan: planWeek(input), logs: {}, removed: [], changes: [] }
}
const optionalMinutes = (sessions: readonly Session[]): number =>
  sessions.filter(session => session.kind !== 'commitment').reduce((sum, session) => sum + session.durationMin, 0)

test('calendar move is deterministic and immutable, preserving an exact new pin', () => {
  const week = fixture()
  const first = week.plan.sessions.find(session => session.kind === 'run')!
  const before = JSON.stringify(week)
  const action = { type: 'move' as const, sessionId: first.id, date: first.date, startTime: '08:00' }
  const adapted = adaptCalendarWeek(week, action)
  assert.deepEqual(adaptCalendarWeek(week, action), adapted)
  assert.equal(JSON.stringify(week), before)
  assert.equal(adapted.plan.sessions.find(session => session.id === first.id)?.startTime, '08:00')
  assert.equal(adapted.plan.sessions.find(session => session.id === first.id)?.pinned, true)
  assert.equal(adapted.plan.safety.passed, true)
})

test('an entirely future week permits moving Thursday earlier to Monday', () => {
  const week = fixture()
  const target = week.plan.sessions.find(session => session.date === '2026-09-10' && session.kind !== 'commitment')!
  assert.ok(target)
  const action = { type: 'move' as const, sessionId: target.id, date: '2026-09-07', startTime: '08:00' }
  const result = adaptCalendarWeek(week, action)
  assert.deepEqual(adaptCalendarWeek(week, action, '2026-09-07'), result)
  assert.equal(result.plan.sessions.find(session => session.id === target.id)?.date, '2026-09-07')
  assert.equal(result.plan.safety.passed, true)
  assert.deepEqual(result.plan.sessions.filter(session => session.kind === 'commitment'),
    week.plan.sessions.filter(session => session.kind === 'commitment'))
})

test('explicit current-date boundary vetoes editing the past and preserves earlier placements and logged records', () => {
  const week = fixture()
  const target = week.plan.sessions.find(session => session.date === '2026-09-10' && session.kind !== 'commitment')!
  const past = week.plan.sessions.find(session => session.date === '2026-09-07')!
  const locked = week.plan.sessions.filter(session => session.kind !== 'commitment' && session.id !== target.id && session.id !== past.id)
  locked.forEach((session, index) => {
    week.logs[session.id] = { sessionId: session.id, status: index % 2 ? 'completed' : 'partial', actualDurationMin: 10, actualEffort: 4, painFlag: false, notes: '' }
  })
  const before = JSON.stringify(week)
  const action = { type: 'move' as const, sessionId: target.id, date: '2026-09-09', startTime: '08:00' }
  const result = adaptCalendarWeek(week, action, '2026-09-09')
  for (const session of week.plan.sessions.filter(session => session.date < '2026-09-09' || locked.includes(session))) {
    assert.deepEqual(result.plan.sessions.find(item => item.id === session.id), session)
  }
  assert.deepEqual(result.logs, week.logs)
  assert.equal(JSON.stringify(week), before)
  assert.throws(() => adaptCalendarWeek(week, { ...action, date: '2026-09-08' }, '2026-09-09'), /past-date boundary/)
  for (const action of [
    { type: 'move' as const, sessionId: past.id, date: '2026-09-10', startTime: '08:00' },
    { type: 'skip' as const, sessionId: past.id, reason: 'life' as const },
    { type: 'delete' as const, sessionId: past.id },
  ]) assert.throws(() => adaptCalendarWeek(week, action, '2026-09-09'), /Past sessions/)
  assert.throws(() => adaptCalendarWeek(week, action, 'not-a-date'), /date/i)
})

test('fatigue reduces future optional work but time skips do not reduce retained prescriptions', () => {
  const week = fixture()
  const target = week.plan.sessions.find(session => session.kind === 'run')!
  const time = adaptCalendarWeek(week, { type: 'skip', sessionId: target.id, reason: 'life' })
  const fatigue = adaptCalendarWeek(week, { type: 'skip', sessionId: target.id, reason: 'too_tired' })
  assert.ok(optionalMinutes(fatigue.plan.sessions) < optionalMinutes(time.plan.sessions))
  for (const session of time.plan.sessions) {
    const old = week.plan.sessions.find(item => item.id === session.id)!
    assert.equal(session.durationMin, old.durationMin)
    if (session.kind === 'strength' && old.kind === 'strength') assert.deepEqual(session.strengthPrescription, old.strengthPrescription)
  }
  assert.deepEqual(fatigue.plan.sessions.filter(session => session.kind === 'commitment'), week.plan.sessions.filter(session => session.kind === 'commitment'))
  assert.equal(time.logs[target.id]?.skipReason, 'life')
  assert.equal(fatigue.logs[target.id]?.skipReason, 'too_tired')
})

test('time and fatigue skips leave the cancelled interval empty of new optional work', () => {
  for (const reason of ['life', 'too_tired'] as const) {
    const week = fixture()
    const target = week.plan.sessions.find(session => session.kind === 'run')!
    const adapted = adaptCalendarWeek(week, { type: 'skip', sessionId: target.id, reason })
    assert.ok(!adapted.plan.sessions.some(session => session.kind !== 'commitment'
      && session.date === target.date && session.startTime === target.startTime))
    assert.deepEqual(adapted.plan.sessions.filter(session => session.kind === 'commitment'),
      week.plan.sessions.filter(session => session.kind === 'commitment'))
  }
})

test('repeat edits preserve every skipped interval and reject explicit optional moves into them', () => {
  let week = fixture()
  const first = week.plan.sessions.find(session => session.kind === 'run')!
  week = adaptCalendarWeek(week, { type: 'skip', sessionId: first.id, reason: 'life' })
  const second = week.plan.sessions.find(session => session.kind === 'run')!
  week = adaptCalendarWeek(week, { type: 'skip', sessionId: second.id, reason: 'life' })
  const target = week.plan.sessions.find(session => session.kind === 'strength')!
  week = adaptCalendarWeek(week, { type: 'move', sessionId: target.id, date: target.date, startTime: '08:00' })
  for (const removed of [first, second]) {
    assert.ok(!week.plan.sessions.some(session => session.kind !== 'commitment'
      && session.date === removed.date && session.startTime === removed.startTime))
    assert.throws(() => adaptCalendarWeek(week, {
      type: 'move', sessionId: target.id, date: removed.date, startTime: removed.startTime!,
    }), /marked unavailable/)
  }
})

test('skipped intervals respect duration, overnight overlap and conservative unknown-time days', () => {
  const initial = fixture()
  const skipped = initial.plan.sessions.find(session => session.kind === 'run')!
  let week = adaptCalendarWeek(initial, { type: 'skip', sessionId: skipped.id, reason: 'life' })
  const target = week.plan.sessions.find(session => session.kind === 'strength')!
  assert.throws(() => adaptCalendarWeek(week, {
    type: 'move', sessionId: target.id, date: skipped.date, startTime: '07:10',
  }), /marked unavailable/)
  const after = adaptCalendarWeek(week, { type: 'move', sessionId: target.id, date: skipped.date, startTime: '07:18' })
  assert.equal(after.plan.sessions.find(session => session.id === target.id)?.startTime, '07:18')
  const overnight = { ...initial, plan: { ...initial.plan, sessions: initial.plan.sessions.map(session =>
    session.id === skipped.id ? { ...session, startTime: '23:50' } : session) } }
  week = adaptCalendarWeek(overnight, { type: 'skip', sessionId: skipped.id, reason: 'life' })
  assert.throws(() => adaptCalendarWeek(week, {
    type: 'move', sessionId: target.id, date: '2026-09-08', startTime: '00:00',
  }), /marked unavailable/)
  const unknown = { ...initial, plan: { ...initial.plan, sessions: initial.plan.sessions.map(session =>
    session.id === skipped.id ? { ...session, startTime: null } : session) } }
  week = adaptCalendarWeek(unknown, { type: 'skip', sessionId: skipped.id, reason: 'life' })
  assert.ok(week.plan.sessions.every(session => session.kind === 'commitment' || session.date !== skipped.date))
  assert.throws(() => adaptCalendarWeek(week, {
    type: 'move', sessionId: target.id, date: skipped.date, startTime: '20:00',
  }), /marked unavailable/)
})

test('date cutoff freezes earlier work and completed/partial future work', () => {
  const week = fixture()
  const target = week.plan.sessions.find(session => session.kind === 'strength')!
  const locked = week.plan.sessions.filter(session => session.kind !== 'commitment' && session.date >= target.date && session.id !== target.id)
  locked.forEach((session, index) => {
    week.logs[session.id] = { sessionId: session.id, status: index % 2 ? 'completed' : 'partial', actualDurationMin: 10, actualEffort: 4, painFlag: false, notes: '' }
  })
  const adapted = adaptCalendarWeek(week, { type: 'skip', sessionId: target.id, reason: 'too_tired' })
  for (const session of week.plan.sessions.filter(session => session.date < target.date || locked.includes(session))) {
    assert.deepEqual(adapted.plan.sessions.find(item => item.id === session.id), session)
  }
  assert.deepEqual(Object.fromEntries(locked.map(session => [session.id, adapted.logs[session.id]])),
    Object.fromEntries(locked.map(session => [session.id, week.logs[session.id]])))
  if (locked[0]) assert.throws(() => adaptCalendarWeek(adapted, { type: 'delete', sessionId: locked[0]!.id }), /partially logged/)
})

test('unsafe move into a fixed pin rejects without mutating the original', () => {
  const week = fixture()
  const run = week.plan.sessions.find(session => session.kind === 'run')!
  const fixed = week.plan.sessions.find(session => session.kind === 'commitment')!
  const before = JSON.stringify(week)
  assert.throws(() => adaptCalendarWeek(week, { type: 'move', sessionId: run.id, date: fixed.date, startTime: fixed.startTime! }), /Move rejected.*overlap/)
  assert.equal(JSON.stringify(week), before)
  assert.throws(() => adaptCalendarWeek(week, { type: 'move', sessionId: run.id, date: '2026-09-14', startTime: '08:00' }), /inside/)
})

test('explicit commitment move/delete preserves stable other fixed IDs and recurring template', () => {
  const week = fixture()
  const fixed = week.plan.sessions.filter(session => session.kind === 'commitment')
  const moved = adaptCalendarWeek(week, { type: 'move', sessionId: fixed[0]!.id, date: '2026-09-09', startTime: '19:00' })
  assert.equal(moved.plan.sessions.find(session => session.id === fixed[0]!.id)?.date, '2026-09-09')
  assert.deepEqual(moved.plan.sessions.find(session => session.id === fixed[1]!.id), fixed[1])
  const deleted = adaptCalendarWeek(week, { type: 'delete', sessionId: fixed[0]!.id })
  assert.deepEqual(deleted.plan.sessions.find(session => session.id === fixed[1]!.id), fixed[1])
  assert.deepEqual(deleted.input.block, week.input.block)
  assert.equal(calendarSafety(deleted.input, deleted.plan.sessions, deleted.logs).passed, true)
})

test('skipped and deleted tombstones never reappear during later rescoring', () => {
  let week = fixture()
  const first = week.plan.sessions.find(session => session.kind === 'run')!
  week = adaptCalendarWeek(week, { type: 'skip', sessionId: first.id, reason: 'life' })
  const second = week.plan.sessions.find(session => session.kind === 'run')!
  week = adaptCalendarWeek(week, { type: 'delete', sessionId: second.id })
  const final = week.plan.sessions.find(session => session.kind === 'strength')!
  week = adaptCalendarWeek(week, { type: 'move', sessionId: final.id, date: final.date, startTime: '08:00' })
  assert.ok(!week.plan.sessions.some(session => [first.id, second.id].includes(session.id)))
  assert.ok(week.removed.some(session => session.id === first.id))
  assert.ok(week.removed.some(session => session.id === second.id))
  assert.ok(!week.plan.feasibility.fits)
  assert.ok(week.plan.feasibility.issues.length)
})

test('next-week fatigue cap persists without modifying observations or ordinary skip calibration', () => {
  const original = fixture()
  const target = original.plan.sessions.find(session => session.kind === 'run')!
  const time = adaptCalendarWeek(original, { type: 'skip', sessionId: target.id, reason: 'life' })
  const tired = adaptCalendarWeek(original, { type: 'skip', sessionId: target.id, reason: 'too_tired' })
  const timeInput = nextCalendarInput([time])
  const tiredInput = nextCalendarInput([tired])
  assert.deepEqual(tiredInput.athlete.baseline, original.input.athlete.baseline)
  assert.deepEqual(tiredInput.athlete.calibration, original.input.athlete.calibration)
  assert.ok(optionalMinutes(planWeek(tiredInput).sessions) < optionalMinutes(planWeek(timeInput).sessions))
  const tiredNext: CalendarWeek = { input: tiredInput, plan: planWeek(tiredInput), logs: {}, removed: [], changes: [] }
  const following = nextCalendarInput([tired, tiredNext])
  assert.ok(following.block.phases.every(phase => phase.volumeFraction <= 0.48))
  assert.ok(tiredInput.context.recentSessions.some(record => record.log?.skipReason === 'too_tired'))
  assert.ok(tiredInput.context.neighboringSessions.length)
})

test('actual recovery residual carries once and health holds reach the next week', () => {
  const week = fixture()
  const last = week.plan.sessions.at(-1)!
  week.logs[last.id] = { sessionId: last.id, status: 'completed', actualDurationMin: 35, actualEffort: 5, painFlag: true, notes: '' }
  const next = nextCalendarInput([week])
  assert.equal(next.athlete.residual.asOfDate, '2026-09-14')
  assert.ok(next.athlete.residual.load.structural > 0)
  assert.equal(next.athlete.safetyHold?.reason, 'pain')
  assert.equal(next.context.completedWeeks.length, 0, 'Unlogged sessions are not completed-week evidence')
  assert.ok(planWeek(next).sessions.every(session => session.kind === 'commitment'))
})
