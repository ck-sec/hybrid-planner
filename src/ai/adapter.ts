import { AI_COPY_PASTE_FORMAT, AI_COPY_PASTE_VERSION, WORKOUT_CATEGORIES, buildTargetWeek, normalizeFixedClubSessions } from './contract.ts'
import { parseGoalAssessment, parseLoadBasis, parsePlanningContext, parseRepBasis } from '../domain/planning-context.ts'
import type {
  AiWeekCopyPasteContract,
  DomainValidatorLike,
  FixedClubSession,
  FixedClubWorkoutSource,
  ParsePastedPlanOptions,
  ParsePastedPlanResult,
  PlannedWorkout,
  ValidationIssue,
  WorkoutCategory,
  WorkoutSource,
  WorkoutStepContract,
  WeekPromptKind,
} from './types.ts'

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const CLOCK_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const CONTROL_OR_TAG_PATTERN = /[\p{Cc}\p{Cf}]|<[^>]*>/u
const PROSE_CONTROL_OR_TAG_PATTERN = /(?![\r\n])[\p{Cc}\p{Cf}]|<[^>]*>/u
const MULTILINE_SHARED_FIELDS = new Set(['event', 'benchmarks', 'limitations', 'summary', 'rationale', 'unknowns', 'nextMilestone'])

interface LocalValidationOptions {
  expectedWeekType?: WeekPromptKind
  expectedTargetWeekStartDate?: string
  expectedTargetWeekDates?: readonly string[]
  expectedFixedClubSessions?: readonly FixedClubSession[]
}

function collectDomainValidators<T>(options: ParsePastedPlanOptions<T>): readonly DomainValidatorLike<T>[] {
  if (options.domainValidators?.length) return options.domainValidators
  return options.domainValidator ? [options.domainValidator] : []
}

function issue(path: string, code: string, message: string, suggestion?: string): ValidationIssue {
  return { path, code, message, ...(suggestion === undefined ? {} : { suggestion }) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function joinPath(parent: string, child: string | number): string {
  if (typeof child === 'number') return `${parent}[${child}]`
  return parent ? `${parent}.${child}` : child
}

function rejectRepeatedKeys(content: string): void {
  const objects: Array<Set<string> | null> = []
  for (let index = 0; index < content.length; index++) {
    if (content[index] === '"') {
      const start = index
      for (index++; index < content.length; index++) {
        if (content[index] === '\\') index++
        else if (content[index] === '"') break
      }
      let next = index + 1
      while (next < content.length && /\s/.test(content[next]!)) next++
      if (content[next] === ':') {
        const key: string = JSON.parse(content.slice(start, index + 1))
        const keys = objects.at(-1)
        if (keys?.has(key)) throw new Error('The pasted JSON repeats a field name. Return one unambiguous final object.')
        keys?.add(key)
      }
    } else if (content[index] === '{') objects.push(new Set())
    else if (content[index] === '[') objects.push(null)
    else if (content[index] === '}' || content[index] === ']') objects.pop()
  }
}

function extractJson(content: string): string {
  const trimmed = content.trim()
  return /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed)?.[1] ?? trimmed
}

function validateKeys(
  raw: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  const allowed = new Set([...required, ...optional])
  for (const key of required) {
    if (!Object.hasOwn(raw, key)) {
      issues.push(issue(joinPath(path, key), 'missing_field', `Missing required field "${key}".`, `Add "${key}" to the JSON reply.`))
    }
  }
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      issues.push(issue(joinPath(path, key), 'unexpected_field', `Unexpected field "${key}".`, 'Remove unsupported fields and keep only the contract fields.'))
    }
  }
}

function readPlainText(value: unknown, path: string, issues: ValidationIssue[], label: string, allowLineBreaks = false): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    issues.push(issue(path, 'invalid_type', `${label} must be a non-empty string.`, 'Provide plain text.'))
    return undefined
  }
  const invalidText = allowLineBreaks ? PROSE_CONTROL_OR_TAG_PATTERN : CONTROL_OR_TAG_PATTERN
  if (invalidText.test(value)) {
    issues.push(issue(path, 'invalid_text', `${label} must be plain text without HTML or ${allowLineBreaks ? 'nonprinting ' : ''}control characters.`, allowLineBreaks
      ? 'Remove markup or hidden characters; CR/LF line breaks are allowed in prose.'
      : 'Remove markup or hidden characters, including line breaks.'))
    return undefined
  }
  return value.trim()
}

function readOptionalPlainText(value: unknown, path: string, issues: ValidationIssue[], label: string, allowLineBreaks = false): string | undefined {
  if (value === undefined) return undefined
  return readPlainText(value, path, issues, label, allowLineBreaks)
}

