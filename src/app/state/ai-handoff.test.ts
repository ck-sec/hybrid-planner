/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildInitialWeekPrompt, buildWeekContractExample, buildTargetWeek } from '../../ai/index.ts'
import {
  parseAthleteProfile,
  parseWeekPlan,
  parseWorkout,
  parseWorkoutLog,
  type AthleteProfile,
  type Workout,
} from '../../domain/contracts.ts'
import { parseLocalDate } from '../../domain/local-date.ts'
import { writeTextToClipboard } from './ai-clipboard.ts'
import {
  buildContinuationPromptInputFromAthleteProfile,
  buildExpectedFixedClubSessions,
  buildInitialPromptInputFromAthleteProfile,
  previewAiWeekHandoff,
  type TrackedWorkoutChange,
} from './ai-handoff.ts'

function createAthlete(): AthleteProfile {
  return parseAthleteProfile({
    version: 1,
    id: 'athlete-amy',
    createdOn: '2026-09-01',
    updatedOn: '2026-09-01',
    name: 'Amy Runner',
    goal: 'Build toward a confident autumn 10k.',
    goalDate: '2026-10-18',
    sports: ['running', 'strength'],
    preferredWeeklyStructure: [
      { dayOfWeek: 1, modalities: ['strength'], preferredStartTime: '18:00', expectedDurationMin: 45 },
      { dayOfWeek: 3, modalities: ['aerobic'], preferredStartTime: '07:00', expectedDurationMin: 50 },
      { dayOfWeek: 6, modalities: ['aerobic', 'mobility'], preferredStartTime: '08:00', expectedDurationMin: 70, notes: 'Longer outdoor session.' },
    ],
    strengthPreference: 'mixed',
    equipmentDetails: [
      { id: 'garage-gym', label: 'Garage gym', constraints: ['No rack'], notes: 'Barbell, kettlebells, and bands.' },
    ],
    constraints: ['No doubles on Tuesdays'],
    clubSessions: [
      {
        id: 'club-track',
        title: 'Club track',
        scope: 'Track group',
        category: 'aerobic',
        dayOfWeek: 2,
        startTime: '19:00',
        durationMin: 75,
        notes: 'Bring spikes if the weather is dry.',
      },
    ],
    notes: 'Prefers outdoor running when possible.',
  })
}

function createDeletedWorkout(weekPlanId: string): Workout {
  return parseWorkout({
    version: 1,
    id: 'strength-deleted',
    athleteId: 'athlete-amy',
    weekPlanId,
    scheduledDate: '2026-09-12',
    startTime: '17:30',
    category: 'strength',
    source: 'manual',
    title: 'Deleted strength slot',
    purpose: 'Originally planned before travel changed.',
    expectedDurationMin: 40,
    warmup: [{ id: 'strength-deleted-warm', title: 'Band warm-up', target: { minutes: 5 } }],
    main: [{ id: 'strength-deleted-main', title: 'Squat pattern', detail: '3 x 5 steady.', target: { sets: 3, reps: 5, effort: 'steady' } }],
    cooldown: [],
  })
}

test('initial prompt input maps athlete profile, fixed club sessions, preferences, and equipment deterministically', () => {
  const athlete = createAthlete()
  const input = buildInitialPromptInputFromAthleteProfile(athlete, parseLocalDate('2026-09-21'))

  assert.equal(input.profile.name, 'Amy Runner')
  assert.equal(Array.isArray((input.equipment as { items: unknown[] }).items), true)
  assert.equal(input.fixedClubSessions[0]?.sessionId, 'club-track')
  assert.equal(input.fixedClubSessions[0]?.date, '2026-09-22')
  assert.match(input.fixedClubSessions[0]?.notes ?? '', /Scope: Track group/)
  assert.equal((input.preferences as { preferredWeeklyStructure: unknown[] }).preferredWeeklyStructure.length, 3)
  assert.equal(input.preferences.strengthPreference, 'mixed')
})

