import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateBlock } from './block.ts'
import { adaptCalendarWeek, calendarSafety, nextCalendarInput } from './calendar.ts'
import type { CalendarWeek } from './calendar.ts'
import {
  LIBRARY_VERSION, MAX_LOGGED_SETS_PER_BLOCK, PROGRAM_LIBRARY_VERSION, PROGRAM_POLICY,
  PROGRAM_POLICY_VERSION,
} from './constants.ts'
import { DEFAULT_LIBRARY, LEGACY_LIBRARY, libraryForVersion } from './library.ts'
import { observedSessionWork, predictSessionLoad } from './load.ts'
import { workoutLogOverruns } from './observations.ts'
import { fixedSessions, planWeek, requestedSessions } from './planner.ts'
import {
  availableExerciseMetadata, availableSportDrills, exerciseDefaultPrescription, exerciseMetadata,
  EXERCISE_METADATA, recommendProgram,
} from './program.ts'
import { checkSafety } from './safety.ts'
import type { AthleteState, PlanWeekInput, SessionLog, WorkoutSession } from './types.ts'
import {
  parseAthlete, parseBlockLog, parseLibrary, parsePlanWeekInput, parseProgramConfig, parseSession,
  parseSessionLog, parseWorkoutBlock, validateBlockLogs,
} from './validation.ts'

function fixture(goal: 'balanced' | 'dodgeball' = 'dodgeball'): PlanWeekInput {
  const athlete: AthleteState = {
    baseline: {
      asOf: '2026-09-07', weeklyRunMinutes: 90, longestRunMinutes: 30, runsPerWeek: 3,
      liftsPerWeek: 2, liftDurationMin: 45, exercises: [],
    },
    calibration: { version: 1, costMultiplier: 1, observationCount: 0 },
    availableDays: [0, 1, 2, 3, 4, 5, 6],
    equipment: ['bodyweight', 'kettlebell'],
    weeklyTimeBudgetMin: 300,
    defaultStartTime: '07:00',
    aggressiveness: 'standard',
    residual: { asOfDate: '2026-09-07', asOfTime: '00:00', load: { systemic: 0, structural: 0 } },
    safetyHold: null,
    program: {
      version: 1,
      libraryVersion: PROGRAM_LIBRARY_VERSION,
      goal,
      resources: ['bodyweight', 'floor_space', 'kettlebell', 'bench', 'carry_space', 'dodgeball', 'court_space', 'safe_target'],
      conditioningBaselines: [{ modality: 'row', weeklyMinutes: 40, longestSessionMinutes: 40, sessionsPerWeek: 1 }],
      includeMobility: true,
      ...(goal === 'dodgeball' ? { comfortableThrowsPerPractice: 30 } : {}),
    },
  }
  const goalInput = {
    label: goal === 'dodgeball' ? 'Dodgeball league' : 'General training',
    peakDate: '2026-11-29',
    qualityBias: ['change_of_direction', 'shoulder_durability'] as const,
    protectedExerciseIds: [],
    fixedCommitments: goal === 'dodgeball' ? [{
      id: 'dodgeball-practice', label: 'Dodgeball practice', dayOfWeek: 2 as const,
      startTime: '19:00', durationMin: 60, discipline: 'sport' as const, modality: 'court_sport' as const,
      estimatedLoad: { systemic: 180, structural: 120 },
    }] : [],
  }
  const block = generateBlock(athlete, goalInput, '2026-09-07', DEFAULT_LIBRARY)
  return parsePlanWeekInput({
    athlete, block, weekIndex: 0, library: DEFAULT_LIBRARY,
    context: { recentSessions: [], completedWeeks: [], neighboringSessions: [], pinnedSessions: [] },
  })
}

