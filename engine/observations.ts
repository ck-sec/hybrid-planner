import type { BlockLog, PlanWeekInput, SessionLog, SetLog, WorkoutSession } from './types.ts'

function blockLogOverrunMessage(session: WorkoutSession, log: BlockLog): string | null {
  const block = session.blocks[log.blockIndex]
  if (!block || block.unit !== log.unit) return null
  if (block.unit === 'reps' && log.unit === 'reps' && block.exerciseId === log.exerciseId) {
    const details: string[] = []
    if (log.sets.length > block.sets) {
      details.push(`${log.sets.length} sets recorded versus ${block.sets} prescribed`)
    }
    const repsOver = log.sets.filter(set => set.reps > block.reps).length
    if (repsOver) details.push(`${repsOver} ${repsOver === 1 ? 'set' : 'sets'} exceeded ${block.reps} prescribed repetitions`)
    const rpeOver = log.sets.filter(set => set.actualRPE > block.targetRPE).length
    if (rpeOver) details.push(`${rpeOver} ${rpeOver === 1 ? 'set' : 'sets'} exceeded target RPE ${block.targetRPE}`)
    return details.length ? `${details.join('; ')}.` : null
  }
  if (block.unit === 'seconds' && log.unit === 'seconds' && block.exerciseId === log.exerciseId) {
    const prescribed = block.sets * block.seconds
    return log.seconds > prescribed ? `${log.seconds} seconds recorded versus ${prescribed} prescribed.` : null
  }
  if (block.unit === 'throws' && log.unit === 'throws' && block.drillId === log.drillId) {
    return log.throws > block.throws ? `${log.throws} throws recorded versus ${block.throws} prescribed.` : null
  }
  return null
}

/** Truthful actuals above plan, grouped for display beside each recorded block. */
export function workoutLogOverruns(
  session: WorkoutSession, log: SessionLog,
): readonly { blockIndex: number; message: string }[] {
  return (log.blockLogs ?? []).flatMap(blockLog => {
    const message = blockLogOverrunMessage(session, blockLog)
    return message ? [{ blockIndex: blockLog.blockIndex, message }] : []
  }).sort((left, right) => left.blockIndex - right.blockIndex)
}

/** Whether an actual block stayed within its prescription. Overruns remain valid observations. */
export function blockLogWithinPrescription(session: WorkoutSession, log: BlockLog): boolean {
  const block = session.blocks[log.blockIndex]
  if (!block || block.unit !== log.unit) return false
  if (block.unit === 'reps' && log.unit === 'reps') {
    return block.exerciseId === log.exerciseId
      && log.sets.every(set => set.exerciseId === block.exerciseId)
      && blockLogOverrunMessage(session, log) === null
  }
  if (block.unit === 'seconds' && log.unit === 'seconds') {
    return block.exerciseId === log.exerciseId && blockLogOverrunMessage(session, log) === null
  }
  return block.unit === 'throws' && log.unit === 'throws'
    && block.drillId === log.drillId && blockLogOverrunMessage(session, log) === null
}

export function sessionBlockOverrunCount(session: WorkoutSession, log: SessionLog): number {
  return workoutLogOverruns(session, log).length
}

export function hasCleanBlockObservation(
  input: PlanWeekInput, exerciseId: string, unit: 'reps' | 'seconds',
): boolean {
  return input.context.recentSessions.some(record => {
    if (record.session.kind !== 'workout' || record.log?.status !== 'completed' || record.log.painFlag) return false
    const session = record.session
    return record.log.blockLogs?.some(log => log.unit === unit && 'exerciseId' in log
      && log.exerciseId === exerciseId && (log.unit !== 'seconds' || log.seconds > 0)
      && blockLogWithinPrescription(session, log)) ?? false
  })
}

export function hasCleanThrowObservation(input: PlanWeekInput, commitmentId: string): boolean {
  return input.context.recentSessions.some(record => {
    if (record.session.kind !== 'workout' || record.session.sourceCommitmentId !== commitmentId
      || record.log?.status !== 'completed' || record.log.painFlag) return false
    const session = record.session
    return record.log.blockLogs?.some(log => log.unit === 'throws' && log.throws > 0
      && blockLogWithinPrescription(session, log)) ?? false
  })
}

/** The latest observation is not a weight progression formula. */
export function latestPerformance(input: PlanWeekInput, exerciseId: string): SetLog | null {
  const baseline = input.athlete.baseline.exercises.find(item => item.exerciseId === exerciseId)
  let latest: SetLog | null = baseline ? {
    exerciseId, weightKg: baseline.weightKg, reps: baseline.reps, actualRPE: baseline.actualRPE,
  } : null
  const history = [...input.context.recentSessions]
    .filter(item => item.session.date >= input.athlete.baseline.asOf
      && item.log?.status === 'completed' && !item.log.painFlag
      && (item.session.kind === 'strength' || (item.session.kind === 'workout' && item.session.discipline === 'strength')))
    .sort((a, b) => {
      const aKey = `${a.session.date}|${a.session.startTime ?? '00:00'}|${a.session.id}`
      const bKey = `${b.session.date}|${b.session.startTime ?? '00:00'}|${b.session.id}`
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
    })
  for (const item of history) {
    for (const set of item.log?.sets ?? []) {
      if (set.exerciseId === exerciseId) latest = { ...set }
    }
    for (const block of item.log?.blockLogs ?? []) {
      if (block.unit !== 'reps' || block.exerciseId !== exerciseId) continue
      if (item.session.kind !== 'workout' || !blockLogWithinPrescription(item.session, block)) continue
      for (const set of block.sets) {
        if (set.exerciseId === exerciseId) latest = { ...set }
      }
    }
  }
  return latest
}
