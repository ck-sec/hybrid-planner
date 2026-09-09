import type { SettingsBackupScreenProps } from '../features/settingsBackupScreen.ts'
import type { FormMessage, ImportIssue, JsonImportPreview, JsonPreviewGroup, ResetAction } from '../features/models.ts'
import {
  parseAthleteProfile,
  parseBackupEnvelope,
  type AthleteProfile,
  type BackupEnvelope,
  type EquipmentDetail,
  type PreferredTrainingDay,
  type RecurringClubSession,
  type StrengthPreference,
  type WorkoutCategory,
} from '../../domain/contracts.ts'
import { parseClockTime, parseLocalDate } from '../../domain/local-date.ts'
import { backupSummary, type HybridCoachRepository } from '../../storage/indexeddb-repository.ts'

export type SettingsBackupCounts = ReturnType<typeof backupSummary>

export type SettingsAdapterErrorCode =
  | 'download-unavailable'
  | 'invalid-reset-action'
  | 'restore-confirmation-required'
  | 'restore-preview-required'
  | 'reset-confirmation-required'

export class SettingsAdapterError extends Error {
  readonly code: SettingsAdapterErrorCode
  override readonly cause: unknown

  constructor(code: SettingsAdapterErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'SettingsAdapterError'
    this.code = code
    this.cause = cause
  }
}

export interface SettingsConfirmationRequirement {
  readonly kind: 'restore-backup' | 'reset-local-data'
  readonly phrase: string
  readonly title: string
  readonly message: string
}

export interface SettingsBackupExportAdapter {
  readonly backup: BackupEnvelope
  readonly backupJson: string
  readonly fileName: string
  readonly lastSavedAt: string
  readonly preview: JsonImportPreview
  readonly summary: SettingsBackupCounts
}

export interface SettingsObjectUrlApi {
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
}

export interface SettingsBackupDownloadAdapter {
  readonly href: string
  readonly download: string
  release(): void
}

export interface SettingsRestorePreviewState {
  readonly ok: boolean
  readonly restoreJson: string
  readonly preview: JsonImportPreview | null
  readonly issues: readonly ImportIssue[]
  readonly messages: readonly FormMessage[]
  readonly canApplyRestore: boolean
  readonly confirmationRequirement?: SettingsConfirmationRequirement
  readonly backup?: BackupEnvelope
}

export interface SettingsRestoreOutcome {
  readonly backup: BackupEnvelope
  readonly message: FormMessage
}

export interface SettingsResetRequest {
  readonly action: ResetAction
  readonly confirmationRequirement: SettingsConfirmationRequirement
  readonly warning: FormMessage
}

export interface SettingsResetOutcome {
  readonly action: ResetAction
  readonly message: FormMessage
}

export interface SettingsBackupScreenHandlers {
  readonly onCopyBackup: () => void
  readonly onRestoreJsonChange: (value: string) => void
  readonly onPreviewRestore: () => void
  readonly onApplyRestore: () => void
  readonly onReset: (actionId: string) => void
}

export type SettingsBackupScreenReadModel = Pick<
  SettingsBackupScreenProps,
  'backupJson' | 'lastSavedAt' | 'restoreJson' | 'preview' | 'issues' | 'resetActions' | 'messages' | 'canApplyRestore'
> & {
  readonly restoreConfirmation?: SettingsConfirmationRequirement
  readonly pendingReset?: SettingsResetRequest
}

export interface SettingsAthleteProfileDraft {
  readonly version: 1
  readonly id: string
  readonly createdOn: string
  readonly updatedOn: string
  readonly name: string
  readonly goal: string
  readonly goalDate: string
  readonly sports: readonly string[]
  readonly preferredWeeklyStructure: readonly SettingsPreferredTrainingDayDraft[]
  readonly strengthPreference?: StrengthPreference
  readonly equipmentDetails: readonly SettingsEquipmentDetailDraft[]
  readonly constraints: readonly string[]
  readonly clubSessions: readonly SettingsRecurringClubSessionDraft[]
  readonly notes: string
}

export interface SettingsPreferredTrainingDayDraft {
  readonly id: string
  readonly dayOfWeek: number
  readonly modalities: readonly WorkoutCategory[]
  readonly preferredStartTime: string
  readonly expectedDurationMin: string
  readonly notes: string
}

