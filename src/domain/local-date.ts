const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const CLOCK_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const DAY_MS = 86_400_000

export type LocalDateString = string & { readonly __localDate: unique symbol }

export function parseLocalDate(value: unknown, label = 'date'): LocalDateString {
  if (typeof value !== 'string' || !LOCAL_DATE_PATTERN.test(value) || value.startsWith('0000')) {
    throw new Error(`${label} must be a real local date in YYYY-MM-DD format.`)
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a real calendar date in YYYY-MM-DD format.`)
  }
  return value as LocalDateString
}

export function isLocalDate(value: unknown): value is LocalDateString {
  try {
    parseLocalDate(value)
    return true
  } catch {
    return false
  }
}

export function addDaysToLocalDate(date: LocalDateString, days: number): LocalDateString {
  if (!Number.isSafeInteger(days)) throw new Error('Day offsets must be whole numbers.')
  const next = new Date(`${parseLocalDate(date)}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return parseLocalDate(next.toISOString().slice(0, 10))
}

export function differenceInDays(start: LocalDateString, end: LocalDateString): number {
  return (new Date(`${parseLocalDate(end)}T00:00:00.000Z`).getTime()
    - new Date(`${parseLocalDate(start)}T00:00:00.000Z`).getTime()) / DAY_MS
}

export function isDateInRollingWeek(date: LocalDateString, weekStart: LocalDateString): boolean {
  const offset = differenceInDays(weekStart, date)
  return Number.isInteger(offset) && offset >= 0 && offset <= 6
}

export function localDateDayOfWeek(date: LocalDateString): number {
  return new Date(`${parseLocalDate(date)}T00:00:00.000Z`).getUTCDay()
}

export function compareLocalDates(left: LocalDateString, right: LocalDateString): number {
  return differenceInDays(left, right)
}

export function parseClockTime(value: unknown, label = 'time'): string {
  if (typeof value !== 'string' || !CLOCK_TIME_PATTERN.test(value)) {
    throw new Error(`${label} must use 24-hour HH:MM format.`)
  }
  return value
}

export function parseIsoTimestamp(value: unknown, label = 'timestamp'): string {
  if (typeof value !== 'string') throw new Error(`${label} must be an ISO timestamp.`)
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a complete ISO-8601 UTC timestamp.`)
  }
  return value
}
