import assert from 'node:assert/strict'
import test from 'node:test'
import { PROGRAM_LIBRARY_VERSION } from '../../engine/constants.ts'
import { CUSTOM_EXERCISE_PROFILES } from '../../engine/custom-exercises.ts'
import { resolveProgramLibrary } from '../../engine/library.ts'
import { recommendProgram } from '../../engine/program.ts'
import type { CustomExerciseSpec } from '../../engine/types.ts'
import { assertReferenceCardText, stageCustomExercises, nextCustomExerciseId, MAX_PROPOSED_CUSTOM_EXERCISES } from './custom-exercises.ts'
import { equipmentForResources, parseResources, programResources } from './equipment.ts'
import { exampleCampaign, normalizeRecommendedDraft } from './model.ts'

const custom: CustomExerciseSpec = {
  version: 1, id: 'custom-sandbag-hinge', name: 'Sandbag hinge', profileId: 'controlled_hinge',
  requirements: ['custom:sandbag'],
  description: 'Brace your trunk and move the hips back while holding the bag close.',
  focus: 'Keep the load controlled and stop before your position changes.',
  why: 'A familiar hinge variation using the athlete’s available equipment.',
}

test('reference notes can name confirmed weighted equipment without authoring a load', () => {
  assert.doesNotThrow(() => assertReferenceCardText(['custom:weightedball-1kg'], 'Reference for the 1 kg ball.', 'Keep it separate from other equipment.'))
  assert.doesNotThrow(() => assertReferenceCardText(['custom:12lb-dumbbell'], 'A reference for the 12 pound dumbbell.'))
  for (const resources of [[], ['custom:weightedball-2kg'], ['custom:21kg-ball'], ['custom:1kg-barbell']] as const) {
    assert.throws(() => assertReferenceCardText(resources, 'A reference for the 1 kg ball.'), /cannot prescribe/)
  }
  for (const text of ['Use the 1 kg ball for 3 sets.', 'Add 2 kg.', 'Hold the 1 kg ball for 30 seconds.', 'RPE 8 with the 1 kg ball.', 'Use a 2.1 kg ball.', 'Use a 2,1 kg ball.', 'Use a -1 kg ball.']) {
    assert.throws(() => assertReferenceCardText(['custom:weightedball-1kg'], text), /cannot prescribe/)
  }
})

function draft() {
  const input = exampleCampaign('2026-09-07').draft
  const resources = parseResources(['dumbbell', 'floor_space', 'custom:sandbag'])
  const exact = programResources(resources)
  const selection = [...recommendProgram(exact, 'balanced').exerciseIds]
  return normalizeRecommendedDraft({
    ...input, goalKind: 'hybrid', resources, equipment: equipmentForResources(resources),
    program: {
      version: 1, libraryVersion: PROGRAM_LIBRARY_VERSION, goal: 'balanced', resources: exact,
      conditioningBaselines: [], selectedExerciseIds: selection,
    },
    recommendedSetup: { ...input.recommendedSetup!, exerciseIds: selection },
  })
}

test('staging real definitions preserves selection, baseline, draft state and engine-owned quantities', () => {
  const input = draft()
  const before = structuredClone(input)
  const staged = stageCustomExercises(input, [custom])
  assert.deepEqual(input, before)
  assert.deepEqual(staged.program?.customExercises, [custom])
  assert.deepEqual(staged.program?.selectedExerciseIds, input.program?.selectedExerciseIds)
  assert.deepEqual(staged.recommendedSetup, input.recommendedSetup)
  assert.deepEqual(staged.exercises, input.exercises)
  assert.equal(staged.weeklyRunMinutes, input.weeklyRunMinutes)
  assert.equal(staged.confirmed, input.confirmed)
  const resolved = resolveProgramLibrary(staged.program).exercises.find(item => item.id === custom.id)!
  assert.deepEqual(resolved.profile, CUSTOM_EXERCISE_PROFILES.controlled_hinge.profile)
  assert.ok(resolved.coefficients.systemic > 0 && resolved.coefficients.structural > 0)
  assert.equal(resolved.name, custom.name)
  assert.deepEqual(stageCustomExercises(staged, [structuredClone(custom)]), staged)
})

test('identities and definition content are immutable; revisions need new IDs', () => {
  const input = stageCustomExercises(draft(), [custom])
  for (const change of [
    { name: 'Different hinge' }, { description: 'A different technique.' },
    { focus: 'Different focus.' }, { why: 'Different purpose.' }, { profileId: 'controlled_squat' },
    { requirements: ['dumbbell'] },
  ]) assert.throws(() => stageCustomExercises(input, [{ ...custom, ...change }]), /immutable/)
  const next = stageCustomExercises(input, [{ ...custom, id: 'custom-sandbag-hinge-revised', focus: 'Brace comfortably.' }])
  assert.equal(next.program?.customExercises?.length, 2)
  assert.deepEqual(next.program?.customExercises?.find(item => item.id === custom.id), custom)
})

