import { ENGINE_VERSION } from './types.ts'
import type { Baseline, Day, PlannerInput, ScheduledSession, Session, WeekPlan } from './types.ts'
import { parsePlannerInput } from './validation.ts'

export const SAFETY_RULES = [
  'Only available days; at most one session per day.',
  'At least one day without a planned session in each week.',
  'At least one intervening calendar day between full-body lifts, including a repeated-week boundary.',
  'Respect full-body lifts on the preceding Sunday and following Monday in saved neighboring weeks.',
  'Never exceed established weekly running minutes or longest-run minutes.',
  'Keep each run at its original easy duration; never redistribute omitted minutes.',
  'Repeat only the established lifting template and frequency; never increase sets, reps, or load.',
] as const

function requestedSessions(baseline: Baseline): Session[] {
  const sessions: Session[] = []
  const shortMinutes = Math.floor(baseline.weeklyRunMinutes / baseline.runsPerWeek)
  const remainder = baseline.weeklyRunMinutes % baseline.runsPerWeek
  for (let i = 0; i < baseline.runsPerWeek; i++) {
    sessions.push({
      id: `run-${i + 1}`,
      kind: 'run',
      minutes: shortMinutes + (i >= baseline.runsPerWeek - remainder ? 1 : 0),
      effort: 'easy',
    })
  }
  for (let i = 0; i < baseline.liftsPerWeek; i++) {
    sessions.push({
      id: `lift-${i + 1}`,
      kind: 'lift',
      exercises: baseline.exercises.map(exercise => ({ ...exercise })),
    })
  }
  return sessions
}

function circularGap(a: Day, b: Day): number {
  const distance = Math.abs(a - b)
  return Math.min(distance, 7 - distance)
}

// A preference, never a safety term: spread training, with extra spacing for lifts.
export function scorePlacement(sessions: readonly ScheduledSession[]): number {
  let score = 0
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const left = sessions[i]
      const right = sessions[j]
      score += circularGap(left.day, right.day)
        * (left.kind === 'lift' && right.kind === 'lift' ? 2 : 1)
    }
  }
  return score
}

export function safetyViolations(
  input: PlannerInput,
  sessions: readonly ScheduledSession[],
): string[] {
  const violations = new Set<string>()
  const { baseline, boundary } = input
  const expected = new Map(requestedSessions(baseline).map(session => [session.id, session]))
  const days = new Set<Day>()
  const ids = new Set<string>()
  const lifts: ScheduledSession[] = []
  let runningMinutes = 0
  let runCount = 0

  for (const session of sessions) {
    if (!baseline.availableDays.includes(session.day) || days.has(session.day)) violations.add(SAFETY_RULES[0])
    days.add(session.day)
    if (ids.has(session.id)) violations.add('Each requested session can appear only once.')
    ids.add(session.id)
    const original = expected.get(session.id)
    if (!original || original.kind !== session.kind) {
      violations.add('Only the requested baseline sessions may be scheduled.')
      continue
    }
    if (session.kind === 'run' && original.kind === 'run') {
      runCount++
      runningMinutes += session.minutes
      if (!Number.isInteger(session.minutes) || session.minutes < 1 || session.minutes > baseline.longestRunMinutes) {
        violations.add(SAFETY_RULES[4])
      }
      if (session.minutes !== original.minutes || session.effort !== 'easy') violations.add(SAFETY_RULES[5])
    } else if (session.kind === 'lift' && original.kind === 'lift') {
      lifts.push(session)
      if (session.exercises.length !== original.exercises.length
        || session.exercises.some((exercise, index) => {
          const established = original.exercises[index]
          return !established || exercise.name !== established.name || exercise.sets !== established.sets
            || exercise.reps !== established.reps || exercise.loadKg !== established.loadKg
        })) violations.add(SAFETY_RULES[6])
      if ((session.day === 0 && boundary.previousSundayLift) || (session.day === 6 && boundary.nextMondayLift)) {
        violations.add(SAFETY_RULES[3])
      }
    }
  }

  if (days.size > 6) violations.add(SAFETY_RULES[1])
  if (runningMinutes > baseline.weeklyRunMinutes || runCount > baseline.runsPerWeek) violations.add(SAFETY_RULES[4])
  if (lifts.length > baseline.liftsPerWeek) violations.add(SAFETY_RULES[6])
  for (let i = 0; i < lifts.length; i++) {
    for (let j = i + 1; j < lifts.length; j++) {
      if (circularGap(lifts[i].day, lifts[j].day) < 2) violations.add(SAFETY_RULES[2])
    }
  }
  return [...violations]
}

