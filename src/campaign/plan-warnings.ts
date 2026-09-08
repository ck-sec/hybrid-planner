import type { WeekPlan } from '../../engine/types.ts'

/** Keep saved warning evidence intact while omitting an irrelevant legacy feature explanation. */
export function displayPlanWarnings(plan: Pick<WeekPlan, 'warnings' | 'sessions'>): readonly string[] {
  const hasThrowing = plan.sessions.some(session => session.kind === 'workout'
    && session.blocks.some(block => block.unit === 'throws'))
  return plan.warnings.map(warning => !hasThrowing
    && warning.startsWith('Timed work and controlled throws keep their own units.')
    ? 'Timed work is recorded in seconds, separately from repetition-based work.'
    : warning)
}