test('legacy and extensible libraries have immutable identities and saved legacy contracts remain valid', () => {
  assert.equal(LEGACY_LIBRARY.version, LIBRARY_VERSION)
  assert.equal(DEFAULT_LIBRARY.version, PROGRAM_LIBRARY_VERSION)
  assert.notEqual(DEFAULT_LIBRARY, LEGACY_LIBRARY)
  assert.ok(Object.isFrozen(LEGACY_LIBRARY))
  assert.ok(Object.isFrozen(DEFAULT_LIBRARY.exercises[0]))
  assert.equal(DEFAULT_LIBRARY.exercises.length >= 35 && DEFAULT_LIBRARY.exercises.length <= 50, true)
  assert.equal(Object.keys(EXERCISE_METADATA).length, DEFAULT_LIBRARY.exercises.length)
  assert.equal(libraryForVersion(LIBRARY_VERSION), LEGACY_LIBRARY)
  assert.equal(libraryForVersion(PROGRAM_LIBRARY_VERSION), DEFAULT_LIBRARY)
  assert.throws(() => libraryForVersion('forged'))
  const legacy = {
    version: LIBRARY_VERSION,
    exercises: [{
      id: 'squat', name: 'Squat', pattern: 'knee_dominant', equipment: ['bodyweight'],
      coefficients: { systemic: 1, structural: 1 }, competesWithRunning: true, highSkill: false,
    }],
  }
  assert.deepEqual(parseLibrary(legacy), legacy)
  const athlete: AthleteState = {
    baseline: {
      asOf: '2026-09-01', weeklyRunMinutes: 90, longestRunMinutes: 30, runsPerWeek: 3,
      liftsPerWeek: 2, liftDurationMin: 45,
      exercises: [{ exerciseId: 'back-squat', date: '2026-09-01', weightKg: 40,
        sets: 3, reps: 5, actualRPE: 7, experienceMonths: 24 }],
    },
    calibration: { version: 1, costMultiplier: 1, observationCount: 0 },
    availableDays: [0, 1, 2, 3, 4, 5, 6], equipment: ['barbell'],
    weeklyTimeBudgetMin: 300, defaultStartTime: '07:00', aggressiveness: 'standard',
    residual: { asOfDate: '2026-09-01', asOfTime: '00:00', load: { systemic: 0, structural: 0 } },
    safetyHold: null,
  }
  const goal = {
    label: 'Legacy', peakDate: '2026-11-29', qualityBias: ['aerobic_base'] as const,
    protectedExerciseIds: ['back-squat'], fixedCommitments: [],
  }
  const legacyBlock = generateBlock(athlete, goal, '2026-09-07', LEGACY_LIBRARY)
  const defaultBlock = generateBlock(athlete, goal, '2026-09-07', DEFAULT_LIBRARY)
  assert.deepEqual(defaultBlock, legacyBlock)
  const context = { recentSessions: [], completedWeeks: [], neighboringSessions: [], pinnedSessions: [] }
  assert.deepEqual(
    planWeek({ athlete, block: defaultBlock, weekIndex: 0, library: DEFAULT_LIBRARY, context }),
    planWeek({ athlete, block: legacyBlock, weekIndex: 0, library: LEGACY_LIBRARY, context }),
  )
})

