import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { generateBlock } from './block.ts'
import { nextCalendarInput } from './calendar.ts'
import {
  CUSTOM_EXERCISE_PROFILES, CUSTOM_EXERCISE_PROFILE_LIST, parseCustomExercise, parseResource, resolveProgramLibrary,
} from './custom-exercises.ts'
import type { CustomExerciseProfileId, CustomExerciseSpec } from './custom-exercises.ts'
import { LIMITS, PROGRAM_POLICY } from './constants.ts'
import { DEFAULT_LIBRARY, LEGACY_LIBRARY } from './library.ts'
import { observedSessionWork, predictSessionLoad } from './load.ts'
import { hasCleanBlockObservation, latestPerformance } from './observations.ts'
import { planWeek, requestedSessions } from './planner.ts'
import { availableExerciseMetadata, exerciseMetadata, recommendProgram } from './program.ts'
import { checkSafety } from './safety.ts'
import type {
  AthleteState, ExerciseLibrary, PlanWeekInput,
  ProgramConfigV1, Session, SessionLog, WorkoutSession,
} from './types.ts'
import {
  parseLibrary, parsePlanWeekInput, parseProgramConfig, validateBlockLogs,
} from './validation.ts'

function spec(overrides: Partial<CustomExerciseSpec> = {}): CustomExerciseSpec {
  return {
    version: 1, id: 'custom-supported-squat', name: 'Supported squat variation',
    profileId: 'controlled_squat', requirements: ['bodyweight', 'floor_space'],
    description: 'A user-reviewed supported squat variation.',
    focus: 'Keep the movement controlled and use a comfortable range.',
    why: 'A squat-pattern option using the available support.',
    ...overrides,
  }
}

function program(): ProgramConfigV1 {
  return parseProgramConfig({
    version: 1, libraryVersion: 'exercise-profiles-1', goal: 'balanced',
    resources: ['bodyweight', 'floor_space', 'carry_space', 'custom:handles'],
    conditioningBaselines: [],
    customExercises: [
      spec(),
      spec({ id: 'custom-handle-carry', name: 'Handle carry', profileId: 'timed_carry',
        requirements: ['custom:handles', 'carry_space'] }),
    ],
    selectedExerciseIds: ['custom-supported-squat', 'custom-handle-carry', 'push-up', 'dead-bug'],
  })
}

function fixture(config: ProgramConfigV1 = program()): PlanWeekInput {
  const athlete: AthleteState = {
    baseline: {
      asOf: '2026-09-07', weeklyRunMinutes: 90, longestRunMinutes: 30, runsPerWeek: 3,
      liftsPerWeek: 2, liftDurationMin: 45,
      exercises: [{ exerciseId: 'back-squat', date: '2026-09-07', weightKg: 40,
        sets: 2, reps: 5, actualRPE: 6, experienceMonths: 24 }],
    },
    calibration: { version: 1, costMultiplier: 1, observationCount: 0 },
    availableDays: [0, 1, 2, 3, 4, 5, 6], equipment: ['bodyweight'],
    weeklyTimeBudgetMin: 300, defaultStartTime: '07:00', aggressiveness: 'aggressive',
    residual: { asOfDate: '2026-09-07', asOfTime: '00:00', load: { systemic: 0, structural: 0 } },
    safetyHold: null, program: config,
  }
  const library = resolveProgramLibrary(config)
  const block = generateBlock(athlete, {
    label: 'Custom program', peakDate: '2026-11-29', qualityBias: ['aerobic_base'],
    protectedExerciseIds: [], fixedCommitments: [],
  }, '2026-09-07', library)
  return parsePlanWeekInput({
    athlete, block, library, weekIndex: 0,
    context: { recentSessions: [], completedWeeks: [], neighboringSessions: [], pinnedSessions: [] },
  })
}

function workoutLogs(sessions: readonly Session[]): Record<string, SessionLog> {
  return Object.fromEntries(sessions.filter((session): session is WorkoutSession => session.kind === 'workout')
    .map(session => [session.id, validateBlockLogs(session, {
      sessionId: session.id, status: 'completed', painFlag: false, notes: '',
      actualDurationMin: session.durationMin, actualEffort: 5,
      blockLogs: session.blocks.map((block, blockIndex) => {
        if (block.unit === 'throws') throw new Error('Not a strength block')
        if (block.unit === 'seconds') {
          return { unit: 'seconds', blockIndex, exerciseId: block.exerciseId,
            seconds: block.sets * block.seconds, weightKg: 11 }
        }
        return { unit: 'reps', blockIndex, exerciseId: block.exerciseId,
          sets: Array.from({ length: block.sets }, () => ({
            exerciseId: block.exerciseId, weightKg: block.exerciseId === 'custom-supported-squat' ? 13 : 0,
            reps: block.reps, actualRPE: block.targetRPE,
          })) }
      }),
    })]))
}

