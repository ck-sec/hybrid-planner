import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import {
  MAX_GARMIN_CSV_BYTES, MAX_TRAINING_ACTIVITIES, mergeTrainingHistory, parseGarminCsv,
  parseTrainingHistory, runPaceMinPerKm, summarizeTrainingHistory,
} from './garmin-import.ts'
import type { GarminActivity, GarminUnits } from './garmin-import.ts'

const HEADER = 'Activity Type,Date,Time,Distance,Avg HR,Moving Time,Elapsed Time,Avg Pace,Title'
const row = 'Running,2026-09-01 07:00:00,00:30:30.5,5.25,140,00:29:00,00:40:00,999,Synthetic record'
const csv = (...rows: string[]) => [HEADER, ...rows].join('\r\n')
const parsed = () => parseGarminCsv(csv(row), 'metric')
const history = () => mergeTrainingHistory(undefined, parsed(), 'metric')
const activity = (): GarminActivity => parsed().activities[0]
const replaceActivity = (patch: Record<string, unknown>) => ({ ...history(), activities: [{ ...activity(), ...patch }] })

test('English RFC CSV supports UTF-8 BOM, commas, multiline fields and escaped quotes without retaining titles', () => {
  const result = parseGarminCsv('\uFEFF' + csv(
    'Running,2026-09-01 07:00:00,00:30:30.5,5.25,140,00:29:00,00:40:00,999,"Synthetic, ""quoted""\r\nrecord"',
  ) + '\r\n', 'metric')
  assert.deepEqual(result.activities, [{
    source: 'garmin_csv', localTimestamp: '2026-09-01T07:00:00', type: 'running',
    durationMin: 30 + 30.5 / 60, distanceKm: 5.25, averageHr: 140,
    movingDurationMin: 29, elapsedDurationMin: 40,
  }])
  assert.equal(result.duplicateCount, 0)
  assert.ok(result.warnings.length > 0)
  assert.doesNotMatch(JSON.stringify(result), /Synthetic|quoted|999|title":|location":/i)
})

test('German headers, decimal commas, main/moving/elapsed duration, and fractional seconds are distinct', () => {
  const result = parseGarminCsv([
    'Aktivitätstyp,Datum,Titel,Distanz,Zeit,Ø Herzfrequenz,Zeit in Bewegung,Verstrichene Zeit,Ø Pace,Sätze insgesamt',
    'Laufband,2026-02-28 22:10:05,Synthetic,"5,25","30:00,75",145,00:25:00,01:00:00,3.5,15',
  ].join('\n'), 'metric')
  assert.equal(result.activities[0].type, 'treadmill')
  assert.equal(result.activities[0].durationMin, 30.0125)
  assert.equal(result.activities[0].movingDurationMin, 25)
  assert.equal(result.activities[0].elapsedDurationMin, 60)
  assert.equal(result.activities[0].distanceKm, 5.25)
  assert.equal(result.activities[0].averageHr, 145)
  assert.doesNotMatch(JSON.stringify(result.activities), /sets|pace|title|weight|effort|readiness/i)
})

test('unit choice is explicit, imperial distance is normalized, and decimal grouping is unambiguous', () => {
  const oneMile = parseGarminCsv(csv(row.replace('5.25', '1')), 'imperial').activities[0]
  assert.equal(oneMile.distanceKm, 1.609344)
  assert.equal(oneMile.durationMin, activity().durationMin)
  for (const [value, expected] of [['1.234', 1.234], ['"1,234"', 1.234], ['"1,234.56"', 1234.56], ['"1.234,56"', 1234.56]] as const) {
    assert.equal(parseGarminCsv(csv(row.replace('5.25', value)), 'metric').activities[0].distanceKm, expected)
  }
  for (const value of ['"1,23,456"', '"1.23.4"', '5 km', '-5', 'NaN', 'Infinity', '1e3']) {
    assert.throws(() => parseGarminCsv(csv(row.replace('5.25', value)), 'metric'), /Row 2 distance/)
  }
  for (const units of ['', undefined, 'kilometers']) {
    assert.throws(() => parseGarminCsv(csv(row), units as GarminUnits), /Units/)
  }
})