test('resource and goal recommendations are deterministic for no-kit and kettlebell-only programs', () => {
  const noKit = recommendProgram(['bodyweight', 'floor_space'], 'balanced')
  assert.deepEqual(recommendProgram(['floor_space', 'bodyweight'], 'balanced'), noKit)
  assert.ok(noKit.exerciseIds.every(id => {
    const item = DEFAULT_LIBRARY.exercises.find(exercise => exercise.id === id)!
    return item.requirements!.every(resource => ['bodyweight', 'floor_space'].includes(resource))
  }))
  const kettlebell = recommendProgram(
    ['bodyweight', 'floor_space', 'kettlebell', 'bench', 'carry_space'], 'dodgeball',
  )
  assert.ok(kettlebell.exerciseIds.some(id => id.startsWith('kettlebell-')))
  assert.notDeepEqual(kettlebell.templates[0].exerciseIds, kettlebell.templates[1].exerciseIds)
  assert.ok(kettlebell.exerciseIds.length <= 7)
  assert.deepEqual(new Set(kettlebell.templates.flatMap(template => template.exerciseIds)), new Set(kettlebell.exerciseIds))
  const carry = kettlebell.exerciseIds.find(id => exerciseMetadata(id).template === 'carry')!
  assert.ok(carry)
  assert.ok(kettlebell.templates.some(template => template.exerciseIds.includes(carry)))
  const selected = [
    'bodyweight-split-squat', 'kettlebell-deadlift', 'push-up', 'kettlebell-row',
    'dead-bug', 'kettlebell-suitcase-carry', 'kettlebell-floor-press',
  ]
  const customized = recommendProgram(
    ['bodyweight', 'floor_space', 'kettlebell', 'bench', 'carry_space'], 'dodgeball',
    DEFAULT_LIBRARY, selected,
  )
  assert.deepEqual(new Set(customized.exerciseIds), new Set(selected))
  assert.ok(customized.templates.some(template => template.exerciseIds.includes('kettlebell-suitcase-carry')))
  assert.equal(PROGRAM_POLICY.minSelectedExercises, 4)
  assert.equal(PROGRAM_POLICY.maxSelectedExercises, 7)
  assert.throws(() => recommendProgram(
    ['bodyweight', 'floor_space'], 'balanced', DEFAULT_LIBRARY,
    ['bodyweight-squat', 'push-up', 'dead-bug'],
  ), /Select 4 to 7/)
  const metadata = availableExerciseMetadata(['bodyweight', 'floor_space'])
  assert.ok(metadata.every(item => item.label && item.requirements.length && item.profile.version === 'scheduling-estimate-1'))
  assert.equal(exerciseDefaultPrescription('front-plank').prescription.unit, 'seconds')
  assert.ok(DEFAULT_LIBRARY.exercises.every(exercise => {
    const metadata = exerciseMetadata(exercise.id)
    return metadata.description.length > 0 && metadata.focusCues.length > 0 && metadata.purpose.length > 0
  }))
  assert.equal(exerciseMetadata('back-squat-slow-lowering').execution.style, 'slow_lowering')
  assert.equal(exerciseMetadata('back-squat-slow-lowering').execution.eccentricSeconds, 3)
  assert.equal(exerciseMetadata('goblet-squat-fast-concentric').execution.style, 'fast_concentric_intent')
  assert.equal(exerciseMetadata('goblet-squat-fast-concentric').execution.ballistic, false)
  assert.equal(exerciseMetadata('snatch').execution.style, 'ballistic_logging_only')
  assert.notDeepEqual(
    exerciseDefaultPrescription('goblet-squat-fast-concentric').schedulingEstimate,
    exerciseDefaultPrescription('goblet-squat').schedulingEstimate,
  )
  assert.equal(availableSportDrills(['dodgeball', 'court_space', 'safe_target']).length, 1)
  assert.equal(availableSportDrills(['dodgeball', 'court_space']).length, 0)
})

test('program config, library profiles and new discriminated values reject unknown or forged data', () => {
  const input = fixture()
  assert.deepEqual(parseProgramConfig(input.athlete.program), input.athlete.program)
  const library = structuredClone(DEFAULT_LIBRARY)
  library.exercises[0]!.profile!.schedulingEstimate.systemic++
  assert.throws(() => parseLibrary(library), /must exactly match coefficients/)
  const forgedTemplate = structuredClone(DEFAULT_LIBRARY)
  forgedTemplate.exercises[0]!.template = 'pull'
  assert.throws(() => parseLibrary(forgedTemplate), /reviewed built-in catalog/)
  const wrongVersion = structuredClone(input)
  wrongVersion.athlete.program!.libraryVersion = 'forged' as typeof PROGRAM_LIBRARY_VERSION
  assert.throws(() => parsePlanWeekInput(wrongVersion), /libraryVersion/)
  assert.throws(() => parseWorkoutBlock({
    unit: 'throws', drillId: 'dodgeball-controlled-target-throw', throws: 10,
    intent: 'controlled_technique', embedded: false,
  }), /must be true/)
  assert.throws(() => parseBlockLog({ unit: 'seconds', blockIndex: 0, exerciseId: 'x', throws: 10 }), /unknown field throws/)
  assert.throws(() => parseProgramConfig({
    ...input.athlete.program,
    selectedExerciseIds: DEFAULT_LIBRARY.exercises.filter(exercise => !exercise.highSkill).slice(0, 8).map(exercise => exercise.id),
  }), /4 to 7 items/)
})

