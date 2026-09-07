import { CONTROLLED_TARGET_THROW_PROFILE, LIMITS } from '../../engine/constants.ts'
import { parseCustomExercise, parseCustomSportDrill, parseProgramConfigWithOptions } from '../../engine/validation.ts'
import { availableSportDrills } from '../../engine/program.ts'
import type { CustomExerciseSpec } from '../../engine/types.ts'
import { AssistantError } from './assistant.ts'
import { programResourcesForResources, resourcesForEquipment } from './equipment.ts'
import type { ResourceId } from './equipment.ts'
import type { CampaignDraft } from './types.ts'
import { AI_PLANNING_OPTIONS } from './authored-policy.ts'

export const MAX_PROPOSED_CUSTOM_EXERCISES = LIMITS.maxCustomExercises
export const MAX_PROPOSED_CUSTOM_SPORT_DRILLS = CONTROLLED_TARGET_THROW_PROFILE.maxDefinitions

export function nextCustomExerciseId(name: string, existing: readonly CustomExerciseSpec[]): string {
  if (typeof name !== 'string' || !name.trim() || name.length > 80 || /[\p{Cc}\p{Cf}]|<[^>]*>/u.test(name)) {
    throw new AssistantError('Use a plain exercise name of 1–80 characters.')
  }
  const slug = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!slug) throw new AssistantError('Include a letter or number in the exercise name to create its portable identity.')
  const base = `custom-${slug}`.slice(0, 80).replace(/-$/, '')
  const used = new Set(existing.map(item => item.id))
  if (!used.has(base)) return base
  for (let revision = 2; revision <= existing.length + 2; revision++) {
    const suffix = `-${revision}`
    const id = `${base.slice(0, 80 - suffix.length).replace(/-$/, '')}${suffix}`
    if (!used.has(id)) return id
  }
  throw new AssistantError('Choose a different name for this exercise revision.')
}

function entries(value: unknown, maximum = MAX_PROPOSED_CUSTOM_EXERCISES, label = 'custom exercise definitions'): unknown[] {
  if (!Array.isArray(value) || value.length > maximum
    || Object.getPrototypeOf(value) !== Array.prototype
    || Reflect.ownKeys(value).length !== value.length + 1) {
    throw new AssistantError(`Propose an array of at most ${maximum} ${label} per reply, without extra fields.`)
  }
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index)
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw new AssistantError('Custom exercise definitions must be a complete array.')
    }
    return descriptor.value
  })
}

// This detects explicit prescriptions, not whether a technique or profile fit is safe.
export function assertNonPrescriptiveText(...parts: string[]): void {
  const text = parts.join('\n')
  const quantity = String.raw`(?:\d+(?:[.,]\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|hundred)`
  const units = String.raw`(?:sets?|reps?|repetitions?|kg|kilograms?|lb|lbs|pounds?|seconds?|secs?|minutes?|mins?|hours?|throws?|rounds?|days?|weeks?)`
  if (new RegExp(String.raw`\b${quantity}\s*(?:[-–]\s*${quantity}\s*)?${units}\b`, 'i').test(text)
    || new RegExp(String.raw`\b(?:RPE|RIR|sets?|reps?|weight|duration)\s*(?::|of|=)?\s*${quantity}\b`, 'i').test(text)
    || /\b\d+\s*[x×]\s*\d+|\d+\s*%|\b\d+\s*-\s*\d+\s*-\s*\d+\b|\b\d+\s*(?:s|min)\b/i.test(text)) {
    throw new AssistantError('Exercise prose cannot prescribe sets, reps, loads, effort, durations or schedules. Use supported structured week fields for a full-week proposal; the engine still owns guardrails.')
  }
}

export function assertReferenceCardText(resources: readonly ResourceId[], ...parts: string[]): void {
  const gearNames = resources.filter(resource => resource.startsWith('custom:'))
    .map(resource => resource.slice(7).replace(/[^a-z0-9]/g, ''))
  const text = parts.join('\n').replace(
    /\b(?<![\d.,+-])(\d+)\s*(kg|kilograms?|lb|lbs|pounds?)\s+(ball|kettlebell|dumbbell|barbell|plate|sandbag|bag|vest)\b/gi,
    (match: string, amount: string, units: string, equipment: string) => {
      const mass = `${amount}${/^(kg|kilogram)/i.test(units) ? 'kg' : 'lb'}`
      const item = equipment.toLowerCase()
      // A confirmed weighted implement's name is not a newly prescribed load.
      const confirmed = gearNames.some(name => name.endsWith(`${item}${mass}`)
        || new RegExp(`(?:^|[a-z])${mass}${item}$`).test(name))
      return confirmed ? equipment : match
    },
  )
  assertNonPrescriptiveText(text)
}

