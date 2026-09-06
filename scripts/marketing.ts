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
    ['learn/', 'Learn', '/learn/'],
    ['method/', 'Our approach', '/method/'],
  ].map(([href, label, section]) => `<a href="${root}${href}"${section !== '/' && path.startsWith(section!) ? ' aria-current="page"' : ''}>${label}</a>`).join('')
  return `<a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header wrap">
      ${brand(root)}
      <nav class="desktop-nav" aria-label="Main navigation">${links}</nav>
      <a class="button button-small header-cta" href="${root}app/">Open planner ${arrow}</a>
      <details class="mobile-menu"><summary aria-label="Navigation menu"><span></span><span></span></summary>
        <nav aria-label="Mobile navigation">${links}<a href="${sourceUrl}">Source code ${arrow}</a></nav>
      </details>
    </header>`
}

function footer(root: string): string {
  return `<footer class="site-footer wrap">
    <div>${brand(root)}<p>Your data. Your workouts. Your terms.</p></div>
    <nav aria-label="Footer navigation">
      <a href="${root}learn/">Training guides</a><a href="${root}method/">Our approach</a>
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
    description: 'A free, MIT-licensed, local-first training planner for running and lifting. Plan and log offline after the first successful load. Optional AI sharing is user-controlled; external providers may charge.',
  })
  if (options.article) graph.push({
    '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteOrigin}/` },
      { '@type': 'ListItem', position: 2, name: 'Learn', item: `${siteOrigin}/learn/` },
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
<meta property="og:image:alt" content="Hybrid Coach. Your data. Your workouts. Stay yours. Local-first training planner.">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${siteOrigin}/social-card.png">
<meta name="twitter:image:alt" content="Hybrid Coach. Your data. Your workouts. Stay yours. Local-first training planner.">
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
      <h3>${escapeHtml(guide.title)}</h3><p>${escapeHtml(guide.description)}</p><span class="text-link">Read the guide ${arrow}</span>
    </div></a>`).join('')
}

function cta(root: string): string {
  return `<section class="end-cta wrap"><div><p class="eyebrow">Your training. Your terms.</p><h2>A plan you own.</h2><p>Start with your routine. Keep your records. Choose whether AI gets a say.</p></div>
    <div><a class="button button-cream" href="${root}app/">Open your planner ${arrow}</a><p class="fine-print">Free. No login, subscription or API key needed.</p></div>
  </section>`
}

function home(): string {
  const sampleDays = [
    ['M', 'run'], ['T', 'lift'], ['W', 'rest'], ['T', 'run'],
    ['F', 'rest'], ['S', 'lift'], ['S', 'rest'],
  ]
  return `<section class="hero wrap">
    <div class="hero-copy"><p class="eyebrow"><span class="short-line"></span> Local-first. Open source. Free.</p>
      <h1>Your data.<br>Your workouts.<br><span class="serif">Stay yours.</span></h1>
      <p class="hero-description">AI is useful for talking through training. Keeping the plan in a chat is the hard part. Keep your running, lifting, equipment and actual workouts organised here, with or without AI.</p>
      <div class="hero-actions"><a class="button" href="./app/">Open your planner ${arrow}</a><a class="text-link" href="#why-this-exists">Why this exists ${arrow}</a></div>
      <p class="hero-promise">No account. No subscription. No telemetry.<br>Plan and log offline after your first successful load.</p>
    </div>
    <figure class="week-figure">
      <div class="week-decoration" aria-hidden="true"></div>
      <div class="week-board"><div class="board-heading"><div><span class="eyebrow">Your training space</span><h2>One week. Your way.</h2></div><span class="local-tag">Local</span></div>
        <div class="calendar-preview" aria-hidden="true">${sampleDays.map(([day, type]) => `<div class="calendar-day ${type}"><span>${day}</span><i></i><i></i></div>`).join('')}</div>
        <ul class="sample-week">
          <li class="sample-day run"><span class="day-dot" aria-hidden="true"></span><span><strong>Easy run</strong><small>Start from your comfortable routine</small></span></li>
          <li class="sample-day lift"><span class="day-dot" aria-hidden="true"></span><span><strong>Strength</strong><small>Your exercises. Your equipment.</small></span></li>
          <li class="sample-day rest"><span class="day-dot" aria-hidden="true"></span><span><strong>Room to recover</strong><small>Space for life, not catch-up work</small></span></li>
        </ul>
        <div class="library-preview"><span class="eyebrow">From your exercise library</span><strong>My dumbbell row</strong><p>Your description &middot; Your focus &middot; Your why</p><span class="equipment-tag">Dumbbells + bench</span></div>
        <div class="board-bottom"><span class="status-dot" aria-hidden="true"></span> Plans + library + actuals, saved in this browser.</div>
      </div>
      <figcaption>Illustrative workspace, not a personal prescription.</figcaption>
    </figure>
  </section>
  <div class="principle-strip"><div class="wrap"><span>Works without AI</span><span>No training-data server</span><span>Your backups, your choice</span><span>Open source. MIT.</span></div></div>
  <section class="section wrap" id="why-this-exists" aria-labelledby="why-heading">
    <div class="section-heading"><p class="eyebrow">Good conversations. Scattered training.</p><h2 id="why-heading">A chat can help you think.<br>It isn&rsquo;t your training record.</h2><p>You explain your goal, list the kit at your gym, and discuss a few exercise swaps. A week later, the useful details are buried in a long thread. Start a new chat, and you&rsquo;re piecing the context together again.</p></div>
    <div class="benefit-grid">
      <article><span class="feature-mark" aria-hidden="true">01 /</span><h3>Find the workout, not the thread.</h3><p>Was that exercise replaced? Which cue did you want to keep? Stop scrolling through drafts and revisions. Keep your reviewed exercise cards and current week together, separate from the conversation that helped shape them.</p></article>
      <article><span class="feature-mark" aria-hidden="true">02 /</span><h3>Your gym. The right context.</h3><p>Which dumbbells are available? Is there a rower? Equipment mentioned many messages ago is easy to miss. Keep your current kit, routine and goal here, then generate a fresh brief for the same chat or a different AI. Update your equipment when it changes.</p></article>
      <article><span class="feature-mark" aria-hidden="true">03 /</span><h3>Suggested isn&rsquo;t completed.</h3><p>A workout in a chat doesn&rsquo;t tell you what actually happened. Record sets, weights, partial sessions and skips in the app. Your next weekly-review brief uses those actuals; unlogged work stays unknown, not quietly counted as done.</p></article>
    </div>
  </section>
  <section class="ownership-section wrap">
    <div><p class="eyebrow">At the gym, not in the chat</p><h2>No signal.<br><span class="serif">Still your session.</span></h2><p>A cloud AI conversation may need a connection. Your workout and logbook shouldn&rsquo;t. Once the app confirms its offline copy is ready, open your week, read exercise cards and log training in the same browser without a signal.</p><p class="fine-print">Remote AI needs a connection. The built-in planner works without AI or an API key.</p></div>
    <div><p class="eyebrow">Local by default. Shared by choice.</p><h2>Useful context.<br><span class="serif">Not your whole diary.</span></h2><p>Training notes can include personal details and health flags. They don&rsquo;t all need to live in an AI conversation. Your plans, library and logs stay in IndexedDB in this browser unless you choose to share a brief or export a backup. Preview the setup or weekly-review brief before deciding whether to send it.</p><p class="fine-print">Local-first does not mean nothing ever leaves your device. The static host handles ordinary request metadata; your chosen AI provider has its own policies. Browser data can be cleared or lost, so keep local backups somewhere you trust.</p><a class="text-link" href="./privacy/">Privacy, in plain language ${arrow}</a></div>
  </section>
  <section class="how-section" id="how-it-works"><div class="wrap how-grid">
    <div class="how-title"><p class="eyebrow">Three steps. One starting point.</p><h2>Tell it once.<br><span class="serif">Build from there.</span></h2><p>Collect your context once, before any optional AI conversation. No second onboarding interview.</p><a class="text-link" href="./app/">Build my starting week ${arrow}</a></div>
    <ol class="steps">
      <li><span aria-hidden="true">01</span><div><h3>Goal</h3><p>Write what you want from training, in your own words. Add an event date if you have one; otherwise, use a 12-week progress review.</p></div></li>
      <li><span aria-hidden="true">02</span><div><h3>Routine</h3><p>Enter your recent, comfortable training, session lengths, equipment, and available space. Add availability and fixed commitments so the plan starts from real life.</p></div></li>
      <li><span aria-hidden="true">03</span><div><h3>Review</h3><p>Check the exercise lineup and your starting point. Keep the built-in choices, edit your library, or ask your own AI for suggestions. You approve the result before building.</p></div></li>
    </ol>
  </div></section>
  <section class="section wrap goal-section">
    <div class="exercise-card"><p class="eyebrow">An exercise card, made yours</p><h3>My dumbbell row</h3><span class="equipment-tag">Dumbbells + bench</span><dl><dt>Description</dt><dd>Your own setup, technique notes, and reminders.</dd><dt>Focus</dt><dd>Upper-body pulling.</dd><dt>Why it&rsquo;s here</dt><dd>Familiar strength work that fits my equipment and routine.</dd></dl><p class="fine-print">Illustrative custom card. Review the movement before using it.</p></div>
    <div class="goal-copy"><p class="eyebrow">A library, not a fixed menu</p><h2>Your exercises.<br><span class="serif">In your words.</span></h2><p>Create real custom exercise cards, not just notes alongside a workout. Edit descriptions, focus, and why each movement belongs in your plan. Keep the equipment requirements visible.</p><p>Use the equipment-aware built-in library or add a compatible custom exercise yourself. Optional AI can help write a card, but you review its technique and fit. The engine still controls the work assigned.</p><p class="fine-print">Not every exercise is supported. A description cannot bypass the planner&rsquo;s workload limits or safety checks.</p></div>
  </section>
  <section class="section harness-section wrap">
    <div class="section-heading"><p class="eyebrow">An optional AI harness</p><h2>Keep the conversation.<br><span class="serif">Bring fresh context.</span></h2><p>You don&rsquo;t have to give up a useful AI conversation. Keep the reliable training record here, and bring an up-to-date brief back to that chat whenever you want help. Or use a different AI without rebuilding the story from old messages.</p></div>
    <div class="harness-grid"><div class="harness-option"><h3>Copy &rarr; discuss &rarr; review</h3><p>Preview a fresh brief from your setup or weekly review, then copy it into your chosen chat. Discuss the ideas there and bring the final reply back for review. Nothing is imported from your chat automatically; only the suggestions you review and approve become part of the app.</p></div><div class="harness-option"><h3>Or connect your own API key</h3><p>Skip the copy and paste: explicitly send the same brief to a compatible provider from your browser. Review its reply here before applying it. Connection details and your API key stay in the open tab&rsquo;s memory only, not in your saved training or backups.</p></div></div>
    <div class="engine-boundary"><strong>The engine sets the work. You approve the changes.</strong><p>The engine controls quantities, loads, scheduling, and rule-based safety checks. AI suggests exercises and explains choices; it cannot override those rules. These are software guardrails, not medical advice or a guarantee against injury.</p></div>
    <p class="fine-print">Nothing is sent automatically. Sharing a brief uses the third party&rsquo;s policies; remote AI needs connectivity and may cost money. <a href="./privacy/">See exactly what you share</a>.</p>
  </section>
  <section class="section wrap continuity-section">
    <div class="section-heading"><p class="eyebrow">A plan that keeps its history</p><h2>Next week starts<br>with what happened.</h2><p>No Sunday-night reconstruction of your training from chat messages. Log actual sets, reps, weights, duration, and effort as you go. Review completed, partial, skipped, and unlogged work without pretending they are the same thing.</p></div>
    <ol class="review-loop"><li><span class="eyebrow">01 / Your record</span><h3>Weekly actuals</h3><p>Look back at the work you recorded. Missing observations stay unknown.</p></li><li><span class="eyebrow">02 / Your choice</span><h3>Optional AI review</h3><p>Review locally, or choose to share this week&rsquo;s brief for suggestions.</p></li><li><span class="eyebrow">03 / Your next step</span><h3>Approve next week</h3><p>You approve the selection. The engine handles next-week adaptation.</p></li></ol>
    <div class="history-note"><h3>A new goal doesn&rsquo;t erase the old work.</h3><p>Use <strong>Start a new plan</strong> in Settings when it&rsquo;s time for a fresh direction. Your routine is prefilled for review; reconfirm your current baseline rather than assuming it is unchanged. Previous logged work stays available as read-only history.</p></div>
  </section>
  <section class="section wrap faq-section"><div><p class="eyebrow">Good questions</p><h2>Clear choices.<br>Honest limits.</h2><p>An early, open project. Here&rsquo;s what to know before you start.</p></div><div class="faq-list">
    ${[
      ['Is Hybrid Coach really free?', 'The planner is free and MIT licensed. There is no trial, subscription, or account. Optional third-party AI services are separate and may charge for API use.'],
      ['Do I need AI to use it?', 'No. Built-in planning, manual custom exercises, logging, and weekly review work without AI or an API key. Optional AI can suggest exercises and explain your recorded work. You approve changes; the engine controls the quantities, loads, scheduling, and safety checks.'],
      ['What would I share with AI?', 'Only the brief you explicitly choose to share. A setup brief contains your goal, routine, equipment, and planning context, not training logs. A weekly-review brief also includes that week&rsquo;s actual logs, notes, and recorded health flags. Preview it before sharing. Neither brief exports the entire training history or API keys; your provider&rsquo;s policies apply.'],
      ['Can I use it offline?', 'Yes, after your first successful load and once the app confirms its offline copy is ready. Reopen /app/ in the same browser to plan and log offline. Remote AI still needs connectivity. The API connection is memory-only and clears when you reload or disconnect.'],
      ['Can I keep a backup or start a new plan?', 'Export a local JSON backup from Settings and keep it somewhere you trust. There is no automatic cloud backup or sync. Start a new plan keeps previous logged work as read-only history and prefills your routine for review. You must reconfirm the baseline for the new plan. Clearing browser data can delete local records, including that history.'],
      ['Can I import Garmin or Apple Health activities?', 'Not yet. FIT and Apple Health activity imports are not implemented, and there is no Garmin account connection. The current starting point is entered manually.'],
      ['Is this a personal coach or a beginner lifting course?', 'No. It is a supporting planner for people with an established training baseline. It does not teach lifting technique, diagnose pain, measure readiness, or promise a race peak. The scheduling model uses estimates, and safety checks cannot guarantee injury prevention.'],
    ].map(([question, answer]) => `<details><summary>${question}</summary><p>${answer}</p></details>`).join('')}
  </div></section>
  <section class="section learn-section wrap">
    <div class="section-heading heading-row"><div><p class="eyebrow">Understand the work</p><h2>Useful guides. Open evidence.</h2></div><a class="text-link" href="./learn/">All training guides ${arrow}</a></div>
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
    <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="${root}">Home</a><span aria-hidden="true">/</span><a href="../">Learn</a><span aria-hidden="true">/</span><span>${escapeHtml(guide.category)}</span></nav>
    <header class="article-header"><p class="eyebrow">${escapeHtml(guide.category)}</p><h1>${escapeHtml(guide.title)}</h1>
      <p class="article-meta">By <a href="${root}method/">Hybrid Coach</a> <span aria-hidden="true">&middot;</span> <time datetime="${publishedDate}">5 September 2026</time> <span aria-hidden="true">&middot;</span> ${Math.max(1, Math.ceil(words / 200))} min read</p>
      <div class="article-lead">${paragraphs(guide.intro)}</div>
    </header>
    <div class="article-layout"><aside class="article-sidebar"><nav aria-label="On this page"><h2>In this guide</h2><ol>${guide.sections.map((section, i) => `<li><a href="#section-${i + 1}">${escapeHtml(section.heading)}</a></li>`).join('')}<li><a href="#sources">Sources &amp; further reading</a></li></ol></nav><a class="button button-small" href="${root}app/">Try the planner ${arrow}</a></aside>
      <div class="prose">${guide.sections.map((section, i) => `<section id="section-${i + 1}"><h2>${escapeHtml(section.heading)}</h2>${paragraphs(section.paragraphs)}${section.bullets ? `<ul>${section.bullets.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}</section>`).join('')}
      <section class="sources" id="sources"><p class="eyebrow">Read the evidence</p><h2>Sources &amp; further reading</h2><ul>${guide.sources.map(source => `<li><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a></li>`).join('')}</ul><p class="fine-print">General education, not an individual prescription or medical advice. Research findings do not make this app&rsquo;s scheduling estimates validated physiological measurements.</p></section>
      <div class="article-next"><h2>Put your own week in view.</h2><p>Bring your runs, lifts, and fixed commitments into the free planner. No account needed.</p><a class="button" href="${root}app/">Open Hybrid Coach ${arrow}</a></div></div>
    </div>
  </article><section class="section wrap"><p class="eyebrow">Keep exploring</p><h2 class="related-heading">More field notes.</h2><div class="guide-grid related-grid">${guideCards(root, marketingGuides.filter(item => item.slug !== guide.slug))}</div></section>`
}

function method(): string {
  return `<section class="page-intro wrap"><p class="eyebrow">The thinking, in the open</p><h1>A planner you<br>can <span class="serif">look inside.</span></h1><p>Hybrid Coach is an open-source project for people who run and lift. The programming logic is part of the product, not a secret behind a subscription.</p></section>
    <div class="document-layout wrap"><aside><p class="eyebrow">Our approach</p><a class="text-link" href="${sourceUrl}">Read the source ${arrow}</a><a class="text-link" href="../learn/">Explore the guides ${arrow}</a></aside><div class="prose">
      <section><h2>One week at a time, with a reason.</h2><p>The engine takes your current starting point, goal priorities, available days, equipment, and commitments. It compares candidate arrangements and explains the placement of sessions. The same inputs produce the same result.</p><p>A block gives the broad shape. Sessions are materialized a week at a time, rather than pretending the next three months will happen exactly as planned. The current engine stays within an established baseline; it does not automatically increase your training loads.</p></section>
      <section><h2>Scheduling estimates, not a readiness score.</h2><p>Running and lifting can create different kinds of training demand. The engine models two estimated scheduling costs: systemic and structural. These help compare arrangements; they do not measure your body, predict performance, or calculate injury risk.</p><p>Recovery assumptions and coefficients are inspectable estimates. There is no acute-to-chronic workload ratio, readiness gauge, or learned physiological fatigue model. A logged fatigue skip changes future optional work; it does not diagnose why you feel tired.</p><p><a href="${sourceUrl}/tree/main/engine">Inspect the engine and its constants</a>.</p></section>
      <section><h2>Safety cannot be traded for a better score.</h2><p>Independent safety checks run after placement scoring. They can restrict or reject work even when the arrangement scores well. Pain reports halt future progression and planning. Fixed commitments cannot be quietly moved or rewritten to improve a score.</p><p>These are conservative software policies, not guarantees against injury. They do not replace qualified coaching, technique instruction, or medical advice.</p></section>
      <section><h2>Custom exercises, bounded prescriptions.</h2><p>Use the equipment-aware library, create an exercise manually, or review an AI-authored custom exercise. Each card has an editable description, focus, why it belongs in your plan, and equipment requirements. Custom exercises must fit a supported workload pattern. The engine sets the amounts and scheduling limits; AI cannot supply its own numerical prescriptions or override those limits.</p><p>Review the movement and its fit before approval. This is a planning constraint, not validated technique, medical clearance or a guarantee of safety. A changed custom technique gets a new identity; historical prescriptions and weight records stay intact. Approved revisions affect next week only. Rower, bike and SkiErg sessions still require their own established baseline.</p><p>Reference notes remain separate: editing prose alone cannot create a scheduled exercise or add work. Unsupported ideas cannot bypass the checks by being described as another movement.</p></section>
      <section><h2>AI can help interpret. It cannot prescribe.</h2><p>Setup is Goal, Routine, then Review. Collect your context once. Optional AI is offered at that final review and at an explicit weekly review, not before you have entered your routine. Preview and copy the brief into your own AI chat, discuss it, then bring the reply back for review. Or explicitly send the same brief through a compatible API. You approve the proposed selection and custom exercises.</p><p>The engine, not the model, owns quantities, loads, effort, duration, scheduling, adaptation and rule-based safety checks. AI suggests exercises and explains choices. Existing observations cannot be rewritten by a reply.</p><p>There is no bundled model or hidden AI service. Connection details and API keys stay in the open tab&rsquo;s memory, never in training backups, and clear on reload or disconnect. Built-in planning, manual custom exercises and weekly review are complete without AI.</p></section>
      <section><h2>Review actual work, not assumed completion.</h2><p>An end-of-week review separates actual sets, repetitions, seconds, weights, duration and effort from the prescription. Partial work, time skips, fatigue skips, removed sessions, omissions and unlogged sessions stay distinct. Missing observations remain unknown, not completed work or zero work.</p><p>Sharing this review with AI also shares that week&rsquo;s notes and recorded health flags. Preview the brief and decide whether to share it. It does not export the entire training history, raw activity files or API keys. AI can explain the record and propose a next selection; the user approves it and the engine handles next-week adaptation. Notes and flags are reports, not diagnoses.</p></section>
      <section><h2>A fresh plan, without erasing the work.</h2><p>Choose Start a new plan in Settings to change direction. Your routine is prefilled so you can review it rather than enter everything again. Reconfirm your current training baseline before building; old inputs are not evidence of what you can comfortably do now.</p><p>Previous logged work is retained as read-only history, separate from the new plan. Starting again does not rewrite old workouts, weights, or exercise definitions. This history is still local browser data, not a cloud backup: export a backup to keep your own copy.</p></section>
      <section><h2>Built for real interruptions.</h2><p>A time-related skip and a fatigue-related skip mean different things. The former rearranges remaining work without adding catch-up volume. The latter reduces optional work. Deleting a session records a change, not a fatigue observation. Neither an AI reply nor approval of a new exercise bypasses health holds or recovery constraints.</p><p>Rest does not reset a streak or erase a badge. There are neither streaks nor badges. Logs describe what happened, not what you owe the plan.</p></section>
      <section><h2>What this release does not do.</h2><p>Hybrid Coach is an early supporting planner, not a complete event coaching system. Running stays easy; it does not invent threshold paces or intervals from a free-text ambition.</p><p>Garmin FIT and Apple Health imports are not implemented. There is no account connection, automatic cross-device sync, or technique assessment. Starting weights are not guessed from another exercise.</p></section>
      <section><h2>Evidence and accountability.</h2><p>Our learning guides link to the research they discuss and distinguish study findings from practical examples. The project does not claim a clinical review, professional coaching certification, or scientific validation of its engine. Editorial responsibility sits with the Hybrid Coach project.</p><p>You can inspect the code, discuss a rule, or report a factual error in the <a href="${sourceUrl}/issues">public GitHub issues</a>. Please do not post private training records, health details, or API keys. The code is available under the <a href="${sourceUrl}/blob/main/LICENSE">MIT license</a>.</p></section>
    </div></div>${cta('../')}`
}

function privacy(): string {
  return `<section class="page-intro wrap"><p class="eyebrow">Local first, in plain language</p><h1>Your data.<br><span class="serif">Your choice to share.</span></h1><p>No account to create. No training-data server. Here is what stays local, what the static host sees, and what happens if you choose to share with AI.</p></section>
    <div class="document-layout wrap"><aside><p class="eyebrow">Privacy &amp; your data</p><p class="fine-print">Updated 6 September 2026</p></aside><div class="prose">
      <section><h2>Your training records are saved in this browser.</h2><p>The planner stores setup, custom definitions, plans and logs in IndexedDB on your device. Moving between this website and /app/ on the same HTTPS domain does not upload your data. Sharing a coaching or weekly-review brief is a separate, explicit action described below.</p><p>There is no account, application backend, automatic cloud backup, advertising profile, or training-data sync. Someone with access to your browser profile may be able to access its records. Browser storage is not a promise of encryption or permanent retention.</p></section>
      <section><h2>Backups are your choice, and your responsibility.</h2><p>Export a local JSON backup from Settings in the planner. Import it in another browser or device to transfer your training records. Keep backup files somewhere you trust; they can include personal training information.</p><p>Start a new plan preserves previous logged work as read-only history in this browser. It does not upload that history or create a remote backup. Clearing site data, using temporary/private browsing, or browser storage eviction can remove local records, including previous plans.</p><p>A localhost preview, a pages.dev preview, and this domain have separate storage. They do not exchange data automatically.</p></section>
      <section><h2>No telemetry, analytics or error-reporting scripts.</h2><p>This production site does not use analytics beacons, advertising trackers, session recording, or browser error reporting. It uses no tracking cookies. Fonts, graphics, and application assets are served with the site rather than loaded from third-party font or image services.</p><p>Cloudflare hosts the static files. Like any web host, it necessarily handles network requests, including IP addresses and ordinary request metadata, to deliver and protect the site. Local-first does not mean that loading a website makes no network request. See <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare&rsquo;s privacy policy</a> for its handling of that traffic.</p></section>
      <section><h2>AI is a separate, explicit connection.</h2><p>Optional AI is available at the final setup review and the weekly review. Nothing is sent simply by visiting, entering Goal or Routine, or opening a panel. Chat and API use the same previewable brief. Copy or download it for your own AI chat, or explicitly send it to a compatible endpoint. The browser connects directly, without a Hybrid Coach proxy; copying or downloading alone contacts no provider.</p><p>A setup brief includes your goal and date, equipment and space, baseline session amounts, availability and fixed sessions, exercise selection, custom definitions, eligible catalog and profiles, reference cards and relevant planned sessions. Setup sharing does not include training logs.</p><p><strong>A weekly-review brief additionally includes this week&rsquo;s actual training records:</strong> sets, repetitions, seconds, weights, duration, effort, notes and recorded health flags, along with partial work, skip reasons, removals, omissions and unlogged sessions. Missing actuals remain unknown, not assumed completion. These records may be sensitive. Preview them before choosing to share.</p><p>Neither brief exports the entire training history, raw activity files or API keys. Sharing is not automatic, and the external provider or chat has its own terms and privacy policy. A local endpoint must permit browser connections too.</p><p>Connection details and API keys stay in the open tab&rsquo;s memory and are excluded from saved training data, briefs and backups. A supplied key is sent only as the authorization header to the endpoint you choose. Reloading or disconnecting clears it. Optional API use may cost money; built-in planning, manual custom exercises and weekly review need no AI.</p></section>
      <section><h2>Offline, after the first successful load.</h2><p>A service worker saves this site&rsquo;s static files after you open the planner online and installation succeeds. Once the app confirms its offline copy is ready, you can reopen the planner and use local records offline in the same browser. Remote AI requires connectivity; its requests are not cached for offline use.</p></section>
      <section><h2>Questions or corrections.</h2><p>The source and public issue tracker are on <a href="${sourceUrl}">GitHub</a>. Do not post private records or API keys in a public issue. This site has no contact form, mailing-list signup, or data-collection endpoint.</p></section>
    </div></div>`
}

export function marketingPages(): MarketingPage[] {
  const pages = [
    { path: '/', title: 'Local-First Training Planner for Running & Lifting | Hybrid Coach', description: 'Your data. Your workouts. Stay yours. Free, open-source planning for running and lifting. Offline after setup, optional AI, no accounts or telemetry.', body: home() },
    { path: '/learn/', title: 'Hybrid Training Guides: Running, Lifting & Real Life | Hybrid Coach', description: 'Learn how to combine running and strength training, arrange same-day sessions, and adapt busy weeks. Practical guides with sources and honest limits.', body: learningHub() },
    { path: '/method/', title: 'How the Hybrid Coach Training Engine Works', description: 'A local planning engine, your exercise library, and an optional AI harness. See who sets the work, what you approve, and how training history is kept.', body: method() },
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
  return layout('/404', 'Page not found | Hybrid Coach', 'This page could not be found.', `<section class="page-intro wrap not-found"><p class="eyebrow">404 / A different kind of rest day</p><h1>This page<br>is <span class="serif">off the plan.</span></h1><p>The address may have changed. Your training data has not.</p><div class="button-row"><a class="button" href="${root}app/">Open the planner ${arrow}</a><a class="text-link" href="${root}">Back to the homepage ${arrow}</a></div></section>`, { noindex: true, root })
}

export function sitemap(pages: readonly MarketingPage[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(page => `  <url><loc>${siteOrigin}${page.path}</loc></url>`).join('\n')}\n</urlset>\n`
}
