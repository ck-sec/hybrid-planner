import { marketingGuides } from './marketing-content.ts'
import type { MarketingGuide } from './marketing-content.ts'

export const siteOrigin = 'https://hybridcoach.ai'
export const sourceUrl = 'https://github.com/ck-sec/hybrid-planner'
const publishedDate = '2026-09-05'
const arrow = '<span aria-hidden="true">&rarr;</span>'

export interface MarketingPage {
  path: string
  title: string
  description: string
  html: string
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

function linkRoot(path: string): string {
  return '../'.repeat(path.split('/').filter(Boolean).length) || './'
}

function brand(root: string): string {
  return `<a class="brand" href="${root}" aria-label="Hybrid Coach home">
    <img src="${root}favicon.svg" width="38" height="38" alt="">
    <span>Hybrid<span class="brand-small">COACH</span></span>
  </a>`
}

function navigation(root: string, path: string): string {
  const links = [
    ['#how-it-works', 'How it works', '/'],
    ['learn/', 'Guides', '/learn/'],
    ['method/', 'Our approach', '/method/'],
  ].map(([href, label, section]) => `<a href="${root}${href}"${section !== '/' && path.startsWith(section!) ? ' aria-current="page"' : ''}>${label}</a>`).join('')
  return `<a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header wrap">
      ${brand(root)}
      <nav class="desktop-nav" aria-label="Main navigation">${links}</nav>
      <a class="button button-small header-cta" href="${root}app/">Open planner ${arrow}</a>
      <details class="mobile-menu"><summary aria-label="Navigation menu"><span></span><span></span></summary>
        <nav aria-label="Mobile navigation">${links}</nav>
      </details>
    </header>`
}

function footer(root: string): string {
  return `<footer class="site-footer wrap">
    <div>${brand(root)}<p>Your data. Your workouts. Your terms.</p></div>
    <nav aria-label="Footer navigation">
      <a href="${root}learn/">Guides</a><a href="${root}method/">Our approach</a>
      <a href="${root}privacy/">Privacy &amp; your data</a><a href="${sourceUrl}">GitHub ${arrow}</a>
    </nav>
    <p class="footer-note">Free and open source under MIT. No accounts. No subscriptions. No telemetry.<br>
      Training guidance is educational, not individual coaching or medical advice.</p>
  </footer>`
}

function layout(path: string, title: string, description: string, body: string, options: {
  article?: MarketingGuide
  noindex?: boolean
  root?: string
} = {}): string {
  const root = options.root ?? linkRoot(path)
  const url = siteOrigin + path
  const graph: Record<string, unknown>[] = [
    { '@type': 'Organization', '@id': `${siteOrigin}/#project`, name: 'Hybrid Coach', url: `${siteOrigin}/`, sameAs: [sourceUrl] },
    { '@type': 'WebSite', '@id': `${siteOrigin}/#website`, name: 'Hybrid Coach', url: `${siteOrigin}/`, publisher: { '@id': `${siteOrigin}/#project` } },
    {
      '@type': options.article ? 'Article' : 'WebPage',
      '@id': url, url, ...(options.article ? { headline: options.article.title } : { name: title }),
      description, inLanguage: 'en',
      isPartOf: { '@id': `${siteOrigin}/#website` },
      ...(options.article ? {
        author: { '@id': `${siteOrigin}/#project` }, publisher: { '@id': `${siteOrigin}/#project` },
        datePublished: publishedDate, dateModified: publishedDate,
        mainEntityOfPage: url, citation: options.article.sources.map(source => source.url),
      } : {}),
    },
  ]
  if (path === '/') graph.push({
    '@type': 'WebApplication', name: 'Hybrid Coach', url: `${siteOrigin}/app/`,
    applicationCategory: 'HealthApplication', operatingSystem: 'Web browser',
    isAccessibleForFree: true, license: `${sourceUrl}/blob/main/LICENSE`,
    description: 'A free, MIT-licensed, local-first training planner for running, lifting and your other sports in one week. Plan and log offline after the first successful load. Optional AI sharing is user-controlled; external providers may charge.',
  })
  if (options.article) graph.push({
    '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteOrigin}/` },
      { '@type': 'ListItem', position: 2, name: 'Guides', item: `${siteOrigin}/learn/` },
      { '@type': 'ListItem', position: 3, name: options.article.title, item: url },
    ],
  })
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="theme-color" content="#ECDFD2">
${options.noindex ? '<meta name="robots" content="noindex, follow">' : `<link rel="canonical" href="${url}">`}
<meta property="og:type" content="${options.article ? 'article' : 'website'}">
<meta property="og:site_name" content="Hybrid Coach"><meta property="og:locale" content="en_US">
<meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${url}"><meta property="og:image" content="${siteOrigin}/social-card.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Hybrid Coach. Running and lifting. One plan that fits. Room for your other sports.">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${siteOrigin}/social-card.png">
<meta name="twitter:image:alt" content="Hybrid Coach. Running and lifting. One plan that fits. Room for your other sports.">
${options.article ? `<meta property="article:published_time" content="${publishedDate}"><meta property="article:modified_time" content="${publishedDate}">` : ''}
<link rel="icon" type="image/svg+xml" href="${root}favicon.svg">
<link rel="stylesheet" href="${root}marketing.css">
${options.noindex ? '' : `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replaceAll('<', '\\u003c')}</script>`}
${path === '/' ? `<script src="${root}site.js" defer></script>` : ''}
</head><body>${navigation(root, path)}<main id="main" tabindex="-1">${body}</main>${footer(root)}</body></html>`
}

function guideCards(root: string, guides: readonly MarketingGuide[] = marketingGuides): string {
  return guides.map((guide, index) => `<a class="guide-card guide-${index % 3}" href="${root}learn/${escapeHtml(guide.slug)}/">
    <div class="guide-art" aria-hidden="true"><span class="orbit"></span><span class="orbit orbit-two"></span><span class="guide-number">0${index + 1}</span>${arrow}</div>
    <div class="guide-card-body"><span class="eyebrow">${escapeHtml(guide.category)}</span>
      <h3>${escapeHtml(guide.title)}</h3><p>${escapeHtml(guide.description)}</p>
    </div></a>`).join('')
}

function cta(root: string): string {
  return `<section class="end-cta wrap"><div><p class="eyebrow">Your training. Your terms.</p><h2>A plan you own.</h2><p>Your routine. Your records. AI only if you choose.</p></div>
    <div><a class="button button-cream" href="${root}app/">Open planner ${arrow}</a><p class="fine-print">Free. No login, subscription or API key needed.</p></div>
  </section>`
}

function home(): string {
  const sampleDays = [
    ['M', 'run'], ['T', 'lift'], ['W', 'sport'], ['T', 'run'],
    ['F', 'rest'], ['S', 'lift'], ['S', 'rest'],
  ]
  return `<section class="hero wrap">
    <div class="hero-copy"><p class="eyebrow"><span class="short-line"></span> Local-first. Open source. Free.</p>
      <h1>Running<br>and lifting.<br><span class="serif">One plan that fits.</span></h1>
      <p class="hero-description">And room for the other sports you love. Plan runs, lifts and practices together, around your equipment, commitments and recovery.</p>
      <div class="hero-actions"><a class="button" href="./app/">Open planner ${arrow}</a><a class="text-link" href="#why-this-exists">Why this exists ${arrow}</a></div>
      <p class="hero-promise">No account. No subscription. No telemetry.<br>Plan and log offline after your first successful load.</p>
    </div>
    <figure class="week-figure">
      <div class="week-decoration" aria-hidden="true"></div>
      <div class="week-board"><div class="board-heading"><div><span class="eyebrow">Your training space</span><h2>One week. Your way.</h2></div><span class="local-tag">Local</span></div>
        <div class="calendar-preview" aria-hidden="true">${sampleDays.map(([day, type]) => `<div class="calendar-day ${type}"><span>${day}</span><i></i><i></i></div>`).join('')}</div>
        <ul class="sample-week">
          <li class="sample-day run"><span class="day-dot" aria-hidden="true"></span><span><strong>Easy run</strong><small>Start from your comfortable routine</small></span></li>
          <li class="sample-day lift"><span class="day-dot" aria-hidden="true"></span><span><strong>Strength</strong><small>Your exercises. Your equipment.</small></span></li>
          <li class="sample-day sport"><span class="day-dot" aria-hidden="true"></span><span><strong>Your other sport</strong><small>Practice belongs in the same week</small></span></li>
          <li class="sample-day rest"><span class="day-dot" aria-hidden="true"></span><span><strong>Room to recover</strong><small>Space for life, not catch-up work</small></span></li>
        </ul>
        <div class="library-preview"><span class="eyebrow">From your exercise library</span><strong>My dumbbell row</strong><p>Your description &middot; Your focus &middot; Your why</p><span class="equipment-tag">Dumbbells + bench</span></div>
        <div class="board-bottom"><span class="status-dot" aria-hidden="true"></span> Plans + library + logs, saved in this browser.</div>
      </div>
      <figcaption>Illustrative workspace, not a personal prescription.</figcaption>
    </figure>
  </section>
  <div class="principle-strip"><div class="wrap"><span>Works without AI</span><span>No training-data server</span><span>Your backups, your choice</span><span>Open source. MIT.</span></div></div>
  <section class="section wrap" id="why-this-exists" aria-labelledby="why-heading">
    <div class="section-heading"><p class="eyebrow">Good conversations. Scattered training.</p><h2 id="why-heading">A chat can help you think.<br>It isn&rsquo;t your training record.</h2><p>Exercise decisions get buried in long threads. A new chat needs your goal, routine and equipment all over again.</p></div>
    <div class="benefit-grid">
      <article><span class="feature-mark" aria-hidden="true">01 /</span><h3>Find the workout, not the thread.</h3><p>Keep reviewed exercise cards and your current week together, away from chat drafts.</p></article>
      <article><span class="feature-mark" aria-hidden="true">02 /</span><h3>Your gym. The right context.</h3><p>Update your equipment when it changes. Bring a fresh brief to the same chat or a different AI.</p></article>
      <article><span class="feature-mark" aria-hidden="true">03 /</span><h3>Suggested isn&rsquo;t completed.</h3><p>Record sets, weights, partial sessions and skips. Unlogged work stays unknown.</p></article>
    </div>
  </section>
  <section class="ownership-section wrap">
    <div><p class="eyebrow">At the gym, not in the chat</p><h2>No signal.<br><span class="serif">Still your session.</span></h2><p>Once the app confirms its offline copy is ready, open your week, read exercise cards and log training offline in the same browser.</p><p class="fine-print">Remote AI still needs a connection.</p></div>
    <div><p class="eyebrow">Local by default. Shared by choice.</p><h2>Useful context.<br><span class="serif">Not your whole diary.</span></h2><p>Your plans, library and logs are saved in this browser. Training notes and health flags can be personal: preview the setup or weekly-review brief before sharing.</p><p class="fine-print">The host handles ordinary request metadata; AI providers have their own policies. Browser data can be cleared or lost, so keep local backups.</p><a class="text-link" href="./privacy/">Privacy &amp; your data ${arrow}</a></div>
  </section>
  <section class="how-section" id="how-it-works"><div class="wrap how-grid">
    <div class="how-title"><p class="eyebrow">Three steps. One starting point.</p><h2>Tell it once.<br><span class="serif">Build from there.</span></h2><p>Collect your goal, desired routine and fixed sessions before any optional AI conversation.</p></div>
    <ol class="steps">
      <li><span aria-hidden="true">01</span><div><h3>Goal</h3><p>Describe your goal. Add an event date, or use a 12-week progress review.</p></div></li>
      <li><span aria-hidden="true">02</span><div><h3>Routine</h3><p>Choose running, lifting, equipment and space. Add practices for your other sports as fixed sessions with days, start time and duration before AI.</p></div></li>
      <li><span aria-hidden="true">03</span><div><h3>Review</h3><p>Confirm current training separately from your desired routine, through chat or the local assessment. Review a built-in or AI-proposed week; approve it after app checks.</p></div></li>
    </ol>
  </div></section>
  <section class="section wrap goal-section">
    <div class="exercise-card"><p class="eyebrow">An exercise card, made yours</p><h3>My dumbbell row</h3><span class="equipment-tag">Dumbbells + bench</span><dl><dt>Description</dt><dd>Your own setup, technique notes, and reminders.</dd><dt>Focus</dt><dd>Upper-body pulling.</dd><dt>Why it&rsquo;s here</dt><dd>Familiar strength work that fits my equipment and routine.</dd></dl><p class="fine-print">Illustrative custom card. Review the movement before using it.</p></div>
    <div class="goal-copy"><p class="eyebrow">A library, not a fixed menu</p><h2>Your exercises.<br><span class="serif">In your words.</span></h2><p>Choose from the equipment-aware built-in library or create a compatible custom exercise, manually or with optional AI. Edit its description, focus, purpose and equipment. Review technique and fit before approval.</p><p class="fine-print">Descriptions cannot bypass supported workload limits or app checks.</p></div>
  </section>
  <section class="section harness-section wrap">
    <div class="section-heading"><p class="eyebrow">Optional AI</p><h2>Keep the conversation.<br><span class="serif">Bring fresh context.</span></h2><p>Continue your chat, or switch providers, with a fresh brief from your training record.</p></div>
    <div class="harness-grid"><div class="harness-option"><h3>Copy, discuss, review</h3><p>Preview a setup or weekly-review brief. Copy it into <a href="https://chatgpt.com">ChatGPT</a>, <a href="https://claude.ai">Claude</a> or <a href="https://duck.ai">Duck.ai</a>, discuss it, then paste the final JSON reply here for review. Nothing is imported from your chat automatically.</p></div><div class="harness-option"><h3>Or connect your own API key</h3><p>Send the same brief directly to a compatible provider and review its reply. Connection details and API keys stay in the open tab&rsquo;s memory, not saved training or backups.</p></div></div>
    <div class="engine-boundary"><strong>AI can propose a week. The app checks it. You approve.</strong><p>You and your AI choose training frequency, rest and progression. The app flags training concerns and checks data, equipment and recorded-work integrity. Passing checks is not medical clearance or a guarantee against injury.</p></div>
    <p class="fine-print">Nothing is sent automatically. Provider accounts, free usage limits and privacy policies vary; remote AI needs connectivity and may cost money. <a href="./privacy/">See exactly what you share</a>.</p>
  </section>
  <section class="section wrap continuity-section">
    <div class="section-heading"><p class="eyebrow">A plan that keeps its history</p><h2>Next week starts<br>with what happened.</h2><p>Record sets, reps, weights, duration and effort. Keep partial, stopped-early, skipped and unlogged work distinct.</p></div>
    <ol class="review-loop"><li><span class="eyebrow">01 / Your record</span><h3>Logged training</h3><p>Review recorded work and changes. Missing observations stay unknown.</p></li><li><span class="eyebrow">02 / Your choice</span><h3>Optional AI review</h3><p>Review locally or share this week&rsquo;s brief for help.</p></li><li><span class="eyebrow">03 / Your next step</span><h3>Approve next week</h3><p>The app checks next week against confirmed baseline and retained history; you approve.</p></li></ol>
    <div class="history-note"><h3>A new goal doesn&rsquo;t erase the old work.</h3><p>Choose <strong>Start a new plan</strong> in Settings. Your routine is prefilled; reconfirm your current baseline. Previous logged work stays as read-only history. Current-training answers and imported CSV history stay with the old plan, not the new setup.</p></div>
  </section>
  <section class="section wrap faq-section"><div><p class="eyebrow">Good questions</p><h2>Clear choices.<br>Honest limits.</h2><p>An early, open project. Here&rsquo;s what to know before you start.</p></div><div class="faq-list">
    ${[
      ['Is Hybrid Coach really free?', 'The planner is free and MIT licensed. There is no trial, subscription, or account. Optional third-party AI services are separate and may charge for API use.'],
      ['Can my other sports fit into the plan?', 'Yes. Add your usual practices or activities as fixed sessions alongside running and lifting, with their days, start time and duration. Keep them in the same week rather than juggling separate schedules. This organises your training around those sessions; it does not generate a complete sport-specific coaching programme for every activity.'],
      ['Do I need AI to use it?', 'No. Built-in planning, manual custom exercises, logging, and weekly review work without AI or an API key. The built-in route stays conservative. Optional AI can propose a complete week; training concerns are advice, not automatic vetoes. You review and approve it. Data and equipment checks still apply.'],
      ['What would I share with AI?', 'Only the brief you explicitly choose to share. A setup brief contains your goal, desired routine, confirmed current-training facts when available, equipment, and planning context, not campaign session logs. A weekly-review brief also includes that week&rsquo;s actual logs, feedback, notes, and recorded health flags. A separate default-off choice includes confirmed normalized Garmin records and their summary. Raw activity files, activity titles and locations, prior-plan archives and API keys are not included. Preview the brief before sharing; your provider&rsquo;s policies apply.'],
      ['Can I use it offline?', 'Yes, after your first successful load and once the app confirms its offline copy is ready. Reopen /app/ in the same browser to plan and log offline. Remote AI still needs connectivity. The API connection is memory-only and clears when you reload or disconnect.'],
      ['Can I keep a backup or start a new plan?', 'Export a local JSON backup from Settings and keep it somewhere you trust. There is no automatic cloud backup or sync. Start a new plan keeps previous logged work as read-only history and prefills your routine for review. You must reconfirm the baseline for the new plan. Clearing browser data can delete local records, including that history.'],
      ['Can I import Garmin or Apple Health activities?', 'German or English Garmin activities CSV exports can be reviewed locally. Choose metric or imperial source units, select records and explicitly save their history. Titles and locations are discarded; exact duplicates are counted and skipped, and conflicting records require review. Recorded gaps remain unknown, not zero training. Summaries do not infer a current baseline or complete plan sessions. FIT and Apple Health imports are not implemented, and there is no Garmin account connection.'],
      ['Is this a personal coach or a beginner lifting course?', 'No. It does not teach lifting technique, diagnose pain, measure readiness, or promise a race peak. The built-in planner supports an established routine. AI training choices are yours to review; scheduling estimates and app checks cannot guarantee injury prevention.'],
    ].map(([question, answer]) => `<details><summary>${question}</summary><p>${answer}</p></details>`).join('')}
  </div></section>
  <section class="section learn-section wrap">
    <div class="section-heading heading-row"><div><p class="eyebrow">Understand the work</p><h2>Useful guides. Open evidence.</h2></div><a class="text-link" href="./learn/">Guides ${arrow}</a></div>
    <div class="guide-grid">${guideCards('./')}</div>
  </section>${cta('./')}`
}

function learningHub(): string {
  return `<section class="page-intro wrap"><p class="eyebrow">The Hybrid Coach field notes</p><h1>Run. Lift.<br><span class="serif">Understand the overlap.</span></h1><p>Practical guides to combining running and strength training. Clear explanations, useful examples, and sources you can check yourself.</p></section>
    <section class="wrap hub-guides" aria-label="Training guides"><div class="guide-grid">${guideCards('../')}</div></section>
    <section class="editorial-note wrap"><h2>Useful guidance, honest limits.</h2><p>These guides are written by the Hybrid Coach project, not presented as clinical or individually coached advice. Research informs the discussion; where a practical suggestion is an estimate or an example, we say so. Sources are linked in each guide.</p><a class="text-link" href="../method/">Our approach to evidence ${arrow}</a></section>${cta('../')}`
}

function articleBody(guide: MarketingGuide): string {
  const root = '../../'
  const paragraphs = (items: string[]) => items.map(text => `<p>${escapeHtml(text)}</p>`).join('')
  const words = [guide.title, ...guide.intro, ...guide.sections.flatMap(section => [section.heading, ...section.paragraphs, ...(section.bullets ?? [])])].join(' ').split(/\s+/).length
  return `<article class="article wrap">
    <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="${root}">Home</a><span aria-hidden="true">/</span><a href="../">Guides</a><span aria-hidden="true">/</span><span>${escapeHtml(guide.category)}</span></nav>
    <header class="article-header"><p class="eyebrow">${escapeHtml(guide.category)}</p><h1>${escapeHtml(guide.title)}</h1>
      <p class="article-meta">By <a href="${root}method/">Hybrid Coach</a> <span aria-hidden="true">&middot;</span> <time datetime="${publishedDate}">5 September 2026</time> <span aria-hidden="true">&middot;</span> ${Math.max(1, Math.ceil(words / 200))} min read</p>
      <div class="article-lead">${paragraphs(guide.intro)}</div>
    </header>
    <div class="article-layout"><aside class="article-sidebar"><nav aria-label="On this page"><h2>In this guide</h2><ol>${guide.sections.map((section, i) => `<li><a href="#section-${i + 1}">${escapeHtml(section.heading)}</a></li>`).join('')}<li><a href="#sources">Sources &amp; further reading</a></li></ol></nav></aside>
      <div class="prose">${guide.sections.map((section, i) => `<section id="section-${i + 1}"><h2>${escapeHtml(section.heading)}</h2>${paragraphs(section.paragraphs)}${section.bullets ? `<ul>${section.bullets.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}</section>`).join('')}
      <section class="sources" id="sources"><p class="eyebrow">Read the evidence</p><h2>Sources &amp; further reading</h2><ul>${guide.sources.map(source => `<li><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a></li>`).join('')}</ul><p class="fine-print">General education, not an individual prescription or medical advice. Research findings do not make this app&rsquo;s scheduling estimates validated physiological measurements.</p></section>
      <div class="article-next"><h2>Put your own week in view.</h2><p>Bring your runs, lifts, and fixed commitments into the free planner. No account needed.</p><a class="button" href="${root}app/">Open planner ${arrow}</a></div></div>
    </div>
  </article><section class="section wrap"><p class="eyebrow">Keep exploring</p><h2 class="related-heading">More field notes.</h2><div class="guide-grid related-grid">${guideCards(root, marketingGuides.filter(item => item.slug !== guide.slug))}</div></section>`
}

function method(): string {
  return `<section class="page-intro wrap"><p class="eyebrow">The thinking, in the open</p><h1>A planner you<br>can <span class="serif">look inside.</span></h1><p>An open-source planner for people who run and lift, with programming logic you can inspect.</p></section>
    <div class="document-layout wrap"><aside><p class="eyebrow">Our approach</p><a class="text-link" href="${sourceUrl}">Read the source ${arrow}</a><a class="text-link" href="../learn/">Guides ${arrow}</a></aside><div class="prose">
      <section><h2>One week at a time, with a reason.</h2><p>The built-in engine compares weekly arrangements from your confirmed current training, goals, availability, equipment and commitments, and explains session placement. AI-proposed weeks are independently checked. The same inputs produce the same result.</p><p>A block gives the broad shape; sessions are built one week at a time. Desired training is not a baseline. Frequency and average-duration sliders show the weekly time you want; a long run can exceed that average. Confirm current training separately. Imported records cannot fill those answers automatically.</p></section>
      <section><h2>Scheduling estimates, not a readiness score.</h2><p>The engine compares two estimated scheduling costs, systemic and structural, to represent different running and lifting demands. These are not measurements of your body, performance predictions or injury-risk calculations.</p><p>Recovery assumptions and coefficients are inspectable estimates. There is no acute-to-chronic workload ratio, readiness gauge or learned physiological fatigue model.</p><p><a href="${sourceUrl}/tree/main/engine">Inspect the engine and its constants</a>.</p></section>
      <section><h2>Your training choice. Reliable records.</h2><p>For new AI weeks, frequency, volume, rest and recovery checks are advice, not automatic vetoes. Two-a-days and weeks without a full rest day are supported. Pain and health reports remain visible; passing data checks is not medical clearance.</p><p>Malformed data, unavailable equipment and changes to recorded work remain blocked. Fixed commitments cannot be rewritten to improve a score. The built-in planner and older saved weeks retain their original training policies.</p></section>
      <section><h2>Custom exercises, reliable identities.</h2><p>Choose library exercises or create custom cards manually or with optional AI. Cards describe the movement, focus, purpose and equipment. Supported strength, mobility and controlled target throwing use immutable identities and app-owned profiles. The built-in pool uses four to seven exercises; a complete authored week may use up to 32 distinct exercise and drill identities. That maximum is not a recommended dose.</p><p>Review technique and fit before approval; app checks are not technique validation or medical clearance. Changed custom techniques need new identities; historical prescriptions and weight records stay intact. A midweek Swap can replace supported remaining lifting or mobility work, preserving recorded sets and the original prescription history, without borrowing working weights. It defaults to this session; a future preference is recorded for later proposals, not automatically applied.</p><p>Reference notes cannot add scheduled work. Renaming unsupported work cannot bypass checks. Current setup has no separate rower/SkiErg baseline form; saved modality-specific conditioning baselines remain supported and require matching equipment.</p></section>
      <section><h2>AI can propose a week. The app checks it.</h2><p>Setup is Goal, Routine, then Review. Enter desired training, equipment and fixed-session days, start time and duration before AI. Assess and confirm current training separately. At setup or weekly review, copy the previewed brief into your chat, discuss it, then paste the final JSON reply for review, or send it through a compatible API.</p><p>AI can propose complete weeks with supported sets, repetitions, seconds, effort targets, duration and placement. You and your AI choose progression, with training concerns surfaced for review rather than silently reducing the week. AI cannot redefine scheduling costs, exercise profiles, approvals or initial weights, or rewrite existing observations and performed work. Technical format bounds and equipment checks still apply. You approve each proposal.</p><p>There is no bundled model or hidden AI service. Connection details and API keys stay in the open tab&rsquo;s memory, never in training backups, and clear on reload or disconnect. Built-in planning, manual custom exercises and weekly review are complete without AI.</p></section>
      <section><h2>Review actual work, not assumed completion.</h2><p>Weekly review separates recorded sets, repetitions, seconds, weights, duration and numerical effort from prescriptions. Easier/as-expected/harder feedback is separate from that numerical rating; distance and average heart rate are optional. Stopped-early outcomes, partial work, time skips, fatigue skips, removals, omissions and unlogged sessions stay distinct. Missing observations remain unknown, not completed or zero work.</p><p>Optional AI review shares that week&rsquo;s feedback, changes, notes and recorded health flags. Preview the brief first. Confirmed normalized Garmin records need a separate default-off sharing choice; raw files and prior-plan archives are excluded. AI can explain logged training and propose next week; checks use retained history. Notes and flags are reports, not diagnoses.</p></section>
      <section><h2>A fresh plan, without erasing the work.</h2><p>Choose Start a new plan in Settings. Your routine is prefilled for review; reconfirm your current training baseline before building.</p><p>Previous logged work remains read-only history. Active current-training answers and imported CSV history are cleared from the new setup, but retained in the prior plan and its backup. Old workouts, weights and exercise definitions stay unchanged. Export a local backup; history is not a cloud backup.</p></section>
      <section><h2>Built for real interruptions.</h2><p>Time skips do not imply fatigue. Fatigue skips inform the next review; the built-in route reduces optional work. Deletion records a change, not fatigue. AI replies and exercise approvals cannot erase health reports or performed work.</p><p>No streaks or badges: logs record what happened, not what you owe the plan.</p></section>
      <section><h2>What this release does not do.</h2><p>This early supporting planner is not complete event coaching. Running stays easy; free-text goals do not produce threshold paces or intervals.</p><p>Local Garmin CSV import provides selected records and recorded-period summaries, not inferred effort, readiness, lifting weights or a current baseline. Gaps remain unknown; a summary warns when its latest record is more than 42 days before the review date. Garmin FIT and Apple Health imports are not implemented. There is no account connection, automatic cross-device sync, or technique assessment. Starting weights are not guessed from another exercise.</p></section>
      <section><h2>Evidence and accountability.</h2><p>Guides distinguish research findings from practical examples. Editorial responsibility sits with the Hybrid Coach project, which claims no clinical review, professional coaching certification or scientific validation of its engine.</p><p>Inspect the code, discuss rules or report factual errors in <a href="${sourceUrl}/issues">public GitHub issues</a>. Do not post private training records, health details or API keys. The code is available under the <a href="${sourceUrl}/blob/main/LICENSE">MIT license</a>.</p></section>
    </div></div>${cta('../')}`
}

function privacy(): string {
  return `<section class="page-intro wrap"><p class="eyebrow">Local first, in plain language</p><h1>Your data.<br><span class="serif">Your choice to share.</span></h1><p>What stays in your browser, what the host sees, and what you choose to share.</p></section>
    <div class="document-layout wrap"><aside><p class="eyebrow">Privacy &amp; your data</p><p class="fine-print">Updated 7 September 2026</p></aside><div class="prose">
      <section><h2>Your training records are saved in this browser.</h2><p>Setup, custom definitions, plans, logs, feedback and selected normalized Garmin CSV records are stored in IndexedDB in this browser. CSV files are read locally, not uploaded. Activity titles, locations and raw CSV text are not retained. Visiting /app/ on the same HTTPS domain does not upload records; brief sharing is a separate, explicit action.</p><p>There is no account, application backend, automatic cloud backup, advertising profile or training-data sync. Anyone with access to your browser profile may access records. Browser storage does not promise encryption or permanent retention.</p></section>
      <section><h2>Backups are your choice, and your responsibility.</h2><p>Export a local JSON backup from Settings. Import it in another browser or device to transfer records. Backups can contain personal training information; store them somewhere you trust.</p><p>Start a new plan keeps previous logged work as read-only history. It does not upload that history or create a remote backup. Clearing site data, private browsing or storage eviction can remove records, including previous plans.</p><p>Localhost, pages.dev previews and this domain have separate storage with no automatic exchange.</p></section>
      <section><h2>No telemetry, analytics or error-reporting scripts.</h2><p>No analytics beacons, advertising trackers, session recording, browser error reporting or tracking cookies. Fonts, graphics and app assets are served with the site, not third-party services.</p><p>Cloudflare serves and protects the static site, handling IP addresses and ordinary request metadata. Local-first does not mean a website makes no network requests. See <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare&rsquo;s privacy policy</a>.</p></section>
      <section><h2>AI is a separate, explicit connection.</h2><p>AI is optional at the final setup review and weekly review. Visiting, entering Goal or Routine, or opening a panel sends nothing to AI. Preview the same brief for chat or API. Copy it into your own AI chat and paste the final reply back, or explicitly send it to a compatible endpoint. API requests go directly from your browser, without a Hybrid Coach proxy; copying alone contacts no provider. Opening a provider link visits that provider but does not send the brief automatically.</p><p>A setup brief includes your goal and date, desired routine, confirmed current-training facts when available, equipment and space, availability and fixed sessions, exercise selection, custom definitions, eligible catalog and profiles, reference cards and relevant planned sessions. Setup sharing does not include campaign session logs.</p><p><strong>A weekly-review brief additionally includes this week&rsquo;s actual training records:</strong> sets, repetitions, seconds, weights, duration, effort, notes and recorded health flags, plus easier/as-expected/harder feedback, optional distance and average heart rate, stopped-early outcomes and recorded changes. Partial work, skip reasons, removals, omissions and unlogged sessions stay distinct. Missing records remain unknown, not assumed completion. These records may be sensitive; preview them before sharing.</p><p>A separate default-off choice includes confirmed normalized Garmin records and their summary: activity type, local timestamp, timer duration, and optional distance, average heart rate, moving and elapsed time. Activity titles, locations and raw files are excluded. Prior-plan archives and API keys are not exported. The external provider or chat has its own terms and privacy policy. A local endpoint must permit browser connections too.</p><p>Connection details and API keys stay in the open tab&rsquo;s memory and are excluded from saved training data, briefs and backups. A supplied key is sent only as the authorization header to the endpoint you choose. Reloading or disconnecting clears it. Optional API use may cost money; built-in planning, manual custom exercises and weekly review need no AI.</p></section>
      <section><h2>Offline, after the first successful load.</h2><p>The app&rsquo;s service worker saves static files after a successful online load and installation. Once the app confirms its offline copy is ready, reopen the planner in the same browser to use local records offline. Remote AI requires connectivity; its requests are not cached.</p></section>
      <section><h2>Questions or corrections.</h2><p>The source and public issue tracker are on <a href="${sourceUrl}">GitHub</a>. Do not post private records or API keys in a public issue. This site has no contact form, mailing-list signup, or data-collection endpoint.</p></section>
    </div></div>`
}

export function marketingPages(): MarketingPage[] {
  const pages = [
    { path: '/', title: 'Free Hybrid Training Planner for Running & Lifting | Hybrid Coach', description: 'Running, lifting and your other sports in one plan. Free, open-source and local-first, with offline planning, optional AI and training records you own.', body: home() },
    { path: '/learn/', title: 'Hybrid Training Guides: Running, Lifting & Real Life | Hybrid Coach', description: 'Learn how to combine running and strength training, arrange same-day sessions, and adapt busy weeks. Practical guides with sources and honest limits.', body: learningHub() },
    { path: '/method/', title: 'How the Hybrid Coach Training Engine Works', description: 'A local planning engine, your exercise library, and optional AI. See who sets the work, what you approve, and how training history is kept.', body: method() },
    { path: '/privacy/', title: 'Privacy & Your Local Training Data | Hybrid Coach', description: 'Local browser storage, offline planning, and backups you control. What the static host sees and what you choose to share with AI. No accounts or telemetry.', body: privacy() },
  ]
  return [
    ...pages.map(page => ({ ...page, html: layout(page.path, page.title, page.description, page.body) })),
    ...marketingGuides.map(guide => {
      const path = `/learn/${guide.slug}/`
      const title = `${guide.title} | Hybrid Coach`
      return { path, title, description: guide.description, html: layout(path, title, guide.description, articleBody(guide), { article: guide }) }
    }),
  ]
}

export function notFoundPage(root = '/'): string {
  return layout('/404', 'Page not found | Hybrid Coach', 'This page could not be found.', `<section class="page-intro wrap not-found"><p class="eyebrow">404 / A different kind of rest day</p><h1>This page<br>is <span class="serif">off the plan.</span></h1><p>The address may have changed. Your training data has not.</p><div class="button-row"><a class="button" href="${root}app/">Open planner ${arrow}</a><a class="text-link" href="${root}">Back to the homepage ${arrow}</a></div></section>`, { noindex: true, root })
}

export function sitemap(pages: readonly MarketingPage[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(page => `  <url><loc>${siteOrigin}${page.path}</loc></url>`).join('\n')}\n</urlset>\n`
}
