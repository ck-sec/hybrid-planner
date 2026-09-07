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
    assert.match(page.html, /property="og:image:alt" content="Hybrid Coach\. Running and lifting\. One plan that fits\. Room for your other sports\./)
    assert.match(page.html, /name="twitter:card" content="summary_large_image"/)
    assert.match(page.html, /name="twitter:image:alt" content="Hybrid Coach\. Running and lifting\. One plan that fits\. Room for your other sports\./)
    assert.doesNotMatch(page.html, /noindex|src="https?:|id="root"|\/src\/main|<form\b/)
    const schema = page.html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1]
    assert.ok(schema)
    const data: { '@graph': { '@type': string; url?: string }[] } = JSON.parse(schema)
    assert.ok(data['@graph'].some(item => item.url === siteOrigin + page.path))
  }
})

test('public pages lead with hybrid training and room for other sports without sport-specific artwork', () => {
  const pages = marketingPages()
  for (const page of pages) {
    assert.doesNotMatch(page.html, /Bangkok|dodgeball|court|view=legacy|original planner|planner archive/i)
    for (const image of page.html.matchAll(/<img\b[^>]*src="([^"]+)"/g)) {
      assert.match(image[1]!, /favicon\.svg$/, 'Marketing must not bring back the sports illustration')
    }
  }
  const home = pages.find(page => page.path === '/')
  assert.ok(home)
  assert.equal(home.title, 'Free Hybrid Training Planner for Running & Lifting | Hybrid Coach')
  assert.match(home.html, /<h1>Running<br>and lifting\.<br><span class="serif">One plan that fits\.<\/span><\/h1>/)
  assert.match(home.html, /class="calendar-preview" aria-hidden="true"/)
  assert.match(home.html, /class="library-preview"/)
  assert.match(home.html, /<figcaption>Illustrative workspace, not a personal prescription\.<\/figcaption>/)
  const hero = home.html.match(/<section class="hero wrap">([^]*?)<\/section>/)?.[1]
  assert.ok(hero)
  assert.match(hero, /room for the other sports you love/)
  assert.match(hero, /Your other sport/)
  assert.match(hero, /Practice belongs in the same week/)
  assert.match(home.html, /Add practices for your other sports as fixed sessions/)
  assert.match(home.html, /does not generate a complete sport-specific coaching programme for every activity/)
  assert.doesNotMatch(hero, /customExercises|version-[123]|workload profile|dose limits|throwing|<code>/)
  assert.match(hero, /No account\. No subscription\. No telemetry\./)
  assert.match(hero, /offline after your first successful load/)
  assert.match(hero, /href="\.\/app\/">Open planner/)
  assert.match(home.description, /[Ll]ocal|[Oo]ffline/)
  assert.match(home.description, /optional AI/)
  assert.match(home.description, /other sports in one plan/)
  assert.match(home.html, /"isAccessibleForFree":true,"license":"https:\/\/github\.com\/ck-sec\/hybrid-planner\/blob\/main\/LICENSE"/)
  assert.match(home.html, /"description":"A free, MIT-licensed, local-first training planner[^"]*offline after the first successful load[^"]*AI sharing is user-controlled/)
})

