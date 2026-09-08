const DAY_MS = 86_400_000

export function parseISODate(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) {
    throw new Error('Use a real date in YYYY-MM-DD format.')
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Use a real calendar date in YYYY-MM-DD format.')
  }
  return date
}

export function parseWeekStart(value: unknown): string {
  parseISODate(value)
  return value as string
}

export function dayOfWeekDate(weekStart: string, offset: number): Date {
  const date = parseISODate(weekStart)
  date.setUTCDate(date.getUTCDate() + offset)
  return date
}

export function daysBetween(first: string, second: string): number {
  return (parseISODate(second).getTime() - parseISODate(first).getTime()) / DAY_MS
}

export function currentDate(now: Date = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new Error('The current date is unavailable.')
  const localDate = `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return parseWeekStart(localDate)
}

export function currentMonday(now: Date = new Date()): string {
  const date = parseISODate(currentDate(now))
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return parseWeekStart(date.toISOString().slice(0, 10))
}

const shortDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const longDate = new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const weekday = new Intl.DateTimeFormat('en', { weekday: 'long', timeZone: 'UTC' })

export function calendarDays(weekStart: string): { date: string; day: string }[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = dayOfWeekDate(weekStart, offset)
    return { date: date.toISOString().slice(0, 10), day: weekday.format(date) }
  })
}

export function formatDay(weekStart: string, day: number): string {
  return shortDate.format(dayOfWeekDate(weekStart, day))
}

export function formatWeek(weekStart: string): string {
  return `${shortDate.format(parseISODate(weekStart))} – ${longDate.format(dayOfWeekDate(weekStart, 6))}`
}
