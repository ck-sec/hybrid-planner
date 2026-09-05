import type { Baseline, Day, Exercise, PlannerInput } from './types.ts'

export class InputError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(issues.join(' '))
    this.name = 'InputError'
    this.issues = issues
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError([`${label} must be an object.`])
  }
  return value as Record<string, unknown>
}

function numberInRange(
  value: unknown,
  label: string,
  min: number,
  max: number,
  integer: boolean,
  issues: string[],
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)
    || value < min || value > max || (integer && !Number.isInteger(value))) {
    issues.push(`${label} must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}.`)
    return Number.NaN
  }
  return value
}

function isDay(value: unknown): value is Day {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
}

export function parseBaseline(value: unknown): Baseline {
  const data = record(value, 'Baseline')
  const issues: string[] = []
  const weeklyRunMinutes = numberInRange(data.weeklyRunMinutes, 'Weekly running minutes', 1, 600, true, issues)
  const longestRunMinutes = numberInRange(data.longestRunMinutes, 'Longest established run', 1, 180, true, issues)
  const runsPerWeek = numberInRange(data.runsPerWeek, 'Established runs per week', 1, 4, true, issues)
  const liftsPerWeek = numberInRange(data.liftsPerWeek, 'Established lifts per week', 1, 3, true, issues)

  const availableDays: Day[] = []
  if (!Array.isArray(data.availableDays) || data.availableDays.length < 1 || data.availableDays.length > 7) {
    issues.push('Choose between one and seven available days.')
  } else {
    for (const day of data.availableDays) {
      if (!isDay(day)) issues.push('Available days must be Monday through Sunday (0 to 6).')
      else if (availableDays.includes(day)) issues.push('Available days must not contain duplicates.')
      else availableDays.push(day)
    }
  }

  const exercises: Exercise[] = []
  if (!Array.isArray(data.exercises) || data.exercises.length < 1 || data.exercises.length > 8) {
    issues.push('Add between one and eight established exercises.')
  } else {
    for (const [index, item] of data.exercises.entries()) {
      const exercise = record(item, `Exercise ${index + 1}`)
      const name = typeof exercise.name === 'string' ? exercise.name.trim() : ''
      if (!name || name.length > 80) issues.push(`Exercise ${index + 1} needs a name of 1 to 80 characters.`)
      exercises.push({
        name,
        sets: numberInRange(exercise.sets, `Sets for exercise ${index + 1}`, 1, 10, true, issues),
        reps: numberInRange(exercise.reps, `Reps for exercise ${index + 1}`, 1, 50, true, issues),
        loadKg: numberInRange(exercise.loadKg, `Load for exercise ${index + 1} (kg)`, 0, 500, false, issues),
      })
    }
  }

  if (weeklyRunMinutes < runsPerWeek) {
    issues.push('Weekly running minutes must allow at least one minute per established run.')
  }
  if (Math.ceil(weeklyRunMinutes / runsPerWeek) > longestRunMinutes) {
    issues.push('The running budget cannot fit within that number of runs without exceeding your longest established run. Review your baseline.')
  }
  if (issues.length) throw new InputError(issues)
  return {
    weeklyRunMinutes, longestRunMinutes, runsPerWeek, liftsPerWeek,
    availableDays: availableDays.sort((a, b) => a - b),
    exercises,
  }
}

export function parsePlannerInput(value: unknown): PlannerInput {
  const data = record(value, 'Planner input')
  const baseline = parseBaseline(data.baseline)
  const boundary = record(data.boundary, 'Week boundary')
  if (typeof boundary.previousSundayLift !== 'boolean' || typeof boundary.nextMondayLift !== 'boolean') {
    throw new InputError(['Both neighboring-week lifting flags must be booleans.'])
  }
  return {
    baseline,
    boundary: {
      previousSundayLift: boundary.previousSundayLift,
      nextMondayLift: boundary.nextMondayLift,
    },
  }
}
