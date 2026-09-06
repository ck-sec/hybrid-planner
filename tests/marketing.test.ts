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
    assert.match(page.html, /property="og:image:alt" content="Hybrid Coach\. Your data\. Your workouts\. Stay yours\./)
    assert.match(page.html, /name="twitter:card" content="summary_large_image"/)
    assert.match(page.html, /name="twitter:image:alt" content="Hybrid Coach\. Your data\. Your workouts\. Stay yours\./)
    assert.doesNotMatch(page.html, /noindex|src="https?:|id="root"|\/src\/main|<form\b/)
    const schema = page.html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1]
    assert.ok(schema)
    const data: { '@graph': { '@type': string; url?: string }[] } = JSON.parse(schema)
    assert.ok(data['@graph'].some(item => item.url === siteOrigin + page.path))
  }
})

test('public pages use a privacy-first hero and abstract training visual, not sports artwork', () => {
  const pages = marketingPages()
  for (const page of pages) {
    assert.doesNotMatch(page.html, /Bangkok|dodgeball|court|throwing|view=legacy|original planner|planner archive/i)
    for (const image of page.html.matchAll(/<img\b[^>]*src="([^"]+)"/g)) {
      assert.match(image[1]!, /favicon\.svg$/, 'Marketing must not bring back the sports illustration')
    }
  }
  const home = pages.find(page => page.path === '/')
  assert.ok(home)
  assert.match(home.html, /<h1>Your data\.<br>Your workouts\.<br><span class="serif">Stay yours\.<\/span><\/h1>/)
  assert.match(home.html, /class="calendar-preview" aria-hidden="true"/)
  assert.match(home.html, /class="library-preview"/)
  assert.match(home.html, /<figcaption>Illustrative workspace, not a personal prescription\.<\/figcaption>/)
  const hero = home.html.match(/<section class="hero wrap">([^]*?)<\/section>/)?.[1]
  assert.ok(hero)
  assert.doesNotMatch(hero, /customExercises|version-[12]|workload profile|dose limits|<code>/)
  assert.match(hero, /No account\. No subscription\. No telemetry\./)
  assert.match(hero, /offline after your first successful load/)
  assert.match(hero, /href="\.\/app\/">Open your planner/)
  assert.match(home.description, /[Ll]ocal|[Oo]ffline/)
  assert.match(home.description, /optional AI/)
  assert.match(home.html, /"isAccessibleForFree":true,"license":"https:\/\/github\.com\/ck-sec\/hybrid-planner\/blob\/main\/LICENSE"/)
  assert.match(home.html, /"description":"A free, MIT-licensed, local-first training planner[^"]*offline after the first successful load[^"]*AI sharing is user-controlled/)
})

test('setup collects context once and clearly distinguishes AI suggestions from engine control', () => {
  const pages = marketingPages()
  const home = pages.find(page => page.path === '/')!.html
  const method = pages.find(page => page.path === '/method/')!.html
  for (const heading of ['Goal', 'Routine', 'Review']) {
    assert.ok(home.includes(`<h3>${heading}</h3>`))
  }
  assert.match(home, /Collect your context once, before any optional AI conversation/)
  assert.match(home, /Copy &rarr; discuss &rarr; review/)
  assert.match(home, /Or connect your own API key/)
  assert.match(home, /The engine controls quantities, loads, scheduling, and rule-based safety checks/)
  assert.match(home, /AI suggests exercises and explains choices; it cannot override those rules/)
  assert.match(home, /open tab&rsquo;s memory only, not in your saved training or backups/)
  assert.match(home, /work without AI or an API key/)
  assert.match(method, /historical prescriptions and weight records stay intact/)
  assert.match(method, /manual custom exercises and weekly review are complete without AI/)
  assert.doesNotMatch(method, /version-[12]|<code>customExercises<\/code>/)
})

