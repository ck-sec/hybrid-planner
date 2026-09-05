import type { Day, Session } from './types.ts'

function leap(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

export function parseISODate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Use a canonical calendar date in YYYY-MM-DD format.')
  }
  const [year, month, day] = value.split('-').map(Number)
  const lengths = [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1 || day > lengths[month - 1]) {
    throw new Error('Calendar dates must be valid and between 1900 and 2199.')
  }
  return value
}

// Gregorian civil-day arithmetic: no local clock, time zone, or host Date API.
export function dayNumber(date: string): number {
  const [year, month, day] = parseISODate(date).split('-').map(Number)
  const y = year - (month <= 2 ? 1 : 0)
  const era = Math.floor(y / 400)
  const yearOfEra = y - era * 400
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear
  return era * 146097 + dayOfEra - 719468
}

export function addDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error('A date offset must be a whole number of days.')
  const z = dayNumber(date) + days + 719468
  const era = Math.floor(z / 146097)
  const dayOfEra = z - era * 146097
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365)
  let year = yearOfEra + era * 400
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
  const mp = Math.floor((5 * dayOfYear + 2) / 153)
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp + (mp < 10 ? 3 : -9)
  year += month <= 2 ? 1 : 0
  return parseISODate(`${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`)
}

export function dayOfWeek(date: string): Day {
  return (((dayNumber(date) + 3) % 7 + 7) % 7) as Day
}

export function timeMinutes(time: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Session times must use HH:mm from 00:00 to 23:59.')
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export function sessionStartMinutes(session: Session): number | null {
  return session.startTime === null ? null : dayNumber(session.date) * 1440 + timeMinutes(session.startTime)
}