test('optional missing is unknown, real zeros stay zero, required missing is an error', () => {
  const minimal = parseGarminCsv('Activity Type,Date,Time\nStrength Training,2026-09-01 12:00:00,40:00', 'metric')
  assert.deepEqual(minimal.activities[0], {
    source: 'garmin_csv', localTimestamp: '2026-09-01T12:00:00', type: 'lifting', durationMin: 40,
  })
  const absent = parseGarminCsv(csv('Running,2026-09-01 07:00:00,30:00,--,--,--,,--,Synthetic'), 'metric').activities[0]
  for (const key of ['distanceKm', 'averageHr', 'movingDurationMin', 'elapsedDurationMin']) assert.equal(Object.hasOwn(absent, key), false)
  const zero = parseGarminCsv(csv('Running,2026-09-01 07:00:00,30:00,0,--,00:00,00:00,--,Synthetic'), 'metric').activities[0]
  assert.equal(zero.distanceKm, 0)
  assert.equal(zero.movingDurationMin, 0)
  assert.equal(zero.elapsedDurationMin, 0)
  assert.equal(runPaceMinPerKm(zero), undefined)
  for (const time of ['--', '', '0', '00:00', '-01:00', '01:60', '01:60:00', '169:00:00']) {
    assert.throws(() => parseGarminCsv(csv(row.replace('00:30:30.5', time)), 'metric'), /Row 2 timer time/)
  }
  assert.throws(() => parseGarminCsv(csv(row.replace(',140,', ',0,')), 'metric'), /Row 2 average heart rate/)
})

test('run pace uses timer duration plus distance; cycling speed is never interpreted as pace', () => {
  const run = parseGarminCsv(csv(row.replace('00:30:30.5', '30:00').replace('5.25', '5')), 'metric').activities[0]
  assert.equal(runPaceMinPerKm(run), 6)
  assert.equal(runPaceMinPerKm({ ...run, type: 'treadmill' }), 6)
  for (const type of ['cycling', 'indoor_cycling', 'walking', 'lifting'] as const) assert.equal(runPaceMinPerKm({ ...run, type }), undefined)
  assert.equal(runPaceMinPerKm({ ...run, distanceKm: undefined }), undefined)
  const cycle = parseGarminCsv(csv(row.replace('Running', 'Cycling')), 'metric').activities[0]
  assert.equal(cycle.type, 'cycling')
  assert.equal(runPaceMinPerKm(cycle), undefined)
})

test('supported German and English sports classify without inventing intensity or exercise data', () => {
  const cases = [
    ['Laufen', 'running'], ['Trail Running', 'running'], ['Laufband', 'treadmill'], ['Treadmill Running', 'treadmill'],
    ['Krafttraining', 'lifting'], ['Strength Training', 'lifting'], ['Radfahren', 'cycling'], ['Cycling', 'cycling'],
    ['Indoor-Radfahren', 'indoor_cycling'], ['Virtual Cycling', 'indoor_cycling'], ['Gehen', 'walking'], ['Walking', 'walking'],
    ['Wandern', 'hiking'], ['Hiking', 'hiking'], ['Yoga', 'yoga'], ['Pilates', 'pilates'], ['Sonstige', 'other'], ['Other', 'other'],
  ]
  for (const [input, expected] of cases) assert.equal(parseGarminCsv(csv(row.replace('Running', input)), 'metric').activities[0].type, expected)
  const unknown = parseGarminCsv(csv(row.replace('Running', 'Synthetic new sport')), 'metric')
  assert.equal(unknown.activities[0].type, 'other')
  assert.ok(unknown.warnings.some(warning => /unrecognized activity type/.test(warning)))
  assert.doesNotMatch(JSON.stringify(unknown), /Synthetic new sport/)
  for (const input of ['', '--', 'x'.repeat(81), '"Running\nextra"']) {
    assert.throws(() => parseGarminCsv(csv(row.replace('Running', input)), 'metric'), /Row 2.*Activity Type/)
  }
})

test('dates remain local and reject calendar rollover, abbreviated dates and invented timezones', () => {
  for (const date of ['2026-02-29 07:00:00', '2026-04-31 07:00:00', '2026-09-01 24:00:00', '2026-09-01 07:60:00',
    '2026-09-01 07:00:60', '09/01/2026 07:00:00', '2026-09-01', '2026-09-01T07:00:00Z', '2026-09-01T07:00:00+02:00']) {
    assert.throws(() => parseGarminCsv(csv(row.replace('2026-09-01 07:00:00', date)), 'metric'), /Row 2.*Date/)
  }
  const leap = parseGarminCsv(csv(row.replace('2026-09-01 07:00:00', '2028-02-29 01:30:00')), 'metric')
  assert.equal(leap.activities[0].localTimestamp, '2028-02-29T01:30:00')
})

