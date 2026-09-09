import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'

import { createBackupEnvelope, parseAthleteProfile, parseOnboardingDraft, parseWeekPlan, parseWorkoutLog } from '../domain/contracts.ts'
import { createHybridCoachRepository } from './indexeddb-repository.ts'

class FakeRequest<T> {
  result!: T
  error: Error | null = null
  onsuccess: (() => void) | null = null
  onerror: (() => void) | null = null
  onupgradeneeded: (() => void) | null = null
  onblocked: (() => void) | null = null
  transaction: FakeTransaction | null = null
}

class FakeObjectStoreNames {
  readonly names: Set<string>

  constructor(names: Set<string>) {
    this.names = names
  }

  contains(name: string) { return this.names.has(name) }
}

class FakeDatabaseHandle {
  onversionchange: (() => void) | null = null
  readonly database: FakeIndexedDb
  readonly request: FakeRequest<FakeDatabaseHandle>

  constructor(database: FakeIndexedDb, request: FakeRequest<FakeDatabaseHandle>) {
    this.database = database
    this.request = request
  }

  get objectStoreNames() {
    return new FakeObjectStoreNames(new Set(this.database.storeDefinitions.keys()))
  }

  createObjectStore(name: string, options: { keyPath: string }) {
    this.database.storeDefinitions.set(name, { keyPath: options.keyPath })
    if (!this.database.stores.has(name)) this.database.stores.set(name, new Map())
    return this.request.transaction!.objectStore(name)
  }

  transaction(names: string | string[], _mode: IDBTransactionMode) {
    const transaction = new FakeTransaction(this.database, Array.isArray(names) ? names : [names])
    this.database.transactions.push(transaction)
    return transaction
  }

  close() {}
}

class FakeObjectStore {
  readonly database: FakeIndexedDb
  readonly transaction: FakeTransaction
  readonly name: string

  constructor(database: FakeIndexedDb, transaction: FakeTransaction, name: string) {
    this.database = database
    this.transaction = transaction
    this.name = name
  }

  private schedule<T>(value: T): FakeRequest<T> {
    const request = new FakeRequest<T>()
    queueMicrotask(() => {
      request.result = structuredClone(value)
      request.onsuccess?.()
    })
    return request
  }

  private storeData() {
    const store = this.database.stores.get(this.name)
    assert.ok(store, `Unknown store ${this.name}`)
    return store
  }

  private keyPath() {
    const definition = this.database.storeDefinitions.get(this.name)
    assert.ok(definition, `Missing store definition for ${this.name}`)
    return definition.keyPath
  }

  get(key: string) {
    return this.schedule(this.storeData().has(key) ? this.storeData().get(key) : undefined)
  }

  getAll() {
    return this.schedule([...this.storeData().values()])
  }

  put(value: Record<string, unknown>) {
    const keyField = this.keyPath()
    const key = value[keyField]
    assert.equal(typeof key, 'string')
    if (typeof key !== 'string') throw new Error(`Expected string key for store ${this.name}.`)
    this.transaction.operations.push(() => { this.storeData().set(key, structuredClone(value)) })
    return this.schedule(undefined)
  }

  delete(key: string) {
    this.transaction.operations.push(() => { this.storeData().delete(key) })
    return this.schedule(undefined)
  }

  clear() {
    this.transaction.operations.push(() => { this.storeData().clear() })
    return this.schedule(undefined)
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null
  onabort: (() => void) | null = null
  error: Error | null = null
  operations: Array<() => void> = []
  readonly database: FakeIndexedDb
  readonly storeNames: string[]

  constructor(database: FakeIndexedDb, storeNames: string[]) {
    this.database = database
    this.storeNames = storeNames
  }

  objectStore(name: string) {
    if (this.storeNames.length) assert.ok(this.storeNames.includes(name), `Transaction missing store ${name}`)
    return new FakeObjectStore(this.database, this, name)
  }

  abort() {
    queueMicrotask(() => this.onabort?.())
  }

  complete() {
    for (const operation of this.operations) operation()
    this.oncomplete?.()
  }
}

class FakeIndexedDb {
  readonly stores = new Map<string, Map<string, unknown>>()
  readonly storeDefinitions = new Map<string, { keyPath: string }>()
  readonly transactions: FakeTransaction[] = []

  latestTransaction(): FakeTransaction {
    const transaction = this.transactions.at(-1)
    assert.ok(transaction)
    return transaction
  }

  store(name: string) {
    return [...(this.stores.get(name)?.values() ?? [])]
  }