function placementKey(sessions: readonly ScheduledSession[]): string {
  return [...sessions]
    .sort((a, b) => a.day - b.day)
    .map(session => `${session.day}:${session.id}`)
    .join('|')
}

interface RankedCandidate {
  sessions: ScheduledSession[]
  score: number
  key: string
}

export function generateWeek(rawInput: PlannerInput): WeekPlan {
  const input = parsePlannerInput(rawInput)
  const requested = requestedSessions(input.baseline)
  const days = input.baseline.availableDays
  let candidateCount = 0
  let rejectedCandidateCount = 0
  const rejectedRules = new Set<string>()
  let selected: RankedCandidate | undefined

  // Maximize retained sessions first. Within each count, score each candidate
  // before the independent safety veto. A better score can never waive a rule.
  for (let count = Math.min(requested.length, days.length); count >= 0; count--) {
    const best: { value: RankedCandidate | undefined } = { value: undefined }
    const candidate: ScheduledSession[] = []
    const usedDays = new Set<Day>()

    function enumerate(index: number): void {
      if (candidate.length === count) {
        candidateCount++
        const score = scorePlacement(candidate)
        const violations = safetyViolations(input, candidate)
        if (violations.length) {
          rejectedCandidateCount++
          violations.forEach(rule => rejectedRules.add(rule))
          return
        }
        const key = placementKey(candidate)
        if (!best.value || score > best.value.score || (score === best.value.score && key < best.value.key)) {
          best.value = {
            sessions: [...candidate].sort((a, b) => a.day - b.day),
            score,
            key,
          }
        }
        return
      }
      if (index >= requested.length || requested.length - index < count - candidate.length) return
      const session = requested[index]
      for (const day of days) {
        if (usedDays.has(day)) continue
        usedDays.add(day)
        candidate.push({ ...session, day })
        enumerate(index + 1)
        candidate.pop()
        usedDays.delete(day)
      }
      enumerate(index + 1)
    }

    enumerate(0)
    if (best.value) {
      selected = best.value
      break
    }
  }

  if (!selected) throw new Error('Planner invariant failed: an empty week must satisfy the safety floor.')
  const finalViolations = safetyViolations(input, selected.sessions)
  if (finalViolations.length) throw new Error(`Planner safety invariant failed: ${finalViolations.join(' ')}`)

  const scheduledIds = new Set(selected.sessions.map(session => session.id))
  const omitted = requested.filter(session => !scheduledIds.has(session.id))
  const notes = [
    'Maintenance only: this is a repeat of an established baseline, not progression, rehabilitation, or a return-to-training prescription.',
    `Running starts as ${input.baseline.weeklyRunMinutes} minutes divided as evenly as possible over ${input.baseline.runsPerWeek} easy runs. Any remainder is added one minute at a time to the last run IDs.`,
    'Every lift repeats your full-body template unchanged. A load of 0 kg means no added load.',
    'The engine retains as many sessions as constraints allow, then prefers wider spacing (double weight between lifts). Equal scores use the alphabetically first day:session-ID sequence.',
    'Every candidate is scored before the safety floor is applied as a veto. The returned week is checked again.',
    'Calendar-day separation does not guarantee 48 hours between lifting sessions. Choose times with recovery in mind.',
    'Logs never increase future work. Resting or skipping a session creates no catch-up debt.',
  ]
  if (omitted.length) {
    notes.push(`${omitted.length} requested session${omitted.length === 1 ? '' : 's'} could not fit: ${omitted.map(session => session.id).join(', ')}. Their work is not moved into other sessions.`)
    if (requested.length > days.length) notes.push('There are fewer available days than requested sessions; this version does not schedule double days.')
    if (rejectedRules.size) notes.push(`Candidate safety constraints encountered: ${[...rejectedRules].join(' ')}`)
  }
  return {
    engineVersion: ENGINE_VERSION,
    input,
    sessions: selected.sessions,
    omitted,
    notes,
    audit: {
      candidateCount,
      rejectedCandidateCount,
      placementScore: selected.score,
      safetyRules: [...SAFETY_RULES],
    },
  }
}
