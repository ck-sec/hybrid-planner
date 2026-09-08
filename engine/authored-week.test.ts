import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authoredCommitmentSessionId, authoredProposalFromSessions, buildAuthoredWeek, parseAuthoredPlanWeekInput, parseAuthoredWeekProposal, validateAuthoredSessions } from './authored-week.ts'
import type { AuthoredSessionProposal, AuthoredWeekProposal, AuthoredWorkoutBlock } from './authored-week.ts'
import { generateBlock } from './block.ts'
import { followingCommitments, nextCalendarInput } from './calendar.ts'
import { AI_ADVISORY_CONDITIONING_RESOURCES, AI_ADVISORY_LIMITS, AI_ADVISORY_POLICY_VERSION, LIMITS } from './constants.ts'
import { CONTROLLED_TARGET_THROW_PROFILE } from './custom-exercises.ts'
import { addDays, dateForWeekday, dayOfWeek } from './dates.ts'
import { resolveProgramLibrary } from './library.ts'
import { predictSessionLoad } from './load.ts'
import { blockLogWithinPrescription } from './observations.ts'
import { fixedSessions, planWeek } from './planner.ts'
import { availableSportDrills, exerciseMetadata } from './program.ts'
import { checkSafety } from './safety.ts'
import type { AthleteState, CustomExerciseSpec, CustomSportDrillSpec, PlanWeekInput, ProgramConfigV1, Session, SessionLog, WorkoutSession } from './types.ts'
import {
  parseAthlete, parseAthleteWithOptions, parseBlock, parseBlockLog, parseBlockLogWithOptions,
  parseBlockWithOptions, parseCustomSportDrill, parsePlanningContext, parsePlanningContextWithOptions,
  parsePlanWeekInput, parsePlanWeekInputWithOptions, parseProgramConfig, parseProgramConfigWithOptions,
  parseSession, parseSessionLog, parseSessionLogWithOptions, parseSessionWithOptions,
  parseWorkoutBlock, parseWorkoutBlockWithOptions, validateBlockLogs,
} from './validation.ts'

const custom: CustomExerciseSpec = {
  version: 1, id: 'custom-controlled-row', name: 'Supported controlled row', profileId: 'controlled_pull',
  requirements: ['dumbbell', 'bench'], description: 'A confirmed controlled row variation.',
  focus: 'Keep a stable position.', why: 'Use the confirmed setup.',
}
const drill: CustomSportDrillSpec = {
  version: 1, id: 'custom-target-throw', name: 'Standing target throw', profileId: 'controlled_target_throw',
  requirements: ['dodgeball', 'court_space', 'safe_target'], description: 'Controlled throws within established practice.',
  focus: 'Use the confirmed target.', why: 'Practice the established controlled technique.',
}

function fixture(overrides: Partial<ProgramConfigV1> = {}): PlanWeekInput {
  const program = parseProgramConfig({
    version: 1, libraryVersion: 'exercise-profiles-1', goal: 'balanced',
    resources: ['bodyweight', 'floor_space', 'barbell', 'dumbbell', 'kettlebell', 'bands',
      'bench', 'rack', 'carry_space', 'anchor_point', 'dodgeball', 'court_space', 'safe_target'],
    conditioningBaselines: [{ modality: 'row', weeklyMinutes: 40, longestSessionMinutes: 40, sessionsPerWeek: 1 }],
    customExercises: [custom], ...overrides,
  })
  const athlete: AthleteState = {
    baseline: { asOf: '2026-09-07', weeklyRunMinutes: 90, longestRunMinutes: 40,
      runsPerWeek: 3, liftsPerWeek: 3, liftDurationMin: 45, exercises: [] },
    calibration: { version: 1, costMultiplier: 1, observationCount: 0 },
    availableDays: [0, 1, 2, 3, 4, 5, 6],
    equipment: ['bodyweight', 'barbell', 'dumbbell', 'kettlebell', 'bands'],
    weeklyTimeBudgetMin: 400, defaultStartTime: '07:00', aggressiveness: 'aggressive',
    residual: { asOfDate: '2026-09-07', asOfTime: '00:00', load: { systemic: 0, structural: 0 } },
    safetyHold: null, program,
  }
  const library = resolveProgramLibrary(program)
  const block = generateBlock(athlete, {
    label: 'Mixed training', peakDate: '2026-11-29', qualityBias: ['aerobic_base'],
    protectedExerciseIds: [],
    fixedCommitments: program.goal === 'dodgeball' ? [{
      id: 'practice', label: 'Established practice', dayOfWeek: 2, startTime: '19:00', durationMin: 60,
      discipline: 'sport', modality: 'court_sport', estimatedLoad: { systemic: 180, structural: 120 },
    }] : [],
  }, '2026-09-07', library)
  return parsePlanWeekInput({ athlete, block, weekIndex: 0, library,
    context: { recentSessions: [], completedWeeks: [], neighboringSessions: [], pinnedSessions: [] } })
}

function workout(id = 'authored-lift', date = '2026-09-07', ids = ['bodyweight-squat', 'push-up']): Extract<AuthoredSessionProposal, { kind: 'workout' }> {
  return {
    id, kind: 'workout', label: 'Authored strength', date, startTime: '07:00', durationMin: 30,
    blocks: ids.map(exerciseId => ({ unit: 'reps', exerciseId, sets: 1, reps: 4, targetRPE: 6 })),
  }
}

function run(id = 'authored-run', date = '2026-09-08', durationMin = 30): Extract<AuthoredSessionProposal, { kind: 'run' }> {
  return { id, kind: 'run', label: 'Easy run', modality: 'run_road', intent: 'easy',
    date, startTime: '07:00', durationMin }
}

function proposal(...sessions: AuthoredSessionProposal[]): AuthoredWeekProposal {
  return { version: 1, weekStart: '2026-09-07', sessions }
}

function hasRule(input: PlanWeekInput, value: AuthoredWeekProposal, rule: string): void {
  const result = buildAuthoredWeek(input, value)
  assert.equal(result.safety.passed, false, JSON.stringify(result.safety))
  assert.equal(result.feasibility.fits, false)
  assert.ok(result.safety.violations.some(violation => violation.rule === rule), JSON.stringify(result.safety))
  assert.deepEqual(result.omitted, [])
}

test('authored doses and dates produce deterministic sessions without changing fallback template safety', () => {
  const input = fixture()
  const fallback = planWeek(input)
  const p = proposal(workout(), run())
  const before = JSON.stringify({ input, p })
  const plan = buildAuthoredWeek(input, p)
  assert.equal(plan.safety.passed, true, JSON.stringify(plan.safety))
  assert.equal(plan.feasibility.fits, true)
  assert.equal(plan.policyVersion, 'authored-baseline-bounded-1')
  assert.deepEqual(plan.sessions.map(session => session.date), ['2026-09-07', '2026-09-08'])
  assert.deepEqual(buildAuthoredWeek(input, structuredClone(p)), plan)
  assert.deepEqual(buildAuthoredWeek(input, { ...p, sessions: [...p.sessions].reverse() }), plan)
  assert.equal(JSON.stringify({ input, p }), before)
  for (const session of plan.sessions) {
    assert.deepEqual(session.predictedLoad, predictSessionLoad(session, input.athlete, input.library))
    assert.deepEqual(parseSession(session), session)
  }
  assert.ok(checkSafety(input, plan.sessions).violations.some(violation => violation.rule === 'frozenWorkoutTemplate'))
  assert.deepEqual(planWeek(input), fallback)
})

test('authored rolling weeks retain fixed weekdays, availability policy and hard date integrity for every start', () => {
  for (let offset = 0; offset < 7; offset++) {
    const input = fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: 10 })
    const start = addDays('2026-09-07', offset)
    input.block = generateBlock(input.athlete, { ...input.block.goal, peakDate: addDays(start, 83) }, start, input.library)
    input.athlete.availableDays = [2, 4]
    const p: AuthoredWeekProposal = { version: 1, weekStart: start, sessions: [run('friday-run', dateForWeekday(start, 4), 20)] }
    const before = structuredClone(input)
    for (const options of [{}, { policy: 'ai-advisory' as const }]) {
      const plan = buildAuthoredWeek(input, p, options)
      assert.equal(plan.safety.passed, true, JSON.stringify(plan.safety))
      assert.equal(plan.weekStart, start)
      assert.deepEqual(plan.sessions.map(session => dayOfWeek(session.date)).sort(), [2, 4])
      const fixed = plan.sessions.find(session => session.kind === 'commitment')!
      assert.equal(fixed.date, dateForWeekday(start, 2))
      assert.equal(fixed.id, `fixed-1-${start}`)
      assert.equal(fixed.startTime, '19:00')
      const changed = plan.sessions.map(session => session.id === fixed.id ? { ...session, date: addDays(fixed.date, 1) } : session)
      assert.ok(validateAuthoredSessions(input, changed, {}, options).violations.some(item => item.rule === 'fixedCommitmentPreserved'))
      for (const date of [addDays(start, -1), addDays(start, 7)]) {
        const outside = buildAuthoredWeek(input, { ...p, sessions: [run('outside-week', date)] }, options)
        assert.equal(outside.safety.passed, false)
        assert.ok(outside.safety.violations.some(item => item.rule === 'requestedWeek'))
      }
      const unavailable = buildAuthoredWeek(input, { ...p, sessions: [run('saturday-run', dateForWeekday(start, 5))] }, options)
      assert.equal(unavailable.safety.passed, options.policy === 'ai-advisory')
      assert.ok(options.policy === 'ai-advisory'
        ? unavailable.warnings.some(item => item.includes('availableDays'))
        : unavailable.safety.violations.some(item => item.rule === 'availableDays'))
    }
    const embedded = fixedSessions(input)[0]!
    assert.ok(embedded.kind === 'workout' && embedded.sourceCommitmentId)
    assert.equal(embedded.date, dateForWeekday(start, 2))
    assert.deepEqual(input, before)
  }
})

test('more than seven immutable exercise identities fit without expanding the fallback pool', () => {
  const input = fixture()
  const ids = ['bodyweight-squat', 'goblet-squat', 'romanian-deadlift', 'push-up',
    'dumbbell-row', 'dead-bug', 'band-rotation', 'custom-controlled-row', 'bird-dog', 'bodyweight-split-squat']
  const plan = buildAuthoredWeek(input, proposal(
    workout('lift-one', '2026-09-07', ids.slice(0, 5)),
    workout('lift-two', '2026-09-10', ids.slice(5)),
  ))
  assert.equal(plan.safety.passed, true, JSON.stringify(plan.safety))
  assert.equal(new Set(plan.sessions.flatMap(session => session.kind === 'workout'
    ? session.blocks.filter(block => block.unit !== 'throws').map(block => block.exerciseId) : [])).size, 10)
  assert.ok(input.block.program!.selectedExerciseIds!.length <= 7)
  const row = plan.sessions.flatMap(session => session.kind === 'workout' ? session.blocks : [])
    .find(block => block.unit !== 'throws' && block.exerciseId === custom.id)!
  assert.ok(!('suggestedWeightKg' in row))
})

test('proposal parsing is closed, bounded, strict about data properties and rejects all AI authority fields', () => {
  const p = proposal(workout())
  for (const field of ['costs', 'coefficients', 'approved', 'progression', 'baseline', 'customExercises']) {
    assert.throws(() => parseAuthoredWeekProposal({ ...p, [field]: {} }), /unknown field/)
  }
  for (const field of ['predictedLoad', 'isCalibration', 'pinned', 'safety', 'approved', 'discipline']) {
    assert.throws(() => parseAuthoredWeekProposal({ ...p, sessions: [{ ...p.sessions[0], [field]: true }] }), /unknown field/)
  }
  for (const field of ['suggestedWeightKg', 'executionStyle', 'profileId', 'role']) {
    const s = workout() as Extract<AuthoredSessionProposal, { kind: 'workout' }>
    assert.throws(() => parseAuthoredWeekProposal(proposal({ ...s, blocks: [{ ...s.blocks[0], [field]: 1 }] })), /unknown field/)
  }
  for (const durationMin of [0, NaN, Infinity, 1.5, '30']) {
    assert.throws(() => parseAuthoredWeekProposal({ ...p, sessions: [{ ...p.sessions[0], durationMin }] }))
  }
  assert.throws(() => parseAuthoredWeekProposal({ ...p, version: 2 }))
  assert.throws(() => parseAuthoredWeekProposal(proposal({ ...run(), date: '2026-02-30' })))
  assert.throws(() => parseAuthoredWeekProposal(proposal({ ...run(), startTime: null } as unknown as AuthoredSessionProposal)))
  assert.throws(() => parseAuthoredWeekProposal(proposal(run(), run())), /duplicate/)
  assert.throws(() => parseAuthoredWeekProposal({ ...p, sessions: Array.from({ length: 13 }, (_, i) => run(`run-${i}`)) }))
  assert.throws(() => parseAuthoredWeekProposal({ ...p, sessions: [Object.defineProperty({}, 'id', { get() { throw new Error('must not execute') } })] }), /data property/)
  assert.throws(() => parseAuthoredWeekProposal({ ...p, sessions: new Array(1) }), /hole/)
})

test('unsupported identities, unit changes, ballistic entries and forged library coefficients fail closed', () => {
  const input = fixture()
  assert.throws(() => buildAuthoredWeek(input, proposal(workout('unknown', '2026-09-07', ['invented']))), /Unsupported/)
  assert.throws(() => buildAuthoredWeek(input, proposal(workout('ballistic', '2026-09-07', ['snatch']))), /Unsupported/)
  assert.throws(() => buildAuthoredWeek(input, proposal(workout('wrong-unit', '2026-09-07', ['dumbbell-farmer-carry']))), /seconds/)
  const altered = structuredClone(input)
  altered.library.exercises.find(exercise => exercise.id === 'push-up')!.coefficients.systemic = 0
  assert.throws(() => buildAuthoredWeek(altered, proposal(workout())), /coefficients|immutable|canonical/)
  const customChanged = structuredClone(input)
  customChanged.library.exercises.find(exercise => exercise.id === custom.id)!.name = 'Another movement'
  assert.throws(() => buildAuthoredWeek(customChanged, proposal(workout('custom', '2026-09-07', [custom.id]))))
})

