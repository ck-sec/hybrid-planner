import type { AthleteProfile, PlanningContext, RecurringClubSession, WeekPlan, WorkoutStep } from '../../domain/contracts.ts'
import { addDaysToLocalDate, localDateDayOfWeek } from '../../domain/local-date.ts'
import type { ImportIssue, JsonPreviewItem, PlanQualitySummary } from '../features/models.ts'
import { readGuidedSessionCounts } from './onboarding.ts'

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const categories = ['aerobic', 'strength', 'mobility'] as const
const minuteKeys = ['aerobicMinutes', 'strengthMinutes', 'mobilityMinutes', 'clubMinutes'] as const

function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function planningContextFacts(context: PlanningContext, athlete: AthleteProfile): JsonPreviewItem[] {
  const facts: JsonPreviewItem[] = [{ label: 'Context date', value: context.asOf }]
  if (context.event) facts.push({ label: 'Event / level', value: context.event })
  if (context.benchmarks) facts.push({ label: 'Benchmarks', value: context.benchmarks.join('; ') || 'None supplied' })
  if (context.limitations) facts.push({ label: 'Limitations', value: context.limitations.join('; ') || 'None reported' })
  if (context.recentTraining) {
    const recent = context.recentTraining
    facts.push({ label: 'Recent training', value: `Weekly averages over ${recent.weeks} weeks` })
    for (const key of minuteKeys) {
      if (recent[key] !== undefined) facts.push({ label: title(key.replace('Minutes', '')), value: `${recent[key]} min/week` })
    }
    for (const key of ['aerobicSessions', 'strengthSessions'] as const) {
      if (recent[key] !== undefined) facts.push({ label: title(key.replace('Sessions', ' sessions')), value: `${recent[key]}/week` })
    }
    if (recent.summary) facts.push({ label: 'Training context', value: recent.summary })
  }
  for (const limit of context.sessionLimits ?? []) facts.push({ label: `${days[limit.dayOfWeek]} session limit`, value: `${limit.maxMinutes} min` })
  if (context.weeklyTimeLimitMin !== undefined) facts.push({ label: 'Whole-week time limit', value: `${context.weeklyTimeLimitMin} min, including clubs` })
  for (const load of context.clubLoads ?? []) {
    const club = athlete.clubSessions.find(session => session.id === load.sessionId)
    facts.push({
      label: club?.title ?? load.sessionId,
      value: [
        load.durationMin === undefined ? 'Duration unknown' : `${load.durationMin} min`,
        load.effortRating === undefined ? 'Effort unknown' : `RPE ${load.effortRating}/10`,
      ].join('; '),
    })
  }
  return facts
}

function knownBlockMinutes(step: WorkoutStep): number | undefined {
  if (step.estimatedTotalMin !== undefined) return step.estimatedTotalMin
  // Legacy timed sets do not specify whether time is per-set or per-block.
  if (step.target?.sets !== undefined && step.target.sets !== 1) return undefined
  return step.target?.minutes ?? (step.target?.seconds === undefined ? undefined : step.target.seconds / 60)
}

function clockMinutes(date: string, startTime: string): number {
  const [hour, minute] = startTime.split(':').map(Number)
  return Date.parse(`${date}T00:00:00Z`) / 60_000 + hour! * 60 + minute!
}

export function summarizeWeekTraining(week: WeekPlan, athlete: AthleteProfile) {
  const context = week.planningContext ?? athlete.planningContext
  const workouts = week.workouts.filter(workout => workout.source !== 'club')
  const clubs: RecurringClubSession[] = athlete.clubSessions.map(session => ({
    ...session,
    durationMin: session.durationMin ?? context?.clubLoads?.find(load => load.sessionId === session.id)?.durationMin,
  }))
  for (const workout of week.workouts) {
    const fixed = workout.fixedClubSession
    if (fixed && !clubs.some(club => club.id === fixed.recurringSessionId)) {
      clubs.push({
        id: fixed.recurringSessionId, title: fixed.title, dayOfWeek: fixed.dayOfWeek,
        startTime: fixed.startTime, durationMin: workout.expectedDurationMin,
      })
    }
  }
  const unknownClubCount = clubs.filter(club => club.durationMin === undefined).length
  const clubMinutes = clubs.reduce((sum, club) => sum + (club.durationMin ?? 0), 0)
  const knownMinutes = workouts.reduce((sum, workout) => sum + workout.expectedDurationMin, clubMinutes)
  const reminders = clubs.filter(club => !week.workouts.some(workout => workout.fixedClubSession?.recurringSessionId === club.id))
  return { knownMinutes, clubMinutes, unknownClubCount, reminders, clubs }
}