export interface SettingsEquipmentDetailDraft {
  readonly id: string
  readonly label: string
  readonly constraints: readonly string[]
  readonly notes: string
}

export interface SettingsRecurringClubSessionDraft {
  readonly id: string
  readonly title: string
  readonly scope: string
  readonly category?: WorkoutCategory
  readonly dayOfWeek: number
  readonly startTime: string
  readonly durationMin: string
  readonly notes: string
}

const BACKUP_FILE_PREFIX = 'hybrid-coach-backup'
const BACKUP_DOWNLOAD_MIME = 'application/json;charset=utf-8'
const RESTORE_CONFIRMATION_PHRASE = 'RESTORE BACKUP'
const RESET_CONFIRMATION_PHRASE = 'RESET LOCAL DATA'
const DEFAULT_RESET_ACTIONS = Object.freeze<readonly ResetAction[]>([
  {
    id: 'reset-local-data',
    label: 'Reset local training data',
    description: 'Delete saved athlete profiles, week plans, workout logs, and onboarding drafts from this browser after confirming the reset.',
    confirmationLabel: 'Review reset requirements',
  },
])
const LOCAL_PRIVACY_MESSAGES = Object.freeze<readonly FormMessage[]>([
  {
    id: 'settings-privacy-local',
    tone: 'info',
    text: 'Training data stays in this browser unless you explicitly export a backup or paste it into another tool.',
  },
  {
    id: 'settings-privacy-backup',
    tone: 'info',
    text: 'Your backup includes your profile, training records, and unfinished setup.',
  },
  {
    id: 'settings-privacy-cache',
    tone: 'info',
    text: 'Browser data can be cleared. Keep a downloaded backup to recover your training history.',
  },
])

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function listValue(values: readonly string[]): string {
  return values.length ? values.join(', ') : 'None'
}

function splitErrorPath(message: string, fallbackPath: string): { path: string; message: string } {
  const separator = message.indexOf(': ')
  if (separator <= 0) return { path: fallbackPath, message }
  return {
    path: message.slice(0, separator),
    message: message.slice(separator + 2),
  }
}

function createImportIssue(id: string, error: unknown, fallbackPath: string, suggestion: string): ImportIssue {
  const rawMessage = error instanceof Error ? error.message : String(error)
  const parsed = splitErrorPath(rawMessage, fallbackPath)
  return {
    id,
    severity: 'error',
    message: parsed.message,
    path: parsed.path,
    suggestion,
  }
}