function readIsoDate(value: unknown, path: string, issues: ValidationIssue[], label: string): string | undefined {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    issues.push(issue(path, 'invalid_date', `${label} must use YYYY-MM-DD.`, 'Use a real calendar date such as 2026-09-14.'))
    return undefined
  }
  try {
    const rebuilt = buildTargetWeek(value).startDate
    if (rebuilt !== value) throw new Error('invalid')
  } catch {
    issues.push(issue(path, 'invalid_date', `${label} must be a real calendar date.`, 'Fix the month or day value.'))
    return undefined
  }
  return value
}

function readClockTime(value: unknown, path: string, issues: ValidationIssue[], label: string): string | undefined {
  if (typeof value !== 'string' || value.length !== 5 || !CLOCK_TIME_PATTERN.test(value)) {
    issues.push(issue(path, 'invalid_time', `${label} must use HH:mm.`, 'Use a 24-hour time such as 18:30.'))
    return undefined
  }
  return value
}

function readPositiveInteger(value: unknown, path: string, issues: ValidationIssue[], label: string): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    issues.push(issue(path, 'invalid_number', `${label} must be a positive integer.`, 'Use a whole number greater than zero.'))
    return undefined
  }
  return value
}

function readNonNegativeNumber(value: unknown, path: string, issues: ValidationIssue[], label: string): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    issues.push(issue(path, 'invalid_number', `${label} must be a non-negative number.`, 'Use a numeric value greater than or equal to zero.'))
    return undefined
  }
  return value
}

function readOptionalPositiveInteger(value: unknown, path: string, issues: ValidationIssue[], label: string): number | undefined {
  if (value === undefined) return undefined
  return readPositiveInteger(value, path, issues, label)
}

function readOptionalNonNegativeNumber(value: unknown, path: string, issues: ValidationIssue[], label: string): number | undefined {
  if (value === undefined) return undefined
  return readNonNegativeNumber(value, path, issues, label)
}

function validatePlainTextTree(value: unknown, path: string, issues: ValidationIssue[], allowLineBreaks = false): void {
  if (typeof value === 'string') readPlainText(value, path, issues, path, allowLineBreaks)
  else if (Array.isArray(value)) value.forEach((item, index) => validatePlainTextTree(item, joinPath(path, index), issues, allowLineBreaks))
  else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) validatePlainTextTree(item, joinPath(path, key), issues, MULTILINE_SHARED_FIELDS.has(key))
  }
}

function readSharedValue<T>(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  parse: (value: unknown, path: string) => T,
): T | undefined {
  validatePlainTextTree(value, path, issues)
  try {
    return parse(value, path)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid contract value.'
    const parts = /^([^:\s]+)(?::\s*|\s+)([\s\S]*)$/.exec(message)
    const nestedPath = parts?.[1]
    const hasNestedPath = nestedPath === path || nestedPath?.startsWith(`${path}.`) || nestedPath?.startsWith(`${path}[`)
    issues.push(issue(hasNestedPath ? nestedPath! : path, 'invalid_value', hasNestedPath ? parts![2]! : message))
    return undefined
  }
}

function validateTargetWeek(value: unknown, options: LocalValidationOptions, issues: ValidationIssue[]) {
  const path = 'targetWeek'
  if (!isRecord(value)) {
    issues.push(issue(path, 'invalid_type', 'targetWeek must be an object.', 'Use startDate, endDate, and dates.'))
    return undefined
  }
  validateKeys(value, ['startDate', 'endDate', 'dates'], [], path, issues)
  const startDate = readIsoDate(value.startDate, `${path}.startDate`, issues, 'targetWeek.startDate')
  const endDate = readIsoDate(value.endDate, `${path}.endDate`, issues, 'targetWeek.endDate')
  if (!Array.isArray(value.dates)) {
    issues.push(issue(`${path}.dates`, 'invalid_type', 'targetWeek.dates must be an array of seven dates.', 'List all seven target-week dates in order.'))
    return undefined
  }
  const dates = value.dates.map((item, index) => readIsoDate(item, `${path}.dates[${index}]`, issues, `targetWeek.dates[${index}]`))
  if (value.dates.length !== 7) {
    issues.push(issue(`${path}.dates`, 'invalid_length', 'targetWeek.dates must contain exactly seven dates.', 'Provide every day from the target week start through start+6 days.'))
  }
  if (!startDate || !endDate || dates.some(item => item === undefined)) return undefined
  const expected = buildTargetWeek(startDate)
  for (const [index, expectedDate] of expected.dates.entries()) {
    if (dates[index] !== expectedDate) {
      issues.push(issue(`${path}.dates[${index}]`, 'invalid_value', `Expected ${expectedDate} for this day of the target week.`, 'Keep the target week dates contiguous and unchanged.'))
    }
  }
  if (endDate !== expected.endDate) {
    issues.push(issue(`${path}.endDate`, 'invalid_value', `targetWeek.endDate must be ${expected.endDate}.`, 'Use the seventh target-week date as endDate.'))
  }
  if (options.expectedTargetWeekStartDate && startDate !== options.expectedTargetWeekStartDate) {
    issues.push(issue(`${path}.startDate`, 'mismatched_week', `Expected target week start ${options.expectedTargetWeekStartDate}.`, 'Paste a reply generated from the latest prompt for this week.'))
  }
  if (options.expectedTargetWeekDates) {
    for (const [index, expectedDate] of options.expectedTargetWeekDates.entries()) {
      if (dates[index] !== expectedDate) {
        issues.push(issue(`${path}.dates[${index}]`, 'mismatched_week', `Expected exact target date ${expectedDate}.`, 'Paste a reply that matches the current target week.'))
      }
    }
  }
  return expected
}

