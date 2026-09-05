import { parseCampaign } from './model.ts'
import type { CampaignState } from './types.ts'

export interface CampaignSnapshot {
  revision: number
  state: CampaignState
}

const DATABASE = 'hybrid-planner-campaign'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Local storage is unavailable. Your training has not been saved.'))
      return
    }
    const request = indexedDB.open(DATABASE, 1)
    let blocked = false
    request.onupgradeneeded = () => request.result.createObjectStore('campaign')
    request.onblocked = () => {
      blocked = true
      reject(new Error('Close other planner tabs, then reload to unlock local storage.'))
    }
    request.onerror = () => reject(request.error ?? new Error('Could not open local training data.'))
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      if (blocked) request.result.close()
      else resolve(request.result)
    }
  })
}

function envelope(value: unknown): CampaignSnapshot {
  if (!value || typeof value !== 'object' || !('revision' in value) || !('state' in value) ||
    typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new Error('Saved campaign data is unreadable. It has not been replaced.')
  }
  return { revision: value.revision, state: parseCampaign(value.state) }
}

export async function loadCampaign(fresh: CampaignState): Promise<CampaignSnapshot> {
  const database = await open()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('campaign', 'readonly')
    const request = transaction.objectStore('campaign').get('current')
    transaction.oncomplete = () => {
      database.close()
      try {
        resolve(request.result === undefined ? { revision: 0, state: fresh } : envelope(request.result))
      } catch (error) { reject(error) }
    }
    transaction.onabort = () => {
      database.close()
      reject(transaction.error ?? new Error('Could not read local training data.'))
    }
  })
}

export async function persistCampaign(state: CampaignState, revision: number): Promise<CampaignSnapshot> {
  const validated = parseCampaign(state)
  const database = await open()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('campaign', 'readwrite')
    const store = transaction.objectStore('campaign')
    let failure: unknown
    const request = store.get('current')
    request.onsuccess = () => {
      try {
        const current = request.result === undefined ? 0 : envelope(request.result).revision
        if (current !== revision) throw new Error('Another tab saved changes. Reload before editing; nothing was overwritten.')
        store.put({ revision: revision + 1, state: validated }, 'current')
      } catch (error) {
        failure = error
        transaction.abort()
      }
    }
    transaction.oncomplete = () => {
      database.close()
      resolve({ revision: revision + 1, state: validated })
    }
    transaction.onabort = () => {
      database.close()
      reject(failure ?? transaction.error ?? new Error('Local save failed. Keep this page open and retry.'))
    }
  })
}
