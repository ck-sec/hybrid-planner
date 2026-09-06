import { LIMITS } from '../../engine/constants.ts'
import { addDays, parseISODate } from '../../engine/dates.ts'

export function eventDateBounds(start: string): { max?: string; issue?: string } {
  try { return { max: addDays(start, LIMITS.maxWeeks * 7 - 1) } } catch (error) {
    return { issue: `Confirm your block start in Your week. ${error instanceof Error ? error.message : 'The start date is incomplete.'}` }
  }
}

export function validateSetupDate(start: string, value: string): string {
  let date: string
  try { date = parseISODate(value) } catch {
    throw new Error('Choose your event or review date, including the year, using the date picker before continuing.')
  }
  const bounds = eventDateBounds(start)
  if (bounds.issue) throw new Error(bounds.issue)
  if (date < start || (bounds.max && date > bounds.max)) {
    throw new Error(`Choose a date from ${start} through ${bounds.max}. For a more distant event, choose an earlier review date.`)
  }
  return date
}
