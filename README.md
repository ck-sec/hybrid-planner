# Hybrid Coach

An open, local-first training planner for people who run and lift.
MIT licensed, no subscription, no accounts, no backend, no telemetry, no error
reporting, or environment configuration. All training data is stored in the
browser's IndexedDB. No LLM or API key is required. An optional, explicitly
connected local model or HTTPS API can interpret a goal, propose compatible
exercise cards before setup is committed, and select bounded session-content ideas.

## Mobile campaign workspace

Setup starts with two paths: a complete **classic run + lift** scheme without AI,
or a **free-text goal** interpreted by an explicitly connected model. Both lead
through typical session length and frequency, recommended exercise cards,
weekly commitments, and a calendar home. Weekly running minutes are calculated
from a usual easy run and runs per week; users do not need to calculate totals.

Exercise cards are recommended for the selected equipment, with compatible
same-pattern swaps. They are explicitly recommendations, **not invented historical
observations**. No previous weights, sets, RPE ratings or exercise dates are
required for this path. The engine prescribes a conservative first exposure;
kilograms remain unset until the athlete finds and logs their own weight.

The Bangkok dodgeball example is explicitly sample data, including its dates
and training rhythm. Confirm a real event/review date and recent training
before building a personal campaign. Other goals use the same planning path.

- Drag a session's move handle to another day, or use **Move** inside the
  session with a keyboard or touch controls. Moves are safety-checked.
- A fatigue skip reduces future optional work. A time-related skip reschedules
  what remains without treating it as fatigue or adding catch-up work.
  Deleting a session leaves a change record, not a fatigue observation.
- Log kilograms, repetitions and set RPE individually. Prefilled or suggested
  values are not completed sets. Working input and confirmed logs persist
  locally; finishing the session requires a separate confirmation.
- Read exercise-specific records and changes in History. No streaks, readiness
  gauges, or automatic load increases are introduced.
- Moving to a newly generated week requires confirmation. In this first
  release, previous campaign weeks become read-only; finish an in-progress
  session before advancing. Unlogged sessions stay unknown, not completed.
- Campaign data has a separate IndexedDB database, `hybrid-planner-campaign`.
  The original planner and its data are accessible under **Data & settings**
  or `/app/?view=legacy`. Nothing migrates or overwrites that archive automatically.
- Export and restore campaign JSON backups through settings. These are separate
  from original-planner backups. A revision check prevents cross-tab overwrites.

**Current boundaries:** this remains an established-baseline supporting plan,
not a complete championship progression system. Goal priorities influence
scheduling and curated content; they do not justify invented sport-specific
workloads. Garmin FIT and Apple Health activity import are not implemented yet,
and are labelled accordingly in setup. There is no Garmin account connection.

### Optional AI: goal interpretation and a bounded content layer

During setup, write a goal such as preparing for a dodgeball championship in
Bangkok. AI may propose the goal classification, name, location, explicitly
specified event date, priorities, and equipped exercise-library IDs. Review the
interpretation and added/removed cards before applying. Missing dates are not
filled by guessing; confirm them separately. Exercise-only requests preserve
the already reviewed goal and date.

AI cannot invent exercise metadata or prescribe sets, repetitions, RPE, weights,
durations, weekly volume or placement. Unknown fields, unknown/high-skill
exercises and unavailable equipment are rejected. The deterministic engine
costs the approved selection, sets its prescription and applies the independent
safety floor. These suggestions cannot edit a committed block.

Use a local OpenAI-compatible endpoint or a remote HTTPS `/chat/completions`
endpoint. Configure it yourself and confirm the exact payload before sending.
No request occurs merely by opening a panel. Setup endpoint, model and API key
stay in memory for the open tab: disconnect, finish setup or reload to clear them. They are
never included in training data or backups. Setup sends only the goal brief,
exercise request, equipment, selected IDs and allowed catalog—not logs or files.

Inside an already planned session, the separate session assistant selects
compatible focus cues from an approved content catalog. It cannot change the
session's exercise selection or prescription. Its configuration is cleared
when that panel closes. Raw model prose never becomes workout instructions.
Without AI, recommended exercises, curated content and every planning/logging
function remain available. Arbitrary exercise authoring is not supported.