test('prompt handoff separates rich clubs from minimal commitments on the correct rolling-week dates', () => {
  const athlete = parseAthleteProfile({
    ...createAthlete(),
    strengthPreference: undefined,
    clubSessions: [
      { id: 'club-social', title: 'Social club', dayOfWeek: 0, startTime: '09:30', notes: 'Meet by the gate.' },
      ...createAthlete().clubSessions,
      { id: 'club-partial', title: 'Club circuit', dayOfWeek: 5, startTime: '18:00', category: 'strength', durationMin: 60 },
      { id: 'club-midweek', title: 'Midweek club', dayOfWeek: 3, startTime: '19:00' },
    ],
    equipmentDetails: [
      { id: 'home-kit', label: 'Adjustable dumbbells', constraints: ['Up to 20 kg'], notes: 'Pair available at home.' },
      { id: 'bands', label: 'Resistance bands', constraints: [] },
    ],
  })
  const input = buildInitialPromptInputFromAthleteProfile(athlete, parseLocalDate('2026-09-23'))
  const prompt = buildInitialWeekPrompt(input)

  assert.equal(input.fixedClubSessions.length, 1)
  assert.equal(input.fixedClubSessions[0]!.sessionId, 'club-track')
  assert.equal(input.fixedClubSessions[0]!.date, '2026-09-29')
  assert.equal(input.fixedClubSessions[0]!.durationMin, 75)
  assert.equal(input.fixedClubSessions[0]!.category, 'aerobic')
  assert.deepEqual(input.clubTimetableCommitments, [
    { sessionId: 'club-midweek', title: 'Midweek club', dayOfWeek: 3, date: '2026-09-23', startTime: '19:00' },
    { sessionId: 'club-partial', title: 'Club circuit', dayOfWeek: 5, date: '2026-09-25', startTime: '18:00', category: 'strength', durationMin: 60 },
    { sessionId: 'club-social', title: 'Social club', dayOfWeek: 0, date: '2026-09-27', startTime: '09:30', notes: 'Meet by the gate.' },
  ])
  assert.equal(Object.hasOwn(input.preferences, 'strengthPreference'), false)
  assert.equal(input.profile.notes, athlete.notes)
  assert.deepEqual(input.equipment, { items: athlete.equipmentDetails.map(detail => ({
    id: detail.id,
    label: detail.label,
    constraints: detail.constraints,
    ...(detail.notes ? { notes: detail.notes } : {}),
  })) })
  assert.doesNotMatch(prompt.prompt, /full.body/i)
  for (const expected of ['Midweek club', 'Club circuit', 'Social club', 'Meet by the gate.', 'Adjustable dumbbells', 'Up to 20 kg', 'Pair available at home.', 'Resistance bands']) {
    assert.ok(prompt.messages[1].content.includes(expected), `Missing prompt context: ${expected}`)
  }
})

test('minimal club commitments do not require invented workouts and mixed rich clubs remain strictly validated', () => {
  const minimal = { id: 'club-social', title: 'Social club', dayOfWeek: 0, startTime: '09:30', notes: 'Meet by the gate.' }
  const targetWeekStart = parseLocalDate('2026-09-21')
  for (const clubSessions of [[minimal], [...createAthlete().clubSessions, minimal]]) {
    const athlete = parseAthleteProfile({ ...createAthlete(), strengthPreference: undefined, clubSessions })
    const fixed = buildExpectedFixedClubSessions(athlete, targetWeekStart)
    const contract = buildWeekContractExample('initial', targetWeekStart, fixed)
    const options = { athlete, targetWeekStart, expectedWeekType: 'initial' as const }
    const preview = previewAiWeekHandoff(JSON.stringify(contract), options)

    assert.equal(preview.ok, true)
    if (!preview.ok) continue
    assert.equal(preview.bundle.weekPlan.workouts.some(workout => workout.title === minimal.title), false)
    assert.equal(preview.bundle.weekPlan.workouts.filter(workout => workout.source === 'club').length, fixed.length)
    assert.equal(athlete.clubSessions.some(session => session.id === minimal.id), true)

    if (fixed.length) {
      const withoutRichClub = previewAiWeekHandoff(JSON.stringify({
        ...contract,
        workouts: contract.workouts.filter(workout => workout.source.kind !== 'fixed_club'),
      }), options)
      assert.equal(withoutRichClub.ok, false)
      if (!withoutRichClub.ok) assert.match(withoutRichClub.issues.map(issue => issue.message).join('\n'), /Missing fixed club/i)
    }
  }
})

