import assert from 'node:assert/strict'
import test from 'node:test'
import type { CompactWeekReview } from './compact-week-review.ts'
import { compactWeekReview } from './compact-week-review.ts'
import type { WeekReview, WeekReviewSession } from './week-review.ts'

function session(index: number, overrides: Partial<WeekReviewSession> = {}): WeekReviewSession {
  return {
    id: `session-${String(index).padStart(3, '0')}`,
    date: `2026-09-${String(7 + index % 7).padStart(2, '0')}`,
    kind: 'run', discipline: 'run', modality: 'run_road', label: null,
    status: 'completed', skipReason: null,
    plannedDurationMin: 30, actualDurationMin: null, actualEffort: null,
    feedback: null, actualPaceMinPerKm: null, durationOverrunMin: null,
    plannedEndurance: { intent: 'easy', effort: 'conversational' },
    plannedBlocks: null, plannedStrength: null, sets: null, blockLogs: null,
    ...overrides,
  }
}

function review(sessions: WeekReviewSession[], overrides: Partial<WeekReview> = {}): WeekReview {
  const count = (status: WeekReviewSession['status']) => sessions.filter(item => item.status === status).length
  return {
    version: 1, weekIndex: 0, weekStart: '2026-09-07',
    counts: {
      completed: count('completed'), finishedEarly: count('finished_early'),
      partial: count('partial'), skipped: count('skipped'),
      skippedTime: sessions.filter(item => item.status === 'skipped' && item.skipReason === 'life').length,
      skippedFatigue: sessions.filter(item => item.status === 'skipped' && item.skipReason === 'too_tired').length,
      removed: count('removed'), unlogged: count('unlogged'), omitted: 0,
    },
    sessions, observations: [], changes: [], omitted: [], ...overrides,
  }
}

const maxima = { normal: 0, minimal: 0 }
function size(value: CompactWeekReview): number {
  const length = JSON.stringify(value, null, 2).length
  maxima[value.detail] = Math.max(maxima[value.detail], length)
  return length
}

test('independent planned/actual totals preserve zero values, unknown partials and all statuses', () => {
  const source = review([
    session(0, { actualDurationMin: 0, actualEffort: 0, painFlag: false,
      sets: [{ exerciseId: 'lift', reps: 0, weightKg: 0, actualRPE: 6 }] }),
    session(1, { status: 'partial', painFlag: true }),
    session(2, { status: 'finished_early', feedback: { version: 1, feeling: 'harder', outcome: 'finished_early' } }),
    session(3, { status: 'skipped', skipReason: 'life' }),
    session(4, { status: 'skipped', skipReason: 'too_tired' }),
    session(5, { status: 'removed' }),
    session(6, { status: 'unlogged' }),
    session(7, { status: 'skipped', skipReason: 'pain' }),
    session(8, { status: 'skipped', skipReason: 'illness' }),
  ], { healthHold: { reason: 'pain', since: '2026-09-06' } })
  for (const detail of ['normal', 'minimal'] as const) {
    const compact = compactWeekReview(source, detail)
    assert.deepEqual(compact.counts, source.counts)
    assert.equal(compact.sessionCount, 9)
    assert.match(compact.planned, /min=270/)
    assert.match(compact.actual, /min=0\/1; lift setRows=1 reps=0\[0\] kg=0 RPE=6/)
    assert.match(compact.actual, /mobility=\?\/0 carry=\?\/0/)
    assert.match(compact.feedback, /effort=0\/1/)
    assert.match(compact.feedback, /harder=1 unknown=8/)
    assert.match(compact.feedback, /life=1,too_tired=1,pain=1,illness=1/)
    assert.match(compact.health, /painFlag yes=1 no=1 unknown=7; knownPain=2/)
    assert.match(compact.health, /2026-09-07:1,2026-09-08:1/)
    assert.match(compact.health, /hold=pain since 2026-09-06/)
    assert.match(compact.summarized, /\?=unknown.*missing remainder unknown/)
    assert.match(compact.summarized, /Feelings are not RPE.*no catch-up or health clearance/)
    assert.ok(size(compact) <= (detail === 'normal' ? 6_000 : 2_200))
    assert.deepEqual(compactWeekReview({ ...source, sessions: [...source.sessions].reverse() }, detail), compact)
  }
  const empty = compactWeekReview(review([session(1, { status: 'partial' })]), 'minimal')
  assert.match(empty.actual, /min=\?\/0; lift setRows=0 reps=\?\[\?\] kg=\? RPE=\?/)
})

