import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_LIBRARY } from '../../engine/library.ts'
import type { Exercise } from '../../engine/types.ts'
import { exerciseGuidance } from './exercise-guidance.ts'

test('every eligible built-in exercise has complete offline guidance', t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Exercise guidance must not use the network'))
  for (const exercise of DEFAULT_LIBRARY.exercises.filter(item => !item.highSkill)) {
    const guidance = exerciseGuidance(exercise)
    assert.ok(guidance.description.trim(), `${exercise.id} description`)
    assert.ok(guidance.why.trim(), `${exercise.id} why`)
    assert.ok(guidance.execution.trim(), `${exercise.id} execution`)
    assert.ok(guidance.focus.length >= 2, `${exercise.id} focus`)
    assert.ok(guidance.focus.every(item => item.trim()), `${exercise.id} focus text`)
    assert.doesNotMatch(JSON.stringify(guidance), /\b(?:sets?|reps?|kilograms?|kilos?|pounds?|lbs?|rpe)\s*[:=]?\s*\d|\b\d+\s*(?:kg|lb)\b/i, exercise.id)
  }
})

test('legacy exercise identities retain specific, meaningful instructions', () => {
  const expected: Readonly<Record<string, RegExp>> = {
    'back-squat': /bar.*upper back/i,
    'goblet-squat': /dumbbell.*chest/i,
    'bodyweight-squat': /comfortable stance/i,
    deadlift: /bar.*floor/i,
    'romanian-deadlift': /hips back/i,
    'hip-thrust': /upper back.*bench/i,
    'bench-press': /shoulder blades.*bench/i,
    'push-up': /straight plank/i,
    'overhead-press': /bar.*shoulders/i,
    'dumbbell-row': /split stance.*forearm.*thigh/i,
    'pull-up': /hang.*bar/i,
    'split-squat': /split stance.*dumbbells/i,
    'band-rotation': /band anchor/i,
    'dead-bug': /opposite limbs/i,
  }
  for (const [id, wording] of Object.entries(expected)) {
    const exercise = DEFAULT_LIBRARY.exercises.find(item => item.id === id)
    assert.ok(exercise, id)
    assert.match(exerciseGuidance(exercise).description, wording, id)
  }
})

test('snatch guidance remains a logging and coached reference, not a prescription', () => {
  const exercise = DEFAULT_LIBRARY.exercises.find(item => item.id === 'snatch')!
  const guidance = exerciseGuidance(exercise)
  assert.match(guidance.description, /logged only as a coached reference/i)
  assert.doesNotMatch(guidance.description, /recorded by the plan|prescribed by the plan/i)
})

test('execution options distinguish slow eccentric, grounded fast intent and unsupported jumps', () => {
  const exercise = DEFAULT_LIBRARY.exercises.find(item => item.id === 'goblet-squat')!
  const slow = exerciseGuidance(exercise, { execution: 'Slow eccentric' }).execution
  const fast = exerciseGuidance(exercise, { execution: 'Fast upward intent' }).execution
  const jump = exerciseGuidance(exercise, { execution: 'Ballistic jump' }).execution
  assert.match(slow, /slow eccentric.*lower/i)
  assert.doesNotMatch(slow, /fast upward|jump/i)
  assert.match(fast, /fast upward intent.*grounded/i)
  assert.match(fast, /not a jump or ballistic/i)
  assert.match(jump, /unsupported ballistic or jumping/i)
  assert.notEqual(slow, fast)
})

test('why text uses caller-selected slot and goal without inventing active qualities', () => {
  const exercise = DEFAULT_LIBRARY.exercises.find(item => item.id === 'cable-row')!
  const guidance = exerciseGuidance(exercise, { slot: 'upper-body pull', goal: 'autumn race' })
  assert.match(guidance.why, /selected upper-body pull slot/i)
  assert.match(guidance.why, /general support.*autumn race goal/i)
  assert.doesNotMatch(guidance.why, /power|speed|injury prevention|guarantee/i)
})

test('controlled target throws stay deliberate sport practice rather than extra work', () => {
  const drill: Exercise = {
    id: 'dodgeball-controlled-target-throw',
    name: 'Controlled target throws',
    pattern: 'rotational',
    equipment: ['none'],
    coefficients: { systemic: 1, structural: 1 },
    competesWithRunning: false,
    highSkill: false,
  }
  const guidance = exerciseGuidance(drill, { execution: 'Fast' })
  assert.match(guidance.description, /deliberate throw.*safe target/i)
  assert.match(guidance.focus.join(' '), /controlled rather than maximal/i)
  assert.match(guidance.why, /not extra conditioning or maximal-power work/i)
  assert.match(guidance.execution, /controlled target throw.*submaximal/i)
})

test('unknown catalog additions still receive pattern- and equipment-specific guidance', () => {
  const exercise: Exercise = {
    id: 'new-band-pull',
    name: 'New band pull',
    pattern: 'horizontal_pull',
    equipment: ['bands'],
    coefficients: { systemic: 1, structural: 1 },
    competesWithRunning: false,
    highSkill: false,
  }
  const guidance = exerciseGuidance(exercise)
  assert.match(guidance.description, /New band pull.*arms extended/i)
  assert.match(guidance.description, /band.*changing tension/i)
  assert.doesNotMatch(guidance.description, /anchor|bench|rack/i)
  assert.match(guidance.why, /horizontal pulling/i)
})
