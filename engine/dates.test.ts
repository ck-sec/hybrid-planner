import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addDays, dateForWeekday, dayNumber, dayOfWeek, parseISODate, timeMinutes } from './dates.ts'
import type { Day } from './types.ts'

test('civil day arithmetic is reversible across leap years and century boundaries', () => {
  assert.equal(dayNumber('1970-01-01'), 0)
  assert.equal(addDays('2024-02-28', 1), '2024-02-29')
  assert.equal(addDays('2100-02-28', 1), '2100-03-01')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  for (let offset = -10000; offset <= 10000; offset += 37) {
    assert.equal(dayNumber(addDays('2026-01-01', offset)), dayNumber('2026-01-01') + offset)
  }
  assert.equal(dayOfWeek('2026-09-07'), 0)
  assert.equal(dayOfWeek('2026-09-06'), 6)
})

test('invalid dates and unknown time formatting cannot roll over', () => {
  for (const date of ['2026-02-29', '2026-13-01', '2026-01-32', '26-01-01', '1899-12-31']) {
    assert.throws(() => parseISODate(date))
  }
  for (const time of ['24:00', '08:60', '8:00', '']) assert.throws(() => timeMinutes(time))
  assert.equal(timeMinutes('23:59'), 1439)
})

test('every fixed weekday resolves once inside all seven rolling starts across date boundaries', () => {
  for (const first of ['2026-09-07', '2026-12-28', '2028-02-28', '2026-03-23', '2026-10-19']) {
    for (let offset = 0; offset < 7; offset++) {
      const start = addDays(first, offset)
      const dates = Array.from({ length: 7 }, (_, day) => dateForWeekday(start, day as Day))
      assert.equal(new Set(dates).size, 7)
      for (const [weekday, date] of dates.entries()) {
        assert.equal(dayOfWeek(date), weekday)
        assert.ok(date >= start && date <= addDays(start, 6))
        assert.equal(dateForWeekday(addDays(start, 7), weekday as Day), addDays(date, 7))
      }
      assert.equal(dateForWeekday(start, dayOfWeek(start)), start)
    }
  }
  for (const day of [-1, 7, 1.5, Number.NaN]) assert.throws(() => dateForWeekday('2026-09-09', day as Day), /weekday/)
})