test('timed mobility and carries keep independent prescribed and recorded seconds and actual load', () => {
  const source = review([session(0, {
    kind: 'workout', discipline: 'strength', modality: 'lifting',
    status: 'partial', actualDurationMin: 18, plannedEndurance: null,
    plannedBlocks: [
      { unit: 'reps', exerciseId: 'push-up', sets: 3, reps: 8, targetRPE: 6, role: 'anchor', executionStyle: 'controlled' },
      { unit: 'seconds', exerciseId: 'calf-stretch', sets: 2, seconds: 30, role: 'mobility', executionStyle: 'controlled' },
      { unit: 'seconds', exerciseId: 'loaded-carry', sets: 3, seconds: 20, role: 'carry', executionStyle: 'controlled' },
      { unit: 'throws', drillId: 'target', throws: 30, intent: 'controlled_technique', embedded: true },
    ],
    blockLogs: [
      { unit: 'reps', blockIndex: 0, exerciseId: 'push-up', sets: [
        { exerciseId: 'push-up', weightKg: 0, reps: 5, actualRPE: 6.5 },
        { exerciseId: 'push-up', weightKg: 2, reps: 4, actualRPE: 7 },
      ] },
      { unit: 'seconds', blockIndex: 1, exerciseId: 'calf-stretch', seconds: 8, weightKg: null },
      { unit: 'seconds', blockIndex: 2, exerciseId: 'loaded-carry', seconds: 12, weightKg: 16 },
      { unit: 'throws', blockIndex: 3, drillId: 'target', throws: 11 },
      { unit: 'seconds', blockIndex: 99, exerciseId: 'unmatched', seconds: 3, weightKg: 0 },
    ],
  })])
  for (const detail of ['normal', 'minimal'] as const) {
    const compact = compactWeekReview(source, detail)
    assert.match(compact.planned, /lift sets=3 reps=24; seconds mobility=60 carry=60; throws=30/)
    assert.match(compact.actual, /setRows=2 reps=9\[4\.\.5\] kg=0\.\.2 RPE=6.5\.\.7/)
    assert.match(compact.actual, /mobility=8\/1 carry=12\/1 unmatched=3\/1 timedKg=0\.\.16\/2; throws=11\/1/)
    assert.match(compact.byDiscipline.join('\n'), /strength\/lifting n=1 min P=30 A=18\/1/)
    assert.ok(size(compact) <= (detail === 'normal' ? 6_000 : 2_200))
  }
  const compact = compactWeekReview(source, 'normal')
  assert.match(compact.exercises!.join('\n'), /calf-stretch: sec P mobility=60 carry=0; A mobility=8 carry=\? unmatched=\? kg=\?/)
  assert.match(compact.exercises!.join('\n'), /loaded-carry: sec P mobility=0 carry=60; A mobility=\? carry=12 unmatched=\? kg=16/)
  assert.equal(compact.omissions.exercises, 0)
})