function validateFixedClubMetadata(value: unknown, path: string, issues: ValidationIssue[]): FixedClubWorkoutSource['fixedClub'] | undefined {
  if (!isRecord(value)) {
    issues.push(issue(path, 'invalid_type', 'source.fixedClub must be an object.', 'Include the exact fixed club session metadata.'))
    return undefined
  }
  validateKeys(value, ['sessionId', 'label', 'date', 'startTime', 'durationMin'], ['category', 'modality', 'notes'], path, issues)
  const sessionId = readPlainText(value.sessionId, `${path}.sessionId`, issues, 'source.fixedClub.sessionId')
  const label = readPlainText(value.label, `${path}.label`, issues, 'source.fixedClub.label')
  const date = readIsoDate(value.date, `${path}.date`, issues, 'source.fixedClub.date')
  const startTime = readClockTime(value.startTime, `${path}.startTime`, issues, 'source.fixedClub.startTime')
  const durationMin = readPositiveInteger(value.durationMin, `${path}.durationMin`, issues, 'source.fixedClub.durationMin')
  const category = value.category === undefined
    ? undefined
    : typeof value.category === 'string' && WORKOUT_CATEGORIES.includes(value.category as WorkoutCategory)
      ? value.category as WorkoutCategory
      : (issues.push(issue(`${path}.category`, 'invalid_value', `source.fixedClub.category must be one of ${WORKOUT_CATEGORIES.join(', ')}.`, 'Use aerobic, strength, or mobility when fixed category context is known.')), undefined)
  const modality = readOptionalPlainText(value.modality, `${path}.modality`, issues, 'source.fixedClub.modality')
  const notes = readOptionalPlainText(value.notes, `${path}.notes`, issues, 'source.fixedClub.notes', true)
  if (!sessionId || !label || !date || !startTime || !durationMin) return undefined
  return {
    sessionId,
    label,
    date,
    startTime,
    durationMin,
    ...(category === undefined ? {} : { category }),
    ...(modality === undefined ? {} : { modality }),
    ...(notes === undefined ? {} : { notes }),
  }
}

function validateWorkoutSource(value: unknown, path: string, issues: ValidationIssue[]): WorkoutSource | undefined {
  if (!isRecord(value)) {
    issues.push(issue(path, 'invalid_type', 'source must be an object.', 'Use source.kind and fixed club metadata when needed.'))
    return undefined
  }
  const kind = value.kind
  if (kind === 'ai') {
    validateKeys(value, ['kind'], [], path, issues)
    return { kind: 'ai' }
  }
  if (kind === 'fixed_club') {
    validateKeys(value, ['kind', 'fixedClub'], [], path, issues)
    const fixedClub = validateFixedClubMetadata(value.fixedClub, `${path}.fixedClub`, issues)
    if (!fixedClub) return undefined
    return { kind: 'fixed_club', fixedClub }
  }
  issues.push(issue(`${path}.kind`, 'invalid_value', 'source.kind must be "ai" or "fixed_club".', 'Use "ai" for authored workouts or "fixed_club" for fixed sessions.'))
  return undefined
}