test('custom cards become scheduled typed exercises, log by their own IDs, and survive next-week planning', () => {
  const input = fixture()
  const plan = planWeek(input)
  assert.equal(plan.safety.passed, true)
  assert.ok(plan.warnings.some(warning => warning.includes('do not validate a technique')))
  const workouts = plan.sessions.filter((session): session is WorkoutSession => session.kind === 'workout')
  assert.equal(workouts.length, 2)
  const customRep = workouts.flatMap(session => session.blocks)
    .find(block => block.unit === 'reps' && block.exerciseId === 'custom-supported-squat')!
  assert.equal(customRep.unit, 'reps')
  assert.ok(!('suggestedWeightKg' in customRep), 'No weight is borrowed from the matching back-squat profile')
  assert.ok(workouts.some(session => session.blocks.some(block =>
    block.unit === 'seconds' && block.exerciseId === 'custom-handle-carry' && block.seconds === 30)))
  const logs = workoutLogs(plan.sessions)
  const next = nextCalendarInput([{ input, plan, logs, removed: [], changes: [] }])
  assert.deepEqual(next.block.program?.customExercises, input.block.program?.customExercises)
  assert.equal(hasCleanBlockObservation(next, 'custom-supported-squat', 'reps'), true)
  assert.equal(hasCleanBlockObservation(next, 'custom-handle-carry', 'seconds'), true)
  assert.equal(latestPerformance(next, 'custom-supported-squat')?.weightKg, 13)
  assert.equal(latestPerformance(next, 'back-squat')?.weightKg, 40)
  assert.equal(latestPerformance(next, 'custom-another-squat'), null)
  const later = planWeek(next)
  assert.equal(later.safety.passed, true)
  const nextWorkouts = later.sessions.filter((session): session is WorkoutSession => session.kind === 'workout')
  assert.ok(nextWorkouts.every(session => !session.isCalibration))
  assert.ok(nextWorkouts.some(session => session.blocks.some(block =>
    block.unit === 'reps' && block.exerciseId === 'custom-supported-squat' && block.suggestedWeightKg === 13)))
  for (const session of nextWorkouts) {
    assert.ok(session.durationMin <= input.athlete.baseline.liftDurationMin)
    assert.ok(session.blocks.reduce((sum, block) => sum + ('sets' in block ? block.sets : 0), 0) <= 8)
    assert.ok(session.blocks.reduce((sum, block) =>
      sum + (block.unit === 'reps' ? block.sets * block.reps : 0), 0) <= 64)
  }
})

test('custom profile menu has only conservative existing-registry estimates and controlled doses', () => {
  assert.ok(Object.isFrozen(CUSTOM_EXERCISE_PROFILE_LIST))
  assert.deepEqual(CUSTOM_EXERCISE_PROFILE_LIST, Object.values(CUSTOM_EXERCISE_PROFILES))
  assert.deepEqual(Object.keys(CUSTOM_EXERCISE_PROFILES).sort(), [
    'controlled_squat', 'controlled_hinge', 'controlled_push', 'controlled_pull',
    'controlled_unilateral', 'controlled_core', 'controlled_rotation', 'timed_carry', 'timed_mobility',
  ].sort())
  for (const entry of Object.values(CUSTOM_EXERCISE_PROFILES)) {
    assert.equal(entry.execution.style, 'controlled')
    assert.equal(entry.execution.ballistic, false)
    assert.ok(Object.isFrozen(entry.profile.prescription))
    const unit = entry.profile.prescription.unit
    const sources = DEFAULT_LIBRARY.exercises.filter(exercise =>
      exercise.template === entry.template && !exercise.highSkill && exercise.profile?.prescription.unit === unit)
    assert.deepEqual(entry.sourceExerciseIds, sources.map(exercise => exercise.id).sort())
    assert.deepEqual(entry.profile.schedulingEstimate, {
      systemic: Math.max(...sources.map(exercise => exercise.coefficients.systemic)),
      structural: Math.max(...sources.map(exercise => exercise.coefficients.structural)),
    })
    const controlled = sources.filter(exercise => exerciseMetadata(exercise.id).execution.style === 'controlled')
    assert.equal(entry.profile.prescription.sets, Math.min(...controlled.map(exercise => exercise.profile!.prescription.sets)))
    if (entry.profile.prescription.unit === 'reps') {
      assert.equal(entry.profile.prescription.targetRPE, 6)
      assert.equal(entry.profile.prescription.reps, Math.min(...controlled.map(exercise => {
        const dose = exercise.profile!.prescription
        return dose.unit === 'reps' ? dose.reps : Infinity
      })))
    }
  }
})

