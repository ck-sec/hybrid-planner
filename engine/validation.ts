import { COST_MULTIPLIER_RANGE, ENGINE_VERSION, LIBRARY_VERSION, LIMITS, POLICY_VERSION, RECOMMENDATION_POLICY } from './constants.ts'
import { addDays, dayNumber, dayOfWeek, parseISODate, timeMinutes } from './dates.ts'
import type {
  AnchorAssignment, AthleteState, Block, CompletedWeek, Day, Discipline, Equipment,
  Exercise, ExerciseLibrary, ExerciseObservation, FixedCommitment, Goal, Load,
  Modality, MovementPattern, Phase, PlanWeekInput, PlanningContext, Quality,
  RecentSession, Session, SessionLog, SetLog, StrengthPrescription, TargetRPE,
} from './types.ts'

export class InputError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(issues.join(' '))
    this.name = 'InputError'
    this.issues = [...issues]
  }
}

const PATTERNS: readonly MovementPattern[] = [
  'knee_dominant', 'hip_dominant', 'horizontal_push', 'vertical_push',
  'horizontal_pull', 'vertical_pull', 'unilateral_lower', 'carry', 'core', 'rotational',
]
const EQUIPMENT: readonly Equipment[] = ['barbell', 'dumbbell', 'kettlebell', 'machine', 'cable', 'bodyweight', 'bands', 'none']
const DISCIPLINES: readonly Discipline[] = ['run', 'bike', 'swim', 'strength', 'sport', 'mobility']
const MODALITIES: readonly Modality[] = ['run_road', 'run_trail', 'bike_road', 'bike_gravel', 'swim', 'row', 'ski_erg', 'lifting', 'court_sport', 'other']
const QUALITIES: readonly Quality[] = ['aerobic_base', 'threshold', 'vo2max', 'repeat_sprint', 'change_of_direction', 'max_strength', 'power', 'strength_endurance', 'shoulder_durability']
const SESSION_FIELDS = ['id', 'date', 'startTime', 'durationMin', 'predictedLoad', 'reason', 'pinned', 'isCalibration', 'kind', 'discipline', 'modality']
const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
const MAX_DURATION = 1440
const MAX_COST = 1_000_000

class Validator {
  readonly issues: string[] = []

  issue(path: string, message: string): void {
    this.issues.push(`${path}: ${message}.`)
  }

  finish<T>(result: T): T {
    if (this.issues.length) throw new InputError(this.issues)
    return result
  }