test('malformed CSV and required fields fail the whole import with logical row numbers', () => {
  for (const value of [
    csv(row, row.replace('00:30:30.5', '--')),
    csv(row, row.replace('Running', '')),
    csv(row, row.replace('2026-09-01 07:00:00', '--')),
    csv(row, row.replace('Synthetic record', '"unclosed')),
    csv(row, row.replace('Synthetic record', '"closed"junk')),
    csv(row, row.replace('Synthetic record', 'bad"quote')),
    csv(row, row.replace('5.25', '5,25')),
    csv(row, row + ',extra'),
    csv(row, ''),
  ]) {
    // A single final newline is legal, so use a second newline for an internal blank record.
    const input = value === csv(row, '') ? value + '\r\n' : value
    assert.throws(() => parseGarminCsv(input, 'metric'), /Row 3/)
  }
  assert.throws(() => parseGarminCsv(csv(row.replace('Synthetic record', '"synthetic\nline"'), row.replace('140', 'oops')), 'metric'), /Row 3 average heart rate/)
  assert.throws(() => parseGarminCsv(HEADER + '\n', 'metric'), /Row 2/)
  assert.throws(() => parseGarminCsv('', 'metric'), /Row 1/)
  assert.throws(() => parseGarminCsv('Activity Type,Date,Moving Time\nRunning,2026-09-01 07:00:00,30:00', 'metric'), /Row 1.*duration/)
  assert.throws(() => parseGarminCsv('Activity Type;Date;Time\nRunning;2026-09-01 07:00:00;30:00', 'metric'), /Row 1/)
  assert.throws(() => parseGarminCsv(HEADER + ',Zeit\n' + row + ',30:00', 'metric'), /Row 1.*ambiguous/)
  assert.throws(() => parseGarminCsv(HEADER + ',Time\n' + row + ',30:00', 'metric'), /Row 1.*duplicate/)
  assert.throws(() => parseGarminCsv(csv(row.replace('Synthetic record', '\u0000')), 'metric'), /Row 2.*control/)
})

test('byte, record, column, field and numeric bounds are enforced before retaining data', () => {
  assert.throws(() => parseGarminCsv('x'.repeat(MAX_GARMIN_CSV_BYTES + 1), 'metric'), /5 MiB/)
  assert.throws(() => parseGarminCsv('é'.repeat(MAX_GARMIN_CSV_BYTES / 2 + 1), 'metric'), /5 MiB/)
  assert.throws(() => parseGarminCsv(csv(row.replace('Synthetic record', 'x'.repeat(4097))), 'metric'), /Row 2.*too long/)
  assert.throws(() => parseGarminCsv(Array.from({ length: 129 }, (_, i) => `column${i}`).join(','), 'metric'), /Row 1.*columns/)
  assert.throws(() => parseGarminCsv(csv(...Array(MAX_TRAINING_ACTIVITIES + 1).fill(row)), 'metric'), /Row 5002.*too many/)
  assert.equal(parseGarminCsv(csv(...Array(MAX_TRAINING_ACTIVITIES).fill(row)), 'metric').duplicateCount, MAX_TRAINING_ACTIVITIES - 1)
  assert.throws(() => parseGarminCsv(csv(row.replace('5.25', '20001')), 'metric'), /Row 2 distance/)
  assert.throws(() => parseGarminCsv(csv(row.replace('140', '301')), 'metric'), /Row 2 average heart rate/)
  assert.throws(() => parseGarminCsv(csv(row.replace('00:29:00', 'bad')), 'metric'), /Row 2 moving time/)
  assert.throws(() => parseGarminCsv(csv(row.replace('00:40:00', 'bad')), 'metric'), /Row 2 elapsed time/)
})

test('exact normalized duplicates skip visibly even when unused titles differ; changed facts do not merge', () => {
  const result = parseGarminCsv(csv(row, row.replace('Synthetic record', 'Another synthetic record')), 'metric')
  assert.equal(result.activities.length, 1)
  assert.equal(result.duplicateCount, 1)
  for (const changed of [row.replace('5.25', '5.5'), row.replace('140', '--'), row.replace('00:29:00', '00:28:00'),
    row.replace('00:40:00', '00:45:00'), row.replace('00:30:30.5', '00:31:00')]) {
    assert.throws(() => parseGarminCsv(csv(row, changed), 'metric'), /Row 3.*conflicting facts.*Row 2/)
  }
  assert.equal(parseGarminCsv(csv(row, row.replace('Running', 'Cycling')), 'metric').activities.length, 2)
})

