import {
  ACCESSORY_RPE_RANGE, ANCHOR_RPE_RANGE, HARD_SESSION_STRUCTURAL_THRESHOLD,
  HARD_SESSION_SYSTEMIC_THRESHOLD, LIMITS, NOVICE_MONTHS_THRESHOLD, NOVICE_RPE_MAX, RECOMMENDATION_POLICY, SAFETY,
} from './constants.ts'
import { addDays, dayNumber, dayOfWeek, sessionStartMinutes } from './dates.ts'
import { observedSessionWork, predictSessionLoad } from './load.ts'
import { latestPerformance } from './observations.ts'
import type { PlanWeekInput, SafetyFloorResult, SafetyViolation, Session } from './types.ts'

function number(value: number, label: string, positive = false): number {
  if (!Number.isFinite(value) || (positive ? value <= 0 : value < 0)) {
    throw new RangeError(`${label} must be finite and ${positive ? 'positive' : 'nonnegative'}`)
  }
  return value
}

function samePrescription(left: Session, right: Session): boolean {
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
    if (value !== null && typeof value === 'object') {
      return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
    }
    return JSON.stringify(value) ?? 'undefined'
  }
  const { reason: leftReason, ...leftFields } = left
  const { reason: rightReason, ...rightFields } = right
  void leftReason
  void rightReason
  return stable(leftFields) === stable(rightFields)
}

