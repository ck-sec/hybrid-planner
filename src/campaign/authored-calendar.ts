import { buildAuthoredWeek, parseAuthoredWeekProposal, validateAuthoredSessions } from '../../engine/authored-week.ts'
import { scoreSessions } from '../../engine/scoring.ts'
import { planWeek } from '../../engine/planner.ts'
import { parseSessionWithOptions, parseSessionLogWithOptions, validateBlockLogs } from '../../engine/validation.ts'
import type { PlanWeekInput, SessionLog, WeekPlan } from '../../engine/types.ts'
import type { CampaignWeek } from './types.ts'
import { parseSessionFeedback } from './training-feedback.ts'
import { stable } from './model.ts'
import type { AuthoredSessionProposal, AuthoredWeekProposal } from '../../engine/authored-week.ts'
import type { Session } from '../../engine/types.ts'
import type { ValidationOptions } from '../../engine/validation.ts'
import { authoredPolicyOptions, policyForWeek } from './authored-policy.ts'

export function proposalForSessions(weekStart: string, sessions: readonly Session[], options: ValidationOptions = {}): AuthoredWeekProposal {
  const proposed: AuthoredSessionProposal[] = sessions.filter(session => session.kind !== 'commitment').map(session => {
    if (session.startTime === null) throw new Error('Confirm this session start time before creating an authored revision.')
    const base = {
      id: session.id, date: session.date, startTime: session.startTime, durationMin: session.durationMin,
      label: 'label' in session ? session.label : session.kind === 'run' ? 'Easy run' : 'Strength session',
    }
    if (session.kind === 'run') return { ...base, kind: 'run', modality: session.modality, intent: session.endurancePrescription.intent }
    if (session.kind === 'conditioning') return { ...base, kind: 'conditioning', modality: session.modality }
    if (session.kind === 'strength') return {
      ...base, kind: 'workout', blocks: session.strengthPrescription.map(item => ({
        unit: 'reps', exerciseId: item.exerciseId, sets: item.sets, reps: item.reps, targetRPE: item.targetRPE,
      })),
    }
    return {
      ...base, kind: 'workout', ...(session.sourceCommitmentId ? { sourceCommitmentId: session.sourceCommitmentId } : {}),
      blocks: session.blocks.map(block => block.unit === 'throws'
        ? { unit: 'throws', drillId: block.drillId, throws: block.throws }
        : block.unit === 'reps'
          ? { unit: 'reps', exerciseId: block.exerciseId, sets: block.sets, reps: block.reps, targetRPE: block.targetRPE }
          : { unit: 'seconds', exerciseId: block.exerciseId, sets: block.sets, seconds: block.seconds }),
    }
  })
  return parseAuthoredWeekProposal({ version: 1, weekStart, sessions: proposed }, options)
}

function same(left: unknown, right: unknown): boolean {
  return stable(left) === stable(right)
}

function samePrescription(left: Session, right: Session | undefined): boolean {
  if (!right) return false
  const { reason: leftReason, ...leftPrescription } = left
  const { reason: rightReason, ...rightPrescription } = right
  void leftReason; void rightReason
  return same(leftPrescription, rightPrescription)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}

