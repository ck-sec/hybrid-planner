import {
  COST_MULTIPLIER_RANGE,
  DEFAULT_STRUCTURAL_HALF_LIFE_HOURS,
  DEFAULT_SYSTEMIC_HALF_LIFE_HOURS,
  FIRST_EXPOSURE_COST_MULTIPLIER,
  MAX_COST_RPE_FACTOR,
  MIN_COST_RPE_FACTOR,
  NOVICE_MONTHS_THRESHOLD,
  REFERENCE_SET_RPE,
  RUN_COST_PER_MINUTE,
  STANDARD_SET_REPS,
  TRAIL_STRUCTURAL_MULTIPLIER,
} from './constants.ts'
import { dayNumber, sessionStartMinutes, timeMinutes } from './dates.ts'
import type {
  AthleteState, Calibration, ExerciseLibrary, Load, PlanWeekInput, RecentSession, Session,
} from './types.ts'

function nonnegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and nonnegative`)
  return value
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`)
  return value
}

function validLoad(load: Load): Load {
  return {
    systemic: nonnegative(load.systemic, 'systemic load'),
    structural: nonnegative(load.structural, 'structural load'),
  }
}

function multiply(load: Load, factor: number): Load {
  nonnegative(factor, 'load factor')
  return validLoad({ systemic: load.systemic * factor, structural: load.structural * factor })
}

function add(left: Load, right: Load): Load {
  return validLoad({ systemic: left.systemic + right.systemic, structural: left.structural + right.structural })
}

function multiplier(calibration: Calibration): number {
  const value = nonnegative(calibration.costMultiplier, 'cost multiplier')
  if (value < COST_MULTIPLIER_RANGE[0] || value > COST_MULTIPLIER_RANGE[1]) {
    throw new RangeError('Cost multiplier is outside the policy range')
  }
  return value
}

/** Estimated scheduling AU only; weight is never a denominator or a cross-exercise estimate. */
export function predictSessionLoad(session: Session, athlete: AthleteState, library: ExerciseLibrary): Load {
  const minutes = nonnegative(session.durationMin, 'session duration')
  if (session.kind === 'commitment') return validLoad(session.predictedLoad)
  const common = multiplier(athlete.calibration)
  if (session.kind === 'run') {
    return multiply({
      systemic: RUN_COST_PER_MINUTE.systemic * minutes,
      structural: RUN_COST_PER_MINUTE.structural * minutes
        * (session.modality === 'run_trail' ? TRAIL_STRUCTURAL_MULTIPLIER : 1),
    }, common)
  }
  let total: Load = { systemic: 0, structural: 0 }
  for (const prescription of session.strengthPrescription) {
    const exercise = library.exercises.find(item => item.id === prescription.exerciseId)
    if (!exercise) throw new RangeError(`Unknown exercise: ${prescription.exerciseId}`)
    const sets = nonnegative(prescription.sets, 'sets')
    const reps = nonnegative(prescription.reps, 'reps')
    const rpe = nonnegative(prescription.targetRPE, 'target RPE')
    if (!Number.isInteger(sets) || !Number.isInteger(reps) || sets === 0 || reps === 0
      || rpe < 6 || rpe > 10 || !Number.isInteger(rpe * 2)) {
      throw new RangeError('Strength sets, reps, or target RPE are invalid')
    }
    if (prescription.suggestedWeightKg !== undefined) nonnegative(prescription.suggestedWeightKg, 'suggested weight')
    const observations = athlete.baseline.exercises.filter(item =>
      item.exerciseId === prescription.exerciseId && dayNumber(item.date) <= dayNumber(session.date))
    const latest = observations.reduce<typeof observations[number] | undefined>(
      (current, item) => !current || dayNumber(item.date) > dayNumber(current.date) ? item : current, undefined)
    const conservative = !latest || nonnegative(latest.experienceMonths, 'experience months') < NOVICE_MONTHS_THRESHOLD
    const effort = Math.min(MAX_COST_RPE_FACTOR, Math.max(MIN_COST_RPE_FACTOR, rpe / REFERENCE_SET_RPE))
    const factor = nonnegative(sets * (reps / STANDARD_SET_REPS) * effort * common
      * (conservative ? FIRST_EXPOSURE_COST_MULTIPLIER : 1), 'strength load factor')
    total = add(total, multiply(validLoad(exercise.coefficients), factor))
  }
  return total
}

/** Fixed half-lives are model assumptions, not individualized recovery measurements. */
export function decayLoad(load: Load, hours: number): Load {
  validLoad(load)
  nonnegative(hours, 'elapsed hours')
  return validLoad({
    systemic: load.systemic * 2 ** (-hours / DEFAULT_SYSTEMIC_HALF_LIFE_HOURS),
    structural: load.structural * 2 ** (-hours / DEFAULT_STRUCTURAL_HALF_LIFE_HOURS),
  })
}

