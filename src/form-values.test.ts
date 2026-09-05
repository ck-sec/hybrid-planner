import assert from 'node:assert/strict'
import { test } from 'node:test'
import { numberFrom } from './form-values.ts'

test('blank and missing form numbers are rejected; an explicit zero stays zero', () => {
  const form = new FormData()
  assert.throws(() => numberFrom(form, 'weightKg'), /Blank does not mean zero/)
  form.set('weightKg', ' ')
  assert.throws(() => numberFrom(form, 'weightKg'), /Blank does not mean zero/)
  form.set('weightKg', '0')
  assert.equal(numberFrom(form, 'weightKg'), 0)
  form.set('weightKg', 'Infinity')
  assert.throws(() => numberFrom(form, 'weightKg'), /finite/)
})
