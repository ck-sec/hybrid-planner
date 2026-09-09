import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createBackupEnvelope,
  parseAthleteProfile,
  parseOnboardingDraft,
  parseWeekPlan,
  parseWorkoutLog,
  type BackupEnvelope,
} from '../../domain/contracts.ts'
import {
  SettingsAdapterError,
  applyConfirmedReset,
  applyPreviewedBackupRestore,
  canApplyConfirmedReset,
  canApplyPreviewedBackupRestore,
  createAthleteProfileEditingDraft,
  createBackupDownload,
  createSettingsBackupScreenProps,
  createSettingsPrivacyMessages,
  createSettingsResetActions,
  exportRepositoryBackup,
  isSettingsConfirmationSatisfied,
  parseAthleteProfileEditingDraft,
  previewRestoreBackupJson,
  requestResetConfirmation,
} from './settings.ts'

const athleteProfile = parseAthleteProfile({
  version: 1,
  id: 'athlete-amy',
  createdOn: '2026-09-07',
  updatedOn: '2026-09-09',
  name: 'Amy Runner',
  goal: 'Build a steady running and lifting routine.',
  goalDate: '2026-12-06',
  sports: ['running', 'lifting', 'skiing'],
  preferredWeeklyStructure: [
    {
      dayOfWeek: 1,
      modalities: ['strength'],
      preferredStartTime: '07:00',
      expectedDurationMin: 60,
      notes: 'Prefer to lift before work.',
    },
    {
      dayOfWeek: 2,
      modalities: ['aerobic', 'mobility'],
      preferredStartTime: '18:30',
      expectedDurationMin: 75,
      notes: 'Track club anchor.',
    },
  ],
  strengthPreference: 'upper_lower',
  equipmentDetails: [
    {
      id: 'equipment-rack',
      label: 'Power rack',
      constraints: ['Home only', 'Keep barbell noise down'],
      notes: 'Best for heavy squats.',
    },
    {
      id: 'equipment-shoes',
      label: 'Trail shoes',
      constraints: ['Wet grip is limited'],
      notes: 'Reserve for hills.',
    },
  ],
  constraints: ['No double hard days', 'Protect Thursday for family time'],
  clubSessions: [
    {
      id: 'club-track',
      title: 'Track club',
      scope: 'Primary aerobic anchor',
      category: 'aerobic',
      dayOfWeek: 2,
      startTime: '19:00',
      durationMin: 75,
      notes: 'Hard intervals most weeks.',
    },
    {
      id: 'club-mobility',
      title: 'Mobility class',
      scope: 'Recovery anchor',
      category: 'mobility',
      dayOfWeek: 4,
      startTime: '18:00',
      durationMin: 45,
      notes: 'Low intensity and social.',
    },
  ],
  notes: 'Prefers outdoor aerobic work when possible.',
})

const weekPlan = parseWeekPlan({
  version: 1,
  id: 'week-2026-09-07',
  athleteId: 'athlete-amy',
  weekStart: '2026-09-07',
  title: 'Base week',
  goal: 'Stay consistent.',
  workouts: [
    {
      version: 1,
      id: 'workout-run-1',
      athleteId: 'athlete-amy',
      weekPlanId: 'week-2026-09-07',
      scheduledDate: '2026-09-08',
      startTime: '19:00',
      category: 'aerobic',
      source: 'club',
      title: 'Track club',
      purpose: 'Use the club session as the aerobic anchor.',
      expectedDurationMin: 75,
      warmup: [{ id: 'warm-run', title: 'Jog', target: { minutes: 15 } }],
      main: [{ id: 'main-run', title: 'Intervals', target: { minutes: 40, effort: 'hard' } }],
      cooldown: [{ id: 'cool-run', title: 'Jog', target: { minutes: 10 } }],
      fixedClubSession: {
        recurringSessionId: 'club-track',
        title: 'Track club',
        scope: 'Primary aerobic anchor',
        category: 'aerobic',
        dayOfWeek: 2,
        startTime: '19:00',
        durationMin: 75,
      },
      notes: 'Leave room for recovery the next day.',
    },
  ],
  notes: 'Keep Friday flexible for travel.',
})

