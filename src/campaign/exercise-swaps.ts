import { buildAuthoredWeek } from '../../engine/authored-week.ts'
import type { AuthoredWorkoutBlock } from '../../engine/authored-week.ts'
import { availableExerciseMetadata, exerciseMetadata } from '../../engine/program.ts'
import type { CampaignState, CampaignWeek, CalendarAction } from './types.ts'
import type { WeekPlan } from '../../engine/types.ts'
import { campaignSessionOnHold, parseCampaign, stable } from './model.ts'
import { assertAuthoredEdit, proposalForSessions, refreshAuthoredCalendar } from './authored-calendar.ts'
import { policyForWeek } from './authored-policy.ts'

export type SwapReason = 'equipment' | 'preference' | 'difficulty'
export const SWAP_REASONS: Readonly<Record<SwapReason, string>> = {
  equipment: 'Equipment unavailable today', preference: 'Prefer another movement', difficulty: 'This movement was too difficult',
}

function preserveRecordedSessions(week: CampaignWeek, plan: WeekPlan, editedSessionId?: string): WeekPlan {
  return { ...plan, sessions: plan.sessions.map(session => {
    const original = week.logs[session.id] && week.plan.sessions.find(item => item.id === session.id)
    if (!original) return session
    if (session.id !== editedSessionId || original.kind !== 'workout' || session.kind !== 'workout') return original
    return { ...session, reason: original.reason, blocks: session.blocks.map((block, index) => {
      const previous = original.blocks[index]
      return block.unit === 'reps' && previous?.unit === 'reps' && previous.suggestedWeightKg !== undefined
        && week.logs[session.id]?.blockLogs?.some(log => log.blockIndex === index && log.unit === 'reps' && log.sets.length > 0)
        && block.exerciseId === previous.exerciseId && block.reps === previous.reps && block.targetRPE === previous.targetRPE
        && block.executionStyle === previous.executionStyle
        ? { ...block, suggestedWeightKg: previous.suggestedWeightKg } : block
    }) }
  }) }
}

export function swapChoices(state: CampaignState, sessionId: string, blockIndex: number) {
  const week = state.weeks[state.selectedWeek]
  const session = week?.plan.sessions.find(item => item.id === sessionId)
  if (!week || session?.kind !== 'workout') throw new Error('Choose an exercise in a current workout.')
  const block = session.blocks[blockIndex]
  if (!block || block.unit === 'throws') throw new Error('Practice drill changes require a reviewed practice proposal.')
  const current = exerciseMetadata(block.exerciseId, week.input.library)
  return availableExerciseMetadata(week.input.athlete.program?.resources ?? [], week.input.library)
    .filter(item => item.id !== block.exerciseId && item.profile.prescription.unit === block.unit
      && item.template === current.template && item.execution.style === current.execution.style)
    .map(item => ({ id: item.id, name: week.input.library.exercises.find(exercise => exercise.id === item.id)!.name }))
}