test('partial lift observations aggregate legacy sets without filling unlogged prescriptions', () => {
  const compact = compactWeekReview(review([session(0, {
    kind: 'strength', discipline: 'strength', modality: 'lifting', status: 'partial',
    plannedStrength: [
      { exerciseId: 'lift-a', sets: 3, reps: 8, targetRPE: 7, suggestedWeightKg: 40, role: 'anchor' },
      { exerciseId: 'lift-b', sets: 3, reps: 8, targetRPE: 7, role: 'accessory' },
    ],
    sets: [{ exerciseId: 'lift-a', weightKg: 12, reps: 3, actualRPE: 6 }],
  })]), 'normal')
  assert.match(compact.planned, /sets=6 reps=48/)
  assert.match(compact.actual, /setRows=1 reps=3\[3\] kg=12 RPE=6/)
  assert.match(compact.exercises!.join('\n'), /lift-b: P sets=3 reps=24; A setRows=0 reps=\?\[\?\] kg=\? RPE=\?/)
  assert.doesNotMatch(compact.actual, /40/)
})

test('excerpt accounting is exact and swap/future preference text is prioritized without mutation', () => {
  const longNote = `Pain was reported. ${'details '.repeat(100)} Still sore.`
  const change = `Swap old -> new: too difficult. ${'context '.repeat(80)} Prefer this replacement in future proposals.`
  const source = review([session(0, {
    notes: longNote,
    feedback: { version: 1, feeling: 'easier', outcome: 'finished', note: 'Felt easier, not clearance.' },
  })], {
    observations: ['Repeated observations', 'More prose'],
    omitted: [{ sessionId: 'not-placed', reason: 'No feasible placement.' }],
    changes: [
      { id: 'ordinary', message: 'Calendar updated.' },
      { id: 'preference', message: change },
      { id: 'extra', message: 'Third change.' },
    ],
  })
  const before = structuredClone(source)
  const compact = compactWeekReview(source, 'normal')
  assert.equal(compact.omissions.notes, 0)
  assert.equal(compact.omissions.noteChars, longNote.length - 100)
  assert.equal(compact.omissions.changes, 1)
  assert.equal(compact.omissions.changeChars, change.length - 140 + 'Third change.'.length)
  assert.equal(compact.omissions.observations, 2)
  assert.equal(compact.omissions.plannedOmissions, 1)
  assert.match(compact.changes![0], /Swap old -> new: too difficult/)
  assert.match(compact.changes![0], /Prefer this replacement in future proposals/)
  assert.match(compact.notes![0], new RegExp(`\\[${longNote.length - 100} chars omitted\\]`))
  assert.deepEqual(compactWeekReview(source, 'normal'), compact)
  assert.deepEqual(source, before)
  compact.counts.completed = 99
  assert.deepEqual(source, before)
})

function heavyReview(count: number): WeekReview {
  const sessions = Array.from({ length: count }, (_, index) => session(index, {
    id: `custom-session-${index}-${'x'.repeat(4_000)}`,
    kind: 'workout', discipline: 'strength', modality: 'lifting',
    status: index % 2 ? 'completed' : 'partial',
    actualDurationMin: index % 3 ? 42 : null, actualEffort: index % 2 ? 0 : 8,
    painFlag: index % 3 === 0,
    notes: `Pain note ${index}: ${'\n"\\'.repeat(2_000)} Keep original details locally.`,
    feedback: { version: 1, feeling: index % 2 ? 'harder' : 'as_expected', outcome: 'finished',
      note: 'Feedback '.repeat(300) },
    plannedEndurance: null,
    plannedBlocks: Array.from({ length: 32 }, (_, exercise) => ({
      unit: 'reps', exerciseId: `custom-${exercise}-${'y'.repeat(3_000)}`,
      sets: 3, reps: 8, targetRPE: 7, role: 'anchor', executionStyle: 'controlled',
    })),
    blockLogs: Array.from({ length: 32 }, (_, exercise) => ({
      unit: 'reps', blockIndex: exercise, exerciseId: `custom-${exercise}-${'y'.repeat(3_000)}`,
      sets: Array.from({ length: 8 }, (_, set) => ({
        exerciseId: `custom-${exercise}-${'y'.repeat(3_000)}`,
        weightKg: set * 2, reps: 8 - set, actualRPE: 7,
      })),
    })),
  }))
  return review(sessions, {
    healthHold: { reason: 'illness', since: '2026-09-01' },
    observations: Array.from({ length: 1_000 }, () => 'Repeated observation. '.repeat(100)),
    changes: Array.from({ length: 2_000 }, (_, index) => ({
      id: `change-${index}-${'z'.repeat(1_000)}`,
      message: `Swap old -> new ${index}. ${'details '.repeat(1_000)} Prefer this in future proposals.`,
    })),
  })
}