test('handoff rejects a fabricated fixed-club workout for an underspecified timetable commitment', () => {
  const athlete = parseAthleteProfile({
    ...createAthlete(),
    clubSessions: [{ id: 'club-social', title: 'Social club', dayOfWeek: 0, startTime: '09:30' }],
  })
  const fabricated = buildWeekContractExample('initial', '2026-09-21', [{
    sessionId: 'club-social',
    label: 'Social club',
    date: '2026-09-27',
    startTime: '09:30',
    durationMin: 60,
    category: 'aerobic',
  }])
  const preview = previewAiWeekHandoff(JSON.stringify(fabricated), {
    athlete,
    targetWeekStart: parseLocalDate('2026-09-21'),
    expectedWeekType: 'initial',
  })
  assert.equal(preview.ok, false)
  if (!preview.ok) assert.match(preview.issues.map(issue => issue.message).join('\n'), /Unexpected fixed club/)
})

test('continuation prompt input carries previous workouts, logs, and tracked moved added deleted changes', () => {
  const athlete = createAthlete()
  athlete.clubSessions.push({ id: 'club-social', title: 'Social club', dayOfWeek: 0, startTime: '09:30', notes: 'Meet by the gate.' })
  const weekPlan = parseWeekPlan({
    version: 1,
    id: 'week-2026-09-08-athlete-amy',
    athleteId: 'athlete-amy',
    weekStart: '2026-09-08',
    title: 'Week of 2026-09-08',
    goal: 'Stay consistent during a busy week.',
    workouts: [
      {
        version: 1,
        id: 'run-easy',
        athleteId: 'athlete-amy',
        weekPlanId: 'week-2026-09-08-athlete-amy',
        scheduledDate: '2026-09-09',
        startTime: '07:00',
        category: 'aerobic',
        source: 'manual',
        title: 'Easy run',
        purpose: 'Keep aerobic work easy before the club session.',
        expectedDurationMin: 40,
        warmup: [{ id: 'run-easy-warm', title: 'Jog', target: { minutes: 8 } }],
        main: [{ id: 'run-easy-main', title: 'Easy aerobic block', detail: 'Relaxed pace.', target: { minutes: 27, effort: 'easy' } }],
        cooldown: [{ id: 'run-easy-cool', title: 'Walk', target: { minutes: 5 } }],
      },
      {
        version: 1,
        id: 'mobility-added',
        athleteId: 'athlete-amy',
        weekPlanId: 'week-2026-09-08-athlete-amy',
        scheduledDate: '2026-09-11',
        startTime: '20:00',
        category: 'mobility',
        source: 'ai',
        title: 'Mobility reset',
        purpose: 'Recover after travel.',
        expectedDurationMin: 20,
        warmup: [{ id: 'mobility-added-warm', title: 'Breathing', target: { minutes: 4 } }],
        main: [{ id: 'mobility-added-main', title: 'Flow work', detail: 'Move smoothly.', target: { minutes: 12 } }],
        cooldown: [{ id: 'mobility-added-cool', title: 'Reset', target: { minutes: 4 } }],
      },
    ],
  })
  const workoutLogs = [
    parseWorkoutLog({
      version: 1,
      id: 'run-easy-log',
      athleteId: 'athlete-amy',
      weekPlanId: 'week-2026-09-08-athlete-amy',
      workoutId: 'run-easy',
      loggedOn: '2026-09-09',
      outcome: 'partial',
      effortRating: 7,
      metrics: {
        durationMin: 34,
        paceSecondsPerKm: 300,
        averageHeartRate: 152,
      },
      steps: [
        {
          stepId: 'run-easy-main',
          completedSeconds: 1_080,
          completedPaceSecondsPerKm: 290,
          notes: 'Felt better after 10 minutes.',
        },
      ],
      notes: 'Cut the run short because of work.',
    }),
  ]
  const trackedChanges: TrackedWorkoutChange[] = [
    {
      workoutId: 'run-easy',
      type: 'moved',
      fromDate: parseLocalDate('2026-09-08'),
      toDate: parseLocalDate('2026-09-09'),
      note: 'Morning meeting moved the run back a day.',
    },
    {
      workoutId: 'mobility-added',
      type: 'added',
      toDate: parseLocalDate('2026-09-11'),
      note: 'Added after travel stiffness.',
    },
    {
      workoutId: 'strength-deleted',
      type: 'deleted',
      fromDate: parseLocalDate('2026-09-12'),
      note: 'Removed because of travel.',
      workoutSnapshot: createDeletedWorkout(weekPlan.id),
    },
  ]

  const input = buildContinuationPromptInputFromAthleteProfile(
    athlete,
    parseLocalDate('2026-09-15'),
    weekPlan,
    workoutLogs,
    { trackedChanges },
  )

  assert.match(input.previousWeek.summary ?? '', /3 prior workouts/)
  assert.match(input.previousWeek.summary ?? '', /1 partial/)
  assert.match(input.previousWeek.summary ?? '', /1 moved, 1 added, 1 deleted/)
  assert.equal(input.previousWeek.workouts.length, 3)
  assert.equal(input.previousWeek.workouts[0]?.original.source.kind, 'ai')
  assert.match(input.previousWeek.workouts[0]?.actualLog?.effort ?? '', /RPE 7\/10/)
  assert.match(input.previousWeek.workouts[0]?.actualLog?.notes ?? '', /Average heart rate 152 bpm/)
  assert.match(input.previousWeek.workouts[0]?.actualLog?.steps?.[0]?.note ?? '', /Completed pace: 4:50\/km/)
  assert.deepEqual(input.clubTimetableCommitments, [{
    sessionId: 'club-social',
    title: 'Social club',
    dayOfWeek: 0,
    date: '2026-09-20',
    startTime: '09:30',
    notes: 'Meet by the gate.',
  }])
})