/** Stage immutable definitions only; selection and human approval are separate operations. */
export function stageCustomExercises(draft: CampaignDraft, incoming: unknown): CampaignDraft {
  const proposed = entries(incoming)
  if (!proposed.length) return draft
  if (!draft.program) throw new AssistantError('Custom exercises require a new template program or a reviewed programming revision; legacy plans are unchanged.')
  const resources = programResourcesForResources(draft.resources ?? resourcesForEquipment(draft.equipment))
  const current = parseProgramConfigWithOptions(draft.program, AI_PLANNING_OPTIONS)
  const definitions = [...(current.customExercises ?? [])]
  const seen = new Set<string>()
  for (const entry of proposed) {
    const spec = parseCustomExercise(entry, resources)
    assertNonPrescriptiveText(spec.name, spec.description, spec.focus, spec.why)
    if (seen.has(spec.id)) throw new AssistantError('Custom exercise IDs must be unique within the reply.')
    seen.add(spec.id)
    const existing = definitions.find(item => item.id === spec.id)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(spec)) {
        throw new AssistantError('An existing custom exercise definition is immutable. Use a new exercise ID for a changed movement, technique or profile.')
      }
    } else definitions.push(spec)
  }
  if (definitions.length > LIMITS.maxCustomExercises) {
    throw new AssistantError(`A program can retain at most ${LIMITS.maxCustomExercises} custom exercise definitions.`)
  }
  const validated = parseProgramConfigWithOptions({ ...current, customExercises: definitions }, AI_PLANNING_OPTIONS)
  return { ...draft, program: { ...draft.program, customExercises: validated.customExercises } }
}

export function stageCustomSportDrills(draft: CampaignDraft, incoming: unknown): CampaignDraft {
  const proposed = entries(incoming, MAX_PROPOSED_CUSTOM_SPORT_DRILLS, 'custom throwing drill definitions')
  if (!proposed.length) return draft
  if (!draft.program) throw new AssistantError('Custom throwing drills require the expanded library and a reviewed program; legacy plans are unchanged.')
  const resources = programResourcesForResources(draft.resources ?? resourcesForEquipment(draft.equipment))
  const current = parseProgramConfigWithOptions(draft.program, AI_PLANNING_OPTIONS)
  const definitions = [...(current.customSportDrills ?? [])]
  const seen = new Set<string>()
  for (const entry of proposed) {
    const spec = parseCustomSportDrill(entry, resources)
    assertNonPrescriptiveText(spec.name, spec.description, spec.focus, spec.why)
    if (seen.has(spec.id)) throw new AssistantError('Custom throwing drill IDs must be unique within the reply.')
    seen.add(spec.id)
    const existing = definitions.find(item => item.id === spec.id)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(spec)) {
        throw new AssistantError('An existing custom throwing drill definition is immutable. Use a new ID for a changed technique or profile.')
      }
    } else definitions.push(spec)
  }
  if (definitions.length > MAX_PROPOSED_CUSTOM_SPORT_DRILLS) {
    throw new AssistantError(`A program can retain at most ${MAX_PROPOSED_CUSTOM_SPORT_DRILLS} custom throwing drill definitions.`)
  }
  const validated = parseProgramConfigWithOptions({ ...current, customSportDrills: definitions }, AI_PLANNING_OPTIONS)
  return { ...draft, program: { ...draft.program, customSportDrills: validated.customSportDrills } }
}

export function customSportDrillCatalog(draft: CampaignDraft) {
  const program = draft.program
  if (!program) return []
  return availableSportDrills(program.resources, program.customSportDrills)
    .flatMap(drill => {
      const spec = program.customSportDrills?.find(item => item.id === drill.id)
      return spec ? [{
        kind: 'sport_drill' as const, id: drill.id, name: drill.label,
        requirements: [...drill.requirements], unit: drill.unit,
        execution: { intent: drill.intent, embeddedOnly: true as const },
        description: spec.description, focus: [spec.focus], purpose: spec.why,
      }] : []
    })
}