test('56-session/32-exercise heavy weeks and larger histories are bounded with exact omissions', context => {
  let maxNormal = 0
  let maxMinimal = 0
  for (const count of [56, 80]) {
    const source = heavyReview(count)
    for (const detail of ['normal', 'minimal'] as const) {
      const compact = compactWeekReview(source, detail)
      assert.ok(size(compact) <= (detail === 'normal' ? 6_000 : 2_200), `${detail}: ${size(compact)}`)
      if (detail === 'normal') maxNormal = Math.max(maxNormal, size(compact))
      else maxMinimal = Math.max(maxMinimal, size(compact))
      assert.equal(compact.omissions.sessions, count - (compact.sessions?.length ?? 0))
      assert.equal(compact.omissions.exercises, 32 - (compact.exercises?.length ?? 0))
      assert.equal(compact.omissions.notes, count * 2 - (compact.notes?.length ?? 0))
      assert.equal(compact.omissions.changes, 2_000 - (compact.changes?.length ?? 0))
      assert.equal(compact.omissions.observations, 1_000)
      assert.ok((compact.sessions?.length ?? 0) <= 56)
      assert.ok((compact.exercises?.length ?? 0) <= 32)
      assert.match(compact.actual, new RegExp(`setRows=${count * 32 * 8} reps=${count * 32 * 36}`))
      assert.match(compact.actual, /kg=0\.\.14 RPE=7/)
      assert.match(compact.health, /hold=illness since 2026-09-01/)
      for (let day = 7; day <= 13; day++) assert.ok(compact.health.includes(`2026-09-${String(day).padStart(2, '0')}`))
      assert.match(compact.summarized, /Exact details remain saved locally/)
      assert.deepEqual(compactWeekReview(source, detail), compact)
    }
  }
  context.diagnostic(`Maximum pretty-JSON sizes: normal=${maxNormal}, minimal=${maxMinimal} chars.`)
})

test('minimal summaries cover actual minutes by discipline/modality with feelings and missing feedback', () => {
  const pairs = [
    ['run', 'run_road'], ['run', 'run_trail'], ['bike', 'bike_gravel'],
    ['swim', 'swim'], ['strength', 'lifting'], ['mobility', 'other'],
  ] as const
  const source = review(pairs.map(([discipline, modality], index) => session(index, {
    kind: 'commitment', discipline, modality,
    actualDurationMin: index === 0 ? 0 : index === 5 ? null : 20,
    feedback: index === 0 ? { version: 1, feeling: 'easier', outcome: 'finished', distanceKm: 3, averageHr: 130 } : null,
  })))
  const compact = compactWeekReview(source, 'minimal')
  assert.equal(compact.omissions.modalityRows, 0)
  assert.equal(compact.byDiscipline.length, pairs.length)
  assert.match(compact.byDiscipline.join('\n'), /run\/run_road n=1 min P=30 A=0\/1/)
  assert.match(compact.byDiscipline.join('\n'), /mobility\/other n=1 min P=30 A=\?\/0/)
  assert.match(compact.feedback, /easier=1.*unknown=5; effort=\?\/0; km=3\/1; HR=130\/1/)
  assert.ok(size(compact) <= 2_200)
})

