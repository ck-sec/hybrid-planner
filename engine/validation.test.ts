import assert from 'node:assert/strict'
import test from 'node:test'
import { ENGINE_VERSION, LIBRARY_VERSION, POLICY_VERSION } from './constants.ts'
import { addDays } from './dates.ts'
import type { PlanWeekInput, Session, SessionLog } from './types.ts'
import {
  InputError, parseAthlete, parseBlock, parseGoal, parseLibrary, parsePlanningContext,
  parsePlanWeekInput, parseSession, parseSessionLog,
} from './validation.ts'

function run(id = 'run-history', date = '2026-09-06'): Session {
  return {
    id, date, startTime: '08:30', durationMin: 30,
    predictedLoad: { systemic: 90, structural: 60 }, reason: '', pinned: false,
    isCalibration: false, kind: 'run', discipline: 'run', modality: 'run_road',
    endurancePrescription: { intent: 'easy', effort: 'conversational' },
  }
}

function lift(id = 'lift-history', date = '2026-09-05', pinned = false): Session {
  return {
    id, date, startTime: null, durationMin: 45,
    predictedLoad: { systemic: 100, structural: 100 }, reason: 'Established lifting',
    pinned, isCalibration: false, kind: 'strength', discipline: 'strength', modality: 'lifting',
    strengthPrescription: [{ exerciseId: 'squat', sets: 3, reps: 5, targetRPE: 7.5, suggestedWeightKg: 0, role: 'anchor' }],
  }
}

function log(sessionId = 'lift-history'): SessionLog {
  return {
    sessionId, status: 'completed', actualEffort: 2.5, actualDurationMin: 40,
    sets: [
      { exerciseId: 'squat', weightKg: 0, reps: 5, actualRPE: 10 },
      { exerciseId: 'squat', weightKg: 0, reps: 5, actualRPE: 6.5 },
    ],
    painFlag: false, notes: '',
  }
}

function fixture(): PlanWeekInput {
  return {
    athlete: {
      baseline: {
        asOf: '2026-09-06', weeklyRunMinutes: 180, longestRunMinutes: 80,
        runsPerWeek: 3, liftsPerWeek: 2, liftDurationMin: 60,
        exercises: [
          { exerciseId: 'squat', date: '2026-09-05', weightKg: 0, sets: 3, reps: 5, actualRPE: 7.5, experienceMonths: 18 },
          { exerciseId: 'press', date: '2026-09-04', weightKg: 20, sets: 3, reps: 8, actualRPE: 8, experienceMonths: 24 },
        ],
      },
      calibration: { version: 1, costMultiplier: 1, observationCount: 0 },
      availableDays: [6, 2, 0, 4],
      equipment: ['machine', 'barbell', 'bodyweight'],
      weeklyTimeBudgetMin: 450, defaultStartTime: '07:00', aggressiveness: 'standard',
      residual: { asOfDate: '2026-09-06', asOfTime: '23:59', load: { systemic: 0, structural: 30 } },
      safetyHold: null,
    },
    block: {
      id: 'block-test', engineVersion: ENGINE_VERSION, policyVersion: POLICY_VERSION,
      libraryVersion: LIBRARY_VERSION, startDate: '2026-09-07', totalWeeks: 4,
      goal: {
        label: '  Steady hybrid training  ', peakDate: '2026-10-04',
        qualityBias: ['aerobic_base', 'max_strength'], protectedExerciseIds: ['squat'],
        fixedCommitments: [{
          id: 'ride', label: 'Club ride', dayOfWeek: 5, startTime: '10:00', durationMin: 60,
          discipline: 'bike', modality: 'bike_road', estimatedLoad: { systemic: 50, structural: 5 },
        }],
      },
      phases: [
        { kind: 'base', startWeekIndex: 0, endWeekIndex: 1, volumeFraction: 1 },
        { kind: 'taper', startWeekIndex: 2, endWeekIndex: 3, volumeFraction: 0.6 },
      ],
      anchors: [
        { exerciseId: 'squat', pattern: 'knee_dominant', sets: 3, reps: 5, targetRPE: 7.5, role: 'anchor' },
        { exerciseId: 'press', pattern: 'horizontal_push', sets: 3, reps: 8, targetRPE: 8, role: 'accessory' },
      ],
    },
    weekIndex: 0,
    library: {
      version: LIBRARY_VERSION,
      exercises: [
        { id: 'squat', name: 'Squat', pattern: 'knee_dominant', equipment: ['barbell'], coefficients: { systemic: 20, structural: 30 }, competesWithRunning: true, highSkill: false },
        { id: 'press', name: 'Press', pattern: 'horizontal_push', equipment: ['machine', 'barbell'], coefficients: { systemic: 10, structural: 15 }, competesWithRunning: false, highSkill: false },
        { id: 'clean', name: 'Clean', pattern: 'hip_dominant', equipment: ['barbell'], coefficients: { systemic: 30, structural: 40 }, competesWithRunning: true, highSkill: true },
      ],
    },
    context: {
      recentSessions: [{ session: run(), log: null }, { session: lift(), log: log() }],
      completedWeeks: [{ weekStart: '2026-08-31', runMinutes: 180, plannedDeload: false, disrupted: false }],
      neighboringSessions: [run(), run('future-run', '2026-09-14')],
      pinnedSessions: [lift('pinned-lift', '2026-09-09', true)],
    },
  }
}