test('strict restore clones normalized history and rejects coercions, extra private fields and unsupported values', () => {
  const input = history()
  const result = parseTrainingHistory(JSON.parse(JSON.stringify(input)))
  assert.deepEqual(result, input)
  assert.notEqual(parseTrainingHistory(input).activities[0], input.activities[0])
  const invalid = [
    null, [], {}, { ...input, version: 2 }, { ...input, units: 'km' }, { ...input, confirmed: 'true' },
    { ...input, activities: [] }, { ...input, activities: Array(MAX_TRAINING_ACTIVITIES + 1).fill(activity()) },
    { ...input, activities: new Array(1) }, { ...input, title: 'Synthetic forbidden data' },
    { ...input, activities: [activity(), activity()] },
    { ...input, activities: [activity(), { ...activity(), durationMin: 32 }] },
    ...[{ source: 'manual' }, { localTimestamp: '2026-09-01 07:00:00' }, { localTimestamp: '2026-09-01T07:00:00Z' },
      { localTimestamp: 'x'.repeat(5000) }, { localTimestamp: '2026-02-30T07:00:00' }, { type: 'unrecognized' },
      { durationMin: '30' }, { durationMin: 0 }, { durationMin: NaN }, { durationMin: Infinity },
      { distanceKm: null }, { distanceKm: undefined }, { distanceKm: -1 }, { averageHr: 0 },
      { movingDurationMin: -1 }, { elapsedDurationMin: Infinity }, { title: 'Synthetic private field' },
      { location: 'Synthetic location' }, { effort: 'easy' }, { sets: 3 }, { weights: [20] }].map(replaceActivity),
  ]
  for (const value of invalid) assert.throws(() => parseTrainingHistory(value))
  assert.equal(parseTrainingHistory({ ...input, confirmed: true }).confirmed, true)
})

test('merge is immutable, resets confirmation, preserves provenance and rejects ambiguous updates', () => {
  const existing = { ...history(), confirmed: true }
  const before = structuredClone(existing)
  const incoming = parseGarminCsv(csv(row, row.replace('2026-09-01', '2026-09-02')), 'metric')
  const merged = mergeTrainingHistory(existing, incoming, 'metric')
  assert.equal(merged.activities.length, 2)
  assert.equal(merged.confirmed, false)
  assert.equal(merged.units, 'metric')
  assert.ok(merged.activities.every(item => item.source === 'garmin_csv'))
  assert.deepEqual(existing, before)
  assert.equal(incoming.activities.length, 2)
  assert.throws(() => mergeTrainingHistory(existing, parsed(), 'imperial'), /source export units differ/)
  assert.throws(() => mergeTrainingHistory(existing, parseGarminCsv(csv(row.replace('140', '141')), 'metric'), 'metric'), /Imported activity 1.*conflicting facts.*Saved activity 1/)
  assert.throws(() => mergeTrainingHistory(undefined, { ...parsed(), duplicateCount: -1 }, 'metric'), /duplicate count/)
  assert.throws(() => mergeTrainingHistory(undefined, { ...parsed(), warnings: ['x'.repeat(501)] }, 'metric'), /warnings/)
  assert.throws(() => mergeTrainingHistory(undefined, { ...parsed(), activities: [] }, 'metric'), /activities/)
})

test('merging disjoint histories cannot exceed the saved record bound or silently trim earlier records', () => {
  const base = activity()
  const activities = Array.from({ length: MAX_TRAINING_ACTIVITIES + 1 }, (_, index) => ({
    ...base,
    localTimestamp: new Date(Date.UTC(2026, 8, 1, 0, 0, index)).toISOString().slice(0, 19),
  }))
  const existing = { ...history(), activities: activities.slice(0, 2500) }
  const incoming = { ...parsed(), activities: activities.slice(2500) }
  assert.throws(() => mergeTrainingHistory(existing, incoming, 'metric'), /maximum 5000.*no records were removed/)
  assert.equal(existing.activities.length, 2500)
  assert.equal(incoming.activities.length, 2501)
})

test('timezone-ambiguous local clock readings are retained rather than interpreted using the machine timezone', () => {
  for (const timestamp of ['2026-03-29 02:30:00', '2026-10-25 02:30:00', '2026-09-01 00:00:01']) {
    const result = parseGarminCsv(csv(row.replace('2026-09-01 07:00:00', timestamp)), 'metric')
    assert.equal(result.activities[0].localTimestamp, timestamp.replace(' ', 'T'))
    const summary = summarizeTrainingHistory(mergeTrainingHistory(undefined, result, 'metric'), timestamp.slice(0, 10))
    assert.equal(summary.latestAgeDays, 0)
    assert.equal(summary.dateRange.start, timestamp.slice(0, 10))
  }
})