function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} must be an array of at most ${max} entries.`)
  return value
}

function actualsFor(week: CampaignWeek) {
  return Object.fromEntries(Object.entries(week.logs).filter(([, log]) => log.status !== 'skipped'))
}

function fixedTombstones(week: CampaignWeek) {
  return week.removed.filter(session => session.kind === 'commitment' || (session.kind === 'workout' && session.sourceCommitmentId))
}

function loggedPins(week: CampaignWeek, sessions: readonly Session[]) {
  const pins = new Map(sessions.map(session => [session.id, { ...session, pinned: true }]))
  for (const session of week.input.context.pinnedSessions) pins.set(session.id, session)
  return [...pins.values()]
}

export function assertAuthoredEdit(before: CampaignWeek, after: CampaignWeek): void {
  const logs = actualsFor(before)
  const pins = before.plan.sessions.filter(session => Object.hasOwn(logs, session.id))
  const input = { ...before.input, context: { ...before.input.context, pinnedSessions: loggedPins(before, pins) } }
  const safety = validateAuthoredSessions(input, [
    ...after.plan.sessions.map(session => Object.hasOwn(logs, session.id) ? { ...session, pinned: true } : session),
    ...fixedTombstones(after),
  ], logs, { ...policyForWeek(before), allowPartialWorkoutAmendments: true })
  if (!safety.passed) throw new Error(`The remaining week conflicts with recorded actuals: ${safety.violations.map(item => item.message).join(' ')}`)
}

export function refreshAuthoredCalendar(week: CampaignWeek): CampaignWeek {
  if (!week.authored) throw new Error('This calendar has no reviewed authored-week contract.')
  const options = policyForWeek(week)
  const canonical = buildAuthoredWeek(week.input, week.authored, options)
  if (!canonical.safety.passed) throw new Error(`The proposed week fails app checks: ${canonical.safety.violations.map(item => item.message).join(' ')}`)
  const penalties = scoreSessions(week.input, week.plan.sessions)
  const painful = [...week.plan.sessions, ...week.removed].filter(session => week.logs[session.id]?.painFlag)
  const logs = actualsFor(week)
  const sessions = week.plan.sessions.map(session => Object.hasOwn(logs, session.id) ? { ...session, pinned: true } : session)
  const actualSafety = validateAuthoredSessions({
    ...week.input, context: { ...week.input.context, pinnedSessions: loggedPins(week, sessions.filter(session => Object.hasOwn(logs, session.id))) },
  }, [...sessions, ...fixedTombstones(week)], logs, { ...options, allowPartialWorkoutAmendments: true })
  const actualChecks = { passed: actualSafety.passed, violations: actualSafety.violations }
  const safety = painful.length && options.policy !== 'ai-advisory' ? {
    passed: false,
    violations: [{ rule: 'calendarPainHold', sessionIds: painful.map(session => session.id), message: 'Pain was reported. Further training is on hold; changing exercises does not clear it.' }],
  } : actualChecks
  return {
    ...week,
    plan: {
      ...canonical, sessions: week.plan.sessions, penalties,
      totalScore: penalties.reduce((sum, penalty) => sum + penalty.score, 0),
      safety, feasibility: { fits: safety.passed, issues: safety.violations.map(item => item.message), suggestions: [] },
      warnings: [...new Set([...canonical.warnings, ...safety.violations.map(item => item.message),
        ...(actualSafety.advisories ?? []).map(item => `[${item.rule}] ${item.sessionIds.length ? `${item.sessionIds.join(', ')}: ` : ''}${item.message}`),
        ...(painful.length && options.policy === 'ai-advisory'
          ? ['Pain was reported and remains recorded. Review it before further training; approving or editing the week is not medical clearance.'] : []),
      ])],
    },
  }
}

export function parseAuthoredCalendar(raw: Record<string, unknown>, input: PlanWeekInput): CampaignWeek {
  const stored = object(raw.plan, 'Authored calendar')
  const options = authoredPolicyOptions(stored.policyVersion)
  const authored = parseAuthoredWeekProposal(raw.authored, options)
  const canonical = buildAuthoredWeek(input, authored, options)
  if (!canonical.safety.passed) throw new Error(`The saved authored week fails app checks: ${canonical.safety.violations.map(item => item.message).join(' ')}`)
  const sessions = list(stored.sessions, 'Authored sessions', 64).map(value => parseSessionWithOptions(value, options))
  const removed = list(raw.removed, 'Removed authored sessions', 64).map(value => parseSessionWithOptions(value, options))
  const all = [...sessions, ...removed]
  const authoredHistory = Object.hasOwn(raw, 'authoredHistory')
    ? list(raw.authoredHistory, 'Authored prescription history', 200).map(value => {
      const item = object(value, 'Authored revision')
      if (Object.keys(item).length !== 2 || typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 500) {
        throw new Error('A prescription revision needs a bounded reason.')
      }
      const proposal = parseAuthoredWeekProposal(item.proposal, options)
      const historical = buildAuthoredWeek(input, proposal, options)
      if (!historical.safety.passed) throw new Error('A retained prescription revision fails app checks.')
      return { proposal, reason: item.reason }
    }) : undefined
  const historicalSessions = (authoredHistory ?? []).flatMap(item => buildAuthoredWeek(input, item.proposal, options).sessions)
  let builtIn: WeekPlan | undefined
  const matchesApproved = (session: Session, approved: Session | undefined): boolean => {
    if (samePrescription(session, approved)) return true
    if (session.kind !== 'workout' || approved?.kind !== 'workout') return false
    if (options.policy === 'ai-advisory') return false
    builtIn ??= planWeek(input)
    const original = builtIn.sessions.find(item => item.id === session.id)
    if (original?.kind !== 'workout') return false
    const blocks = session.blocks.map((block, index) => {
      const canonicalBlock = approved.blocks[index]
      const originalBlock = original.blocks[index]
      if (block.unit !== 'reps' || canonicalBlock?.unit !== 'reps' || originalBlock?.unit !== 'reps'
        || canonicalBlock.suggestedWeightKg !== undefined || block.suggestedWeightKg === undefined
        || block.suggestedWeightKg !== originalBlock.suggestedWeightKg || block.exerciseId !== originalBlock.exerciseId
        || block.reps !== originalBlock.reps || block.targetRPE !== originalBlock.targetRPE
        || block.executionStyle !== originalBlock.executionStyle) return block
      // The wire proposal cannot supply weights. Preserve only the exact suggestion
      // independently reproduced by this week's original built-in plan.
      const { suggestedWeightKg, ...prescription } = block
      void suggestedWeightKg
      return prescription
    })
    return samePrescription({ ...session, blocks }, approved)
  }
  if (new Set(all.map(session => session.id)).size !== all.length
    || [...canonical.sessions, ...historicalSessions].some(session => !all.some(item => item.id === session.id))) {
    throw new Error('Authored sessions must retain every approved identity exactly once.')
  }
  for (const session of sessions) {
    if (!matchesApproved(session, canonical.sessions.find(item => item.id === session.id))) {
      throw new Error('An authored session differs from its approved prescription. Review a revision before changing it.')
    }
  }
  for (const session of removed) {
    if (![...canonical.sessions, ...historicalSessions].some(item => matchesApproved(session, item))) {
      throw new Error('A removed session must retain its previously approved prescription.')
    }
  }
  const logs: Record<string, SessionLog> = {}
  for (const [id, value] of Object.entries(object(raw.logs, 'Authored session logs'))) {
    const session = all.find(item => item.id === id)
    const log = parseSessionLogWithOptions(value, options)
    if (!session || id !== log.sessionId
      || (log.status === 'skipped' ? !removed.some(item => item.id === id) : !sessions.some(item => item.id === id))) {
      throw new Error('An authored log does not match its session identity and status.')
    }
    if (log.status === 'completed' && (log.actualDurationMin === undefined || log.actualEffort === undefined)) {
      throw new Error('Finished sessions need explicitly recorded duration and effort.')
    }
    validateBlockLogs(session, log, options)
    if (log.sets) {
      if (session.kind !== 'strength') throw new Error('Set logs require a strength session.')
      for (const set of log.sets) {
        if (!session.strengthPrescription.some(item => item.exerciseId === set.exerciseId)) throw new Error('A set references a different exercise.')
      }
    }
    Object.defineProperty(logs, id, { value: log, enumerable: true, writable: true, configurable: true })
  }
  const changes = list(raw.changes, 'Authored changes', 10000).map(value => {
    const item = object(value, 'Authored change')
    if (Object.keys(item).length !== 2 || typeof item.id !== 'string' || !item.id || item.id.length > 80
      || typeof item.message !== 'string' || item.message.length > 4000) throw new Error('Invalid authored calendar change.')
    return { id: item.id, message: item.message }
  })
  if (new Set(changes.map(item => item.id)).size !== changes.length) throw new Error('Calendar change IDs must be unique.')
  const feedback: NonNullable<CampaignWeek['feedback']> = {}
  if (Object.hasOwn(raw, 'feedback')) {
    for (const [id, value] of Object.entries(object(raw.feedback, 'Session feedback'))) {
      if (!Object.hasOwn(logs, id) || logs[id]?.status !== 'completed') throw new Error('Feedback requires a finished session.')
      Object.defineProperty(feedback, id, { value: parseSessionFeedback(value), enumerable: true, writable: true, configurable: true })
    }
  }
  const week = refreshAuthoredCalendar({
    input, authored, plan: { ...canonical, sessions }, logs, removed, changes,
    ...(Object.hasOwn(raw, 'feedback') ? { feedback } : {}), ...(authoredHistory ? { authoredHistory } : {}),
  })
  // Warnings and intent can include user-reviewed context; computed fields cannot.
  const { warnings, intent, ...derived } = week.plan
  const { warnings: savedWarnings, intent: savedIntent, ...savedDerived } = stored
  void warnings; void intent
  if (!same(savedDerived, derived) || typeof savedIntent !== 'string' || savedIntent.length > 4000
    || !Array.isArray(savedWarnings) || savedWarnings.length > 200
    || savedWarnings.some(value => typeof value !== 'string' || value.length > 8000)
    || (options.policy === 'ai-advisory' && warnings.some(warning => !savedWarnings.includes(warning)))) {
    throw new Error('The stored authored calendar does not match its independently checked values.')
  }
  return { ...week, plan: { ...week.plan, intent: savedIntent, warnings: savedWarnings } }
}
