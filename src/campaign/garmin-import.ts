export type GarminUnits = 'metric' | 'imperial'
export type GarminActivityType =
  | 'running' | 'treadmill' | 'lifting' | 'cycling' | 'indoor_cycling'
  | 'walking' | 'hiking' | 'yoga' | 'pilates' | 'other'

export interface GarminActivity {
  source: 'garmin_csv'
  localTimestamp: string
  type: GarminActivityType
  durationMin: number
  distanceKm?: number
  averageHr?: number
  movingDurationMin?: number
  elapsedDurationMin?: number
}

export interface GarminImportResult {
  activities: GarminActivity[]
  duplicateCount: number
  warnings: string[]
}

export interface TrainingHistory {
  version: 1
  /** Source export units, not storage units: distances are always stored in kilometres. */
  units: GarminUnits
  activities: GarminActivity[]
  confirmed: boolean
}

export interface ActivityTotals {
  count: number
  durationMin: number
}

export interface TrainingHistoryWeek extends ActivityTotals {
  weekStart: string
  weekEnd: string
  dateRange: { start: string; end: string }
  partialPeriod: boolean
  byType: Partial<Record<GarminActivityType, ActivityTotals>>
}

export interface TrainingHistorySummary extends ActivityTotals {
  source: 'garmin_csv'
  units: GarminUnits
  asOfDate: string
  dateRange: { start: string; end: string }
  byType: Partial<Record<GarminActivityType, ActivityTotals>>
  weeks: TrainingHistoryWeek[]
  latestAgeDays: number
  stale: boolean
  coverage: 'recorded_activities_only'
  warnings: string[]
}

export const MAX_GARMIN_CSV_BYTES = 5 * 1024 * 1024
export const MAX_TRAINING_ACTIVITIES = 5000
const MAX_FIELD_LENGTH = 4096
const MAX_COLUMNS = 128
const MAX_DURATION_MIN = 7 * 24 * 60
const DAY_MS = 86_400_000
const ACTIVITY_TYPES: readonly GarminActivityType[] = [
  'running', 'treadmill', 'lifting', 'cycling', 'indoor_cycling',
  'walking', 'hiking', 'yoga', 'pilates', 'other',
]
const COVERAGE_WARNING = 'Only recorded activities are counted. Gaps and boundary weeks are not zero-activity weeks; completeness is unknown.'
const FACTS_WARNING = 'Activity totals do not establish effort, readiness, weights, exercise-level sets or completed plan sessions.'

function fail(context: string, message: string): never {
  throw new Error(`${context}: ${message}`)
}