test('profile ceilings bound each dose independently, permit reductions and forbid effort/quantity progression', () => {
  const input = fixture()
  const s = workout() as Extract<AuthoredSessionProposal, { kind: 'workout' }>
  for (const dose of [{ sets: 3 }, { reps: 11 }, { targetRPE: 6.5 }]) {
    const value = { ...s, blocks: [{ ...s.blocks[0], ...dose }] } as AuthoredSessionProposal
    hasRule(input, proposal(value), 'authoredDoseCeiling')
  }
  const observed = structuredClone(input)
  observed.athlete.baseline.exercises = [{
    exerciseId: 'push-up', date: observed.athlete.baseline.asOf,
    weightKg: 0, sets: 1, reps: 3, actualRPE: 6, experienceMonths: 24,
  }]
  hasRule(observed, proposal(workout('observed', '2026-09-07', ['push-up'])), 'authoredDoseCeiling')
  const timed = { ...s, blocks: [{ unit: 'seconds', exerciseId: 'dumbbell-farmer-carry', sets: 1, seconds: 10 }] } as AuthoredSessionProposal
  assert.equal(buildAuthoredWeek(input, proposal(timed)).safety.passed, true)
  hasRule(input, proposal({ ...timed, blocks: [{ unit: 'seconds', exerciseId: 'dumbbell-farmer-carry', sets: 1, seconds: 35 }] } as AuthoredSessionProposal),
    'authoredDoseCeiling')
})

test('per-session and weekly budgets cannot be evaded by exercise variety or shortened calendar duration', () => {
  const input = fixture()
  const s = workout('large', '2026-09-07',
    ['bodyweight-squat', 'push-up', 'dumbbell-row', 'dead-bug', 'band-rotation']) as Extract<AuthoredSessionProposal, { kind: 'workout' }>
  hasRule(input, proposal({ ...s, blocks: s.blocks.map(block => ({ ...block, sets: 2 })) }), 'authoredSessionQuantity')
  const tiny = workout('tiny', '2026-09-07',
    ['bodyweight-squat', 'push-up', 'dumbbell-row', 'dead-bug', 'band-rotation', 'goblet-squat', 'bird-dog', 'romanian-deadlift'])
  hasRule(input, proposal({ ...tiny, durationMin: 1 }), 'authoredDurationQuantity')
  hasRule(input, proposal(...[0, 2, 4, 6].map((offset, index) => workout(`lift-${index}`, addDays('2026-09-07', offset)))), 'liftFrequency')
  hasRule(input, proposal({ ...workout(), durationMin: 46 }), 'authoredLiftBaseline')
  const budget = structuredClone(input)
  budget.athlete.weeklyTimeBudgetMin = 30
  hasRule(budget, proposal(workout(), run()), 'weeklyTimeBudget')
})

test('running and conditioning share the correct baseline across session kinds, not across modalities', () => {
  const input = fixture()
  hasRule(input, proposal(run('too-long', '2026-09-07', 41)), 'longestRun')
  hasRule(input, proposal(run('one', '2026-09-07', 35), run('two', '2026-09-09', 35), run('three', '2026-09-11', 35)), 'authoredRunBaseline')
  hasRule(input, proposal(...[0, 1, 3, 5].map((offset, index) => run(`run-${index}`, addDays('2026-09-07', offset), 10))), 'authoredRunBaseline')
  const row: AuthoredSessionProposal = { id: 'row', kind: 'conditioning', label: 'Easy row',
    modality: 'row', date: '2026-09-10', startTime: '07:00', durationMin: 40 }
  assert.equal(buildAuthoredWeek(input, proposal(run(), row)).safety.passed, true)
  hasRule(input, proposal({ ...row, modality: 'bike_road' }), 'authoredConditioningBaseline')
  hasRule(input, proposal({ ...row, durationMin: 41 }), 'authoredBaselineProgression')
  hasRule(input, proposal(run('one', '2026-09-07'), run('two', '2026-09-09'), {
    ...row, modality: 'run_road', date: '2026-09-11', durationMin: 31,
  }), 'authoredRunBaseline')
  hasRule(input, proposal({ ...run(), modality: 'run_trail' }), 'authoredConditioningBaseline')
})

test('availability, rest, overlap, recovery, goal boundary and wrong week are checked without omission', () => {
  const input = fixture()
  const unavailable = structuredClone(input)
  unavailable.athlete.availableDays = [1, 2, 3, 4, 5, 6]
  hasRule(unavailable, proposal(workout()), 'availableDays')
  hasRule(input, proposal(workout(), run('same-time', '2026-09-07')), 'overlappingSessions')
  hasRule(input, proposal(workout(), workout('next', '2026-09-08')), 'minimumLiftGap')
  hasRule(input, proposal(...Array.from({ length: 7 }, (_, i) => run(`run-${i}`, addDays('2026-09-07', i), 1))), 'restDay')
  hasRule(input, proposal(run('outside', '2026-09-14')), 'requestedWeek')
  assert.throws(() => buildAuthoredWeek(input, { ...proposal(), weekStart: '2026-09-14' }), /weekStart/)
  const later = { ...input, weekIndex: input.block.totalWeeks - 1 }
  const weekStart = addDays(input.block.startDate, later.weekIndex * 7)
  const afterPeak = addDays(input.block.goal.peakDate, 1)
  const plan = buildAuthoredWeek(later, { version: 1, weekStart, sessions: [run('after-peak', afterPeak)] })
  assert.ok(plan.safety.violations.some(violation => violation.rule === 'goalDateBoundary'))
  const unknown = structuredClone(input)
  unknown.context.untimedStrengthDates = ['2026-09-06']
  hasRule(unknown, proposal(workout()), 'untimedStrengthBoundary')
})

test('holds never prescribe recovery or hide established work', () => {
  const input = fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: 30 })
  input.athlete.safetyHold = { reason: 'pain', since: '2026-09-07' }
  const fixedOnly = buildAuthoredWeek(input, proposal())
  assert.equal(fixedOnly.safety.passed, true)
  assert.equal(fixedOnly.sessions.length, 1)
  assert.equal(fixedOnly.sessions[0]!.kind, 'commitment')
  hasRule(input, proposal(workout()), 'safetyHold')
})

function throwSession(blocks: AuthoredWorkoutBlock[] = [{ unit: 'throws', drillId: drill.id, throws: 10 }]): AuthoredSessionProposal {
  return {
    id: 'fixed-1-2026-09-07', kind: 'workout', label: 'Established practice',
    date: '2026-09-09', startTime: '19:00', durationMin: 60, sourceCommitmentId: 'practice', blocks,
  }
}

test('custom throwing is a schedulable loggable immutable identity within existing practice exposure', () => {
  const input = fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: 30, customSportDrills: [drill] })
  assert.deepEqual(parseCustomSportDrill(drill, input.athlete.program!.resources), input.block.program!.customSportDrills![0])
  assert.ok(availableSportDrills(input.athlete.program!.resources, [drill]).some(item => item.id === drill.id))
  const plan = buildAuthoredWeek(input, proposal(throwSession()))
  assert.equal(plan.safety.passed, true, JSON.stringify(plan.safety))
  assert.equal(plan.sessions.length, 1)
  const session = plan.sessions[0] as WorkoutSession
  assert.equal(session.isCalibration, true)
  assert.deepEqual(session.predictedLoad, { systemic: 180, structural: 120 })
  assert.deepEqual(parseSession(session), session)
  const log = validateBlockLogs(session, { sessionId: session.id, status: 'completed', painFlag: false, notes: '',
    actualDurationMin: 60, blockLogs: [{ unit: 'throws', blockIndex: 0, drillId: drill.id, throws: 10 }] })
  assert.equal(blockLogWithinPrescription(session, log.blockLogs![0]!), true)
  assert.throws(() => validateBlockLogs(session, { ...log,
    blockLogs: [{ ...log.blockLogs![0]!, drillId: 'dodgeball-controlled-target-throw' }] }), /must match/)
  assert.ok(checkSafety(input, plan.sessions).violations.some(violation => violation.rule === 'throwingExposure'),
    'legacy safety must still refuse arbitrary identities or authored doses')
  const saved = JSON.parse(JSON.stringify({ input, proposal: proposal(throwSession()), plan }))
  assert.deepEqual(buildAuthoredWeek(saved.input, parseAuthoredWeekProposal(saved.proposal)), saved.plan)
})

test('throwing profile, aggregate cap, calibration and commitment metadata cannot be bypassed', () => {
  const input = fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: 30, customSportDrills: [drill] })
  const s = throwSession()
  assert.throws(() => parseCustomSportDrill({ ...drill, profileId: 'ballistic_throw' }))
  assert.throws(() => parseCustomSportDrill({ ...drill, coefficients: { systemic: 1, structural: 1 } }))
  assert.throws(() => parseCustomSportDrill({ ...drill, requirements: ['dodgeball'] }))
  hasRule(input, proposal(throwSession([{ unit: 'throws', drillId: 'custom-unknown', throws: 5 }])), 'authoredThrowProfile')
  hasRule(input, proposal(throwSession([{ unit: 'throws', drillId: drill.id, throws: 16 }])), 'authoredThrowDose')
  hasRule(input, proposal(throwSession([
    { unit: 'throws', drillId: drill.id, throws: 10 },
    { unit: 'throws', drillId: 'dodgeball-controlled-target-throw', throws: 10 },
  ])), 'authoredPracticeExposure')
  hasRule(input, proposal({ ...s, durationMin: 61 }), 'fixedCommitmentPreserved')
  hasRule(input, proposal({ ...s, date: '2026-09-10' }), 'fixedCommitmentPreserved')
  hasRule(input, proposal({ ...s, label: 'New practice' }), 'fixedCommitmentPreserved')
  hasRule(input, proposal({ ...s, id: 'new-practice-id' }), 'sourceCommitmentIntegrity')
  assert.throws(() => buildAuthoredWeek(input, proposal({ ...s, sourceCommitmentId: 'invented' } as AuthoredSessionProposal)), /existing fixed/)
  const hold = structuredClone(input)
  hold.athlete.safetyHold = { reason: 'illness', since: '2026-09-07' }
  hasRule(hold, proposal(s), 'throwingHealthHold')
  const mutated = structuredClone(input)
  mutated.athlete.program!.customSportDrills = [{ ...drill, name: 'Changed movement' }]
  assert.throws(() => buildAuthoredWeek(mutated, proposal(s)), /exactly match/)
})

test('clean throwing history is identity-specific; a practice or another drill cannot confer calibration', () => {
  const initial = fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: 30, customSportDrills: [drill] })
  const session = buildAuthoredWeek(initial, proposal(throwSession())).sessions[0] as WorkoutSession
  const input = { ...initial, weekIndex: 1, context: { ...initial.context, recentSessions: [{
    session, log: validateBlockLogs(session, { sessionId: session.id, status: 'completed', painFlag: false, notes: '',
      blockLogs: [{ unit: 'throws', blockIndex: 0, drillId: drill.id, throws: 10 }] }),
  }] } }
  const p: AuthoredWeekProposal = {
    version: 1, weekStart: '2026-09-14', sessions: [{ ...throwSession(),
      id: 'fixed-1-2026-09-14', date: '2026-09-16', blocks: [{ unit: 'throws', drillId: drill.id, throws: 30 }],
    } as AuthoredSessionProposal],
  }
  assert.equal(buildAuthoredWeek(input, p).safety.passed, true)
  const fallbackPractice = fixedSessions(input).find(session => session.kind === 'workout') as WorkoutSession
  assert.equal(fallbackPractice.isCalibration, true, 'Custom history cannot calibrate the different built-in drill identity.')
  const fallbackThrows = fallbackPractice.blocks[0]!
  assert.equal(fallbackThrows.unit === 'throws' && fallbackThrows.throws, 15)
  const other = structuredClone(p)
  const workout = other.sessions[0] as Extract<AuthoredSessionProposal, { kind: 'workout' }>
  workout.blocks = [{ unit: 'throws', drillId: 'dodgeball-controlled-target-throw', throws: 30 }]
  hasRule(input, other, 'authoredThrowDose')
})

function pin(input: PlanWeekInput, item: AuthoredSessionProposal): Session {
  return { ...buildAuthoredWeek(input, proposal(item)).sessions[0]!, pinned: true }
}

test('pinned sessions are injected exactly and proposals cannot replace completed work', () => {
  const input = fixture()
  const pinned = pin(input, workout())
  input.context.pinnedSessions = [pinned]
  const plan = buildAuthoredWeek(input, proposal(run()))
  assert.equal(plan.safety.passed, true, JSON.stringify(plan.safety))
  assert.deepEqual(plan.sessions.find(session => session.id === pinned.id), pinned)
  assert.throws(() => buildAuthoredWeek(input, proposal({ ...run(), id: pinned.id })), /pinned session/)
  hasRule(input, proposal(run('collision', '2026-09-07')), 'overlappingSessions')
})

test('same-week actual pins enforce overrun intervals and baseline budgets without changing the old parser', () => {
  const input = fixture()
  const pinned = pin(input, run('done', '2026-09-07', 30))
  input.context.pinnedSessions = [pinned]
  input.context.recentSessions = [{ session: pinned, log: {
    sessionId: pinned.id, status: 'completed', actualDurationMin: 90, painFlag: false, notes: '',
  } }]
  assert.throws(() => parsePlanWeekInput(input), /history must be before/)
  assert.deepEqual(parseAuthoredPlanWeekInput(JSON.parse(JSON.stringify(input))), input)
  hasRule(input, proposal({ ...workout(), startTime: '08:00' }), 'authoredActualOverlap')
  hasRule(input, proposal(run('new', '2026-09-09', 10)), 'authoredActualRunVolume')
  const result = buildAuthoredWeek(input, proposal())
  assert.deepEqual(result.sessions[0], pinned)
  assert.equal(result.safety.passed, false)
  const missingPin = structuredClone(input)
  missingPin.context.pinnedSessions = []
  assert.throws(() => buildAuthoredWeek(missingPin, proposal()), /immutable pinned/)
  const pain = structuredClone(input)
  pain.context.recentSessions[0]!.log!.painFlag = true
  hasRule(pain, proposal(workout('later', '2026-09-10')), 'authoredHealthHold')
})

test('actual previous work is checked even when not copied into neighboring sessions', () => {
  const input = fixture()
  const previous = { ...pin(input, workout()), id: 'previous', date: '2026-09-06', startTime: '22:00' }
  input.context.recentSessions = [{ session: previous, log: {
    sessionId: previous.id, status: 'completed', actualDurationMin: 90, painFlag: false, notes: '',
  } }]
  hasRule(input, proposal(workout()), 'authoredActualLiftGap')
  input.context.recentSessions = [{ session: { ...previous, startTime: null }, log: {
    sessionId: previous.id, status: 'completed', painFlag: false, notes: '',
  } }]
  hasRule(input, proposal(workout()), 'authoredActualLiftGap')
  assert.throws(() => buildAuthoredWeek(input, proposal({ ...run(), id: previous.id })), /stable identities/)
})