function replace(value: unknown, path: string, replacement: unknown): void {
  const keys = path.split('.')
  let target = value as Record<string, unknown>
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>
  target[keys.at(-1)!] = replacement
}

function frozen<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child)
    Object.freeze(value)
  }
  return value
}

function rejects(parser: (value: unknown) => unknown, value: unknown, issue: RegExp): void {
  assert.throws(() => parser(value), (error: unknown) => {
    assert.ok(error instanceof InputError)
    assert.ok(error.issues.length > 0)
    assert.ok(error.issues.every(item => typeof item === 'string' && item.length > 0))
    assert.match(error.issues.join('\n'), issue)
    return true
  })
}

test('all entry points accept valid fixtures and normalization deeply clones frozen inputs', () => {
  const input = frozen(fixture())
  const before = JSON.stringify(input)
  const parsed = parsePlanWeekInput(input)
  assert.equal(JSON.stringify(input), before)
  assert.deepEqual(parsed.athlete.availableDays, [0, 2, 4, 6])
  assert.deepEqual(parsed.athlete.equipment, ['barbell', 'bodyweight', 'machine'])
  assert.deepEqual(parsed.library.exercises.map(item => item.id), ['clean', 'press', 'squat'])
  assert.deepEqual(parsed.library.exercises[1]!.equipment, ['barbell', 'machine'])
  assert.equal(parsed.block.goal.label, 'Steady hybrid training')
  assert.notEqual(parsed, input)
  assert.notEqual(parsed.athlete.baseline.exercises[0], input.athlete.baseline.exercises[0])
  assert.notEqual(parsed.context.recentSessions[1]!.log!.sets, input.context.recentSessions[1]!.log!.sets)
  assert.deepEqual(parsePlanWeekInput(parsed), parsed)
  assert.deepEqual(parseLibrary(input.library), parsed.library)
  assert.deepEqual(parseAthlete(input.athlete), parsed.athlete)
  assert.deepEqual(parseGoal(input.block.goal), parsed.block.goal)
  assert.deepEqual(parseBlock(input.block), parsed.block)
  assert.deepEqual(parsePlanningContext(input.context), parsed.context)
  assert.deepEqual(parseSession(input.context.pinnedSessions[0]), parsed.context.pinnedSessions[0])
  assert.deepEqual(parseSessionLog(input.context.recentSessions[1]!.log), parsed.context.recentSessions[1]!.log)
})