function parseUnits(value: unknown): GarminUnits {
  if (value !== 'metric' && value !== 'imperial') fail('Units', 'choose metric or imperial to match the CSV export.')
  return value
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

function localTimestamp(value: string, context: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value)
  if (!match || !validDate(match[1]) || +match[2] > 23 || +match[3] > 59 || +match[4] > 59) {
    fail(context, 'Date must be a real YYYY-MM-DD HH:mm:ss local date/time, without a timezone.')
  }
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}`
}

interface CsvRow { cells: string[]; row: number }

function csvRows(text: string): CsvRow[] {
  if (typeof text !== 'string' || text.length > MAX_GARMIN_CSV_BYTES || new TextEncoder().encode(text).length > MAX_GARMIN_CSV_BYTES) {
    fail('CSV', 'the file must be UTF-8 text no larger than 5 MiB.')
  }
  text = text.replace(/^\uFEFF/, '')
  if (!text.length) fail('Row 1', 'the CSV is empty.')
  const rows: CsvRow[] = []
  let cells: string[] = []
  let field = ''
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start'
  let row = 1
  let pendingRow = false

  function finishField() {
    cells.push(field)
    if (cells.length > MAX_COLUMNS) fail(`Row ${row}`, 'too many columns (maximum 128).')
    field = ''
    state = 'start'
  }
  function finishRow() {
    finishField()
    rows.push({ cells, row })
    if (rows.length > MAX_TRAINING_ACTIVITIES + 1) fail(`Row ${row}`, 'too many activity rows (maximum 5000, including duplicates).')
    cells = []
    row++
    pendingRow = false
  }

  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    const code = char.charCodeAt(0)
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) fail(`Row ${row}`, 'unsupported control character.')
    pendingRow = true
    if (state === 'quoted') {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index++ }
        else state = 'closed'
      } else field += char
    } else if (char === ',') finishField()
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index++
      finishRow()
    } else if (state === 'closed') fail(`Row ${row}`, 'unexpected text after a closing quote.')
    else if (char === '"') {
      if (state !== 'start') fail(`Row ${row}`, 'a quote inside an unquoted field is not valid CSV.')
      state = 'quoted'
    } else { field += char; state = 'plain' }
    if (field.length > MAX_FIELD_LENGTH) fail(`Row ${row}`, 'a field is too long (maximum 4096 characters).')
  }
  if (state === 'quoted') fail(`Row ${row}`, 'unclosed quoted field.')
  if (pendingRow) finishRow()
  return rows
}

type Column = 'type' | 'date' | 'duration' | 'distance' | 'hr' | 'moving' | 'elapsed'
const HEADERS: Record<Column, readonly string[]> = {
  type: ['activity type', 'aktivitätstyp', 'aktivitätsart'],
  date: ['date', 'datum'],
  duration: ['time', 'duration', 'timer time', 'zeit', 'dauer', 'timer-zeit'],
  distance: ['distance', 'distanz', 'entfernung'],
  hr: ['avg hr', 'avg. hr', 'average heart rate', 'avg heart rate', 'ø herzfrequenz', 'durchschnittliche herzfrequenz'],
  moving: ['moving time', 'zeit in bewegung', 'bewegungszeit'],
  elapsed: ['elapsed time', 'verstrichene zeit'],
}
const normalize = (value: string) => value.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ')
const missing = (value: string) => value === '' || value === '--'

function readColumns(header: CsvRow): Partial<Record<Column, number>> {
  const columns: Partial<Record<Column, number>> = {}
  const seen = new Set<string>()
  header.cells.forEach((cell, index) => {
    if (!cell.trim() || cell.length > 128) fail('Row 1', 'column names must contain 1–128 characters.')
    const name = normalize(cell)
    if (seen.has(name)) fail('Row 1', 'duplicate column names are ambiguous.')
    seen.add(name)
    const column = (Object.keys(HEADERS) as Column[]).find(key => HEADERS[key].includes(name))
    if (column) {
      if (columns[column] !== undefined) fail('Row 1', `multiple ${column} columns are ambiguous.`)
      columns[column] = index
    }
  })
  for (const required of ['type', 'date', 'duration'] as const) {
    if (columns[required] === undefined) fail('Row 1', `missing required ${required} column. Use a German or English comma-delimited Garmin activities CSV, not XLS.`)
  }
  return columns
}

const TYPE_ALIASES: Record<GarminActivityType, readonly string[]> = {
  running: ['running', 'run', 'trail running', 'track running', 'virtual running', 'ultra running', 'laufen', 'lauf', 'trailrunning', 'trail-lauf', 'bahn-laufen', 'virtuelles laufen', 'ultralauf'],
  treadmill: ['treadmill running', 'treadmill', 'indoor running', 'laufband', 'laufbandtraining', 'laufband-laufen', 'indoor-laufen', 'laufen auf dem laufband'],
  lifting: ['strength training', 'strength', 'weight training', 'weightlifting', 'krafttraining', 'gewichtheben'],
  cycling: ['cycling', 'road cycling', 'road biking', 'mountain biking', 'gravel cycling', 'e-biking', 'radfahren', 'rennradfahren', 'rennrad', 'mountainbiken', 'gravel-radfahren', 'e-bike-fahren'],
  indoor_cycling: ['indoor cycling', 'virtual cycling', 'indoor biking', 'indoor-radfahren', 'indoor radfahren', 'virtuelles radfahren'],
  walking: ['walking', 'walk', 'indoor walking', 'gehen', 'walking', 'spazierengehen', 'indoor-gehen'],
  hiking: ['hiking', 'hike', 'mountaineering', 'wandern', 'bergsteigen'],
  yoga: ['yoga'],
  pilates: ['pilates'],
  other: ['other', 'others', 'sonstige', 'sonstiges', 'andere', 'cardio', 'fitness equipment', 'fitnessgeräte', 'swimming', 'schwimmen', 'pool swimming', 'schwimmbadschwimmen', 'open water swimming', 'freischwimmen', 'hiit', 'elliptical', 'crosstrainer', 'rowing', 'rudern'],
}

function classify(value: string, context: string): { type: GarminActivityType; unrecognized: boolean } {
  if (missing(value) || value.length > 80 || /[\r\n\t]/.test(value)) fail(context, 'Activity Type must contain 1–80 characters on one line.')
  const normalized = normalize(value)
  const type = ACTIVITY_TYPES.find(key => TYPE_ALIASES[key].includes(normalized))
  return { type: type ?? 'other', unrecognized: type === undefined }
}

function duration(value: string, context: string, required = false): number | undefined {
  if (missing(value)) {
    if (required) fail(context, 'timer duration is required; missing is not zero.')
    return undefined
  }
  const match = /^(?:(\d{1,3}):)?(\d{1,4}):(\d{2})(?:[.,](\d{1,6}))?$/.exec(value)
  if (!match || +match[3] > 59 || (match[1] !== undefined && +match[2] > 59)) {
    fail(context, 'duration must be H:MM:SS or MM:SS, optionally with fractional seconds.')
  }
  const minutes = (+match[1] || 0) * 60 + +match[2] + (+match[3] + +(match[4] ? `0.${match[4]}` : 0)) / 60
  if (minutes > MAX_DURATION_MIN || (required && minutes <= 0)) fail(context, 'duration is outside the supported range (positive timer time, at most 7 days).')
  return minutes
}

function numeric(value: string, context: string, max: number, min = 0): number | undefined {
  if (missing(value)) return undefined
  let normalized: string
  // With one separator it is decimal; grouping is supported only when both separators remove ambiguity.
  if (/^\d+(?:[.,]\d+)?$/.test(value)) normalized = value.replace(',', '.')
  else if (/^\d{1,3}(?:,\d{3})+\.\d+$/.test(value)) normalized = value.replace(/,/g, '')
  else if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(value)) normalized = value.replace(/\./g, '').replace(',', '.')
  else fail(context, 'expected a dot/comma decimal number without a unit suffix.')
  const result = Number(normalized)
  if (!Number.isFinite(result) || result < min || result > max) fail(context, 'number is outside the supported range.')
  return result
}

function identity(activity: GarminActivity): string {
  return `${activity.type}:${activity.localTimestamp}`
}

function facts(activity: GarminActivity): string {
  return JSON.stringify([
    activity.durationMin, activity.distanceKm, activity.averageHr,
    activity.movingDurationMin, activity.elapsedDurationMin,
  ])
}

function uniqueActivities(entries: { activity: GarminActivity; context: string }[], rejectDuplicates = false) {
  const seen = new Map<string, { activity: GarminActivity; context: string }>()
  let duplicateCount = 0
  for (const entry of entries) {
    const previous = seen.get(identity(entry.activity))
    if (previous) {
      if (facts(previous.activity) !== facts(entry.activity)) {
        fail(entry.context, `conflicting facts for the same activity type and local timestamp as ${previous.context}. Review the source records; nothing has been merged.`)
      }
      if (rejectDuplicates) fail(entry.context, `duplicate activity also present at ${previous.context}.`)
      duplicateCount++
    } else seen.set(identity(entry.activity), entry)
  }
  const activities = [...seen.values()].map(entry => entry.activity).sort((a, b) =>
    a.localTimestamp < b.localTimestamp ? -1 : a.localTimestamp > b.localTimestamp ? 1
      : a.type < b.type ? -1 : a.type > b.type ? 1 : 0)
  if (activities.length > MAX_TRAINING_ACTIVITIES) fail('History', 'too many activities (maximum 5000); no records were removed.')
  return { activities, duplicateCount }
}

/** All-or-nothing validation. Row numbers count logical CSV records, including the header. */
export function parseGarminCsv(text: string, units: GarminUnits): GarminImportResult {
  parseUnits(units)
  const rows = csvRows(text)
  const columns = readColumns(rows[0])
  if (rows.length < 2) fail('Row 2', 'at least one activity is required.')
  let unrecognizedCount = 0
  const entries = rows.slice(1).map(({ cells, row }) => {
    const context = `Row ${row}`
    if (cells.length !== rows[0].cells.length) fail(context, 'column count does not match the header; quote decimal commas and text containing commas.')
    const cell = (column: Column) => columns[column] === undefined ? '' : cells[columns[column]!].trim()
    const classification = classify(cell('type'), context)
    if (classification.unrecognized) unrecognizedCount++
    const activity: GarminActivity = {
      source: 'garmin_csv',
      localTimestamp: localTimestamp(cell('date'), context),
      type: classification.type,
      durationMin: duration(cell('duration'), `${context} timer time`, true)!,
    }
    const distance = numeric(cell('distance'), `${context} distance`, units === 'metric' ? 20_000 : 20_000 / 1.609344)
    const hr = numeric(cell('hr'), `${context} average heart rate`, 300, 1)
    const moving = duration(cell('moving'), `${context} moving time`)
    const elapsed = duration(cell('elapsed'), `${context} elapsed time`)
    if (distance !== undefined) activity.distanceKm = units === 'imperial' ? distance * 1.609344 : distance
    if (hr !== undefined) activity.averageHr = hr
    if (moving !== undefined) activity.movingDurationMin = moving
    if (elapsed !== undefined) activity.elapsedDurationMin = elapsed
    return { activity, context }
  })
  const { activities, duplicateCount } = uniqueActivities(entries)
  const warnings = [
    'Local timestamps have no timezone. Titles, locations and unused export fields are not retained.',
    'Distances use your selected export units; a lone dot or comma is a decimal separator.',
    'Timer time, moving time and elapsed time remain separate. Run pace is derived from timer time and distance; exported Pace/Speed columns are ignored.',
    COVERAGE_WARNING, FACTS_WARNING,
  ]
  if (unrecognizedCount) warnings.push(`${unrecognizedCount} row(s) have an unrecognized activity type and are classified as Other; review their inclusion.`)
  return { activities, duplicateCount, warnings }
}

function object(value: unknown, keys: readonly string[], context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    fail(context, 'expected a plain object.')
  }
  if (Object.keys(value).some(key => !keys.includes(key))) fail(context, 'unsupported fields are not allowed.')
  return value as Record<string, unknown>
}

function boundedNumber(value: unknown, context: string, max: number, min = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(context, 'expected a finite number in the supported range.')
  return value
}

function restoreActivity(value: unknown, context: string): GarminActivity {
  const item = object(value, ['source', 'localTimestamp', 'type', 'durationMin', 'distanceKm', 'averageHr', 'movingDurationMin', 'elapsedDurationMin'], context)
  if (item.source !== 'garmin_csv') fail(context, 'unsupported activity source.')
  if (typeof item.localTimestamp !== 'string' || item.localTimestamp.length !== 19 ||
      localTimestamp(item.localTimestamp, context) !== item.localTimestamp) fail(context, 'expected a canonical local timestamp (YYYY-MM-DDTHH:mm:ss).')
  if (!ACTIVITY_TYPES.includes(item.type as GarminActivityType)) fail(context, 'unsupported activity type.')
  const activity: GarminActivity = {
    source: 'garmin_csv', localTimestamp: item.localTimestamp, type: item.type as GarminActivityType,
    durationMin: boundedNumber(item.durationMin, `${context} timer time`, MAX_DURATION_MIN, Number.MIN_VALUE),
  }
  if (Object.hasOwn(item, 'distanceKm')) activity.distanceKm = boundedNumber(item.distanceKm, `${context} distance`, 20_000)
  if (Object.hasOwn(item, 'averageHr')) activity.averageHr = boundedNumber(item.averageHr, `${context} average heart rate`, 300, 1)
  if (Object.hasOwn(item, 'movingDurationMin')) activity.movingDurationMin = boundedNumber(item.movingDurationMin, `${context} moving time`, MAX_DURATION_MIN)
  if (Object.hasOwn(item, 'elapsedDurationMin')) activity.elapsedDurationMin = boundedNumber(item.elapsedDurationMin, `${context} elapsed time`, MAX_DURATION_MIN)
  return activity
}

function restoreActivities(value: unknown, context: string): GarminActivity[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TRAINING_ACTIVITIES) fail(context, 'expected 1–5000 activities.')
  const entries = Array.from(value, (item, index) => ({ activity: restoreActivity(item, `${context} activity ${index + 1}`), context: `${context} activity ${index + 1}` }))
  return uniqueActivities(entries, true).activities
}

/** Validate a decoded backup object; unknown fields and duplicate records are rejected. */
export function parseTrainingHistory(value: unknown): TrainingHistory {
  const history = object(value, ['version', 'units', 'activities', 'confirmed'], 'History')
  if (history.version !== 1) fail('History', 'unsupported version.')
  if (typeof history.confirmed !== 'boolean') fail('History', 'confirmation must be a boolean.')
  return {
    version: 1, units: parseUnits(history.units),
    activities: restoreActivities(history.activities, 'History'), confirmed: history.confirmed,
  }
}

/** Pass only the selected incoming records. Even an exact reimport requires fresh confirmation. */
export function mergeTrainingHistory(existing: TrainingHistory | undefined, incoming: GarminImportResult, units: GarminUnits): TrainingHistory {
  parseUnits(units)
  const previous = existing === undefined ? undefined : parseTrainingHistory(existing)
  if (previous && previous.units !== units) fail('History', 'source export units differ. Use the same export units, or remove existing history before importing different units; stored distances are already in kilometres.')
  const result = object(incoming, ['activities', 'duplicateCount', 'warnings'], 'Import')
  if (!Number.isInteger(result.duplicateCount) || (result.duplicateCount as number) < 0 || (result.duplicateCount as number) > MAX_TRAINING_ACTIVITIES) fail('Import', 'invalid duplicate count.')
  if (!Array.isArray(result.warnings) || result.warnings.length > 20 ||
      result.warnings.some(warning => typeof warning !== 'string' || warning.length > 500)) fail('Import', 'invalid warnings.')
  const selected = restoreActivities(result.activities, 'Import')
  const { activities } = uniqueActivities([
    ...(previous?.activities ?? []).map((activity, index) => ({ activity, context: `Saved activity ${index + 1}` })),
    ...selected.map((activity, index) => ({ activity, context: `Imported activity ${index + 1}` })),
  ])
  return { version: 1, units, activities, confirmed: false }
}

export function runPaceMinPerKm(activity: GarminActivity): number | undefined {
  if ((activity.type !== 'running' && activity.type !== 'treadmill') || activity.distanceKm === undefined || activity.distanceKm <= 0) return undefined
  return activity.durationMin / activity.distanceKm
}

// UTC is used solely for date-only calendar arithmetic, never to assign an activity timezone.
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS
const calendarDate = (day: number) => new Date(day * DAY_MS).toISOString().split('T')[0]

function addTotals(totals: Partial<Record<GarminActivityType, ActivityTotals>>, activity: GarminActivity) {
  const previous = totals[activity.type] ?? { count: 0, durationMin: 0 }
  totals[activity.type] = { count: previous.count + 1, durationMin: previous.durationMin + activity.durationMin }
}

export function summarizeTrainingHistory(value: TrainingHistory, asOfDate: string): TrainingHistorySummary {
  const history = parseTrainingHistory(value)
  if (typeof asOfDate !== 'string' || !validDate(asOfDate)) fail('Summary', 'asOfDate must be a real YYYY-MM-DD date.')
  const dateRange = {
    start: history.activities[0].localTimestamp.slice(0, 10),
    end: history.activities[history.activities.length - 1].localTimestamp.slice(0, 10),
  }
  const byType: TrainingHistorySummary['byType'] = {}
  const weeks = new Map<string, TrainingHistoryWeek>()
  let durationMin = 0
  for (const activity of history.activities) {
    const date = activity.localTimestamp.slice(0, 10)
    const day = dayNumber(date)
    const weekday = new Date(day * DAY_MS).getUTCDay()
    const monday = day - (weekday + 6) % 7
    const weekStart = calendarDate(monday)
    const weekEnd = calendarDate(monday + 6)
    const week = weeks.get(weekStart) ?? {
      weekStart, weekEnd, dateRange: { start: date, end: date }, count: 0, durationMin: 0, byType: {},
      partialPeriod: weekStart < dateRange.start || weekEnd > dateRange.end || weekEnd > asOfDate,
    }
    week.count++
    week.durationMin += activity.durationMin
    week.dateRange.end = date
    addTotals(week.byType, activity)
    weeks.set(weekStart, week)
    addTotals(byType, activity)
    durationMin += activity.durationMin
  }
  const latestAgeDays = dayNumber(asOfDate) - dayNumber(dateRange.end)
  const stale = latestAgeDays > 42
  const warnings = [COVERAGE_WARNING, FACTS_WARNING]
  if (stale) warnings.push(`The latest recorded activity is ${latestAgeDays} days before ${asOfDate} (more than 42 days); this history may be stale.`)
  if (dateRange.end > asOfDate) warnings.push('Some activity dates are after the review date. They remain visible; check the source dates before confirming.')
  if (!history.confirmed) warnings.push('This history has not yet been confirmed by the user.')
  return {
    source: 'garmin_csv', units: history.units, asOfDate, dateRange, count: history.activities.length,
    durationMin, byType, weeks: [...weeks.values()], latestAgeDays, stale,
    coverage: 'recorded_activities_only', warnings,
  }
}