  open(_name: string, _version: number) {
    const request = new FakeRequest<FakeDatabaseHandle>()
    const upgrade = new FakeTransaction(this, [])
    request.transaction = upgrade
    request.result = new FakeDatabaseHandle(this, request)
    this.transactions.push(upgrade)
    queueMicrotask(() => {
      if (!this.storeDefinitions.size) request.onupgradeneeded?.()
      request.onsuccess?.()
    })
    return request
  }
}

const athlete = parseAthleteProfile({
  version: 1,
  id: 'athlete-amy',
  createdOn: '2026-09-07',
  updatedOn: '2026-09-08',
  name: 'Amy',
  goal: 'Stay consistent.',
  goalDate: '2026-12-06',
  sports: ['running', 'lifting'],
  preferredWeeklyStructure: [
    { dayOfWeek: 1, modalities: ['strength'], preferredStartTime: '07:00' },
    { dayOfWeek: 2, modalities: ['aerobic'], preferredStartTime: '19:00', expectedDurationMin: 75 },
  ],
  strengthPreference: 'upper_lower',
  equipmentDetails: [{ id: 'kit-barbell', label: 'Barbell', constraints: ['Needs rack access'] }],
  constraints: ['Avoid back-to-back hard days'],
  clubSessions: [{ id: 'club-track', title: 'Track club', scope: 'Primary run session', category: 'aerobic', dayOfWeek: 2, startTime: '19:00', durationMin: 75 }],
})

const weekPlan = parseWeekPlan({
  version: 1,
  id: 'week-2026-09-07',
  athleteId: 'athlete-amy',
  weekStart: '2026-09-07',
  title: 'Base week',
  goal: 'Stay consistent.',
  workouts: [{
    version: 1,
    id: 'workout-run-1',
    athleteId: 'athlete-amy',
    weekPlanId: 'week-2026-09-07',
    scheduledDate: '2026-09-08',
    startTime: '19:00',
    category: 'aerobic',
    source: 'club',
    title: 'Track club',
    purpose: 'Use the recurring club session.',
    expectedDurationMin: 75,
    warmup: [],
    main: [{ id: 'run-main', title: 'Intervals', target: { minutes: 30, effort: 'hard' } }],
    cooldown: [],
    fixedClubSession: {
      recurringSessionId: 'club-track',
      title: 'Track club',
      scope: 'Primary run session',
      category: 'aerobic',
      dayOfWeek: 2,
      startTime: '19:00',
      durationMin: 75,
    },
  }],
})

const laterWeekPlan = parseWeekPlan({
  ...structuredClone(weekPlan),
  id: 'week-2026-09-14',
  weekStart: '2026-09-14',
  workouts: [{
    ...structuredClone(weekPlan.workouts[0]),
    id: 'workout-run-2',
    weekPlanId: 'week-2026-09-14',
    scheduledDate: '2026-09-15',
  }],
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
  metrics: { durationMin: 74, distanceMeters: 10800, paceSecondsPerKm: 250 },
  steps: [{ stepId: 'run-main', completedMinutes: 31, completedPaceSecondsPerKm: 248 }],
})

const onboardingDraft = parseOnboardingDraft({
  version: 1,
  id: 'draft-amy',
  athleteId: 'athlete-amy',
  createdOn: '2026-09-07',
  updatedOn: '2026-09-08',
  startingWeek: '2026-09-14',
  name: 'Amy',
  goal: 'Balance the week.',
  goalDate: '2026-12-06',
  sports: ['running', 'lifting'],
  preferredWeeklyStructure: [{ dayOfWeek: 2, modalities: ['aerobic'] }],
  strengthPreference: 'upper_lower',
  equipmentDetails: [{ id: 'kit-barbell', label: 'Barbell', constraints: ['Needs rack access'] }],
  constraints: ['Travel every Friday'],
  clubSessions: [{ id: 'club-track', title: 'Track club', scope: 'Primary run session', category: 'aerobic', dayOfWeek: 2, startTime: '19:00', durationMin: 75 }],
})

const tick = () => new Promise<void>(resolve => setImmediate(resolve))

function installFakeIndexedDb(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  const fake = new FakeIndexedDb()
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open: fake.open.bind(fake) } })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original)
    else Reflect.deleteProperty(globalThis, 'indexedDB')
  })
  return fake
}

test('draft persistence commits only after the IndexedDB transaction completes', async t => {
  const fake = installFakeIndexedDb(t)
  const repository = createHybridCoachRepository('test-drafts')
  let resolved = false
  const saving = repository.saveOnboardingDraft(onboardingDraft).then(result => { resolved = true; return result })

  await tick()
  assert.equal(resolved, false)
  assert.deepEqual(fake.store('onboardingDrafts'), [])
  fake.latestTransaction().complete()

  assert.equal((await saving).id, 'draft-amy')
  assert.equal(resolved, true)
  assert.deepEqual(fake.store('onboardingDrafts'), [onboardingDraft])
})

test('week plans require an existing athlete profile and failed writes stay atomic', async t => {
  const fake = installFakeIndexedDb(t)
  const repository = createHybridCoachRepository('test-week-save')

  const saving = assert.rejects(repository.saveWeekPlan(weekPlan), /existing athlete profile/i)
  await tick()
  fake.latestTransaction().complete()
  await saving
  assert.deepEqual(fake.store('weekPlans'), [])
})

