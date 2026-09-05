import assert from 'node:assert/strict'
import { test } from 'node:test'
import { observeOfflineWorker } from './offline.ts'
import type { OfflineStatus, WorkerRegistrar } from './offline.ts'

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing'

  changeState(state: ServiceWorkerState) {
    this.state = state
    this.dispatchEvent(new Event('statechange'))
  }
}

class FakeRegistration extends EventTarget {
  installing: ServiceWorker | null = null
  waiting: ServiceWorker | null = null
  active: ServiceWorker | null = null
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve))

test('development without the build meta never requests a missing service worker', async () => {
  let requests = 0
  const registrar: WorkerRegistrar = { register: async () => { requests++; throw new Error('Must not register') } }
  const statuses: OfflineStatus[] = []
  observeOfflineWorker(null, 'http://localhost:5173/', registrar, status => statuses.push(status))
  await tick()
  assert.equal(requests, 0)
  assert.equal(statuses.at(-1)?.kind, 'disabled')
})

test('registration stays relative to static subpaths and reports ready only after activation', async () => {
  const worker = new FakeWorker()
  const registration = new FakeRegistration()
  registration.installing = worker as unknown as ServiceWorker
  let requestedURL = ''
  let requestedScope = ''
  const registrar: WorkerRegistrar = {
    register: async (url, options) => {
      requestedURL = String(url)
      requestedScope = options?.scope ?? ''
      return registration as unknown as ServiceWorkerRegistration
    },
  }
  const statuses: OfflineStatus[] = []
  const stop = observeOfflineWorker('./sw.js', 'https://planner.example/tools/hybrid/', registrar, status => statuses.push(status))
  await tick()
  assert.equal(requestedURL, 'https://planner.example/tools/hybrid/sw.js')
  assert.equal(requestedScope, 'https://planner.example/tools/hybrid/')
  assert.equal(statuses.at(-1)?.kind, 'installing')
  worker.changeState('installed')
  assert.equal(statuses.at(-1)?.kind, 'installing')
  worker.changeState('activating')
  assert.equal(statuses.at(-1)?.kind, 'installing')
  worker.changeState('activated')
  assert.equal(statuses.at(-1)?.kind, 'ready')
  stop()
})

test('already activated workers are recognized and later updates are observed', async () => {
  const active = new FakeWorker()
  active.state = 'activated'
  const registration = new FakeRegistration()
  registration.active = active as unknown as ServiceWorker
  const registrar: WorkerRegistrar = { register: async () => registration as unknown as ServiceWorkerRegistration }
  const statuses: OfflineStatus[] = []
  const stop = observeOfflineWorker('./sw.js', 'https://planner.example/', registrar, status => statuses.push(status))
  await tick()
  assert.equal(statuses.at(-1)?.kind, 'ready')
  const update = new FakeWorker()
  registration.installing = update as unknown as ServiceWorker
  registration.dispatchEvent(new Event('updatefound'))
  assert.equal(statuses.at(-1)?.kind, 'installing')
  active.changeState('redundant')
  assert.equal(statuses.at(-1)?.kind, 'installing')
  update.changeState('activated')
  assert.equal(statuses.at(-1)?.kind, 'ready')
  stop()
})

test('registration rejection and failed installation never report offline success', async () => {
  const rejected: OfflineStatus[] = []
  const failing: WorkerRegistrar = { register: async () => { throw new Error('Network error') } }
  observeOfflineWorker('./sw.js', 'https://planner.example/', failing, status => rejected.push(status))
  await tick()
  assert.equal(rejected.at(-1)?.kind, 'failed')
  assert.equal(rejected.some(status => status.kind === 'ready'), false)

  const worker = new FakeWorker()
  const registration = new FakeRegistration()
  registration.installing = worker as unknown as ServiceWorker
  const statuses: OfflineStatus[] = []
  const registrar: WorkerRegistrar = { register: async () => registration as unknown as ServiceWorkerRegistration }
  const stop = observeOfflineWorker('./sw.js', 'https://planner.example/', registrar, status => statuses.push(status))
  await tick()
  worker.changeState('redundant')
  assert.equal(statuses.at(-1)?.kind, 'failed')
  assert.equal(statuses.some(status => status.kind === 'ready'), false)
  stop()
})

test('unsupported contexts and invalid or remote metadata never register', async () => {
  let requests = 0
  const registrar: WorkerRegistrar = { register: async () => { requests++; throw new Error('Must not register') } }
  for (const path of ['', 'https://another-origin.example/sw.js', 'data:text/javascript,']) {
    const statuses: OfflineStatus[] = []
    observeOfflineWorker(path, 'https://planner.example/', registrar, status => statuses.push(status))
    assert.equal(statuses.at(-1)?.kind, 'failed')
  }
  const unsupported: OfflineStatus[] = []
  observeOfflineWorker('./sw.js', 'https://planner.example/', undefined, status => unsupported.push(status))
  assert.equal(unsupported.at(-1)?.kind, 'failed')
  await tick()
  assert.equal(requests, 0)
})

test('cleanup suppresses late asynchronous activation notifications', async () => {
  const worker = new FakeWorker()
  const registration = new FakeRegistration()
  registration.installing = worker as unknown as ServiceWorker
  const registrar: WorkerRegistrar = { register: async () => registration as unknown as ServiceWorkerRegistration }
  const statuses: OfflineStatus[] = []
  const stop = observeOfflineWorker('./sw.js', 'https://planner.example/', registrar, status => statuses.push(status))
  await tick()
  const count = statuses.length
  stop()
  worker.changeState('activated')
  registration.dispatchEvent(new Event('updatefound'))
  assert.equal(statuses.length, count)
})