The browser connects directly to the chosen endpoint, with no proxy or
application backend. CORS, mixed-content and local-network restrictions still
apply; the endpoint must support browser use. A phone's `localhost` means the
phone, not a computer running a model. For another device, use an explicitly
configured HTTPS endpoint rather than expecting LAN HTTP to work. No model is
bundled, and API usage may be charged by the selected provider.

## Run

Node 24+ and npm:

```sh
npm ci
npm run dev
npm test
npm run lint
npm run build
npm run preview
```

Dev/preview serve static client files, not an application backend. Deploy `dist`
to a static HTTPS host. For a subdirectory deployment, use an explicit base such
as `npm run build -- --base=/planner/` and adapt the host's app fallback to match.
There is no API or database server. A production service worker precaches only
this site's own static files.
After a successful installation, the same address can reopen offline. HTTPS
or localhost is required; opening HTML via `file://` is not supported.

## Public website and learning guides

The public homepage is at `/`; the existing planner is at `/app/` on the same
origin. IndexedDB names, records and backup formats are unchanged. There is no
data migration or upload when a user opens the new planner address.

- `/`: mobile-first product introduction, illustrative week, FAQ and planner links.
- `/learn/`: a learning hub with original guides to hybrid planning, same-day
  running/lifting, and busy schedules. Each guide links its research sources.
- `/method/`: the engine's assumptions, AI boundaries and current limitations.
- `/privacy/`: local storage, hosting, backups and optional AI data handling.
- `/app/`: the complete planner, marked `noindex` rather than competing with the
  public pages in search. Do not block crawler access to its noindex directive.

The build renders complete HTML through [scripts/marketing.ts](scripts/marketing.ts).
No React bundle, client-side content rendering, third-party fonts, analytics or
backend is required to read the marketing pages. The tiny homepage script only
forwards old `?view=legacy` and `#session/...` bookmarks to `/app/`, preserving
their query and fragment. It does not inspect training records.

Add or revise articles in [scripts/marketing-content.ts](scripts/marketing-content.ts).
The hub, related articles, canonical links, Article/Breadcrumb structured data and
sitemap are generated from this content. Keep the visible editorial date and
structured dates accurate when changing published content. Use original writing,
verified sources, and clearly labelled illustrative schedules, not invented
credentials, testimonials, outcome guarantees or keyword-variation pages.

The initial topic cluster answers three distinct reader questions: how to start a
hybrid plan, how to arrange a shared training day, and how to adapt a constrained
week. Future guides should answer a genuine unanswered question and link back to
the relevant foundations. Review research and product claims before publishing.
The social preview PNG is rendered at 1200 x 630 from
[public/social-card.svg](public/social-card.svg); keep both files in sync.

`robots.txt` and `sitemap.xml` are generated at build time. Public pages have
unique descriptions, canonical URLs, social metadata and ordinary HTML links.
Unknown public URLs return a real 404 instead of the app shell. Submit
`https://hybridcoach.ai/sitemap.xml` in Google Search Console when domain ownership
is verified; this requires no analytics script. Search Console ownership and
sitemap submission are not configured by this build. Indexing and rankings are
not guaranteed; use search impressions and actual queries to guide later content,
not fabricated traffic estimates. See Google's
[SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide).

## Cloudflare deployment

Deploy this as a **static site**, with no Pages Functions, Worker application
code, database, bindings, runtime secrets or application environment variables.
The production branding uses the lapis, cream, plum, midnight, grey and berry
palette with an original connected-H mark.

For a Git-connected Cloudflare Pages project:

- Repository: `ck-sec/hybrid-planner`; production branch: `main`.
- Build command: `npm run build -- --base=/`.
- Output directory: `dist`; repository root as the working directory.
- Node version: pinned by `.node-version`, also used by GitHub checks.
- Set the domain's Browser Cache TTL to **Respect Existing Headers**, so
  Cloudflare does not replace the service worker's `no-cache` update policy.
- Target domain: `hybridcoach.ai`, with the marketing site at `/` and planner at
  `/app/`. The existing `app.hybridcoach.ai` application is unrelated and unchanged.