test('all nine custom profiles can be resolved, recommended, costed and scheduled with their fixed units', () => {
  for (const profileId of Object.keys(CUSTOM_EXERCISE_PROFILES) as CustomExerciseProfileId[]) {
    const config = program()
    config.customExercises = [spec({ profileId })]
    config.selectedExerciseIds = ['custom-supported-squat', 'bodyweight-squat', 'push-up', 'dead-bug']
    const input = fixture(config)
    const plan = planWeek(input)
    assert.equal(plan.safety.passed, true, profileId)
    const custom = plan.sessions.flatMap(session => session.kind === 'workout' ? session.blocks : [])
      .find(block => block.unit !== 'throws' && block.exerciseId === 'custom-supported-squat')!
    assert.equal(custom.unit, CUSTOM_EXERCISE_PROFILES[profileId].profile.prescription.unit)
    const metadata = exerciseMetadata('custom-supported-squat', input.library)
    assert.equal(metadata.description, config.customExercises[0]!.description)
    assert.equal(metadata.focusCues[0], config.customExercises[0]!.focus)
    assert.equal(metadata.purpose, config.customExercises[0]!.why)
    assert.equal(metadata.execution.style, 'controlled')
    assert.equal(metadata.custom?.profileId, profileId)
  }
})

test('custom catalog, resource, property, and spec order canonicalize without mutating built-ins', () => {
  const baseline = JSON.stringify(DEFAULT_LIBRARY)
  const config = program()
  const reordered = {
    ...config, resources: [...config.resources].reverse(),
    customExercises: [...config.customExercises!].reverse().map(item => ({
      why: item.why, focus: item.focus, description: item.description,
      requirements: [...item.requirements].reverse(), profileId: item.profileId,
      name: item.name, id: item.id, version: item.version,
    })),
    selectedExerciseIds: [...config.selectedExerciseIds!].reverse(),
  }
  assert.deepEqual(resolveProgramLibrary(config), resolveProgramLibrary(reordered))
  const a = fixture(config)
  const b = fixture(reordered)
  assert.deepEqual(a.block, b.block)
  assert.deepEqual(planWeek(a), planWeek(b))
  const reversedLibrary = { ...a.library, exercises: [...a.library.exercises].reverse() }
  assert.deepEqual(parseLibrary(reversedLibrary, config), a.library)
  assert.equal(JSON.stringify(DEFAULT_LIBRARY), baseline)
  assert.ok(Object.isFrozen(resolveProgramLibrary(config).exercises))
  assert.equal(resolveProgramLibrary(), DEFAULT_LIBRARY)
  const builtinsOnly = { ...config, customExercises: [],
    selectedExerciseIds: ['bodyweight-squat', 'bodyweight-split-squat', 'push-up', 'dead-bug'] }
  assert.equal(resolveProgramLibrary(builtinsOnly), DEFAULT_LIBRARY)
})

test('custom schemas reject unknown authority, high-skill profiles, wrong versions, and unbounded text', () => {
  for (const field of ['coefficients', 'prescription', 'sets', 'reps', 'seconds', 'targetRPE',
    'weightKg', 'durationMin', 'placement', 'executionStyle', 'highSkill', 'baseExerciseId']) {
    assert.throws(() => parseCustomExercise({ ...spec(), [field]: 1 }), /unknown field/)
  }
  for (const profileId of ['snatch', 'ballistic', 'fast_concentric_intent', 'controlled_jump', '__proto__']) {
    assert.throws(() => parseCustomExercise({ ...spec(), profileId }), /profileId/)
  }
  for (const version of [undefined, 0, 2, '1', null]) {
    assert.throws(() => parseCustomExercise({ ...spec(), version }), /version/)
  }
  for (const id of ['back-squat', 'custom-', 'custom-Foo', 'custom-a_b', 'custom:a', `custom-${'a'.repeat(74)}`]) {
    assert.throws(() => parseCustomExercise({ ...spec(), id }), /id/)
  }
  for (const description of ['', 'a'.repeat(601), '<script>alert(1)</script>', 'line\nbreak', 'hidden\u202econtrol']) {
    assert.throws(() => parseCustomExercise({ ...spec(), description }), /description/)
  }
  assert.throws(() => parseCustomExercise({ ...spec(), name: 'x'.repeat(81) }), /name/)
  assert.throws(() => parseCustomExercise(Object.create(spec())), /plain object/)
  assert.throws(() => parseProgramConfig({ ...program(), customExercises: Array(33).fill(spec()) }), /0 to 32/)
  assert.throws(() => parseProgramConfig({ ...program(), customExercises: [spec(), spec()] }), /duplicate/)
})

