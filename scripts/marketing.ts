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
    <div>${brand(root)}<p>Your training. Your terms.</p></div>
    <nav aria-label="Footer navigation">
      <a href="${root}learn/">Training guides</a><a href="${root}method/">Our approach</a>
      <a href="${root}privacy/">Privacy &amp; your data</a><a href="${sourceUrl}">GitHub ${arrow}</a>
    </nav>
    <p class="footer-note">Open source under MIT. No accounts. No subscriptions. No tracking.<br>
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
    description: 'A local-first planner and training log for running and lifting. Optional AI providers may charge for API use.',
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
<meta property="og:image:alt" content="Hybrid Coach. Running and lifting. One plan that fits.">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${siteOrigin}/social-card.png">
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
  return `<section class="end-cta wrap"><div><p class="eyebrow">Less juggling. More training.</p><h2>Make space for both.</h2><p>Start with the training you actually do. Build a week around the life you actually have.</p></div>
    <div><a class="button button-cream" href="${root}app/">Build my starting week ${arrow}</a><p class="fine-print">Free. No account or API key needed.</p></div>
  </section>`
}

function home(): string {
  const sampleDays = [
    ['MON', 'Easy run', 'run', 'Conversational effort'],
    ['TUE', 'Strength', 'lift', 'Your familiar movements'],
    ['WED', 'Room to recover', 'rest', 'Rest is part of the plan'],
    ['THU', 'Club practice', 'sport', 'A fixed commitment'],
    ['FRI', 'Strength', 'lift', 'A place for your weights'],
    ['SAT', 'Easy run', 'run', 'Time on your feet'],
    ['SUN', 'Life, outside training', 'rest', 'No catch-up required'],
  ]
  return `<section class="hero wrap">
    <div class="hero-copy"><p class="eyebrow"><span class="short-line"></span> A free hybrid training planner</p>
      <h1>Running<br>and lifting.<br><span class="serif">One plan that fits.</span></h1>
      <p class="hero-description">You don&rsquo;t have to choose one. Bring your runs, your lifts, and your real-life commitments into a week you can actually use.</p>
      <a class="button" href="./app/">Build my starting week ${arrow}</a>
      <p class="hero-promise"><span aria-hidden="true">&#10003;</span> No account. No subscription. Just your device.</p>
    </div>
    <figure class="week-figure">
      <div class="week-decoration" aria-hidden="true"></div>
      <div class="week-board"><div class="board-heading"><div><span class="eyebrow">Your week, together</span><h2>Run. Lift. Live.</h2></div><img src="./favicon.svg" width="36" height="36" alt=""></div>
        <ol class="sample-week">${sampleDays.map(([day, label, type, detail]) => `<li class="sample-day ${type}"><span class="day-label">${day}</span><span class="day-dot" aria-hidden="true"></span><span><strong>${label}</strong><small>${detail}</small></span>${type === 'sport' ? '<span class="fixed-tag">Fixed</span>' : ''}</li>`).join('')}</ol>
        <div class="board-bottom"><span class="status-dot" aria-hidden="true"></span> A plan, not a promise to do more.</div>
      </div>
      <figcaption>Illustrative week, not a personal prescription. Your plan starts from your own training.</figcaption>
    </figure>
  </section>
  <div class="principle-strip"><div class="wrap"><span>Plans, not just logs</span><span>Works without AI</span><span>Saved on your device</span><span>Open source. MIT.</span></div></div>
  <section class="section wrap">
    <div class="section-heading"><p class="eyebrow">For people who do both</p><h2>Two ways to train.<br>One life to fit them into.</h2><p>A running plan doesn&rsquo;t see your squat session. A lifting log doesn&rsquo;t know about Thursday practice. Put the whole week in view.</p></div>
    <div class="benefit-grid">
      <article><span class="feature-mark" aria-hidden="true">01 /</span><h3>A week, not a pile of workouts</h3><p>The engine considers your running, lifting, available days, and fixed commitments together. Every planned session comes with a reason.</p></article>
      <article><span class="feature-mark" aria-hidden="true">02 /</span><h3>When life changes, the plan can too</h3><p>Move a session, skip for time or fatigue, or delete it. These aren&rsquo;t the same signal, and the planner doesn&rsquo;t treat them as one.</p></article>
      <article><span class="feature-mark" aria-hidden="true">03 /</span><h3>Take it to the gym</h3><p>Log weight, reps, and effort set by set on your phone. After the offline copy is ready, reopen and log without a connection.</p></article>
    </div>
  </section>
  <section class="how-section" id="how-it-works"><div class="wrap how-grid">
    <div class="how-title"><p class="eyebrow">From starting point to training week</p><h2>Start where<br>you are.<br><span class="serif">Not from zero.</span></h2><a class="text-link" href="./app/">Find my starting point ${arrow}</a></div>
    <ol class="steps">
      <li><span>01</span><div><h3>Goal</h3><p>Write what you&rsquo;re working toward. An event date is optional; without one, use a clearly shown 12-week progress review. No sport menu or AI interview.</p></div></li>
      <li><span>02</span><div><h3>Routine</h3><p>Start with recent, comfortable running and lifting. Add session lengths, frequency and equipment, with optional availability and fixed commitments.</p></div></li>
      <li><span>03</span><div><h3>Review &amp; build</h3><p>Review your lineup, keep built-in exercises or create your own. Optional AI appears here, after your routine is complete, and at the weekly review. No API key is needed to build.</p></div></li>
    </ol>
  </div></section>
  <section class="section wrap goal-section">
    <div class="goal-card"><span class="eyebrow">A goal that fits your week</span><p class="goal-quote">&ldquo;Keep my easy runs.<br>Build a steady routine.<br><span class="serif">And make room to lift.</span>&rdquo;</p><div class="goal-tags"><span>Running matters</span><span>Strength matters</span><span>Life still happens</span></div><p class="fine-print">An illustrative goal. Start with your own training.</p></div>
    <div class="goal-copy"><p class="eyebrow">Optional AI. Clear boundaries.</p><h2>Your goal can be<br>your own words.</h2><p>At the final setup review or weekly review, use one previewable brief with your AI chat or a compatible API. AI can explain recorded work, suggest a lineup and author real custom exercises for your approval.</p><p>Each custom exercise must fit a supported engine profile. The engine controls dose, costs, weights and scheduling; AI cannot override them. Technique and profile fit still need your review.</p><p class="fine-print">Built-in planning, manual custom exercises and weekly review work without AI. No model is bundled; an external provider may charge for use. This is a supporting planner, not medical or complete event coaching.</p><a class="text-link" href="./method/">See how the engine works ${arrow}</a></div>
  </section>
  <section class="section learn-section wrap">
    <div class="section-heading heading-row"><div><p class="eyebrow">A little understanding goes a long way</p><h2>Build a better training week.</h2></div><a class="text-link" href="./learn/">All training guides ${arrow}</a></div>
    <div class="guide-grid">${guideCards('./')}</div>
  </section>
  <section class="section wrap faq-section"><div><p class="eyebrow">Good questions</p><h2>No fine-print<br>fitness subscription.</h2><p>An early, open project. Here&rsquo;s what it does, and what it doesn&rsquo;t.</p></div><div class="faq-list">
    ${[
      ['Is Hybrid Coach really free?', 'The planner is free and MIT licensed. There is no trial, subscription, or account. Optional third-party AI services are separate and may charge for API use.'],
      ['Where does my training data go?', 'Records are saved in this browser, in IndexedDB, with no training-data server or automatic sync. If you explicitly share a weekly review with AI, its brief includes that week&rsquo;s actual logs, notes and health flags. Preview it first. JSON backups are your choice; clearing browser data can delete local records.'],
      ['Can I use it offline?', 'Yes, after opening the planner online and confirming its offline copy is ready. Reopen /app/ in the same browser to plan and log offline. A remote AI service still needs a connection.'],
      ['Does AI write the training plan?', 'No. Optional AI can interpret your goal, discuss a week&rsquo;s recorded work and propose real custom exercises using supplied engine profiles. You approve the definitions and next selection. The engine controls quantities, costs, loads, scheduling and safety checks. Manual custom exercises, planning and logging need no API key.'],
      ['Can I import Garmin or Apple Health activities?', 'Not yet. FIT and Apple Health activity imports are not implemented, and there is no Garmin account connection. The current starting point is entered manually.'],
      ['Is this a personal coach or a beginner lifting course?', 'No. It is a supporting planner for people with an established training baseline. It does not teach lifting technique, diagnose pain, measure readiness, or promise a race peak. The scheduling model uses estimates, and safety checks cannot guarantee injury prevention.'],
    ].map(([question, answer]) => `<details><summary>${question}</summary><p>${answer}</p></details>`).join('')}
  </div></section>${cta('./')}`
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
      <section><h2>Custom exercises, bounded prescriptions.</h2><p>Use the equipment-aware library, create an exercise manually, or review an AI-authored custom definition. A real custom exercise has its own identity, description, focus, purpose and equipment requirements. It must use a supplied engine workload profile, which owns execution, units, conservative scheduling costs and dose limits. AI cannot supply numerical prescriptions or override that profile.</p><p>Review the movement and its profile fit before approval. This is a scheduling contract, not validated technique, medical clearance or a guarantee of safety. A changed custom technique gets a new identity; historical IDs, prescriptions and weight records stay intact. Approved revisions affect next week only. Rower, bike and SkiErg sessions still require their own established baseline.</p><p>Reference notes remain separate: editing prose cannot create a scheduled exercise or add work. Unsupported ideas cannot bypass the profile and dose checks by being described as another movement.</p></section>
      <section><h2>AI can help interpret. It cannot prescribe.</h2><p>Setup is Goal, Routine, then Review &amp; build. Optional AI is offered at that final review and at an explicit weekly review, not before you have entered your routine. Copy the previewable brief into your own AI chat, or send the same brief through a compatible API. Review the reply before applying any selection or custom definitions.</p><p>The version-2 app reply includes <code>customExercises</code>; compatible version-1 replies remain supported. The reply is not a campaign backup. The engine, not the model, owns quantities, costs, loads, effort, duration, adaptation and placement. Existing observations cannot be rewritten by a reply.</p><p>There is no bundled model or hidden AI service. API keys stay in the open tab&rsquo;s memory, never in training backups. Built-in planning, manual custom exercises and weekly review are complete without AI.</p></section>
      <section><h2>Review actual work, not assumed completion.</h2><p>An end-of-week review separates actual sets, repetitions, seconds, weights, duration and effort from the prescription. Partial work, time skips, fatigue skips, removed sessions, omissions and unlogged sessions stay distinct. Missing observations remain unknown, not completed work or zero work.</p><p>Sharing this review with AI also shares that week&rsquo;s notes and recorded health flags. Preview the brief and decide whether to share it. It does not export the entire training history, raw activity files or API keys. AI can explain the record and propose a next selection; the user approves it and the engine handles next-week adaptation. Notes and flags are reports, not diagnoses.</p></section>
      <section><h2>Built for real interruptions.</h2><p>A time-related skip and a fatigue-related skip mean different things. The former rearranges remaining work without adding catch-up volume. The latter reduces optional work. Deleting a session records a change, not a fatigue observation. Neither an AI reply nor approval of a new exercise bypasses health holds or recovery constraints.</p><p>Rest does not reset a streak or erase a badge. There are neither streaks nor badges. Logs describe what happened, not what you owe the plan.</p></section>
      <section><h2>What this release does not do.</h2><p>Hybrid Coach is an early supporting planner, not a complete event coaching system. Running stays easy; it does not invent threshold paces or intervals from a free-text ambition.</p><p>Garmin FIT and Apple Health imports are not implemented. There is no account connection, automatic cross-device sync, or technique assessment. Starting weights are not guessed from another exercise.</p></section>
      <section><h2>Evidence and accountability.</h2><p>Our learning guides link to the research they discuss and distinguish study findings from practical examples. The project does not claim a clinical review, professional coaching certification, or scientific validation of its engine. Editorial responsibility sits with the Hybrid Coach project.</p><p>You can inspect the code, discuss a rule, or report a factual error in the <a href="${sourceUrl}/issues">public GitHub issues</a>. Please do not post private training records, health details, or API keys. The code is available under the <a href="${sourceUrl}/blob/main/LICENSE">MIT license</a>.</p></section>
    </div></div>${cta('../')}`
}

function privacy(): string {
  return `<section class="page-intro wrap"><p class="eyebrow">Local first, in plain language</p><h1>Your training.<br><span class="serif">Your device.</span></h1><p>No account to create. No training-data server. Here is what stays local, and what happens if you choose to connect AI.</p></section>
    <div class="document-layout wrap"><aside><p class="eyebrow">Privacy &amp; your data</p><p class="fine-print">Updated 6 September 2026</p></aside><div class="prose">
      <section><h2>Your training records are saved in this browser.</h2><p>The planner stores setup, custom definitions, plans and logs in IndexedDB on your device. Moving between this website and /app/ on the same HTTPS domain does not upload your data. Sharing a coaching or weekly-review brief is a separate, explicit action described below.</p><p>There is no account, application backend, automatic cloud backup, advertising profile, or training-data sync. Someone with access to your browser profile may be able to access its records. Browser storage is not a promise of encryption or permanent retention.</p></section>
      <section><h2>Backups are your choice, and your responsibility.</h2><p>Export a JSON backup from Data &amp; settings in the planner. Import it in another browser or device to transfer a campaign. Keep backup files somewhere you trust; they can include personal training information.</p><p>Clearing site data, using temporary/private browsing, or browser storage eviction can remove local records. A localhost preview, a pages.dev preview, and this domain have separate storage. They do not exchange data automatically.</p></section>
      <section><h2>No analytics or error-reporting scripts.</h2><p>This production site does not use analytics beacons, advertising trackers, session recording, or browser error reporting. It uses no tracking cookies. Fonts, graphics, and application assets are served with the site rather than loaded from third-party font or image services.</p><p>Cloudflare hosts the static files. Like any web host, it necessarily handles network requests, including IP addresses and normal request metadata, to deliver and protect the site. Local-first does not mean that loading a website makes no network request. See <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare&rsquo;s privacy policy</a> for its handling of that traffic.</p></section>
      <section><h2>AI is a separate, explicit connection.</h2><p>Optional AI is available at the final setup review and the weekly review. Nothing is sent simply by visiting, entering Goal or Routine, or opening a panel. Chat and API use the same previewable brief. Copy or download it for your own AI chat, or explicitly send it to a compatible endpoint. The browser connects directly, without a Hybrid Coach proxy; copying or downloading alone contacts no provider.</p><p>A setup brief includes your goal and date, equipment and space, baseline session amounts, availability and fixed sessions, exercise selection, custom definitions, eligible catalog and profiles, reference cards and relevant planned sessions. Setup sharing does not include training logs.</p><p><strong>A weekly-review brief additionally includes this week&rsquo;s actual training records:</strong> sets, repetitions, seconds, weights, duration, effort, notes and recorded health flags, along with partial work, skip reasons, removals, omissions and unlogged sessions. Missing actuals remain unknown, not assumed completion. These records may be sensitive. Preview them before choosing to share.</p><p>Neither brief exports the entire training history, raw activity files or API keys. Sharing is not automatic, and the external provider or chat has its own terms and privacy policy. A local endpoint must permit browser connections too.</p><p>Connection details and API keys stay in the open tab&rsquo;s memory and are excluded from saved training data, briefs and backups. A supplied key is sent only as the authorization header to the endpoint you choose. Reloading or disconnecting clears it. Optional API use may cost money; built-in planning, manual custom exercises and weekly review need no AI.</p></section>
      <section><h2>Offline, after the first visit.</h2><p>A service worker saves this site&rsquo;s static files after you open the planner and installation succeeds. This lets you reopen the planner and use local records offline in the same browser. It does not cache external AI requests. The app shows whether its offline copy is ready.</p></section>
      <section><h2>Questions or corrections.</h2><p>The source and public issue tracker are on <a href="${sourceUrl}">GitHub</a>. Do not post private records or API keys in a public issue. This site has no contact form, mailing-list signup, or data-collection endpoint.</p></section>
    </div></div>`
}

export function marketingPages(): MarketingPage[] {
  const pages = [
    { path: '/', title: 'Free Hybrid Training Planner for Running & Lifting | Hybrid Coach', description: 'Plan running and lifting together, adapt your week, and log every set. Free, open-source and local-first. No accounts, subscriptions or AI required.', body: home() },
    { path: '/learn/', title: 'Hybrid Training Guides: Running, Lifting & Real Life | Hybrid Coach', description: 'Learn how to combine running and strength training, arrange same-day sessions, and adapt busy weeks. Practical guides with sources and honest limits.', body: learningHub() },
    { path: '/method/', title: 'How the Hybrid Coach Training Engine Works', description: 'Look inside the open-source training planner: deterministic scheduling, independent safety checks, optional AI boundaries, and honest limitations.', body: method() },
    { path: '/privacy/', title: 'Privacy & Your Local Training Data | Hybrid Coach', description: 'How Hybrid Coach stores your training on your device, handles offline copies and backups, and keeps optional AI connections separate. No tracking.', body: privacy() },
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