test('actual strength and throw block overruns consume confirmed quantity budgets', () => {
  const input = fixture()
  const session = pin(input, workout('done', '2026-09-07', ['push-up'])) as WorkoutSession
  input.context.pinnedSessions = [session]
  input.context.recentSessions = [{ session, log: validateBlockLogs(session, {
    sessionId: session.id, status: 'completed', painFlag: false, notes: '', actualDurationMin: 60,
    blockLogs: [{ unit: 'reps', blockIndex: 0, exerciseId: 'push-up',
      sets: Array.from({ length: 10 }, () => ({ exerciseId: 'push-up', weightKg: 0, reps: 8, actualRPE: 6 })) }],
  }) }]
  hasRule(input, proposal(), 'authoredActualLiftVolume')
  hasRule(input, proposal(), 'authoredActualSessionQuantity')
  const sport = fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: 30, customSportDrills: [drill] })
  const practice = pin(sport, throwSession()) as WorkoutSession
  sport.context.pinnedSessions = [practice]
  sport.context.recentSessions = [{ session: practice, log: validateBlockLogs(practice, {
    sessionId: practice.id, status: 'completed', painFlag: false, notes: '',
    blockLogs: [{ unit: 'throws', blockIndex: 0, drillId: drill.id, throws: 40 }],
  }) }]
  hasRule(sport, proposal(), 'authoredActualThrowExposure')
})

test('overnight actual work occupies the next day and can consume the final rest day', () => {
  const input = fixture()
  const unavailable = structuredClone(input)
  unavailable.athlete.availableDays = [0, 2, 3, 4, 5, 6]
  hasRule(unavailable, proposal({ ...run('overnight', '2026-09-07', 30), startTime: '23:50' }), 'authoredOccupiedAvailability')
  const overnight = { ...pin(input, run('overnight', '2026-09-07', 30)), startTime: '23:50' }
  input.context.pinnedSessions = [overnight]
  input.context.recentSessions = [{ session: overnight, log: {
    sessionId: overnight.id, status: 'completed', painFlag: false, notes: '', actualDurationMin: 30,
  } }]
  hasRule(input, proposal(...[2, 3, 4, 5, 6].map(offset => run(`run-${offset}`, addDays('2026-09-07', offset), 1))),
    'authoredOccupiedRestDay')
})

test('catalog execution is engine-owned and custom profiles do not borrow performance', () => {
  const input = fixture()
  const exercise = input.library.exercises.find(exercise => exercise.id.endsWith('-slow-lowering') && !exercise.highSkill)!
  const metadata = exerciseMetadata(exercise.id)
  const plan = buildAuthoredWeek(input, proposal(workout('tempo', '2026-09-07', [exercise.id])))
  assert.equal(plan.safety.passed, true, JSON.stringify(plan.safety))
  const block = (plan.sessions[0] as WorkoutSession).blocks[0]!
  assert.equal(block.unit === 'reps' && block.executionStyle, metadata.execution.style)
  input.athlete.baseline.exercises = [{
    exerciseId: 'dumbbell-row', date: '2026-09-07', weightKg: 20,
    sets: 2, reps: 4, actualRPE: 6, experienceMonths: 24,
  }]
  const authored = buildAuthoredWeek(input, proposal(workout('custom', '2026-09-07', [custom.id])))
  assert.equal(authored.safety.passed, true, JSON.stringify(authored.safety))
  assert.ok(!('suggestedWeightKg' in (authored.sessions[0] as WorkoutSession).blocks[0]!))
})

test('direct authored safety validates midweek swaps while authoritative pins retain their logged sets', () => {
  const input = fixture()
  const original = buildAuthoredWeek(input, proposal(workout('done'), workout('upcoming', '2026-09-10')))
  const completed = { ...original.sessions[0]!, pinned: true } as WorkoutSession
  input.context.pinnedSessions = [completed]
  const log = validateBlockLogs(completed, {
    sessionId: completed.id, status: 'completed', painFlag: false, notes: 'Preserve these exact observations.',
    actualDurationMin: 30,
    blockLogs: completed.blocks.map((block, blockIndex) => {
      assert.equal(block.unit, 'reps')
      if (block.unit !== 'reps') throw new Error('Expected repetitions')
      return { unit: 'reps', blockIndex, exerciseId: block.exerciseId,
        sets: [{ exerciseId: block.exerciseId, weightKg: 0, reps: block.reps, actualRPE: block.targetRPE }] }
    }),
  })
  const changed = buildAuthoredWeek(input, proposal(workout('upcoming', '2026-09-10', [custom.id, 'dead-bug'])))
  const before = JSON.stringify({ input, original, changed, log })
  assert.equal(validateAuthoredSessions(input, changed.sessions, { [completed.id]: log }).passed, true)
  assert.equal(JSON.stringify({ input, original, changed, log }), before)
  assert.deepEqual(changed.sessions[0], completed)
  assert.ok(checkSafety(input, changed.sessions).violations.some(violation => violation.rule === 'frozenWorkoutTemplate'))

  const removed = validateAuthoredSessions(input, changed.sessions.filter(session => session.id !== completed.id), { [completed.id]: log })
  assert.ok(removed.violations.some(violation => violation.rule === 'pinnedSessionPreserved'))
  const rewritten = structuredClone(completed)
  rewritten.blocks = [{ unit: 'reps', exerciseId: 'bodyweight-squat', sets: 1, reps: 3,
    targetRPE: 6, role: 'anchor', executionStyle: 'controlled' }]
  rewritten.predictedLoad = predictSessionLoad(rewritten, input.athlete, input.library)
  const result = validateAuthoredSessions(input, [rewritten, changed.sessions[1]!], { [completed.id]: log })
  assert.ok(result.violations.some(violation => violation.rule === 'pinnedSessionPreserved'))
})

test('direct authored safety fails closed for edited costs, authority flags, roles and invalid logs', () => {
  const input = fixture()
  const original = buildAuthoredWeek(input, proposal(workout())).sessions[0] as WorkoutSession
  assert.equal(validateAuthoredSessions(input, [original]).passed, true)
  const cost = validateAuthoredSessions(input, [{ ...original, predictedLoad: { systemic: 0, structural: 0 } }])
  assert.ok(cost.violations.some(violation => violation.rule === 'predictedLoadIntegrity'))
  const unknownTime = validateAuthoredSessions(input, [{ ...original, startTime: null }])
  assert.ok(unknownTime.violations.some(violation => violation.rule === 'authoredSessionTime'))
  const authority = validateAuthoredSessions(input, [{ ...original, pinned: true }])
  assert.ok(authority.violations.some(violation => violation.rule === 'authoredPinAuthority'))
  const roles = structuredClone(original)
  roles.blocks = roles.blocks.map(block => block.unit === 'reps' ? { ...block, role: 'accessory' } : block)
  assert.ok(validateAuthoredSessions(input, [roles]).violations.some(violation => violation.rule === 'authoredBlockRole'))
  const log: SessionLog = { sessionId: original.id, status: 'completed', painFlag: false, notes: '', actualDurationMin: 30 }
  assert.ok(validateAuthoredSessions(input, [original], { [original.id]: log }).violations
    .some(violation => violation.rule === 'invalidAuthoredSafetyInput' && violation.message.includes('original session')))
  const pinned = { ...original, pinned: true }
  input.context.pinnedSessions = [pinned]
  const badLog: SessionLog = { ...log, blockLogs: [{ unit: 'reps', blockIndex: 0, exerciseId: 'push-up',
    sets: [{ exerciseId: 'push-up', weightKg: 0, reps: 4, actualRPE: 6 }] }] }
  assert.equal(validateAuthoredSessions(input, [pinned], { [original.id]: badLog }).passed, false)
  input.context.recentSessions = [{ session: pinned, log }]
  assert.equal(validateAuthoredSessions(input, [pinned], { [original.id]: log }).passed, true)
  const conflict = validateAuthoredSessions(input, [pinned], { [original.id]: { ...log, actualDurationMin: 31 } })
  assert.ok(conflict.violations.some(violation => violation.message.includes('conflicts with the immutable actual')))
})

test('direct authored safety counts logged actual overruns and holds without regenerating prescriptions', () => {
  const input = fixture()
  const completed = pin(input, run('done', '2026-09-07', 30))
  input.context.pinnedSessions = [completed]
  const candidate = buildAuthoredWeek(input, proposal(workout('upcoming', '2026-09-07'))).sessions
    .map(session => session.id === 'upcoming' ? { ...session, startTime: '08:00' } : session)
  const log: SessionLog = {
    sessionId: completed.id, status: 'completed', painFlag: false, notes: '', actualDurationMin: 90,
  }
  const result = validateAuthoredSessions(input, candidate, { [completed.id]: log })
  assert.ok(result.violations.some(violation => violation.rule === 'authoredActualOverlap'))
  assert.ok(result.violations.some(violation => violation.rule === 'authoredActualRunVolume'))
  const pain = validateAuthoredSessions(input, candidate, { [completed.id]: { ...log, painFlag: true } })
  assert.ok(pain.violations.some(violation => violation.rule === 'authoredHealthHold'))
})

test('direct authored sport safety preserves unique card identities and immutable practice fields', () => {
  const input = fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: 30, customSportDrills: [drill] })
  const practice = buildAuthoredWeek(input, proposal(throwSession([{ unit: 'throws', drillId: drill.id, throws: 5 }]))).sessions[0] as WorkoutSession
  assert.equal(validateAuthoredSessions(input, [practice]).passed, true)
  const repeated = { ...practice, blocks: [...practice.blocks, ...practice.blocks] }
  assert.ok(validateAuthoredSessions(input, [repeated]).violations.some(violation => violation.rule === 'authoredBlockIdentity'))
  assert.ok(validateAuthoredSessions(input, [{ ...practice, durationMin: 30 }]).violations
    .some(violation => violation.rule === 'fixedCommitmentPreserved'))
})

test('session conversion supports desired reductions without replacing the real observed baseline', () => {
  const input = fixture()
  const generated = planWeek(input)
  assert.equal(generated.safety.passed, true, JSON.stringify(generated.safety))
  const before = JSON.stringify({ input, generated })
  let keptRun = false
  let keptLift = false
  const desired = generated.sessions.filter(session => {
    if (session.kind === 'workout' && session.discipline === 'strength' && !keptLift) {
      keptLift = true
      return true
    }
    if (session.discipline === 'run' && !keptRun) {
      keptRun = true
      return true
    }
    return false
  }).map(session => ({ ...session, durationMin: Math.min(session.durationMin, 20) }))
  const p = authoredProposalFromSessions(generated.weekStart, desired)
  const result = buildAuthoredWeek(input, p)
  assert.equal(result.safety.passed, true, JSON.stringify(result.safety))
  assert.equal(result.sessions.length, 2)
  assert.ok(result.sessions.every(session => session.durationMin <= 20))
  assert.equal(JSON.stringify({ input, generated }), before)
  assert.equal(input.athlete.baseline.runsPerWeek, 3)
  assert.equal(input.athlete.baseline.liftsPerWeek, 3)
  for (const session of p.sessions) {
    assert.ok(!('predictedLoad' in session))
    if (session.kind === 'workout') for (const block of session.blocks) {
      assert.ok(!('role' in block))
      assert.ok(!('executionStyle' in block))
      assert.ok(!('suggestedWeightKg' in block))
    }
  }
})

test('conversion preserves fixed commitments and embedded throw annotations without inventing work', () => {
  const input = fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: 30, customSportDrills: [drill] })
  const bare = buildAuthoredWeek(input, proposal())
  const convertedBare = authoredProposalFromSessions(bare.weekStart, bare.sessions)
  assert.deepEqual(convertedBare.sessions, [])
  assert.deepEqual(buildAuthoredWeek(input, convertedBare).sessions, bare.sessions)

  const annotated = buildAuthoredWeek(input, proposal(throwSession(), workout()))
  const converted = authoredProposalFromSessions(annotated.weekStart, annotated.sessions)
  const practice = converted.sessions.find(session => session.kind === 'workout' && session.sourceCommitmentId)
  assert.deepEqual(practice, throwSession())
  const rebuilt = buildAuthoredWeek(input, converted)
  assert.equal(rebuilt.safety.passed, true, JSON.stringify(rebuilt.safety))
  assert.deepEqual(rebuilt.sessions.find(session => session.id === practice!.id),
    annotated.sessions.find(session => session.id === practice!.id))
  assert.deepEqual(authoredProposalFromSessions(annotated.weekStart, annotated.sessions), converted)
})

test('conversion needs explicit preserved IDs for completed pins and supports completed fixed practices', () => {
  const input = fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: 30, customSportDrills: [drill] })
  const plan = buildAuthoredWeek(input, proposal(throwSession(), workout()))
  const records = plan.sessions.map(session => ({ ...session, pinned: true }))
  assert.throws(() => authoredProposalFromSessions(plan.weekStart, records), /explicit preservedSessionId/)
  const ids = records.map(session => session.id)
  const p = authoredProposalFromSessions(plan.weekStart, records, { preservedSessionIds: ids })
  assert.deepEqual(p.sessions, [])
  input.context.pinnedSessions = records
  assert.deepEqual(buildAuthoredWeek(input, p).sessions, records)
  assert.throws(() => authoredProposalFromSessions(plan.weekStart, plan.sessions, { preservedSessionIds: ['missing'] }), /present and pinned/)
  assert.throws(() => authoredProposalFromSessions(plan.weekStart, plan.sessions, { preservedSessionIds: ['authored-lift'] }), /present and pinned/)
})

test('conversion never guesses unknown timing, coerces legacy strength or drops an unowned commitment', () => {
  const input = fixture()
  const session = buildAuthoredWeek(input, proposal(workout())).sessions[0]!
  assert.throws(() => authoredProposalFromSessions('2026-09-07', [{ ...session, startTime: null }]), /unknown timing/)
  assert.throws(() => authoredProposalFromSessions('2026-09-07', [{
    ...session, kind: 'commitment', discipline: 'sport', modality: 'court_sport', label: 'Unowned',
    blocks: undefined,
  } as unknown as Session]))
  const { blocks, label, ...base } = session as WorkoutSession
  void blocks
  void label
  assert.throws(() => authoredProposalFromSessions('2026-09-07', [{
    ...base, kind: 'strength', discipline: 'strength', modality: 'lifting',
    strengthPrescription: [{ exerciseId: 'push-up', sets: 1, reps: 4, targetRPE: 6, role: 'anchor' }],
  }]), /Legacy strength/)
  assert.throws(() => authoredProposalFromSessions('2026-09-07', [{
    ...base, kind: 'commitment', discipline: 'sport', modality: 'court_sport', label: 'Unowned',
  }]), /not a recurring fixed/)
})

