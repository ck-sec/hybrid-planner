import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Baseline, Day, PlannerInput } from '../engine/legacy/types.ts'
import {
  addWeek, boundaryForWeek, emptyState, exportBackupText, MAX_BACKUP_BYTES,
  parseAppState, parseBackupText, planForInput, updateLog,
} from './state.ts'
import type { AppState, SavedWeek } from './state.ts'

function baseline(days: Day[] = [0, 1, 2, 3, 4, 5, 6]): Baseline {
  return {
    weeklyRunMinutes: 60, longestRunMinutes: 60, runsPerWeek: 1, liftsPerWeek: 1,
    availableDays: days,
    exercises: [{ name: 'Established squat', sets: 2, reps: 5, loadKg: 0 }],
  }
}

function independentWeek(weekStart: string, days: Day[]): SavedWeek {
  return {
    weekStart,
    input: { baseline: baseline(days), boundary: { previousSundayLift: false, nextMondayLift: false } },
    logs: {},
  }
}

function firstSessionId(state: AppState): string {
  const week = state.weeks[0]
  assert.ok(week)
  const session = planForInput(week.input).sessions[0]
  assert.ok(session)
  return session.id
}

test('an empty backup and generated history round-trip using only frozen input and logs', () => {
  assert.deepEqual(parseBackupText(exportBackupText(emptyState())), emptyState())
  const saved = addWeek(emptyState(), '2026-08-31', baseline())
  const logged = updateLog(saved, '2026-08-31', firstSessionId(saved), { status: 'completed', notes: 'Felt comfortable.' })
  const text = exportBackupText(logged)
  assert.deepEqual(parseBackupText(text), logged)
  assert.equal(text.includes('"sessions"'), false)
  assert.equal(text.includes('"audit"'), false)
  assert.equal(text.includes('"revision"'), false)
})

test('generation and log edits preserve all historical inputs and other logs', () => {
  const initial = addWeek(emptyState(), '2025-12-29', baseline())
  const id = firstSessionId(initial)
  const withLog = updateLog(initial, '2025-12-29', id, { status: 'skipped', notes: 'Rest instead.' })
  const before = exportBackupText(withLog)
  const later = addWeek(withLog, '2026-01-12', { ...baseline(), weeklyRunMinutes: 40 })
  assert.equal(exportBackupText(withLog), before)
  assert.deepEqual(later.weeks[0], withLog.weeks[0])
  assert.equal(later.baseline?.weeklyRunMinutes, 40)
  const laterWeek = later.weeks[1]
  assert.ok(laterWeek)
  const laterSession = planForInput(laterWeek.input).sessions[0]
  assert.ok(laterSession)
  const laterLog = updateLog(later, '2026-01-12', laterSession.id, { status: 'completed', notes: 'Unchanged template.' })
  const edited = updateLog(laterLog, '2025-12-29', id, { status: 'completed', notes: 'Corrected entry.' })
  assert.deepEqual(edited.weeks[0]?.input, initial.weeks[0]?.input)
  assert.deepEqual(edited.weeks[1], laterLog.weeks[1])
  assert.equal(withLog.weeks[0]?.logs[id]?.status, 'skipped')
  assert.equal(edited.weeks[0]?.logs[id]?.status, 'completed')
})

test('duplicate generation cannot overwrite a week or destroy its logs', () => {
  const state = addWeek(emptyState(), '2026-08-31', baseline())
  const logged = updateLog(state, '2026-08-31', firstSessionId(state), { status: 'skipped', notes: 'Kept.' })
  const before = exportBackupText(logged)
  assert.throws(() => addWeek(logged, '2026-08-31', baseline([0])), /already saved/)
  assert.equal(exportBackupText(logged), before)
  assert.throws(() => parseAppState({ ...logged, weeks: [...logged.weeks, ...logged.weeks] }), /Duplicate/)
})

test('neighbor boundaries use planned lifts even when logged skipped, not stale frozen flags', () => {
  const previous = addWeek(emptyState(), '2026-08-31', baseline([6]))
  const week = previous.weeks[0]
  assert.ok(week)
  assert.ok(planForInput(week.input).sessions.some(session => session.day === 6 && session.kind === 'lift'))
  const skipped = updateLog(previous, week.weekStart, firstSessionId(previous), { status: 'skipped', notes: '' })
  assert.deepEqual(boundaryForWeek('2026-09-07', skipped.weeks), { previousSundayLift: true, nextMondayLift: false })
  const following = addWeek(skipped, '2026-09-07', baseline([0, 2]))
  const followingWeek = following.weeks[1]
  assert.ok(followingWeek)
  assert.equal(followingWeek.input.boundary.previousSundayLift, true)
  assert.equal(planForInput(followingWeek.input).sessions.some(session => session.day === 0 && session.kind === 'lift'), false)
  assert.deepEqual(parseAppState(following), following)
  assert.deepEqual(boundaryForWeek('2026-09-21', following.weeks), { previousSundayLift: false, nextMondayLift: false })
})

