import {
  HARD_SESSION_STRUCTURAL_THRESHOLD, HARD_SESSION_SYSTEMIC_THRESHOLD,
  LONG_RUN_CLEARANCE_STRUCTURAL_MAX, MIN_SEPARATION_HOURS,
  MIN_SEPARATION_HOURS_HIGH_INTENSITY, PENALTY_WEIGHTS, SAFETY,
} from './constants.ts'
import { addDays, dayNumber, sessionStartMinutes } from './dates.ts'
import { observedSessionWork, predictSessionLoad, residualBefore } from './load.ts'
import type { Load, PenaltyResult, PlanWeekInput, Quality, Session } from './types.ts'

function bounded(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('A scoring magnitude must be finite')
  return Math.min(1, Math.max(0, value))
}

function hard(load: Load): boolean {
  return load.systemic >= HARD_SESSION_SYSTEMIC_THRESHOLD || load.structural >= HARD_SESSION_STRUCTURAL_THRESHOLD
}

/** Soft estimated scheduling costs only. A zero score never establishes safety. */
export function scoreSessions(input: PlanWeekInput, sessions: readonly Session[]): PenaltyResult[] {
  const penalties: PenaltyResult[] = []
  const add = (rule: keyof typeof PENALTY_WEIGHTS, magnitude: number, affected: readonly Session[],
    explanation: string, evidence: PenaltyResult['evidence'] = 'estimate'): void => {
    const normalized = bounded(magnitude)
    if (!normalized) return
    const weight = PENALTY_WEIGHTS[rule]
    const score = weight * normalized
    if (!Number.isFinite(weight) || !Number.isFinite(score)) throw new RangeError('A scoring weight or score is not finite')
    penalties.push({ rule, weight, magnitude: normalized, score,
      affectedSessionIds: affected.map(session => session.id), explanation, evidence })
  }
  const firstDay = dayNumber(addDays(input.block.startDate, input.weekIndex * 7))
  const neighbors = input.context.neighboringSessions.filter(session => {
    const day = dayNumber(session.date)
    const log = input.context.recentSessions.find(record => record.session.id === session.id)?.log
    return day >= firstDay - SAFETY.maxConsecutiveHardDays && day <= firstDay + 6 + SAFETY.maxConsecutiveHardDays
      && log?.status !== 'skipped' && log?.actualDurationMin !== 0
  })
  const currentIds = new Set(sessions.map(session => session.id))
  const combined = [...sessions, ...neighbors]
  const costs = new Map<Session, Load>()
  const durations = new Map<Session, number>()
  const running = (session: Session): boolean => session.discipline === 'run'
  const competingLift = (session: Session): boolean => session.discipline === 'strength'
    && (session.kind === 'commitment' || (session.kind === 'strength'
      && session.strengthPrescription.some(item =>
        input.library.exercises.find(exercise => exercise.id === item.exerciseId)?.competesWithRunning)))
  for (const session of combined) {
    const record = currentIds.has(session.id) ? undefined
      : input.context.recentSessions.find(item => item.session.id === session.id)
    const actual = record?.log ? observedSessionWork(record, input) : null
    costs.set(session, actual?.load ?? predictSessionLoad(session, input.athlete, input.library))
    durations.set(session, actual?.duration ?? session.durationMin)
    sessionStartMinutes(session)
  }
  for (const session of sessions) {
    if (!running(session) && !competingLift(session)) continue
    const residual = residualBefore(session, input, combined.filter(item => item.id !== session.id))
    add('structuralCollision', residual.structural / LONG_RUN_CLEARANCE_STRUCTURAL_MAX, [session],
      `${running(session) ? 'Running' : 'Running-competing strength'} meets estimated structural residual. AU is an arbitrary scheduling estimate, not measured fatigue or injury risk.`)
    if (session.kind === 'run' && session.endurancePrescription.intent === 'long') {
      add('longRunClearance', (residual.structural - LONG_RUN_CLEARANCE_STRUCTURAL_MAX)
        / LONG_RUN_CLEARANCE_STRUCTURAL_MAX, [session],
      'A long run meets structural residual above the estimated clearance reference. This AU reference is a scheduling heuristic, not a medical clearance test.')
    }
  }
  const runQualities: readonly Quality[] = ['aerobic_base', 'threshold', 'vo2max']
  const strengthQualities: readonly Quality[] = ['max_strength', 'power', 'strength_endurance', 'shoulder_durability']
  const runPriority = input.block.goal.qualityBias.filter(quality => runQualities.includes(quality)).length
  const strengthPriority = input.block.goal.qualityBias.filter(quality => strengthQualities.includes(quality)).length
  for (let leftIndex = 0; leftIndex < combined.length; leftIndex++) {
    const left = combined[leftIndex]!
    for (let rightIndex = leftIndex + 1; rightIndex < combined.length; rightIndex++) {
      const right = combined[rightIndex]!
      if (!currentIds.has(left.id) && !currentIds.has(right.id)) continue
      if (dayNumber(left.date) !== dayNumber(right.date)) continue
      const required = (hard(costs.get(left)!) || hard(costs.get(right)!))
        ? MIN_SEPARATION_HOURS_HIGH_INTENSITY : MIN_SEPARATION_HOURS
      const leftStart = sessionStartMinutes(left)
      const rightStart = sessionStartMinutes(right)
      const gap = leftStart === null || rightStart === null ? null
        : (leftStart <= rightStart
          ? rightStart - leftStart - durations.get(left)!
          : leftStart - rightStart - durations.get(right)!) / 60
      const magnitude = gap === null ? 1 : bounded((required - gap) / required)
      add('sameDaySeparation', magnitude, [left, right], gap === null
        ? 'Unknown same-day timing cannot establish end-to-start separation; it is never credited as clearance.'
        : `Same-day sessions have less than ${required} hours from the earlier end to the later start. The longer spacing reference is triggered by estimated hard-session AU, not inferred exercise intensity.`, 'policy')
      const run = running(left) ? left : running(right) ? right : undefined
      const lift = competingLift(left) ? left : competingLift(right) ? right : undefined
      if (run && lift && runPriority !== strengthPriority) {
        const lowerPriority = runPriority > strengthPriority ? lift : run
        add('goalPriority', magnitude, [lowerPriority],
          'When running and running-competing lifting collide, move the lower-priority work based on the goal’s supplied quality bias. This changes scheduling priority, not prescribed intensity.', 'policy')
      }
    }
  }
  const hardDays = new Map<number, Session[]>()
  for (const session of combined) {
    if (!hard(costs.get(session)!)) continue
    const day = dayNumber(session.date)
    hardDays.set(day, [...(hardDays.get(day) ?? []), session])
  }
  for (const day of [...hardDays.keys()].sort((left, right) => left - right)) {
    const today = hardDays.get(day)!
    const next = hardDays.get(day + 1)
    if (next && [...today, ...next].some(session => currentIds.has(session.id))) {
      add('hardDaysAdjacent', 1, [...today, ...next],
        'Consecutive days contain estimated hard-session AU. This finite scheduling penalty is separate from the independent maximum-hard-days safety veto.')
    }
  }
  return penalties
}