test('unknown fields at every nested contract boundary are rejected, never discarded', () => {
  const paths = [
    '', 'athlete', 'athlete.baseline', 'athlete.baseline.exercises.0', 'athlete.calibration',
    'athlete.residual', 'athlete.residual.load', 'library', 'library.exercises.0',
    'library.exercises.0.coefficients', 'block', 'block.goal', 'block.goal.fixedCommitments.0',
    'block.goal.fixedCommitments.0.estimatedLoad', 'block.phases.0', 'block.anchors.0',
    'context', 'context.recentSessions.0', 'context.recentSessions.0.session',
    'context.recentSessions.0.session.predictedLoad', 'context.recentSessions.0.session.endurancePrescription',
    'context.recentSessions.1.session.strengthPrescription.0', 'context.recentSessions.1.log',
    'context.recentSessions.1.log.sets.0', 'context.completedWeeks.0',
  ]
  for (const path of paths) {
    const input = fixture()
    replace(input, path ? `${path}.unsupported` : 'unsupported', true)
    rejects(parsePlanWeekInput, input, /unknown field unsupported/)
  }
  const input = fixture()
  replace(input, 'athlete.safetyHold', { reason: 'pain', since: '2026-09-06', unsupported: true })
  rejects(parsePlanWeekInput, input, /safetyHold.*unknown field/)
})

test('non-JSON objects, inherited contracts, array extras, and accessors are rejected', () => {
  for (const value of [null, undefined, [], false, 1, 'text', new Map()]) {
    rejects(parsePlanWeekInput, value, /must be a plain object/)
  }
  rejects(parseAthlete, Object.create(fixture().athlete), /plain object/)
  const input = fixture()
  Object.defineProperty(input.athlete.availableDays, 'unexpected', { value: true })
  rejects(parsePlanWeekInput, input, /unknown array field unexpected/)
  const symbolInput = fixture()
  Object.defineProperty(symbolInput.athlete, Symbol('unexpected'), { value: true })
  rejects(parsePlanWeekInput, symbolInput, /unknown field Symbol/)
  const accessorInput = fixture()
  Object.defineProperty(accessorInput.athlete, 'defaultStartTime', {
    get() { throw new Error('Accessors must not run') },
  })
  rejects(parsePlanWeekInput, accessorInput, /data property, not an accessor/)
  const arrayAccessorInput = fixture()
  Object.defineProperty(arrayAccessorInput.athlete.availableDays, '0', {
    get() { throw new Error('Array accessors must not run') },
  })
  rejects(parsePlanWeekInput, arrayAccessorInput, /explicit data item/)
  const sparseInput = fixture()
  replace(sparseInput, 'athlete.availableDays', Array(2))
  rejects(parsePlanWeekInput, sparseInput, /hole or accessor/)
})

test('safe identifiers and bounded names, reasons, and notes are enforced', () => {
  const cases: readonly [string, unknown, RegExp][] = [
    ['block.id', '../unsafe', /block.id/],
    ['block.id', 'x'.repeat(81), /block.id/],
    ['block.id', '', /block.id/],
    ['block.goal.label', ' '.repeat(5), /goal.label/],
    ['block.goal.label', 'x'.repeat(81), /goal.label/],
    ['library.exercises.0.name', 'x'.repeat(81), /name/],
    ['context.recentSessions.0.session.reason', 'x'.repeat(4001), /reason/],
    ['context.recentSessions.1.log.notes', 'x'.repeat(2001), /notes/],
  ]
  for (const [path, value, issue] of cases) {
    const input = fixture()
    replace(input, path, value)
    rejects(parsePlanWeekInput, input, issue)
  }
})