/** An independent finite veto; scheduling estimates do not diagnose injury or prescribe rehabilitation. */
export function checkSafety(input: PlanWeekInput, sessions: readonly Session[]): SafetyFloorResult {
  const violations: SafetyViolation[] = []
  const fail = (rule: string, items: readonly Session[], message: string): void => {
    violations.push({ rule, sessionIds: items.map(item => item.id), message })
  }
  try {
    const { athlete, block, context, library } = input
    number(block.totalWeeks, 'block week count', true)
    if (!Number.isSafeInteger(block.totalWeeks)) throw new RangeError('Block week count must be a safe integer')
    if (!Number.isSafeInteger(input.weekIndex) || input.weekIndex < 0 || input.weekIndex >= block.totalWeeks) {
      throw new RangeError('Requested week index is outside the block')
    }
    const weekStart = addDays(block.startDate, input.weekIndex * 7)
    const firstDay = dayNumber(weekStart)
    const lastDay = firstDay + 6
    const peakDay = dayNumber(block.goal.peakDate)
    const baseline = athlete.baseline
    number(baseline.weeklyRunMinutes, 'baseline weekly run minutes')
    number(baseline.longestRunMinutes, 'baseline longest run')
    number(baseline.runsPerWeek, 'baseline run frequency')
    number(baseline.liftsPerWeek, 'baseline lift frequency')
    number(baseline.liftDurationMin, 'baseline lift duration')
    number(athlete.weeklyTimeBudgetMin, 'weekly time budget')
    const byDay = new Map<number, Session[]>()
    const ids = new Set<string>()
    let totalMinutes = 0
    for (const session of sessions) {
      if (!session.id || ids.has(session.id)) fail('uniqueSessionIds', [session], 'Every scheduled session must have a unique, nonempty ID.')
      ids.add(session.id)
      const day = dayNumber(session.date)
      number(session.durationMin, 'session duration', true)
      number(session.predictedLoad.systemic, 'predicted systemic AU')
      number(session.predictedLoad.structural, 'predicted structural AU')
      sessionStartMinutes(session)
      predictSessionLoad(session, athlete, library)
      totalMinutes = number(totalMinutes + session.durationMin, 'total scheduled minutes')
      if (day < firstDay || day > lastDay) fail('requestedWeek', [session], 'Session is outside the requested seven-day week.')
      if (session.kind !== 'commitment' && day > peakDay) {
        fail('goalDateBoundary', [session], 'Generated or pinned running and strength must not extend beyond the goal date; established commitments remain visible.')
      }
      if (!athlete.availableDays.includes(dayOfWeek(session.date))) {
        fail('availableDays', [session], 'Session falls on an unavailable day; fixed and pinned sessions cannot be silently moved.')
      }
      if (session.discipline === 'strength' && (context.untimedStrengthDates ?? [])
        .some(date => Math.abs(dayNumber(date) - day) <= SAFETY.untimedLiftClearDays)) {
        fail('untimedStrengthBoundary', [session],
          'Imported lifting has an unknown time. Keep a clear calendar day before new lifting; no duration or fatigue cost is inferred.')
      }
      byDay.set(day, [...(byDay.get(day) ?? []), session])
    }
    if (totalMinutes > athlete.weeklyTimeBudgetMin) {
      fail('weeklyTimeBudget', sessions, 'All visible sessions together exceed the established weekly time budget.')
    }
    for (const daily of byDay.values()) {
      if (daily.length > SAFETY.maxSessionsPerDay) fail('sessionsPerDay', daily, 'More than two sessions are scheduled on one day.')
    }
    const activeDays = [...byDay.keys()].filter(day => day >= firstDay && day <= lastDay).length
    if (7 - activeDays < SAFETY.minRestDaysPerWeek) fail('restDay', sessions, 'At least one day must remain free of sessions.')

    const orderedFixed = [...block.goal.fixedCommitments].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    const fixedIds = new Set<string>()
    for (const [index, fixed] of orderedFixed.entries()) {
      const sessionId = `fixed-${index + 1}-${weekStart}`
      fixedIds.add(sessionId)
      const expectedDate = addDays(weekStart, (fixed.dayOfWeek - dayOfWeek(weekStart) + 7) % 7)
      number(fixed.durationMin, 'fixed duration', true)
      number(fixed.estimatedLoad.systemic, 'fixed systemic AU')
      number(fixed.estimatedLoad.structural, 'fixed structural AU')
      const matching = sessions.filter(session => session.id === sessionId)
      const actual = matching[0]
      if (matching.length !== 1 || !actual || actual.kind !== 'commitment'
        || actual.date !== expectedDate || actual.startTime !== fixed.startTime
        || actual.durationMin !== fixed.durationMin || actual.discipline !== fixed.discipline
        || actual.modality !== fixed.modality || actual.label !== fixed.label
        || !actual.pinned || actual.isCalibration
        || actual.predictedLoad.systemic !== fixed.estimatedLoad.systemic
        || actual.predictedLoad.structural !== fixed.estimatedLoad.structural) {
        violations.push({ rule: 'fixedCommitmentPreserved', sessionIds: [sessionId],
          message: 'A fixed commitment is missing or its date, time, duration, discipline, modality, label, or supplied load changed.' })
      }
    }
    for (const pin of context.pinnedSessions) {
      const matching = sessions.filter(session => session.id === pin.id)
      if (matching.length !== 1 || !samePrescription(pin, matching[0]!)) {
        violations.push({ rule: 'pinnedSessionPreserved', sessionIds: [pin.id],
          message: 'A pinned session must retain all fields, including prescriptions and load; only its explanation may change.' })
      }
    }
    const pinnedIds = new Set(context.pinnedSessions.map(item => item.id))
    for (const session of sessions) {
      if (session.kind === 'commitment' && !fixedIds.has(session.id) && !pinnedIds.has(session.id)) {
        fail('establishedCommitment', [session], 'A commitment must come from a supplied fixed commitment or preserved pin.')
      }
    }

    const pastWeeks = context.completedWeeks.filter(week => dayNumber(week.weekStart) + 7 <= firstDay)
      .sort((left, right) => dayNumber(right.weekStart) - dayNumber(left.weekStart))
    const unresolved = context.recentSessions.some(record =>
      dayNumber(record.session.date) >= dayNumber(baseline.asOf)
      && dayNumber(record.session.date) <= firstDay && record.log
      && (record.log.painFlag || record.log.skipReason === 'pain' || record.log.skipReason === 'illness'))
    const latestWeek = pastWeeks[0]
    const unresolvedDisruption = latestWeek?.disrupted === true
      && dayNumber(latestWeek.weekStart) + 6 >= dayNumber(baseline.asOf)
    const hold = athlete.safetyHold !== null || unresolved || unresolvedDisruption
    const generated = sessions.filter(session => session.kind === 'run' || session.kind === 'strength')
    if (hold && generated.length) {
      fail('safetyHold', generated,
        'Pain, illness, a return-from-break hold, or the latest disrupted completed week blocks generated running and lifting. No return or rehabilitation prescription is inferred.')
    }

    const runs = sessions.filter(session => session.discipline === 'run')
    const lifts = sessions.filter(session => session.discipline === 'strength')
    if (runs.length > Math.min(baseline.runsPerWeek, LIMITS.maxRuns)) {
      fail('runFrequency', runs, 'Run frequency exceeds the established baseline or engine limit.')
    }
    if (lifts.length > Math.min(baseline.liftsPerWeek, LIMITS.maxLifts)) {
      fail('liftFrequency', lifts, 'Full-body/strength frequency exceeds the established baseline or engine limit.')
    }
    let runMinutes = 0
    for (const run of runs) {
      runMinutes = number(runMinutes + run.durationMin, 'weekly run minutes')
      if (run.durationMin > Math.min(baseline.longestRunMinutes, LIMITS.maxRunMinutes)) {
        fail('longestRun', [run], 'Run duration exceeds the longest established run or the engine limit.')
      }
      if (run.kind === 'run' && (run.endurancePrescription.effort !== 'conversational'
        || !['easy', 'long'].includes(run.endurancePrescription.intent))) {
        fail('runPrescription', [run], 'Only baseline-bounded conversational running is generated; goal labels do not prescribe intensity.')
      }
    }
    // The block's first week is a planned calibration reduction even if an older
    // persisted summary did not yet mark it as a deload.
    const reference = pastWeeks.find(week =>
      !week.plannedDeload && !week.disrupted && week.weekStart !== block.startDate
      && dayNumber(week.weekStart) + 6 >= dayNumber(baseline.asOf))
    const referenceCap = reference
      ? number(reference.runMinutes, 'completed weekly run minutes') * (1 + SAFETY.maxWeeklyVolumeIncreasePct / 100)
      : baseline.weeklyRunMinutes
    number(referenceCap, 'weekly progression cap')
    const weeklyRunCap = Math.min(baseline.weeklyRunMinutes, referenceCap, LIMITS.maxWeeklyRunMinutes)
    if (runMinutes > weeklyRunCap) {
      fail('weeklyRunVolume', runs, 'Run minutes exceed the baseline or the 10% ceiling over the latest comparable nondisrupted, non-deload completed week.')
    }

    for (const session of sessions) {
      if (session.kind !== 'strength') continue
      if (session.durationMin > baseline.liftDurationMin) fail('liftDuration', [session], 'Strength duration exceeds the established session duration.')
      if (!session.strengthPrescription.length || session.strengthPrescription.length > LIMITS.maxExercises) {
        fail('strengthPrescription', [session], 'Strength sessions require a bounded set of observed exercise prescriptions.')
      }
      if (athlete.recommendedExerciseIds) {
        const sets = session.strengthPrescription.reduce((sum, item) => sum + number(item.sets, 'recommended sets', true), 0)
        const reps = session.strengthPrescription.reduce((sum, item) =>
          sum + number(item.sets, 'recommended sets', true) * number(item.reps, 'recommended reps', true), 0)
        if (session.strengthPrescription.length > RECOMMENDATION_POLICY.maxExercises
          || sets > RECOMMENDATION_POLICY.maxSessionSets || reps > RECOMMENDATION_POLICY.maxSessionReps) {
          fail('recommendedSessionWork', [session],
            `A recommended strength session cannot exceed ${RECOMMENDATION_POLICY.maxSessionSets} total working sets or ${RECOMMENDATION_POLICY.maxSessionReps} total repetitions, regardless of how many exercise cards were selected.`)
        }
      }
      const exercises = new Set<string>()
      for (const prescription of session.strengthPrescription) {
        const exercise = library.exercises.find(item => item.id === prescription.exerciseId)
        const anchor = block.anchors.find(item => item.exerciseId === prescription.exerciseId && item.role === prescription.role)
        const observations = baseline.exercises.filter(item =>
          item.exerciseId === prescription.exerciseId && dayNumber(item.date) <= firstDay)
        for (const observation of observations) {
          number(observation.sets, 'observed sets', true)
          number(observation.reps, 'observed reps', true)
          number(observation.actualRPE, 'observed RPE', true)
          number(observation.experienceMonths, 'observed experience')
          number(observation.weightKg, 'observed weight')
        }
        const latest = observations.reduce<typeof observations[number] | undefined>((current, item) =>
          !current || dayNumber(item.date) > dayNumber(current.date) ? item : current, undefined)
        const bounds = prescription.role === 'anchor' ? ANCHOR_RPE_RANGE : ACCESSORY_RPE_RANGE
        const recommended = anchor?.provenance !== undefined
        const cap = recommended ? RECOMMENDATION_POLICY.targetRPE
          : Math.min(bounds[1], latest && latest.experienceMonths >= NOVICE_MONTHS_THRESHOLD ? bounds[1] : NOVICE_RPE_MAX)
        if (anchor) {
          number(anchor.sets, 'anchor sets', true)
          number(anchor.reps, 'anchor reps', true)
          number(anchor.targetRPE, 'anchor RPE', true)
        }
        const supportedRecommendation = recommended && anchor?.provenance?.kind === 'recommended'
          && anchor.provenance.policyVersion === RECOMMENDATION_POLICY.version
          && athlete.recommendedExerciseIds?.includes(prescription.exerciseId) === true
          && observations.length === 0
          && (RECOMMENDATION_POLICY.supportedExerciseIds as readonly string[]).includes(prescription.exerciseId)
          && anchor.sets <= RECOMMENDATION_POLICY.sets && anchor.reps === RECOMMENDATION_POLICY.reps
          && anchor.targetRPE === RECOMMENDATION_POLICY.targetRPE
        if (!exercise || exercise.highSkill || !exercise.equipment.every(item => item === 'none' || athlete.equipment.includes(item))
          || exercises.has(prescription.exerciseId) || !anchor || anchor.pattern !== exercise.pattern
          || prescription.sets > anchor.sets || prescription.reps !== anchor.reps
          || !(recommended ? supportedRecommendation : observations.some(item => prescription.sets <= item.sets && prescription.reps <= item.reps))
          || prescription.targetRPE < ACCESSORY_RPE_RANGE[0] || prescription.targetRPE > cap
          || prescription.targetRPE > anchor.targetRPE || !Number.isInteger(prescription.targetRPE * 2)) {
          fail(recommended ? 'recommendedStrengthPrescription' : 'observedStrengthPrescription', [session], recommended
            ? `Exercise ${prescription.exerciseId} must retain its explicitly selected, equipped, versioned first-exposure prescription; no observation or starting weight may be invented.`
            : `Exercise ${prescription.exerciseId} must retain its observed, equipped, non-high-skill anchor/accessory prescription, with bounded sets, reps and target RPE (novices at most ${NOVICE_RPE_MAX}).`)
        }
        if (supportedRecommendation && latestPerformance(input, prescription.exerciseId) === null && !session.isCalibration) {
          fail('recommendedCalibration', [session], 'Unobserved recommended exercise exposures must remain marked as calibration.')
        }
        exercises.add(prescription.exerciseId)
        if (prescription.suggestedWeightKg !== undefined) {
          const performance = latestPerformance(input, prescription.exerciseId)
          if (!performance || performance.weightKg !== prescription.suggestedWeightKg
            || performance.reps !== prescription.reps || performance.actualRPE !== prescription.targetRPE) {
            fail('observedWeightOnly', [session],
              'A suggested weight must exactly match this exercise’s latest eligible performance at the same reps and target effort; otherwise omit it.')
          }
        }
      }
    }

    const neighbors = context.neighboringSessions.filter(session => {
      const day = dayNumber(session.date)
      const log = context.recentSessions.find(record => record.session.id === session.id)?.log
      return day >= firstDay - SAFETY.maxConsecutiveHardDays && day <= lastDay + SAFETY.maxConsecutiveHardDays
        && log?.status !== 'skipped' && log?.actualDurationMin !== 0
    })
    const combined = [...sessions, ...neighbors]
    const allIds = new Set<string>()
    const hardDays = new Map<number, Session[]>()
    const durations = new Map<Session, number>()
    const lowerBody = (session: Session): boolean => session.discipline === 'strength'
      && (session.kind === 'commitment' || (session.kind === 'strength'
        && session.strengthPrescription.some(prescription =>
          library.exercises.find(exercise => exercise.id === prescription.exerciseId)?.competesWithRunning)))
    for (const session of combined) {
      if (allIds.has(session.id)) fail('uniqueSessionIds', [session], 'Neighboring and scheduled sessions must not reuse IDs.')
      allIds.add(session.id)
      number(session.durationMin, 'session or neighboring duration', true)
      const record = ids.has(session.id) ? undefined : context.recentSessions.find(item => item.session.id === session.id)
      const actual = record?.log ? observedSessionWork(record, input) : null
      const load = actual?.load ?? predictSessionLoad(session, athlete, library)
      durations.set(session, actual?.duration ?? session.durationMin)
      if (load.systemic >= HARD_SESSION_SYSTEMIC_THRESHOLD || load.structural >= HARD_SESSION_STRUCTURAL_THRESHOLD) {
        const day = dayNumber(session.date)
        hardDays.set(day, [...(hardDays.get(day) ?? []), session])
      }
    }
    for (let leftIndex = 0; leftIndex < combined.length; leftIndex++) {
      const left = combined[leftIndex]!
      for (let rightIndex = leftIndex + 1; rightIndex < combined.length; rightIndex++) {
        const right = combined[rightIndex]!
        if (!ids.has(left.id) && !ids.has(right.id)) continue
        const leftDay = dayNumber(left.date)
        const rightDay = dayNumber(right.date)
        const leftStart = sessionStartMinutes(left)
        const rightStart = sessionStartMinutes(right)
        if (leftStart === null || rightStart === null) {
          if (leftDay === rightDay) fail('unknownSameDayTime', [left, right], 'Unknown same-day timing cannot establish nonoverlap or safe separation.')
          if (lowerBody(left) && lowerBody(right)) {
            const [previous, next] = leftDay <= rightDay ? [left, right] : [right, left]
            const latestPreviousStart = sessionStartMinutes(previous) ?? (dayNumber(previous.date) + 1) * 24 * 60
            const earliestNextStart = sessionStartMinutes(next) ?? dayNumber(next.date) * 24 * 60
            const minimumPossibleGap = earliestNextStart - latestPreviousStart - durations.get(previous)!
            if (minimumPossibleGap < SAFETY.minimumLiftGapHours * 60) {
              fail('minimumLiftGap', [left, right], 'Unknown timing cannot establish the required 24-hour end-to-start lower/full-body lifting gap, including possible overnight finishes.')
            }
          }
          continue
        }
        const leftEnd = leftStart + durations.get(left)!
        const rightEnd = rightStart + durations.get(right)!
        if (!Number.isFinite(leftEnd) || !Number.isFinite(rightEnd)) throw new RangeError('Session end timestamp overflow')
        if (leftStart < rightEnd && rightStart < leftEnd) fail('overlappingSessions', [left, right], 'Known session intervals overlap, including across midnight.')
        if (lowerBody(left) && lowerBody(right)) {
          const gap = leftStart <= rightStart ? rightStart - leftEnd : leftStart - rightEnd
          if (gap < SAFETY.minimumLiftGapHours * 60) {
            fail('minimumLiftGap', [left, right], 'Lower/full-body strength requires at least 24 elapsed local hours from the preceding session’s end to the next start.')
          }
        }
      }
    }
    let chain: number[] = []
    for (const day of [...hardDays.keys()].sort((left, right) => left - right)) {
      chain = chain.length && day === chain[chain.length - 1]! + 1 ? [...chain, day] : [day]
      if (chain.length > SAFETY.maxConsecutiveHardDays && chain.some(item => item >= firstDay && item <= lastDay)) {
        fail('consecutiveHardDays', chain.flatMap(item => hardDays.get(item) ?? []),
          'More than two consecutive estimated hard days occur across this week and its neighboring sessions; AU is not measured recovery.')
      }
    }
  } catch (error) {
    violations.push({ rule: 'invalidSafetyInput', sessionIds: [],
      message: `Safety could not be established: ${error instanceof Error ? error.message : 'invalid input'}.` })
  }
  return { passed: violations.length === 0, violations }
}
