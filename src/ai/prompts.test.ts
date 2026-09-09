/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'

import { AI_COPY_PASTE_FORMAT, AI_COPY_PASTE_VERSION, buildInitialWeekPrompt, buildContinuationWeekPrompt, buildWeekContractExample } from './index.ts'

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
  assert.equal(prompt.contract.version, 2)
  assert.deepEqual(prompt.contract.categories, ['aerobic', 'strength', 'mobility'])
  assert.match(prompt.messages[0].content, /Workout category must be exactly one of: aerobic, strength, mobility\./)
  assert.match(prompt.messages[0].content, /Aerobic modality is a separate flexible field\./)
  assert.match(prompt.messages[0].content, /workouts array must contain at least one workout/)
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

test('prompts use confirmed context, bounded clarification, and coach-led recommendations before final assessment', () => {
  const planningContext = {
    asOf: '2026-09-09',
    event: 'HYROX doubles open',
    benchmarks: ['No recent timed run.'],
    recentTraining: { weeks: 4, aerobicMinutes: 90, strengthMinutes: 70, clubMinutes: 60 },
    weeklyTimeLimitMin: 300,
    sessionLimits: [{ dayOfWeek: 1, maxMinutes: 45 }],
    clubLoads: [{ sessionId: 'club-social', durationMin: 60, effortRating: 5 }],
  }
  const prompt = buildInitialWeekPrompt({
    profile: { goal: 'Complete a first HYROX event.', planningContext },
    equipment: ['dumbbells', 'running shoes'],
    preferences: {},
    fixedClubSessions: [],
    targetWeekStartDate: '2026-09-14',
  })
  const context = JSON.parse(prompt.messages[1].content.split('\n').slice(1, -1).join('\n'))
  const system = prompt.messages[0].content
  assert.deepEqual(context.profile.planningContext, planningContext)
  assert.match(system, /Use supplied confirmed context, including profile\.planningContext, before asking questions/)
  assert.match(system, /Clarify only missing current actual training by category, relevant benchmarks, event format\/division\/level, available training time, club load, and relevant limitations/)
  assert.match(system, /Do not repeat answered questions or invent athlete facts/)
  assert.match(system, /Check stale baselines with the athlete before treating them as current/)
  assert.match(system, /Do not silently redate old training or performance facts/)
  assert.match(system, /Preserve the original dates of benchmarks in their text/)
  assert.match(system, /update asOf or recentTraining only when the athlete confirms the updated snapshot and reporting window/)
  assert.match(system, /Unknown benchmarks are allowed/)
  assert.match(system, /conservative initial calibration week and reassessment instead of an endless questionnaire/)
  assert.match(system, /do not force the athlete to choose or design their own program/)
  assert.match(system, /Before final JSON, discuss the goal assessment, its rationale, relevant unknowns, and the next measurable milestone/)
  assert.match(system, /complete updated snapshot of athlete-confirmed facts, not a patch/)
  assert.match(system, /Carry forward still-current confirmed facts from profile\.planningContext/)
  assert.match(system, /omit unknown fields instead of creating empty defaults/)
  assert.match(system, /Do not change the profile goal, equipment, preferences, or club timetable/)
  assert.equal(Object.hasOwn(prompt.example, 'athleteContext'), false)
  assert.equal(prompt.example.goalAssessment.status, 'unassessed')
  assert.ok(JSON.parse(prompt.contractJson).goalAssessment.nextMilestone)
})

