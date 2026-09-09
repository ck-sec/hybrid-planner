import { addDaysToLocalDate, localDateDayOfWeek, parseLocalDate, type LocalDateString } from '../../domain/local-date.ts'

const DAY_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

const LONG_DAY_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})

const RANGE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  timeZone: 'UTC',
})

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function toLocalDateString(date: Date): LocalDateString {
  return parseLocalDate(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, 'local date')
}

export function todayLocalDate(now: Date = new Date()): LocalDateString {
  return toLocalDateString(now)
}

export function weekStartFor(date: LocalDateString | string): LocalDateString {
  const parsed = parseLocalDate(date, 'week date')
  const dayOfWeek = localDateDayOfWeek(parsed)
  const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  return addDaysToLocalDate(parsed, offset)
}

export function currentWeekStart(now: Date = new Date()): LocalDateString {
  return weekStartFor(todayLocalDate(now))
}

export function followingWeekStart(weekStart: LocalDateString | string): LocalDateString {
  return addDaysToLocalDate(parseLocalDate(weekStart, 'week start'), 7)
}

export function listWeekDates(weekStart: LocalDateString | string): readonly LocalDateString[] {
  const parsed = parseLocalDate(weekStart, 'week start')
  return Array.from({ length: 7 }, (_, offset) => addDaysToLocalDate(parsed, offset))
}

export function formatDayLabel(date: LocalDateString | string): string {
  return DAY_FORMATTER.format(new Date(`${parseLocalDate(date, 'date')}T00:00:00.000Z`))
}

export function formatLongDayLabel(date: LocalDateString | string): string {
  return LONG_DAY_FORMATTER.format(new Date(`${parseLocalDate(date, 'date')}T00:00:00.000Z`))
}

export function formatWeekday(date: LocalDateString | string): string {
  return WEEKDAY_FORMATTER.format(new Date(`${parseLocalDate(date, 'date')}T00:00:00.000Z`))
}

export function formatDateShort(date: LocalDateString | string): string {
  return RANGE_FORMATTER.format(new Date(`${parseLocalDate(date, 'date')}T00:00:00.000Z`))
}

export function formatWeekRange(weekStart: LocalDateString | string): string {
  const parsed = parseLocalDate(weekStart, 'week start')
  const end = addDaysToLocalDate(parsed, 6)
  const startLabel = RANGE_FORMATTER.format(new Date(`${parsed}T00:00:00.000Z`))
  const endLabel = RANGE_FORMATTER.format(new Date(`${end}T00:00:00.000Z`))
  return `${startLabel} to ${endLabel}`
}