test('summary uses deterministic local calendar weeks and recorded-only totals, with no zero-filled gaps', () => {
  const input = parseGarminCsv(csv(
    row.replace('2026-09-01', '2026-08-31'),
    row.replace('2026-09-01', '2026-09-06').replace('Running', 'Strength Training'),
    row.replace('2026-09-01', '2026-09-21'),
  ), 'metric')
  const saved = mergeTrainingHistory(undefined, input, 'metric')
  const summary = summarizeTrainingHistory(saved, '2026-09-23')
  assert.deepEqual(summary.dateRange, { start: '2026-08-31', end: '2026-09-21' })
  assert.equal(summary.count, 3)
  assert.equal(summary.durationMin, saved.activities.reduce((total, item) => total + item.durationMin, 0))
  assert.equal(summary.byType.running?.count, 2)
  assert.equal(summary.byType.lifting?.count, 1)
  assert.deepEqual(summary.weeks.map(week => [week.weekStart, week.weekEnd, week.count, week.partialPeriod]), [
    ['2026-08-31', '2026-09-06', 2, false], ['2026-09-21', '2026-09-27', 1, true],
  ])
  assert.equal(summary.coverage, 'recorded_activities_only')
  assert.ok(summary.warnings.some(warning => /completeness is unknown/.test(warning)))
  assert.equal(summary.latestAgeDays, 2)
  assert.equal(summary.stale, false)
  assert.deepEqual(summary, summarizeTrainingHistory(saved, '2026-09-23'))
  assert.throws(() => summarizeTrainingHistory(saved, '2026-02-30'), /asOfDate/)
})

test('staleness is strictly more than 42 date-only days and future dates are visible, never silently dropped', () => {
  const saved = history()
  assert.equal(summarizeTrainingHistory(saved, '2026-10-13').stale, false)
  const stale = summarizeTrainingHistory(saved, '2026-10-14')
  assert.equal(stale.stale, true)
  assert.equal(stale.latestAgeDays, 43)
  assert.ok(stale.warnings.some(warning => /43 days.*stale/.test(warning)))
  const future = summarizeTrainingHistory(saved, '2026-08-31')
  assert.equal(future.count, 1)
  assert.ok(future.warnings.some(warning => /after the review date/.test(warning)))
  const boundary = mergeTrainingHistory(undefined, parseGarminCsv(csv(row.replace('2026-09-01', '2026-01-01')), 'metric'), 'metric')
  assert.equal(summarizeTrainingHistory(boundary, '2026-01-02').weeks[0].weekStart, '2025-12-29')
})

test('React import UI is local-only, explains CSV units and uncertainty, and never changes history while rendering', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Import UI must not upload data'))
  const componentUrl = new URL('./TrainingHistoryImport.tsx', import.meta.url).href
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (url !== componentUrl) return nextLoad(url, context)
      return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
      }).outputText }
    },
  })
  try {
    const { default: TrainingHistoryImport } = await import('./TrainingHistoryImport.tsx')
    const render = (value?: ReturnType<typeof history>) => renderToStaticMarkup(createElement(TrainingHistoryImport, {
      value, asOfDate: '2026-11-01', onChange() { assert.fail('Only explicit save or removal may change history') },
    }))
    const empty = render()
    assert.match(empty, /type="file"[^>]*disabled=""/)
    assert.match(empty, /Choose export units first/)
    assert.doesNotMatch(empty, /Save training history/)
    assert.match(empty, /not XLS/)
    assert.match(empty, /connect\.garmin\.com\/modern\/activities/)
    assert.match(empty, /faq=W1TvTPW8JZ6LfJSfK512Q8/)
    assert.match(empty, /not uploaded/)
    assert.match(empty, /does not set your baseline or mark workouts complete/)
    assert.doesNotMatch(empty, /Remove imported history/)
    const restored = render(history())
    assert.match(restored, /These records represent the period shown; any missing training still needs discussion/)
    assert.match(restored, /type="checkbox" required=""/)
    assert.match(restored, /<button[^>]*disabled=""[^>]*>Save training history/)
    assert.match(restored, /Remove imported history/)
    assert.match(restored, /2026-09-01 through 2026-09-01/)
    assert.match(restored, /stale/)
    assert.match(restored, /Missing days and weeks remain unknown/)
    const confirmed = render({ ...history(), confirmed: true })
    assert.match(confirmed, /Saved and reviewed for the period shown/)
    assert.doesNotMatch(confirmed, /Save training history/)
    assert.doesNotMatch(confirmed, /type="checkbox"/)
  } finally { hooks.deregister() }
})