export function reviewPlanQuality(
  week: WeekPlan,
  athlete: AthleteProfile,
  proposedContext?: PlanningContext,
): { quality: PlanQualitySummary; issues: ImportIssue[] } {
  const context = week.planningContext ?? athlete.planningContext
  const issues: ImportIssue[] = []
  const warn = (id: string, message: string, suggestion?: string) => {
    issues.push({ id, severity: 'warning', message, ...(suggestion ? { suggestion } : {}) })
  }
  const workouts = week.workouts.filter(workout => workout.source !== 'club')
  const requestedCounts = readGuidedSessionCounts(athlete.notes)
  if (categories.some(category => requestedCounts[category] === undefined)) warn('frequency-unknown', 'Desired session counts are not fully recorded. Preferred days are checked separately; they do not imply one session per day.')
  const { clubs, unknownClubCount, clubMinutes, knownMinutes } = summarizeWeekTraining(week, athlete)
  if (unknownClubCount) warn('club-duration-unknown', `${unknownClubCount} club session(s) have unknown duration. The weekly total is incomplete.`, 'Ask the AI to confirm club duration before adding more work.')
  if (!context?.recentTraining) warn('baseline-unknown', 'Recent training is unknown. Progression has not been assessed.', 'Tell the AI what you have actually done recently; available time is not a workload target.')
  if (!context?.sessionLimits?.length) warn('time-limits-unknown', 'No confirmed session time limits are available.')
  if (!week.goalAssessment || week.goalAssessment.status === 'unassessed') warn('goal-unassessed', 'Goal feasibility remains unassessed. A valid plan format does not establish readiness.')

  const recent = context?.recentTraining
  const recentValues = minuteKeys.flatMap(key => recent?.[key] === undefined ? [] : [recent[key]!])
  const baselineComplete = recentValues.length === minuteKeys.length
  const baselineMinutes = recentValues.length ? recentValues.reduce((sum, minutes) => sum + minutes, 0) : undefined
  const comparisons: JsonPreviewItem[] = []
  if (recent && context) comparisons.push({ label: 'Baseline date', value: `${context.asOf}; weekly averages over ${recent.weeks} weeks` })
  for (const category of categories) {
    const sessions = workouts.filter(workout => workout.category === category)
    const minutes = sessions.reduce((sum, workout) => sum + workout.expectedDurationMin, 0)
    const prior = recent?.[`${category}Minutes`]
    const expected = requestedCounts[category]
    comparisons.push({
      label: title(category),
      value: prior === undefined ? `${minutes} min proposed; recent time unknown` : `${prior} -> ${minutes} min (${minutes - prior >= 0 ? '+' : ''}${minutes - prior})`,
    })
    if (expected !== undefined && sessions.length !== expected) warn(`frequency-${category}`, `${title(category)}: ${sessions.length} sessions proposed versus ${expected} selected.`)
    const previousCount = category === 'aerobic' ? recent?.aerobicSessions : category === 'strength' ? recent?.strengthSessions : undefined
    if (previousCount !== undefined && sessions.length > previousCount) {
      warn(`new-frequency-${category}`, `${title(category)} frequency rises from ${previousCount} to ${sessions.length} sessions.`, 'Discuss how to introduce the extra session rather than filling every available minute.')
    }
  }
  comparisons.push({
    label: 'Club training',
    value: `${recent?.clubMinutes === undefined ? 'Recent time unknown' : `${recent.clubMinutes} min recently`}; ${clubMinutes} known minutes proposed${unknownClubCount ? ' + unknown time' : ''}`,
  })
  if (context?.weeklyTimeLimitMin !== undefined && knownMinutes > context.weeklyTimeLimitMin) {
    warn('weekly-time-limit', `Known training totals ${knownMinutes} min, above the agreed ${context.weeklyTimeLimitMin}-minute weekly limit.`)
  }

  let incompleteTimes = 0
  let unspecifiedLoads = 0
  for (const workout of workouts) {
    const day = localDateDayOfWeek(workout.scheduledDate)
    if (!athlete.preferredWeeklyStructure.some(slot => slot.dayOfWeek === day && slot.modalities.includes(workout.category))) {
      warn(`day-${workout.id}`, `${workout.title} is on ${days[day]}, outside the selected ${workout.category} days.`)
    }
    const cap = context?.sessionLimits?.find(limit => limit.dayOfWeek === day)?.maxMinutes
    if (cap !== undefined && workout.expectedDurationMin > cap) warn(`cap-${workout.id}`, `${workout.title}: ${workout.expectedDurationMin} min exceeds the ${cap}-minute session limit.`)
    const steps = [...workout.warmup, ...workout.main, ...workout.cooldown]
    const times = steps.map(knownBlockMinutes)
    if (times.some(time => time === undefined)) incompleteTimes++
    const minimumTime = times.reduce<number>((sum, time) => sum + (time ?? 0), 0)
    if (minimumTime > workout.expectedDurationMin + 0.01) {
      warn(`clock-${workout.id}`, `${workout.title}: known blocks total ${Math.round(minimumTime * 10) / 10} min, but the session is labelled ${workout.expectedDurationMin} min.`, 'Ask the AI to reconcile work, rests and transitions.')
    }
    for (const step of steps) {
      if (step.target?.loadKg !== undefined && step.target.loadBasis === undefined) unspecifiedLoads++
      const workMinutes = step.target?.minutes ?? (step.target?.seconds === undefined ? undefined : step.target.seconds / 60)
      if (step.estimatedTotalMin !== undefined && workMinutes !== undefined && step.estimatedTotalMin < workMinutes * (step.target?.sets ?? 1)) {
        warn(`block-${workout.id}-${step.id}`, `${step.title}: estimated block time is shorter than its timed work.`)
      }
    }
  }
  if (incompleteTimes) warn('time-estimates-incomplete', `${incompleteTimes} session(s) lack complete block-time estimates. Actual duration has not been verified.`)
  if (unspecifiedLoads) warn('load-basis-unknown', `${unspecifiedLoads} weighted exercise(s) do not specify per-implement versus total weight.`, 'Clarify the convention before comparing logged weights. Existing values have not been changed.')

  const slots = [
    ...workouts.flatMap(workout => workout.startTime ? [{
      id: `workout-${workout.id}`, title: workout.title,
      start: clockMinutes(workout.scheduledDate, workout.startTime), minutes: workout.expectedDurationMin,
    }] : []),
    ...clubs.filter(club => club.durationMin !== undefined).map(club => ({
      id: `club-${club.id}`, title: club.title,
      start: clockMinutes(addDaysToLocalDate(week.weekStart, (club.dayOfWeek - localDateDayOfWeek(week.weekStart) + 7) % 7), club.startTime),
      minutes: club.durationMin!,
    })),
  ].sort((left, right) => left.start - right.start)
  for (let first = 0; first < slots.length; first++) {
    for (let second = first + 1; second < slots.length; second++) {
      const left = slots[first]!
      const right = slots[second]!
      if (right.start < left.start + left.minutes) warn(`overlap-${left.id}-${right.id}`, `${left.title} overlaps ${right.title}.`)
    }
  }
  if (proposedContext && athlete.planningContext) {
    const old = athlete.planningContext
    const omitted: string[] = (['event', 'benchmarks', 'limitations', 'recentTraining', 'sessionLimits', 'weeklyTimeLimitMin', 'clubLoads'] as const)
      .filter(key => old[key] !== undefined && proposedContext[key] === undefined)
    if (old.recentTraining && proposedContext.recentTraining) {
      for (const key of [...minuteKeys, 'aerobicSessions', 'strengthSessions', 'summary'] as const) {
        if (old.recentTraining[key] !== undefined && proposedContext.recentTraining[key] === undefined) omitted.push(`recentTraining.${key}`)
      }
    }
    if (old.clubLoads && proposedContext.clubLoads) {
      for (const load of old.clubLoads) {
        const next = proposedContext.clubLoads.find(candidate => candidate.sessionId === load.sessionId)
        for (const key of ['durationMin', 'effortRating'] as const) {
          if (load[key] !== undefined && next?.[key] === undefined) omitted.push(`${load.sessionId}.${key}`)
        }
      }
    }
    if (omitted.length) warn('context-fields-removed', `The proposed context omits saved fields: ${omitted.join(', ')}.`, 'The displayed context replaces the previous snapshot on approval. Ask the AI to retain facts that still apply.')
  }
  return {
    quality: {
      knownMinutes, clubMinutes, unknownClubCount, baselineComplete,
      ...(baselineMinutes === undefined ? {} : { baselineMinutes }),
      comparisons,
      proposedFacts: proposedContext ? planningContextFacts(proposedContext, athlete) : [],
      ...(week.goalAssessment ? { goal: week.goalAssessment } : {}),
    },
    issues,
  }
}

export function buildPlanRevisionRequest(originalBrief: string, jsonText: string, issues: readonly ImportIssue[]): string {
  return [
    'Please revise this draft before I approve it. Preserve confirmed facts, selected days, available equipment and club commitments.',
    'Resolve the checks below. Compare proposed training with recent actual training by activity; time caps are ceilings, not targets. Explain any unresolved uncertainty in the goal assessment. Do not invent missing facts or promise an outcome.',
    ...issues.map(issue => `- ${issue.message}${issue.suggestion ? ` ${issue.suggestion}` : ''}`),
    'If there are no specific checks, discuss any changes I request before returning the final JSON.',
    'Original planning brief:', originalBrief,
    'Draft to revise:', jsonText,
    'When ready, return only the final JSON using the contract in the brief.',
  ].join('\n\n')
}