test('numeric validation rejects non-finite values and enforces every bounded unit', () => {
  const cases: readonly [string, unknown][] = [
    ['library.exercises.0.coefficients.systemic', NaN],
    ['library.exercises.0.coefficients.structural', Infinity],
    ['athlete.residual.load.systemic', -1],
    ['block.goal.fixedCommitments.0.estimatedLoad.structural', 1_000_001],
    ['athlete.baseline.weeklyRunMinutes', 601],
    ['athlete.baseline.longestRunMinutes', 181],
    ['athlete.baseline.runsPerWeek', 0],
    ['athlete.baseline.runsPerWeek', 1.5],
    ['athlete.baseline.liftsPerWeek', 4],
    ['athlete.baseline.liftDurationMin', 14],
    ['athlete.baseline.liftDurationMin', 181],
    ['athlete.baseline.exercises.0.weightKg', -0.1],
    ['athlete.baseline.exercises.0.weightKg', 501],
    ['athlete.baseline.exercises.0.sets', 11],
    ['athlete.baseline.exercises.0.reps', 0],
    ['athlete.baseline.exercises.0.reps', 51],
    ['athlete.baseline.exercises.0.experienceMonths', 1201],
    ['athlete.calibration.observationCount', -1],
    ['athlete.calibration.observationCount', 0.5],
    ['athlete.calibration.costMultiplier', 0.79],
    ['athlete.calibration.costMultiplier', 1.41],
    ['context.recentSessions.0.session.durationMin', 0],
    ['context.recentSessions.0.session.durationMin', 1441],
    ['context.recentSessions.1.log.actualDurationMin', 1441],
    ['context.recentSessions.1.log.actualEffort', 10.1],
    ['context.completedWeeks.0.runMinutes', -1],
    ['block.anchors.0.targetRPE', 7.1],
    ['block.anchors.0.targetRPE', 5.5],
    ['athlete.baseline.exercises.0.actualRPE', 3],
    ['context.recentSessions.1.log.sets.0.actualRPE', 10.5],
  ]
  for (const [path, value] of cases) {
    const input = fixture()
    replace(input, path, value)
    rejects(parsePlanWeekInput, input, /must be/)
  }
})

test('RPE 10, CR10 zero effort, zero external weight, and incomplete set tracking are valid', () => {
  const input = fixture()
  replace(input, 'block.anchors.0.targetRPE', 10)
  replace(input, 'athlete.baseline.exercises.0.actualRPE', 10)
  replace(input, 'context.recentSessions.1.log.actualEffort', 0)
  const parsed = parsePlanWeekInput(input)
  assert.equal(parsed.context.recentSessions[1]!.log!.actualEffort, 0)
  assert.equal(parsed.context.recentSessions[1]!.log!.sets!.length, 2)
  assert.equal(parsed.athlete.baseline.exercises[0]!.weightKg, 0)
})

test('baseline workload is not rejected because it cannot be evenly divided under the longest run', () => {
  const athlete = fixture().athlete
  replace(athlete, 'baseline.weeklyRunMinutes', 600)
  replace(athlete, 'baseline.longestRunMinutes', 60)
  replace(athlete, 'baseline.runsPerWeek', 1)
  assert.equal(parseAthlete(athlete).baseline.weeklyRunMinutes, 600)
})

test('invalid Gregorian dates and noncanonical times are rejected without host Date APIs', () => {
  for (const date of ['1900-02-29', '2100-02-29', '2026-02-29', '2026-04-31', '2026-13-01', '1899-12-31', '2200-01-01', '2026-9-07', '2026-09-07T00:00:00Z']) {
    const input = fixture()
    replace(input, 'athlete.baseline.exercises.0.date', date)
    rejects(parsePlanWeekInput, input, /calendar date/)
  }
  for (const time of ['24:00', '12:60', '7:00', '07:00:00', '', undefined]) {
    const session = run()
    replace(session, 'startTime', time)
    rejects(parseSession, session, /HH:mm/)
  }
  const session = run()
  replace(session, 'date', '2000-02-29')
  replace(session, 'startTime', null)
  assert.equal(parseSession(session).startTime, null)
})

test('discriminated session variants reject incompatible fields, disciplines, and modalities', () => {
  const mutations: readonly [Session, string, unknown][] = [
    [run(), 'discipline', 'bike'], [run(), 'modality', 'lifting'],
    [run(), 'endurancePrescription.effort', 'hard'], [run(), 'endurancePrescription.intent', 'tempo'],
    [run(), 'strengthPrescription', []], [run(), 'label', 'not a commitment'],
    [lift(), 'discipline', 'run'], [lift(), 'modality', 'run_road'],
    [lift(), 'endurancePrescription', { intent: 'easy', effort: 'conversational' }],
  ]
  for (const [session, path, value] of mutations) {
    replace(session, path, value)
    rejects(parseSession, session, /unknown field|must be one of/)
  }
  const commitment = {
    ...run(), kind: 'commitment', discipline: 'bike', modality: 'run_road', label: 'Ride',
  } as Record<string, unknown>
  delete commitment.endurancePrescription
  rejects(parseSession, commitment, /requires run discipline/)
  commitment.modality = 'bike_gravel'
  assert.equal(parseSession(commitment).kind, 'commitment')
})