test('week import writes the plan and its logs atomically and getLatestWeekPlan returns the latest saved week', async t => {
  const fake = installFakeIndexedDb(t)
  const repository = createHybridCoachRepository('test-import')

  const saveAthlete = repository.saveAthleteProfile(athlete)
  await tick()
  fake.latestTransaction().complete()
  await saveAthlete

  const importWork = repository.importWeek({ weekPlan, workoutLogs: [workoutLog] })
  await tick()
  assert.deepEqual(fake.store('weekPlans'), [])
  assert.deepEqual(fake.store('workoutLogs'), [])
  fake.latestTransaction().complete()
  await importWork

  const saveLater = repository.saveWeekPlan(laterWeekPlan)
  await tick()
  fake.latestTransaction().complete()
  await saveLater

  const listing = repository.listWeekPlans('athlete-amy')
  await tick()
  fake.latestTransaction().complete()
  assert.deepEqual((await listing).map(plan => plan.id), ['week-2026-09-14', 'week-2026-09-07'])

  const latest = repository.getLatestWeekPlan('athlete-amy')
  await tick()
  fake.latestTransaction().complete()
  assert.equal((await latest)?.id, 'week-2026-09-14')
})

test('saving a week refuses to orphan existing logs that no longer match the workout references', async t => {
  const fake = installFakeIndexedDb(t)
  const repository = createHybridCoachRepository('test-reference-preservation')

  const saveAthlete = repository.saveAthleteProfile(athlete)
  await tick()
  fake.latestTransaction().complete()
  await saveAthlete

  const importWork = repository.importWeek({ weekPlan, workoutLogs: [workoutLog] })
  await tick()
  fake.latestTransaction().complete()
  await importWork

  const incompatibleWeek = parseWeekPlan({
    ...structuredClone(weekPlan),
    workouts: [{
      ...structuredClone(weekPlan.workouts[0]),
      main: [{ id: 'different-step', title: 'Tempo block', target: { minutes: 20, effort: 'hard' } }],
    }],
  })
  const saving = assert.rejects(repository.saveWeekPlan(incompatibleWeek), /planned workout steps/i)
  await tick()
  fake.latestTransaction().complete()
  await saving

  assert.deepEqual(fake.store('weekPlans'), [weekPlan])
  assert.deepEqual(fake.store('workoutLogs'), [workoutLog])
})

test('list and delete methods cover profiles, logs, weeks, and drafts while preserving week-log references', async t => {
  const fake = installFakeIndexedDb(t)
  const repository = createHybridCoachRepository('test-list-delete')

  const saveAthlete = repository.saveAthleteProfile(athlete)
  await tick()
  fake.latestTransaction().complete()
  await saveAthlete

  const saveDraft = repository.saveOnboardingDraft(onboardingDraft)
  await tick()
  fake.latestTransaction().complete()
  await saveDraft

  const importWork = repository.importWeek({ weekPlan, workoutLogs: [workoutLog] })
  await tick()
  fake.latestTransaction().complete()
  await importWork

  const profiles = repository.listAthleteProfiles()
  await tick()
  fake.latestTransaction().complete()
  assert.equal((await profiles).length, 1)

  const logs = repository.listWorkoutLogs({ weekPlanId: 'week-2026-09-07' })
  await tick()
  fake.latestTransaction().complete()
  assert.equal((await logs)[0]?.id, 'log-run-1')

  const drafts = repository.listOnboardingDrafts('athlete-amy')
  await tick()
  fake.latestTransaction().complete()
  assert.equal((await drafts)[0]?.id, 'draft-amy')

  const deleteWeek = repository.deleteWeekPlan('week-2026-09-07')
  await tick()
  fake.latestTransaction().complete()
  await deleteWeek
  assert.deepEqual(fake.store('weekPlans'), [])
  assert.deepEqual(fake.store('workoutLogs'), [])

  const deleteDraft = repository.deleteOnboardingDraft('draft-amy')
  await tick()
  fake.latestTransaction().complete()
  await deleteDraft
  assert.deepEqual(fake.store('onboardingDrafts'), [])
})

test('backup restore replaces stores transactionally, export reads the restored snapshot, and reset clears it', async t => {
  const fake = installFakeIndexedDb(t)
  const repository = createHybridCoachRepository('test-backup')
  const backup = createBackupEnvelope({
    athleteProfiles: [athlete],
    weekPlans: [weekPlan],
    workoutLogs: [workoutLog],
    onboardingDrafts: [onboardingDraft],
    exportedAt: '2026-09-09T06:14:51.760Z',
  })

  const restoring = repository.restoreBackup(backup)
  await tick()
  assert.deepEqual(fake.store('athleteProfiles'), [])
  fake.latestTransaction().complete()
  assert.equal((await restoring).athleteProfiles.length, 1)

  const exporting = repository.exportBackup()
  await tick()
  fake.latestTransaction().complete()
  const exported = await exporting
  assert.match(exported.exportedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.deepEqual({ ...exported, exportedAt: backup.exportedAt }, backup)

  const resetting = repository.reset()
  await tick()
  fake.latestTransaction().complete()
  await resetting
  assert.deepEqual(fake.store('athleteProfiles'), [])
  assert.deepEqual(fake.store('weekPlans'), [])
  assert.deepEqual(fake.store('workoutLogs'), [])
  assert.deepEqual(fake.store('onboardingDrafts'), [])
})