function validateWorkoutStep(value: unknown, path: string, issues: ValidationIssue[], version: 1 | 2): WorkoutStepContract | undefined {
  if (!isRecord(value)) {
    issues.push(issue(path, 'invalid_type', 'Each workout step must be an object.', 'Use the structured step fields only.'))
    return undefined
  }
  validateKeys(
    value,
    ['id', 'instruction', ...(version === 2 ? ['estimatedTotalMin'] : [])],
    ['purpose', 'sets', 'reps', 'loadKg', 'distanceMeters', 'durationMin', 'pace', 'effort', 'restSeconds', 'modality', 'notes', ...(version === 2 ? ['loadBasis', 'repBasis'] : [])],
    path,
    issues,
  )
  const id = readPlainText(value.id, `${path}.id`, issues, `${path}.id`)
  const instruction = readPlainText(value.instruction, `${path}.instruction`, issues, `${path}.instruction`, true)
  const purpose = readOptionalPlainText(value.purpose, `${path}.purpose`, issues, `${path}.purpose`, true)
  const sets = readOptionalPositiveInteger(value.sets, `${path}.sets`, issues, `${path}.sets`)
  const reps = readOptionalPositiveInteger(value.reps, `${path}.reps`, issues, `${path}.reps`)
  const loadKg = readOptionalNonNegativeNumber(value.loadKg, `${path}.loadKg`, issues, `${path}.loadKg`)
  const loadBasis = version === 2 && value.loadBasis !== undefined
    ? readSharedValue(value.loadBasis, `${path}.loadBasis`, issues, parseLoadBasis)
    : undefined
  const repBasis = version === 2 && value.repBasis !== undefined
    ? readSharedValue(value.repBasis, `${path}.repBasis`, issues, parseRepBasis)
    : undefined
  let estimatedTotalMin: number | undefined
  if (version === 2) {
    if (typeof value.estimatedTotalMin === 'number' && Number.isFinite(value.estimatedTotalMin) && value.estimatedTotalMin >= 0.1 && value.estimatedTotalMin <= 1440) {
      estimatedTotalMin = value.estimatedTotalMin
    } else if (value.estimatedTotalMin !== undefined) {
      issues.push(issue(`${path}.estimatedTotalMin`, 'invalid_number', 'estimatedTotalMin must be a number between 0.1 and 1440 minutes.', 'Estimate total work, rest, and transition time for the whole block.'))
    }
    if (value.loadKg !== undefined && value.loadBasis === undefined) {
      issues.push(issue(`${path}.loadBasis`, 'missing_field', 'A prescribed loadKg requires an explicit loadBasis in v2.', 'Use total, per_implement, added, or assistance.'))
    }
  }
  const distanceMeters = readOptionalPositiveInteger(value.distanceMeters, `${path}.distanceMeters`, issues, `${path}.distanceMeters`)
  const durationMin = readOptionalPositiveInteger(value.durationMin, `${path}.durationMin`, issues, `${path}.durationMin`)
  const pace = readOptionalPlainText(value.pace, `${path}.pace`, issues, `${path}.pace`)
  const effort = readOptionalPlainText(value.effort, `${path}.effort`, issues, `${path}.effort`)
  const restSeconds = readOptionalPositiveInteger(value.restSeconds, `${path}.restSeconds`, issues, `${path}.restSeconds`)
  const modality = readOptionalPlainText(value.modality, `${path}.modality`, issues, `${path}.modality`)
  const notes = readOptionalPlainText(value.notes, `${path}.notes`, issues, `${path}.notes`, true)
  if (!id || !instruction) return undefined
  return {
    id,
    instruction,
    ...(purpose === undefined ? {} : { purpose }),
    ...(sets === undefined ? {} : { sets }),
    ...(reps === undefined ? {} : { reps }),
    ...(loadKg === undefined ? {} : { loadKg }),
    ...(loadBasis === undefined ? {} : { loadBasis }),
    ...(repBasis === undefined ? {} : { repBasis }),
    ...(estimatedTotalMin === undefined ? {} : { estimatedTotalMin }),
    ...(distanceMeters === undefined ? {} : { distanceMeters }),
    ...(durationMin === undefined ? {} : { durationMin }),
    ...(pace === undefined ? {} : { pace }),
    ...(effort === undefined ? {} : { effort }),
    ...(restSeconds === undefined ? {} : { restSeconds }),
    ...(modality === undefined ? {} : { modality }),
    ...(notes === undefined ? {} : { notes }),
  }
}

function validateWorkoutStepList(value: unknown, path: string, issues: ValidationIssue[], minimum: number, version: 1 | 2): readonly WorkoutStepContract[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue(path, 'invalid_type', `${path} must be an array of workout steps.`, 'Provide structured workout steps in order.'))
    return undefined
  }
  if (value.length < minimum) {
    issues.push(issue(path, 'invalid_length', `${path} must contain at least ${minimum} structured step${minimum === 1 ? '' : 's'}.`, 'Add the missing workout steps.'))
  }
  const steps = value.map((item, index) => validateWorkoutStep(item, `${path}[${index}]`, issues, version))
  return steps.every((item): item is WorkoutStepContract => item !== undefined) ? steps : undefined
}

