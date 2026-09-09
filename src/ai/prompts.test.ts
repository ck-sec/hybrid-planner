/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'

import { AI_COPY_PASTE_FORMAT, AI_COPY_PASTE_VERSION, buildInitialWeekPrompt, buildContinuationWeekPrompt } from './index.ts'

test('initial-week prompt includes profile, equipment, preferences, fixed club sessions, exact dates, aerobic categories, and fixed-club contract rules', () => {
  const prompt = buildInitialWeekPrompt({
    profile: { goal: 'Stay consistent for hybrid training', level: 'intermediate' },
    equipment: ['barbell', 'dumbbells', 'treadmill'],
    preferences: { preferredLongRunDay: 'Saturday', mobility: 'include' },
    fixedClubSessions: [{
      sessionId: 'club-tue',
      label: 'Club practice',
      date: '2026-09-16',
      startTime: '19:00',
      durationMin: 90,
      category: 'aerobic',
      modality: 'dodgeball',
    }],
    targetWeekStartDate: '2026-09-14',
  })

  assert.equal(prompt.kind, 'initial')
  assert.equal(prompt.contract.format, AI_COPY_PASTE_FORMAT)
  assert.equal(prompt.contract.version, AI_COPY_PASTE_VERSION)
  assert.deepEqual(prompt.contract.categories, ['aerobic', 'strength', 'mobility'])
  assert.match(prompt.messages[0].content, /Workout category must be exactly one of: aerobic, strength, mobility\./)
  assert.match(prompt.messages[0].content, /Aerobic modality is a separate flexible field\./)
  assert.match(prompt.messages[0].content, /source\.kind:"fixed_club"/)
  assert.match(prompt.messages[0].content, /2026-09-14 through 2026-09-20/)
  assert.match(prompt.messages[1].content, /"profile":/)
  assert.match(prompt.messages[1].content, /"equipment":/)
  assert.match(prompt.messages[1].content, /"preferences":/)
  assert.match(prompt.messages[1].content, /"fixedClubSessions":/)
  assert.match(prompt.messages[1].content, /"sessionId": "club-tue"/)
  for (const item of ['barbell', 'dumbbells', 'treadmill']) {
    assert.match(prompt.messages[1].content, new RegExp(`"${item}"`))
  }
  assert.equal(JSON.parse(prompt.exampleJson).workouts[0].source.kind, 'fixed_club')
  assert.equal(JSON.parse(prompt.contractJson).version, AI_COPY_PASTE_VERSION)
})

test('minimal clubs stay explicit timetable context while strength and unknown club details are discussed', () => {
  const commitment = {
    sessionId: 'club-social',
    title: 'Sunday club',
    dayOfWeek: 0,
    date: '2026-09-20',
    startTime: '09:30',
    notes: 'Meet by the gate; coach chooses the session.',
  }
  const equipment = ['adjustable dumbbells', 'pull-up bar', 'resistance bands']
  const prompt = buildInitialWeekPrompt({
    profile: { goal: 'Build a sustainable routine.' },
    equipment,
    preferences: {},
    fixedClubSessions: [],
    clubTimetableCommitments: [commitment],
    targetWeekStartDate: '2026-09-14',
  })
  const context = JSON.parse(prompt.messages[1].content.split('\n').slice(1, -1).join('\n'))

  assert.deepEqual(context.clubTimetableCommitments, [commitment])
  assert.deepEqual(context.equipment, equipment)
  assert.deepEqual(context.fixedClubSessions, [])
  assert.equal(context.preferences.strengthPreference, undefined)
  assert.equal(prompt.example.workouts.some(workout => workout.source.kind === 'fixed_club'), false)
  assert.doesNotMatch(prompt.prompt, /full.body/i)
  assert.match(prompt.messages[0].content, /immutable timetable commitments/)
  assert.match(prompt.messages[0].content, /Respect and reserve each supplied dayOfWeek/)
  assert.match(prompt.messages[0].content, /Discuss unspecified club duration and intensity/)
  assert.match(prompt.messages[0].content, /Do not fabricate missing scope, category, duration, intensity, or exercises/)
  assert.match(prompt.messages[0].content, /do not add or duplicate timetable commitments in the workouts array/)
  assert.match(prompt.messages[0].content, /Strength programming is for the AI conversation/)
  assert.match(prompt.messages[0].content, /legacy strengthPreference is prior context to confirm/)
})

