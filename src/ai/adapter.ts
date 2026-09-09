import { AI_COPY_PASTE_FORMAT, AI_COPY_PASTE_VERSION, WORKOUT_CATEGORIES, buildTargetWeek, normalizeFixedClubSessions } from './contract.ts'
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

function readPlainText(value: unknown, path: string, issues: ValidationIssue[], label: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    issues.push(issue(path, 'invalid_type', `${label} must be a non-empty string.`, 'Provide plain text.'))
    return undefined
  }
  if (CONTROL_OR_TAG_PATTERN.test(value)) {
    issues.push(issue(path, 'invalid_text', `${label} must be plain text without HTML or control characters.`, 'Remove markup or hidden characters.'))
    return undefined
  }
  return value.trim()
}

function readOptionalPlainText(value: unknown, path: string, issues: ValidationIssue[], label: string): string | undefined {
  if (value === undefined) return undefined
  return readPlainText(value, path, issues, label)
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
  if (typeof value !== 'string' || !CLOCK_TIME_PATTERN.test(value)) {
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
  const notes = readOptionalPlainText(value.notes, `${path}.notes`, issues, 'source.fixedClub.notes')
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

function validateWorkoutStep(value: unknown, path: string, issues: ValidationIssue[]): WorkoutStepContract | undefined {
  if (!isRecord(value)) {
    issues.push(issue(path, 'invalid_type', 'Each workout step must be an object.', 'Use the structured step fields only.'))
    return undefined
  }
  validateKeys(
    value,
    ['id', 'instruction'],
    ['purpose', 'sets', 'reps', 'loadKg', 'distanceMeters', 'durationMin', 'pace', 'effort', 'restSeconds', 'modality', 'notes'],
    path,
    issues,
  )
  const id = readPlainText(value.id, `${path}.id`, issues, `${path}.id`)
  const instruction = readPlainText(value.instruction, `${path}.instruction`, issues, `${path}.instruction`)
  const purpose = readOptionalPlainText(value.purpose, `${path}.purpose`, issues, `${path}.purpose`)
  const sets = readOptionalPositiveInteger(value.sets, `${path}.sets`, issues, `${path}.sets`)
  const reps = readOptionalPositiveInteger(value.reps, `${path}.reps`, issues, `${path}.reps`)
  const loadKg = readOptionalNonNegativeNumber(value.loadKg, `${path}.loadKg`, issues, `${path}.loadKg`)
  const distanceMeters = readOptionalPositiveInteger(value.distanceMeters, `${path}.distanceMeters`, issues, `${path}.distanceMeters`)
  const durationMin = readOptionalPositiveInteger(value.durationMin, `${path}.durationMin`, issues, `${path}.durationMin`)
  const pace = readOptionalPlainText(value.pace, `${path}.pace`, issues, `${path}.pace`)
  const effort = readOptionalPlainText(value.effort, `${path}.effort`, issues, `${path}.effort`)
  const restSeconds = readOptionalPositiveInteger(value.restSeconds, `${path}.restSeconds`, issues, `${path}.restSeconds`)
  const modality = readOptionalPlainText(value.modality, `${path}.modality`, issues, `${path}.modality`)
  const notes = readOptionalPlainText(value.notes, `${path}.notes`, issues, `${path}.notes`)
  if (!id || !instruction) return undefined
  return {
    id,
    instruction,
    ...(purpose === undefined ? {} : { purpose }),
    ...(sets === undefined ? {} : { sets }),
    ...(reps === undefined ? {} : { reps }),
    ...(loadKg === undefined ? {} : { loadKg }),
    ...(distanceMeters === undefined ? {} : { distanceMeters }),
    ...(durationMin === undefined ? {} : { durationMin }),
    ...(pace === undefined ? {} : { pace }),
    ...(effort === undefined ? {} : { effort }),
    ...(restSeconds === undefined ? {} : { restSeconds }),
    ...(modality === undefined ? {} : { modality }),
    ...(notes === undefined ? {} : { notes }),
  }
}

function validateWorkoutStepList(value: unknown, path: string, issues: ValidationIssue[], minimum: number): readonly WorkoutStepContract[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue(path, 'invalid_type', `${path} must be an array of workout steps.`, 'Provide structured workout steps in order.'))
    return undefined
  }
  if (value.length < minimum) {
    issues.push(issue(path, 'invalid_length', `${path} must contain at least ${minimum} structured step${minimum === 1 ? '' : 's'}.`, 'Add the missing workout steps.'))
  }
  const steps = value.map((item, index) => validateWorkoutStep(item, `${path}[${index}]`, issues))
  if (steps.some(item => item === undefined)) return undefined
  return steps as readonly WorkoutStepContract[]
}