- Keep Cloudflare Web Analytics, Zaraz and other injected tracking disabled.
  Do not attach the older application's backend or authentication.
- Disable Network Error Logging, Bot Fight Mode, and the independent JavaScript
  Detections setting (`enable_js: false`) in the domain's Bot Management config.
  Turning off Bot Fight Mode alone can leave script injection enabled. Preserve
  unrelated bot settings when updating this configuration. Keep the normal
  network-level DDoS protection enabled.
- Verify the actual response headers, not just dashboard toggles: Pages can
  supply its own reporting policy. For the production hostnames, set `NEL` to
  `{"max_age":0}` and `Report-To` to
  `{"group":"cf-nel","max_age":0,"endpoints":[]}` using a response-header
  transform rule. These values also expire previously cached browser policies.
  The static headers include the same opt-out for hosts that honor them.

The provider-controlled `pages.dev` preview can have different reporting
headers from the custom domain. Use the verified custom domain for training;
do not assume disabling analytics also disables browser network-error reports.

The root-domain build uses absolute asset and service-worker URLs.
`public/_redirects` limits the SPA fallback to `/app/*`; a generated root
`404.html` disables Cloudflare's site-wide SPA fallback. Marketing routes are
real directory-index HTML files, not client-side routes.

The existing root-scoped `/sw.js` is deliberately retained so previously installed
workers can update in place. Its new cache contains distinct canonical HTML
responses for `/`, `/app/` and each public page. App navigation falls back only
inside `/app/`; unknown public URLs go to the host's 404. Existing tabs keep their
current screen until navigation, without forced reloads of a working log.
Only obsolete caches from the same worker scope are removed; IndexedDB is untouched.
Directory pages are cached at their trailing-slash URL, never `index.html`: Pages
redirects that filename, and browsers reject redirected cached navigation
responses. The 404 document is hashed but not fetched during precaching, because
a non-success response would fail installation.
`public/_headers` supplies response policies and service-worker revalidation.
Configure the `www` alias as a Cloudflare zone-level redirect to
`https://hybridcoach.ai`, preserving the path and query string with status 301.
Pages `_redirects` files do not support domain-level source URLs. Hosting
directives invalidate the offline cache version but are deliberately excluded
from its fetchable asset list.

Preview deployments, localhost and the live domain have **separate browser
storage**. Export/import a campaign backup to move your own data between them;
deployment does not upload or migrate training data. Keep old deployment
history for rollback and leave the older private coaching repositories intact.

## Version 0.2: explicit, auditable scheduling

The block is an arc, not twelve weeks of promises. Create a goal with a peak
date and priorities, record an established baseline, and materialize one week
at a time. Pattern-to-exercise assignments stay fixed within the block.

- Running stays easy and relative to conversational effort; no invented pace,
  heart-rate zones, threshold tests, or intervals.
- The original observed-baseline path uses established exercises, sets, reps,
  and per-exercise RPE observations. The recommended path keeps first-exposure
  templates separate from observations and uses its own conservative caps.
  RPE 8 means approximately two reps remaining; RPE 9 means one.
- Novice exercise targets are capped at RPE 7, experienced targets at 8.
  These are conservative product policies, not prescriptions implied by the
  studies of rating accuracy.
- Suggested starting kilograms come only from the same exercise with matching
  reps and RPE. No cross-exercise conversion, 1RM estimate, or bodyweight division.
- The first week reduces optional work to 60%, with a one-set minimum. Planned
  deload/taper phases reduce work too. Running and session-frequency ceilings
  remain baseline-bounded; recommended exercise doses have their own fixed
  limits. Phase labels do not guarantee a performance peak.
- Fixed commitments remain fixed. Preview user pins explicitly; the engine
  cannot move or rewrite their workload to improve its score.
- Every session has a deterministic explanation, with finite score terms
  separately inspectable. If work does not fit, it is left out, never moved
  into other sessions as catch-up debt.

**This remains a baseline-bounded first release, not a validated progression
system or a substitute for a coach or clinician.** It does not prescribe new
high-skill lifts, split routines, sport drills, event-specific intensity, or
rehabilitation. Olympic-lift entries may be costed/logged but never generated.
Exercise choices can change during setup, not within a committed block.
Automatic progression is not enabled.

