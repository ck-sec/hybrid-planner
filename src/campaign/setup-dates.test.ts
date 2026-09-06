import assert from 'node:assert/strict'
import test from 'node:test'
import { eventDateBounds, validateSetupDate } from './setup-dates.ts'

test('event and review dates require a real full date within the supported block', () => {
  assert.deepEqual(eventDateBounds('2026-09-07'), { max: '2027-09-05' })
  for (const date of ['', '2026', '2026-12', '2026-02-30', '04/12/2026', '2026-09-06', '2027-09-06']) {
    assert.throws(() => validateSetupDate('2026-09-07', date), /date/i)
  }
  for (const date of ['2026-09-07', '2026-12-04', '2027-09-05']) {
    assert.equal(validateSetupDate('2026-09-07', date), date)
  }
  assert.equal(validateSetupDate('2028-01-03', '2028-02-29'), '2028-02-29')
})

test('incomplete block dates surface guidance rather than silently accepting a deadline', () => {
  for (const start of ['', '2026-09', '2026-02-31']) {
    assert.match(eventDateBounds(start).issue!, /Confirm your block start/)
    assert.throws(() => validateSetupDate(start, '2026-12-04'), /Confirm your block start/)
  }
})