  object(value: unknown, path: string, fields: readonly string[]): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      this.issue(path, 'must be a plain object')
      return {}
    }
    const prototype: unknown = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      this.issue(path, 'must be a plain object, not a class instance')
      return {}
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !fields.includes(key)) {
        this.issue(path, `unknown field ${String(key)}; supported fields are ${fields.join(', ')}`)
        continue
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor)) {
        this.issue(`${path}.${key}`, 'must be a data property, not an accessor')
      } else {
        result[key] = descriptor.value as unknown
      }
    }
    return result
  }

  array(value: unknown, path: string, min: number, max: number): unknown[] {
    if (!Array.isArray(value)) {
      this.issue(path, `must be an array containing ${min} to ${max} items`)
      return []
    }
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      this.issue(path, 'must be a plain array')
      return []
    }
    if (value.length < min || value.length > max) {
      this.issue(path, `must contain ${min} to ${max} items`)
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
        this.issue(path, `unknown array field ${String(key)}`)
      }
    }
    return Array.from({ length: Math.min(value.length, max) }, (_, index): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !('value' in descriptor)) {
        this.issue(`${path}[${index}]`, 'must be an explicit data item, not a hole or accessor')
        return undefined
      }
      return descriptor.value as unknown
    })
  }

  number(value: unknown, path: string, min: number, max: number, integer = false): number {
    if (typeof value !== 'number' || !Number.isFinite(value)
      || value < min || value > max || (integer && !Number.isInteger(value))) {
      this.issue(path, `must be a finite ${integer ? 'whole number' : 'number'} from ${min} to ${max}`)
      return min
    }
    return value === 0 ? 0 : value
  }

  positive(value: unknown, path: string, max: number): number {
    const result = this.number(value, path, 0, max)
    if (result === 0) this.issue(path, `must be greater than zero and no greater than ${max}`)
    return result
  }

  text(value: unknown, path: string, min: number, max: number, trim = false): string {
    if (typeof value !== 'string') {
      this.issue(path, `must be a string of ${min} to ${max} characters`)
      return ''
    }
    const result = trim ? value.trim() : value
    if (result.length < min || result.length > max) this.issue(path, `must contain ${min} to ${max} characters`)
    return result
  }

  id(value: unknown, path: string): string {
    const result = this.text(value, path, 1, 80)
    if (!/^[a-zA-Z0-9_-]+$/.test(result)) this.issue(path, 'must use only letters, digits, underscores, or hyphens')
    return result
  }

  enum<T extends string>(value: unknown, path: string, values: readonly T[]): T {
    if (typeof value !== 'string' || !values.includes(value as T)) {
      this.issue(path, `must be one of ${values.join(', ')}`)
      return values[0]!
    }
    return value as T
  }

  boolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') {
      this.issue(path, 'must be a boolean')
      return false
    }
    return value
  }

  date(value: unknown, path: string): string {
    try {
      return parseISODate(value)
    } catch {
      this.issue(path, 'must be a real calendar date in YYYY-MM-DD format, from 1900 through 2199')
      return '2000-01-03'
    }
  }

  time(value: unknown, path: string): string {
    if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      this.issue(path, 'must use 24-hour HH:mm format, from 00:00 through 23:59')
      return '00:00'
    }
    return value
  }

  rpe(value: unknown, path: string): TargetRPE {
    const result = this.number(value, path, 6, 10)
    if (!Number.isInteger(result * 2)) this.issue(path, 'must be a set RPE from 6 to 10 in half-point steps')
    return result as TargetRPE
  }

  unique<T>(items: readonly T[], key: (item: T) => string | number, path: string): void {
    const seen = new Set<string | number>()
    for (const item of items) {
      const id = key(item)
      if (seen.has(id)) this.issue(path, `duplicate value ${id}; each must be unique`)
      seen.add(id)
    }
  }

  load(value: unknown, path: string): Load {
    const data = this.object(value, path, ['systemic', 'structural'])
    return {
      systemic: this.number(data.systemic, `${path}.systemic`, 0, MAX_COST),
      structural: this.number(data.structural, `${path}.structural`, 0, MAX_COST),
    }
  }

  equipment(value: unknown, path: string): Equipment[] {
    const result = this.array(value, path, 1, EQUIPMENT.length)
      .map((item, index) => this.enum(item, `${path}[${index}]`, EQUIPMENT))
    this.unique(result, item => item, path)
    return result.sort(compareText)
  }

  compatible(discipline: Discipline, modality: Modality, path: string): void {
    const required: Partial<Record<Modality, Discipline>> = {
      run_road: 'run', run_trail: 'run', bike_road: 'bike', bike_gravel: 'bike',
      swim: 'swim', lifting: 'strength', court_sport: 'sport', row: 'sport', ski_erg: 'sport',
    }
    if (required[modality] && required[modality] !== discipline) {
      this.issue(path, `${modality} modality requires ${required[modality]} discipline, not ${discipline}`)
    }
  }

  library(value: unknown, path: string): ExerciseLibrary {
    const data = this.object(value, path, ['version', 'exercises'])
    const version = this.enum(data.version, `${path}.version`, [LIBRARY_VERSION])
    const exercises = this.array(data.exercises, `${path}.exercises`, 1, LIMITS.maxLibraryExercises)
      .map((value, index): Exercise => {
        const p = `${path}.exercises[${index}]`
        const item = this.object(value, p, ['id', 'name', 'pattern', 'equipment', 'coefficients', 'competesWithRunning', 'highSkill'])
        return {
          id: this.id(item.id, `${p}.id`),
          name: this.text(item.name, `${p}.name`, 1, 80, true),
          pattern: this.enum(item.pattern, `${p}.pattern`, PATTERNS),
          equipment: this.equipment(item.equipment, `${p}.equipment`),
          coefficients: this.load(item.coefficients, `${p}.coefficients`),
          competesWithRunning: this.boolean(item.competesWithRunning, `${p}.competesWithRunning`),
          highSkill: this.boolean(item.highSkill, `${p}.highSkill`),
        }
      })
    this.unique(exercises, exercise => exercise.id, `${path}.exercises`)
    return { version, exercises: exercises.sort((a, b) => compareText(a.id, b.id)) }
  }

  observation(value: unknown, path: string): ExerciseObservation {
    const data = this.object(value, path, ['exerciseId', 'date', 'weightKg', 'sets', 'reps', 'actualRPE', 'experienceMonths'])
    return {
      exerciseId: this.id(data.exerciseId, `${path}.exerciseId`),
      date: this.date(data.date, `${path}.date`),
      weightKg: this.number(data.weightKg, `${path}.weightKg`, 0, 500),
      sets: this.number(data.sets, `${path}.sets`, 1, 10, true),
      reps: this.number(data.reps, `${path}.reps`, 1, 50, true),
      actualRPE: this.rpe(data.actualRPE, `${path}.actualRPE`),
      experienceMonths: this.number(data.experienceMonths, `${path}.experienceMonths`, 0, 1200),
    }
  }

  athlete(value: unknown, path: string): AthleteState {
    const data = this.object(value, path, ['baseline', 'calibration', 'availableDays', 'equipment', 'weeklyTimeBudgetMin', 'defaultStartTime', 'aggressiveness', 'residual', 'safetyHold', 'recommendedExerciseIds'])
    let recommendedExerciseIds: string[] | undefined
    if (Object.hasOwn(data, 'recommendedExerciseIds')) {
      const p = `${path}.recommendedExerciseIds`
      recommendedExerciseIds = this.array(data.recommendedExerciseIds, p, 1, RECOMMENDATION_POLICY.maxExercises)
        .map((id, index) => this.enum(id, `${p}[${index}]`, RECOMMENDATION_POLICY.supportedExerciseIds))
      this.unique(recommendedExerciseIds, id => id, p)
      recommendedExerciseIds.sort(compareText)
    }
    const b = `${path}.baseline`
    const baseline = this.object(data.baseline, b, ['asOf', 'weeklyRunMinutes', 'longestRunMinutes', 'runsPerWeek', 'liftsPerWeek', 'liftDurationMin', 'exercises'])
    const asOf = this.date(baseline.asOf, `${b}.asOf`)
    const weeklyRunMinutes = this.number(baseline.weeklyRunMinutes, `${b}.weeklyRunMinutes`, 1, LIMITS.maxWeeklyRunMinutes)
    const longestRunMinutes = this.number(baseline.longestRunMinutes, `${b}.longestRunMinutes`, 1, LIMITS.maxRunMinutes)
    const exercises = this.array(baseline.exercises, `${b}.exercises`, recommendedExerciseIds ? 0 : 1, LIMITS.maxExercises)
      .map((item, index) => this.observation(item, `${b}.exercises[${index}]`))
    this.unique(exercises, item => item.exerciseId, `${b}.exercises`)
    for (const [index, item] of exercises.entries()) {
      if (item.date > asOf) this.issue(`${b}.exercises[${index}].date`, 'cannot be after baseline.asOf')
    }
    if (longestRunMinutes > weeklyRunMinutes) this.issue(`${b}.longestRunMinutes`, 'cannot exceed the established weeklyRunMinutes')
    const c = `${path}.calibration`
    const calibration = this.object(data.calibration, c, ['version', 'costMultiplier', 'observationCount'])
    if (calibration.version !== 1) this.issue(`${c}.version`, 'must be 1')
    const availableDays = this.array(data.availableDays, `${path}.availableDays`, 1, 7)
      .map((day, index) => this.number(day, `${path}.availableDays[${index}]`, 0, 6, true) as Day)
    this.unique(availableDays, day => day, `${path}.availableDays`)
    const r = `${path}.residual`
    const residual = this.object(data.residual, r, ['asOfDate', 'asOfTime', 'load'])
    let safetyHold: AthleteState['safetyHold'] = null
    if (data.safetyHold !== null) {
      const p = `${path}.safetyHold`
      const hold = this.object(data.safetyHold, p, ['reason', 'since'])
      safetyHold = {
        reason: this.enum(hold.reason, `${p}.reason`, ['pain', 'illness', 'return_from_break']),
        since: this.date(hold.since, `${p}.since`),
      }
    }
    return {
      baseline: {
        asOf, weeklyRunMinutes, longestRunMinutes,
        runsPerWeek: this.number(baseline.runsPerWeek, `${b}.runsPerWeek`, 1, LIMITS.maxRuns, true),
        liftsPerWeek: this.number(baseline.liftsPerWeek, `${b}.liftsPerWeek`, 1, LIMITS.maxLifts, true),
        liftDurationMin: this.number(baseline.liftDurationMin, `${b}.liftDurationMin`, 15, 180),
        exercises,
      },
      calibration: {
        version: 1,
        costMultiplier: this.number(calibration.costMultiplier, `${c}.costMultiplier`, COST_MULTIPLIER_RANGE[0], COST_MULTIPLIER_RANGE[1]),
        observationCount: this.number(calibration.observationCount, `${c}.observationCount`, 0, MAX_COST, true),
      },
      availableDays: availableDays.sort((a, b) => a - b),
      equipment: this.equipment(data.equipment, `${path}.equipment`),
      weeklyTimeBudgetMin: this.positive(data.weeklyTimeBudgetMin, `${path}.weeklyTimeBudgetMin`, 7 * MAX_DURATION),
      defaultStartTime: this.time(data.defaultStartTime, `${path}.defaultStartTime`),
      aggressiveness: this.enum(data.aggressiveness, `${path}.aggressiveness`, ['conservative', 'standard', 'aggressive']),
      residual: {
        asOfDate: this.date(residual.asOfDate, `${r}.asOfDate`),
        asOfTime: this.time(residual.asOfTime, `${r}.asOfTime`),
        load: this.load(residual.load, `${r}.load`),
      },
      safetyHold,
      ...(recommendedExerciseIds ? { recommendedExerciseIds } : {}),
    }
  }

  commitment(value: unknown, path: string): FixedCommitment {
    const data = this.object(value, path, ['id', 'label', 'dayOfWeek', 'startTime', 'durationMin', 'discipline', 'modality', 'estimatedLoad'])
    const discipline = this.enum(data.discipline, `${path}.discipline`, DISCIPLINES)
    const modality = this.enum(data.modality, `${path}.modality`, MODALITIES)
    this.compatible(discipline, modality, path)
    return {
      id: this.id(data.id, `${path}.id`),
      label: this.text(data.label, `${path}.label`, 1, 80, true),
      dayOfWeek: this.number(data.dayOfWeek, `${path}.dayOfWeek`, 0, 6, true) as Day,
      startTime: this.time(data.startTime, `${path}.startTime`),
      durationMin: this.positive(data.durationMin, `${path}.durationMin`, MAX_DURATION),
      discipline, modality,
      estimatedLoad: this.load(data.estimatedLoad, `${path}.estimatedLoad`),
    }
  }

  goal(value: unknown, path: string): Goal {
    const data = this.object(value, path, ['label', 'peakDate', 'qualityBias', 'protectedExerciseIds', 'fixedCommitments'])
    const qualityBias = this.array(data.qualityBias, `${path}.qualityBias`, 1, QUALITIES.length)
      .map((item, index) => this.enum(item, `${path}.qualityBias[${index}]`, QUALITIES))
    const protectedExerciseIds = this.array(data.protectedExerciseIds, `${path}.protectedExerciseIds`, 0, LIMITS.maxExercises)
      .map((item, index) => this.id(item, `${path}.protectedExerciseIds[${index}]`))
    const fixedCommitments = this.array(data.fixedCommitments, `${path}.fixedCommitments`, 0, LIMITS.maxCommitments)
      .map((item, index) => this.commitment(item, `${path}.fixedCommitments[${index}]`))
    this.unique(qualityBias, item => item, `${path}.qualityBias`)
    this.unique(protectedExerciseIds, item => item, `${path}.protectedExerciseIds`)
    this.unique(fixedCommitments, item => item.id, `${path}.fixedCommitments`)
    return {
      label: this.text(data.label, `${path}.label`, 1, 80, true),
      peakDate: this.date(data.peakDate, `${path}.peakDate`),
      qualityBias, protectedExerciseIds, fixedCommitments,
    }
  }

  prescription(value: unknown, path: string, anchor: true): AnchorAssignment
  prescription(value: unknown, path: string, anchor: false): StrengthPrescription
  prescription(value: unknown, path: string, anchor: boolean): AnchorAssignment | StrengthPrescription {
    const fields = ['exerciseId', 'sets', 'reps', 'targetRPE', 'role', anchor ? 'pattern' : 'suggestedWeightKg', ...(anchor ? ['provenance'] : [])]
    const data = this.object(value, path, fields)
    const result: StrengthPrescription = {
      exerciseId: this.id(data.exerciseId, `${path}.exerciseId`),
      sets: this.number(data.sets, `${path}.sets`, 1, 10, true),
      reps: this.number(data.reps, `${path}.reps`, 1, 50, true),
      targetRPE: this.rpe(data.targetRPE, `${path}.targetRPE`),
      role: this.enum(data.role, `${path}.role`, ['anchor', 'accessory']),
    }
    if (anchor) {
      const assignment: AnchorAssignment = { ...result, pattern: this.enum(data.pattern, `${path}.pattern`, PATTERNS) }
      if (Object.hasOwn(data, 'provenance')) {
        const p = `${path}.provenance`
        const provenance = this.object(data.provenance, p, ['kind', 'policyVersion'])
        assignment.provenance = {
          kind: this.enum(provenance.kind, `${p}.kind`, ['recommended']),
          policyVersion: this.enum(provenance.policyVersion, `${p}.policyVersion`, [RECOMMENDATION_POLICY.version]),
        }
        if (assignment.sets > RECOMMENDATION_POLICY.sets || assignment.reps !== RECOMMENDATION_POLICY.reps
          || assignment.targetRPE !== RECOMMENDATION_POLICY.targetRPE
          || !(RECOMMENDATION_POLICY.supportedExerciseIds as readonly string[]).includes(assignment.exerciseId)) {
          this.issue(path, 'recommended anchors must retain the supported first-exposure policy prescription')
        }
      }
      return assignment
    }
    if (Object.hasOwn(data, 'suggestedWeightKg')) {
      result.suggestedWeightKg = this.number(data.suggestedWeightKg, `${path}.suggestedWeightKg`, 0, 500)
    }
    return result
  }

  block(value: unknown, path: string): Block {
    const data = this.object(value, path, ['id', 'engineVersion', 'policyVersion', 'libraryVersion', 'startDate', 'totalWeeks', 'goal', 'phases', 'anchors'])
    const startDate = this.date(data.startDate, `${path}.startDate`)
    const totalWeeks = this.number(data.totalWeeks, `${path}.totalWeeks`, 1, LIMITS.maxWeeks, true)
    const goal = this.goal(data.goal, `${path}.goal`)
    if (dayOfWeek(startDate) !== 0) this.issue(`${path}.startDate`, 'must be a Monday')
    const daysToPeak = dayNumber(goal.peakDate) - dayNumber(startDate)
    if (daysToPeak < 0) this.issue(`${path}.goal.peakDate`, 'cannot precede block.startDate')
    if (Math.floor(daysToPeak / 7) + 1 !== totalWeeks) {
      this.issue(`${path}.totalWeeks`, 'must end in the week containing goal.peakDate')
    }
    if (dayNumber(startDate) + totalWeeks * 7 - 1 > dayNumber('2199-12-31')) {
      this.issue(`${path}.totalWeeks`, 'block end must not extend beyond 2199-12-31')
    }
    const phases = this.array(data.phases, `${path}.phases`, 1, LIMITS.maxWeeks)
      .map((value, index): Phase => {
        const p = `${path}.phases[${index}]`
        const item = this.object(value, p, ['kind', 'startWeekIndex', 'endWeekIndex', 'volumeFraction'])
        const phase = {
          kind: this.enum(item.kind, `${p}.kind`, ['base', 'build', 'peak', 'taper', 'deload']),
          startWeekIndex: this.number(item.startWeekIndex, `${p}.startWeekIndex`, 0, totalWeeks - 1, true),
          endWeekIndex: this.number(item.endWeekIndex, `${p}.endWeekIndex`, 0, totalWeeks - 1, true),
          volumeFraction: this.positive(item.volumeFraction, `${p}.volumeFraction`, 1),
        }
        if (phase.endWeekIndex < phase.startWeekIndex) this.issue(p, 'endWeekIndex cannot precede startWeekIndex')
        return phase
      }).sort((a, b) => a.startWeekIndex - b.startWeekIndex)
    let nextWeek = 0
    for (const phase of phases) {
      if (phase.startWeekIndex !== nextWeek) this.issue(`${path}.phases`, `must cover every week exactly once without gaps or overlaps; expected startWeekIndex ${nextWeek}`)
      nextWeek = phase.endWeekIndex + 1
    }
    if (nextWeek !== totalWeeks) this.issue(`${path}.phases`, `must cover all ${totalWeeks} block weeks`)
    const anchors = this.array(data.anchors, `${path}.anchors`, 1, LIMITS.maxExercises)
      .map((item, index) => this.prescription(item, `${path}.anchors[${index}]`, true))
    this.unique(anchors, item => item.exerciseId, `${path}.anchors`)
    for (const id of goal.protectedExerciseIds) {
      if (!anchors.some(anchor => anchor.exerciseId === id)) this.issue(`${path}.anchors`, `must include protected exercise ${id}`)
    }
    return {
      id: this.id(data.id, `${path}.id`),
      engineVersion: this.enum(data.engineVersion, `${path}.engineVersion`, [ENGINE_VERSION]),
      policyVersion: this.enum(data.policyVersion, `${path}.policyVersion`, [POLICY_VERSION]),
      libraryVersion: this.enum(data.libraryVersion, `${path}.libraryVersion`, [LIBRARY_VERSION]),
      startDate, totalWeeks, goal, phases, anchors,
    }
  }

  session(value: unknown, path: string): Session {
    // Select the allowed field set before parsing, so another variant's fields are rejected.
    const tag = this.object(value, path, [...SESSION_FIELDS, 'endurancePrescription', 'strengthPrescription', 'label'])
    const kind = this.enum(tag.kind, `${path}.kind`, ['run', 'strength', 'commitment'])
    const data = this.object(tag, path, [...SESSION_FIELDS, kind === 'run' ? 'endurancePrescription' : kind === 'strength' ? 'strengthPrescription' : 'label'])
    const base = {
      id: this.id(data.id, `${path}.id`),
      date: this.date(data.date, `${path}.date`),
      startTime: data.startTime === null ? null : this.time(data.startTime, `${path}.startTime`),
      durationMin: this.positive(data.durationMin, `${path}.durationMin`, MAX_DURATION),
      predictedLoad: this.load(data.predictedLoad, `${path}.predictedLoad`),
      reason: this.text(data.reason, `${path}.reason`, 0, 4000),
      pinned: this.boolean(data.pinned, `${path}.pinned`),
      isCalibration: this.boolean(data.isCalibration, `${path}.isCalibration`),
    }
    if (kind === 'run') {
      const p = `${path}.endurancePrescription`
      const prescription = this.object(data.endurancePrescription, p, ['intent', 'effort'])
      return {
        ...base, kind,
        discipline: this.enum(data.discipline, `${path}.discipline`, ['run']),
        modality: this.enum(data.modality, `${path}.modality`, ['run_road', 'run_trail']),
        endurancePrescription: {
          intent: this.enum(prescription.intent, `${p}.intent`, ['easy', 'long']),
          effort: this.enum(prescription.effort, `${p}.effort`, ['conversational']),
        },
      }
    }
    if (kind === 'strength') {
      const p = `${path}.strengthPrescription`
      const strengthPrescription = this.array(data.strengthPrescription, p, 1, LIMITS.maxExercises)
        .map((item, index) => this.prescription(item, `${p}[${index}]`, false))
      this.unique(strengthPrescription, item => item.exerciseId, p)
      return {
        ...base, kind,
        discipline: this.enum(data.discipline, `${path}.discipline`, ['strength']),
        modality: this.enum(data.modality, `${path}.modality`, ['lifting']),
        strengthPrescription,
      }
    }
    const discipline = this.enum(data.discipline, `${path}.discipline`, DISCIPLINES)
    const modality = this.enum(data.modality, `${path}.modality`, MODALITIES)
    this.compatible(discipline, modality, path)
    return { ...base, kind, discipline, modality, label: this.text(data.label, `${path}.label`, 1, 80, true) }
  }

  setLog(value: unknown, path: string): SetLog {
    const data = this.object(value, path, ['exerciseId', 'weightKg', 'reps', 'actualRPE'])
    return {
      exerciseId: this.id(data.exerciseId, `${path}.exerciseId`),
      weightKg: this.number(data.weightKg, `${path}.weightKg`, 0, 500),
      reps: this.number(data.reps, `${path}.reps`, 1, 50, true),
      actualRPE: this.rpe(data.actualRPE, `${path}.actualRPE`),
    }
  }

  log(value: unknown, path: string): SessionLog {
    const data = this.object(value, path, ['sessionId', 'status', 'skipReason', 'actualEffort', 'actualDurationMin', 'sets', 'painFlag', 'notes'])
    const status = this.enum(data.status, `${path}.status`, ['completed', 'partial', 'skipped'])
    const result: SessionLog = {
      sessionId: this.id(data.sessionId, `${path}.sessionId`), status,
      painFlag: this.boolean(data.painFlag, `${path}.painFlag`),
      notes: this.text(data.notes, `${path}.notes`, 0, LIMITS.maxNotesLength),
    }
    if (status === 'skipped') {
      result.skipReason = this.enum(data.skipReason, `${path}.skipReason`, ['life', 'too_tired', 'pain', 'illness', 'weather', 'other'] as const)
      if (Object.hasOwn(data, 'actualDurationMin')) {
        result.actualDurationMin = this.number(data.actualDurationMin, `${path}.actualDurationMin`, 0, 0)
      }
      if (Object.hasOwn(data, 'actualEffort')) this.issue(`${path}.actualEffort`, 'a skipped session cannot report workout effort')
      if (Object.hasOwn(data, 'sets')) this.issue(`${path}.sets`, 'a skipped session cannot report workout sets')
    } else {
      if (Object.hasOwn(data, 'skipReason')) this.issue(`${path}.skipReason`, 'is allowed only when status is skipped')
      if (Object.hasOwn(data, 'actualEffort')) result.actualEffort = this.number(data.actualEffort, `${path}.actualEffort`, 0, 10)
      if (Object.hasOwn(data, 'actualDurationMin')) result.actualDurationMin = this.positive(data.actualDurationMin, `${path}.actualDurationMin`, MAX_DURATION)
      if (Object.hasOwn(data, 'sets')) {
        result.sets = this.array(data.sets, `${path}.sets`, 0, LIMITS.maxExercises * 10)
          .map((item, index) => this.setLog(item, `${path}.sets[${index}]`))
      }
    }
    return result
  }

  associate(session: Session, log: SessionLog | null, path: string): void {
    if (log === null) return
    if (log.sessionId !== session.id) this.issue(`${path}.log.sessionId`, `must match session.id ${session.id}`)
    if (log.sets !== undefined) {
      if (session.kind !== 'strength') {
        this.issue(`${path}.log.sets`, 'can only be supplied for a strength session')
      } else {
        const ids = new Set(session.strengthPrescription.map(item => item.exerciseId))
        for (const [index, set] of log.sets.entries()) {
          if (!ids.has(set.exerciseId)) this.issue(`${path}.log.sets[${index}].exerciseId`, `exercise ${set.exerciseId} is not prescribed by this session`)
        }
      }
    }
  }

  context(value: unknown, path: string): PlanningContext {
    const data = this.object(value, path, ['recentSessions', 'completedWeeks', 'neighboringSessions', 'pinnedSessions', 'untimedStrengthDates'])
    const recentSessions = this.array(data.recentSessions, `${path}.recentSessions`, 0, LIMITS.maxHistorySessions)
      .map((value, index): RecentSession => {
        const p = `${path}.recentSessions[${index}]`
        const item = this.object(value, p, ['session', 'log'])
        const session = this.session(item.session, `${p}.session`)
        const log = item.log === null ? null : this.log(item.log, `${p}.log`)
        this.associate(session, log, p)
        return { session, log }
      })
    const completedWeeks = this.array(data.completedWeeks, `${path}.completedWeeks`, 0, LIMITS.maxWeeks)
      .map((value, index): CompletedWeek => {
        const p = `${path}.completedWeeks[${index}]`
        const item = this.object(value, p, ['weekStart', 'runMinutes', 'plannedDeload', 'disrupted'])
        const weekStart = this.date(item.weekStart, `${p}.weekStart`)
        if (dayOfWeek(weekStart) !== 0) this.issue(`${p}.weekStart`, 'must be a Monday')
        return {
          weekStart,
          runMinutes: this.number(item.runMinutes, `${p}.runMinutes`, 0, 7 * MAX_DURATION),
          plannedDeload: this.boolean(item.plannedDeload, `${p}.plannedDeload`),
          disrupted: this.boolean(item.disrupted, `${p}.disrupted`),
        }
      })
    const neighboringSessions = this.array(data.neighboringSessions, `${path}.neighboringSessions`, 0, LIMITS.maxHistorySessions)
      .map((item, index) => this.session(item, `${path}.neighboringSessions[${index}]`))
    const pinnedSessions = this.array(data.pinnedSessions, `${path}.pinnedSessions`, 0, LIMITS.maxHistorySessions)
      .map((item, index) => this.session(item, `${path}.pinnedSessions[${index}]`))
    this.unique(recentSessions, item => item.session.id, `${path}.recentSessions`)
    this.unique(completedWeeks, item => item.weekStart, `${path}.completedWeeks`)
    this.unique(neighboringSessions, item => item.id, `${path}.neighboringSessions`)
    this.unique(pinnedSessions, item => item.id, `${path}.pinnedSessions`)
    const knownSessions = new Map(recentSessions.map(item => [item.session.id, item.session]))
    for (const session of [...neighboringSessions, ...pinnedSessions]) {
      const existing = knownSessions.get(session.id)
      if (existing && JSON.stringify(existing) !== JSON.stringify(session)) {
        this.issue(path, `session ID ${session.id} has conflicting definitions across context collections`)
      }
      knownSessions.set(session.id, session)
    }
    for (const [index, session] of pinnedSessions.entries()) {
      if (!session.pinned) this.issue(`${path}.pinnedSessions[${index}].pinned`, 'must be true for an explicitly pinned session')
    }
    const result: PlanningContext = { recentSessions, completedWeeks, neighboringSessions, pinnedSessions }
    if (Object.hasOwn(data, 'untimedStrengthDates')) {
      const dates = this.array(data.untimedStrengthDates, `${path}.untimedStrengthDates`, 0, LIMITS.maxHistorySessions)
        .map((date, index) => this.date(date, `${path}.untimedStrengthDates[${index}]`))
      this.unique(dates, date => date, `${path}.untimedStrengthDates`)
      result.untimedStrengthDates = dates.sort()
    }
    return result
  }

  input(value: unknown): PlanWeekInput {
    const path = 'input'
    const data = this.object(value, path, ['athlete', 'block', 'weekIndex', 'library', 'context'])
    const athlete = this.athlete(data.athlete, `${path}.athlete`)
    const block = this.block(data.block, `${path}.block`)
    const weekIndex = this.number(data.weekIndex, `${path}.weekIndex`, 0, block.totalWeeks - 1, true)
    const library = this.library(data.library, `${path}.library`)
    const context = this.context(data.context, `${path}.context`)
    // Structural failures are reported before cross-field date arithmetic or library lookups.
    this.finish(undefined)
    const weekStart = addDays(block.startDate, weekIndex * 7)
    const weekDay = dayNumber(weekStart)
    if (athlete.baseline.asOf > weekStart) this.issue('input.athlete.baseline.asOf', `cannot be after planned week start ${weekStart}`)
    if (dayNumber(athlete.residual.asOfDate) * 1440 + timeMinutes(athlete.residual.asOfTime) > weekDay * 1440) {
      this.issue('input.athlete.residual', `asOfDate/asOfTime must be at or before ${weekStart} 00:00`)
    }
    if (athlete.safetyHold && athlete.safetyHold.since > weekStart) {
      this.issue('input.athlete.safetyHold.since', `cannot be after planned week start ${weekStart}`)
    }
    const byId = new Map(library.exercises.map(exercise => [exercise.id, exercise]))
    const known = (id: string, p: string): Exercise | undefined => {
      const exercise = byId.get(id)
      if (!exercise) this.issue(p, `unknown exercise ${id}; add it to the supplied exercise library`)
      return exercise
    }
    const equipped = (exercise: Exercise, p: string): void => {
      const missing = exercise.equipment.filter(item => item !== 'none' && !athlete.equipment.includes(item))
      if (missing.length) this.issue(p, `exercise ${exercise.id} requires unavailable equipment: ${missing.join(', ')}`)
    }
    for (const [index, observation] of athlete.baseline.exercises.entries()) {
      known(observation.exerciseId, `input.athlete.baseline.exercises[${index}].exerciseId`)
    }
    for (const [index, id] of (athlete.recommendedExerciseIds ?? []).entries()) {
      const p = `input.athlete.recommendedExerciseIds[${index}]`
      const exercise = known(id, p)
      if (exercise) {
        if (exercise.highSkill) this.issue(p, 'high-skill exercises cannot be recommended')
        equipped(exercise, p)
      }
      if (!block.anchors.some(anchor => anchor.exerciseId === id)) this.issue(p, 'every selected recommendation needs a frozen block anchor')
    }
    for (const [index, anchor] of block.anchors.entries()) {
      const p = `input.block.anchors[${index}]`
      const exercise = known(anchor.exerciseId, `${p}.exerciseId`)
      if (!exercise) continue
      if (exercise.pattern !== anchor.pattern) this.issue(`${p}.pattern`, `must match library movement pattern ${exercise.pattern} for ${exercise.id}`)
      if (exercise.highSkill) this.issue(`${p}.exerciseId`, `high-skill exercise ${exercise.id} cannot be a generated anchor or accessory`)
      equipped(exercise, p)
      const observed = athlete.baseline.exercises.some(item => item.exerciseId === anchor.exerciseId)
      if (anchor.provenance) {
        if (!athlete.recommendedExerciseIds?.includes(anchor.exerciseId) || observed) {
          this.issue(p, 'recommended provenance requires an explicitly selected, unobserved exercise')
        }
      }
      if (athlete.recommendedExerciseIds) {
        if (!athlete.recommendedExerciseIds.includes(anchor.exerciseId)) this.issue(p, 'anchors must come from the selected recommended routine')
        if (!observed && !anchor.provenance) this.issue(p, 'an unobserved selected exercise requires versioned recommended provenance')
      }
    }
    for (const [index, id] of block.goal.protectedExerciseIds.entries()) {
      const p = `input.block.goal.protectedExerciseIds[${index}]`
      const exercise = known(id, p)
      if (!exercise) continue
      if (exercise.highSkill) this.issue(p, `high-skill exercise ${id} is not eligible for protection`)
      equipped(exercise, p)
    }
    const checkPrescriptions = (session: Session, p: string, requireEquipment: boolean): void => {
      if (session.kind !== 'strength') return
      for (const [index, prescription] of session.strengthPrescription.entries()) {
        const key = `${p}.strengthPrescription[${index}].exerciseId`
        const exercise = known(prescription.exerciseId, key)
        if (exercise && requireEquipment) equipped(exercise, key)
      }
    }
    for (const [index, item] of context.recentSessions.entries()) {
      const p = `input.context.recentSessions[${index}].session`
      if (item.session.date >= weekStart) this.issue(`${p}.date`, `recent history must be before planned week start ${weekStart}`)
      checkPrescriptions(item.session, p, false)
    }
    for (const [index, completed] of context.completedWeeks.entries()) {
      if (completed.weekStart >= weekStart) {
        this.issue(`input.context.completedWeeks[${index}].weekStart`, `must be a completed week before ${weekStart}`)
      }
    }
    for (const [index, session] of context.neighboringSessions.entries()) {
      const p = `input.context.neighboringSessions[${index}]`
      const offset = dayNumber(session.date) - weekDay
      if (offset < -7 || (offset >= 0 && offset < 7) || offset > 13) {
        this.issue(`${p}.date`, 'must be outside the requested week, within its immediately preceding or following seven days')
      }
      checkPrescriptions(session, p, offset >= 7)
    }
    for (const [index, session] of context.pinnedSessions.entries()) {
      const p = `input.context.pinnedSessions[${index}]`
      const offset = dayNumber(session.date) - weekDay
      if (offset < 0 || offset > 6) this.issue(`${p}.date`, `must be inside the requested week beginning ${weekStart}`)
      checkPrescriptions(session, p, true)
    }
    for (const [index, date] of (context.untimedStrengthDates ?? []).entries()) {
      const offset = dayNumber(date) - weekDay
      if (offset < -7 || offset > 13) {
        this.issue(`input.context.untimedStrengthDates[${index}]`, 'must be within the requested week or its neighboring seven days')
      }
    }
    return { athlete, block, weekIndex, library, context }
  }
}

export function parseLibrary(value: unknown): ExerciseLibrary {
  const v = new Validator()
  return v.finish(v.library(value, 'library'))
}

export function parseAthlete(value: unknown): AthleteState {
  const v = new Validator()
  return v.finish(v.athlete(value, 'athlete'))
}

export function parseGoal(value: unknown): Goal {
  const v = new Validator()
  return v.finish(v.goal(value, 'goal'))
}

export function parseBlock(value: unknown): Block {
  const v = new Validator()
  return v.finish(v.block(value, 'block'))
}

export function parseSession(value: unknown): Session {
  const v = new Validator()
  return v.finish(v.session(value, 'session'))
}

export function parseSessionLog(value: unknown): SessionLog {
  const v = new Validator()
  return v.finish(v.log(value, 'log'))
}

export function parsePlanningContext(value: unknown): PlanningContext {
  const v = new Validator()
  return v.finish(v.context(value, 'context'))
}

export function parsePlanWeekInput(value: unknown): PlanWeekInput {
  const v = new Validator()
  return v.finish(v.input(value))
}