test('club practice remains a pre-existing load/time constraint through proposal conversion and swaps', () => {
  const input = fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: 30 })
  const initial = buildAuthoredWeek(input, proposal(workout()))
  assert.equal(initial.safety.passed, true, JSON.stringify(initial.safety))
  const practice = initial.sessions.find(session => session.kind === 'commitment')!
  assert.equal(practice.durationMin, 60)
  assert.deepEqual(practice.predictedLoad, { systemic: 180, structural: 120 })

  const p = authoredProposalFromSessions(initial.weekStart, initial.sessions)
  assert.equal(p.sessions.length, 1, 'Fixed work stays in authoritative input, not AI-owned proposal data.')
  const rebuilt = buildAuthoredWeek(input, p)
  assert.deepEqual(rebuilt.sessions.find(session => session.id === practice.id), practice)
  const reducedBudget = { ...input, athlete: { ...input.athlete, weeklyTimeBudgetMin: 80 } }
  hasRule(reducedBudget, p, 'weeklyTimeBudget')
  hasRule(input, proposal({ ...run('on-top-of-practice', '2026-09-09', 20), startTime: '19:15' }), 'overlappingSessions')
  hasRule(input, proposal({ ...workout('on-top-of-practice', '2026-09-09'), startTime: '19:30' }), 'overlappingSessions')

  const withoutPractice = validateAuthoredSessions(input, rebuilt.sessions.filter(session => session.id !== practice.id))
  assert.ok(withoutPractice.violations.some(violation => violation.rule === 'fixedCommitmentPreserved'))
  const movedPractice = rebuilt.sessions.map(session => session.id === practice.id ? { ...session, date: '2026-09-10' } : session)
  assert.ok(validateAuthoredSessions(input, movedPractice).violations.some(violation => violation.rule === 'fixedCommitmentPreserved'))
  const hiddenLoad = rebuilt.sessions.map(session => session.id === practice.id
    ? { ...session, predictedLoad: { systemic: 0, structural: 0 } } : session)
  assert.ok(validateAuthoredSessions(input, hiddenLoad).violations.some(violation => violation.rule === 'fixedCommitmentPreserved'))
})

test('club-practice estimates contribute to next-day residual scoring and neighboring hard-day recovery', () => {
  const input = fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: 30 })
  const withPractice = buildAuthoredWeek(input, proposal(run('next-day', '2026-09-10', 20)))
  assert.equal(withPractice.safety.passed, true, JSON.stringify(withPractice.safety))
  assert.ok(withPractice.penalties.some(penalty => penalty.rule === 'structuralCollision'
    && penalty.affectedSessionIds.includes('next-day') && penalty.score > 0),
  'Established practice cost must enter residual scheduling estimates before next-day running.')

  const hard = structuredClone(input)
  hard.block.goal.fixedCommitments = [{
    ...hard.block.goal.fixedCommitments[0]!, dayOfWeek: 0, startTime: '18:00',
    estimatedLoad: { systemic: 300, structural: 250 },
  }]
  const fixed: Session = {
    id: 'previous-club-practice', kind: 'commitment', discipline: 'sport', modality: 'court_sport',
    date: '2026-09-06', startTime: '18:00', durationMin: 60, label: 'Previous established club practice',
    predictedLoad: { systemic: 300, structural: 250 }, pinned: true, isCalibration: false, reason: 'Established practice.',
  }
  const saturday = { ...fixed, id: 'older-club-practice', date: '2026-09-05' }
  hard.context.neighboringSessions = [saturday, fixed]
  hasRule(hard, proposal(), 'consecutiveHardDays')
  hasRule(hard, proposal(), 'authoredActualHardDays')
})

test('UI throwing policy exposes the exact enforced administrative bounds and resources', () => {
  const profile = CONTROLLED_TARGET_THROW_PROFILE
  assert.deepEqual(profile, {
    id: 'controlled_target_throw', requirements: ['dodgeball', 'court_space', 'safe_target'],
    minThrowsPerPractice: 1, maxThrowsPerPractice: 500, maxDefinitions: 32, calibrationFraction: 0.5,
  })
  assert.ok(Object.isFrozen(profile))
  assert.ok(Object.isFrozen(profile.requirements))
  assert.throws(() => fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: profile.maxThrowsPerPractice + 1 }))
  assert.throws(() => fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: profile.minThrowsPerPractice - 1 }))
  assert.throws(() => fixture({ customSportDrills: Array.from({ length: profile.maxDefinitions + 1 },
    (_, index) => ({ ...drill, id: `custom-drill-${index}` })) }))
  for (const requirement of profile.requirements) {
    assert.throws(() => parseCustomSportDrill({ ...drill, requirements: drill.requirements.filter(resource => resource !== requirement) }))
  }
  const input = fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: profile.maxThrowsPerPractice, customSportDrills: [drill] })
  const plan = buildAuthoredWeek(input, proposal(throwSession([{
    unit: 'throws', drillId: drill.id, throws: profile.maxThrowsPerPractice * profile.calibrationFraction,
  }])))
  assert.equal(plan.safety.passed, true, JSON.stringify(plan.safety))
  assert.throws(() => parseAuthoredWeekProposal(proposal(throwSession([{
    unit: 'throws', drillId: drill.id, throws: profile.maxThrowsPerPractice + 1,
  }]))))
})

function partialAmendmentFixture(date = '2026-09-07') {
  const alternative: CustomExerciseSpec = {
    ...custom, id: 'custom-steady-lunge', name: 'Approved steady lunge',
    profileId: 'controlled_unilateral', requirements: ['bodyweight', 'floor_space'],
  }
  const input = fixture({ customExercises: [custom, alternative] })
  const authored = workout('partial-lift', date, ['bodyweight-split-squat', 'push-up'])
  authored.blocks = [{ unit: 'reps', exerciseId: 'bodyweight-split-squat', sets: 2, reps: 6, targetRPE: 6 }, authored.blocks[1]!]
  const before = buildAuthoredWeek(input, proposal(authored))
  assert.equal(before.safety.passed, true, JSON.stringify(before.safety))
  const original = { ...before.sessions[0]!, pinned: true } as WorkoutSession
  const first = authored.blocks[0]!
  assert.equal(first.unit, 'reps')
  if (first.unit !== 'reps') throw new Error('Expected repetitions')
  const after = buildAuthoredWeek(input, proposal({
    ...authored, blocks: [{ ...first, sets: 1 }, authored.blocks[1]!,
      { unit: 'reps', exerciseId: alternative.id, sets: 1, reps: 6, targetRPE: 6 }],
  }))
  assert.equal(after.safety.passed, true, JSON.stringify(after.safety))
  const candidate = { ...after.sessions[0]!, pinned: true } as WorkoutSession
  input.context.pinnedSessions = [original]
  const log = validateBlockLogs(original, {
    sessionId: original.id, status: 'partial', painFlag: false, notes: '',
    blockLogs: [{ unit: 'reps', blockIndex: 0, exerciseId: 'bodyweight-split-squat',
      sets: [{ exerciseId: 'bodyweight-split-squat', weightKg: 12, reps: 5, actualRPE: 6.5 }] }],
  })
  return { input, original, candidate, log }
}

const partialOptions = { allowPartialWorkoutAmendments: true } as const

test('partial workout amendments are opt-in and allow a higher known-cost appended remainder', () => {
  const { input, original, candidate, log } = partialAmendmentFixture()
  const logs = { [original.id]: log }
  const snapshot = JSON.stringify({ input, original, candidate, logs })
  assert.ok(candidate.predictedLoad.systemic > original.predictedLoad.systemic
    || candidate.predictedLoad.structural > original.predictedLoad.structural,
  'A known alternative may be slightly more costly without exceeding supported workload ceilings.')
  const strict = validateAuthoredSessions(input, [candidate], logs)
  assert.ok(strict.violations.some(violation => violation.rule === 'pinnedSessionPreserved'))
  assert.deepEqual(validateAuthoredSessions(input, [candidate], logs, { allowPartialWorkoutAmendments: false }), strict)
  const amended = validateAuthoredSessions(input, [candidate], logs, partialOptions)
  assert.equal(amended.passed, true, JSON.stringify(amended))
  assert.equal(JSON.stringify({ input, original, candidate, logs }), snapshot)
  const throughContext = { ...input, context: { ...input.context, recentSessions: [{ session: original, log }] } }
  assert.deepEqual(validateAuthoredSessions(throughContext, [candidate], {}, partialOptions), amended)
  assert.deepEqual(log.blockLogs![0], {
    unit: 'reps', blockIndex: 0, exerciseId: 'bodyweight-split-squat',
    sets: [{ exerciseId: 'bodyweight-split-squat', weightKg: 12, reps: 5, actualRPE: 6.5 }],
  })
})

test('partial amendments never rewrite logged identities, indices, prescriptions or session placement', () => {
  const { input, original, candidate, log } = partialAmendmentFixture()
  const changedBlocks = [
    candidate.blocks.map((block, index) => index === 0 && block.unit === 'reps' ? { ...block, exerciseId: 'goblet-squat' } : block),
    [...candidate.blocks].reverse(),
    candidate.blocks.map((block, index) => index === 0 && block.unit === 'reps' ? { ...block, reps: 5 } : block),
    candidate.blocks.map((block, index) => index === 0 && block.unit === 'reps' ? { ...block, targetRPE: 6.5 as const } : block),
    candidate.blocks.map((block, index) => index === 0 && block.unit === 'reps' ? { ...block, suggestedWeightKg: 12 } : block),
    candidate.blocks.map((block, index) => index === 0 && block.unit === 'reps' ? { ...block, role: 'accessory' as const } : block),
    candidate.blocks.map((block, index) => index === 0 && block.unit === 'reps' ? { ...block, executionStyle: 'slow_lowering' as const } : block),
    candidate.blocks.slice(1),
  ]
  for (const blocks of changedBlocks) {
    const changed = { ...candidate, blocks }
    changed.predictedLoad = predictSessionLoad(changed, input.athlete, input.library)
    const result = validateAuthoredSessions(input, [changed], { [original.id]: log }, partialOptions)
    assert.ok(result.violations.some(violation => violation.rule === 'authoredPartialAmendment'), JSON.stringify(result))
  }
  for (const change of [
    { date: '2026-09-08' }, { startTime: '08:00' }, { durationMin: 29 }, { label: 'Changed workout' }, { pinned: false },
  ]) {
    const result = validateAuthoredSessions(input, [{ ...candidate, ...change }], { [original.id]: log }, partialOptions)
    assert.ok(result.violations.some(violation => violation.rule === 'authoredPartialAmendment'), JSON.stringify(result))
  }
  const twoSets = structuredClone(log)
  const actual = twoSets.blockLogs![0]!
  assert.ok(actual.unit === 'reps')
  actual.sets = [...actual.sets, ...actual.sets]
  assert.ok(validateAuthoredSessions(input, [candidate], { [original.id]: twoSets }, partialOptions)
    .violations.some(violation => violation.rule === 'authoredPartialAmendment'))
})

test('partial option cannot authorize completed changes or amendments without block-level evidence', () => {
  const { input, original, candidate, log } = partialAmendmentFixture()
  const completed = { ...log, status: 'completed' as const }
  assert.ok(validateAuthoredSessions(input, [candidate], { [original.id]: completed }, partialOptions)
    .violations.some(violation => violation.rule === 'pinnedSessionPreserved'))
  const unknown: SessionLog = { sessionId: original.id, status: 'partial', painFlag: false, notes: '', actualDurationMin: 10 }
  assert.ok(validateAuthoredSessions(input, [candidate], { [original.id]: unknown }, partialOptions)
    .violations.some(violation => violation.rule === 'authoredPartialAmendment'))
  assert.equal(validateAuthoredSessions(input, [original], { [original.id]: unknown }, partialOptions).passed, true)
})

test('amended pinned IDs still enforce replacement profiles, equipment, costs and health holds', () => {
  const { input, original, candidate, log } = partialAmendmentFixture('2026-09-09')
  const limits = candidate.blocks.map((block, index) => index === 2 && block.unit === 'reps' ? { ...block, sets: 4 } : block)
  const overDose = { ...candidate, blocks: limits }
  overDose.predictedLoad = predictSessionLoad(overDose, input.athlete, input.library)
  assert.ok(validateAuthoredSessions(input, [overDose], { [original.id]: log }, partialOptions)
    .violations.some(violation => violation.rule === 'authoredDoseCeiling'))
  const unavailable = { ...candidate, blocks: candidate.blocks.map((block, index) => index === 2 && block.unit === 'reps'
    ? { ...block, exerciseId: 'machine-row' } : block) }
  unavailable.predictedLoad = predictSessionLoad(unavailable, input.athlete, input.library)
  assert.ok(validateAuthoredSessions(input, [unavailable], { [original.id]: log }, partialOptions)
    .violations.some(violation => violation.rule === 'authoredEquipment'))
  assert.ok(validateAuthoredSessions(input, [{ ...candidate, predictedLoad: { systemic: 0, structural: 0 } }],
    { [original.id]: log }, partialOptions).violations.some(violation => violation.rule === 'predictedLoadIntegrity'))
  assert.ok(validateAuthoredSessions(input, [candidate], { [original.id]: { ...log, painFlag: true } }, partialOptions)
    .violations.some(violation => violation.rule === 'authoredHealthHold'))
})

test('partial actual repetitions plus still-unperformed sets cannot hide inside a block total', () => {
  const input = fixture()
  const originalProposal = workout('partial-overrun')
  originalProposal.blocks = [
    { unit: 'reps', exerciseId: 'bodyweight-squat', sets: 2, reps: 10, targetRPE: 6 },
    { unit: 'reps', exerciseId: 'push-up', sets: 2, reps: 8, targetRPE: 6 },
    { unit: 'reps', exerciseId: 'dumbbell-row', sets: 2, reps: 8, targetRPE: 6 },
  ]
  const originalPlan = buildAuthoredWeek(input, proposal(originalProposal))
  assert.equal(originalPlan.safety.passed, true, JSON.stringify(originalPlan.safety))
  const original = { ...originalPlan.sessions[0]!, pinned: true } as WorkoutSession
  const candidatePlan = buildAuthoredWeek(input, proposal({
    ...originalProposal, blocks: [...originalProposal.blocks,
      { unit: 'reps', exerciseId: 'goblet-squat', sets: 1, reps: 8, targetRPE: 6 }],
  }))
  assert.equal(candidatePlan.safety.passed, true, JSON.stringify(candidatePlan.safety))
  const candidate = { ...candidatePlan.sessions[0]!, pinned: true } as WorkoutSession
  input.context.pinnedSessions = [original]
  const log = validateBlockLogs(original, {
    sessionId: original.id, status: 'partial', painFlag: false, notes: '',
    blockLogs: [{ unit: 'reps', blockIndex: 0, exerciseId: 'bodyweight-squat',
      sets: [{ exerciseId: 'bodyweight-squat', weightKg: 0, reps: 15, actualRPE: 6 }] }],
  })
  // Planned 60 repetitions, but 15 actual + 10 still pending in block 0 makes 65.
  const result = validateAuthoredSessions(input, [candidate], { [original.id]: log }, partialOptions)
  assert.ok(result.violations.some(violation => violation.rule === 'authoredActualSessionQuantity'), JSON.stringify(result))
  assert.equal(validateAuthoredSessions(input, [candidate],
    { [original.id]: { ...log, actualDurationMin: 0 } }, partialOptions).passed, false)
})

