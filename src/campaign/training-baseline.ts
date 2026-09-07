import { AI_ADVISORY_LIMITS } from '../../engine/constants.ts'
import { dayNumber, parseISODate } from '../../engine/dates.ts'

export interface TrainingPreferences {
  version: 1
  runsPerWeek: number
  runDurationMin: number
  liftsPerWeek: number
  liftDurationMin: number
}

export const TRAINING_PREFERENCE_LIMITS = Object.freeze({
  maxRunsPerWeek: 14,
  maxLiftsPerWeek: 14,
  maxDurationMin: 180,
})

export interface CurrentTraining {
  version: 1
  source: 'manual' | 'chat'
  asOf: string
  weeklyRunMinutes: number
  longestRunMinutes: number
  runsPerWeek: number
  liftsPerWeek: number
  liftDurationMin: number
}

function record(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) {
    throw new Error(`${label} must be a plain object.`)
  }
  const raw = value as Record<string, unknown>
  if (Reflect.ownKeys(raw).length !== fields.length || fields.some(key => !Object.hasOwn(raw, key)
    || !Object.hasOwn(Object.getOwnPropertyDescriptor(raw, key)!, 'value'))) {
    throw new Error(`${label} has missing or unsupported fields.`)
  }
  if (raw.version !== 1) throw new Error(`${label} has an unsupported version.`)
  return raw
}

function amount(value: unknown, label: string, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max
    || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be ${integer ? 'a whole number' : 'a number'} from 0 to ${max}.`)
  }
  return value
}

export function parseTrainingPreferences(value: unknown): TrainingPreferences {
  const raw = record(value, ['version', 'runsPerWeek', 'runDurationMin', 'liftsPerWeek', 'liftDurationMin'], 'Desired routine')
  return {
    version: 1,
    runsPerWeek: amount(raw.runsPerWeek, 'Desired runs', TRAINING_PREFERENCE_LIMITS.maxRunsPerWeek, true),
    runDurationMin: amount(raw.runDurationMin, 'Desired average run time', TRAINING_PREFERENCE_LIMITS.maxDurationMin),
    liftsPerWeek: amount(raw.liftsPerWeek, 'Desired lifts', TRAINING_PREFERENCE_LIMITS.maxLiftsPerWeek, true),
    liftDurationMin: amount(raw.liftDurationMin, 'Desired average lifting time', TRAINING_PREFERENCE_LIMITS.maxDurationMin),
  }
}

export function parseCurrentTraining(value: unknown): CurrentTraining {
  const raw = record(value, [
    'version', 'source', 'asOf', 'weeklyRunMinutes', 'longestRunMinutes', 'runsPerWeek', 'liftsPerWeek', 'liftDurationMin',
  ], 'Reported current training')
  if (raw.source !== 'manual' && raw.source !== 'chat') throw new Error('Choose a supported source for current training.')
  const result: CurrentTraining = {
    version: 1, source: raw.source, asOf: parseISODate(raw.asOf),
    weeklyRunMinutes: amount(raw.weeklyRunMinutes, 'Reported weekly run time', AI_ADVISORY_LIMITS.maxWeeklyRunMinutes),
    longestRunMinutes: amount(raw.longestRunMinutes, 'Reported longest comfortable run', AI_ADVISORY_LIMITS.maxRunMinutes),
    runsPerWeek: amount(raw.runsPerWeek, 'Reported runs', AI_ADVISORY_LIMITS.maxRuns, true),
    liftsPerWeek: amount(raw.liftsPerWeek, 'Reported lifts', AI_ADVISORY_LIMITS.maxLifts, true),
    liftDurationMin: amount(raw.liftDurationMin, 'Reported lifting time', AI_ADVISORY_LIMITS.maxLiftMinutes),
  }
  if (result.longestRunMinutes > result.weeklyRunMinutes
    || (result.runsPerWeek === 0 && result.weeklyRunMinutes !== 0)
    || (result.runsPerWeek > 0 && (!result.weeklyRunMinutes || !result.longestRunMinutes))
    || result.weeklyRunMinutes > result.longestRunMinutes * result.runsPerWeek
    || (result.liftsPerWeek > 0 && !result.liftDurationMin)) {
    throw new Error('Current training amounts conflict. Check weekly time, longest run and session counts.')
  }
  return result
}

export function assertCurrentTrainingDate(training: CurrentTraining, startDate: string): void {
  const age = dayNumber(startDate) - dayNumber(training.asOf)
  if (age < 0 || age > 42) {
    throw new Error('Confirm current training from the 42 days before this plan starts. Older imports remain history, not a current baseline.')
  }
}