function validateWorkout(value: unknown, index: number, targetWeekDates: ReadonlySet<string>, issues: ValidationIssue[], version: 1 | 2): PlannedWorkout | undefined {
  const path = `workouts[${index}]`
  if (!isRecord(value)) {
    issues.push(issue(path, 'invalid_type', 'Each workout must be an object.', 'Use the workout contract fields only.'))
    return undefined
  }
  validateKeys(
    value,
    ['id', 'date', 'startTime', 'category', 'title', 'purpose', 'expectedDuration', 'warmup', 'main', 'cooldown', 'source'],
    ['modality', 'notes'],
    path,
    issues,
  )
  const id = readPlainText(value.id, `${path}.id`, issues, 'workouts[].id')
  const date = readIsoDate(value.date, `${path}.date`, issues, 'workouts[].date')
  const startTime = readClockTime(value.startTime, `${path}.startTime`, issues, 'workouts[].startTime')
  let category: WorkoutCategory | undefined
  if (typeof value.category !== 'string' || !WORKOUT_CATEGORIES.includes(value.category as WorkoutCategory)) {
    issues.push(issue(`${path}.category`, 'invalid_value', `workouts[].category must be one of ${WORKOUT_CATEGORIES.join(', ')}.`, 'Replace the category with aerobic, strength, or mobility.'))
  } else category = value.category as WorkoutCategory
  const modality = readOptionalPlainText(value.modality, `${path}.modality`, issues, 'workouts[].modality')
  const title = readPlainText(value.title, `${path}.title`, issues, 'workouts[].title')
  const purpose = readPlainText(value.purpose, `${path}.purpose`, issues, 'workouts[].purpose', true)
  const expectedDuration = readPositiveInteger(value.expectedDuration, `${path}.expectedDuration`, issues, 'workouts[].expectedDuration')
  const source = validateWorkoutSource(value.source, `${path}.source`, issues)
  const warmup = validateWorkoutStepList(value.warmup, `${path}.warmup`, issues, source?.kind === 'ai' ? 1 : 0, version)
  const main = validateWorkoutStepList(value.main, `${path}.main`, issues, 1, version)
  const cooldown = validateWorkoutStepList(value.cooldown, `${path}.cooldown`, issues, 0, version)
  const notes = readOptionalPlainText(value.notes, `${path}.notes`, issues, 'workouts[].notes', true)
  if (date && !targetWeekDates.has(date)) {
    issues.push(issue(`${path}.date`, 'mismatched_week', 'Workout date must be inside the exact target week.', 'Use one of the seven targetWeek.dates values.'))
  }
  if (category === 'aerobic' && modality === undefined) {
    issues.push(issue(`${path}.modality`, 'missing_field', 'Aerobic workouts must include a modality field.', 'Use a modality such as running, cycling, swimming, rowing, or ski-erg.'))
  }
  if (source?.kind === 'fixed_club') {
    if (date && date !== source.fixedClub.date) {
      issues.push(issue(`${path}.date`, 'invalid_value', 'A fixed club workout date must match source.fixedClub.date exactly.', 'Keep the fixed club session on its recorded date.'))
    }
    if (startTime && startTime !== source.fixedClub.startTime) {
      issues.push(issue(`${path}.startTime`, 'invalid_value', 'A fixed club workout startTime must match source.fixedClub.startTime exactly.', 'Keep the fixed club session start time unchanged.'))
    }
    if (expectedDuration && expectedDuration !== source.fixedClub.durationMin) {
      issues.push(issue(`${path}.expectedDuration`, 'invalid_value', 'A fixed club workout expectedDuration must match source.fixedClub.durationMin exactly.', 'Keep the fixed club session duration unchanged.'))
    }
    if (title && title !== source.fixedClub.label) {
      issues.push(issue(`${path}.title`, 'invalid_value', 'A fixed club workout title must match source.fixedClub.label exactly.', 'Keep the fixed club session label unchanged.'))
    }
    for (const [field, actual] of [['category', category], ['modality', modality], ['notes', notes]] as const) {
      const expected = source.fixedClub[field]
      if (expected !== undefined && actual !== expected && (version === 2 || actual !== undefined)) {
        issues.push(issue(`${path}.${field}`, 'mismatched_fixed_club', `A fixed club workout ${field} must preserve source.fixedClub.${field}.`, 'Keep supplied club context unchanged in both the workout and its source metadata.'))
      }
    }
  }
  if (!id || !date || !startTime || !category || !title || !purpose || !expectedDuration || !source || !warmup || !main || !cooldown) {
    return undefined
  }
  return {
    id,
    date,
    startTime,
    category,
    ...(modality === undefined ? {} : { modality }),
    title,
    purpose,
    expectedDuration,
    warmup,
    main,
    cooldown,
    source,
    ...(notes === undefined ? {} : { notes }),
  }
}