test('all enum and boolean contracts reject coercion and unsupported values', () => {
  const mutations: readonly [string, unknown][] = [
    ['athlete.aggressiveness', 'reckless'], ['athlete.equipment.0', 'rack'],
    ['library.exercises.0.pattern', 'squat'], ['library.exercises.0.highSkill', 0],
    ['library.exercises.0.competesWithRunning', 'true'],
    ['block.phases.0.kind', 'race'], ['block.anchors.0.role', 'main'],
    ['block.goal.fixedCommitments.0.discipline', 'cycling'],
    ['block.goal.fixedCommitments.0.modality', 'bicycle'],
    ['athlete.safetyHold', { reason: 'injury', since: '2026-09-06' }],
    ['context.recentSessions.1.log.status', 'done'], ['context.recentSessions.1.log.painFlag', 1],
    ['context.recentSessions.0.session.isCalibration', 'false'],
    ['context.completedWeeks.0.disrupted', null], ['context.completedWeeks.0.plannedDeload', 0],
  ]
  for (const [path, value] of mutations) {
    const input = fixture()
    replace(input, path, value)
    rejects(parsePlanWeekInput, input, /must be/)
  }
})

test('log status rules distinguish skipped sessions from actual workouts', () => {
  const skipped = { sessionId: 'skip', status: 'skipped', skipReason: 'pain', painFlag: true, notes: '' }
  assert.equal(parseSessionLog(skipped).status, 'skipped')
  assert.equal(parseSessionLog({ ...skipped, actualDurationMin: 0 }).actualDurationMin, 0)
  rejects(parseSessionLog, { ...skipped, actualDurationMin: 1 }, /actualDurationMin/)
  rejects(parseSessionLog, { ...skipped, actualEffort: 0 }, /cannot report workout effort/)
  rejects(parseSessionLog, { ...skipped, sets: [] }, /cannot report workout sets/)
  rejects(parseSessionLog, { ...skipped, skipReason: undefined }, /skipReason/)
  for (const status of ['completed', 'partial']) {
    rejects(parseSessionLog, { ...log(), status, actualDurationMin: 0 }, /greater than zero/)
    rejects(parseSessionLog, { ...log(), status, skipReason: 'life' }, /only when status is skipped/)
    assert.equal(parseSessionLog({ sessionId: 's', status, painFlag: false, notes: '' }).status, status)
  }
  rejects(parseSessionLog, { ...log(), painFlag: undefined }, /painFlag.*boolean/)
})

test('rolling starts retain whole-week history, requested-week boundaries and goal bounds', () => {
  for (let offset = 0; offset < 7; offset++) {
    const input = fixture()
    const start = addDays('2026-09-07', offset)
    input.block.startDate = start
    input.block.goal.peakDate = addDays(start, input.block.totalWeeks * 7 - 1)
    input.context = {
      recentSessions: [], neighboringSessions: [], pinnedSessions: [],
      completedWeeks: [{ weekStart: addDays(start, -7), runMinutes: 90, plannedDeload: false, disrupted: false }],
    }
    assert.equal(parsePlanWeekInput(input).block.startDate, start)
    input.context.pinnedSessions = [lift('pin', addDays(start, 6), true)]
    assert.doesNotThrow(() => parsePlanWeekInput(input))
    input.context.pinnedSessions[0].date = addDays(start, 7)
    assert.throws(() => parsePlanWeekInput(input), /inside the requested week/)
    input.context.pinnedSessions = []
    input.context.completedWeeks[0].weekStart = addDays(start, -6)
    assert.throws(() => parsePlanWeekInput(input), /completed week before/)
  }
  const context = fixture().context
  context.completedWeeks = [...context.completedWeeks, { ...context.completedWeeks[0], weekStart: '2026-08-26' }]
  assert.throws(() => parsePlanningContext(context), /must not overlap/)
  context.completedWeeks[1].weekStart = '2026-08-24'
  assert.doesNotThrow(() => parsePlanningContext(context))
})