test('exercise ownership and the actuals-to-next-week loop preserve previous work', () => {
  const pages = marketingPages()
  const home = pages.find(page => page.path === '/')!.html
  const method = pages.find(page => page.path === '/method/')!.html
  for (const heading of ['Description', 'Focus', 'Why it&rsquo;s here']) {
    assert.ok(home.includes(`<dt>${heading}</dt>`))
  }
  assert.match(home, /real custom exercise cards, not just notes/)
  assert.match(home, /equipment-aware built-in library/)
  for (const heading of ['Weekly actuals', 'Optional AI review', 'Approve next week']) {
    assert.ok(home.includes(`<h3>${heading}</h3>`))
  }
  assert.match(home, /Missing observations stay unknown/)
  for (const html of [home, method]) {
    assert.match(html, /Start a new plan/)
    assert.match(html, /Settings/)
    assert.match(html, /routine is prefilled/)
    assert.match(html, /[Rr]econfirm your current (?:training )?baseline/)
    assert.match(html, /[Pp]revious logged work[^]*read-only history/)
  }
})

test('privacy describes local ownership without claiming all data can never leave the device', () => {
  const pages = marketingPages()
  const home = pages.find(page => page.path === '/')!.html
  const privacy = pages.find(page => page.path === '/privacy/')!.html
  for (const html of [home, privacy]) {
    assert.match(html, /IndexedDB/)
    assert.match(html, /ordinary request metadata/)
    assert.match(html, /[Ll]ocal[^]*backup/)
    assert.match(html, /[Cc]learing[^]*browser|[Cc]learing site data/)
    assert.match(html, /[Rr]emote AI[^]*(?:connectivity|connection)/)
    assert.match(html, /offline copy is ready/)
    assert.doesNotMatch(html, /data never leaves|everything stays on your device|no (?:data|information) ever leaves/i)
  }
  assert.match(home, /Local-first does not mean nothing ever leaves your device/)
  assert.match(privacy, /no account, application backend, automatic cloud backup/)
  assert.match(privacy, /weekly-review brief additionally includes this week/)
  assert.match(privacy, /sets, repetitions, seconds, weights, duration, effort, notes and recorded health flags/)
  assert.match(privacy, /Neither brief exports the entire training history, raw activity files or API keys/)
  assert.match(privacy, /Setup sharing does not include training logs/)
  assert.match(privacy, /external provider or chat has its own terms and privacy policy/)
  assert.match(privacy, /Connection details and API keys stay in the open tab&rsquo;s memory/)
  assert.match(privacy, /Reloading or disconnecting clears it/)
  assert.match(privacy, /does not upload that history or create a remote backup/)
  assert.doesNotMatch(privacy, /excludes activity files, training logs and API keys|no logs (?:are|ever) sent/i)
})

test('the accessible static layout uses local assets, app CTAs, and the existing mobile brand', async () => {
  for (const page of marketingPages()) {
    assert.match(page.html, /<html lang="en">/)
    assert.match(page.html, /class="skip-link" href="#main">Skip to content/)
    assert.match(page.html, /<main id="main" tabindex="-1">/)
    assert.match(page.html, /<summary aria-label="Navigation menu">/)
    assert.match(page.html, /class="button button-small header-cta" href="(?:\.\/|(?:\.\.\/)+)app\/"/)
    for (const match of page.html.matchAll(/<(?:img|script|link)\b[^>]*(?:src|href)="([^"]+)"[^>]*>/g)) {
      if (/rel="canonical"/.test(match[0])) continue
      assert.doesNotMatch(match[1]!, /^(?:https?:)?\/\//, 'Assets must be self-hosted')
    }
  }
  const css = await readFile(new URL('../public/marketing.css', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /@import|url\(\s*['"]?(?:https?:)?\/\//i)
  assert.match(css, /--lapis:#213885/)
  assert.match(css, /--paper:#f8f3ee/)
  assert.match(css, /@media\(max-width:740px\)/)
  assert.match(css, /:focus-visible/)
  assert.match(css, /prefers-reduced-motion:reduce/)
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
