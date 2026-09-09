import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { build, preview } from 'vite'
import { marketingPages } from '../scripts/marketing.ts'

const project = resolve(import.meta.dirname, '..')
const configFile = join(project, 'vite.config.ts')

async function checkRoutes(origin: string, base: string) {
  for (const page of marketingPages()) {
    const response = await fetch(`${origin}${base}${page.path.slice(1)}`, { headers: { accept: 'text/html' } })
    assert.equal(response.status, 200, page.path)
    assert.match(await response.text(), /Hybrid Coach/)
  }

  const appUrl = `${origin}${base}app/`
  const app = await fetch(`${appUrl}?view=legacy`, { headers: { accept: 'text/html' } })
  assert.equal(app.status, 200)
  const html = await app.text()
  assert.match(html, /Training planner \| Hybrid Coach/)
  assert.match(html, /content="noindex, nofollow"/)
  assert.match(html, /id="root"/)
  assert.match(html, /<script type="module"/)

  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const target = new URL(match[1]!, appUrl)
    if (target.hash) continue
    assert.equal(target.origin, origin)
    assert.ok(target.pathname.startsWith(base), target.href)
    assert.equal((await fetch(target)).status, 200, target.href)
  }

  for (const [path, status, destination] of [
    ['app', 301, 'app/'],
    ['app/index.html', 301, 'app/'],
    ['app/training', 302, 'app/'],
    ['app/training/week/', 302, 'app/'],
    ['learn', 301, 'learn/'],
    ['learn/index.html', 301, 'learn/'],
    ['index.html', 301, ''],
  ] as const) {
    const response = await fetch(`${origin}${base}${path}?keep=1`, { redirect: 'manual' })
    assert.equal(response.status, status, path)
    assert.equal(response.headers.get('location'), `${base}${destination}?keep=1`)
  }

  for (const [path, status] of [['', 200], ['app/', 200], ['not-a-page/', 404]] as const) {
    const response = await fetch(`${origin}${base}${path}`, { method: 'HEAD', headers: { accept: 'text/html' } })
    assert.equal(response.status, status, path)
    assert.equal(await response.text(), '')
  }

  const missing = await fetch(`${origin}${base}not-a-page/`, { headers: { accept: 'text/html' } })
  assert.equal(missing.status, 404)
  assert.match(await missing.text(), /Page not found/)
  const retirement = await fetch(`${origin}${base}sw.js`)
  assert.equal(retirement.status, 200)
  assert.match(await retirement.text(), /registration\.unregister\(\)/)
}

test('the marketing site and planner build and serve correctly at root and a subdirectory', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'hybrid-coach-site-'))
  try {
    for (const base of ['./', '/preview/']) {
      const prefix = base === './' ? '/' : base
      const outDir = join(temporary, base === './' ? 'root' : 'subdirectory')
      await t.test(`build and preview with base ${base}`, async () => {
        await build({ configFile, base, logLevel: 'silent', build: { outDir, emptyOutDir: true } })
        const files = await readdir(outDir, { recursive: true })
        const javascript = files.filter(file => file.endsWith('.js')).sort()
        assert.ok(javascript.includes('site.js'))
        assert.ok(javascript.includes('sw.js'))
        assert.ok(javascript.some(file => /(?:^|[/\\])assets[/\\]index-[^/\\]+\.js$/.test(file)))
        assert.equal(files.some(file => /(?:^|[/\\])(?:src|engine)(?:$|[/\\])/.test(file)), false)
        const sitemap = await readFile(join(outDir, 'sitemap.xml'), 'utf8')
        assert.equal(sitemap.match(/<loc>/g)?.length, 7)
        assert.doesNotMatch(sitemap, /\/app\//)

        const server = await preview({
          configFile, base, logLevel: 'silent', build: { outDir },
          preview: { host: '127.0.0.1', port: 0, strictPort: true },
        })
        try {
          const address = server.httpServer.address()
          assert.ok(address && typeof address !== 'string')
          await checkRoutes(`http://127.0.0.1:${address.port}`, prefix)
        } finally {
          await server.close()
        }
      })

    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