test('custom resources require bounded explicit tokens and a subset of confirmed program resources', () => {
  assert.equal(parseResource('custom:weighted-handles'), 'custom:weighted-handles')
  assert.equal(parseResource(`custom:${'x'.repeat(48)}`), `custom:${'x'.repeat(48)}`)
  for (const resource of ['handles', 'custom:', 'custom:Handles', 'custom:a_b', 'custom:../x', `custom:${'x'.repeat(49)}`]) {
    assert.throws(() => parseResource(resource), /resource/)
  }
  assert.throws(() => parseCustomExercise(spec({ requirements: ['custom:new-kit'] }), program().resources), /subset/)
  assert.throws(() => parseCustomExercise(spec({ requirements: [] })), /requirements/)
  assert.throws(() => parseProgramConfig({
    ...program(), customExercises: [spec({ requirements: ['custom:new-kit'] })],
  }), /unavailable resources/)
  assert.throws(() => parseProgramConfig({
    ...program(), resources: [...program().resources,
      ...Array.from({ length: LIMITS.maxCustomResources }, (_, index) => `custom:kit-${index}`)],
  }), /at most 16/)
  const metadata = availableExerciseMetadata(program().resources, resolveProgramLibrary(program()))
  assert.ok(metadata.some(item => item.id === 'custom-handle-carry'))
  assert.equal(availableExerciseMetadata(['bodyweight', 'floor_space'], resolveProgramLibrary(program()))
    .some(item => item.id === 'custom-handle-carry'), false)
  const missingSupport = program()
  missingSupport.selectedExerciseIds = ['bodyweight-squat', 'push-up', 'dead-bug', 'dumbbell-row']
  missingSupport.resources = ['bodyweight', 'floor_space', 'dumbbell', 'custom:handles', 'carry_space']
  assert.throws(() => parseProgramConfig(missingSupport), /unavailable resources/, 'A custom resource cannot replace a built-in bench')
})

test('inactive custom definitions and actual history survive removal of their current gear', () => {
  const original = fixture()
  const plan = planWeek(original)
  const logs = workoutLogs(plan.sessions)
  const revisedProgram = program()
  revisedProgram.resources = ['bodyweight', 'floor_space']
  revisedProgram.selectedExerciseIds = ['custom-supported-squat', 'push-up', 'dead-bug', 'bodyweight-split-squat']
  const revised = fixture(revisedProgram)
  const next = parsePlanWeekInput({
    ...revised, weekIndex: 1,
    context: { ...revised.context, recentSessions: plan.sessions.filter(session => logs[session.id])
      .map(session => ({ session, log: logs[session.id]! })) },
  })
  const retained = next.library.exercises.find(exercise => exercise.id === 'custom-handle-carry')!
  assert.deepEqual(retained, original.library.exercises.find(exercise => exercise.id === retained.id))
  assert.equal(hasCleanBlockObservation(next, retained.id, 'seconds'), true)
  const record = next.context.recentSessions.find(record => record.session.kind === 'workout'
    && record.session.blocks.some(block => block.unit === 'seconds' && block.exerciseId === retained.id))!
  assert.ok(observedSessionWork(record, next)!.load.systemic > 0)
  assert.equal(availableExerciseMetadata(revisedProgram.resources, next.library).some(item => item.id === retained.id), false)
  const nextPlan = planWeek(next)
  assert.equal(nextPlan.safety.passed, true)
  assert.ok(nextPlan.sessions.every(session => session.kind !== 'workout'
    || session.blocks.every(block => block.unit === 'throws' || block.exerciseId !== retained.id)))
  assert.throws(() => parseProgramConfig({
    ...revisedProgram, selectedExerciseIds: original.athlete.program!.selectedExerciseIds,
  }), /unavailable resources/)
  assert.throws(() => parseCustomExercise(retained.custom, revisedProgram.resources), /subset/,
    'The creation/handoff parser still requires confirmed available gear')
})