test('unsupported versions, malformed phases, invalid starts, and inconsistent peaks fail', () => {
  const mutations: readonly [string, unknown, RegExp][] = [
    ['block.engineVersion', '0.1.0', /engineVersion/],
    ['block.policyVersion', 'other', /policyVersion/],
    ['block.libraryVersion', 'other', /libraryVersion/],
    ['library.version', 'other', /library.version/],
    ['athlete.calibration.version', 2, /calibration.version/],
    ['block.startDate', '2026-02-30', /real calendar date/],
    ['block.goal.peakDate', '2026-09-06', /cannot precede/],
    ['block.goal.peakDate', '2026-10-05', /week containing/],
    ['block.totalWeeks', 53, /totalWeeks/],
    ['block.phases.0.endWeekIndex', 0, /gaps or overlaps/],
    ['block.phases.1.startWeekIndex', 1, /gaps or overlaps/],
    ['block.phases.1.endWeekIndex', 2, /cover all/],
    ['block.phases.1.endWeekIndex', 4, /endWeekIndex/],
    ['block.phases.0.volumeFraction', 0, /volumeFraction/],
    ['block.phases.0.volumeFraction', 1.01, /volumeFraction/],
    ['weekIndex', -1, /weekIndex/], ['weekIndex', 4, /weekIndex/],
    ['weekIndex', 0.5, /weekIndex/],
  ]
  for (const [path, value, issue] of mutations) {
    const input = fixture()
    replace(input, path, value)
    rejects(parsePlanWeekInput, input, issue)
  }
})

test('availability, collection limits, and duplicate IDs are checked', () => {
  const mutations: readonly [string, unknown][] = [
    ['athlete.availableDays', []], ['athlete.availableDays', [0, 0]], ['athlete.availableDays', [7]],
    ['athlete.equipment', ['barbell', 'barbell']],
    ['block.goal.qualityBias', []], ['block.goal.qualityBias', ['aerobic_base', 'aerobic_base']],
    ['block.goal.qualityBias', ['unsupported']],
    ['athlete.baseline.exercises', Array(9).fill(fixture().athlete.baseline.exercises[0])],
    ['block.goal.fixedCommitments', Array(5).fill(fixture().block.goal.fixedCommitments[0])],
    ['context.recentSessions', Array(141).fill(fixture().context.recentSessions[0])],
    ['context.completedWeeks', Array(53).fill(fixture().context.completedWeeks[0])],
    ['library.exercises', Array(101).fill(fixture().library.exercises[0])],
  ]
  for (const [path, value] of mutations) {
    const input = fixture()
    replace(input, path, value)
    rejects(parsePlanWeekInput, input, /must|duplicate/)
  }
  for (const path of ['library.exercises', 'athlete.baseline.exercises', 'block.anchors', 'block.goal.protectedExerciseIds', 'block.goal.fixedCommitments', 'context.recentSessions', 'context.completedWeeks', 'context.pinnedSessions', 'context.neighboringSessions']) {
    const input = fixture()
    const keys = path.split('.')
    let value: unknown = input
    for (const key of keys) value = (value as Record<string, unknown>)[key]
    const items = value as unknown[]
    replace(input, path, [items[0], items[0]])
    rejects(parsePlanWeekInput, input, /duplicate/)
  }
})