test('handoff preview converts the AI contract into a week import bundle and preserves unsupported metadata explicitly', () => {
  const athlete = createAthlete()
  const fixedClubSessions = buildExpectedFixedClubSessions(athlete, parseLocalDate('2026-09-21'))
  const example = buildWeekContractExample('continuation', '2026-09-21', fixedClubSessions)
  const contract = example.workouts.map(workout =>
    workout.id === 'aerobic-1'
      ? {
        ...workout,
        title: 'Very long aerobic workout title that needs trimming because the imported domain title is shorter than the raw AI instructional title',
        modality: 'running',
        notes: 'Use a flat route and stay patient.',
        main: [{
          ...workout.main[0]!,
          instruction: 'Run 4 x 6 minutes at a controlled but clearly moderate effort while keeping cadence tall and relaxed over the final rep.',
          effort: 'moderate',
          pace: '5:00/km',
          notes: 'Do not sprint the last interval.',
        }],
      }
      : workout)
  const preview = previewAiWeekHandoff(JSON.stringify({
    ...example,
    summary: 'Keep the rhythm from last week but trim the intensity after the track session.',
    workouts: contract,
  }), {
    athlete,
    targetWeekStart: parseLocalDate('2026-09-21'),
    expectedWeekType: 'continuation',
  })

  assert.equal(preview.ok, true)
  if (!preview.ok) return
  const importedAerobic = preview.bundle.weekPlan.workouts.find(workout => workout.id === 'aerobic-1')
  assert.ok(importedAerobic)
  assert.equal(importedAerobic.source, 'ai')
  assert.equal(importedAerobic.main[0]?.target?.effort, 'steady')
  assert.match(importedAerobic.main[0]?.detail ?? '', /Pace: 5:00\/km/)
  assert.match(importedAerobic.main[0]?.detail ?? '', /Original effort: moderate/)
  assert.match(importedAerobic.notes ?? '', /Modality: running/)
  assert.match(importedAerobic.notes ?? '', /Use a flat route and stay patient\./)
  const fixedClubWorkout = preview.bundle.weekPlan.workouts.find(workout => workout.source === 'club')
  assert.equal(fixedClubWorkout?.fixedClubSession?.scope, 'Track group')
  assert.deepEqual(preview.preview.summary, [
    '4 workouts ready to import',
    '1 fixed club sessions validated',
    'AI summary preserved in week notes',
  ])
})