test('amended partial workouts retain actual overrun timing and aggregate session budgets', () => {
  const { input, original, candidate, log } = partialAmendmentFixture()
  const late = { ...log, actualDurationMin: 90 }
  const next = buildAuthoredWeek(fixture(), proposal({ ...run('later-run', '2026-09-07', 20), startTime: '08:00' })).sessions[0]!
  const result = validateAuthoredSessions(input, [candidate, next], { [original.id]: late }, partialOptions)
  assert.ok(result.violations.some(violation => violation.rule === 'authoredActualOverlap'))
  assert.ok(result.violations.some(violation => violation.rule === 'authoredActualLiftVolume'))
})

test('logged timed blocks stay completely immutable during a partial amendment', () => {
  const input = fixture()
  const p = workout('partial-timed')
  p.blocks = [p.blocks[0]!, { unit: 'seconds', exerciseId: 'dumbbell-farmer-carry', sets: 2, seconds: 30 }]
  const originalPlan = buildAuthoredWeek(input, proposal(p))
  assert.equal(originalPlan.safety.passed, true, JSON.stringify(originalPlan.safety))
  const original = { ...originalPlan.sessions[0]!, pinned: true } as WorkoutSession
  const candidatePlan = buildAuthoredWeek(input, proposal({ ...p, blocks: [
    { unit: 'reps', exerciseId: 'goblet-squat', sets: 1, reps: 4, targetRPE: 6 }, p.blocks[1]!,
  ] }))
  const candidate = { ...candidatePlan.sessions[0]!, pinned: true } as WorkoutSession
  input.context.pinnedSessions = [original]
  const log = validateBlockLogs(original, {
    sessionId: original.id, status: 'partial', painFlag: false, notes: '',
    blockLogs: [{ unit: 'seconds', blockIndex: 1, exerciseId: 'dumbbell-farmer-carry', seconds: 15 }],
  })
  assert.equal(validateAuthoredSessions(input, [candidate], { [original.id]: log }, partialOptions).passed, true)
  const changed = { ...candidate, blocks: candidate.blocks.map(block => block.unit === 'seconds' ? { ...block, sets: 1 } : block) }
  changed.predictedLoad = predictSessionLoad(changed, input.athlete, input.library)
  assert.ok(validateAuthoredSessions(input, [changed], { [original.id]: log }, partialOptions)
    .violations.some(violation => violation.rule === 'authoredPartialAmendment'))
})

test('a cheaper partial replacement cannot turn 9 actual plus 56 pending reps into an accepted 64-rep session', () => {
  const input = fixture()
  const supportingIds = input.library.exercises.filter(exercise => {
    const dose = exercise.profile?.prescription
    return !['goblet-squat', 'dumbbell-row', 'bodyweight-squat'].includes(exercise.id)
      && !exercise.highSkill && dose?.unit === 'reps' && dose.sets >= 2 && dose.reps >= 8
      && exercise.requirements?.every(resource => input.athlete.program!.resources.includes(resource))
      && exercise.equipment.every(equipment => equipment === 'none' || input.athlete.equipment.includes(equipment))
  }).slice(0, 2).map(exercise => exercise.id)
  assert.equal(supportingIds.length, 2)
  // The exact reviewer example also exceeds the OHP/RDL six-rep profile caps.
  // A fully supported 2x8 variant separately isolates the actual-quantity veto.
  for (const [suffix, supported] of [
    [['overhead-press', 'romanian-deadlift'], false],
    [supportingIds, true],
  ] as const) {
    const source = workout('cheaper-partial')
    source.blocks = ['goblet-squat', 'dumbbell-row', ...suffix].map(exerciseId => ({
      unit: 'reps', exerciseId, sets: 2, reps: 8, targetRPE: 6,
    }))
    const before = buildAuthoredWeek(input, proposal(source))
    const first = source.blocks[0]!
    assert.ok(first.unit === 'reps')
    const after = buildAuthoredWeek(input, proposal({ ...source, blocks: [
      { ...first, sets: 1 }, ...source.blocks.slice(1),
      { unit: 'reps', exerciseId: 'bodyweight-squat', sets: 1, reps: 8, targetRPE: 6 },
    ] }))
    if (supported) {
      assert.equal(before.safety.passed, true, JSON.stringify(before.safety))
      assert.equal(after.safety.passed, true, JSON.stringify(after.safety))
    }
    const original = { ...before.sessions[0]!, pinned: true } as WorkoutSession
    const candidate = { ...after.sessions[0]!, pinned: true } as WorkoutSession
    assert.ok(candidate.predictedLoad.systemic < original.predictedLoad.systemic)
    assert.ok(candidate.predictedLoad.structural < original.predictedLoad.structural)
    const withPin = { ...input, context: { ...input.context, pinnedSessions: [original] } }
    const log = validateBlockLogs(original, {
      sessionId: original.id, status: 'partial', painFlag: false, notes: '',
      blockLogs: [{ unit: 'reps', blockIndex: 0, exerciseId: 'goblet-squat',
        sets: [{ exerciseId: 'goblet-squat', weightKg: 12, reps: 9, actualRPE: 6 }] }],
    })
    const result = validateAuthoredSessions(withPin, [candidate], { [original.id]: log }, partialOptions)
    assert.ok(result.violations.some(violation => violation.rule === 'authoredActualSessionQuantity'), JSON.stringify(result))
    if (supported) {
      const exact = structuredClone(log)
      const blockLog = exact.blockLogs![0]!
      assert.ok(blockLog.unit === 'reps')
      blockLog.sets = [{ ...blockLog.sets[0]!, reps: 8 }]
      const control = validateAuthoredSessions(withPin, [candidate], { [original.id]: exact }, partialOptions)
      assert.equal(control.passed, true, JSON.stringify(control))
    }
  }
})

function historicalWeightFixture() {
  const result = partialAmendmentFixture()
  const { input, original, candidate } = result
  const previous = { ...structuredClone(original), id: 'weight-evidence-20260907', pinned: false }
  const previousLog = validateBlockLogs(previous, {
    sessionId: previous.id, status: 'completed', painFlag: false, notes: '',
    blockLogs: previous.blocks.map((block, blockIndex) => {
      assert.ok(block.unit === 'reps')
      return { unit: 'reps', blockIndex, exerciseId: block.exerciseId,
        sets: [{ exerciseId: block.exerciseId, weightKg: blockIndex === 0 ? 10 : 20,
          reps: block.reps, actualRPE: block.targetRPE }] }
    }),
  })
  input.weekIndex = 1
  original.date = '2026-09-14'
  original.isCalibration = false
  candidate.date = original.date
  original.blocks = original.blocks.map((block, index) => block.unit === 'reps'
    ? { ...block, suggestedWeightKg: index === 0 ? 10 : 20 } : block)
  candidate.blocks = candidate.blocks.map((block, index) => index === 0 && block.unit === 'reps'
    ? { ...block, suggestedWeightKg: 10 } : block)
  input.context.pinnedSessions = [original]
  input.context.recentSessions = [{ session: previous, log: previousLog }]
  return result
}

test('opt-in partial amendments preserve proved historic suggestions without copying them to replacement blocks', () => {
  const { input, original, candidate, log } = historicalWeightFixture()
  assert.equal(input.athlete.baseline.exercises.length, 0)
  const snapshot = JSON.stringify({ input, original, candidate, log })
  const unchanged = validateAuthoredSessions(input, [original], { [original.id]: log })
  assert.equal(unchanged.passed, true, JSON.stringify(unchanged))
  const strict = validateAuthoredSessions(input, [candidate], { [original.id]: log })
  assert.ok(strict.violations.some(violation => violation.rule === 'authoredObservedWeightOnly'))
  const amended = validateAuthoredSessions(input, [candidate], { [original.id]: log }, partialOptions)
  assert.equal(amended.passed, true, JSON.stringify(amended))
  assert.equal(JSON.stringify({ input, original, candidate, log }), snapshot)
  assert.ok(!('suggestedWeightKg' in candidate.blocks[2]!))
  const forgedReplacement = { ...candidate, blocks: candidate.blocks.map((block, index) => index === 2 && block.unit === 'reps'
    ? { ...block, suggestedWeightKg: 10 } : block) }
  assert.ok(validateAuthoredSessions(input, [forgedReplacement], { [original.id]: log }, partialOptions)
    .violations.some(violation => violation.rule === 'authoredObservedWeightOnly'))
  const fresh = buildAuthoredWeek({ ...input, context: { ...input.context, pinnedSessions: [] } }, {
    version: 1, weekStart: '2026-09-14', sessions: [workout('fresh', '2026-09-14', ['bodyweight-split-squat'])],
  })
  assert.equal(fresh.safety.passed, true, JSON.stringify(fresh.safety))
  assert.ok(fresh.sessions.every(session => session.kind !== 'workout'
    || session.blocks.every(block => !('suggestedWeightKg' in block))),
  'Ordinary authored generation still cannot introduce a weight from log-only evidence.')
})

test('historic pinned weights require independent same-ID evidence and cannot be invented in either snapshot', () => {
  const { input, original, candidate, log } = historicalWeightFixture()
  const noEvidence = { ...input, context: { ...input.context, recentSessions: [] } }
  assert.ok(validateAuthoredSessions(noEvidence, [candidate], { [original.id]: log }, partialOptions)
    .violations.some(violation => violation.rule === 'authoredObservedWeightOnly'))
  const forgedOriginal = { ...original, blocks: original.blocks.map((block, index) => index === 0 && block.unit === 'reps'
    ? { ...block, suggestedWeightKg: 11 } : block) }
  const forgedCandidate = { ...candidate, blocks: candidate.blocks.map((block, index) => index === 0 && block.unit === 'reps'
    ? { ...block, suggestedWeightKg: 11 } : block) }
  const forgedInput = { ...input, context: { ...input.context, pinnedSessions: [forgedOriginal] } }
  assert.ok(validateAuthoredSessions(forgedInput, [forgedCandidate], { [original.id]: log }, partialOptions)
    .violations.some(violation => violation.rule === 'authoredObservedWeightOnly'))
  const rewritten = { ...candidate, blocks: candidate.blocks.map((block, index) => index === 0 && block.unit === 'reps'
    ? { ...block, suggestedWeightKg: 12 } : block) }
  assert.ok(validateAuthoredSessions(input, [rewritten], { [original.id]: log }, partialOptions)
    .violations.some(violation => violation.rule === 'authoredPartialAmendment'))
})

test('exact completed snapshots retain all proved original weight metadata despite newer actual weights', () => {
  const { input, original } = historicalWeightFixture()
  const log = validateBlockLogs(original, {
    sessionId: original.id, status: 'completed', painFlag: false, notes: '',
    blockLogs: [{ unit: 'reps', blockIndex: 0, exerciseId: 'bodyweight-split-squat',
      sets: [{ exerciseId: 'bodyweight-split-squat', weightKg: 12, reps: 6, actualRPE: 6 }] }],
  })
  const result = validateAuthoredSessions(input, [original], { [original.id]: log }, partialOptions)
  assert.equal(result.passed, true, JSON.stringify(result))
  assert.deepEqual(validateAuthoredSessions(input, [original], { [original.id]: log }), result,
    'An exact completed snapshot needs no amendment permission to retain proved historical metadata.')
  const noEvidence = { ...input, context: { ...input.context, recentSessions: [] } }
  assert.equal(validateAuthoredSessions(noEvidence, [original], { [original.id]: log }).passed, false,
    'Pinned status alone cannot establish that a weight was ever observed.')
  assert.equal((original.blocks[0] as Extract<typeof original.blocks[number], { unit: 'reps' }>).suggestedWeightKg, 10)
  assert.equal((original.blocks[1] as Extract<typeof original.blocks[number], { unit: 'reps' }>).suggestedWeightKg, 20)
  const changed = { ...original, blocks: original.blocks.map((block, index) => index === 1 && block.unit === 'reps'
    ? { ...block, suggestedWeightKg: 21 } : block) }
  assert.ok(validateAuthoredSessions(input, [changed], { [original.id]: log }, partialOptions)
    .violations.some(violation => violation.rule === 'pinnedSessionPreserved'))
  assert.ok(validateAuthoredSessions(input, [changed], { [original.id]: log })
    .violations.some(violation => violation.rule === 'pinnedSessionPreserved'))
})

test('a preserved historic weight does not suppress latest-performance checks on a different new block', () => {
  const { input, original, candidate, log } = historicalWeightFixture()
  original.date = '2026-09-16'
  candidate.date = original.date
  input.athlete.baseline.exercises = [{
    exerciseId: 'custom-steady-lunge', date: '2026-09-07', weightKg: 10,
    sets: 1, reps: 6, actualRPE: 6, experienceMonths: 24,
  }]
  const appended = candidate.blocks[2]!
  assert.ok(appended.unit === 'reps')
  const earlier: WorkoutSession = { ...candidate, id: 'earlier-lunge', date: '2026-09-14',
    blocks: [{ ...appended, role: 'anchor' }] }
  earlier.predictedLoad = predictSessionLoad(earlier, input.athlete, input.library)
  const earlierLog = validateBlockLogs(earlier, {
    sessionId: earlier.id, status: 'completed', painFlag: false, notes: '',
    blockLogs: [{ unit: 'reps', blockIndex: 0, exerciseId: appended.exerciseId,
      sets: [{ exerciseId: appended.exerciseId, weightKg: 12, reps: 6, actualRPE: 6 }] }],
  })
  candidate.blocks = candidate.blocks.map((block, index) => index === 2 && block.unit === 'reps'
    ? { ...block, suggestedWeightKg: 10 } : block)
  candidate.predictedLoad = predictSessionLoad(candidate, input.athlete, input.library)
  input.context.pinnedSessions = [original, earlier]
  const result = validateAuthoredSessions(input, [earlier, candidate],
    { [original.id]: log, [earlier.id]: earlierLog }, partialOptions)
  assert.ok(result.violations.some(violation => violation.rule === 'observedWeightOnly'), JSON.stringify(result))
})

const advisoryOptions = { policy: 'ai-advisory' } as const
const advisoryPartialOptions = { ...advisoryOptions, ...partialOptions }

function twiceDailyRuns(): AuthoredSessionProposal[] {
  return Array.from({ length: 14 }, (_, index) => ({
    ...run(`double-${index}`, addDays('2026-09-07', Math.floor(index / 2)), 30),
    startTime: index % 2 ? '18:00' : '07:00',
  }))
}