test('prompts distinguish workload estimates, units, equipment substitutions, and unsupported safety guarantees', () => {
  const prompt = buildInitialWeekPrompt({
    profile: { goal: 'Improve team dodgeball results.' },
    equipment: ['dumbbells'],
    preferences: {},
    fixedClubSessions: [],
    targetWeekStartDate: '2026-09-14',
  })
  const system = prompt.messages[0].content
  for (const pattern of [
    /caps are ceilings, not fill targets/,
    /warmups, cooldowns, rests, transitions, and known club commitments/,
    /Review current workload by category: aerobic, strength, mobility, and club work/,
    /without counting club work twice/,
    /weekly averages over recentTraining\.weeks ending asOf/,
    /minute buckets are mutually exclusive/,
    /aerobicMinutes, strengthMinutes, and mobilityMinutes cover supplementary\/non-club work only/,
    /clubMinutes includes all club sessions regardless of modality/,
    /Omitted values are unknown, not zero/,
    /baseline is unknown, say so instead of inventing a percentage increase/,
    /Do not present a universal 10 percent rule/,
    /ACWR/,
    /Do not certify injury safety/,
    /Team outcomes are not guaranteed by individual conditioning/,
    /Use only explicitly listed equipment and respect its stated constraints/,
    /Distinguish HYROX conditioning substitutions from actual station practice/,
    /only sessionId values from supplied club sessions\/commitments/,
    /cannot override an explicitly scheduled duration/,
    /estimatedTotalMin is a positive number estimating the whole block/,
    /including all sets\/repeats, work, rest, equipment changes, and transitions/,
    /separate from durationMin, which is the work-duration target/,
    /durationMin is work duration per set when sets is supplied, otherwise work duration for the step/,
    /estimatedTotalMin must cover durationMin \* sets \(or durationMin without sets\), plus all rests and transitions/,
    /Sum these estimates into expectedDuration, rounded up to whole minutes/,
    /estimates are planning assumptions, not empirical or logged durations/,
    /Whenever loadKg is prescribed, loadBasis is required/,
    /"per_implement" for each dumbbell/,
    /"total" for a barbell including the bar/,
    /repBasis:"per_side"/,
    /repBasis:"total"/,
    /CR\/LF line breaks are allowed in prose notes, instructions, purposes, summaries, and context\/assessment descriptions/,
    /encode them as JSON escapes/,
    /Keep identifiers, dates, times, and enum values single-line/,
  ]) assert.match(system, pattern)
})

test('continuation context carries weekly review and unambiguous logged exercise units without inventing actuals', () => {
  const previous = buildWeekContractExample('initial', '2026-09-14')
  const review = {
    reflection: 'The club session left more fatigue than expected.',
    energy: 2,
    recovery: 3,
    blockers: 'Late work night.',
    metrics: [{ id: 'run-minutes', label: 'Running minutes', planned: '40', completed: 'Unknown', note: 'No complete log.' }],
  }
  const steps = [{ stepId: 'strength-1-main', loadKg: 12, loadBasis: 'per_implement' as const, completedReps: 8, repBasis: 'per_side' as const }]
  const prompt = buildContinuationWeekPrompt({
    profile: { goal: 'Build consistency.' },
    equipment: ['dumbbells'],
    preferences: {},
    fixedClubSessions: [],
    targetWeekStartDate: '2026-09-21',
    previousWeek: {
      weekStart: previous.targetWeek.startDate,
      weekEnd: previous.targetWeek.endDate,
      review,
      workouts: [{ original: previous.workouts[1]!, actualLog: { completionStatus: 'partial', steps } }],
    },
  })
  const context = JSON.parse(prompt.messages[1].content.split('\n').slice(1, -1).join('\n'))
  assert.deepEqual(context.previousWeek.review, review)
  assert.deepEqual(context.previousWeek.workouts[0].actualLog.steps, steps)
  assert.match(prompt.messages[0].content, /Use previousWeek\.review when supplied/)
  assert.match(prompt.messages[0].content, /Separate what was planned, completed, and still unknown/)
  assert.match(prompt.messages[0].content, /Preserve loadBasis and repBasis when interpreting previous logs/)
  assert.match(prompt.messages[0].content, /Blank values and unrecorded step statuses are unknown, not completed or skipped work/)
})

test('explicit session counts take precedence over allowed days, and legacy counts stay unknown', () => {
  const preferredWeeklyStructure = [{ dayOfWeek: 1, modalities: ['strength'], preferredStartTime: '18:00' }]
  for (const sessionCounts of [{ strength: 2, aerobic: 0 }, {}]) {
    const prompt = buildInitialWeekPrompt({
      profile: { goal: 'Build consistency.' },
      equipment: ['dumbbells'],
      preferences: { sessionCounts, preferredWeeklyStructure },
      fixedClubSessions: [],
      targetWeekStartDate: '2026-09-14',
    })
    const context = JSON.parse(prompt.messages[1].content.split('\n').slice(1, -1).join('\n'))
    assert.deepEqual(context.preferences, { sessionCounts, preferredWeeklyStructure })
    for (const pattern of [
      /Use explicit preferences\.sessionCounts as the requested weekly frequency/,
      /preferredWeeklyStructure describes allowed days and modalities, not one session per day/,
      /Multiple sessions may share an allowed day/,
      /do not infer frequency from the number of preferred days/,
      /An omitted session count is unknown, not zero/,
      /If a count is unknown, ask the athlete briefly and offer a coach-led recommendation/,
      /Preserve explicitly supplied counts, including zero/,
      /discuss any recommended change instead of silently overriding them/,
    ]) assert.match(prompt.messages[0].content, pattern)
  }
})