test('opt-in plans freeze differentiated A/B templates and preserve legacy work ceilings', () => {
  const input = fixture()
  assert.equal(input.block.policyVersion, PROGRAM_POLICY_VERSION)
  assert.equal(input.block.libraryVersion, PROGRAM_LIBRARY_VERSION)
  assert.equal(input.block.anchors.length, 0)
  assert.equal(input.block.program?.selectedExerciseIds?.length, new Set(
    input.block.workoutTemplates!.flatMap(template => template.exerciseIds),
  ).size)
  assert.notDeepEqual(input.block.workoutTemplates![0]!.exerciseIds, input.block.workoutTemplates![1]!.exerciseIds)
  const first = planWeek(input)
  assert.deepEqual(planWeek(input), first)
  assert.equal(first.safety.passed, true)
  const workouts = first.sessions.filter((session): session is WorkoutSession =>
    session.kind === 'workout' && session.discipline === 'strength')
  assert.equal(workouts.length, 2)
  assert.notEqual(workouts[0]!.label, workouts[1]!.label)
  for (const workout of workouts) {
    assert.ok(workout.blocks.reduce((sum, block) => sum + ('sets' in block ? block.sets : 0), 0) <= 8)
    assert.ok(workout.blocks.filter(block => block.unit === 'reps')
      .reduce((sum, block) => sum + block.sets * block.reps, 0) <= 64)
  }
  assert.ok(workouts.some(workout => workout.blocks.some(block => block.unit === 'seconds' && block.role === 'mobility')))
  assert.ok(workouts.some(workout => workout.blocks.some(block => block.unit === 'seconds' && block.role === 'carry')))
  const later = planWeek({ ...input, weekIndex: 1 })
  assert.equal(later.safety.passed, true)
  for (const workout of later.sessions.filter((session): session is WorkoutSession =>
    session.kind === 'workout' && session.discipline === 'strength')) {
    assert.ok(workout.blocks.reduce((sum, block) => sum + ('sets' in block ? block.sets : 0), 0) <= 8)
    assert.ok(workout.blocks.filter((block): block is Extract<typeof block, { unit: 'reps' }> => block.unit === 'reps')
      .reduce((sum, block) => sum + block.sets * block.reps, 0) <= 64)
  }
  const tampered = structuredClone(first.sessions)
  const rep = tampered.find((session): session is WorkoutSession =>
    session.kind === 'workout' && session.discipline === 'strength')!.blocks
    .find(block => block.unit === 'reps')!
  rep.sets = 4
  assert.equal(checkSafety(input, tampered).passed, false)
  const changedExecution = structuredClone(first.sessions)
  const executionBlock = changedExecution.find((session): session is WorkoutSession =>
    session.kind === 'workout' && session.discipline === 'strength')!.blocks.find(block => block.unit === 'reps')!
  if (executionBlock.unit === 'reps') executionBlock.executionStyle = 'fast_concentric_intent'
  assert.equal(checkSafety(input, changedExecution).passed, false)
})

test('conditioning requires its own modality baseline and never borrows running minutes', () => {
  const input = fixture('balanced')
  const sessions = requestedSessions(input)
  const row = sessions.find(session => session.kind === 'conditioning' && session.modality === 'row')!
  assert.equal(row.modality, 'row')
  assert.equal(row.durationMin, 24)
  const runs = sessions.filter(session => session.kind === 'conditioning' && session.modality === 'run_road')
  assert.equal(runs.length, 3)
  assert.equal(runs.reduce((sum, session) => sum + session.durationMin, 0), 54)
  assert.equal(sessions.some(session => session.kind === 'run'), false)

  const runningOnlyAthlete = structuredClone(input.athlete)
  runningOnlyAthlete.program!.conditioningBaselines = []
  const runningOnlyBlock = generateBlock(runningOnlyAthlete, input.block.goal, input.block.startDate, DEFAULT_LIBRARY)
  const runningOnly = requestedSessions(parsePlanWeekInput({
    ...input, athlete: runningOnlyAthlete, block: runningOnlyBlock,
  }))
  assert.equal(runningOnly.filter(session => session.kind === 'conditioning' && session.discipline === 'run').length, 3)
  assert.equal(runningOnly.some(session => session.kind === 'conditioning' && session.modality === 'row'), false)

  const explicitRunAthlete = structuredClone(input.athlete)
  explicitRunAthlete.program!.conditioningBaselines = [
    ...explicitRunAthlete.program!.conditioningBaselines,
    { modality: 'run_road', weeklyMinutes: 90, longestSessionMinutes: 30, sessionsPerWeek: 3 },
  ]
  const explicitRunBlock = generateBlock(explicitRunAthlete, input.block.goal, input.block.startDate, DEFAULT_LIBRARY)
  const explicitRuns = requestedSessions(parsePlanWeekInput({
    ...input, athlete: explicitRunAthlete, block: explicitRunBlock,
  })).filter(session => session.kind === 'conditioning' && session.discipline === 'run')
  assert.equal(explicitRuns.length, 3, 'Equivalent explicit running replaces rather than duplicates the legacy baseline')

  const mismatchedRun = structuredClone(explicitRunAthlete)
  mismatchedRun.program!.conditioningBaselines = mismatchedRun.program!.conditioningBaselines.map(baseline =>
    baseline.modality === 'run_road' ? { ...baseline, weeklyMinutes: 91 } : baseline)
  assert.throws(() => parseAthlete(mismatchedRun), /must exactly match baseline/)
  const forged = structuredClone(sessions)
  const ski = { ...row, id: 'forged-ski', modality: 'ski_erg' as const }
  forged.push(ski)
  const result = checkSafety(input, forged)
  assert.equal(result.passed, false)
  assert.ok(result.violations.some(item => item.rule === 'conditioningBaseline'))
})