test('explicit AI policy accepts 14 actual run sessions with two daily and no full rest day, deterministically', () => {
  const input = fixture()
  const p = proposal(...twiceDailyRuns())
  const snapshot = JSON.stringify({ input, p })
  const plan = buildAuthoredWeek(input, p, advisoryOptions)
  assert.equal(plan.policyVersion, AI_ADVISORY_POLICY_VERSION)
  assert.equal(plan.policyVersion, 'authored-ai-advisory-1')
  assert.equal(plan.sessions.length, 14)
  assert.ok(plan.sessions.every(session => session.kind === 'run' && session.durationMin === 30))
  for (let day = 0; day < 7; day++) {
    assert.equal(plan.sessions.filter(session => session.date === addDays(p.weekStart, day)).length, 2)
  }
  assert.deepEqual(plan.safety, { passed: true, violations: [] })
  assert.equal(plan.feasibility.fits, true)
  assert.deepEqual(plan.omitted, [])
  assert.equal(plan.audit.rejectedBySafety, 0)
  assert.ok(plan.warnings.some(warning => warning.includes('[restDay]')))
  assert.ok(plan.warnings.some(warning => warning.includes('[authoredRunBaseline]')))
  assert.ok(plan.warnings.some(warning => warning.includes('not medically safe ranges')))
  const result = validateAuthoredSessions(input, plan.sessions, {}, advisoryOptions)
  assert.equal(result.passed, true, JSON.stringify(result))
  assert.ok(result.advisories?.some(item => item.rule === 'authoredOccupiedRestDay'))
  assert.deepEqual(result.violations, [])
  assert.deepEqual(buildAuthoredWeek(input, { ...p, sessions: [...p.sessions].reverse() }, advisoryOptions), plan)
  assert.deepEqual(validateAuthoredSessions(input, plan.sessions, {}, advisoryOptions), result)
  assert.equal(JSON.stringify({ input, p }), snapshot)
  assert.throws(() => buildAuthoredWeek(input, p), /0 to 12/)
  assert.equal(validateAuthoredSessions(input, plan.sessions).passed, false)
  assert.equal(Object.hasOwn(validateAuthoredSessions(input, plan.sessions), 'advisories'), false)
  assert.deepEqual(authoredProposalFromSessions(p.weekStart, plan.sessions, advisoryOptions).sessions.map(item => item.id),
    plan.sessions.map(item => item.id))
})

test('AI frequency is not capped at runs-only: 14 runs plus lifting and original club commitments all remain', () => {
  const input = fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: 30 })
  const p = proposal(...twiceDailyRuns(), ...[0, 2, 4, 6].map(index => ({
    ...workout(`extra-lift-${index}`, addDays('2026-09-07', index)), startTime: '12:00',
  })))
  const plan = buildAuthoredWeek(input, p, advisoryOptions)
  assert.equal(plan.sessions.length, 19)
  assert.equal(plan.safety.passed, true, JSON.stringify(plan.safety))
  assert.equal(plan.sessions.filter(session => session.kind === 'run').length, 14)
  assert.equal(plan.sessions.filter(session => session.kind === 'workout').length, 4)
  assert.equal(plan.sessions.filter(session => session.kind === 'commitment').length, 1)
  assert.ok(plan.warnings.some(warning => warning.includes('[sessionsPerDay]')))
  assert.ok(plan.warnings.some(warning => warning.includes('[liftFrequency]')))
  assert.equal(AI_ADVISORY_LIMITS.maxSessions, 56)
  assert.deepEqual([LIMITS.maxRuns, LIMITS.maxLifts, LIMITS.maxRunMinutes, LIMITS.maxWeeklyRunMinutes], [4, 3, 180, 600])
})

test('advisory high-frequency baseline observations round-trip exactly without old generator bounds or fabricated facts', () => {
  const input = fixture()
  input.athlete.baseline = { ...input.athlete.baseline,
    runsPerWeek: 14, weeklyRunMinutes: 1120, longestRunMinutes: 240, liftsPerWeek: 7, liftDurationMin: 210 }
  input.athlete.program!.conditioningBaselines = [
    { modality: 'run_road', sessionsPerWeek: 14, weeklyMinutes: 1120, longestSessionMinutes: 240 },
    { modality: 'row', sessionsPerWeek: 7, weeklyMinutes: 700, longestSessionMinutes: 210 },
  ]
  input.athlete.program = parseProgramConfigWithOptions(input.athlete.program, advisoryOptions)
  input.library = resolveProgramLibrary(input.athlete.program, advisoryOptions)
  input.block = parseBlockWithOptions(generateBlock(input.athlete, input.block.goal, input.block.startDate, input.library, advisoryOptions), advisoryOptions)
  const snapshot = JSON.stringify(input)
  assert.deepEqual(parseAuthoredPlanWeekInput(input, advisoryOptions), input)
  assert.deepEqual(parseAthleteWithOptions(input.athlete, advisoryOptions).baseline, input.athlete.baseline)
  assert.deepEqual(parseBlockWithOptions(input.block, advisoryOptions), input.block)
  assert.deepEqual(parseProgramConfigWithOptions(input.athlete.program, advisoryOptions), input.athlete.program)
  const plan = buildAuthoredWeek(input, proposal(...twiceDailyRuns()), advisoryOptions)
  assert.equal(plan.sessions.length, 14)
  assert.equal(plan.safety.passed, true, JSON.stringify(plan.safety))
  assert.equal(JSON.stringify(input), snapshot)
  assert.throws(() => parseAuthoredPlanWeekInput(input), /finite/)
  assert.throws(() => parseAthlete(input.athlete), /finite/)
  assert.throws(() => generateBlock(input.athlete, input.block.goal, input.block.startDate, input.library), /finite/)
})

test('confirmed zero running and lifting is factual input, never invented capacity, and new AI work only advises', () => {
  const input = fixture()
  input.athlete.baseline = { ...input.athlete.baseline, runsPerWeek: 0, weeklyRunMinutes: 0,
    longestRunMinutes: 0, liftsPerWeek: 0, liftDurationMin: 0, exercises: [] }
  input.athlete.program!.conditioningBaselines = [
    { modality: 'run_road', sessionsPerWeek: 0, weeklyMinutes: 0, longestSessionMinutes: 0 },
  ]
  input.library = resolveProgramLibrary(input.athlete.program, advisoryOptions)
  input.block = generateBlock(input.athlete, input.block.goal, input.block.startDate, input.library, advisoryOptions)
  const before = JSON.stringify(input)
  const parsed = parseAuthoredPlanWeekInput(input, advisoryOptions)
  assert.deepEqual(parsed.athlete.baseline, input.athlete.baseline)
  const plan = buildAuthoredWeek(input, proposal(run(), workout()), advisoryOptions)
  assert.equal(plan.safety.passed, true, JSON.stringify(plan.safety))
  assert.equal(plan.sessions.length, 2)
  assert.ok(plan.warnings.some(item => item.includes('[authoredRunBaseline]')))
  assert.ok(plan.warnings.some(item => item.includes('[authoredLiftBaseline]')))
  assert.ok(plan.sessions.every(session => session.kind !== 'workout'
    || session.blocks.every(block => !('suggestedWeightKg' in block))))
  assert.equal(JSON.stringify(input), before)
  assert.throws(() => parseAuthoredPlanWeekInput(input), /finite/)
  const inconsistent = structuredClone(input)
  inconsistent.athlete.baseline.runsPerWeek = 1
  assert.throws(() => parseAuthoredPlanWeekInput(inconsistent, advisoryOptions), /zero observed|exactly match/)
})

test('long runs beyond 60 and 180 minutes and larger known-profile strength doses advise rather than veto', () => {
  const input = fixture()
  const longRun = { ...run('long', '2026-09-08', 240), intent: 'long' as const }
  const bigLift = { ...workout(), durationMin: 120,
    blocks: [{ unit: 'reps' as const, exerciseId: 'push-up', sets: 8, reps: 30, targetRPE: 8 as const }] }
  const timed = { ...workout('timed', '2026-09-10'), durationMin: 90,
    blocks: [{ unit: 'seconds' as const, exerciseId: 'dumbbell-farmer-carry', sets: 6, seconds: 600 }] }
  const plan = buildAuthoredWeek(input, proposal(longRun, bigLift, timed), advisoryOptions)
  assert.equal(plan.safety.passed, true, JSON.stringify(plan.safety))
  assert.equal(plan.sessions.find(session => session.id === 'long')!.durationMin, 240)
  assert.ok(plan.warnings.some(item => item.includes('[longestRun]')))
  assert.ok(plan.warnings.some(item => item.includes('[authoredDoseCeiling]')))
  assert.ok(plan.warnings.some(item => item.includes('[authoredSessionQuantity]')))
  assert.ok(plan.warnings.some(item => item.includes('[authoredWeeklyQuantity]')))
  for (const session of plan.sessions) assert.deepEqual(parseSessionWithOptions(session, advisoryOptions), session)
  assert.equal(validateAuthoredSessions(input, plan.sessions, {}, advisoryOptions).passed, true)
  hasRule(input, proposal(longRun), 'longestRun')
  assert.throws(() => parseAuthoredWeekProposal(proposal(bigLift)), /finite/)
  const impossible = buildAuthoredWeek(input, proposal({ ...timed, durationMin: 1 }), advisoryOptions)
  assert.ok(impossible.safety.violations.some(item => item.rule === 'authoredDurationQuantity'))
})

test('new supported modality work has no borrowed baseline but still has real deterministic cost and an advisory', () => {
  const input = fixture()
  input.athlete.program!.resources = [...input.athlete.program!.resources, 'bike']
  input.block.program!.resources = [...input.block.program!.resources, 'bike']
  const row: AuthoredSessionProposal = { id: 'new-modality', kind: 'conditioning', label: 'Bike',
    modality: 'bike_road', date: '2026-09-10', startTime: '07:00', durationMin: 60 }
  const plan = buildAuthoredWeek(input, proposal(row), advisoryOptions)
  assert.equal(plan.safety.passed, true)
  assert.ok(plan.sessions[0]!.predictedLoad.systemic > 0)
  assert.ok(plan.warnings.some(item => item.includes('[authoredConditioningBaseline]')))
  assert.equal(input.athlete.program!.conditioningBaselines.some(item => item.modality === 'bike_road'), false)
  hasRule(input, proposal(row), 'authoredConditioningBaseline')
})

test('advisory schedules retain budget, availability, overlap, goal and recovery references without training vetoes', () => {
  const input = fixture()
  input.athlete.availableDays = [6]
  input.athlete.weeklyTimeBudgetMin = 1
  input.context.untimedStrengthDates = ['2026-09-06']
  const plan = buildAuthoredWeek(input, proposal(workout(), workout('next', '2026-09-08'), run('overlap', '2026-09-07')), advisoryOptions)
  assert.equal(plan.safety.passed, true, JSON.stringify(plan.safety))
  for (const rule of ['availableDays', 'weeklyTimeBudget', 'minimumLiftGap', 'overlappingSessions', 'untimedStrengthBoundary']) {
    assert.ok(plan.warnings.some(item => item.includes(`[${rule}]`)), rule)
  }
  const late = fixture()
  late.block = generateBlock(late.athlete, { ...late.block.goal, peakDate: '2026-09-10' }, late.block.startDate, late.library)
  const afterGoal = buildAuthoredWeek(late, proposal(run('after-goal', '2026-09-11')), advisoryOptions)
  assert.equal(afterGoal.safety.passed, true, JSON.stringify(afterGoal.safety))
  assert.ok(afterGoal.warnings.some(item => item.includes('[goalDateBoundary]')))
})

test('pain, illness and actual overruns remain factual warnings and immutable records even without proposed work', () => {
  const input = fixture()
  const original = pin(input, run('done', '2026-09-07'))
  const log: SessionLog = { sessionId: original.id, status: 'completed', actualDurationMin: 100,
    painFlag: true, notes: 'Original factual record.' }
  const skipped = { ...pin(input, run('illness', '2026-09-09')), startTime: '12:00' }
  const illness: SessionLog = { sessionId: skipped.id, status: 'skipped', skipReason: 'illness', painFlag: false, notes: '' }
  input.context.pinnedSessions = [original, skipped]
  input.context.recentSessions = [{ session: original, log }, { session: skipped, log: illness }]
  input.athlete.safetyHold = { reason: 'pain', since: '2026-09-07' }
  const before = JSON.stringify(input)
  const plan = buildAuthoredWeek(input, proposal({ ...run('overrun-overlap', '2026-09-07'), startTime: '08:00' }), advisoryOptions)
  assert.equal(plan.safety.passed, true, JSON.stringify(plan.safety))
  for (const rule of ['authoredHealthHold', 'authoredActualOverlap', 'authoredActualRunVolume', 'authoredRecordedHealth', 'authoredRecordedOverrun']) {
    assert.ok(plan.warnings.some(item => item.includes(`[${rule}]`)), rule)
  }
  const quiet = buildAuthoredWeek(input, proposal(), advisoryOptions)
  assert.ok(quiet.warnings.some(item => item.includes('Recorded illness')))
  assert.ok(quiet.warnings.some(item => item.includes('Recorded pain')))
  assert.ok(quiet.warnings.some(item => item.includes('[authoredRecordedOverrun]')))
  assert.deepEqual(plan.sessions.find(session => session.id === original.id), original)
  assert.equal(JSON.stringify(input), before)
  const result = validateAuthoredSessions(input, plan.sessions, {}, advisoryOptions)
  assert.equal(result.passed, true, JSON.stringify(result))
  assert.ok(result.advisories?.some(item => item.rule === 'authoredRecordedHealth'))
  assert.equal(validateAuthoredSessions(input, plan.sessions, { [original.id]: { ...log, painFlag: false } }, advisoryOptions).passed, false)
})

test('advisory calibration and throw-quantity references never loosen controlled identity or original practice integrity', () => {
  const input = fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: 30, customSportDrills: [drill] })
  const authored = throwSession([{ unit: 'throws', drillId: drill.id, throws: 501 }])
  const plan = buildAuthoredWeek(input, proposal(authored), advisoryOptions)
  assert.equal(plan.safety.passed, true, JSON.stringify(plan.safety))
  assert.ok(plan.warnings.some(item => item.includes('[authoredThrowDose]')))
  const uncalibrated = plan.sessions.map(session => ({ ...session, isCalibration: false }))
  const result = validateAuthoredSessions(input, uncalibrated, {}, advisoryOptions)
  assert.equal(result.passed, true, JSON.stringify(result))
  assert.ok(result.advisories?.some(item => item.rule === 'authoredThrowCalibration'))
  for (const edit of [{ date: '2026-09-10' }, { durationMin: 61 }, { label: 'Rewritten club' }]) {
    const changed = buildAuthoredWeek(input, proposal({ ...authored, ...edit }), advisoryOptions)
    assert.ok(changed.safety.violations.some(item => item.rule === 'fixedCommitmentPreserved'))
  }
  assert.equal(validateAuthoredSessions(input, [], {}, advisoryOptions).passed, false)
  const unknown = buildAuthoredWeek(input, proposal(throwSession([{ unit: 'throws', drillId: 'custom-unknown', throws: 5 }])), advisoryOptions)
  assert.ok(unknown.safety.violations.some(item => item.rule === 'authoredThrowProfile'))
})

