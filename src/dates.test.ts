import assert from 'node:assert/strict'
import { test } from 'node:test'
import { currentMonday, dayOfWeekDate, daysBetween, formatWeek, parseISODate, parseWeekStart } from './dates.ts'

test('Monday dates survive month and year boundaries with UTC arithmetic', () => {
  assert.equal(parseWeekStart('2025-12-29'), '2025-12-29')
  assert.equal(dayOfWeekDate('2025-12-29', 6).toISOString(), '2026-01-04T00:00:00.000Z')
  assert.equal(dayOfWeekDate('2026-08-31', 6).toISOString(), '2026-09-06T00:00:00.000Z')
  assert.equal(daysBetween('2025-12-29', '2026-01-05'), 7)
  assert.equal(daysBetween('2026-01-05', '2025-12-29'), -7)
  assert.match(formatWeek('2025-12-29'), /2026/)
})

test('current Monday uses the local calendar, including Sunday and January', () => {
  assert.equal(currentMonday(new Date(2026, 8, 6, 23, 50)), '2026-08-31')
  assert.equal(currentMonday(new Date(2026, 8, 7, 0, 10)), '2026-09-07')
  assert.equal(currentMonday(new Date(2025, 0, 1, 12)), '2024-12-30')
  assert.equal(currentMonday(new Date(2026, 0, 1, 12)), '2025-12-29')
})

test('invalid or noncanonical calendar dates are rejected instead of rolling over', () => {
  for (const value of [
    null, 20260907, '', '2026-9-07', '2026-09-7', '2026-09-07T00:00:00Z',
    '2025-02-29', '2024-02-30', '2026-04-31', '2026-13-01', '2026-00-01',
    '2026-01-00', '0000-01-01', '+010000-01-01', 'not-a-date',
  ]) assert.throws(() => parseISODate(value))
  assert.equal(parseISODate('2024-02-29').toISOString(), '2024-02-29T00:00:00.000Z')
  assert.equal(parseISODate('0001-01-01').toISOString(), '0001-01-01T00:00:00.000Z')
  assert.throws(() => parseWeekStart('2026-09-06'), /Monday/)
  assert.throws(() => currentMonday(new Date(Number.NaN)), /unavailable/)
})

test('day distances remain whole days across daylight-saving seasons', () => {
  assert.equal(daysBetween('2026-03-23', '2026-03-30'), 7)
  assert.equal(daysBetween('2026-10-19', '2026-10-26'), 7)
})