function validateWorkout(value: unknown, index: number, targetWeekDates: ReadonlySet<string>, issues: ValidationIssue[]): PlannedWorkout | undefined {
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
  const purpose = readPlainText(value.purpose, `${path}.purpose`, issues, 'workouts[].purpose')
  const expectedDuration = readPositiveInteger(value.expectedDuration, `${path}.expectedDuration`, issues, 'workouts[].expectedDuration')
  const source = validateWorkoutSource(value.source, `${path}.source`, issues)
  const warmup = validateWorkoutStepList(value.warmup, `${path}.warmup`, issues, source?.kind === 'ai' ? 1 : 0)
  const main = validateWorkoutStepList(value.main, `${path}.main`, issues, 1)
  const cooldown = validateWorkoutStepList(value.cooldown, `${path}.cooldown`, issues, 0)
  const notes = readOptionalPlainText(value.notes, `${path}.notes`, issues, 'workouts[].notes')
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

function validateFixedClubCoverage(workouts: readonly PlannedWorkout[], options: LocalValidationOptions, issues: ValidationIssue[]): void {
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

export function validatePastedPlan(value: unknown, options: LocalValidationOptions = {}): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!isRecord(value)) {
    return [issue('root', 'invalid_type', 'The pasted reply must be a JSON object.', 'Paste only the final JSON object.')]
  }
  validateKeys(value, ['format', 'version', 'weekType', 'targetWeek', 'summary', 'workouts'], [], '', issues)
  if (value.format !== AI_COPY_PASTE_FORMAT) {
    issues.push(issue('format', 'invalid_value', `format must be "${AI_COPY_PASTE_FORMAT}".`, 'Paste a reply produced from the Hybrid Coach contract.'))
  }
  if (value.version !== AI_COPY_PASTE_VERSION) {
    issues.push(issue('version', 'invalid_value', `version must be ${AI_COPY_PASTE_VERSION}.`, 'Use the current copy/paste contract version.'))
  }
  if (typeof value.weekType !== 'string' || !['initial', 'continuation'].includes(value.weekType)) {
    issues.push(issue('weekType', 'invalid_value', 'weekType must be "initial" or "continuation".', 'Return the same weekType shown in the prompt.'))
  } else if (options.expectedWeekType && value.weekType !== options.expectedWeekType) {
    issues.push(issue('weekType', 'mismatched_week', `Expected weekType "${options.expectedWeekType}".`, 'Paste a reply for the current planning flow.'))
  }
  const targetWeek = validateTargetWeek(value.targetWeek, options, issues)
  const summary = readPlainText(value.summary, 'summary', issues, 'summary')
  if (!Array.isArray(value.workouts)) {
    issues.push(issue('workouts', 'invalid_type', 'workouts must be an array.', 'Provide zero or more planned workouts.'))
  }
  const targetWeekDates = new Set(targetWeek?.dates ?? [])
  const workouts = Array.isArray(value.workouts)
    ? value.workouts.map((item, index) => validateWorkout(item, index, targetWeekDates, issues))
    : []
  if (Array.isArray(value.workouts)) {
    validateFixedClubCoverage(workouts.filter((item): item is PlannedWorkout => item !== undefined), options, issues)
  }
  if (Array.isArray(value.workouts) && workouts.some(item => item === undefined)) return issues
  if (!targetWeek || !summary || !Array.isArray(value.workouts)) return issues
  return issues
}

