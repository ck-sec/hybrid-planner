import {
  COST_MULTIPLIER_RANGE, ENGINE_VERSION, LEGACY_EXERCISE_IDS, LIBRARY_VERSION, LIMITS,
  MAX_LOGGED_SETS_PER_BLOCK, POLICY_VERSION,
  PROGRAM_LIBRARY_VERSION, PROGRAM_POLICY, PROGRAM_POLICY_VERSION, RECOMMENDATION_POLICY,
} from './constants.ts'
import canonicalProgramLibrary from './exercises-v1.json' with { type: 'json' }
import { CUSTOM_EXERCISE_PROFILES, materializeCustomExercise } from './custom-exercise-profiles.ts'
import { addDays, dayNumber, dayOfWeek, parseISODate, timeMinutes } from './dates.ts'
import type {
  AnchorAssignment, AthleteState, Block, BlockLog, CompletedWeek, ConditioningBaseline,
  CustomExerciseProfileId, CustomExerciseSpec, Day, Discipline, Equipment,
  Exercise, ExerciseLibrary, ExerciseObservation, FixedCommitment, Goal, Load,
  Modality, MovementPattern, Phase, PlanWeekInput, PlanningContext, ProgramConfigV1, Quality, Resource,
  RecentSession, Session, SessionLog, SetLog, StrengthPrescription, TargetRPE, WorkoutBlock,
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
const RESOURCES: readonly Resource[] = [
  ...EQUIPMENT, 'bench', 'rack', 'pull_up_bar', 'stable_step', 'floor_space', 'anchor_point',
  'carry_space', 'dodgeball', 'court_space', 'safe_target',
]
const DISCIPLINES: readonly Discipline[] = ['run', 'bike', 'swim', 'strength', 'sport', 'mobility']
const MODALITIES: readonly Modality[] = ['run_road', 'run_trail', 'bike_road', 'bike_gravel', 'swim', 'row', 'ski_erg', 'lifting', 'court_sport', 'other']
const QUALITIES: readonly Quality[] = ['aerobic_base', 'threshold', 'vo2max', 'repeat_sprint', 'change_of_direction', 'max_strength', 'power', 'strength_endurance', 'shoulder_durability']
const SESSION_FIELDS = ['id', 'date', 'startTime', 'durationMin', 'predictedLoad', 'reason', 'pinned', 'isCalibration', 'kind', 'discipline', 'modality']
const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
const MAX_DURATION = 1440
const MAX_COST = 1_000_000

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    const items = value.map(item => canonical(item))
    if (value.every(item => typeof item === 'string')
      || value.every(item => item !== null && typeof item === 'object' && 'id' in item)) items.sort()
    return `[${items.join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => compareText(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

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

  resource(value: unknown, path: string): Resource {
    if (typeof value === 'string' && value.length <= 'custom:'.length + LIMITS.maxCustomResourceSlugLength
      && /^custom:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
      return value as Resource
    }
    return this.enum(value, path, RESOURCES)
  }

  resources(value: unknown, path: string): Resource[] {
    const result = this.array(value, path, 1, RESOURCES.length + LIMITS.maxCustomResources)
      .map((item, index) => this.resource(item, `${path}[${index}]`))
    this.unique(result, item => item, path)
    if (result.filter(item => item.startsWith('custom:')).length > LIMITS.maxCustomResources) {
      this.issue(path, `may contain at most ${LIMITS.maxCustomResources} custom resources`)
    }
    return result.sort(compareText)
  }

  plainText(value: unknown, path: string, max: number): string {
    const result = this.text(value, path, 1, max, true)
    const hasControl = [...result].some(character => {
      const code = character.charCodeAt(0)
      return code < 32 || (code >= 127 && code <= 159)
    })
    if (hasControl || /[<>`\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(result)) {
      this.issue(path, 'must be plain single-line text without markup or control characters')
    }
    return result
  }

  customExercise(value: unknown, path: string, confirmedResources?: readonly Resource[]): CustomExerciseSpec {
    const data = this.object(value, path, ['version', 'id', 'name', 'profileId', 'requirements', 'description', 'focus', 'why'])
    if (data.version !== 1) this.issue(`${path}.version`, 'must be 1')
    const id = this.id(data.id, `${path}.id`)
    if (!/^custom-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      this.issue(`${path}.id`, 'must be custom- followed by a lowercase kebab-case slug')
    }
    const requirements = this.resources(data.requirements, `${path}.requirements`)
    if (confirmedResources && requirements.some(resource => !confirmedResources.includes(resource))) {
      this.issue(`${path}.requirements`, 'must be a subset of confirmed program resources; no equipment is inferred')
    }
    return {
      version: 1, id,
      name: this.plainText(data.name, `${path}.name`, 80),
      profileId: this.enum(data.profileId, `${path}.profileId`,
        Object.keys(CUSTOM_EXERCISE_PROFILES) as CustomExerciseProfileId[]),
      requirements,
      description: this.plainText(data.description, `${path}.description`, 600),
      focus: this.plainText(data.focus, `${path}.focus`, 600),
      why: this.plainText(data.why, `${path}.why`, 600),
    }
  }

  program(value: unknown, path: string): ProgramConfigV1 {
    const data = this.object(value, path, [
      'version', 'libraryVersion', 'goal', 'resources', 'conditioningBaselines',
      'selectedExerciseIds', 'customExercises', 'comfortableThrowsPerPractice', 'includeMobility',
    ])
    if (data.version !== 1) this.issue(`${path}.version`, 'must be 1')
    const baselines = this.array(data.conditioningBaselines, `${path}.conditioningBaselines`, 0, LIMITS.maxConditioningBaselines)
      .map((entry, index): ConditioningBaseline => {
        const p = `${path}.conditioningBaselines[${index}]`
        const baseline = this.object(entry, p, ['modality', 'weeklyMinutes', 'longestSessionMinutes', 'sessionsPerWeek'])
        return {
          modality: this.enum(baseline.modality, `${p}.modality`,
            ['run_road', 'run_trail', 'bike_road', 'bike_gravel', 'row', 'ski_erg'] as const),
          weeklyMinutes: this.number(baseline.weeklyMinutes, `${p}.weeklyMinutes`, 1, LIMITS.maxWeeklyRunMinutes),
          longestSessionMinutes: this.number(baseline.longestSessionMinutes, `${p}.longestSessionMinutes`, 1, LIMITS.maxRunMinutes),
          sessionsPerWeek: this.number(baseline.sessionsPerWeek, `${p}.sessionsPerWeek`, 1, LIMITS.maxRuns, true),
        }
      })
    this.unique(baselines, baseline => baseline.modality, `${path}.conditioningBaselines`)
    for (const [index, baseline] of baselines.entries()) {
      if (baseline.longestSessionMinutes > baseline.weeklyMinutes) {
        this.issue(`${path}.conditioningBaselines[${index}].longestSessionMinutes`, 'cannot exceed weeklyMinutes')
      }
    }
    const result: ProgramConfigV1 = {
      version: 1,
      libraryVersion: this.enum(data.libraryVersion, `${path}.libraryVersion`, [PROGRAM_LIBRARY_VERSION]),
      goal: this.enum(data.goal, `${path}.goal`, ['balanced', 'endurance', 'strength', 'dodgeball'] as const),
      resources: this.resources(data.resources, `${path}.resources`),
      conditioningBaselines: baselines.sort((a, b) => compareText(a.modality, b.modality)),
    }
    if (Object.hasOwn(data, 'customExercises')) {
      // Archived definitions remain costable after gear changes. Creation callers
      // use parseCustomExercise(spec, confirmedResources); selection is checked below.
      const customExercises = this.array(data.customExercises, `${path}.customExercises`, 0, LIMITS.maxCustomExercises)
        .map((item, index) => this.customExercise(item, `${path}.customExercises[${index}]`))
      this.unique(customExercises, item => item.id, `${path}.customExercises`)
      result.customExercises = customExercises.sort((a, b) => compareText(a.id, b.id))
    }
    if (Object.hasOwn(data, 'selectedExerciseIds')) {
      const ids = this.array(data.selectedExerciseIds, `${path}.selectedExerciseIds`,
        PROGRAM_POLICY.minSelectedExercises, PROGRAM_POLICY.maxSelectedExercises)
        .map((id, index) => this.id(id, `${path}.selectedExerciseIds[${index}]`))
      this.unique(ids, id => id, `${path}.selectedExerciseIds`)
      result.selectedExerciseIds = ids.sort(compareText)
      for (const id of ids) {
        const exercise = canonicalProgramLibrary.exercises.find(item => item.id === id)
          ?? result.customExercises?.find(item => item.id === id)
        if (!exercise || ('highSkill' in exercise && exercise.highSkill)) {
          this.issue(`${path}.selectedExerciseIds`, `unknown or high-skill exercise ${id}; use a built-in or approved custom spec`)
        } else if (exercise.requirements.some(resource => !result.resources.includes(resource as Resource))) {
          this.issue(`${path}.selectedExerciseIds`, `exercise ${id} requires unavailable resources`)
        }
      }
    }
    if (Object.hasOwn(data, 'comfortableThrowsPerPractice')) {
      result.comfortableThrowsPerPractice = this.number(data.comfortableThrowsPerPractice,
        `${path}.comfortableThrowsPerPractice`, 1, 500, true)
    }
    if (Object.hasOwn(data, 'includeMobility')) {
      result.includeMobility = this.boolean(data.includeMobility, `${path}.includeMobility`)
    }
    if (result.goal === 'dodgeball' && result.comfortableThrowsPerPractice !== undefined) {
      for (const requirement of ['dodgeball', 'court_space', 'safe_target'] as const) {
        if (!result.resources.includes(requirement)) {
          this.issue(`${path}.resources`, `dodgeball requires explicit ${requirement}`)
        }
      }
    }
    if (result.goal !== 'dodgeball' && result.comfortableThrowsPerPractice !== undefined) {
      this.issue(`${path}.comfortableThrowsPerPractice`, 'is supported only for the dodgeball program')
    }
    return result
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

  library(value: unknown, path: string, program?: ProgramConfigV1): ExerciseLibrary {
    const data = this.object(value, path, ['version', 'exercises'])
    const version = this.enum(data.version, `${path}.version`, [LIBRARY_VERSION, PROGRAM_LIBRARY_VERSION])
    const extensible = version === PROGRAM_LIBRARY_VERSION
    const exercises = this.array(data.exercises, `${path}.exercises`, 1, LIMITS.maxLibraryExercises)
      .map((value, index): Exercise => {
        const p = `${path}.exercises[${index}]`
        const fields = ['id', 'name', 'pattern', 'equipment', 'coefficients', 'competesWithRunning', 'highSkill',
          ...(extensible ? ['requirements', 'label', 'template', 'profile', 'custom'] : [])]
        const item = this.object(value, p, fields)
        const exercise: Exercise = {
          id: this.id(item.id, `${p}.id`),
          name: this.text(item.name, `${p}.name`, 1, 80, true),
          pattern: this.enum(item.pattern, `${p}.pattern`, PATTERNS),
          equipment: this.equipment(item.equipment, `${p}.equipment`),
          coefficients: this.load(item.coefficients, `${p}.coefficients`),
          competesWithRunning: this.boolean(item.competesWithRunning, `${p}.competesWithRunning`),
          highSkill: this.boolean(item.highSkill, `${p}.highSkill`),
        }
        if (extensible) {
          const requirements = this.resources(item.requirements, `${p}.requirements`)
          const profilePath = `${p}.profile`
          const profile = this.object(item.profile, profilePath, ['version', 'schedulingEstimate', 'prescription'])
          const prescriptionPath = `${profilePath}.prescription`
          const prescriptionTag = this.object(profile.prescription, prescriptionPath, ['unit', 'sets', 'reps', 'targetRPE', 'seconds'])
          const unit = this.enum(prescriptionTag.unit, `${prescriptionPath}.unit`, ['reps', 'seconds'] as const)
          const prescriptionData = this.object(prescriptionTag, prescriptionPath,
            unit === 'reps' ? ['unit', 'sets', 'reps', 'targetRPE'] : ['unit', 'sets', 'seconds'])
          const prescription = unit === 'reps' ? {
            unit,
            sets: this.number(prescriptionData.sets, `${prescriptionPath}.sets`, 1, 4, true),
            reps: this.number(prescriptionData.reps, `${prescriptionPath}.reps`, 1, 20, true),
            targetRPE: this.rpe(prescriptionData.targetRPE, `${prescriptionPath}.targetRPE`),
          } : {
            unit,
            sets: this.number(prescriptionData.sets, `${prescriptionPath}.sets`, 1, 4, true),
            seconds: this.number(prescriptionData.seconds, `${prescriptionPath}.seconds`, 5, 300, true),
          }
          const schedulingEstimate = this.load(profile.schedulingEstimate, `${profilePath}.schedulingEstimate`)
          if (schedulingEstimate.systemic !== exercise.coefficients.systemic
            || schedulingEstimate.structural !== exercise.coefficients.structural) {
            this.issue(profilePath, 'schedulingEstimate must exactly match coefficients')
          }
          exercise.requirements = requirements.sort(compareText)
          exercise.label = this.text(item.label, `${p}.label`, 1, 80, true)
          exercise.template = this.enum(item.template, `${p}.template`,
            ['squat', 'hinge', 'push', 'pull', 'unilateral', 'carry', 'core', 'rotation', 'mobility'] as const)
          exercise.profile = {
            version: this.enum(profile.version, `${profilePath}.version`, ['scheduling-estimate-1'] as const),
            schedulingEstimate,
            prescription,
          }
          if (Object.hasOwn(item, 'custom')) {
            exercise.custom = this.customExercise(item.custom, `${p}.custom`)
          }
          for (const equipment of exercise.equipment) {
            if (equipment !== 'none' && !requirements.includes(equipment)) {
              this.issue(`${p}.requirements`, `must include equipment requirement ${equipment}`)
            }
          }
        }
        return exercise
      })
    this.unique(exercises, exercise => exercise.id, `${path}.exercises`)
    const result = { version, exercises: exercises.sort((a, b) => compareText(a.id, b.id)) }
    const expected = {
      version: PROGRAM_LIBRARY_VERSION,
      exercises: [...canonicalProgramLibrary.exercises, ...(program?.customExercises ?? []).map(materializeCustomExercise)],
    }
    if (extensible && canonical(result) !== canonical(expected)) {
      this.issue(path, 'exercise-profiles-1 must exactly match the reviewed built-in catalog plus the approved program custom specs')
    }
    if (program && !extensible) {
      this.issue(path, 'an opt-in program requires exercise-profiles-1')
    }
    return result
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
    const data = this.object(value, path, ['baseline', 'calibration', 'availableDays', 'equipment', 'weeklyTimeBudgetMin', 'defaultStartTime', 'aggressiveness', 'residual', 'safetyHold', 'recommendedExerciseIds', 'program'])
    const program = Object.hasOwn(data, 'program') ? this.program(data.program, `${path}.program`) : undefined
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
    const runsPerWeek = this.number(baseline.runsPerWeek, `${b}.runsPerWeek`, 1, LIMITS.maxRuns, true)
    const liftsPerWeek = this.number(baseline.liftsPerWeek, `${b}.liftsPerWeek`, 1, LIMITS.maxLifts, true)
    const liftDurationMin = this.number(baseline.liftDurationMin, `${b}.liftDurationMin`, 15, 180)
    const exercises = this.array(baseline.exercises, `${b}.exercises`, recommendedExerciseIds || program ? 0 : 1, LIMITS.maxExercises)
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
    const equipment = this.equipment(data.equipment, `${path}.equipment`)
    if (program) {
      for (const resource of program.resources) {
        if ((EQUIPMENT as readonly string[]).includes(resource) && resource !== 'none' && !equipment.includes(resource as Equipment)) {
          this.issue(`${path}.program.resources`, `equipment resource ${resource} is not present in athlete.equipment`)
        }
      }
      if (recommendedExerciseIds) this.issue(`${path}`, 'recommendedExerciseIds is legacy-only and cannot be combined with program')
      const explicitRuns = program.conditioningBaselines.filter(item =>
        item.modality === 'run_road' || item.modality === 'run_trail')
      if (explicitRuns.length > 1) {
        this.issue(`${path}.program.conditioningBaselines`, 'may contain only one explicit running baseline')
      }
      const explicitRun = explicitRuns[0]
      if (explicitRun && (explicitRun.weeklyMinutes !== weeklyRunMinutes
        || explicitRun.longestSessionMinutes !== longestRunMinutes
        || explicitRun.sessionsPerWeek !== runsPerWeek)) {
        this.issue(`${path}.program.conditioningBaselines`,
          'an explicit running baseline must exactly match baseline weeklyRunMinutes, longestRunMinutes, and runsPerWeek')
      }
    }
    return {
      baseline: {
        asOf, weeklyRunMinutes, longestRunMinutes,
        runsPerWeek,
        liftsPerWeek,
        liftDurationMin,
        exercises,
      },
      calibration: {
        version: 1,
        costMultiplier: this.number(calibration.costMultiplier, `${c}.costMultiplier`, COST_MULTIPLIER_RANGE[0], COST_MULTIPLIER_RANGE[1]),
        observationCount: this.number(calibration.observationCount, `${c}.observationCount`, 0, MAX_COST, true),
      },
      availableDays: availableDays.sort((a, b) => a - b),
      equipment,
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
      ...(program ? { program } : {}),
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
    const data = this.object(value, path, ['id', 'engineVersion', 'policyVersion', 'libraryVersion', 'startDate', 'totalWeeks', 'goal', 'phases', 'anchors', 'program', 'workoutTemplates'])
    const program = Object.hasOwn(data, 'program') ? this.program(data.program, `${path}.program`) : undefined
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
    const anchors = this.array(data.anchors, `${path}.anchors`, program ? 0 : 1, LIMITS.maxExercises)
      .map((item, index) => this.prescription(item, `${path}.anchors[${index}]`, true))
    this.unique(anchors, item => item.exerciseId, `${path}.anchors`)
    for (const id of goal.protectedExerciseIds) {
      if (!(program ? program.selectedExerciseIds?.includes(id) : anchors.some(anchor => anchor.exerciseId === id))) {
        this.issue(`${path}.anchors`, `must include protected exercise ${id}`)
      }
    }
    let workoutTemplates: Block['workoutTemplates']
    if (program) {
      if (anchors.length) this.issue(`${path}.anchors`, 'opt-in programs use frozen workout templates, not legacy anchors')
      if (!program.selectedExerciseIds) {
        this.issue(`${path}.program.selectedExerciseIds`, 'must freeze the resolved exercise pool')
      }
      const templates = this.array(data.workoutTemplates, `${path}.workoutTemplates`, 2, 2).map((entry, index) => {
        const p = `${path}.workoutTemplates[${index}]`
        const template = this.object(entry, p, ['label', 'exerciseIds'])
        const exerciseIds = this.array(template.exerciseIds, `${p}.exerciseIds`, 3, 4)
          .map((id, exerciseIndex) => this.id(id, `${p}.exerciseIds[${exerciseIndex}]`))
        this.unique(exerciseIds, id => id, `${p}.exerciseIds`)
        return {
          label: this.enum(template.label, `${p}.label`, ['Strength A', 'Strength B'] as const),
          exerciseIds,
        }
      })
      this.unique(templates, template => template.label, `${path}.workoutTemplates`)
      const usedIds = [...new Set(templates.flatMap(template => template.exerciseIds))].sort(compareText)
      if (program.selectedExerciseIds
        && usedIds.join('|') !== [...program.selectedExerciseIds].sort(compareText).join('|')) {
        this.issue(`${path}.workoutTemplates`, 'must use exactly the frozen selectedExerciseIds pool')
      }
      workoutTemplates = templates
    } else if (Object.hasOwn(data, 'workoutTemplates')) {
      this.issue(`${path}.workoutTemplates`, 'requires an opt-in program')
    }
    const result: Block = {
      id: this.id(data.id, `${path}.id`),
      engineVersion: this.enum(data.engineVersion, `${path}.engineVersion`, [ENGINE_VERSION]),
      policyVersion: this.enum(data.policyVersion, `${path}.policyVersion`, [program ? PROGRAM_POLICY_VERSION : POLICY_VERSION]),
      libraryVersion: this.enum(data.libraryVersion, `${path}.libraryVersion`, [program ? PROGRAM_LIBRARY_VERSION : LIBRARY_VERSION]),
      startDate, totalWeeks, goal, phases, anchors,
    }
    if (program && workoutTemplates) {
      result.program = program
      result.workoutTemplates = workoutTemplates
    }
    return result
  }

  session(value: unknown, path: string): Session {
    // Select the allowed field set before parsing, so another variant's fields are rejected.
    const tag = this.object(value, path, [...SESSION_FIELDS, 'endurancePrescription', 'strengthPrescription', 'conditioningPrescription', 'label', 'blocks', 'sourceCommitmentId'])
    const kind = this.enum(tag.kind, `${path}.kind`, ['run', 'strength', 'commitment', 'conditioning', 'workout'])
    const variantFields = kind === 'run' ? ['endurancePrescription']
      : kind === 'strength' ? ['strengthPrescription']
        : kind === 'conditioning' ? ['conditioningPrescription']
          : kind === 'workout' ? ['label', 'blocks', 'sourceCommitmentId'] : ['label']
    const data = this.object(tag, path, [...SESSION_FIELDS, ...variantFields])
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
    if (kind === 'conditioning') {
      const p = `${path}.conditioningPrescription`
      const prescription = this.object(data.conditioningPrescription, p, ['intent', 'effort'])
      const modality = this.enum(data.modality, `${path}.modality`,
        ['run_road', 'run_trail', 'bike_road', 'bike_gravel', 'row', 'ski_erg'] as const)
      const discipline = modality === 'run_road' || modality === 'run_trail' ? 'run'
        : modality === 'bike_road' || modality === 'bike_gravel' ? 'bike' : 'sport'
      return {
        ...base, kind,
        discipline: this.enum(data.discipline, `${path}.discipline`, [discipline]),
        modality,
        conditioningPrescription: {
          intent: this.enum(prescription.intent, `${p}.intent`, ['easy']),
          effort: this.enum(prescription.effort, `${p}.effort`, ['conversational']),
        },
      }
    }
    if (kind === 'workout') {
      const discipline = this.enum(data.discipline, `${path}.discipline`, ['strength', 'sport'] as const)
      const modality = this.enum(data.modality, `${path}.modality`, ['lifting', 'court_sport'] as const)
      if ((discipline === 'strength') !== (modality === 'lifting')) {
        this.issue(path, 'strength workouts require lifting and sport workouts require court_sport')
      }
      const blocks = this.array(data.blocks, `${path}.blocks`, 1, LIMITS.maxWorkoutBlocks)
        .map((block, index) => this.workoutBlock(block, `${path}.blocks[${index}]`))
      const result: Extract<Session, { kind: 'workout' }> = {
        ...base, kind, discipline, modality,
        label: this.text(data.label, `${path}.label`, 1, 80, true),
        blocks,
      }
      if (Object.hasOwn(data, 'sourceCommitmentId')) {
        result.sourceCommitmentId = this.id(data.sourceCommitmentId, `${path}.sourceCommitmentId`)
      }
      if (discipline === 'sport') {
        if (!result.sourceCommitmentId) this.issue(`${path}.sourceCommitmentId`, 'is required for a sport workout')
        if (blocks.some(block => block.unit !== 'throws')) this.issue(`${path}.blocks`, 'sport workouts support only controlled throw blocks')
      } else {
        if (result.sourceCommitmentId) this.issue(`${path}.sourceCommitmentId`, 'is supported only for a sport workout')
        if (blocks.some(block => block.unit === 'throws')) this.issue(`${path}.blocks`, 'strength workouts cannot contain throw blocks')
      }
      return result
    }
    const discipline = this.enum(data.discipline, `${path}.discipline`, DISCIPLINES)
    const modality = this.enum(data.modality, `${path}.modality`, MODALITIES)
    this.compatible(discipline, modality, path)
    return { ...base, kind, discipline, modality, label: this.text(data.label, `${path}.label`, 1, 80, true) }
  }

  workoutBlock(value: unknown, path: string): WorkoutBlock {
    const tag = this.object(value, path, [
      'unit', 'exerciseId', 'sets', 'reps', 'targetRPE', 'role', 'suggestedWeightKg',
      'seconds', 'drillId', 'throws', 'intent', 'embedded', 'executionStyle',
    ])
    const unit = this.enum(tag.unit, `${path}.unit`, ['reps', 'seconds', 'throws'] as const)
    if (unit === 'reps') {
      const data = this.object(tag, path, ['unit', 'exerciseId', 'sets', 'reps', 'targetRPE', 'role', 'suggestedWeightKg', 'executionStyle'])
      const result: Extract<WorkoutBlock, { unit: 'reps' }> = {
        unit, exerciseId: this.id(data.exerciseId, `${path}.exerciseId`),
        sets: this.number(data.sets, `${path}.sets`, 1, 4, true),
        reps: this.number(data.reps, `${path}.reps`, 1, 20, true),
        targetRPE: this.rpe(data.targetRPE, `${path}.targetRPE`),
        role: this.enum(data.role, `${path}.role`, ['anchor', 'accessory'] as const),
        executionStyle: this.enum(data.executionStyle, `${path}.executionStyle`,
          ['controlled', 'slow_lowering', 'fast_concentric_intent'] as const),
      }
      if (Object.hasOwn(data, 'suggestedWeightKg')) {
        result.suggestedWeightKg = this.number(data.suggestedWeightKg, `${path}.suggestedWeightKg`, 0, 500)
      }
      return result
    }
    if (unit === 'seconds') {
      const data = this.object(tag, path, ['unit', 'exerciseId', 'sets', 'seconds', 'role', 'executionStyle'])
      return {
        unit, exerciseId: this.id(data.exerciseId, `${path}.exerciseId`),
        sets: this.number(data.sets, `${path}.sets`, 1, 4, true),
        seconds: this.number(data.seconds, `${path}.seconds`, 5, 300, true),
        role: this.enum(data.role, `${path}.role`, ['carry', 'mobility'] as const),
        executionStyle: this.enum(data.executionStyle, `${path}.executionStyle`, ['controlled']),
      }
    }
    const data = this.object(tag, path, ['unit', 'drillId', 'throws', 'intent', 'embedded'])
    const embedded = this.boolean(data.embedded, `${path}.embedded`)
    if (!embedded) this.issue(`${path}.embedded`, 'must be true because technique is inside an established practice')
    return {
      unit,
      drillId: this.enum(data.drillId, `${path}.drillId`, ['dodgeball-controlled-target-throw'] as const),
      throws: this.number(data.throws, `${path}.throws`, 1, 500, true),
      intent: this.enum(data.intent, `${path}.intent`, ['controlled_technique'] as const),
      embedded: true,
    }
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

  blockLog(value: unknown, path: string): BlockLog {
    const tag = this.object(value, path, ['unit', 'blockIndex', 'exerciseId', 'sets', 'seconds', 'weightKg', 'drillId', 'throws'])
    const unit = this.enum(tag.unit, `${path}.unit`, ['reps', 'seconds', 'throws'] as const)
    const blockIndex = this.number(tag.blockIndex, `${path}.blockIndex`, 0, LIMITS.maxWorkoutBlocks - 1, true)
    if (unit === 'reps') {
      const data = this.object(tag, path, ['unit', 'blockIndex', 'exerciseId', 'sets'])
      return {
        unit, blockIndex,
        exerciseId: this.id(data.exerciseId, `${path}.exerciseId`),
        sets: this.array(data.sets, `${path}.sets`, 1, MAX_LOGGED_SETS_PER_BLOCK)
          .map((set, index) => this.setLog(set, `${path}.sets[${index}]`)),
      }
    }
    if (unit === 'seconds') {
      const data = this.object(tag, path, ['unit', 'blockIndex', 'exerciseId', 'seconds', 'weightKg'])
      const result: Extract<BlockLog, { unit: 'seconds' }> = {
        unit, blockIndex,
        exerciseId: this.id(data.exerciseId, `${path}.exerciseId`),
        seconds: this.number(data.seconds, `${path}.seconds`, 0, MAX_DURATION * 60, true),
      }
      if (Object.hasOwn(data, 'weightKg')) {
        result.weightKg = this.number(data.weightKg, `${path}.weightKg`, 0, 500)
      }
      return result
    }
    const data = this.object(tag, path, ['unit', 'blockIndex', 'drillId', 'throws'])
    return {
      unit, blockIndex,
      drillId: this.enum(data.drillId, `${path}.drillId`, ['dodgeball-controlled-target-throw'] as const),
      throws: this.number(data.throws, `${path}.throws`, 0, 500, true),
    }
  }

  log(value: unknown, path: string): SessionLog {
    const data = this.object(value, path, ['sessionId', 'status', 'skipReason', 'actualEffort', 'actualDurationMin', 'sets', 'blockLogs', 'painFlag', 'notes'])
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
      if (Object.hasOwn(data, 'blockLogs')) this.issue(`${path}.blockLogs`, 'a skipped session cannot report workout blocks')
    } else {
      if (Object.hasOwn(data, 'skipReason')) this.issue(`${path}.skipReason`, 'is allowed only when status is skipped')
      if (Object.hasOwn(data, 'actualEffort')) result.actualEffort = this.number(data.actualEffort, `${path}.actualEffort`, 0, 10)
      if (Object.hasOwn(data, 'actualDurationMin')) result.actualDurationMin = this.positive(data.actualDurationMin, `${path}.actualDurationMin`, MAX_DURATION)
      if (Object.hasOwn(data, 'sets')) {
        result.sets = this.array(data.sets, `${path}.sets`, 0, LIMITS.maxExercises * 10)
          .map((item, index) => this.setLog(item, `${path}.sets[${index}]`))
      }
      if (Object.hasOwn(data, 'blockLogs')) {
        const blockLogs = this.array(data.blockLogs, `${path}.blockLogs`, 0, LIMITS.maxWorkoutBlocks)
          .map((item, index) => this.blockLog(item, `${path}.blockLogs[${index}]`))
        this.unique(blockLogs, item => item.blockIndex, `${path}.blockLogs`)
        result.blockLogs = blockLogs.sort((a, b) => a.blockIndex - b.blockIndex)
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
    if (log.blockLogs !== undefined) {
        if (session.kind !== 'workout') {
          this.issue(`${path}.log.blockLogs`, 'can only be supplied for a workout session')
        } else {
          for (const [index, blockLog] of log.blockLogs.entries()) {
            const p = `${path}.log.blockLogs[${index}]`
            const block = session.blocks[blockLog.blockIndex]
            if (!block) {
              this.issue(`${p}.blockIndex`, 'does not identify a prescribed block')
              continue
            }
            if (block.unit !== blockLog.unit) {
              this.issue(`${p}.unit`, `must match prescribed ${block.unit} unit`)
              continue
          }
          if (block.unit === 'reps' && blockLog.unit === 'reps') {
            if (block.exerciseId !== blockLog.exerciseId) this.issue(`${p}.exerciseId`, `must match ${block.exerciseId}`)
            for (const [setIndex, set] of blockLog.sets.entries()) {
              if (set.exerciseId !== block.exerciseId) this.issue(`${p}.sets[${setIndex}].exerciseId`, `must match ${block.exerciseId}`)
            }
          } else if (block.unit === 'seconds' && blockLog.unit === 'seconds') {
            if (block.exerciseId !== blockLog.exerciseId) this.issue(`${p}.exerciseId`, `must match ${block.exerciseId}`)
            if (block.role === 'mobility' && blockLog.weightKg !== undefined) {
              this.issue(`${p}.weightKg`, 'is allowed only for a loaded carry, not mobility')
            }
          } else if (block.unit === 'throws' && blockLog.unit === 'throws') {
            if (block.drillId !== blockLog.drillId) this.issue(`${p}.drillId`, `must match ${block.drillId}`)
          }
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
    const library = this.library(data.library, `${path}.library`, block.program)
    const context = this.context(data.context, `${path}.context`)
    // Structural failures are reported before cross-field date arithmetic or library lookups.
    this.finish(undefined)
    if ((athlete.program === undefined) !== (block.program === undefined)) {
      this.issue('input', 'athlete.program and block.program must either both be present or both be absent')
    }
    if (athlete.program && block.program) {
      const sameProgram = athlete.program.version === block.program.version
        && athlete.program.libraryVersion === block.program.libraryVersion
        && athlete.program.goal === block.program.goal
        && athlete.program.comfortableThrowsPerPractice === block.program.comfortableThrowsPerPractice
        && athlete.program.includeMobility === block.program.includeMobility
        && athlete.program.resources.join('|') === block.program.resources.join('|')
        && JSON.stringify(athlete.program.conditioningBaselines) === JSON.stringify(block.program.conditioningBaselines)
        && canonical(athlete.program.customExercises ?? []) === canonical(block.program.customExercises ?? [])
      if (!sameProgram) {
        this.issue('input.block.program', 'must exactly match the program frozen from athlete.program')
      }
      if (library.version !== block.libraryVersion || library.version !== athlete.program.libraryVersion) {
        this.issue('input.library.version', 'must match the frozen opt-in program libraryVersion')
      }
    }
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
    const resourced = (exercise: Exercise, p: string): void => {
      if (!athlete.program) return
      const missing = (exercise.requirements ?? []).filter(item => !athlete.program!.resources.includes(item))
      if (missing.length) this.issue(p, `exercise ${exercise.id} requires unavailable resources: ${missing.join(', ')}`)
      if (!exercise.profile || !exercise.template || !exercise.label) this.issue(p, `exercise ${exercise.id} lacks an engine-owned program profile`)
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
      if (!block.program && library.version === PROGRAM_LIBRARY_VERSION
        && !(LEGACY_EXERCISE_IDS as readonly string[]).includes(anchor.exerciseId)) {
        this.issue(`${p}.exerciseId`, 'expanded catalog exercises require opt-in programming')
      }
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
    if (block.program && block.workoutTemplates) {
      const selected = block.program.selectedExerciseIds ?? []
      for (const [templateIndex, template] of block.workoutTemplates.entries()) {
        for (const [exerciseIndex, id] of template.exerciseIds.entries()) {
          const p = `input.block.workoutTemplates[${templateIndex}].exerciseIds[${exerciseIndex}]`
          const exercise = known(id, p)
          if (exercise) {
            equipped(exercise, p)
            resourced(exercise, p)
            if (exercise.highSkill) this.issue(p, 'high-skill exercises cannot be prescribed')
          }
          if (!selected.includes(id)) this.issue(p, 'must come from program.selectedExerciseIds')
        }
      }
      if (block.workoutTemplates[0]?.exerciseIds.join('|') === block.workoutTemplates[1]?.exerciseIds.join('|')) {
        this.issue('input.block.workoutTemplates', 'Strength A and Strength B must be differentiated')
      }
      const requested = athlete.program?.selectedExerciseIds
      if (requested && (requested.some(id => !selected.includes(id))
        || selected.some(id => !requested.includes(id)
          && !(athlete.program?.includeMobility && byId.get(id)?.template === 'mobility')))) {
        this.issue('input.block.program.selectedExerciseIds', 'must retain the explicitly selected exercise pool')
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
      const exerciseIds = session.kind === 'strength' ? session.strengthPrescription.map(item => item.exerciseId)
        : session.kind === 'workout' ? session.blocks.filter((block): block is Extract<WorkoutBlock, { unit: 'reps' | 'seconds' }> =>
          block.unit !== 'throws').map(block => block.exerciseId) : []
      for (const [index, exerciseId] of exerciseIds.entries()) {
        const key = `${p}.strengthPrescription[${index}].exerciseId`
        const exercise = known(exerciseId, key)
        if (exercise && requireEquipment) { equipped(exercise, key); resourced(exercise, key) }
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

export function parseLibrary(value: unknown, program?: ProgramConfigV1): ExerciseLibrary {
  const v = new Validator()
  const parsedProgram = program === undefined ? undefined : v.finish(v.program(program, 'program'))
  return v.finish(v.library(value, 'library', parsedProgram))
}

export function parseAthlete(value: unknown): AthleteState {
  const v = new Validator()
  return v.finish(v.athlete(value, 'athlete'))
}

export function parseProgramConfig(value: unknown): ProgramConfigV1 {
  const v = new Validator()
  return v.finish(v.program(value, 'program'))
}

/** Review parsing only; membership in a confirmed program is checked again at planning boundaries. */
export function parseCustomExercise(value: unknown, confirmedResources?: readonly Resource[]): CustomExerciseSpec {
  const v = new Validator()
  const resources = confirmedResources === undefined ? undefined : v.resources(confirmedResources, 'confirmedResources')
  return v.finish(v.customExercise(value, 'customExercise', resources))
}

export function parseResource(value: unknown): Resource {
  const v = new Validator()
  return v.finish(v.resource(value, 'resource'))
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

export function parseWorkoutBlock(value: unknown): WorkoutBlock {
  const v = new Validator()
  return v.finish(v.workoutBlock(value, 'block'))
}

export function parseBlockLog(value: unknown): BlockLog {
  const v = new Validator()
  return v.finish(v.blockLog(value, 'blockLog'))
}

/** Parse both values and verify every block log against its prescribed block. */
export function validateBlockLogs(sessionValue: unknown, logValue: unknown): SessionLog {
  const v = new Validator()
  const session = v.session(sessionValue, 'session')
  const log = v.log(logValue, 'log')
  v.associate(session, log, 'record')
  return v.finish(log)
}

export function parsePlanningContext(value: unknown): PlanningContext {
  const v = new Validator()
  return v.finish(v.context(value, 'context'))
}

export function parsePlanWeekInput(value: unknown): PlanWeekInput {
  const v = new Validator()
  return v.finish(v.input(value))
}