test('dodgeball throws stay inside fixed practice cost/time, calibrate cautiously, and respect logs', () => {
  const input = fixture()
  const practice = fixedSessions(input)[0]!
  assert.equal(practice.kind, 'workout')
  assert.equal(practice.durationMin, 60)
  assert.deepEqual(practice.predictedLoad, { systemic: 180, structural: 120 })
  if (practice.kind !== 'workout') return
  assert.equal(practice.blocks[0]!.unit, 'throws')
  assert.equal(practice.blocks[0]!.unit === 'throws' && practice.blocks[0]!.throws, 15)
  assert.equal(practice.isCalibration, true)
  const throwLog: SessionLog = {
    sessionId: practice.id, status: 'completed', actualDurationMin: 60, actualEffort: 5,
    blockLogs: [{ unit: 'throws', blockIndex: 0, drillId: 'dodgeball-controlled-target-throw', throws: 15 }],
    painFlag: false, notes: '',
  }
  const next = parsePlanWeekInput({
    ...input, weekIndex: 1,
    context: { ...input.context, recentSessions: [{ session: practice, log: throwLog }] },
  })

  const calibrated = fixedSessions(next)[0]!
  assert.equal(calibrated.kind === 'workout' && calibrated.blocks[0]!.unit === 'throws'
    && calibrated.blocks[0]!.throws, 30)
  assert.equal(calibrated.isCalibration, false)
  const excessive = structuredClone(calibrated)
  if (excessive.kind === 'workout' && excessive.blocks[0]!.unit === 'throws') excessive.blocks[0]!.throws = 31
  assert.equal(checkSafety(next, [excessive]).passed, false)
  const incompatible = structuredClone(next)
  incompatible.context.recentSessions[0]!.log!.blockLogs = [{
    unit: 'seconds', blockIndex: 0, exerciseId: 'front-plank', seconds: 15,
  }]
  assert.throws(() => parsePlanWeekInput(incompatible), /must match prescribed throws unit/)

  const overrunInput = fixture()
  overrunInput.athlete.program!.comfortableThrowsPerPractice = 60
  overrunInput.block = generateBlock(
    overrunInput.athlete, overrunInput.block.goal, overrunInput.block.startDate, DEFAULT_LIBRARY,
  )
  const calibrationPractice = fixedSessions(overrunInput)[0]!
  assert.equal(calibrationPractice.kind, 'workout')
  if (calibrationPractice.kind !== 'workout' || calibrationPractice.blocks[0]!.unit !== 'throws') return
  assert.equal(calibrationPractice.blocks[0].throws, 30)
  const overrunLog: SessionLog = {
    sessionId: calibrationPractice.id, status: 'completed', actualDurationMin: 60, actualEffort: 5,
    blockLogs: [{ unit: 'throws', blockIndex: 0, drillId: calibrationPractice.blocks[0].drillId, throws: 60 }],
    painFlag: false, notes: '',
  }
  assert.deepEqual(validateBlockLogs(calibrationPractice, overrunLog), overrunLog)
  const afterOverrun = parsePlanWeekInput({
    ...overrunInput, weekIndex: 1,
    context: { ...overrunInput.context, recentSessions: [{ session: calibrationPractice, log: overrunLog }] },
  })
  const held = fixedSessions(afterOverrun)[0]!
  assert.equal(held.kind === 'workout' && held.blocks[0]!.unit === 'throws' && held.blocks[0].throws, 30)
  assert.equal(held.isCalibration, true, 'An overrun cannot clear calibration or increase the next prescription')
  assert.deepEqual(observedSessionWork({ session: calibrationPractice, log: overrunLog }, afterOverrun)?.load,
    calibrationPractice.predictedLoad, 'Embedded throws do not double-count the fixed practice cost')
  assert.ok(planWeek(afterOverrun).warnings.some(warning => /exceeded the prescription/.test(warning)))
})