/** Shared actual-history accounting for residual, boundary timing and hard-day checks. */
export function observedSessionWork(record: RecentSession, input: PlanWeekInput): { load: Load; duration: number } | null {
  const { session, log } = record
  if (!log) return null
  if (log.sessionId !== session.id) throw new RangeError('Log session ID does not match its session')
  if (log.status === 'skipped') return null
  if (log.status !== 'completed' && log.status !== 'partial') throw new RangeError('Invalid log status')
  let load = predictSessionLoad(session, input.athlete, input.library)
  const duration = log.actualDurationMin === undefined
    ? nonnegative(session.durationMin, 'planned duration')
    : nonnegative(log.actualDurationMin, 'actual duration')
  if (log.actualDurationMin !== undefined) {
    if (session.durationMin <= 0) throw new RangeError('A duration-scaled session needs positive planned minutes')
    load = multiply(load, duration / session.durationMin)
  }
  // A partial session with no actual duration retains its full estimate, never an invented percentage.
  return { load, duration }
}

/**
 * Session cost enters the model at its end. The residual snapshot already includes
 * events ending at/before its timestamp. Only completed/partial actual events
 * strictly after that snapshot and at/before this session are added.
 */
export function residualBefore(session: Session, input: PlanWeekInput, earlier: readonly Session[]): Load {
  const knownTarget = sessionStartMinutes(session)
  const dayStart = dayNumber(session.date) * 24 * 60
  const target = knownTarget ?? dayStart
  const snapshot = dayNumber(input.athlete.residual.asOfDate) * 24 * 60 + timeMinutes(input.athlete.residual.asOfTime)
  if (snapshot > target && (knownTarget !== null || snapshot >= dayStart + 24 * 60)) {
    throw new RangeError('Residual snapshot is later than the session being evaluated')
  }
  let result = decayLoad(input.athlete.residual.load, Math.max(0, target - snapshot) / 60)
  const actualIds = new Set<string>()
  for (const record of input.context.recentSessions) {
    if (!record.log || record.session.id === session.id) continue
    if (actualIds.has(record.session.id)) throw new RangeError('Duplicate actual session ID')
    actualIds.add(record.session.id)
    const actual = observedSessionWork(record, input)
    if (!actual) continue
    const start = sessionStartMinutes(record.session)
    // Unknown actual timestamps cannot prove an event occurred after the snapshot.
    if (start === null) {
      const earliest = dayNumber(record.session.date) * 24 * 60
      const latestEnd = earliest + 24 * 60 + actual.duration
      if (earliest + actual.duration <= snapshot || latestEnd > target) continue
      result = add(result, decayLoad(actual.load, (target - latestEnd) / 60))
      continue
    }
    const end = finite(start + actual.duration, 'actual end timestamp')
    if (end <= snapshot || end > target) continue
    result = add(result, decayLoad(actual.load, (target - end) / 60))
  }
  const seen = new Set<string>()
  for (const previous of earlier) {
    if (previous.id === session.id || actualIds.has(previous.id)) continue
    if (seen.has(previous.id)) throw new RangeError('Duplicate earlier session ID')
    seen.add(previous.id)
    const start = sessionStartMinutes(previous)
    const duration = nonnegative(previous.durationMin, 'earlier session duration')
    const previousDay = dayNumber(previous.date)
    if (previousDay === dayNumber(session.date) && (knownTarget === null || start === null)) {
      // This is proposed work, not an actual future log. Either ordering is possible,
      // so no unknown-time pair receives residual clearance.
      result = add(result, predictSessionLoad(previous, input.athlete, input.library))
      continue
    }
    if (start === null) {
      if (previousDay >= dayNumber(session.date)) continue
      const latestEnd = (previousDay + 1) * 24 * 60 + duration
      if (latestEnd <= snapshot) continue
      const age = Math.max(0, target - latestEnd) / 60
      result = add(result, decayLoad(predictSessionLoad(previous, input.athlete, input.library), age))
      continue
    }
    const end = finite(start + duration, 'earlier end timestamp')
    if (end > target || end <= snapshot) continue
    result = add(result, decayLoad(predictSessionLoad(previous, input.athlete, input.library), (target - end) / 60))
  }
  return result
}

/** Raw whole-session effort (0–10) × actual minutes; this is not either AU cost axis. */
export function calculateSessionTrainingLoad(effort: number, minutes: number): number {
  nonnegative(effort, 'whole-session effort')
  nonnegative(minutes, 'actual minutes')
  if (effort > 10) throw new RangeError('Whole-session effort must be between 0 and 10')
  return nonnegative(effort * minutes, 'session training load')
}

/**
 * Learning is deliberately disabled: the contract has no predicted whole-session
 * effort baseline. Comparing a rating to AU would conflate different quantities.
 * No observations are counted as calibration evidence, including ostensibly clean
 * logs; excluded/partial/pain/illness/calibration logs therefore cannot train it.
 */
export function calibrateCost(current: Calibration, observations: readonly RecentSession[]): Calibration {
  multiplier(current)
  if (current.version !== 1 || !Number.isSafeInteger(current.observationCount) || current.observationCount < 0) {
    throw new RangeError('Invalid calibration version or observation count')
  }
  void observations
  return current
}
