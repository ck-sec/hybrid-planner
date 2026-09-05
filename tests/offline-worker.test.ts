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
  const marketingResponse = { body: 'cached marketing homepage' }
  const guideResponse = { body: 'cached guide' }
  const assets = ['./', './app/', './learn/example/', './assets/app.js']
  runInNewContext(offlineWorkerSource('new', assets), {
    URL, Response,
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
          match: async (request: unknown, options: { ignoreVary?: boolean }) => {
            if (!options?.ignoreVary) return undefined
            if (request === scope) return marketingResponse
            if (request === `${scope}learn/example/`) return guideResponse
            if (request === `${scope}app/` || typeof request !== 'string') return cachedResponse
            return undefined
          },
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
    deleted, precached, cacheNames, cachedResponse, marketingResponse, guideResponse, currentCache, assets,
    networkRequests: () => networkRequests,
    isReady: () => activated && claimed,
  }
}

test('precache and activation are scoped to this static app, leaving other caches alone', async () => {
  const app = worker()
  await app.dispatch('install')
  await app.dispatch('activate')
  assert.deepEqual(app.precached, app.assets)
  assert.deepEqual(app.deleted, [app.currentCache.replace(/new$/, 'old')])
  assert.equal(app.isReady(), true)
})

test('offline app navigation and assets tolerate Vary: Origin', async () => {
  const app = worker()
  for (const [url, mode] of [
    ['https://example.test/planner/app/', 'navigate'],
    ['https://example.test/planner/app/?view=legacy', 'navigate'],
    ['https://example.test/planner/app/training/week', 'navigate'],
    ['https://example.test/planner/assets/app.js', 'cors'],
    ['https://example.test/planner/assets/app.css', 'cors'],
  ]) {
    assert.equal(await app.dispatch('fetch', { method: 'GET', url, mode }), app.cachedResponse)
  }
  assert.equal(app.networkRequests(), 0)
})

test('marketing and guides get their own HTML instead of the old root app shell', async () => {
  const app = worker()
  assert.equal(await app.dispatch('fetch', { method: 'GET', url: 'https://example.test/planner/', mode: 'navigate' }), app.marketingResponse)
  assert.equal(await app.dispatch('fetch', { method: 'GET', url: 'https://example.test/planner/?view=legacy', mode: 'navigate' }), app.marketingResponse)
  assert.equal(await app.dispatch('fetch', { method: 'GET', url: 'https://example.test/planner/learn/example/?ref=search', mode: 'navigate' }), app.guideResponse)
  await assert.rejects(app.dispatch('fetch', { method: 'GET', url: 'https://example.test/planner/not-a-page/', mode: 'navigate' }), /offline/)
  assert.equal(app.networkRequests(), 1)
})

test('directory and index.html redirects preserve queries without caching a redirected response', async () => {
  const app = worker()
  for (const [path, target] of [
    ['app', 'app/'], ['app/index.html', 'app/'], ['index.html', ''], ['learn/example', 'learn/example/'],
  ]) {
    const result = await app.dispatch('fetch', { method: 'GET', url: `https://example.test/planner/${path}?keep=1`, mode: 'navigate' })
    assert.ok(result instanceof Response)
    assert.equal(result.status, 301)
    assert.equal(result.headers.get('location'), `https://example.test/planner/${target}?keep=1`)
  }
})

test('the offline worker does not intercept remote requests or non-GET actions', async () => {
  const app = worker()
  assert.equal(await app.dispatch('fetch', { method: 'GET', url: 'https://another.test/', mode: 'cors' }), undefined)
  assert.equal(await app.dispatch('fetch', { method: 'POST', url: 'https://example.test/planner/', mode: 'cors' }), undefined)
  assert.equal(await app.dispatch('fetch', { method: 'GET', url: 'https://example.test/another-app/', mode: 'navigate' }), undefined)
  assert.equal(app.cacheNames.length, 0)
})