test('handoff preview rejects fixed club cards when deterministic category metadata is missing', () => {
  const athlete = createAthlete()
  const fixedClubSessions = buildExpectedFixedClubSessions(athlete, parseLocalDate('2026-09-21'))
  const example = buildWeekContractExample('initial', '2026-09-21', fixedClubSessions)
  const broken = {
    ...example,
    workouts: example.workouts.map(workout =>
      workout.source.kind === 'fixed_club'
        ? {
          ...workout,
          source: {
            ...workout.source,
            fixedClub: {
              ...workout.source.fixedClub,
              category: undefined,
            },
          },
        }
        : workout),
  }

  const preview = previewAiWeekHandoff(JSON.stringify(broken), {
    athlete,
    targetWeekStart: parseLocalDate('2026-09-21'),
    expectedWeekType: 'initial',
  })

  assert.equal(preview.ok, false)
  if (preview.ok) return
  assert.ok(preview.issues.some(issue => /club-track.*category/.test(issue.message)), JSON.stringify(preview.issues))
})

test('clipboard helper reports both success and rejection explicitly', async () => {
  const writes: string[] = []
  const copied = await writeTextToClipboard('example', {
    async writeText(value) {
      writes.push(value)
    },
  })
  assert.deepEqual(writes, ['example'])
  assert.equal(copied.ok, true)

  const rejected = await writeTextToClipboard('example', {
    async writeText() {
      throw new Error('NotAllowedError: clipboard permission rejected')
    },
  })
  assert.equal(rejected.ok, false)
  assert.match(rejected.message, /Clipboard access was rejected/)
})

function v2Fixture() {
  return {
    format: 'hybrid-coach-week', version: 2, weekType: 'initial', targetWeek: buildTargetWeek('2026-09-14'),
    summary: 'A conservative supporting week.',
    athleteContext: {
      asOf: '2026-09-09', event: 'Club athlete preparing for trials',
      recentTraining: { weeks: 6, aerobicMinutes: 25, strengthMinutes: 35, mobilityMinutes: 0, clubMinutes: 0 },
      sessionLimits: [{ dayOfWeek: 1, maxMinutes: 45 }],
    },
    goalAssessment: { status: 'conditional', rationale: 'Selection depends on more than conditioning.', unknowns: ['Trial date'], nextMilestone: 'Speak with the club coach.' },
    workouts: [{
      id: 'strength-1', date: '2026-09-14', startTime: '18:00', category: 'strength', title: 'Strength A',
      purpose: 'General preparation', expectedDuration: 30,
      warmup: [{ id: 'warm', instruction: 'Prepare gently', durationMin: 5, estimatedTotalMin: 5 }],
      main: [{ id: 'main', instruction: 'Dumbbell bench press', sets: 2, reps: 8, loadKg: 12, loadBasis: 'per_implement', repBasis: 'total', estimatedTotalMin: 20 }],
      cooldown: [{ id: 'cool', instruction: 'Walk easily', durationMin: 5, estimatedTotalMin: 5 }],
      source: { kind: 'ai' },
    }],
  }
}

