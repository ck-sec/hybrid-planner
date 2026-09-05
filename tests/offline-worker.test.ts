import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { offlineWorkerSource } from '../scripts/offline-worker.ts'

interface WorkerEvent {
  request?: { method: string; url: string; mode: string }
  waitUntil?: (work: Promise<unknown>) => void
  respondWith?: (response: Promise<unknown>) => void
}

function worker() {
  const scope = 'https://example.test/planner/'
  const prefix = 'hybrid-planner-' + encodeURIComponent(scope) + '-'
  const currentCache = prefix + 'new'
  const handlers = new Map<string, (event: WorkerEvent) => void>()
  const deleted: string[] = []
  const precached: string[] = []
  const cacheNames: string[] = []
  let networkRequests = 0
  let claimed = false
  let activated = false
  const cachedResponse = { body: 'cached app file' }
  runInNewContext(offlineWorkerSource('new', ['./', './assets/app.js']), {
    URL,
    self: {
      registration: { scope },
      location: { origin: 'https://example.test' },
      addEventListener: (name: string, handler: (event: WorkerEvent) => void) => handlers.set(name, handler),
      skipWaiting: () => { activated = true },
      clients: { claim: () => { claimed = true } },
    },
    caches: {
      open: async (name: string) => {
        cacheNames.push(name)
        return {
          addAll: async (urls: string[]) => { precached.push(...urls) },
          match: async (request: unknown, options: { ignoreVary?: boolean }) =>
            options?.ignoreVary && (typeof request !== 'string' || request === './') ? cachedResponse : undefined,
        }
      },
      keys: async () => [currentCache, prefix + 'old', 'unrelated-cache', 'hybrid-planner-other-scope-old'],
      delete: async (name: string) => { deleted.push(name); return true },
    },
    fetch: () => { networkRequests++; throw new Error('The static host is offline.') },
  })
  return {
    async dispatch(name: string, request?: WorkerEvent['request']) {
      let work: Promise<unknown> | undefined
      const handler = handlers.get(name)
      assert.ok(handler)
      handler({ request, waitUntil: value => { work = value }, respondWith: value => { work = value } })
      return work
    },
    deleted, precached, cacheNames, cachedResponse, currentCache,
    networkRequests: () => networkRequests,
    isReady: () => activated && claimed,
  }
}

test('precache and activation are scoped to this static app, leaving other caches alone', async () => {
  const app = worker()
  await app.dispatch('install')
  await app.dispatch('activate')
  assert.deepEqual(app.precached, ['./', './assets/app.js'])
  assert.deepEqual(app.deleted, [app.currentCache.replace(/new$/, 'old')])
  assert.equal(app.isReady(), true)
})

test('offline navigation uses the canonical scope root and assets tolerate Vary: Origin', async () => {
  const app = worker()
  for (const [url, mode] of [
    ['https://example.test/planner/', 'navigate'],
    ['https://example.test/planner/assets/app.js', 'cors'],
    ['https://example.test/planner/assets/app.css', 'cors'],
  ]) {
    assert.equal(await app.dispatch('fetch', { method: 'GET', url, mode }), app.cachedResponse)
  }
  assert.equal(app.networkRequests(), 0)
})

test('the offline worker does not intercept remote requests or non-GET actions', async () => {
  const app = worker()
  assert.equal(await app.dispatch('fetch', { method: 'GET', url: 'https://another.test/', mode: 'cors' }), undefined)
  assert.equal(await app.dispatch('fetch', { method: 'POST', url: 'https://example.test/planner/', mode: 'cors' }), undefined)
  assert.equal(app.cacheNames.length, 0)
})
