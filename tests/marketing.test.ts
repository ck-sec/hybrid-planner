import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { escapeHtml, marketingPages, notFoundPage, siteOrigin, sitemap } from '../scripts/marketing.ts'
import { marketingGuides } from '../scripts/marketing-content.ts'

test('every public page is crawlable HTML with unique search and social metadata', () => {
  const pages = marketingPages()
  assert.equal(pages.length, 7)
  assert.equal(new Set(pages.map(page => page.title)).size, pages.length)
  assert.equal(new Set(pages.map(page => page.description)).size, pages.length)
  for (const page of pages) {
    assert.match(page.html, /^<!doctype html>/)
    assert.equal(page.html.match(/<h1>/g)?.length, 1)
    assert.ok(page.html.includes(`<link rel="canonical" href="${siteOrigin}${page.path}">`))
    assert.ok(page.html.includes(`<meta name="description" content="${escapeHtml(page.description)}">`))
    assert.match(page.html, /property="og:image"/)
    assert.match(page.html, /name="twitter:card" content="summary_large_image"/)
    assert.doesNotMatch(page.html, /noindex|src="https?:|id="root"|\/src\/main|<form\b/)
    const schema = page.html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1]
    assert.ok(schema)
    const data: { '@graph': { '@type': string; url?: string }[] } = JSON.parse(schema)
    assert.ok(data['@graph'].some(item => item.url === siteOrigin + page.path))
  }
})

test('internal links and fragments resolve without JavaScript at root or a subdirectory', () => {
  const pages = marketingPages()
  for (const prefix of ['', '/preview']) {
    const urls = new Map(pages.map(page => [`${siteOrigin}${prefix}${page.path}`, page.html]))
    for (const page of pages) {
      for (const match of page.html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
        const target = new URL(match[1]!, `${siteOrigin}${prefix}${page.path}`)
        if (target.origin !== siteOrigin) continue
        const path = target.pathname.slice(prefix.length)
        if (path === '/app/') continue
        const html = urls.get(target.origin + target.pathname)
        assert.ok(html, `Broken link on ${page.path}: ${match[1]}`)
        if (target.hash) assert.ok(html.includes(`id="${target.hash.slice(1)}"`), `Missing fragment: ${target.href}`)
      }
    }
  }
})

test('guides include substantial original content, visible sources and matching Article markup', () => {
  const pages = marketingPages()
  for (const guide of marketingGuides) {
    const page = pages.find(page => page.path === `/learn/${guide.slug}/`)
    assert.ok(page)
    const words = [...guide.intro, ...guide.sections.flatMap(section => [...section.paragraphs, ...(section.bullets ?? [])])].join(' ').split(/\s+/).length
    assert.ok(words >= 600, `${guide.slug}: ${words} words`)
    assert.ok(guide.sources.length >= 2)
    assert.match(page.html, /"@type":"Article"/)
    assert.match(page.html, /"@type":"BreadcrumbList"/)
    assert.match(page.html, /By <a href="..\/..\/method\/">Hybrid Coach<\/a>/)
    for (const source of guide.sources) {
      assert.equal(new URL(source.url).protocol, 'https:')
      assert.ok(page.html.includes(`href="${escapeHtml(source.url)}"`))
    }
  }
})

test('sitemap excludes the private workspace and error pages', () => {
  const xml = sitemap(marketingPages())
  assert.equal(xml.match(/<loc>/g)?.length, 7)
  assert.doesNotMatch(xml, /\/app\/|404/)
  assert.match(notFoundPage(), /content="noindex, follow"/)
  assert.match(notFoundPage('/preview/'), /href="\/preview\/app\/"/)
  assert.doesNotMatch(notFoundPage(), /rel="canonical"/)
})

test('the relocated app is noindex and its storage identifiers are not migrated', async () => {
  const html = await readFile(new URL('../app/index.html', import.meta.url), 'utf8')
  assert.match(html, /content="noindex, follow"/)
  assert.match(html, /src="\/src\/main.tsx"/)
  const bookmarkScript = await readFile(new URL('../public/site.js', import.meta.url), 'utf8')
  assert.doesNotMatch(bookmarkScript, /indexedDB|localStorage|fetch\(|sendBeacon|serviceWorker/)
  assert.match(bookmarkScript, /view.*legacy/)
  assert.match(bookmarkScript, /planner.hash = address.hash/)
})

test('editorial text and metadata are escaped rather than interpreted as markup', () => {
  assert.equal(escapeHtml('<script>"&\'</script>'), '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;')
})

test('old planner bookmarks move to the same-origin app without redirecting normal visitors', async () => {
  const source = await readFile(new URL('../public/site.js', import.meta.url), 'utf8')
  for (const [address, expected] of [
    [`${siteOrigin}/`, undefined],
    [`${siteOrigin}/?source=search`, undefined],
    [`${siteOrigin}/#how-it-works`, undefined],
    [`${siteOrigin}/?view=legacy&keep=1`, `${siteOrigin}/app/?view=legacy&keep=1`],
    [`${siteOrigin}/#session/abc`, `${siteOrigin}/app/#session/abc`],
    [`${siteOrigin}/preview/?view=legacy#session/abc`, `${siteOrigin}/preview/app/?view=legacy#session/abc`],
  ]) {
    let redirected: string | undefined
    runInNewContext(source, { URL, location: { href: address, replace: (href: string) => { redirected = href } } })
    assert.equal(redirected, expected)
  }
})

test('the self-hosted social preview has the declared 1200 by 630 dimensions', async () => {
  const png = await readFile(new URL('../public/social-card.png', import.meta.url))
  assert.equal(png.subarray(1, 4).toString(), 'PNG')
  assert.equal(png.readUInt32BE(16), 1200)
  assert.equal(png.readUInt32BE(20), 630)
})

test('Cloudflare app rewrites target a canonical directory, not an index.html redirect loop', async () => {
  const redirects = await readFile(new URL('../public/_redirects', import.meta.url), 'utf8')
  assert.match(redirects, /^\/app \s*\/app\/ 301$/m)
  assert.match(redirects, /^\/app\/\* \s*\/app\/ 200$/m)
  assert.doesNotMatch(redirects, /index\.html|^\/\* /m)
})