function validateFixedClubCoverage(workouts: readonly PlannedWorkout[], options: LocalValidationOptions, issues: ValidationIssue[], version: 1 | 2): void {
  if (!options.expectedFixedClubSessions) return
  const expected = normalizeFixedClubSessions(options.expectedFixedClubSessions)
  const expectedById = new Map(expected.map(session => [session.sessionId, session]))
  const fixedWorkouts = workouts.filter((workout): workout is PlannedWorkout & { source: FixedClubWorkoutSource } =>
    workout.source.kind === 'fixed_club')

  for (const session of expected) {
    const matches = fixedWorkouts.filter(workout => workout.source.fixedClub.sessionId === session.sessionId)
    if (matches.length === 0) {
      issues.push(issue(`workouts`, 'missing_fixed_club', `Missing fixed club workout for session "${session.sessionId}".`, 'Return the fixed club session as a workout with source.kind "fixed_club".'))
      continue
    }
    if (matches.length > 1) {
      issues.push(issue(`workouts`, 'duplicate_fixed_club', `Fixed club session "${session.sessionId}" appears more than once.`, 'Keep exactly one fixed workout entry per fixed club session.'))
    }
    const [workout] = matches
    if (!workout) continue
    if (workout.source.fixedClub.label !== session.label) {
      issues.push(issue(`workouts`, 'mismatched_fixed_club', `Fixed club session "${session.sessionId}" label does not match the expected input.`, 'Keep the original fixed club label unchanged.'))
    }
    if (workout.source.fixedClub.date !== session.date) {
      issues.push(issue(`workouts`, 'mismatched_fixed_club', `Fixed club session "${session.sessionId}" date does not match the expected input.`, 'Keep the original fixed club date unchanged.'))
    }
    if (workout.source.fixedClub.startTime !== session.startTime) {
      issues.push(issue(`workouts`, 'mismatched_fixed_club', `Fixed club session "${session.sessionId}" start time does not match the expected input.`, 'Keep the original fixed club start time unchanged.'))
    }
    if (workout.source.fixedClub.durationMin !== session.durationMin) {
      issues.push(issue(`workouts`, 'mismatched_fixed_club', `Fixed club session "${session.sessionId}" duration does not match the expected input.`, 'Keep the original fixed club duration unchanged.'))
    }
    for (const field of ['category', 'modality', 'notes'] as const) {
      const sourceValue = workout.source.fixedClub[field]
      const sourceMismatch = sourceValue !== session[field] && (version === 2 || sourceValue !== undefined)
      const workoutMismatch = version === 1 && session[field] !== undefined && workout[field] !== undefined && workout[field] !== session[field]
      if (sourceMismatch || workoutMismatch) {
        issues.push(issue('workouts', 'mismatched_fixed_club', `Fixed club session "${session.sessionId}" ${field} does not match the expected input.`, version === 2
          ? 'Preserve supplied fixed club context without adding or removing details.'
          : 'Omitted optional legacy context is allowed, but supplied values must not conflict with the recorded club session.'))
      }
    }
  }

  for (const workout of fixedWorkouts) {
    if (!expectedById.has(workout.source.fixedClub.sessionId)) {
      issues.push(issue('workouts', 'unexpected_fixed_club', `Unexpected fixed club workout "${workout.source.fixedClub.sessionId}".`, 'Do not invent extra fixed club sessions.'))
    }
  }
}

function parseIssuePath(value: unknown): string {
  if (Array.isArray(value)) {
    return value.reduce((path, part) => joinPath(path, typeof part === 'number' ? part : String(part)), '')
  }
  return typeof value === 'string' && value ? value : 'domain'
}

function normalizeIssueEntry(value: unknown): ValidationIssue[] {
  if (typeof value === 'string') return [issue('domain', 'domain_validation', value)]
  if (value instanceof Error) return [issue('domain', 'domain_validation', value.message)]
  if (Array.isArray(value)) return value.flatMap(normalizeIssueEntry)
  if (!isRecord(value)) return [issue('domain', 'domain_validation', 'Domain validation failed.')]
  const path = parseIssuePath(value.path)
  const message = typeof value.message === 'string' && value.message
    ? value.message
    : typeof value.reason === 'string' && value.reason ? value.reason : 'Domain validation failed.'
  const code = typeof value.code === 'string' && value.code ? value.code : 'domain_validation'
  const suggestion = typeof value.suggestion === 'string' && value.suggestion ? value.suggestion : undefined
  return [issue(path, code, message, suggestion)]
}