test('advisory proposals and sessions still reject malformed, negative, nonfinite, excessive-array and forged authority data', () => {
  const input = fixture()
  for (const durationMin of [-1, 0, NaN, Infinity, 1441, '30']) {
    assert.throws(() => parseAuthoredWeekProposal(proposal({ ...run(), durationMin } as AuthoredSessionProposal), advisoryOptions))
  }
  for (const sets of [-1, NaN, Infinity, AI_ADVISORY_LIMITS.maxSetsPerBlock + 1]) {
    assert.throws(() => parseAuthoredWeekProposal(proposal({ ...workout(),
      blocks: [{ unit: 'reps', exerciseId: 'push-up', sets, reps: 8, targetRPE: 6 }] }), advisoryOptions))
  }
  assert.throws(() => parseAuthoredWeekProposal(proposal(...Array.from({ length: 57 }, (_, i) => run(`too-many-${i}`))), advisoryOptions))
  assert.throws(() => parseAuthoredWeekProposal({ ...proposal(), sessions: new Array(2) }, advisoryOptions), /hole/)
  assert.throws(() => parseAuthoredWeekProposal({ ...proposal(), safety: true }, advisoryOptions), /unknown field/)
  assert.throws(() => parseAuthoredWeekProposal(proposal(), { policy: 'invented' } as never), /policy/)
  assert.throws(() => parseAuthoredPlanWeekInput(input, { policy: 'invented' } as never), /policy/)
  const plan = buildAuthoredWeek(input, proposal(workout()), advisoryOptions)
  for (const durationMin of [-1, NaN, Infinity]) {
    const result = validateAuthoredSessions(input, [{ ...plan.sessions[0]!, durationMin }], {}, advisoryOptions)
    assert.equal(result.passed, false)
    assert.equal(result.violations[0]!.rule, 'invalidAuthoredSafetyInput')
  }
  assert.equal(validateAuthoredSessions(input, plan.sessions, {}, { ...advisoryOptions, allowPartialWorkoutAmendments: 'yes' } as never).passed, false)
  assert.equal(validateAuthoredSessions(input, [{ ...plan.sessions[0]!, pinned: true }], {}, advisoryOptions).passed, false)
  assert.equal(validateAuthoredSessions(input, [{ ...plan.sessions[0]!, predictedLoad: { systemic: 0, structural: 0 } }], {}, advisoryOptions).passed, false)
})

test('advisory keeps unsupported movements, ballistic execution, missing equipment/resources and fabricated weights hard', () => {
  const input = fixture()
  for (const exerciseId of ['invented', 'snatch', 'dumbbell-farmer-carry']) {
    assert.throws(() => buildAuthoredWeek(input, proposal(workout('bad', '2026-09-07', [exerciseId])), advisoryOptions), /Unsupported|unit/)
  }
  const plan = buildAuthoredWeek(input, proposal(workout()), advisoryOptions)
  const session = plan.sessions[0] as WorkoutSession
  for (const change of [{ exerciseId: 'invented' }, { suggestedWeightKg: 10 }, { executionStyle: 'fast_concentric_intent' }]) {
    const candidate = { ...session, blocks: session.blocks.map((block, index) => index ? block : { ...block, ...change }) } as WorkoutSession
    const result = validateAuthoredSessions(input, [candidate], {}, advisoryOptions)
    assert.equal(result.passed, false, JSON.stringify(result))
  }
  const unavailable = buildAuthoredWeek(input, proposal(workout('machine', '2026-09-07', ['leg-press'])), advisoryOptions)
  assert.equal(unavailable.safety.passed, false)
  assert.ok(unavailable.safety.violations.some(item => item.rule === 'authoredEquipment' || item.rule === 'programExerciseProfile'))
  const resource = structuredClone(input)
  resource.athlete.program!.resources = resource.athlete.program!.resources.filter(item => item !== 'carry_space')
  resource.block.program!.resources = resource.block.program!.resources.filter(item => item !== 'carry_space')
  assert.throws(() => buildAuthoredWeek(resource, proposal({ ...workout(), blocks: [
    { unit: 'seconds', exerciseId: 'dumbbell-farmer-carry', sets: 1, seconds: 30 },
  ] }), advisoryOptions), /unavailable resources/)
  const forged = structuredClone(input)
  forged.library.exercises.find(exercise => exercise.id === 'push-up')!.coefficients.systemic = 0
  assert.throws(() => buildAuthoredWeek(forged, proposal(workout()), advisoryOptions), /coefficients|immutable|canonical/)
})

test('AI advisory preserves completed and partial logged identities, while only opt-in proved remainder amendments can change', () => {
  const { input, original, candidate, log } = partialAmendmentFixture()
  const logs = { [original.id]: log }
  assert.equal(validateAuthoredSessions(input, [candidate], logs, advisoryOptions).passed, false)
  assert.equal(validateAuthoredSessions(input, [candidate], logs, advisoryPartialOptions).passed, true)
  const changed = structuredClone(candidate)
  assert.ok(changed.blocks[0]!.unit === 'reps')
  changed.blocks[0]!.exerciseId = 'push-up'
  changed.predictedLoad = predictSessionLoad(changed, input.athlete, input.library)
  const rewritten = validateAuthoredSessions(input, [changed], logs, advisoryPartialOptions)
  assert.ok(rewritten.violations.some(item => item.rule === 'authoredPartialAmendment'))
  const completed: SessionLog = { ...log, status: 'completed' }
  assert.equal(validateAuthoredSessions(input, [candidate], { [original.id]: completed }, advisoryPartialOptions).passed, false)
  assert.equal(validateAuthoredSessions(input, [], logs, advisoryPartialOptions).passed, false)
  assert.throws(() => buildAuthoredWeek(input, proposal(workout(original.id)), advisoryOptions), /replace pinned/)
  const extra = structuredClone(candidate)
  extra.blocks = [...extra.blocks, { unit: 'reps', exerciseId: 'dead-bug', sets: 8, reps: 30,
    targetRPE: 6, role: 'accessory', executionStyle: 'controlled' }]
  extra.predictedLoad = predictSessionLoad(extra, input.athlete, input.library)
  const amended = validateAuthoredSessions(input, [extra], logs, advisoryPartialOptions)
  assert.equal(amended.passed, true, JSON.stringify(amended))
  assert.ok(amended.advisories?.some(item => item.rule === 'authoredActualSessionQuantity'))
})

test('advisory retains proved legacy 10kg pins and factual 12kg actuals without copying weights or hiding partial overruns', () => {
  const { input, original, candidate, log } = historicalWeightFixture()
  const before = JSON.stringify({ input, original, candidate, log })
  const result = validateAuthoredSessions(input, [candidate], { [original.id]: log }, advisoryPartialOptions)
  assert.equal(result.passed, true, JSON.stringify(result))
  assert.ok(result.advisories?.some(item => item.rule === 'authoredRecordedOverrun'))
  assert.ok(original.blocks[0]!.unit === 'reps')
  assert.equal(original.blocks[0]!.suggestedWeightKg, 10)
  assert.ok(log.blockLogs![0]!.unit === 'reps')
  assert.equal(log.blockLogs![0]!.sets[0]!.weightKg, 12)
  const completed: SessionLog = { ...log, status: 'completed' }
  const withActuals = { ...input, context: { ...input.context,
    recentSessions: [...input.context.recentSessions, { session: original, log: completed }] } }
  const preserved = buildAuthoredWeek(withActuals, { version: 1, weekStart: '2026-09-14', sessions: [] }, advisoryOptions)
  assert.equal(preserved.safety.passed, true, JSON.stringify(preserved.safety))
  assert.deepEqual(preserved.sessions, [original])
  const noEvidence = { ...input, context: { ...input.context, recentSessions: [] } }
  assert.equal(validateAuthoredSessions(noEvidence, [candidate], { [original.id]: log }, advisoryPartialOptions).passed, false)
  const forged = { ...candidate, blocks: candidate.blocks.map((block, index) => index === 2 && block.unit === 'reps'
    ? { ...block, suggestedWeightKg: 10 } : block) }
  assert.equal(validateAuthoredSessions(input, [forged], { [original.id]: log }, advisoryPartialOptions).passed, false)
  assert.equal(JSON.stringify({ input, original, candidate, log }), before)
})

test('advisory counts actual per-set overruns plus remaining work even without requesting an amendment', () => {
  const input = fixture()
  const authored = { ...workout('actual-plus-remaining'),
    blocks: ['bodyweight-squat', 'push-up', 'dead-bug'].map(exerciseId => ({
      unit: 'reps' as const, exerciseId, sets: 2, reps: 10, targetRPE: 6 as const,
    })) }
  const original = pin(input, authored) as WorkoutSession
  const log = validateBlockLogs(original, {
    sessionId: original.id, status: 'partial', painFlag: false, notes: '',
    blockLogs: [{ unit: 'reps', blockIndex: 0, exerciseId: 'bodyweight-squat',
      sets: [{ exerciseId: 'bodyweight-squat', weightKg: 0, reps: 15, actualRPE: 6 }] }],
  })
  input.context.pinnedSessions = [original]
  input.context.recentSessions = [{ session: original, log }]
  const before = JSON.stringify(input)
  const result = validateAuthoredSessions(input, [original], {}, advisoryOptions)
  assert.equal(result.passed, true, JSON.stringify(result))
  // 15 actual + 10 pending in block 0 + 40 in other blocks is 65, not 60.
  assert.ok(result.advisories?.some(item => item.rule === 'authoredActualSessionQuantity'))
  assert.ok(result.advisories?.some(item => item.rule === 'authoredRecordedOverrun'))
  const plan = buildAuthoredWeek(input, proposal(), advisoryOptions)
  assert.equal(plan.safety.passed, true)
  assert.ok(plan.warnings.some(item => item.includes('[authoredActualSessionQuantity]')))
  assert.deepEqual(plan.sessions, [original])
  assert.equal(JSON.stringify(input), before)
})

test('AI structural bounds remain hard for malformed baseline facts, wrong weeks and invalid movement units', () => {
  const input = fixture()
  for (const value of [-1, NaN, Infinity, AI_ADVISORY_LIMITS.maxRuns + 1]) {
    const changed = structuredClone(input)
    changed.athlete.baseline.runsPerWeek = value
    assert.throws(() => parseAuthoredPlanWeekInput(changed, advisoryOptions), /finite/)
  }
  const inconsistent = structuredClone(input)
  inconsistent.athlete.baseline.weeklyRunMinutes = 200
  assert.throws(() => parseAuthoredPlanWeekInput(inconsistent, advisoryOptions), /frequency times longest/)
  const outside = buildAuthoredWeek(input, proposal(run('wrong-week', '2026-09-14')), advisoryOptions)
  assert.ok(outside.safety.violations.some(item => item.rule === 'requestedWeek'))
  assert.throws(() => parseAuthoredWeekProposal(proposal({ ...workout(), blocks: [
    { unit: 'meters', exerciseId: 'push-up', meters: 10 } as unknown as AuthoredWorkoutBlock,
  ] }), advisoryOptions), /unit/)
  const planned = buildAuthoredWeek(input, proposal(workout()), advisoryOptions).sessions[0] as WorkoutSession
  const changed = { ...planned, blocks: [{ ...planned.blocks[0], unit: 'meters' }] } as unknown as Session
  assert.equal(validateAuthoredSessions(input, [changed], {}, advisoryOptions).passed, false)
  const many = proposal(...Array.from({ length: AI_ADVISORY_LIMITS.maxSessions }, (_, index) => ({
    ...run(`finite-${index}`, addDays('2026-09-07', index % 7), 1),
    startTime: `${String(6 + Math.floor(index / 7)).padStart(2, '0')}:00`,
  })))
  assert.equal(buildAuthoredWeek(input, many, advisoryOptions).sessions.length, AI_ADVISORY_LIMITS.maxSessions)
  const club = fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: 30 })
  assert.throws(() => buildAuthoredWeek(club, many, advisoryOptions), /0 to 56/)
})

test('legacy unary parsers remain safe direct Array.map callbacks for stored plans and records', () => {
  const input = fixture()
  const plan = buildAuthoredWeek(input, proposal(workout(), run()))
  const restored = JSON.parse(JSON.stringify(plan)) as typeof plan
  assert.deepEqual(restored.sessions.map(parseSession), plan.sessions)
  assert.deepEqual([input, input].map(parsePlanWeekInput), [input, input])
  assert.deepEqual([input.athlete, input.athlete].map(parseAthlete), [input.athlete, input.athlete])
  assert.deepEqual([input.block, input.block].map(parseBlock), [input.block, input.block])
  assert.deepEqual([input.context, input.context].map(parsePlanningContext), [input.context, input.context])
  assert.deepEqual([input.athlete.program, input.athlete.program].map(parseProgramConfig),
    [input.athlete.program, input.athlete.program])
  const original = plan.sessions.find(session => session.kind === 'workout') as WorkoutSession
  assert.deepEqual(original.blocks.map(parseWorkoutBlock), original.blocks)
  const log = validateBlockLogs(original, {
    sessionId: original.id, status: 'completed', painFlag: false, notes: '',
    blockLogs: [{ unit: 'reps', blockIndex: 0, exerciseId: 'bodyweight-squat',
      sets: [{ exerciseId: 'bodyweight-squat', weightKg: 0, reps: 4, actualRPE: 6 }] }],
  })
  assert.deepEqual([log, log].map(parseSessionLog), [log, log])
  assert.deepEqual(log.blockLogs!.map(parseBlockLog), log.blockLogs)
})

