import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkoutSession } from '../../engine/types.ts'
import { displayPlanWarnings } from './plan-warnings.ts'

const explanation = 'Timed work and controlled throws keep their own units. The user-established throw ceiling is an administrative exposure cap.'
test('generic weeks do not display the retired throwing feature explanation or rewrite warning evidence', () => {
  const plan = { sessions: [], warnings: [explanation, 'Pain was reported; review recorded limitations.'] }
  const before = structuredClone(plan)
  assert.deepEqual(displayPlanWarnings(plan), [
    'Timed work is recorded in seconds, separately from repetition-based work.',
    'Pain was reported; review recorded limitations.',
  ])
  assert.deepEqual(plan, before)
})

test('an existing throwing workout retains its historical explanation', () => {
  const session: WorkoutSession = {
    id: 'saved-practice', kind: 'workout', date: '2026-09-07', startTime: '19:00',
    durationMin: 60, label: 'Saved practice', discipline: 'sport', modality: 'court_sport',
    predictedLoad: { systemic: 240, structural: 180 }, pinned: true, isCalibration: false,
    reason: 'Saved work.', sourceCommitmentId: 'practice-0',
    blocks: [{ unit: 'throws', drillId: 'dodgeball-controlled-target-throw', throws: 10, intent: 'controlled_technique', embedded: true }],
  }
  assert.deepEqual(displayPlanWarnings({ sessions: [session], warnings: [explanation] }), [explanation])
})