function cloneWorkoutStep(step: Record<string, unknown>): WorkoutStepContract {
  return {
    id: (step.id as string).trim(),
    instruction: (step.instruction as string).trim(),
    ...(step.purpose === undefined ? {} : { purpose: (step.purpose as string).trim() }),
    ...(step.sets === undefined ? {} : { sets: step.sets as number }),
    ...(step.reps === undefined ? {} : { reps: step.reps as number }),
    ...(step.loadKg === undefined ? {} : { loadKg: step.loadKg as number }),
    ...(step.distanceMeters === undefined ? {} : { distanceMeters: step.distanceMeters as number }),
    ...(step.durationMin === undefined ? {} : { durationMin: step.durationMin as number }),
    ...(step.pace === undefined ? {} : { pace: (step.pace as string).trim() }),
    ...(step.effort === undefined ? {} : { effort: (step.effort as string).trim() }),
    ...(step.restSeconds === undefined ? {} : { restSeconds: step.restSeconds as number }),
    ...(step.modality === undefined ? {} : { modality: (step.modality as string).trim() }),
    ...(step.notes === undefined ? {} : { notes: (step.notes as string).trim() }),
  }
}

function toContract(value: Record<string, unknown>): AiWeekCopyPasteContract {
  const targetWeek = value.targetWeek as Record<string, unknown>
  const workouts = value.workouts as Array<Record<string, unknown>>
  return {
    format: AI_COPY_PASTE_FORMAT,
    version: AI_COPY_PASTE_VERSION,
    weekType: value.weekType as WeekPromptKind,
    targetWeek: {
      startDate: targetWeek.startDate as string,
      endDate: targetWeek.endDate as string,
      dates: [...(targetWeek.dates as string[])],
    },
    summary: (value.summary as string).trim(),
    workouts: workouts.map(workout => {
      const sourceRecord = workout.source as Record<string, unknown>
      const fixedClub = sourceRecord.fixedClub as Record<string, unknown> | undefined
      return {
        id: (workout.id as string).trim(),
        date: workout.date as string,
        startTime: workout.startTime as string,
        category: workout.category as WorkoutCategory,
        ...(workout.modality === undefined ? {} : { modality: (workout.modality as string).trim() }),
        title: (workout.title as string).trim(),
        purpose: (workout.purpose as string).trim(),
        expectedDuration: workout.expectedDuration as number,
        warmup: (workout.warmup as Array<Record<string, unknown>>).map(cloneWorkoutStep),
        main: (workout.main as Array<Record<string, unknown>>).map(cloneWorkoutStep),
        cooldown: (workout.cooldown as Array<Record<string, unknown>>).map(cloneWorkoutStep),
        source: sourceRecord.kind === 'fixed_club'
          ? {
            kind: 'fixed_club' as const,
            fixedClub: {
              sessionId: (fixedClub!.sessionId as string).trim(),
              label: (fixedClub!.label as string).trim(),
              date: fixedClub!.date as string,
              startTime: fixedClub!.startTime as string,
              durationMin: fixedClub!.durationMin as number,
              ...(fixedClub!.category === undefined ? {} : { category: fixedClub!.category as WorkoutCategory }),
              ...(fixedClub!.modality === undefined ? {} : { modality: (fixedClub!.modality as string).trim() }),
              ...(fixedClub!.notes === undefined ? {} : { notes: (fixedClub!.notes as string).trim() }),
            },
          }
          : { kind: 'ai' as const },
        ...(workout.notes === undefined ? {} : { notes: (workout.notes as string).trim() }),
      }
    }),
  }
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
  const issues = validatePastedPlan(parsed, {
    expectedWeekType: options.expectedWeekType,
    expectedTargetWeekStartDate: options.expectedTargetWeekStartDate,
    expectedTargetWeekDates: options.expectedTargetWeekDates,
    expectedFixedClubSessions: options.expectedFixedClubSessions,
  })
  if (issues.length > 0) return { ok: false, issues, formattedIssues: formatValidationIssues(issues) }
  const contract = toContract(parsed as Record<string, unknown>)
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
