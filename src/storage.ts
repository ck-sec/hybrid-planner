import type { AppState } from './model-state.ts'
import { emptyState, exportBackupText, parseBackupText } from './model-state.ts'

const DATABASE_NAME = 'hybrid-planner'
const STORE_NAME = 'state'
const STATE_KEY = 'current'

export interface StoredSnapshot {
  revision: number | string
  state: AppState
}

export class StorageConflictError extends Error {
  constructor() {
    super('Another tab changed your saved data. Nothing was overwritten. Reload saved data before trying again.')
    this.name = 'StorageConflictError'
  }
}

function storageError(error: unknown): Error {
  if (error instanceof Error && error.name === 'QuotaExceededError') {
    return new Error('Browser storage is full. Nothing was saved. Export your existing data, then free browser space and retry.')
  }
  return error instanceof Error ? error : new Error('Browser storage is unavailable. Nothing was saved.')
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser. Local saving is required; no in-memory fallback is used.'))
      return
    }
    let settled = false
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME)
    }
    request.onblocked = () => {
      settled = true
      reject(new Error('Local storage is blocked by another tab. Close other Hybrid Planner tabs and retry.'))
    }
    request.onerror = () => {
      settled = true
      reject(storageError(request.error))
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      if (settled) database.close()
      else {
        settled = true
        resolve(database)
      }
    }
  })
}

function parseEnvelope(value: unknown): StoredSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Stored data is malformed. It has not been changed.')
  const envelope = value as Record<string, unknown>
  if (!validRevision(envelope.revision) ||
      !Object.hasOwn(envelope, 'state') || Object.keys(envelope).length !== 2) {
    throw new Error('The saved data revision is invalid. Stored data has not been changed.')
  }
  let text: string
  try {
    text = JSON.stringify(envelope.state)
  } catch {
    throw new Error('Saved data is corrupted. It has not been changed.')
  }
  if (typeof text !== 'string') throw new Error('Saved data is missing. It has not been changed.')
  return { revision: envelope.revision as number | string, state: parseBackupText(text) }
}

function validRevision(value: unknown): value is number | string {
  return (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1) ||
    (typeof value === 'string' && /^[a-f0-9]{32}$/.test(value))
}

function freshRevision(): string {
  // A recovered record must never reuse a revision held by an older tab.
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('')
}

export async function loadSnapshot(): Promise<StoredSnapshot> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    let value: unknown
    let transaction: IDBTransaction
    try {
      transaction = database.transaction(STORE_NAME, 'readonly')
    } catch (error) {
      database.close()
      reject(storageError(error))
      return
    }
    const request = transaction.objectStore(STORE_NAME).get(STATE_KEY)
    request.onsuccess = () => { value = request.result }
    transaction.oncomplete = () => {
      database.close()
      try {
        resolve(value === undefined ? { revision: 0, state: emptyState() } : parseEnvelope(value))
      } catch (error) {
        reject(storageError(error))
      }
    }
    transaction.onabort = () => {
      database.close()
      reject(storageError(transaction.error))
    }
    transaction.onerror = () => { /* The abort event owns failure reporting. */ }
  })
}

export function saveSnapshot(state: AppState, expectedRevision: number | string): Promise<StoredSnapshot> {
  if (expectedRevision !== 0 && !validRevision(expectedRevision)) {
    return Promise.reject(new Error('The storage revision is invalid. Reload saved data.'))
  }
  return writeSnapshot(state, expectedRevision)
}

export function restoreSnapshot(state: AppState): Promise<StoredSnapshot> {
  return writeSnapshot(state, null)
}

async function writeSnapshot(state: AppState, expectedRevision: number | string | null): Promise<StoredSnapshot> {
  if (expectedRevision !== null && expectedRevision !== 0 && !validRevision(expectedRevision)) {
    throw new Error('The storage revision is invalid. Reload saved data.')
  }
  const validated = parseBackupText(exportBackupText(state))
  const snapshot: StoredSnapshot = {
    revision: typeof expectedRevision === 'number' && expectedRevision < Number.MAX_SAFE_INTEGER
      ? expectedRevision + 1 : freshRevision(),
    state: validated,
  }
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction
    let failure: Error | null = null
    try {
      transaction = database.transaction(STORE_NAME, 'readwrite')
    } catch (error) {
      database.close()
      reject(storageError(error))
      return
    }
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(STATE_KEY)
    request.onsuccess = () => {
      try {
        const current: unknown = request.result
        if (expectedRevision === null) {
          let readable = false
          if (current !== undefined) {
            try {
              parseEnvelope(current)
              readable = true
            } catch {
              // Recovery is explicit and only replaces an unreadable record.
            }
          }
          if (readable) throw new StorageConflictError()
        } else {
          const currentRevision = current === undefined ? 0 : parseEnvelope(current).revision
          if (currentRevision !== expectedRevision) throw new StorageConflictError()
        }
        store.put(snapshot, STATE_KEY)
      } catch (error) {
        failure = storageError(error)
        transaction.abort()
      }
    }
    transaction.oncomplete = () => {
      database.close()
      resolve(snapshot)
    }
    transaction.onabort = () => {
      database.close()
      reject(failure ?? storageError(transaction.error))
    }
    transaction.onerror = () => { /* A failed request aborts the entire state write. */ }
  })
}