test('v2 preview proposes context without mutation and carries units, assessment and review into continuation', () => {
  const athlete = parseAthleteProfile({ ...createAthlete(), clubSessions: [] })
  const json = v2Fixture()
  const result = previewAiWeekHandoff(JSON.stringify(json), { athlete, targetWeekStart: parseLocalDate('2026-09-14'), expectedWeekType: 'initial' })
  assert.equal(result.ok, true, JSON.stringify(result.issues))
  if (!result.ok) return
  assert.equal(athlete.planningContext, undefined)
  assert.deepEqual(result.bundle.athleteProfile?.planningContext, json.athleteContext)
  assert.equal(result.preview.quality?.knownMinutes, 30)
  assert.ok(result.preview.quality?.proposedFacts.some(item => item.value === json.athleteContext.event))
  assert.equal(result.bundle.weekPlan.workouts[0]?.main[0]?.target?.loadBasis, 'per_implement')
  assert.equal(result.bundle.weekPlan.workouts[0]?.main[0]?.estimatedTotalMin, 20)
  const week = parseWeekPlan({ ...result.bundle.weekPlan, review: { reflection: 'Felt manageable', nextFocus: 'Retain this load', metrics: [] } })
  const log = parseWorkoutLog({
    version: 1, id: 'first-log', athleteId: athlete.id, weekPlanId: week.id, workoutId: 'strength-1',
    loggedOn: '2026-09-14', outcome: 'completed',
    steps: [{ stepId: 'main', loadKg: 12, loadBasis: 'per_implement', repBasis: 'total', completedSets: 2, completedReps: 8, notes: '12 kg each felt good' }],
  })
  const continuation = buildContinuationPromptInputFromAthleteProfile(result.bundle.athleteProfile!, parseLocalDate('2026-09-21'), week, [log])
  assert.deepEqual(continuation.profile.planningContext, json.athleteContext)
  assert.equal(continuation.previousWeek.review?.reflection, 'Felt manageable')
  assert.equal(continuation.previousWeek.workouts[0]?.original.main[0]?.loadBasis, 'per_implement')
  assert.equal(continuation.previousWeek.workouts[0]?.actualLog?.steps?.[0]?.loadKg, 12)
  assert.equal(continuation.previousWeek.workouts[0]?.actualLog?.steps?.[0]?.loadBasis, 'per_implement')
})

test('legacy v1 plans remain readable with unchanged, unspecified weight conventions', () => {
  const current = v2Fixture()
  const json = {
    ...current, version: 1, athleteContext: undefined, goalAssessment: undefined,
    workouts: current.workouts.map(workout => ({
      ...workout,
      warmup: [{ id: 'warm', instruction: 'Prepare gently', durationMin: 5 }],
      main: [{ id: 'main', instruction: 'Dumbbell bench press', sets: 2, reps: 8, loadKg: 24 }],
      cooldown: [{ id: 'cool', instruction: 'Walk easily', durationMin: 5 }],
    })),
  }
  const result = previewAiWeekHandoff(JSON.stringify(json), {
    athlete: parseAthleteProfile({ ...createAthlete(), clubSessions: [] }),
    targetWeekStart: parseLocalDate('2026-09-14'), expectedWeekType: 'initial',
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.bundle.weekPlan.workouts[0]?.main[0]?.target?.loadKg, 24)
  assert.equal(result.bundle.weekPlan.workouts[0]?.main[0]?.target?.loadBasis, undefined)
  assert.ok(result.issues.some(issue => issue.id === 'load-basis-unknown'))
})

test('AI context cannot add clubs or overwrite existing scheduled club duration', () => {
  const athlete = createAthlete()
  for (const clubLoads of [[{ sessionId: 'invented', durationMin: 90 }], [{ sessionId: 'club-track', durationMin: 90 }]]) {
    const json = buildWeekContractExample('initial', '2026-09-14', buildExpectedFixedClubSessions(athlete, parseLocalDate('2026-09-14')))
    const result = previewAiWeekHandoff(JSON.stringify({ ...json, athleteContext: { asOf: '2026-09-09', clubLoads } }), {
      athlete, targetWeekStart: parseLocalDate('2026-09-14'), expectedWeekType: 'initial',
    })
    assert.equal(result.ok, false)
  }
})