export function swapWorkoutExercise(
  state: CampaignState, sessionId: string, blockIndex: number, replacementId: string,
  reason: SwapReason, preferInFuture: boolean,
): CampaignState {
  if (state.selectedWeek !== state.weeks.length - 1) throw new Error('Earlier weeks cannot be changed.')
  if (!Object.hasOwn(SWAP_REASONS, reason) || typeof preferInFuture !== 'boolean') throw new Error('Choose why this exercise is changing.')
  const week = state.weeks[state.selectedWeek]!
  const options = policyForWeek(week)
  const session = week.plan.sessions.find(item => item.id === sessionId)
  if (session?.kind !== 'workout' || session.sourceCommitmentId) throw new Error('Choose a lifting or mobility card, not a fixed practice.')
  if (campaignSessionOnHold(state, session)) throw new Error('A pain or health hold cannot be cleared by swapping exercises.')
  const log = week.logs[sessionId]
  if (log && log.status !== 'partial') throw new Error('A finished session cannot be rewritten.')
  const block = session.blocks[blockIndex]
  if (!block || block.unit === 'throws' || !swapChoices(state, sessionId, blockIndex).some(item => item.id === replacementId)) {
    throw new Error('Choose a supported, equipped alternative with the same movement and execution profile.')
  }
  const actual = log?.blockLogs?.find(item => item.blockIndex === blockIndex)
  if (actual && actual.unit !== 'reps') throw new Error('A recorded timed block is preserved. Swap a block that has not been recorded.')
  const performedSets = actual?.unit === 'reps' ? actual.sets.length : 0
  if (performedSets >= block.sets) throw new Error('All prescribed sets for this exercise are already recorded.')
  const dose = exerciseMetadata(replacementId, week.input.library).profile.prescription
  let replacement: AuthoredWorkoutBlock
  if (block.unit === 'reps' && dose.unit === 'reps') {
    if (dose.reps === undefined || dose.targetRPE === undefined) throw new Error('The alternative has an incomplete repetition profile.')
    replacement = {
      unit: 'reps', exerciseId: replacementId,
      sets: options.policy === 'ai-advisory' ? block.sets - performedSets : Math.min(block.sets - performedSets, dose.sets),
      reps: options.policy === 'ai-advisory' ? block.reps : Math.min(block.reps, dose.reps),
      targetRPE: options.policy === 'ai-advisory' ? block.targetRPE : block.targetRPE < dose.targetRPE ? block.targetRPE : dose.targetRPE,
    }
  } else if (block.unit === 'seconds' && dose.unit === 'seconds') {
    if (dose.seconds === undefined) throw new Error('The alternative has an incomplete timed profile.')
    replacement = { unit: 'seconds', exerciseId: replacementId,
      sets: options.policy === 'ai-advisory' ? block.sets : Math.min(block.sets, dose.sets),
      seconds: options.policy === 'ai-advisory' ? block.seconds : Math.min(block.seconds, dose.seconds) }
  } else throw new Error('A swap cannot change logging units.')
  const before = week.authored ?? proposalForSessions(week.plan.weekStart, week.plan.sessions, options)
  const removedIds = new Set(week.removed.map(item => item.id))
  const proposal = {
    ...before, sessions: before.sessions.filter(item => !removedIds.has(item.id)).map(item => {
      if (item.id !== sessionId || item.kind !== 'workout') return item
      const blocks = [...item.blocks]
      if (performedSets) {
        const original = blocks[blockIndex]
        if (!original || original.unit !== 'reps') throw new Error('The recorded exercise does not match the approved block.')
        blocks[blockIndex] = { ...original, sets: performedSets }
        blocks.push(replacement)
      } else blocks[blockIndex] = replacement
      return { ...item, blocks }
    }),
  }
  const planned = preserveRecordedSessions(week, buildAuthoredWeek(week.input, proposal, options), sessionId)
  if (!planned.safety.passed) throw new Error(`This swap does not fit the remaining week: ${planned.safety.violations.map(item => item.message).join(' ')}`)
  for (const existing of week.plan.sessions) {
    if (existing.id !== sessionId && week.logs[existing.id]) {
      const next = planned.sessions.find(item => item.id === existing.id)
      if (!next || next.date !== existing.date || next.startTime !== existing.startTime || next.durationMin !== existing.durationMin
        || ('blocks' in existing && (!('blocks' in next) || stable(existing.blocks) !== stable(next.blocks)))) {
        throw new Error('This swap would change already recorded work elsewhere in the week.')
      }
    }
  }
  const oldName = week.input.library.exercises.find(item => item.id === block.exerciseId)!.name
  const newName = week.input.library.exercises.find(item => item.id === replacementId)!.name
  const message = `${oldName} -> ${newName}: ${SWAP_REASONS[reason]}. ${preferInFuture ? 'Prefer this replacement in future proposals.' : 'This session only.'} Logged work is unchanged; no working weight was copied.`
  const changed = refreshAuthoredCalendar({
    ...week, authored: proposal, plan: { ...planned, sessions: planned.sessions.filter(item => !removedIds.has(item.id)) },
    removed: week.removed,
    authoredHistory: [...(week.authoredHistory ?? []),
      ...(!week.authored ? week.removed.map(item => ({ proposal: proposalForSessions(week.plan.weekStart, [item]), reason: 'Retained removed work from the original calendar.' })) : []),
      { proposal: before, reason: message }],
    changes: [...week.changes, { id: `change-${week.plan.weekIndex}-${week.changes.length + 1}`, message }],
  })
  if (!changed.plan.safety.passed) throw new Error(`This swap conflicts with recorded actuals: ${changed.plan.safety.violations.map(item => item.message).join(' ')}`)
  assertAuthoredEdit(week, changed)
  const setDrafts = { ...state.setDrafts }
  if (!performedSets) {
    for (const key of Object.keys(setDrafts)) if (key.startsWith(`${sessionId}:block-${blockIndex}:`)) delete setDrafts[key]
  }
  return parseCampaign({ ...state, setDrafts, weeks: state.weeks.map((item, index) => index === state.selectedWeek ? changed : item) })
}

