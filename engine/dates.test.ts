import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addDays, dayNumber, dayOfWeek, parseISODate, timeMinutes } from './dates.ts'

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