const workoutLog = parseWorkoutLog({
  version: 1,
  id: 'log-run-1',
  athleteId: 'athlete-amy',
  weekPlanId: 'week-2026-09-07',
  workoutId: 'workout-run-1',
  loggedOn: '2026-09-08',
  outcome: 'completed',
  effortRating: 8,
  metrics: {
    durationMin: 74,
    distanceMeters: 10800,
    paceSecondsPerKm: 250,
    averageHeartRate: 164,
  },
  steps: [{ stepId: 'main-run', completedMinutes: 41, completedPaceSecondsPerKm: 245, notes: 'Strong final rep.' }],
  notes: 'Felt smooth all the way through.',
})

const onboardingDraft = parseOnboardingDraft({
  version: 1,
  id: 'draft-amy',
  athleteId: 'athlete-amy',
  createdOn: '2026-09-07',
  updatedOn: '2026-09-09',
  startingWeek: '2026-09-14',
  name: 'Amy Runner',
  goal: 'Balance running, lifting, and mobility.',
  goalDate: '2026-12-06',
  sports: ['running', 'lifting'],
  preferredWeeklyStructure: [
    { dayOfWeek: 1, modalities: ['strength'], preferredStartTime: '07:00' },
    { dayOfWeek: 2, modalities: ['aerobic'], preferredStartTime: '19:00', expectedDurationMin: 75 },
  ],
  strengthPreference: 'upper_lower',
  equipmentDetails: [{ id: 'equipment-rack', label: 'Power rack', constraints: ['Home only'] }],
  constraints: ['Keep Sunday mostly free'],
  clubSessions: [{
    id: 'club-track',
    title: 'Track club',
    scope: 'Primary aerobic anchor',
    category: 'aerobic',
    dayOfWeek: 2,
    startTime: '19:00',
    durationMin: 75,
  }],
  notes: 'Review schedule after the first week.',
})

function buildBackup(): BackupEnvelope {
  return createBackupEnvelope({
    athleteProfiles: [athleteProfile],
    weekPlans: [weekPlan],
    workoutLogs: [workoutLog],
    onboardingDrafts: [onboardingDraft],
    exportedAt: '2026-09-09T06:14:51.760Z',
  })
}

class StubRepository {
  exported = buildBackup()
  restored: BackupEnvelope[] = []
  resetCalls = 0

  async exportBackup() {
    return structuredClone(this.exported)
  }

  async restoreBackup(backup: BackupEnvelope) {
    this.restored.push(structuredClone(backup))
    return structuredClone(backup)
  }

  async reset() {
    this.resetCalls += 1
  }
}

class FakeObjectUrlApi {
  created: Blob[] = []
  revoked: string[] = []

  createObjectURL(blob: Blob) {
    this.created.push(blob)
    return `blob:settings-${this.created.length}`
  }

  revokeObjectURL(url: string) {
    this.revoked.push(url)
  }
}

test('backup export builds portable JSON, preview data, and a deterministic filename', async () => {
  const repository = new StubRepository()
  const exported = await exportRepositoryBackup(repository)

  assert.equal(exported.lastSavedAt, '2026-09-09T06:14:51.760Z')
  assert.equal(exported.fileName, 'hybrid-coach-backup-2026-09-09T06-14-51-760Z.json')
  assert.equal(exported.summary.athleteProfiles, 1)
  assert.equal(exported.summary.weekPlans, 1)
  assert.match(exported.backupJson, /"athleteProfiles"/)
  assert.equal(exported.preview.title, 'Local backup preview')
  assert.equal(exported.preview.groups[1]?.title, 'Athlete · Amy Runner')
})

test('backup downloads create one object URL and clean it up safely', async () => {
  const repository = new StubRepository()
  const exported = await exportRepositoryBackup(repository)
  const objectUrls = new FakeObjectUrlApi()

  const download = createBackupDownload(exported, objectUrls)
  assert.equal(download.href, 'blob:settings-1')
  assert.equal(download.download, exported.fileName)
  assert.equal(await objectUrls.created[0]?.text(), exported.backupJson)

  download.release()
  download.release()

  assert.deepEqual(objectUrls.revoked, ['blob:settings-1'])
})