test('history and baseline dates cannot leak information from the planned week', () => {
  const mutations: readonly [string, unknown, RegExp][] = [
    ['athlete.baseline.asOf', '2026-09-08', /baseline.asOf.*week start/],
    ['athlete.baseline.exercises.0.date', '2026-09-07', /cannot be after baseline.asOf/],
    ['athlete.residual.asOfDate', '2026-09-07', /at or before/],
    ['athlete.safetyHold', { reason: 'pain', since: '2026-09-08' }, /safetyHold.since/],
    ['context.recentSessions.1.session.date', '2026-09-07', /recent history must be before/],
    ['context.completedWeeks.0.weekStart', '2026-09-07', /completed week before/],
    ['context.completedWeeks.0.weekStart', '2026-09-01', /completed week before/],
    ['context.neighboringSessions.1.date', '2026-09-13', /outside the requested week/],
    ['context.neighboringSessions.1.date', '2026-09-21', /seven days/],
    ['context.neighboringSessions.0.date', '2026-08-30', /conflicting definitions|seven days/],
    ['context.pinnedSessions.0.date', '2026-09-14', /inside the requested week/],
    ['context.pinnedSessions.0.pinned', false, /must be true/],
  ]
  for (const [path, value, issue] of mutations) {
    const input = fixture()
    replace(input, path, value)
    rejects(parsePlanWeekInput, input, issue)
  }
  const input = fixture()
  replace(input, 'athlete.baseline.asOf', '2026-09-07')
  replace(input, 'athlete.residual.asOfDate', '2026-09-07')
  replace(input, 'athlete.residual.asOfTime', '00:00')
  replace(input, 'context.neighboringSessions', [run('previous-edge', '2026-08-31'), run('following-edge', '2026-09-20')])
  assert.equal(parsePlanWeekInput(input).weekIndex, 0)
})

test('library eligibility, matching patterns, all required equipment, and log association are cross-validated', () => {
  const mutations: readonly [string, unknown, RegExp][] = [
    ['athlete.baseline.exercises.0.exerciseId', 'missing', /unknown exercise missing/],
    ['block.anchors.1.exerciseId', 'missing', /unknown exercise missing/],
    ['block.anchors.0.pattern', 'core', /must match library movement pattern/],
    ['block.goal.protectedExerciseIds', ['press-missing'], /must include protected exercise/],
    ['athlete.equipment', ['barbell', 'bodyweight'], /unavailable equipment: machine/],
    ['context.pinnedSessions.0.strengthPrescription.0.exerciseId', 'missing', /unknown exercise missing/],
    ['context.recentSessions.1.log.sessionId', 'wrong-session', /must match session.id/],
    ['context.recentSessions.1.log.sets.0.exerciseId', 'press', /not prescribed/],
    ['context.recentSessions.0.log', { sessionId: 'run-history', status: 'completed', painFlag: false, notes: '', sets: [] }, /only.*strength/],
  ]
  for (const [path, value, issue] of mutations) {
    const input = fixture()
    replace(input, path, value)
    rejects(parsePlanWeekInput, input, issue)
  }
  const input = fixture()
  replace(input, 'block.anchors.1.exerciseId', 'clean')
  replace(input, 'block.anchors.1.pattern', 'hip_dominant')
  rejects(parsePlanWeekInput, input, /high-skill/)
})

test('high-skill observations and history remain accepted without generating high-skill anchors', () => {
  const input = fixture()
  replace(input, 'athlete.baseline.exercises', [
    ...input.athlete.baseline.exercises,
    { ...input.athlete.baseline.exercises[0], exerciseId: 'clean' },
  ])
  const session = lift('skill-history', '2026-09-02')
  replace(session, 'strengthPrescription.0.exerciseId', 'clean')
  replace(input, 'context.recentSessions', [...input.context.recentSessions, { session, log: null }])
  assert.equal(parsePlanWeekInput(input).athlete.baseline.exercises.length, 3)
})

test('none requires no equipment checkbox, but bodyweight and every physical requirement do', () => {
  const input = fixture()
  replace(input, 'library.exercises.0.equipment', ['none'])
  replace(input, 'athlete.equipment', ['barbell', 'machine'])
  assert.equal(parsePlanWeekInput(input).block.anchors[0]!.exerciseId, 'squat')
  replace(input, 'library.exercises.0.equipment', ['none', 'bodyweight'])
  rejects(parsePlanWeekInput, input, /unavailable equipment: bodyweight/)
  replace(input, 'athlete.equipment', ['barbell', 'machine', 'bodyweight'])
  assert.equal(parsePlanWeekInput(input).block.anchors[0]!.exerciseId, 'squat')
})