test('dodgeball selection does not require or invent throwing exposure', () => {
  const configured = fixture()
  const athlete = structuredClone(configured.athlete)
  delete athlete.program!.comfortableThrowsPerPractice
  athlete.program!.resources = athlete.program!.resources.filter(resource =>
    !['dodgeball', 'court_space', 'safe_target'].includes(resource))
  assert.doesNotThrow(() => parseProgramConfig(athlete.program))
  const withPractice = generateBlock(athlete, configured.block.goal, configured.block.startDate, DEFAULT_LIBRARY)
  const input = parsePlanWeekInput({
    ...configured, athlete, block: withPractice,
    context: { recentSessions: [], completedWeeks: [], neighboringSessions: [], pinnedSessions: [] },
  })

  const practice = fixedSessions(input)[0]!
  assert.equal(practice.kind, 'commitment')
  assert.equal('blocks' in practice, false)
  const withoutPractice = generateBlock(
    athlete, { ...configured.block.goal, fixedCommitments: [] }, configured.block.startDate, DEFAULT_LIBRARY,
  )
  assert.equal(withoutPractice.program?.goal, 'dodgeball')

  const missingResources = structuredClone(athlete.program!)
  missingResources.comfortableThrowsPerPractice = 20
  assert.throws(() => parseProgramConfig(missingResources), /requires explicit/)
})

test('embedded throwing practice survives calendar validation, edits, logging and next-week archival', () => {
  const input = fixture()
  const plan = planWeek(input)
  assert.equal(calendarSafety(input, plan.sessions, {}).passed, true)
  const practice = plan.sessions.find((session): session is WorkoutSession =>
    session.kind === 'workout' && session.discipline === 'sport')!
  const week: CalendarWeek = { input, plan, logs: {}, removed: [], changes: [] }

  const moved = adaptCalendarWeek(week, {
    type: 'move', sessionId: practice.id, date: practice.date, startTime: '21:00',
  })
  assert.equal(moved.plan.safety.passed, true)
  assert.equal(moved.plan.sessions.find(session => session.id === practice.id)?.startTime, '21:00')

  const deleted = adaptCalendarWeek(week, { type: 'delete', sessionId: practice.id })
  assert.equal(deleted.plan.safety.passed, true)
  assert.equal(deleted.plan.sessions.some(session => session.id === practice.id), false)

  const skipped = adaptCalendarWeek(week, { type: 'skip', sessionId: practice.id, reason: 'life' })
  assert.equal(skipped.plan.safety.passed, true)
  assert.equal(skipped.logs[practice.id]?.status, 'skipped')

  const throwBlock = practice.blocks[0]!
  if (throwBlock.unit !== 'throws') return
  const log: SessionLog = {
    sessionId: practice.id, status: 'completed', actualDurationMin: practice.durationMin,
    blockLogs: [{ unit: 'throws', blockIndex: 0, drillId: throwBlock.drillId, throws: throwBlock.throws }],
    painFlag: false, notes: '',
  }
  const logged: CalendarWeek = { ...week, logs: { [practice.id]: log } }
  assert.equal(calendarSafety(input, plan.sessions, logged.logs).passed, true)
  const next = nextCalendarInput([logged])
  assert.ok(next.context.recentSessions.some(record =>
    record.session.id === practice.id && record.log?.blockLogs?.[0]?.unit === 'throws'))
  const nextPlan = planWeek(next)
  const nextPractice = nextPlan.sessions.find((session): session is WorkoutSession =>
    session.kind === 'workout' && session.discipline === 'sport')!
  assert.equal(nextPractice.isCalibration, false)
  assert.equal(calendarSafety(next, nextPlan.sessions, {}).passed, true)

  const forged = structuredClone(plan.sessions)
  const forgedPractice = forged.find((session): session is WorkoutSession =>
    session.kind === 'workout' && session.discipline === 'sport')!
  forgedPractice.sourceCommitmentId = 'forged-source'
  assert.equal(calendarSafety(input, forged, {}).passed, false)
  const forgedDose = structuredClone(plan.sessions)
  const changedDose = forgedDose.find((session): session is WorkoutSession =>
    session.kind === 'workout' && session.discipline === 'sport')!
  if (changedDose.blocks[0]!.unit === 'throws') changedDose.blocks[0]!.throws--
  assert.equal(calendarSafety(input, forgedDose, {}).passed, false)
  const forgedCost = structuredClone(plan.sessions)
  const changedCost = forgedCost.find((session): session is WorkoutSession =>
    session.kind === 'workout' && session.discipline === 'sport')!
  changedCost.predictedLoad.systemic++
  assert.equal(calendarSafety(input, forgedCost, {}).passed, false)
})