test('restore preview surfaces parse errors and validation errors explicitly', () => {
  const invalidJson = previewRestoreBackupJson('{')
  assert.equal(invalidJson.ok, false)
  assert.match(invalidJson.issues[0]?.message ?? '', /expected property name|end of json input/i)
  assert.equal(invalidJson.issues[0]?.path, 'restoreJson')

  const orphanedBackup = buildBackup()
  orphanedBackup.athleteProfiles = []
  const invalidBackup = previewRestoreBackupJson(JSON.stringify(orphanedBackup))
  assert.equal(invalidBackup.ok, false)
  assert.match(invalidBackup.issues[0]?.path ?? '', /BackupEnvelope\.weekPlans\[0\]\.athleteId/)
  assert.match(invalidBackup.issues[0]?.message ?? '', /saved athlete profile/i)
})

test('restore preview requires explicit confirmation before applying the atomic restore', async () => {
  const repository = new StubRepository()
  const preview = previewRestoreBackupJson(JSON.stringify(buildBackup()))

  assert.equal(preview.ok, true)
  if (!preview.ok) return

  assert.equal(preview.canApplyRestore, false)
  assert.equal(preview.confirmationRequirement?.phrase, 'RESTORE BACKUP')
  assert.match(preview.messages.at(-1)?.text ?? '', /Type "RESTORE BACKUP"/)
  assert.equal(isSettingsConfirmationSatisfied('RESTORE BACKUP', preview.confirmationRequirement), true)
  assert.equal(canApplyPreviewedBackupRestore(preview, 'RESTORE BACKUP'), true)
  assert.equal(canApplyPreviewedBackupRestore(preview, 'RESTORE'), false)

  await assert.rejects(
    () => applyPreviewedBackupRestore(repository, preview, 'RESTORE'),
    error => error instanceof SettingsAdapterError && error.code === 'restore-confirmation-required',
  )

  const restored = await applyPreviewedBackupRestore(repository, preview, 'RESTORE BACKUP')
  assert.equal(repository.restored.length, 1)
  assert.equal(repository.restored[0]?.exportedAt, '2026-09-09T06:14:51.760Z')
  assert.equal(restored.message.tone, 'success')
})

test('reset actions require explicit confirmation and surface unknown actions', async () => {
  const repository = new StubRepository()
  const request = requestResetConfirmation('reset-local-data')
  assert.equal(request.action.confirmationLabel, 'Review reset requirements')
  assert.equal(request.confirmationRequirement.phrase, 'RESET LOCAL DATA')
  assert.match(request.warning.text, /destructive/i)
  assert.equal(canApplyConfirmedReset(request, 'RESET LOCAL DATA'), true)
  assert.equal(canApplyConfirmedReset(request, 'RESET'), false)

  await assert.rejects(
    () => applyConfirmedReset(repository, request, 'RESET'),
    error => error instanceof SettingsAdapterError && error.code === 'reset-confirmation-required',
  )

  const outcome = await applyConfirmedReset(repository, request, 'RESET LOCAL DATA')
  assert.equal(repository.resetCalls, 1)
  assert.equal(outcome.message.tone, 'success')

  assert.throws(
    () => requestResetConfirmation('missing-action'),
    error => error instanceof SettingsAdapterError && error.code === 'invalid-reset-action',
  )
})