test('new definitions require current gear while unselected historical definitions stay intact', () => {
  const original = stageCustomExercises(draft(), [custom])
  const resources = parseResources(['dumbbell', 'floor_space'])
  const changed = {
    ...original, resources,
    program: { ...original.program!, resources: programResources(resources) },
  }
  const replacement = { ...custom, id: 'custom-dumbbell-hinge', name: 'Dumbbell hinge', requirements: ['dumbbell'] }
  const staged = stageCustomExercises(changed, [replacement])
  assert.deepEqual(staged.program?.customExercises?.find(item => item.id === custom.id), custom)
  assert.deepEqual(staged.program?.selectedExerciseIds, changed.program.selectedExerciseIds)
  assert.ok(resolveProgramLibrary(staged.program).exercises.some(item => item.id === custom.id))
  assert.equal(stageCustomExercises(changed, []), changed)
  assert.throws(() => stageCustomExercises(changed, [{ ...custom, id: 'custom-new-sandbag-hinge' }]), /confirmed program resources/)
})

test('custom imports reject profile, identity, resource, unit and prescription overrides without fallback', () => {
  for (const invalid of [
    { ...custom, id: 'deadlift' }, { ...custom, id: 'custom-Bad' },
    { ...custom, profileId: 'unknown' }, { ...custom, profileId: 'constructor' },
    { ...custom, requirements: [] }, { ...custom, requirements: ['custom:unselected'] },
    { ...custom, requirements: ['sandbag'] }, { ...custom, requirements: ['custom:sandbag', 'custom:sandbag'] },
    { ...custom, unit: 'seconds' }, { ...custom, sets: 3 }, { ...custom, reps: 10 }, { ...custom, weightKg: 0 },
    { ...custom, targetRPE: 9 }, { ...custom, executionStyle: 'ballistic_logging_only' },
    { ...custom, profile: { prescription: { sets: 99 } } },
    { ...custom, coefficients: { systemic: 0, structural: 0 } },
    { ...custom, version: 2 }, { ...custom, name: '' }, { ...custom, why: '<script>bad()</script>' },
    { ...custom, description: 'Perform 3 sets of 10 reps.' },
    { ...custom, focus: 'Hold for thirty seconds.' },
    { ...custom, why: 'Use RPE 8.' }, { ...custom, name: 'Hinge 4x10' },
  ]) assert.throws(() => stageCustomExercises(draft(), [invalid]), JSON.stringify(invalid))
  assert.throws(() => stageCustomExercises(draft(), [custom, custom]), /unique/)
  assert.throws(() => stageCustomExercises(draft(), new Array(1)), /complete|array/)
  assert.throws(() => stageCustomExercises(draft(), Array.from({ length: MAX_PROPOSED_CUSTOM_EXERCISES + 1 }, (_, i) => ({
    ...custom, id: `custom-hinge-${i}`,
  }))), /at most/)
})

test('legacy drafts are not silently upgraded and no-op staging preserves their structure', () => {
  const legacy = exampleCampaign('2026-09-07').draft
  assert.equal(legacy.program, undefined)
  assert.equal(stageCustomExercises(legacy, []), legacy)
  assert.throws(() => stageCustomExercises(legacy, [custom]), /legacy plans are unchanged/)
})

test('manual names produce bounded fresh identities without overwriting an existing revision', () => {
  assert.equal(nextCustomExerciseId('Sandbag hinge', []), custom.id)
  assert.equal(nextCustomExerciseId('Sandbag hinge', [custom]), `${custom.id}-2`)
  assert.equal(nextCustomExerciseId('Sandbag hinge', [custom, { ...custom, id: `${custom.id}-2` }]), `${custom.id}-3`)
  assert.equal(nextCustomExerciseId('Contrôled hinge', []), 'custom-controled-hinge')
  const name = 'A'.repeat(80)
  const first = nextCustomExerciseId(name, [])
  const second = nextCustomExerciseId(name, [{ ...custom, id: first }])
  assert.equal(first.length, 80)
  assert.equal(second.length, 80)
  assert.match(second, /^custom-[a-z0-9]+(?:-[a-z0-9]+)*$/)
  assert.notEqual(first, second)
  for (const invalid of ['', '   ', '<script>bad</script>', 'A'.repeat(81), '\nHinge', '---']) {
    assert.throws(() => nextCustomExerciseId(invalid, []))
  }
})
