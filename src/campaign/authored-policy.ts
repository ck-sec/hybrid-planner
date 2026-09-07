import { AI_ADVISORY_POLICY_VERSION } from '../../engine/constants.ts'
import type { ValidationOptions } from '../../engine/validation.ts'
import type { CampaignWeek } from './types.ts'

export const AI_PLANNING_OPTIONS = Object.freeze({ policy: 'ai-advisory' as const })

export function authoredPolicyOptions(policyVersion: unknown): ValidationOptions {
  return policyVersion === AI_ADVISORY_POLICY_VERSION ? AI_PLANNING_OPTIONS : {}
}

export function policyForWeek(week: CampaignWeek): ValidationOptions {
  return authoredPolicyOptions(week.plan.policyVersion)
}