function normalizeValidatorFailure(value: unknown): ValidationIssue[] {
  if (isRecord(value)) {
    if (Array.isArray(value.issues)) return value.issues.flatMap(normalizeIssueEntry)
    if (Array.isArray(value.errors)) return value.errors.flatMap(normalizeIssueEntry)
    if (typeof value.message === 'string' && value.message) return [issue('domain', 'domain_validation', value.message)]
  }
  return normalizeIssueEntry(value)
}

function runValidator<T>(contract: AiWeekCopyPasteContract, validator: DomainValidatorLike<T>): ParsePastedPlanResult<T> | undefined {
  try {
    if (typeof validator === 'function') return normalizeValidatorResult(contract, validator(contract))
    if (typeof validator.parse === 'function') {
      return { ok: true, contract, data: validator.parse(contract), issues: [], formattedIssues: '' }
    }
    if (typeof validator.safeParse === 'function') return normalizeValidatorResult(contract, validator.safeParse(contract))
    if (typeof validator.validate === 'function') return normalizeValidatorResult(contract, validator.validate(contract))
  } catch (error) {
    const issues = normalizeValidatorFailure(error)
    return { ok: false, issues, formattedIssues: formatValidationIssues(issues) }
  }
  return undefined
}

function normalizeValidatorResult<T>(contract: AiWeekCopyPasteContract, result: unknown): ParsePastedPlanResult<T> {
  if (result === undefined || result === true) {
    return { ok: true, contract, data: contract as T, issues: [], formattedIssues: '' }
  }
  if (result === false) {
    const issues = [issue('domain', 'domain_validation', 'Domain validation returned false.', 'Inspect the domain-specific rules and try again.')]
    return { ok: false, issues, formattedIssues: formatValidationIssues(issues) }
  }
  if (Array.isArray(result)) {
    const issues = result.flatMap(normalizeIssueEntry)
    return issues.length
      ? { ok: false, issues, formattedIssues: formatValidationIssues(issues) }
      : { ok: true, contract, data: contract as T, issues: [], formattedIssues: '' }
  }
  if (isRecord(result)) {
    if (result.success === true || result.ok === true) {
      const data = (result.data ?? result.value ?? contract) as T
      return { ok: true, contract, data, issues: [], formattedIssues: '' }
    }
    if (result.success === false || result.ok === false || Array.isArray(result.issues) || Array.isArray(result.errors)) {
      const issues = normalizeValidatorFailure(result)
      return { ok: false, issues, formattedIssues: formatValidationIssues(issues) }
    }
    if (Object.hasOwn(result, 'data') || Object.hasOwn(result, 'value')) {
      return { ok: true, contract, data: (result.data ?? result.value) as T, issues: [], formattedIssues: '' }
    }
  }
  return { ok: true, contract, data: result as T, issues: [], formattedIssues: '' }
}

export function formatValidationIssue(value: ValidationIssue): string {
  return `${value.path}: ${value.message}${value.suggestion ? ` Fix: ${value.suggestion}` : ''}`
}

export function formatValidationIssues(values: readonly ValidationIssue[]): string {
  return values.map(item => `- ${formatValidationIssue(item)}`).join('\n')
}