## Model costs are not measurements

`engine/types.ts` has zero imports. It separates reported session effort
(0-10), effort multiplied by actual minutes, and estimated systemic/structural
scheduling costs in arbitrary units. The two-axis model is a hypothesis for
sequencing, not measured fatigue, readiness, injury risk, or guaranteed recovery.

`engine/exercises.json` is the small community-editable exercise library.
Its hand-authored coefficients describe estimated cost per ten-rep set at RPE 7.
`engine/constants.ts` owns scheduling weights and policy thresholds. Estimates
are not labelled as effect sizes. Library and policy edits require version
changes and regression tests.

Recovery half-lives are fixed at estimated 24/60 hours. **Physiological model
calibration is deliberately off:** a single session-effort rating cannot identify two
cost multipliers and two recovery rates. Logs do not silently fit a physiological
model. The mobile campaign's fatigue-skip reduction is an explicit conservative
policy, not learned physiology. See [decision 0004](docs/decisions/0004-model-estimates-and-safety.md) for
the assumptions, corrected research references, and limitations.

## Independent safety floor

The optimizer enumerates arrangements, scores them, then vetoes unsafe
candidates. Scores cannot buy their way around:

- Availability, time budget, overlaps, or mandatory pins/commitments.
- At least one rest day and bounded consecutive hard days.
- Established running and lifting ceilings.
- Conservative lifting separation, including neighboring weeks.
- Active pain, illness, or return-from-break holds.

Separation is **end-to-start**, not start-to-start. Unknown times cannot prove
adequate recovery. The engine uses one planning-local Gregorian calendar;
daylight-saving clock changes require care because elapsed timezone-aware
hours are not modeled. All day indices remain Monday=0 through Sunday=6.

Planned deload/taper/calibration weeks do not become artificially low normal-work
references. History before a superseding confirmed baseline does not cap it.
Illness/pain interruptions are not treated as planned deloads.
The 10% ceiling is a product constraint, not a claim of injury prevention.
If mandatory commitments violate the floor, the result is explicitly infeasible
and is not presented as an acceptable training recommendation.

## Reproducibility and local data

Each saved week freezes its complete input and engine, policy, and exercise
library versions. The same input produces the same result. Tie-breaking and
bounded search order are deterministic; no clocks or randomness live in the
engine. Search exhaustion is reported rather than pretending global optimality.

Version 0.1 maintenance weeks retain their original engine under
`engine/legacy/`. Schema migration preserves their inputs and logs; it never
reinterprets weekday indices or regenerates old weeks with version 0.2 rules.
Unknown-time archive lifts enter new planning as date-only constraints, not
invented durations or fatigue values. The optimizer can arrange around those
constraints before choosing a week.
Unsupported versions and corrupt backups fail visibly.

All data belongs to the current browser profile and origin. There is no cloud
recovery, sync, or app-level encryption. Private browsing, storage eviction,
clearing site data, or changing the host/port can remove access to history.
Export JSON backups regularly; they contain training information in plain text.
Imports require explicit replacement confirmation after validation.

Writes report success only after IndexedDB transaction completion. Concurrent
tabs use revision checks; errors do not silently fall back to memory.
The offline cache is not a backup of training data.

## Non-negotiables

- No backend, auth, remote assets, telemetry, or subscription gates.
- Pure deterministic TypeScript engine, zero runtime packages, no `src` imports.
  Oxlint rules and executable boundary tests enforce this. An isolated TypeScript
  configuration excludes browser and Node globals from production engine code.
- No ACWR or disguised equivalents:
  [decision 0003](docs/decisions/0003-no-acwr.md).
- No streaks, badges, or rest-punishing gamification.
- The app is complete without a model. A future optional LLM may explain, parse
  text for confirmation, or suggest non-prescriptive content; it must never
  control loads, duration, placement, or safety.

Native Node tests cover the engine, safety, dates, schema migration, backups,
storage transactions, and offline caching. CI runs lint, tests, and a typed
production build. No test framework or runtime database dependency is needed.

The MIT license permanently grants use/modification rights to these releases.
It does not restrict what third parties may charge for their own forks.