test('explicit option helpers reject invalid options instead of silently treating callback indices as policy', () => {
  const input = fixture()
  const plan = buildAuthoredWeek(input, proposal(workout()), advisoryOptions)
  const session = plan.sessions[0] as WorkoutSession
  const log: SessionLog = { sessionId: session.id, status: 'completed', painFlag: false, notes: '' }
  const blockLog = { unit: 'seconds', blockIndex: 0, exerciseId: 'dumbbell-farmer-carry', seconds: 30 }
  const checks = [
    (options: never) => parseAthleteWithOptions(input.athlete, options),
    (options: never) => parseProgramConfigWithOptions(input.athlete.program, options),
    (options: never) => parseBlockWithOptions(input.block, options),
    (options: never) => parseSessionWithOptions(session, options),
    (options: never) => parseSessionLogWithOptions(log, options),
    (options: never) => parseWorkoutBlockWithOptions(session.blocks[0], options),
    (options: never) => parseBlockLogWithOptions(blockLog, options),
    (options: never) => parsePlanningContextWithOptions(input.context, options),
    (options: never) => parsePlanWeekInputWithOptions(input, options),
  ]
  for (const invalid of [0, 1, [], null, { policy: 'invented' }, { allowAnyData: true }]) {
    for (const check of checks) assert.throws(() => check(invalid as never), /options/)
  }
  assert.deepEqual(parseSessionWithOptions(session, advisoryOptions), session)
})

test('advisory messages describe references without presenting legacy training rules as mandatory vetoes', () => {
  const input = fixture()
  input.athlete.weeklyTimeBudgetMin = 1
  input.athlete.availableDays = [6]
  input.athlete.safetyHold = { reason: 'pain', since: '2026-09-07' }
  const plan = buildAuthoredWeek(input, proposal(...twiceDailyRuns().map(session => ({
    ...session, durationMin: 240,
  })), workout(), workout('next-lift', '2026-09-08')), advisoryOptions)
  assert.equal(plan.safety.passed, true, JSON.stringify(plan.safety))
  const result = validateAuthoredSessions(input, plan.sessions, {}, advisoryOptions)
  assert.ok(result.advisories?.length)
  for (const item of result.advisories!) {
    assert.doesNotMatch(item.message, /\b(must|required|needs|blocks|blocked|cannot|unsupported|limited|ceiling)\b/i)
  }
  assert.ok(plan.penalties.some(penalty => penalty.rule === 'hardDaysAdjacent'))
  assert.ok(plan.penalties.filter(penalty => penalty.rule === 'hardDaysAdjacent')
    .every(penalty => penalty.explanation.includes('not a training veto')))
  assert.ok(result.advisories?.some(item => item.rule === 'restDay'
    && item.message === 'Advisory only: This week has no session-free calendar day; consider recovery.'))
})

test('advisory next-week handover preserves high/zero baselines, health facts and recurring commitments without generated dose', () => {
  const input = fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: 30 })
  input.athlete.baseline = { ...input.athlete.baseline,
    runsPerWeek: 14, weeklyRunMinutes: 420, longestRunMinutes: 30, liftsPerWeek: 0, liftDurationMin: 0 }
  input.athlete.program!.comfortableThrowsPerPractice = 0
  input.block.program!.comfortableThrowsPerPractice = 0
  input.context.neighboringSessions = followingCommitments(input, advisoryOptions)
  assert.equal(input.context.neighboringSessions.length, 1)
  assert.equal(input.context.neighboringSessions[0]!.kind, 'commitment')
  const plan = buildAuthoredWeek(input, proposal(...twiceDailyRuns()), advisoryOptions)
  const logs: Record<string, SessionLog> = Object.fromEntries(plan.sessions.map((session, index) => [session.id, {
    sessionId: session.id, status: 'completed', actualDurationMin: session.durationMin,
    painFlag: index === 0, notes: '',
  }]))
  const week = { input, plan, logs, removed: [], changes: [] }
  const before = JSON.stringify(week)
  const next = nextCalendarInput([week], advisoryOptions)
  assert.equal(next.weekIndex, 1)
  assert.deepEqual(next.athlete.baseline, input.athlete.baseline)
  assert.deepEqual(next.block.phases, input.block.phases)
  assert.equal(next.athlete.safetyHold?.reason, 'pain')
  assert.equal(next.athlete.residual.asOfDate, '2026-09-14')
  assert.equal(next.context.completedWeeks[0]!.runMinutes, 420)
  assert.equal(next.context.completedWeeks[0]!.plannedDeload, false, 'An AI first week is not implicitly a reduced calibration week.')
  assert.equal(next.context.completedWeeks[0]!.disrupted, true)
  assert.equal(next.context.recentSessions.length, plan.sessions.length)
  assert.deepEqual(next.context.recentSessions.find(record => record.log?.painFlag)?.log, logs[plan.sessions[0]!.id])
  assert.ok(next.context.neighboringSessions.filter(session => session.date > next.block.startDate)
    .every(session => session.kind !== 'workout'), 'No automatic one-throw dose is invented from confirmed zero throws.')
  const nextPlan = buildAuthoredWeek(next, {
    version: 1, weekStart: '2026-09-14',
    sessions: twiceDailyRuns().map(session => ({ ...session, id: `next-${session.id}`, date: addDays(session.date, 7) })),
  }, advisoryOptions)
  assert.equal(nextPlan.safety.passed, true, JSON.stringify(nextPlan.safety))
  assert.equal(nextPlan.sessions.filter(session => session.kind === 'run').length, 14)
  assert.ok(nextPlan.warnings.some(item => item.includes('[authoredRecordedHealth]')))
  assert.equal(JSON.stringify(week), before)
  assert.throws(() => nextCalendarInput([week]), /finite/)
  assert.throws(() => followingCommitments(input, { policy: 'invented' } as never), /options/)
  assert.throws(() => nextCalendarInput([week], { policy: 'invented' } as never), /options/)
})

test('advisory advancement retains zero observed running after an above-zero plan and does not impose fatigue phase reductions', () => {
  const input = fixture()
  input.athlete.baseline = { ...input.athlete.baseline,
    runsPerWeek: 0, weeklyRunMinutes: 0, longestRunMinutes: 0, liftsPerWeek: 0, liftDurationMin: 0 }
  const plan = buildAuthoredWeek(input, proposal(run()), advisoryOptions)
  const session = plan.sessions[0]!
  const week = { input, plan: { ...plan, sessions: [] }, removed: [session], changes: [], logs: {
    [session.id]: { sessionId: session.id, status: 'skipped' as const, skipReason: 'too_tired' as const,
      actualDurationMin: 0, painFlag: false, notes: '' },
  } }
  const next = nextCalendarInput([week], advisoryOptions)
  assert.deepEqual(next.athlete.baseline, input.athlete.baseline)
  assert.deepEqual(next.block.phases, input.block.phases)
  assert.equal(next.context.recentSessions[0]!.log!.skipReason, 'too_tired')
  assert.equal(next.context.completedWeeks[0]!.runMinutes, 0)
  const nextPlan = buildAuthoredWeek(next, {
    version: 1, weekStart: '2026-09-14', sessions: [run('new-zero-baseline', '2026-09-15', 120)],
  }, advisoryOptions)
  assert.equal(nextPlan.safety.passed, true)
  assert.equal(nextPlan.sessions[0]!.durationMin, 120)
  assert.ok(nextPlan.warnings.some(item => item.includes('[authoredRunBaseline]')))
})

test('a confirmed zero time budget stays zero in advisory input and is not fabricated into training capacity', () => {
  const input = fixture()
  input.athlete.weeklyTimeBudgetMin = 0
  input.athlete.baseline = { ...input.athlete.baseline, runsPerWeek: 0, liftsPerWeek: 0,
    weeklyRunMinutes: 0, longestRunMinutes: 0, liftDurationMin: 0 }
  const before = JSON.stringify(input)
  assert.equal(parseAthleteWithOptions(input.athlete, advisoryOptions).weeklyTimeBudgetMin, 0)
  const plan = buildAuthoredWeek(input, proposal(run()), advisoryOptions)
  assert.equal(plan.safety.passed, true)
  assert.ok(plan.warnings.some(item => item.includes('[weeklyTimeBudget]')))
  assert.equal(JSON.stringify(input), before)
  assert.throws(() => parseAthlete(input.athlete), /greater than zero/)
  for (const weeklyTimeBudgetMin of [-1, NaN, Infinity]) {
    assert.throws(() => parseAthleteWithOptions({ ...input.athlete, weeklyTimeBudgetMin }, advisoryOptions), /finite/)
  }
})

test('advisory conditioning requires the exact confirmed device even with an observed baseline or generic machine', () => {
  for (const modality of ['row', 'bike_road', 'bike_gravel', 'ski_erg'] as const) {
    const input = fixture()
    input.athlete.equipment = [...input.athlete.equipment, 'machine']
    input.athlete.program!.resources = [...input.athlete.program!.resources, 'machine']
    input.block.program!.resources = [...input.block.program!.resources, 'machine']
    const item: AuthoredSessionProposal = {
      id: `device-${modality}`, kind: 'conditioning', label: 'Device conditioning',
      modality, date: '2026-09-07', startTime: '07:00', durationMin: 30,
    }
    const denied = buildAuthoredWeek(input, proposal(item), advisoryOptions)
    assert.equal(denied.safety.passed, false)
    assert.ok(denied.safety.violations.some(violation => violation.rule === 'authoredConditioningEquipment'))
    assert.ok(validateAuthoredSessions(input, denied.sessions, {}, advisoryOptions).violations
      .some(violation => violation.rule === 'authoredConditioningEquipment'))
    const resources = AI_ADVISORY_CONDITIONING_RESOURCES[modality]
    input.athlete.program!.resources = [...input.athlete.program!.resources, ...resources]
    input.block.program!.resources = [...input.block.program!.resources, ...resources]
    const approved = buildAuthoredWeek(input, proposal(item), advisoryOptions)
    assert.equal(approved.safety.passed, true, JSON.stringify(approved.safety))
    assert.equal(validateAuthoredSessions(input, approved.sessions, {}, advisoryOptions).passed, true)
    assert.ok(approved.sessions[0]!.predictedLoad.systemic > 0)
  }
})

test('fixed source lookup resolves target-week IDs without guessing from nonunique times or generating throws', () => {
  const input = fixture({ goal: 'dodgeball', comfortableThrowsPerPractice: 30 })
  input.athlete.baseline = { ...input.athlete.baseline, runsPerWeek: 0, liftsPerWeek: 0,
    weeklyRunMinutes: 0, longestRunMinutes: 0, liftDurationMin: 0 }
  input.athlete.weeklyTimeBudgetMin = 0
  input.athlete.program!.comfortableThrowsPerPractice = 0
  input.block.program!.comfortableThrowsPerPractice = 0
  const existing = input.block.goal.fixedCommitments[0]!
  input.block.goal.fixedCommitments = [{ ...existing, id: 'practice-z' }, { ...existing, id: 'practice-a' }]
  const target = { ...input, weekIndex: 1 }
  const before = JSON.stringify(target)
  assert.equal(authoredCommitmentSessionId(target, 'practice-a'), 'fixed-1-2026-09-14')
  assert.equal(authoredCommitmentSessionId(target, 'practice-z'), 'fixed-2-2026-09-14')
  assert.deepEqual(followingCommitments(input, advisoryOptions).map(session => session.id),
    ['practice-a', 'practice-z'].map(id => authoredCommitmentSessionId(target, id)))
  const plan = buildAuthoredWeek(target, { version: 1, weekStart: '2026-09-14', sessions: [] }, advisoryOptions)
  assert.deepEqual(plan.sessions.map(session => session.id), ['fixed-1-2026-09-14', 'fixed-2-2026-09-14'])
  assert.ok(plan.sessions.every(session => session.kind === 'commitment'))
  assert.equal(JSON.stringify(target), before)
  assert.throws(() => authoredCommitmentSessionId(target, 'unknown-source'), /Unknown fixed source/)
  assert.throws(() => authoredCommitmentSessionId({ ...target, weekIndex: Infinity }, 'practice-a'), /finite/)
})

test('partial amendments preserve an unchanged five-set logged prescription after six actual sets while editing only unlogged work', () => {
  const input = fixture()
  const authored = { ...workout('overrun-remainder'), blocks: [
    { unit: 'reps' as const, exerciseId: 'bodyweight-squat', sets: 5, reps: 10, targetRPE: 6 as const },
    { unit: 'reps' as const, exerciseId: 'push-up', sets: 1, reps: 6, targetRPE: 6 as const },
  ] }
  const original = { ...buildAuthoredWeek(input, proposal(authored), advisoryOptions).sessions[0]!, pinned: true } as WorkoutSession
  const log = validateBlockLogs(original, {
    sessionId: original.id, status: 'partial', painFlag: false, notes: 'Six actual sets, five originally prescribed.',
    blockLogs: [{ unit: 'reps', blockIndex: 0, exerciseId: 'bodyweight-squat',
      sets: Array.from({ length: 6 }, () => ({ exerciseId: 'bodyweight-squat', weightKg: 0, reps: 10, actualRPE: 6 })) }],
  }, advisoryOptions)
  input.context.pinnedSessions = [original]
  input.context.recentSessions = [{ session: original, log }]
  const candidate = { ...structuredClone(original), blocks: original.blocks.map((block, index) => index === 1
    ? { ...block, exerciseId: 'dead-bug' } : block) } as WorkoutSession
  candidate.predictedLoad = predictSessionLoad(candidate, input.athlete, input.library)
  const before = JSON.stringify({ input, original, candidate, log })
  assert.equal(validateAuthoredSessions(input, [original], {}, advisoryOptions).passed, true)
  assert.equal(validateAuthoredSessions(input, [candidate], {}, advisoryOptions).passed, false, 'Amendment permission remains explicit.')
  const result = validateAuthoredSessions(input, [candidate], {}, advisoryPartialOptions)
  assert.equal(result.passed, true, JSON.stringify(result))
  assert.deepEqual(result.violations, [])
  assert.deepEqual(candidate.blocks[0], original.blocks[0])
  assert.ok(result.advisories?.some(item => item.rule === 'authoredRecordedOverrun'))
  assert.ok(result.advisories?.some(item => item.rule === 'authoredActualSessionQuantity'),
    '60 actual repetitions plus 6 unperformed repetitions remain above the 64-repetition training reference.')
  for (const edit of [{ sets: 4 }, { sets: 6 }, { reps: 9 }, { targetRPE: 6.5 as const }, { exerciseId: 'push-up' }]) {
    const changed = { ...candidate, blocks: candidate.blocks.map((block, index) => index === 0
      ? { ...block, ...edit } : block) } as WorkoutSession
    changed.predictedLoad = predictSessionLoad(changed, input.athlete, input.library)
    const rejected = validateAuthoredSessions(input, [changed], {}, advisoryPartialOptions)
    assert.ok(rejected.violations.some(item => item.rule === 'authoredPartialAmendment'), JSON.stringify(rejected))
  }
  const rewrittenLog = structuredClone(log)
  const actual = rewrittenLog.blockLogs![0]!
  assert.ok(actual.unit === 'reps')
  actual.sets = actual.sets.slice(0, 5)
  assert.equal(validateAuthoredSessions(input, [candidate], { [original.id]: rewrittenLog }, advisoryPartialOptions).passed, false)
  assert.equal(JSON.stringify({ input, original, candidate, log }), before)
})
