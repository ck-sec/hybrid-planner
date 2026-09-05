import type { PlanWeekInput, SetLog } from './types.ts'

/** The latest observation is not a weight progression formula. */
export function latestPerformance(input: PlanWeekInput, exerciseId: string): SetLog | null {
  const baseline = input.athlete.baseline.exercises.find(item => item.exerciseId === exerciseId)
  let latest: SetLog | null = baseline ? {
    exerciseId, weightKg: baseline.weightKg, reps: baseline.reps, actualRPE: baseline.actualRPE,
  } : null
  const history = [...input.context.recentSessions]
    .filter(item => item.session.date >= input.athlete.baseline.asOf
      && item.log?.status === 'completed' && !item.log.painFlag && item.session.kind === 'strength')
    .sort((a, b) => {
      const aKey = `${a.session.date}|${a.session.startTime ?? '00:00'}|${a.session.id}`
      const bKey = `${b.session.date}|${b.session.startTime ?? '00:00'}|${b.session.id}`
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
    })
  for (const item of history) {
    for (const set of item.log?.sets ?? []) {
      if (set.exerciseId === exerciseId) latest = { ...set }
    }
  }
  return latest
}
