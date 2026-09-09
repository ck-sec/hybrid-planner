import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')

function worker(scope: string, deletionError?: Error) {
  const prefix = 'hybrid-planner-' + encodeURIComponent(scope) + '-'
  const cacheNames = [prefix + 'old', prefix + 'latest', 'unrelated-cache', 'hybrid-planner-other-scope-old']
  const handlers = new Map<string, (event: { waitUntil: (work: Promise<unknown>) => void }) => void>()
  const operations: string[] = []
  runInNewContext(source, {
    self: {
      registration: {
        scope,
        unregister: async () => { operations.push('unregister'); return true },
      },
      addEventListener: (name: string, handler: (event: { waitUntil: (work: Promise<unknown>) => void }) => void) => handlers.set(name, handler),
      skipWaiting: async () => { operations.push('skipWaiting') },
      clients: { claim: async () => { operations.push('claim') } },
    },
    caches: {
      keys: async () => cacheNames,
      delete: async (name: string) => {
        if (deletionError) throw deletionError
        operations.push(`delete:${name}`)
        return true
      },
    },
  })
  return {
    handlers,
    operations,
    prefix,
    async dispatch(name: string) {
      const handler = handlers.get(name)
      assert.ok(handler)
      let work: Promise<unknown> | undefined
      handler({ waitUntil: value => { work = value } })
      assert.ok(work, 'Worker lifetime must include its asynchronous cleanup')
      await work
    },
  }
}

test('retirement deletes only the old scoped asset caches, takes control, and unregisters', async () => {
  for (const scope of ['https://example.test/', 'https://example.test/preview/']) {
    const retired = worker(scope)
    await retired.dispatch('install')
    await retired.dispatch('activate')
    assert.deepEqual(retired.operations, [
      'skipWaiting',
      `delete:${retired.prefix}old`,
      `delete:${retired.prefix}latest`,
      'claim',
      'unregister',
    ])
    assert.equal(retired.handlers.has('fetch'), false, 'The retired worker must not serve cached app files')
  }
  assert.doesNotMatch(source, /indexedDB|localStorage|sessionStorage|fetch\(|caches\.open|navigate\(/)
})

test('failed cache cleanup rejects activation instead of reporting successful retirement', async () => {
  const failure = new Error('Cache deletion failed')
  const retired = worker('https://example.test/', failure)
  await assert.rejects(retired.dispatch('activate'), error => error === failure)
  assert.deepEqual(retired.operations, [])
})
