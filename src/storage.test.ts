import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { emptyState } from './model-state.ts'
import type { AppState } from './model-state.ts'
import { emptyState as emptyLegacyState } from './state.ts'
import { loadSnapshot, restoreSnapshot, saveSnapshot, StorageConflictError } from './storage.ts'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))

class ControlledTransaction {
  oncomplete: (() => void) | null = null
  onabort: (() => void) | null = null
  onerror: (() => void) | null = null
  error: DOMException | null = null
  pending: unknown
  wrote = false
  aborted = false
  database: ControlledDatabase

  constructor(database: ControlledDatabase) {
    this.database = database
  }

  objectStore() {
    return {
      get: () => {
        const request: { result: unknown; onsuccess?: () => void } = { result: undefined }
        queueMicrotask(() => {
          request.result = structuredClone(this.database.current)
          request.onsuccess?.()
        })
        return request
      },
      put: (value: unknown) => {
        this.pending = structuredClone(value)
        this.wrote = true
        this.database.writes++
        return {}
      },
    }
  }

  complete() {
    assert.equal(this.aborted, false)
    if (this.wrote) this.database.current = this.pending
    this.oncomplete?.()
  }

  abort(error: DOMException | null = null) {
    this.aborted = true
    this.error = error
    queueMicrotask(() => this.onabort?.())
  }
}

class ControlledDatabase {
  current: unknown
  writes = 0
  transactions: ControlledTransaction[] = []

  constructor(value: unknown) {
    this.current = structuredClone(value)
  }

  open() {
    const request: { result: unknown; onsuccess?: () => void } = {
      result: {
        close: () => {},
        transaction: () => {
          const transaction = new ControlledTransaction(this)
          this.transactions.push(transaction)
          return transaction
        },
      },
    }
    queueMicrotask(() => request.onsuccess?.())
    return request
  }

  latest() {
    const transaction = this.transactions.at(-1)
    assert.ok(transaction)
    return transaction
  }
}

function databaseFor(t: TestContext, initial?: unknown): ControlledDatabase {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  const database = new ControlledDatabase(initial)
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open: () => database.open() } })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original)
    else Reflect.deleteProperty(globalThis, 'indexedDB')
  })
  return database
}

test('saving reports success only after transaction completion, not request success', async t => {
  const database = databaseFor(t)
  let settled = false
  const saving = saveSnapshot(emptyState(), 0).then(snapshot => { settled = true; return snapshot })
  await tick()
  assert.equal(database.writes, 1)
  assert.equal(database.current, undefined)
  assert.equal(settled, false)
  database.latest().complete()
  const saved = await saving
  assert.equal(settled, true)
  assert.equal(saved.revision, 1)
  assert.deepEqual(database.current, saved)
})

test('aborted transactions reject and keep the last persisted record unchanged', async t => {
  const initial = { revision: 4, state: emptyState() }
  const database = databaseFor(t, initial)
  const rejected = assert.rejects(saveSnapshot(emptyState(), 4), /storage is full/i)
  await tick()
  database.latest().abort(new DOMException('Quota exceeded', 'QuotaExceededError'))
  await rejected
  assert.deepEqual(database.current, initial)
})

test('failed startup never writes or substitutes empty state; recovery requires its own committed write', async t => {
  const corrupt = { revision: 7, state: { schemaVersion: 999 } }
  const database = databaseFor(t, corrupt)
  const rejected = assert.rejects(loadSnapshot(), /Unsupported backup schema/)
  await tick()
  database.latest().complete()
  await rejected
  assert.equal(database.writes, 0)
  assert.deepEqual(database.current, corrupt)

  let settled = false
  const recovering = restoreSnapshot(emptyState()).then(snapshot => { settled = true; return snapshot })
  await tick()
  assert.equal(settled, false)
  assert.deepEqual(database.current, corrupt)
  database.latest().complete()
  const recovered = await recovering
  assert.equal(typeof recovered.revision, 'string')
  assert.deepEqual(database.current, recovered)

  await assert.rejects(saveSnapshot(emptyState(), 7), StorageConflictError)
  assert.deepEqual(database.current, recovered)
})

test('recovery refuses readable data written by another tab and does not overwrite it', async t => {
  const initial = { revision: 9, state: emptyState() }
  const database = databaseFor(t, initial)
  await assert.rejects(restoreSnapshot(emptyState()), StorageConflictError)
  assert.equal(database.writes, 0)
  assert.deepEqual(database.current, initial)
})

test('recovery handles malformed revisions without allowing stale tabs to reuse them', async t => {
  const database = databaseFor(t, { revision: 'broken', state: null })
  const recovering = restoreSnapshot(emptyState())
  await tick()
  database.latest().complete()
  const recovered = await recovering
  assert.match(String(recovered.revision), /^[a-f0-9]{32}$/)
  await assert.rejects(saveSnapshot(emptyState(), 0), StorageConflictError)
  await assert.rejects(saveSnapshot(emptyState(), 1), StorageConflictError)
  const saving = saveSnapshot(emptyState(), recovered.revision)
  await tick()
  database.latest().complete()
  const saved = await saving
  assert.notEqual(saved.revision, recovered.revision)
  await assert.rejects(saveSnapshot(emptyState(), recovered.revision), StorageConflictError)
})

test('invalid recovery imports never open a write transaction', async t => {
  const corrupt = { state: 'not readable' }
  const database = databaseFor(t, corrupt)
  await assert.rejects(restoreSnapshot({ schemaVersion: 99 } as unknown as AppState), /Unsupported backup schema/)
  assert.equal(database.writes, 0)
  assert.equal(database.transactions.length, 0)
  assert.deepEqual(database.current, corrupt)
})

test('loading schema 1 upgrades in memory without writing or changing the stored revision envelope', async t => {
  const initial = { revision: 14, state: emptyLegacyState() }
  const database = databaseFor(t, initial)
  const loading = loadSnapshot()
  await tick()
  database.latest().complete()
  const snapshot = await loading
  assert.equal(snapshot.state.schemaVersion, 2)
  assert.equal(snapshot.revision, 14)
  assert.deepEqual(snapshot.state.legacy, initial.state)
  assert.equal(database.writes, 0)
  assert.deepEqual(database.current, initial)
  const saving = saveSnapshot(snapshot.state, 14)
  await tick()
  assert.deepEqual(database.current, initial)
  database.latest().complete()
  const saved = await saving
  assert.equal(saved.state.schemaVersion, 2)
  assert.equal(saved.revision, 15)
  assert.deepEqual(database.current, saved)
})