test('only the exact program-resolved library is accepted, never arbitrary entries or forged profiles', () => {
  const input = fixture()
  assert.throws(() => parseLibrary(input.library), /exactly match/)
  assert.throws(() => parseLibrary(DEFAULT_LIBRARY, input.athlete.program), /exactly match/)
  assert.throws(() => generateBlock(input.athlete, input.block.goal, input.block.startDate, DEFAULT_LIBRARY), /exactly match/)
  assert.throws(() => parsePlanWeekInput({ ...input, library: DEFAULT_LIBRARY }), /exactly match/)
  for (const mutate of [
    (exercise: ExerciseLibrary['exercises'][number]) => { exercise.coefficients.systemic = 0; exercise.profile!.schedulingEstimate.systemic = 0 },
    (exercise: ExerciseLibrary['exercises'][number]) => { exercise.highSkill = true },
    (exercise: ExerciseLibrary['exercises'][number]) => { exercise.requirements = ['none'] },
    (exercise: ExerciseLibrary['exercises'][number]) => { exercise.profile!.prescription.sets = 4 },
    (exercise: ExerciseLibrary['exercises'][number]) => { exercise.custom!.profileId = 'controlled_core' },
    (exercise: ExerciseLibrary['exercises'][number]) => { exercise.id = 'custom-unapproved' },
  ]) {
    const library = structuredClone(input.library)
    mutate(library.exercises.find(item => item.id === 'custom-supported-squat')!)
    assert.throws(() => parsePlanWeekInput({ ...input, library }), /exactly match/)
    assert.equal(checkSafety({ ...input, library }, planWeek(input).sessions).passed, false)
  }
  const changed = structuredClone(input)
  changed.block.program!.customExercises![0]!.why = 'A different frozen card.'
  changed.library = resolveProgramLibrary(changed.block.program)
  assert.throws(() => parsePlanWeekInput(changed), /frozen from athlete.program/)
  assert.throws(() => parseProgramConfig({
    ...program(), selectedExerciseIds: ['custom-unapproved', 'push-up', 'dead-bug', 'bodyweight-squat'],
  }), /unknown/)
})

test('custom names and prose cannot change workload, execution style, independent IDs or placement', () => {
  const config = program()
  config.customExercises = [spec({
    id: 'custom-supported-squat-fast-concentric',
    name: 'Display-only name', description: 'Display-only description',
    focus: 'Display-only focus', why: 'Display-only purpose',
  })]
  config.selectedExerciseIds = ['custom-supported-squat-fast-concentric', 'bodyweight-squat', 'push-up', 'dead-bug']
  const input = fixture(config)
  const first = requestedSessions(input)
  const editedConfig = structuredClone(config)
  editedConfig.customExercises![0]!.name = 'Different display name'
  editedConfig.customExercises![0]!.description = 'Different description'
  const edited = fixture(editedConfig)
  assert.deepEqual(requestedSessions(edited), first)
  assert.deepEqual(planWeek(edited).sessions, planWeek(input).sessions)
  const block = first.flatMap(session => session.kind === 'workout' ? session.blocks : [])
    .find(block => block.unit === 'reps' && block.exerciseId === 'custom-supported-squat-fast-concentric')!
  assert.equal('executionStyle' in block && block.executionStyle, 'controlled')
})

test('forged custom doses, weights, execution, duration and template identities are vetoed', () => {
  const input = fixture()
  const plan = planWeek(input)
  for (const mutation of ['sets', 'reps', 'targetRPE', 'suggestedWeightKg', 'executionStyle', 'duration', 'exerciseId', 'seconds']) {
    const sessions = structuredClone(plan.sessions)
    const session = sessions.find((session): session is WorkoutSession =>
      session.kind === 'workout' && session.blocks.some(block => block.unit !== 'throws'
        && block.exerciseId === (mutation === 'seconds' ? 'custom-handle-carry' : 'custom-supported-squat')))!
    const block = session.blocks.find(block => block.unit !== 'throws'
      && block.exerciseId === (mutation === 'seconds' ? 'custom-handle-carry' : 'custom-supported-squat'))!
    if (mutation === 'duration') session.durationMin = 1000
    else if (block.unit === 'reps') {
      if (mutation === 'sets') block.sets = 4
      if (mutation === 'reps') block.reps = 20
      if (mutation === 'targetRPE') block.targetRPE = 10
      if (mutation === 'suggestedWeightKg') block.suggestedWeightKg = 40
      if (mutation === 'executionStyle') block.executionStyle = 'fast_concentric_intent'
      if (mutation === 'exerciseId') block.exerciseId = 'back-squat'
    } else if (block.unit === 'seconds') block.seconds = 100
    session.predictedLoad = predictSessionLoad(session, input.athlete, input.library)
    assert.equal(checkSafety(input, sessions).passed, false, mutation)
  }
})