test('adding an earlier week respects next Monday without rewriting later frozen input', () => {
  const later = addWeek(emptyState(), '2026-09-07', baseline([0, 1]))
  const before = exportBackupText(later)
  assert.equal(boundaryForWeek('2026-08-31', later.weeks).nextMondayLift, true)
  const earlier = addWeek(later, '2026-08-31', baseline([6]))
  const newWeek = earlier.weeks[1]
  assert.ok(newWeek)
  assert.equal(newWeek.input.boundary.nextMondayLift, true)
  assert.equal(planForInput(newWeek.input).sessions.some(session => session.kind === 'lift' && session.day === 6), false)
  assert.deepEqual(earlier.weeks[0], later.weeks[0])
  assert.equal(exportBackupText(later), before)
  assert.deepEqual(parseAppState(earlier), earlier)
})

test('backup validation checks all actual adjacent plans, including unsorted year boundaries', () => {
  const unsafe: AppState = {
    ...emptyState(),
    baseline: baseline(),
    weeks: [
      independentWeek('2026-08-31', [2]),
      independentWeek('2026-01-05', [0]),
      independentWeek('2025-12-29', [6]),
    ],
  }
  assert.throws(() => parseAppState(unsafe), /unsafe/i)
  assert.throws(() => parseBackupText(JSON.stringify(unsafe)), /unsafe/i)
  const safe = { ...unsafe, weeks: [independentWeek('2025-12-29', [6]), independentWeek('2026-01-12', [0])] }
  assert.deepEqual(parseAppState(safe), safe)
})

test('safe neighboring plans need not have matching historical boundary flags', () => {
  const safe: AppState = {
    ...emptyState(),
    baseline: baseline(),
    weeks: [independentWeek('2026-08-31', [6]), independentWeek('2026-09-07', [2])],
  }
  assert.equal(safe.weeks[1]?.input.boundary.previousSundayLift, false)
  assert.deepEqual(parseAppState(safe), safe)
})

test('malformed, unsupported, oversized and duplicate backups are rejected without mutations', () => {
  const saved = addWeek(emptyState(), '2026-08-31', baseline())
  const before = exportBackupText(saved)
  const week = saved.weeks[0]
  assert.ok(week)
  const cases: unknown[] = [
    null, [], {}, { ...saved, schemaVersion: 2 }, { ...saved, engineVersion: '9.0.0' },
    { ...saved, weeks: {} }, { ...saved, weeks: new Array(521).fill(week) },
    { ...saved, baseline: { ...baseline(), weeklyRunMinutes: '60' } },
    { ...saved, weeks: [{ ...week, weekStart: '2026-09-06' }] },
    { ...saved, weeks: [{ ...week, weekStart: '2026-02-30' }] },
    { ...saved, weeks: [{ ...week, input: { ...week.input, boundary: { previousSundayLift: 'false', nextMondayLift: false } } }] },
    { ...saved, weeks: [{ ...week, logs: [] }] },
    { ...saved, weeks: [{ ...week, plan: { sessions: [] } }] },
    { ...saved, extra: true },
  ]
  for (const value of cases) assert.throws(() => parseAppState(value))
  assert.throws(() => parseBackupText('{ broken JSON'), /not valid JSON/)
  assert.throws(() => parseBackupText(' '.repeat(MAX_BACKUP_BYTES + 1)), /too large/)
  assert.equal(exportBackupText(saved), before)
})

test('logs reject unknown status, nonexistent or omitted IDs, oversized notes and unsupported fields', () => {
  const saved = addWeek(emptyState(), '2026-08-31', baseline([6]))
  const week = saved.weeks[0]
  assert.ok(week)
  const id = firstSessionId(saved)
  const invalid = [
    { status: 'done', notes: '' }, { status: 'completed', notes: null },
    { status: 'skipped', notes: 'x'.repeat(2001) }, { status: 'completed', notes: '', extra: true },
  ]
  for (const value of invalid) {
    assert.throws(() => updateLog(saved, week.weekStart, id, value))
    assert.throws(() => parseAppState({ ...saved, weeks: [{ ...week, logs: { [id]: value } }] }))
  }
  for (const unknownId of ['unknown', '__proto__', 'constructor', ...planForInput(week.input).omitted.map(session => session.id)]) {
    assert.throws(() => updateLog(saved, week.weekStart, unknownId, { status: 'skipped', notes: '' }))
    assert.throws(() => parseBackupText(JSON.stringify({ ...saved, weeks: [{ ...week, logs: { [unknownId]: { status: 'skipped', notes: '' } } }] })))
  }
  assert.throws(() => updateLog(saved, '2026-09-07', id, { status: 'completed', notes: '' }), /no longer exists/)
  const maxNotes = updateLog(saved, week.weekStart, id, { status: 'skipped', notes: 'x'.repeat(2000) })
  assert.deepEqual(parseAppState(maxNotes), maxNotes)
})

test('blank and non-finite workload values cannot become generated plans', () => {
  for (const value of ['', null, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => addWeek(emptyState(), '2026-08-31', { ...baseline(), weeklyRunMinutes: value }))
  }
})

test('plan memoization shares deterministic results without exporting plan output', () => {
  const input: PlannerInput = { baseline: baseline(), boundary: { previousSundayLift: false, nextMondayLift: false } }
  assert.equal(planForInput(input), planForInput(structuredClone(input)))
})