test('setup separates desired and current training and distinguishes AI advice from integrity checks', () => {
  const pages = marketingPages()
  const home = pages.find(page => page.path === '/')!.html
  const method = pages.find(page => page.path === '/method/')!.html
  for (const heading of ['Goal', 'Routine', 'Review']) {
    assert.ok(home.includes(`<h3>${heading}</h3>`))
  }
  assert.match(home, /Collect your goal, desired routine and fixed sessions before any optional AI conversation/)
  assert.match(home, /days, start time and duration before AI/)
  assert.match(home, /Confirm current training separately from your desired routine/)
  assert.match(home, /through chat or the local assessment/)
  assert.match(home, /Review a built-in or AI-proposed week; approve it after app checks/)
  assert.match(home, /Copy, discuss, review/)
  assert.match(home, /Or connect your own API key/)
  assert.match(home, /AI can propose a week\. The app checks it\. You approve\./)
  assert.match(method, /AI can propose complete weeks with supported sets, repetitions, seconds, effort targets, duration and placement/)
  assert.match(home, /app flags training concerns and checks data, equipment and recorded-work integrity/)
  assert.match(method, /AI cannot redefine scheduling costs, exercise profiles, approvals or initial weights/)
  assert.match(home, /You and your AI choose training frequency, rest and progression/)
  assert.match(home, /open tab&rsquo;s memory, not saved training or backups/)
  assert.match(home, /not medical clearance or a guarantee against injury/)
  assert.match(home, /work without AI or an API key/)
  assert.match(method, /historical prescriptions and weight records stay intact/)
  assert.match(method, /manual custom exercises and weekly review are complete without AI/)
  assert.match(method, /Desired training is not a baseline/)
  assert.match(method, /[Ii]mported records cannot fill those answers automatically/)
  assert.match(method, /average-duration sliders show the weekly time you want; a long run can exceed that average/)
  assert.match(method, /frequency, volume, rest and recovery checks are advice, not automatic vetoes/)
  assert.match(method, /Two-a-days and weeks without a full rest day are supported/)
  assert.match(method, /Malformed data, unavailable equipment and changes to recorded work remain blocked/)
  assert.match(method, /built-in planner and older saved weeks retain their original training policies/)
  assert.match(method, /built-in pool uses four to seven exercises/)
  assert.match(method, /complete authored week may use up to 32 distinct exercise and drill identities/)
  assert.match(method, /maximum is not a recommended dose/)
  assert.match(method, /controlled target throwing use immutable identities and app-owned profiles/)
  assert.match(method, /no separate rower\/SkiErg baseline form; saved modality-specific conditioning baselines remain supported/)
  assert.doesNotMatch(method, /It cannot prescribe|AI cannot supply its own numerical prescriptions|revisions affect next week only|version-[123]|<code>customExercises<\/code>/)
})

test('the landing page explains chat friction before introducing the setup workflow', () => {
  const home = marketingPages().find(page => page.path === '/')!.html
  const problem = home.match(/<section[^>]*id="why-this-exists"[^>]*>([^]*?)<\/section>/)?.[1]
  assert.ok(problem)
  assert.match(home, /href="#why-this-exists">Why this exists/)
  assert.match(problem, /id="why-heading"/)
  assert.match(problem, /buried in long threads/)
  assert.match(problem, /reviewed exercise cards and your current week together/)
  assert.match(problem, /goal, routine and equipment all over again/)
  assert.match(problem, /fresh brief to the same chat or a different AI/)
  assert.match(problem, /Update your equipment when it changes/)
  assert.match(problem, /Record sets, weights, partial sessions and skips/)
  assert.match(problem, /Unlogged work stays unknown/)
  const ownership = home.match(/<section class="ownership-section wrap">([^]*?)<\/section>/)?.[1]
  assert.ok(ownership)
  assert.match(ownership, /Remote AI still needs a connection/)
  assert.match(ownership, /Once the app confirms its offline copy is ready/)
  assert.match(ownership, /Training notes and health flags can be personal/)
  assert.match(ownership, /preview the setup or weekly-review brief before sharing/)
  assert.ok(home.indexOf(problem) < home.indexOf(ownership))
  assert.ok(home.indexOf(ownership) < home.indexOf('id="how-it-works"'))
  assert.match(home, /Nothing is imported from your chat automatically/)
  assert.match(home, /The app checks it\. You approve\./)
  assert.match(home, /Send the same brief directly to a compatible provider and review its reply/)
  for (const provider of ['https://chatgpt.com', 'https://claude.ai', 'https://duck.ai']) {
    assert.ok(home.includes(`href="${provider}"`))
  }
  assert.match(home, /Preview a setup or weekly-review brief\. Copy it into/)
  assert.match(home, /paste the final JSON reply here for review/)
  assert.match(home, /Provider accounts, free usage limits and privacy policies vary/)
  assert.doesNotMatch(home, /Download brief|upload (?:its|the|a) (?:JSON|reply)|download[^<]*brief/i)
})