function readContract(value: unknown, options: LocalValidationOptions, issues: ValidationIssue[]): AiWeekCopyPasteContract | undefined {
  if (!isRecord(value)) {
    issues.push(issue('root', 'invalid_type', 'The pasted reply must be a JSON object.', 'Paste only the final JSON object.'))
    return undefined
  }
  const version = value.version === 1 ? 1 : value.version === AI_COPY_PASTE_VERSION ? 2 : undefined
  validateKeys(
    value,
    ['format', 'version', 'weekType', 'targetWeek', 'summary', 'workouts', ...(version === 2 ? ['goalAssessment'] : [])],
    version === 2 ? ['athleteContext'] : [],
    '',
    issues,
  )
  if (value.format !== AI_COPY_PASTE_FORMAT) {
    issues.push(issue('format', 'invalid_value', `format must be "${AI_COPY_PASTE_FORMAT}".`, 'Paste a reply produced from the Hybrid Coach contract.'))
  }
  if (version === undefined) {
    issues.push(issue('version', 'invalid_value', 'version must be 1 or 2.', 'Use version 2 for new plans; existing version 1 plans remain importable.'))
  }
  const weekType = value.weekType === 'initial' || value.weekType === 'continuation' ? value.weekType : undefined
  if (weekType === undefined) {
    issues.push(issue('weekType', 'invalid_value', 'weekType must be "initial" or "continuation".', 'Return the same weekType shown in the prompt.'))
  } else if (options.expectedWeekType && weekType !== options.expectedWeekType) {
    issues.push(issue('weekType', 'mismatched_week', `Expected weekType "${options.expectedWeekType}".`, 'Paste a reply for the current planning flow.'))
  }
  const targetWeek = validateTargetWeek(value.targetWeek, options, issues)
  const summary = readPlainText(value.summary, 'summary', issues, 'summary', true)
  const goalAssessment = version === 2
    ? readSharedValue(value.goalAssessment, 'goalAssessment', issues, parseGoalAssessment)
    : undefined
  const athleteContext = version === 2 && value.athleteContext !== undefined
    ? readSharedValue(value.athleteContext, 'athleteContext', issues, parsePlanningContext)
    : undefined
  if (!Array.isArray(value.workouts)) {
    issues.push(issue('workouts', 'invalid_type', 'workouts must be an array.', 'Provide at least one planned workout.'))
  } else if (value.workouts.length === 0) {
    issues.push(issue('workouts', 'invalid_length', 'AI proposals must contain at least one workout.', 'Provide a non-empty proposal; empty manual weeks are managed in the planner.'))
  }
  const targetWeekDates = new Set(targetWeek?.dates ?? [])
  const workouts = Array.isArray(value.workouts)
    ? value.workouts.map((item, index) => validateWorkout(item, index, targetWeekDates, issues, version ?? 1))
    : []
  const validWorkouts = workouts.filter((item): item is PlannedWorkout => item !== undefined)
  if (Array.isArray(value.workouts)) {
    validateFixedClubCoverage(validWorkouts, options, issues, version ?? 1)
  }
  if (issues.length > 0 || !version || !weekType || !targetWeek || !summary) return undefined
  const base = {
    format: AI_COPY_PASTE_FORMAT,
    weekType,
    targetWeek,
    summary,
    workouts: validWorkouts,
  } as const
  if (version === 1) return { ...base, version: 1 }
  if (!goalAssessment) return undefined
  return { ...base, version: 2, goalAssessment, ...(athleteContext === undefined ? {} : { athleteContext }) }
}

export function validatePastedPlan(value: unknown, options: LocalValidationOptions = {}): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = []
  readContract(value, options, issues)
  return issues
}

export function parseAndValidatePastedPlan<T = AiWeekCopyPasteContract>(
  content: string,
  options: ParsePastedPlanOptions<T> = {},
): ParsePastedPlanResult<T> {
  if (typeof content !== 'string' || !content.trim()) {
    const issues = [issue('root', 'invalid_type', 'Paste the final JSON reply as text.', 'Copy the JSON object from the AI reply and paste it here.')]
    return { ok: false, issues, formattedIssues: formatValidationIssues(issues) }
  }
  const json = extractJson(content)
  try {
    rejectRepeatedKeys(json)
  } catch (error) {
    const issues = normalizeValidatorFailure(error)
    return { ok: false, issues, formattedIssues: formatValidationIssues(issues) }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    const issues = [issue('root', 'invalid_json', 'The pasted reply is not valid JSON.', 'Paste only the final JSON object, without commentary.')]
    return { ok: false, issues, formattedIssues: formatValidationIssues(issues) }
  }
  const issues: ValidationIssue[] = []
  const contract = readContract(parsed, {
    expectedWeekType: options.expectedWeekType,
    expectedTargetWeekStartDate: options.expectedTargetWeekStartDate,
    expectedTargetWeekDates: options.expectedTargetWeekDates,
    expectedFixedClubSessions: options.expectedFixedClubSessions,
  }, issues)
  if (!contract || issues.length > 0) return { ok: false, issues, formattedIssues: formatValidationIssues(issues) }
  let data: T = contract as T
  for (const validator of collectDomainValidators(options)) {
    const result = runValidator(contract, validator)
    if (!result) continue
    if (!result.ok) return result
    data = result.data
  }
  return { ok: true, contract, data, issues: [], formattedIssues: '' }
}

export function createPastedPlanAdapter<T = AiWeekCopyPasteContract>(defaults: ParsePastedPlanOptions<T> = {}) {
  return (content: string, options: ParsePastedPlanOptions<T> = {}) => {
    const merged: ParsePastedPlanOptions<T> = {
      ...defaults,
      ...options,
      expectedFixedClubSessions: options.expectedFixedClubSessions ?? defaults.expectedFixedClubSessions,
      domainValidator: options.domainValidator ?? defaults.domainValidator,
      domainValidators: options.domainValidators ?? defaults.domainValidators,
    }
    return parseAndValidatePastedPlan<T>(content, merged)
  }
}
