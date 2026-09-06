import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { buildCampaign, completeCampaignSession, nextCampaignWeek, parseCampaign, stable } from './model.ts'
import type { CampaignState } from './types.ts'

test('the production v0.2 two-week calendar retains its exact prescriptions, logs and derived history', () => {
  const seed: CampaignState = {
    version: 1, step: 1, setupComplete: false, sample: false, weeks: [], selectedWeek: 0, setDrafts: {},
    draft: {
      goalKind: 'dodgeball', goalLabel: 'Sample: Bangkok dodgeball tournament', location: 'Bangkok',
      eventDate: '2026-11-29', startDate: '2026-09-07',
      priorities: ['repeat_sprint', 'change_of_direction', 'shoulder_durability', 'power'],
      availableDays: [0, 1, 2, 3, 4, 5, 6], practiceDays: [1, 3], practiceTime: '19:00', practiceDuration: 90,
      weeklyRunMinutes: 90, runsPerWeek: 3, liftsPerWeek: 2, liftDurationMin: 45, weeklyTimeBudgetMin: 360,
      equipment: ['dumbbell', 'bodyweight'], exercises: [], confirmed: true,
      recommendedSetup: {
        version: 1, mode: 'assisted',
        goalText: 'I\u2019m preparing for the Dodgeball World Championships in Bangkok. I want to keep running and lifting around practice.',
        typicalRunMinutes: 30, exerciseIds: ['goblet-squat', 'dumbbell-row', 'push-up', 'dead-bug'],
      },
    },
  }
  let state = buildCampaign(seed)
  const first = state.weeks[0].plan.sessions.find(session => session.kind === 'strength')
  assert.ok(first)
  state = completeCampaignSession(state, first.id, first.durationMin, 5, false)
  state = nextCampaignWeek(state)
  // Captured from the deployed 2fa7043 model before introducing template programming.
  assert.equal(createHash('sha256').update(stable(state)).digest('hex'), '4f5dfad159d275550c043e92e8692c53d592ff6b2a4c0986e57e1ff33388b04b')
  assert.deepEqual(parseCampaign(JSON.parse(JSON.stringify(state))), state)
})