function toPositiveIntegerString(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

function parseOptionalPositiveInteger(value: string, path: string): number | undefined {
  const normalized = value.trim()
  if (!normalized) return undefined
  if (!/^\d+$/.test(normalized)) throw new Error(`${path}: Expected a whole number.`)
  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${path}: Expected a whole number greater than zero.`)
  return parsed
}

function createBackupFileName(exportedAt: string): string {
  const normalized = exportedAt.replaceAll(':', '-').replaceAll('.', '-')
  return `${BACKUP_FILE_PREFIX}-${normalized}.json`
}

function buildBackupPreviewGroups(backup: BackupEnvelope): JsonPreviewGroup[] {
  const counts = backupSummary(backup)
  const groups: JsonPreviewGroup[] = [
    {
      id: 'backup-summary',
      title: 'Backup summary',
      items: [
        { label: 'Exported at', value: backup.exportedAt },
        { label: 'Athlete profiles', value: String(counts.athleteProfiles) },
        { label: 'Week plans', value: String(counts.weekPlans) },
        { label: 'Workout logs', value: String(counts.workoutLogs) },
        { label: 'Onboarding drafts', value: String(counts.onboardingDrafts) },
      ],
    },
  ]

  for (const profile of backup.athleteProfiles) {
    groups.push({
      id: `athlete-${profile.id}`,
      title: `Athlete · ${profile.name}`,
      items: [
        { label: 'Goal', value: profile.goal },
        { label: 'Goal date', value: profile.goalDate ?? 'None' },
        { label: 'Sports', value: listValue(profile.sports) },
        { label: 'Preferred training days', value: String(profile.preferredWeeklyStructure.length) },
        { label: 'Equipment entries', value: String(profile.equipmentDetails.length) },
        { label: 'Constraints', value: String(profile.constraints.length) },
        { label: 'Club sessions', value: String(profile.clubSessions.length) },
      ],
    })
  }

  for (const weekPlan of backup.weekPlans) {
    groups.push({
      id: `week-${weekPlan.id}`,
      title: `Week · ${weekPlan.weekStart}`,
      items: [
        { label: 'Title', value: weekPlan.title },
        { label: 'Athlete', value: weekPlan.athleteId },
        { label: 'Goal', value: weekPlan.goal },
        { label: 'Workouts', value: String(weekPlan.workouts.length) },
        { label: 'Notes', value: normalizeOptionalText(weekPlan.notes) ?? 'None' },
      ],
    })
  }

  for (const draft of backup.onboardingDrafts) {
    groups.push({
      id: `draft-${draft.id}`,
      title: `Draft · ${draft.name ?? draft.athleteId}`,
      items: [
        { label: 'Starting week', value: draft.startingWeek },
        { label: 'Goal', value: draft.goal },
        { label: 'Sports', value: listValue(draft.sports) },
        { label: 'Club sessions', value: String(draft.clubSessions.length) },
      ],
    })
  }

  if (backup.workoutLogs.length) {
    groups.push({
      id: 'workout-logs',
      title: 'Workout logs',
      items: [
        { label: 'Saved logs', value: String(backup.workoutLogs.length) },
        { label: 'Latest logged day', value: backup.workoutLogs.reduce((latest, log) => latest.localeCompare(log.loggedOn) > 0 ? latest : log.loggedOn, backup.workoutLogs[0]!.loggedOn) },
      ],
    })
  }

  return groups
}

export function buildBackupPreview(backup: BackupEnvelope, title = 'Backup restore preview'): JsonImportPreview {
  const validated = parseBackupEnvelope(backup)
  const counts = backupSummary(validated)
  return {
    title,
    summary: [
      `${pluralize(counts.athleteProfiles, 'athlete profile')} validated`,
      `${pluralize(counts.weekPlans, 'week plan')} and ${pluralize(counts.workoutLogs, 'workout log')} ready to restore`,
      `${pluralize(counts.onboardingDrafts, 'onboarding draft')} included`,
    ],
    groups: buildBackupPreviewGroups(validated),
  }
}

function buildRestoreConfirmationRequirement(backup: BackupEnvelope): SettingsConfirmationRequirement {
  const counts = backupSummary(backup)
  const emptyRestore = counts.athleteProfiles + counts.weekPlans + counts.workoutLogs + counts.onboardingDrafts === 0
  return {
    kind: 'restore-backup',
    phrase: RESTORE_CONFIRMATION_PHRASE,
    title: 'Confirm backup restore',
    message: emptyRestore
      ? 'This backup is empty. Restoring it will clear the current local training data.'
      : 'Restoring this backup will replace the current local athlete profiles, week plans, workout logs, and onboarding drafts with the previewed backup.',
  }
}

function buildResetConfirmationRequirement(): SettingsConfirmationRequirement {
  return {
    kind: 'reset-local-data',
    phrase: RESET_CONFIRMATION_PHRASE,
    title: 'Confirm local reset',
    message: 'Reset deletes the current local athlete profiles, week plans, workout logs, and onboarding drafts from this browser.',
  }
}

function matchesConfirmation(input: string, requirement: SettingsConfirmationRequirement): boolean {
  return input.trim() === requirement.phrase
}

export function isSettingsConfirmationSatisfied(
  confirmationInput: string,
  requirement: SettingsConfirmationRequirement | null | undefined,
): boolean {
  return requirement ? matchesConfirmation(confirmationInput, requirement) : false
}

function requireBackupObjectUrlApi(api: SettingsObjectUrlApi | undefined): SettingsObjectUrlApi {
  if (api) return api
  if (!globalThis.URL || typeof globalThis.URL.createObjectURL !== 'function' || typeof globalThis.URL.revokeObjectURL !== 'function') {
    throw new SettingsAdapterError(
      'download-unavailable',
      'Download links are unavailable here. Copy the backup JSON manually instead.',
    )
  }
  return globalThis.URL
}

export function createSettingsPrivacyMessages(): readonly FormMessage[] {
  return LOCAL_PRIVACY_MESSAGES.map(message => ({ ...message }))
}

export function createSettingsResetActions(): readonly ResetAction[] {
  return DEFAULT_RESET_ACTIONS.map(action => ({ ...action }))
}

export async function exportRepositoryBackup(repository: Pick<HybridCoachRepository, 'exportBackup'>): Promise<SettingsBackupExportAdapter> {
  const backup = await repository.exportBackup()
  const validated = parseBackupEnvelope(backup)
  return {
    backup: validated,
    backupJson: JSON.stringify(validated, null, 2),
    fileName: createBackupFileName(validated.exportedAt),
    lastSavedAt: validated.exportedAt,
    preview: buildBackupPreview(validated, 'Local backup preview'),
    summary: backupSummary(validated),
  }
}

export function createBackupDownload(
  backup: Pick<SettingsBackupExportAdapter, 'backupJson' | 'fileName'>,
  objectUrlApi?: SettingsObjectUrlApi,
): SettingsBackupDownloadAdapter {
  const api = requireBackupObjectUrlApi(objectUrlApi)
  const href = api.createObjectURL(new Blob([backup.backupJson], { type: BACKUP_DOWNLOAD_MIME }))
  let released = false
  return {
    href,
    download: backup.fileName,
    release() {
      if (released) return
      released = true
      api.revokeObjectURL(href)
    },
  }
}

export function previewRestoreBackupJson(restoreJson: string): SettingsRestorePreviewState {
  const trimmed = restoreJson.trim()
  if (!trimmed) {
    return {
      ok: false,
      restoreJson,
      preview: null,
      issues: [{
        id: 'restore-empty',
        severity: 'error',
        path: 'restoreJson',
        message: 'Paste a full backup JSON payload before previewing the restore.',
        suggestion: 'Use the exported backup JSON from Hybrid Coach.',
      }],
      messages: createSettingsPrivacyMessages(),
      canApplyRestore: false,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    return {
      ok: false,
      restoreJson,
      preview: null,
      issues: [createImportIssue(
        'restore-invalid-json',
        error,
        'restoreJson',
        'Paste the exact JSON backup export instead of a partial snippet.',
      )],
      messages: createSettingsPrivacyMessages(),
      canApplyRestore: false,
    }
  }

  let backup: BackupEnvelope
  try {
    backup = parseBackupEnvelope(parsed)
  } catch (error) {
    return {
      ok: false,
      restoreJson,
      preview: null,
      issues: [createImportIssue(
        'restore-invalid-backup',
        error,
        'BackupEnvelope',
        'Use an untouched backup export so every record and reference can be validated strictly.',
      )],
      messages: createSettingsPrivacyMessages(),
      canApplyRestore: false,
    }
  }

  const confirmationRequirement = buildRestoreConfirmationRequirement(backup)
  const counts = backupSummary(backup)
  const warnings: ImportIssue[] = counts.athleteProfiles + counts.weekPlans + counts.workoutLogs + counts.onboardingDrafts === 0
    ? [{
      id: 'restore-empty-backup',
      severity: 'warning',
      path: 'BackupEnvelope',
      message: 'This backup is empty. Restoring it will clear current local training data.',
      suggestion: 'Keep a non-empty export if you need to preserve the current local records.',
    }]
    : []

  return {
    ok: true,
    restoreJson,
    backup,
    preview: buildBackupPreview(backup),
    issues: warnings,
    messages: [
      ...createSettingsPrivacyMessages(),
      {
        id: 'restore-confirmation-required',
        tone: 'info',
        text: `${confirmationRequirement.message} Type "${confirmationRequirement.phrase}" before applying it.`,
      },
    ],
    canApplyRestore: false,
    confirmationRequirement,
  }
}

export async function applyPreviewedBackupRestore(
  repository: Pick<HybridCoachRepository, 'restoreBackup'>,
  preview: SettingsRestorePreviewState,
  confirmationInput: string,
): Promise<SettingsRestoreOutcome> {
  if (!preview.ok || !preview.backup || !preview.confirmationRequirement) {
    throw new SettingsAdapterError(
      'restore-preview-required',
      'Preview a valid backup before applying the restore.',
    )
  }
  if (!matchesConfirmation(confirmationInput, preview.confirmationRequirement)) {
    throw new SettingsAdapterError(
      'restore-confirmation-required',
      `Type "${preview.confirmationRequirement.phrase}" before restoring the backup.`,
    )
  }
  const restored = await repository.restoreBackup(preview.backup)
  return {
    backup: restored,
    message: {
      id: 'restore-applied',
      tone: 'success',
      text: `Restored the previewed backup from ${preview.backup.exportedAt}.`,
    },
  }
}

export function canApplyPreviewedBackupRestore(preview: SettingsRestorePreviewState, confirmationInput: string): boolean {
  return preview.ok && !!preview.confirmationRequirement && isSettingsConfirmationSatisfied(confirmationInput, preview.confirmationRequirement)
}

export function requestResetConfirmation(actionId: string): SettingsResetRequest {
  const action = createSettingsResetActions().find(entry => entry.id === actionId)
  if (!action) {
    throw new SettingsAdapterError('invalid-reset-action', `Unknown reset action "${actionId}".`)
  }
  return {
    action,
    confirmationRequirement: buildResetConfirmationRequirement(),
    warning: {
      id: `${action.id}-confirmation-required`,
      tone: 'error',
      text: `Reset is destructive. Type "${RESET_CONFIRMATION_PHRASE}" before continuing.`,
    },
  }
}

export async function applyConfirmedReset(
  repository: Pick<HybridCoachRepository, 'reset'>,
  request: SettingsResetRequest,
  confirmationInput: string,
): Promise<SettingsResetOutcome> {
  if (!matchesConfirmation(confirmationInput, request.confirmationRequirement)) {
    throw new SettingsAdapterError(
      'reset-confirmation-required',
      `Type "${request.confirmationRequirement.phrase}" before resetting local data.`,
    )
  }
  await repository.reset()
  return {
    action: request.action,
    message: {
      id: `${request.action.id}-complete`,
      tone: 'success',
      text: 'Local training data was reset for this browser.',
    },
  }
}

export function canApplyConfirmedReset(request: SettingsResetRequest, confirmationInput: string): boolean {
  return isSettingsConfirmationSatisfied(confirmationInput, request.confirmationRequirement)
}

export function createSettingsBackupScreenProps(
  model: SettingsBackupScreenReadModel,
  handlers: SettingsBackupScreenHandlers,
): SettingsBackupScreenProps {
  return {
    backupJson: model.backupJson,
    lastSavedAt: model.lastSavedAt,
    restoreJson: model.restoreJson,
    preview: model.preview,
    issues: model.issues,
    resetActions: model.resetActions,
    messages: model.messages,
    canApplyRestore: model.canApplyRestore,
    onCopyBackup: handlers.onCopyBackup,
    onRestoreJsonChange: handlers.onRestoreJsonChange,
    onPreviewRestore: handlers.onPreviewRestore,
    onApplyRestore: handlers.onApplyRestore,
    onReset: handlers.onReset,
  }
}

export function createAthleteProfileEditingDraft(profile: AthleteProfile): SettingsAthleteProfileDraft {
  const validated = parseAthleteProfile(profile)
  return {
    version: 1,
    id: validated.id,
    createdOn: validated.createdOn,
    updatedOn: validated.updatedOn,
    name: validated.name,
    goal: validated.goal,
    goalDate: validated.goalDate ?? '',
    sports: [...validated.sports],
    preferredWeeklyStructure: validated.preferredWeeklyStructure.map(createPreferredTrainingDayDraft),
    ...(validated.strengthPreference === undefined ? {} : { strengthPreference: validated.strengthPreference }),
    equipmentDetails: validated.equipmentDetails.map(createEquipmentDetailDraft),
    constraints: [...validated.constraints],
    clubSessions: validated.clubSessions.map(createRecurringClubSessionDraft),
    notes: validated.notes ?? '',
  }
}

function createPreferredTrainingDayDraft(day: PreferredTrainingDay, index: number): SettingsPreferredTrainingDayDraft {
  return {
    id: `preferred-day-${index + 1}-${day.dayOfWeek}`,
    dayOfWeek: day.dayOfWeek,
    modalities: [...day.modalities],
    preferredStartTime: day.preferredStartTime ?? '',
    expectedDurationMin: toPositiveIntegerString(day.expectedDurationMin),
    notes: day.notes ?? '',
  }
}

function createEquipmentDetailDraft(detail: EquipmentDetail): SettingsEquipmentDetailDraft {
  return {
    id: detail.id,
    label: detail.label,
    constraints: [...detail.constraints],
    notes: detail.notes ?? '',
  }
}

function createRecurringClubSessionDraft(session: RecurringClubSession): SettingsRecurringClubSessionDraft {
  return {
    id: session.id,
    title: session.title,
    scope: session.scope ?? '',
    ...(session.category === undefined ? {} : { category: session.category }),
    dayOfWeek: session.dayOfWeek,
    startTime: session.startTime,
    durationMin: toPositiveIntegerString(session.durationMin),
    notes: session.notes ?? '',
  }
}

export function parseAthleteProfileEditingDraft(draft: SettingsAthleteProfileDraft): AthleteProfile {
  const projected = {
    version: 1 as const,
    id: draft.id,
    createdOn: parseLocalDate(draft.createdOn, 'AthleteProfileDraft.createdOn'),
    updatedOn: parseLocalDate(draft.updatedOn, 'AthleteProfileDraft.updatedOn'),
    name: draft.name,
    goal: draft.goal,
    ...(normalizeOptionalText(draft.goalDate)
      ? { goalDate: parseLocalDate(draft.goalDate, 'AthleteProfileDraft.goalDate') }
      : {}),
    sports: draft.sports.map((sport, index) => {
      if (typeof sport !== 'string') throw new Error(`AthleteProfileDraft.sports[${index}]: Expected a string.`)
      return sport
    }),
    preferredWeeklyStructure: draft.preferredWeeklyStructure.map((day, index) => {
      const preferredStartTime = normalizeOptionalText(day.preferredStartTime)
      const expectedDurationMin = parseOptionalPositiveInteger(
        day.expectedDurationMin,
        `AthleteProfileDraft.preferredWeeklyStructure[${index}].expectedDurationMin`,
      )
      const notes = normalizeOptionalText(day.notes)
      return {
        dayOfWeek: day.dayOfWeek,
        modalities: [...day.modalities],
        ...(preferredStartTime
          ? { preferredStartTime: parseClockTime(preferredStartTime, `AthleteProfileDraft.preferredWeeklyStructure[${index}].preferredStartTime`) }
          : {}),
        ...(expectedDurationMin !== undefined ? { expectedDurationMin } : {}),
        ...(notes ? { notes } : {}),
      }
    }),
    ...(draft.strengthPreference === undefined ? {} : { strengthPreference: draft.strengthPreference }),
    equipmentDetails: draft.equipmentDetails.map((detail, index) => ({
      id: detail.id,
      label: detail.label,
      constraints: detail.constraints.map((constraint, constraintIndex) => {
        if (typeof constraint !== 'string') {
          throw new Error(`AthleteProfileDraft.equipmentDetails[${index}].constraints[${constraintIndex}]: Expected a string.`)
        }
        return constraint
      }),
      ...(normalizeOptionalText(detail.notes) ? { notes: normalizeOptionalText(detail.notes)! } : {}),
    })),
    constraints: draft.constraints.map((constraint, index) => {
      if (typeof constraint !== 'string') throw new Error(`AthleteProfileDraft.constraints[${index}]: Expected a string.`)
      return constraint
    }),
    clubSessions: draft.clubSessions.map((session, index) => {
      const durationMin = parseOptionalPositiveInteger(session.durationMin, `AthleteProfileDraft.clubSessions[${index}].durationMin`)
      const scope = normalizeOptionalText(session.scope)
      const notes = normalizeOptionalText(session.notes)
      return {
        id: session.id,
        title: session.title,
        ...(scope ? { scope } : {}),
        ...(session.category === undefined ? {} : { category: session.category }),
        dayOfWeek: session.dayOfWeek,
        startTime: parseClockTime(session.startTime, `AthleteProfileDraft.clubSessions[${index}].startTime`),
        ...(durationMin === undefined ? {} : { durationMin }),
        ...(notes ? { notes } : {}),
      }
    }),
    ...(normalizeOptionalText(draft.notes) ? { notes: normalizeOptionalText(draft.notes)! } : {}),
  }

  return parseAthleteProfile(projected)
}