test('continuation-week prompt carries original prescriptions, actual logs, completion states, changes, effort, notes, and exact target dates', () => {
  const prompt = buildContinuationWeekPrompt({
    profile: { goal: 'Build toward a 10k', focus: 'stay healthy' },
    equipment: { available: ['kettlebell', 'pull-up bar'] },
    preferences: { aerobicDaysPerWeek: 3, strengthDaysPerWeek: 2 },
    fixedClubSessions: [{
      sessionId: 'club-wed',
      label: 'Club training',
      date: '2026-09-23',
      startTime: '18:30',
      durationMin: 75,
      category: 'aerobic',
      modality: 'dodgeball',
    }],
    clubTimetableCommitments: [{
      sessionId: 'club-social',
      title: 'Weekend club',
      dayOfWeek: 0,
      date: '2026-09-27',
      startTime: '09:30',
      notes: 'Check the group chat.',
    }],
    targetWeekStartDate: '2026-09-21',
    warmupRequirement: 'Every workout needs a deliberate warm-up.',
    previousWeek: {
      weekStart: '2026-09-14',
      weekEnd: '2026-09-20',
      summary: 'The runner handled easy work well but felt flat after the club night.',
      workouts: [{
        original: {
          id: 'aerobic-previous',
          date: '2026-09-15',
          startTime: '07:15',
          category: 'aerobic',
          modality: 'running',
          title: 'Easy run',
          purpose: 'Support consistent aerobic work.',
          expectedDuration: 35,
          warmup: [{ id: 'warm-1', instruction: 'Walk and jog easily.', durationMin: 8 }],
          main: [{ id: 'main-1', instruction: 'Run easily.', durationMin: 22, effort: 'easy', modality: 'running' }],
          cooldown: [{ id: 'cool-1', instruction: 'Walk to finish.', durationMin: 5 }],
          source: { kind: 'ai' },
        },
        actualLog: {
          completionStatus: 'partial',
          effort: 'moderate',
          notes: 'Stopped a little early because of calf tightness.',
          steps: [{ stepId: 'main-1', completedDurationMin: 18, note: 'Calf tightened late.' }],
        },
        changes: [{ type: 'moved', fromDate: '2026-09-14', toDate: '2026-09-15', note: 'Work schedule changed.' }],
      }],
    },
  })

  assert.equal(prompt.kind, 'continuation')
  assert.match(prompt.messages[0].content, /This is a continuation week\./)
  assert.match(prompt.messages[0].content, /Every workout needs a deliberate warm-up\./)
  assert.match(prompt.messages[0].content, /original prescriptions, actual logs, completionStatus, moved or added or deleted changes, effort, and notes/)
  assert.match(prompt.messages[0].content, /2026-09-21 through 2026-09-27/)
  assert.match(prompt.messages[1].content, /"previousWeek":/)
  assert.match(prompt.messages[0].content, /Compare actuals with original targets/)
  assert.match(prompt.messages[0].content, /unrecorded step statuses are unknown/)
  assert.match(prompt.messages[1].content, /"completionStatus": "partial"/)
  assert.match(prompt.messages[1].content, /"type": "moved"/)
  assert.match(prompt.messages[1].content, /"effort": "moderate"/)
  assert.match(prompt.messages[1].content, /"clubTimetableCommitments":/)
  assert.match(prompt.messages[1].content, /"date": "2026-09-27"/)
  assert.match(prompt.messages[1].content, /"notes": "Check the group chat\."/)
  assert.match(prompt.messages[1].content, /"kettlebell"/)
  assert.match(prompt.messages[1].content, /"pull-up bar"/)
  assert.equal(prompt.example.targetWeek.startDate, '2026-09-21')
  assert.equal(prompt.example.weekType, 'continuation')
})