test('minimal handoff-shaped reviews keep pain dates and holds despite repeated notes and stale counters', context => {
  for (const painOffset of [0, 2]) {
    const source = review(Array.from({ length: 56 }, (_, index) => session(index, {
      status: 'partial', painFlag: index % 3 === painOffset,
      notes: 'Pain and recovery note. '.repeat(100).slice(0, 1_920),
      feedback: {
        version: 1, feeling: 'harder', outcome: 'finished_early',
        note: 'Feedback does not give clearance. '.repeat(30).slice(0, 495),
      },
    })), {
      counts: review([]).counts,
      healthHold: { reason: 'pain', since: '2026-09-01' },
      changes: Array.from({ length: 100 }, (_, index) => ({
        id: `change-${index}`, message: 'Future preference '.repeat(100).slice(0, 1_700),
      })),
    })
    const before = structuredClone(source)
    const compact = compactWeekReview(source, 'minimal')
    const expectedPain = painOffset === 0 ? 19 : 18
    assert.ok(size(compact) <= 2_200, String(size(compact)))
    assert.equal(compact.counts.partial, 56)
    assert.equal(compact.counts.completed, 0)
    assert.match(compact.summarized, /Counts reconciled from sessions\/omitted entries/)
    assert.match(compact.health, new RegExp(`painFlag yes=${expectedPain} no=${56 - expectedPain} unknown=0; knownPain=${expectedPain}`))
    assert.match(compact.health, /hold=pain since 2026-09-01/)
    for (let day = 7; day <= 13; day++) {
      const date = `2026-09-${String(day).padStart(2, '0')}`
      const painOnDate = source.sessions.filter(item => item.date === date && item.painFlag).length
      assert.ok(compact.health.includes(`${date}:${painOnDate}`))
    }
    assert.equal(compact.omissions.painDates, 0)
    assert.equal(compact.omissions.notes, 112 - (compact.notes?.length ?? 0))
    assert.equal(compact.omissions.noteChars, 56 * (1_920 + 495) - 48 * (compact.notes?.length ?? 0))
    assert.equal(compact.omissions.changes, 100 - (compact.changes?.length ?? 0))
    assert.equal(compact.omissions.changeChars, 100 * 1_700 - 64 * (compact.changes?.length ?? 0))
    assert.match(compact.feedback, /harder=56 unknown=0/)
    assert.match(compact.actual, /min=\?\/0/)
    assert.deepEqual(source, before)
    context.diagnostic(`56 partial sessions/${expectedPain} pain reports: minimal=${size(compact)} chars.`)
  }
})

test('pathological combinations or dates omit entire detail rows explicitly, never a sliced JSON value', context => {
  const modalities = ['run_road', 'run_trail', 'bike_road', 'bike_gravel', 'swim', 'row', 'ski_erg', 'lifting', 'court_sport', 'other'] as const
  const disciplines = ['run', 'bike', 'swim', 'strength', 'sport', 'mobility'] as const
  const source = review(disciplines.flatMap((discipline, index) => modalities.map((modality, inner) => session(index * 10 + inner, {
    kind: 'commitment', discipline, modality,
    date: `2026-${String(index + 1).padStart(2, '0')}-${String(inner + 1).padStart(2, '0')}`,
    painFlag: true, actualDurationMin: 15,
  }))))
  const compact = compactWeekReview(source, 'minimal')
  assert.ok(size(compact) <= 2_200, String(size(compact)))
  assert.equal(compact.omissions.modalityRows, 60 - compact.byDiscipline.length)
  assert.ok(compact.omissions.modalityRows > 0)
  assert.equal(compact.omissions.painDates, 53)
  assert.match(compact.health, /knownPain=60/)
  assert.match(compact.actual, /min=900\/60/)
  assert.match(compact.planned, /min=1800/)
  context.diagnostic(`All fixture maximum pretty-JSON sizes: normal=${maxima.normal}, minimal=${maxima.minimal} chars.`)
})