export function adaptAuthoredCampaign(state: CampaignState, action: CalendarAction, notBeforeDate?: string): CampaignState {
  if (state.selectedWeek !== state.weeks.length - 1) throw new Error('Earlier weeks are read-only.')
  const week = state.weeks[state.selectedWeek]!
  if (!week.authored) throw new Error('This action requires an authored week.')
  const session = week.plan.sessions.find(item => item.id === action.sessionId)
  if (!session) throw new Error('This session is no longer in the current calendar.')
  if (week.logs[session.id]) throw new Error('Started or finished work cannot be moved, skipped or removed.')
  if (action.type === 'move') {
    if (notBeforeDate && action.date < notBeforeDate) throw new Error('A session cannot be moved into the past.')
    if (session.kind === 'commitment' || (session.kind === 'workout' && session.sourceCommitmentId)) throw new Error('Club training is a fixed commitment.')
    const removedIds = new Set(week.removed.map(item => item.id))
    const authored = { ...week.authored, sessions: week.authored.sessions.filter(item => !removedIds.has(item.id)).map(item => item.id === session.id ? { ...item, date: action.date, startTime: action.startTime } : item) }
    const planned = preserveRecordedSessions(week, buildAuthoredWeek(week.input, authored, policyForWeek(week)))
    if (!planned.safety.passed) throw new Error(planned.safety.violations.map(item => item.message).join(' '))
    const removed = new Set(week.removed.map(item => item.id))
    const next = refreshAuthoredCalendar({
      ...week, authored, plan: { ...planned, sessions: planned.sessions.filter(item => !removed.has(item.id)) },
      authoredHistory: [...(week.authoredHistory ?? []), { proposal: week.authored, reason: 'Moved unperformed work after rechecking the week.' }],
      changes: [...week.changes, { id: `change-${week.plan.weekIndex}-${week.changes.length + 1}`, message: `Moved ${session.id} to ${action.date} ${action.startTime}.` }],
    })
    assertAuthoredEdit(week, next)
    return parseCampaign({ ...state, weeks: state.weeks.map((item, index) => index === state.selectedWeek ? next : item) })
  }
  const message = action.type === 'delete' ? 'Removed unperformed work; no completion or fatigue inferred.'
    : action.reason === 'life' ? 'Skipped for time; no catch-up work or fatigue inferred.'
      : policyForWeek(week).policy === 'ai-advisory'
        ? 'Skipped for fatigue. Other prescribed quantities are unchanged; fatigue remains a report for the next review.'
        : 'Skipped for fatigue; carried workload caps inform the next week. Review the remaining work before continuing.'
  const next = refreshAuthoredCalendar({
    ...week,
    authored: { ...week.authored, sessions: week.authored.sessions.filter(item => item.id !== session.id && !week.removed.some(removed => removed.id === item.id)) },
    authoredHistory: [...(week.authoredHistory ?? []), { proposal: week.authored, reason: message }],
    plan: { ...week.plan, sessions: week.plan.sessions.filter(item => item.id !== session.id) },
    removed: [...week.removed, session],
    logs: action.type === 'skip' ? { ...week.logs, [session.id]: { sessionId: session.id, status: 'skipped', skipReason: action.reason, painFlag: false, notes: '' } } : week.logs,
    changes: [...week.changes, { id: `change-${week.plan.weekIndex}-${week.changes.length + 1}`, message }],
  })
  return parseCampaign({ ...state, weeks: state.weeks.map((item, index) => index === state.selectedWeek ? next : item) })
}