test('truthful custom overruns are costed from engine profiles without clearing calibration or increasing future dose', () => {
  const input = fixture()
  const plan = planWeek(input)
  const session = plan.sessions.find((session): session is WorkoutSession => session.kind === 'workout'
    && session.blocks.some(block => block.unit === 'reps' && block.exerciseId === 'custom-supported-squat'))!
  const log = workoutLogs([session])[session.id]!
  const actual = log.blockLogs!.find(block => block.unit === 'reps' && block.exerciseId === 'custom-supported-squat')!
  assert.equal(actual.unit, 'reps')
  if (actual.unit !== 'reps') return
  actual.sets = [...actual.sets, { exerciseId: actual.exerciseId, weightKg: 15, reps: 20, actualRPE: 9 }]
  validateBlockLogs(session, log)
  const load = observedSessionWork({ session, log }, input)!
  assert.ok(load.load.systemic > session.predictedLoad.systemic)
  const next = nextCalendarInput([{ input, plan, logs: { [session.id]: log }, removed: [], changes: [] }])
  assert.equal(hasCleanBlockObservation(next, 'custom-supported-squat', 'reps'), false)
  assert.equal(latestPerformance(next, 'custom-supported-squat'), null)
  const later = requestedSessions(next).flatMap(session => session.kind === 'workout' ? session.blocks : [])
    .find(block => block.unit === 'reps' && block.exerciseId === 'custom-supported-squat')!
  assert.ok(!('suggestedWeightKg' in later))
  assert.equal('reps' in later && later.reps, 5)
})

test('same-profile custom IDs never share weight or calibration history', () => {
  const config = program()
  config.customExercises = [spec(), spec({ id: 'custom-unobserved-squat' })]
  config.selectedExerciseIds = ['custom-supported-squat', 'custom-unobserved-squat', 'push-up', 'dead-bug']
  const input = fixture(config)
  const plan = planWeek(input)
  const logs = workoutLogs(plan.sessions)
  for (const log of Object.values(logs)) {
    log.blockLogs = log.blockLogs!.filter(block => !('exerciseId' in block) || block.exerciseId !== 'custom-unobserved-squat')
  }
  const next = nextCalendarInput([{ input, plan, logs, removed: [], changes: [] }])
  assert.equal(latestPerformance(next, 'custom-supported-squat')?.weightKg, 13)
  assert.equal(latestPerformance(next, 'custom-unobserved-squat'), null)
  assert.equal(hasCleanBlockObservation(next, 'custom-unobserved-squat', 'reps'), false)
})

test('custom cards retain exact explicit 4–7 routine bounds, including independent duplicate rejection', () => {
  const config = program()
  const library = resolveProgramLibrary(config)
  const selected = [...config.selectedExerciseIds!]
  assert.deepEqual(new Set(recommendProgram(config.resources, config.goal, library, selected).exerciseIds), new Set(selected))
  assert.throws(() => recommendProgram(config.resources, config.goal, library, selected.slice(0, 3)), /4 to 7/)
  assert.throws(() => recommendProgram(config.resources, config.goal, library, [...selected, ...selected]), /4 to 7/)
  assert.throws(() => recommendProgram(config.resources, config.goal, library, [...selected, selected[0]!]), /unique/)
  assert.equal(PROGRAM_POLICY.minSelectedExercises, 4)
  assert.equal(PROGRAM_POLICY.maxSelectedExercises, 7)
})

test('built-in snapshots retain their exact pre-custom fingerprints', () => {
  const fingerprint = (library: ExerciseLibrary): string => createHash('sha256').update(JSON.stringify(library)).digest('hex')
  assert.equal(fingerprint(DEFAULT_LIBRARY), 'd6202e063be1b1c973bab8bf283d05fe70ab222f9d03dde117555dc74294adce')
  assert.equal(fingerprint(LEGACY_LIBRARY), '5eeb1ea7febd34b2d27c5cec005d3f149d08961a31eab59e03b8bddc41415013')
})