test('exercise ownership and the actuals-to-next-week loop preserve previous work', () => {
  const pages = marketingPages()
  const home = pages.find(page => page.path === '/')!.html
  const method = pages.find(page => page.path === '/method/')!.html
  for (const heading of ['Description', 'Focus', 'Why it&rsquo;s here']) {
    assert.ok(home.includes(`<dt>${heading}</dt>`))
  }
  assert.match(home, /create a compatible custom exercise, manually or with optional AI/)
  assert.match(home, /Review technique and fit before approval/)
  assert.match(home, /Descriptions cannot bypass supported workload limits or app checks/)
  assert.match(home, /equipment-aware built-in library/)
  for (const heading of ['Logged training', 'Optional AI review', 'Approve next week']) {
    assert.ok(home.includes(`<h3>${heading}</h3>`))
  }
  assert.match(home, /Missing observations stay unknown/)
  assert.match(home, /partial, stopped-early, skipped and unlogged work distinct/)
  assert.match(method, /Easier\/as-expected\/harder feedback is separate from that numerical rating/)
  assert.match(method, /distance and average heart rate are optional/)
  assert.match(method, /Stopped-early outcomes/)
  assert.match(method, /midweek Swap can replace supported remaining lifting or mobility work/)
  assert.match(method, /preserving recorded sets and the original prescription history, without borrowing working weights/)
  assert.match(method, /defaults to this session; a future preference is recorded for later proposals, not automatically applied/)
  for (const html of [home, method]) {
    assert.match(html, /Start a new plan/)
    assert.match(html, /Settings/)
    assert.match(html, /routine is prefilled/)
    assert.match(html, /[Rr]econfirm your current (?:training )?baseline/)
    assert.match(html, /[Pp]revious logged work[^]*read-only history/)
  }
  assert.match(home, /Current-training answers and imported CSV history stay with the old plan, not the new setup/)
  assert.match(method, /Active current-training answers and imported CSV history are cleared from the new setup, but retained in the prior plan and its backup/)
})

test('Garmin CSV marketing promises local evidence review, not account integration or inferred training', () => {
  const pages = marketingPages()
  const home = pages.find(page => page.path === '/')!.html
  const method = pages.find(page => page.path === '/method/')!.html
  assert.match(home, /German or English Garmin activities CSV exports can be reviewed locally/)
  assert.match(home, /Choose metric or imperial source units, select records and explicitly save/)
  assert.match(home, /Titles and locations are discarded/)
  assert.match(home, /exact duplicates are counted and skipped, and conflicting records require review/)
  assert.match(home, /Recorded gaps remain unknown, not zero training/)
  assert.match(home, /Summaries do not infer a current baseline or complete plan sessions/)
  assert.match(home, /FIT and Apple Health imports are not implemented/)
  assert.match(home, /no Garmin account connection/)
  assert.match(method, /latest record is more than 42 days before the review date/)
  assert.match(method, /not inferred effort, readiness, lifting weights or a current baseline/)
  assert.doesNotMatch(home, /Not yet\. FIT|starting point is entered manually/)
})

test('privacy describes local ownership without claiming all data can never leave the device', () => {
  const pages = marketingPages()
  const home = pages.find(page => page.path === '/')!.html
  const privacy = pages.find(page => page.path === '/privacy/')!.html
  for (const html of [home, privacy]) {
    assert.match(html, /ordinary request metadata/)
    assert.match(html, /[Ll]ocal[^]*backup/)
    assert.match(html, /[Cc]learing[^]*browser|[Cc]learing site data/)
    assert.match(html, /[Rr]emote AI[^]*(?:connectivity|connection)/)
    assert.match(html, /offline copy is ready/)
    assert.doesNotMatch(html, /data never leaves|everything stays on your device|no (?:data|information) ever leaves/i)
  }
  assert.match(home, /Your plans, library and logs are saved in this browser/)
  assert.match(home, /host handles ordinary request metadata; AI providers have their own policies/)
  assert.match(privacy, /IndexedDB/)
  assert.match(privacy, /Local-first does not mean a website makes no network requests/)
  assert.match(privacy, /Browser storage does not promise encryption or permanent retention/)
  assert.match(privacy, /no account, application backend, automatic cloud backup/)
  assert.match(privacy, /weekly-review brief additionally includes this week/)
  assert.match(privacy, /sets, repetitions, seconds, weights, duration, effort, notes and recorded health flags/)
  assert.match(privacy, /Setup sharing does not include campaign session logs/)
  assert.match(privacy, /separate default-off choice includes confirmed normalized Garmin records and their summary/)
  assert.match(privacy, /activity type, local timestamp, timer duration, and optional distance, average heart rate, moving and elapsed time/)
  assert.match(privacy, /Activity titles, locations and raw files are excluded/)
  assert.match(privacy, /Prior-plan archives and API keys are not exported/)
  assert.match(privacy, /CSV files are read locally, not uploaded/)
  assert.match(privacy, /Activity titles, locations and raw CSV text are not retained/)
  assert.match(privacy, /copying alone contacts no provider/)
  assert.match(privacy, /Opening a provider link visits that provider but does not send the brief automatically/)
  assert.match(privacy, /Copy it into your own AI chat and paste the final reply back/)
  assert.doesNotMatch(privacy, /Copy or download|copying or downloading/)
  assert.match(privacy, /external provider or chat has its own terms and privacy policy/)
  assert.match(privacy, /Connection details and API keys stay in the open tab&rsquo;s memory/)
  assert.match(privacy, /Reloading or disconnecting clears it/)
  assert.match(privacy, /does not upload that history or create a remote backup/)
  assert.doesNotMatch(privacy, /excludes activity files, training logs and API keys|no logs (?:are|ever) sent/i)
})

