import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { offlineManifest } from '../scripts/offline-manifest.ts'

test('Cloudflare configuration changes invalidate the cache without being precached', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hybrid-offline-manifest-'))
  try {
    await mkdir(join(directory, 'assets'))
    await mkdir(join(directory, 'app'))
    await mkdir(join(directory, 'learn', 'example'), { recursive: true })
    for (const [name, content] of [
      ['index.html', '<html>Marketing</html>'],
      ['app/index.html', '<html>App</html>'],
      ['learn/example/index.html', '<html>Guide</html>'],
      ['404.html', '<html>Not found</html>'],
      ['assets/app.js', 'export const ready = true'],
      ['favicon.svg', '<svg/>'],
      ['_headers', '/sw.js\n  Cache-Control: no-cache'],
      ['_redirects', '/old-path /new-path 301'],
      ['_routes.json', '{"version":1}'],
      ['sw.js', 'Old generated worker'],
    ]) await writeFile(join(directory, name), content)
    const before = await offlineManifest(directory)
    assert.deepEqual(before.urls, ['./app/', './assets/app.js', './favicon.svg', './', './learn/example/'])
    assert.match(before.version, /^[a-f0-9]{16}$/)
    assert.deepEqual(await offlineManifest(directory), before)
    await writeFile(join(directory, '_headers'), '/*\n  Referrer-Policy: no-referrer')
    const changed = await offlineManifest(directory)
    assert.deepEqual(changed.urls, before.urls)
    assert.notEqual(changed.version, before.version)
    await writeFile(join(directory, 'sw.js'), 'New generated worker')
    assert.deepEqual(await offlineManifest(directory), changed)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