test('privacy copy and screen props align with the settings backup screen contract', () => {
  const privacyMessages = createSettingsPrivacyMessages()
  const resetActions = createSettingsResetActions()
  let copied = false
  let applied = false
  let previewed = false
  let changedTo = ''
  let resetActionId = ''

  const props = createSettingsBackupScreenProps({
    backupJson: '{"version":1}',
    lastSavedAt: '2026-09-09T06:14:51.760Z',
    restoreJson: '',
    preview: null,
    issues: [],
    resetActions,
    messages: privacyMessages,
    canApplyRestore: false,
  }, {
    onCopyBackup: () => { copied = true },
    onRestoreJsonChange: value => { changedTo = value },
    onPreviewRestore: () => { previewed = true },
    onApplyRestore: () => { applied = true },
    onReset: actionId => { resetActionId = actionId },
  })

  assert.equal(props.messages?.length, 3)
  assert.match(props.messages?.[0]?.text ?? '', /stays in this browser/i)
  props.onCopyBackup()
  props.onRestoreJsonChange('{"version":1}')
  props.onPreviewRestore()
  props.onApplyRestore()
  props.onReset('reset-local-data')

  assert.equal(copied, true)
  assert.equal(changedTo, '{"version":1}')
  assert.equal(previewed, true)
  assert.equal(applied, true)
  assert.equal(resetActionId, 'reset-local-data')
})

test('athlete profile editing adapter round-trips every profile field without data loss', () => {
  const draft = createAthleteProfileEditingDraft(athleteProfile)
  const restored = parseAthleteProfileEditingDraft(draft)

  assert.deepEqual(restored, athleteProfile)
  assert.equal(draft.preferredWeeklyStructure[1]?.notes, 'Track club anchor.')
  assert.equal(draft.equipmentDetails[0]?.notes, 'Best for heavy squats.')
  assert.equal(draft.clubSessions[1]?.durationMin, '45')
  assert.equal(draft.notes, 'Prefers outdoor aerobic work when possible.')
})

test('athlete profile editing preserves unspecified strength and minimal clubs without adding defaults', () => {
  const minimalProfile = parseAthleteProfile({
    ...athleteProfile,
    strengthPreference: undefined,
    clubSessions: [{
      id: 'club-social',
      title: 'Social club',
      dayOfWeek: 0,
      startTime: '09:30',
      notes: 'Meet by the gate.',
    }, {
      id: 'club-partial',
      title: 'Club circuit',
      dayOfWeek: 3,
      startTime: '18:00',
      durationMin: 60,
    }],
  })
  const draft = createAthleteProfileEditingDraft(minimalProfile)
  const restored = parseAthleteProfileEditingDraft(draft)

  assert.equal(draft.strengthPreference, undefined)
  assert.equal(draft.clubSessions[0]!.scope, '')
  assert.equal(draft.clubSessions[0]!.category, undefined)
  assert.equal(draft.clubSessions[0]!.durationMin, '')
  assert.equal(draft.clubSessions[1]!.durationMin, '60')
  assert.deepEqual(restored, minimalProfile)
  assert.doesNotMatch(JSON.stringify(restored), /full.body|strengthPreference/i)
})

test('backup restore accepts minimal recurring clubs and an unspecified strength preference', () => {
  const backup = buildBackup()
  const clubSessions = [{ id: 'club-social', title: 'Social club', dayOfWeek: 0, startTime: '09:30' }]
  const preview = previewRestoreBackupJson(JSON.stringify({
    ...backup,
    athleteProfiles: [{ ...athleteProfile, strengthPreference: undefined, clubSessions }],
    onboardingDrafts: [{ ...onboardingDraft, strengthPreference: undefined, clubSessions }],
  }))

  assert.equal(preview.ok, true)
  assert.deepEqual(preview.issues, [])
  assert.equal(preview.backup?.athleteProfiles[0]?.strengthPreference, undefined)
  assert.deepEqual(JSON.parse(JSON.stringify(preview.backup?.athleteProfiles[0]?.clubSessions)), clubSessions)
  assert.deepEqual(JSON.parse(JSON.stringify(preview.backup?.onboardingDrafts[0]?.clubSessions)), clubSessions)
})

test('athlete profile editing adapter rejects invalid numeric edits explicitly', () => {
  const draft = createAthleteProfileEditingDraft(athleteProfile)
  const invalidDraft = {
    ...draft,
    clubSessions: draft.clubSessions.map(session =>
      session.id === 'club-track'
        ? { ...session, durationMin: 'ninety' }
        : session),
  }

  assert.throws(
    () => parseAthleteProfileEditingDraft(invalidDraft),
    /AthleteProfileDraft\.clubSessions\[0\]\.durationMin: Expected a whole number\./,
  )
})