test('public navigation uses consistent labels without duplicate section CTAs', () => {
  const pages = marketingPages()
  for (const page of [...pages, { path: '/404', html: notFoundPage() }]) {
    for (const match of page.html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^]*?)<\/a>/g)) {
      const target = new URL(match[1]!, siteOrigin + page.path)
      if (target.origin !== siteOrigin || target.hash) continue
      const label = match[2]!.replace(/<[^>]*>/g, '').replaceAll('&rarr;', '').trim()
      if (target.pathname === '/app/') assert.equal(label, 'Open planner')
      if (target.pathname === '/learn/') assert.equal(label, 'Guides')
    }
    for (const match of page.html.matchAll(/<a class="guide-card\b[^]*?<\/a>/g)) {
      assert.doesNotMatch(match[0], /Read the guide|class="text-link"/)
      assert.equal(match[0].match(/&rarr;/g)?.length, 1)
    }
  }
  const home = pages.find(page => page.path === '/')!.html
  assert.equal(home.match(/href="\.\/app\/"/g)?.length, 3)
  assert.doesNotMatch(home.match(/<section class="how-section"[^]*?<\/section>/)![0], /href="\.\/app\/"/)
  for (const page of pages.filter(page => page.path.startsWith('/learn/') && page.path !== '/learn/')) {
    assert.equal(page.html.match(/href="\.\.\/\.\.\/app\/"/g)?.length, 2)
    const sidebar = page.html.match(/<aside class="article-sidebar">([^]*?)<\/aside>/)![1]!
    assert.match(sidebar, /aria-label="On this page"/)
    assert.doesNotMatch(sidebar, /app\//)
  }
})

test('shorter homepage copy retains every section and the existing FAQ choices', () => {
  const home = marketingPages().find(page => page.path === '/')!.html
  assert.equal(home.match(/<details><summary>/g)?.length, 8)
  for (const section of ['hero wrap', 'ownership-section wrap', 'how-section', 'goal-section', 'harness-section', 'continuity-section', 'faq-section', 'learn-section', 'end-cta wrap']) {
    assert.ok(home.includes(section), `Missing homepage section: ${section}`)
  }
  const visibleMain = home.match(/<main\b[^>]*>([^]*?)<\/main>/)![1]!
    .replace(/<details><summary>([^]*?)<\/summary>[^]*?<\/details>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:[a-z]+|#\d+);/g, ' ')
  const words = visibleMain.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length
  assert.ok(words <= 1100, `Homepage copy has grown to ${words} visible main-content words`)
})

test('all public pages reflect advisory full-week AI proposals and local Garmin CSV support', () => {
  const pages = marketingPages()
  for (const page of pages) {
    assert.doesNotMatch(page.html, /(?:It|AI) never sets (?:loads|repetitions|durations|scheduling)|(?:Activity-file and )?Garmin imports are not implemented|AI cannot (?:prescribe|supply its own numerical prescriptions)/)
    assert.doesNotMatch(page.html, /upward progression beyond the confirmed baseline is not supported|AI cannot authorize upward progression|AI replies and exercise approvals cannot bypass health holds/)
  }
  const planningGuide = pages.find(page => page.path === '/learn/hybrid-training-plan/')!.html
  assert.match(planningGuide, /Optional AI can propose a complete week/)
  assert.match(planningGuide, /app surfaces training concerns as advice and checks data, equipment and recorded-work integrity/)
  assert.match(planningGuide, /Initial weights are not guessed/)
  assert.match(planningGuide, /built-in route remains conservative/)
  assert.match(planningGuide, /Neither route measures readiness, guarantees results or replaces individual coaching/)
  const busyGuide = pages.find(page => page.path === '/learn/hybrid-training-busy-schedule/')!.html
  assert.match(busyGuide, /review Garmin activity-summary CSV exports locally/)
  assert.match(busyGuide, /do not confirm your current training or mark planned sessions complete/)
  assert.match(busyGuide, /FIT and Apple Health imports are not supported/)
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