test('typed rep and timed logs validate units and only same-exercise history supplies weight', () => {
  const input = fixture('balanced')
  const workout = requestedSessions(input).find((session): session is WorkoutSession =>
    session.kind === 'workout' && session.discipline === 'strength'
      && session.blocks.some(block => block.unit === 'seconds' && block.role === 'carry'))!
  const repIndex = workout.blocks.findIndex(block => block.unit === 'reps')
  const timedIndex = workout.blocks.findIndex(block => block.unit === 'seconds' && block.role === 'carry')
  assert.ok(repIndex >= 0 && timedIndex >= 0)
  const rep = workout.blocks[repIndex]!
  const timed = workout.blocks[timedIndex]!
  if (rep.unit !== 'reps' || timed.unit !== 'seconds') return
  const log: SessionLog = {
    sessionId: workout.id, status: 'completed', painFlag: false, notes: '',
    blockLogs: [
      { unit: 'reps', blockIndex: repIndex, exerciseId: rep.exerciseId,
        sets: [{ exerciseId: rep.exerciseId, weightKg: 12, reps: rep.reps, actualRPE: rep.targetRPE }] },
      { unit: 'seconds', blockIndex: timedIndex, exerciseId: timed.exerciseId,
        seconds: timed.sets * timed.seconds, weightKg: 24 },
    ],
  }
  assert.deepEqual(parseSessionLog(log), log)
  assert.deepEqual(validateBlockLogs(workout, log), log)
  const next = parsePlanWeekInput({
    ...input, weekIndex: 1,
    context: { ...input.context, recentSessions: [{ session: workout, log }] },
  })
  const nextWorkout = requestedSessions(next).find((session): session is WorkoutSession =>
    session.kind === 'workout' && session.discipline === 'strength'
      && session.blocks.some(block => block.unit === 'reps' && block.exerciseId === rep.exerciseId))!
  const nextRep = nextWorkout.blocks.find(block => block.unit === 'reps' && block.exerciseId === rep.exerciseId)!
  assert.equal(nextRep.unit === 'reps' && nextRep.suggestedWeightKg, 12)
  assert.ok(nextWorkout.blocks.filter((block): block is Extract<typeof block, { unit: 'reps' }> =>
    block.unit === 'reps' && block.exerciseId !== rep.exerciseId)
    .every(block => block.suggestedWeightKg === undefined))
  const incompatible: SessionLog = {
    ...structuredClone(log),
    blockLogs: log.blockLogs!.map((item, index) => index === 0
      ? { unit: 'seconds', blockIndex: repIndex, exerciseId: rep.exerciseId, seconds: 10 } : item),
  }
  assert.throws(() => parsePlanWeekInput({
    ...input, weekIndex: 1,
    context: { ...input.context, recentSessions: [{ session: workout, log: incompatible }] },
  }), /must match prescribed reps unit/)
  for (const weightKg of [-1, 501, Number.NaN]) {
    assert.throws(() => parseBlockLog({
      unit: 'seconds', blockIndex: timedIndex, exerciseId: timed.exerciseId, seconds: 10, weightKg,
    }), /weightKg/)
  }
  const mobilityWorkout = requestedSessions(input).find((session): session is WorkoutSession =>
    session.kind === 'workout' && session.discipline === 'strength'
      && session.blocks.some(block => block.unit === 'seconds' && block.role === 'mobility'))!
  const mobilityIndex = mobilityWorkout.blocks.findIndex(block => block.unit === 'seconds' && block.role === 'mobility')
  const mobility = mobilityWorkout.blocks[mobilityIndex]!
  if (mobility.unit !== 'seconds') return
  assert.throws(() => validateBlockLogs(mobilityWorkout, {
    sessionId: mobilityWorkout.id, status: 'completed', painFlag: false, notes: '',
    blockLogs: [{ unit: 'seconds', blockIndex: mobilityIndex, exerciseId: mobility.exerciseId,
      seconds: mobility.seconds, weightKg: 5 }],
  }), /only for a loaded carry/)
  assert.equal(parseBlockLog({
    unit: 'seconds', blockIndex: mobilityIndex, exerciseId: mobility.exerciseId, seconds: mobility.seconds,
  }).unit, 'seconds')
  assert.deepEqual(parseSession(workout), workout)

  const repOverrunSets = Array.from({ length: MAX_LOGGED_SETS_PER_BLOCK }, () => ({
    exerciseId: rep.exerciseId, weightKg: 12, reps: rep.reps + 1, actualRPE: rep.targetRPE,
  }))
  repOverrunSets[0]!.actualRPE = 7
  const overrunLog: SessionLog = {
    sessionId: workout.id, status: 'completed', painFlag: false, notes: '',
    blockLogs: [
      { unit: 'reps', blockIndex: repIndex, exerciseId: rep.exerciseId, sets: repOverrunSets },
      { unit: 'seconds', blockIndex: timedIndex, exerciseId: timed.exerciseId,
        seconds: timed.sets * timed.seconds + 1, weightKg: 24 },
    ],
  }
  assert.deepEqual(validateBlockLogs(workout, overrunLog), overrunLog)
  const overrunFlags = workoutLogOverruns(workout, overrunLog)
  assert.deepEqual(overrunFlags.map(flag => flag.blockIndex), [repIndex, timedIndex].sort((a, b) => a - b))
  assert.match(overrunFlags.find(flag => flag.blockIndex === repIndex)!.message, /sets recorded.*repetitions.*RPE/)
  assert.match(overrunFlags.find(flag => flag.blockIndex === timedIndex)!.message, /seconds recorded/)
  const overrunInput = parsePlanWeekInput({
    ...input, weekIndex: 1,
    context: { ...input.context, recentSessions: [{ session: workout, log: overrunLog }] },
  })
  const observed = observedSessionWork({ session: workout, log: overrunLog }, overrunInput)!
  assert.ok(observed.load.systemic > predictSessionLoad(workout, input.athlete, input.library).systemic,
    'Actual work above plan remains in observed load')
  const afterOverrun = planWeek(overrunInput)
  assert.ok(afterOverrun.warnings.some(warning => /2 recorded workout blocks exceeded/.test(warning)))
  const retained = afterOverrun.sessions.find((session): session is WorkoutSession =>
    session.kind === 'workout' && session.discipline === 'strength'
      && session.blocks.some(block => block.unit === 'reps' && block.exerciseId === rep.exerciseId))!
  assert.equal(retained.isCalibration, true, 'Overruns are observations, not clean calibration evidence')
  const retainedRep = retained.blocks.find(block => block.unit === 'reps' && block.exerciseId === rep.exerciseId)!
  const defaultDose = exerciseDefaultPrescription(rep.exerciseId).prescription
  assert.equal(retainedRep.unit, 'reps')
  assert.equal(defaultDose.unit, 'reps')
  if (retainedRep.unit !== 'reps' || defaultDose.unit !== 'reps') return
  assert.equal(retainedRep.reps, defaultDose.reps)
  assert.throws(() => parseBlockLog({
    unit: 'reps', blockIndex: repIndex, exerciseId: rep.exerciseId,
    sets: [...repOverrunSets, repOverrunSets[0]],
  }), new RegExp(`1 to ${MAX_LOGGED_SETS_PER_BLOCK}`))
})

test('pain, illness and fatigue retain the independent floor and never increase fixed practice', () => {
  const input = fixture()
  for (const reason of ['pain', 'illness'] as const) {
    const held = planWeek({ ...input, athlete: { ...input.athlete, safetyHold: { reason, since: '2026-09-07' } } })
    assert.equal(held.safety.passed, false)
    assert.ok(held.sessions.every(session => session.kind === 'workout' && session.sourceCommitmentId))
  }
  const week: CalendarWeek = { input, plan: planWeek(input), logs: {}, removed: [], changes: [] }
  const target = week.plan.sessions.find(session => session.kind === 'conditioning')!
  const adapted = adaptCalendarWeek(week, { type: 'skip', sessionId: target.id, reason: 'too_tired' })
  const originalPractice = week.plan.sessions.find(session => session.kind === 'workout'
    && session.discipline === 'sport')!
  const retainedPractice = adapted.plan.sessions.find(session => session.id === originalPractice.id)!
  assert.deepEqual(retainedPractice, originalPractice)
})
