import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { emptyCampaign } from './model.ts'
import { loadCampaign, persistCampaign } from './storage.ts'

class Transaction {
  oncomplete: (() => void) | null = null
  onabort: (() => void) | null = null
  error: DOMException | null = null
  pending: unknown
  written = false
  database: Database
  constructor(database: Database) { this.database = database }
  objectStore(name: string) {
    assert.equal(name, 'campaign')
    return {
      get: (key: string) => {
        assert.equal(key, 'current')
        const request: { result: unknown; onsuccess?: () => void } = { result: undefined }
        queueMicrotask(() => { request.result = structuredClone(this.database.data); request.onsuccess?.() })
        return request
      },
      put: (value: unknown, key: string) => {
        assert.equal(key, 'current')
        this.pending = structuredClone(value)
        this.written = true
      },
    }
  }
  abort() { queueMicrotask(() => this.onabort?.()) }
  complete() {
    if (this.written) this.database.data = this.pending
    this.oncomplete?.()
  }
}

class Database {
  data: unknown
  transactions: Transaction[] = []
  openNames: string[] = []
  open(name: string) {
    this.openNames.push(name)
    const request = {
      result: {
        close: () => {},
        onversionchange: null,
        transaction: () => {
          const transaction = new Transaction(this)
          this.transactions.push(transaction)
          return transaction
        },
      },
      onsuccess: null as (() => void) | null,
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

const tick = () => new Promise<void>(resolve => setImmediate(resolve))
function fakeDatabase(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  const database = new Database()
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open: (name: string) => database.open(name) } })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original)
    else Reflect.deleteProperty(globalThis, 'indexedDB')
  })
  return database
}

test('campaign draft reads never overwrite the original planner or write on startup', async t => {
  const database = fakeDatabase(t)
  const fresh = emptyCampaign('2026-09-07')
  const loading = loadCampaign(fresh)
  await tick()
  assert.equal(database.latest().written, false)
  database.latest().complete()
  assert.deepEqual(await loading, { revision: 0, state: fresh })
  assert.deepEqual(database.openNames, ['hybrid-planner-campaign'])
})

test('draft and unconfirmed set values save only after transaction commit', async t => {
  const database = fakeDatabase(t)
  const state = emptyCampaign('2026-09-07')
  state.draft.goalLabel = 'Bangkok'
  let resolved = false
  const saving = persistCampaign(state, 0).then(snapshot => { resolved = true; return snapshot })
  await tick()
  assert.equal(resolved, false)
  assert.equal(database.data, undefined)
  database.latest().complete()
  assert.equal((await saving).state.draft.goalLabel, 'Bangkok')
  assert.equal(resolved, true)
  assert.deepEqual(database.data, { revision: 1, state })
})

test('cross-tab conflicts keep the newer campaign intact', async t => {
  const database = fakeDatabase(t)
  const state = emptyCampaign('2026-09-07')
  database.data = { revision: 3, state }
  const before = structuredClone(database.data)
  const saving = assert.rejects(persistCampaign({ ...state, step: 1 }, 2), /another tab/i)
  await tick()
  await saving
  assert.equal(database.latest().written, false)
  assert.deepEqual(database.data, before)
})

test('quota failure rejects without replacing the last committed record', async t => {
  const database = fakeDatabase(t)
  const state = emptyCampaign('2026-09-07')
  database.data = { revision: 2, state }
  const before = structuredClone(database.data)
  const saving = assert.rejects(persistCampaign({ ...state, step: 1 }, 2), /Quota/i)
  await tick()
  database.latest().error = new DOMException('Quota exceeded', 'QuotaExceededError')
  database.latest().abort()
  await saving
  assert.deepEqual(database.data, before)
})

test('corrupted campaigns fail closed instead of becoming empty drafts', async t => {
  const database = fakeDatabase(t)
  database.data = { revision: 1, state: { version: 99 } }
  const loading = assert.rejects(loadCampaign(emptyCampaign('2026-09-07')))
  await tick()
  database.latest().complete()
  await loading
  assert.equal(database.latest().written, false)
  assert.deepEqual(database.data, { revision: 1, state: { version: 99 } })
})
