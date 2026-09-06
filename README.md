# Hybrid Coach

An open, local-first training planner for people who run and lift.
MIT licensed, no subscription, no accounts, no backend, no telemetry, no error
reporting, or environment configuration. Training data is saved in the browser's
IndexedDB. No LLM or API key is required, including for manual custom exercises.
Optional AI at the final setup review or an explicit end-of-week review can
interpret a goal, propose real custom exercises and explain a next-week selection.
Sharing a weekly review is an explicit choice and includes that week's recorded
training details; nothing is sent automatically.

This README describes the source in this checkout, not a deployment announcement.

## Mobile campaign workspace

Setup has three steps, with no AI detour before the routine is complete:

1. **Goal:** write what you want to work toward. An event date is optional;
   without one, the app uses a clearly shown 12-week progress review. It does not
   infer a date from the wording of your goal.
2. **Routine:** enter recent comfortable running/lifting session lengths and
   frequency, confirm equipment and space, and optionally adjust availability
   or fixed sessions. Weekly running minutes come from a usual run and runs per
   week; you do not need to calculate totals.
3. **Review & build:** inspect the goal, routine and exercise lineup. Keep the
   built-in recommendations, create a custom exercise manually, or optionally
   use the AI workspace here. Review any changes before building the first week.

Equipment shortcuts remain editable. Racks, benches and pull-up bars are
explicit capabilities; owning a barbell does not imply a complete gym. Confirmed
resources accompany any shared brief. Cardio equipment does not imply a new
conditioning baseline or an unsupported substitution for running.

Exercise cards are recommended for the selected equipment, with compatible
same-pattern swaps. They are explicitly recommendations, **not invented historical
observations**. No previous weights, sets, RPE ratings or exercise dates are
required for this path. The engine prescribes a conservative first exposure;
kilograms remain unset until the athlete finds and logs their own weight.
Built-in or approved custom exercises can be selected before committing the block.
Custom definitions have their own identities and logs; they are not merely renamed
library exercises. Personal reference cards remain separate notes and do not
change an exercise's identity or prescription.

Any example is sample data, not a personal prescription. Confirm your own
event/review date and recent running and lifting before building a campaign.

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
- Review the week before confirming the next one. Recorded actuals, partial work,
  time/fatigue skips, removed sessions and unlogged sessions remain distinct.
  Optional AI can discuss this review and propose the next selection; the engine
  owns adaptation and scheduling. Previous weeks become read-only; finish an
  in-progress session before advancing. Unknown actuals are not completed work.
- Campaign data uses the IndexedDB database `hybrid-planner-campaign`.
  The retired planner and archive screens have been removed, not their stored data:
  the old on-device database and any backup files are left untouched. There is no
  old-planner UI, migration or import of its backups into a campaign. Bookmarks
  using `/app/?view=legacy` now open the current campaign and ignore `view`.
- Export and restore campaign JSON backups through settings. A revision check
  prevents cross-tab overwrites. Previous weeks within a campaign remain available
  read-only in History; they are not the removed planner archive.
- **Settings → Start a new plan** ends the active plan after confirmation and
  opens Goal → Routine → Review again. Logged workouts, partial work and skips
  remain read-only in Training history, accessible even during the new setup.
  Unlogged workouts are not marked complete. Goal, equipment and routine are
  prefilled, but the new baseline must be confirmed; observed weights are not
  copied into a new baseline. Starting over is not medical clearance.
- Backups include retained plans and their original exercise definitions, logs,
  notes and unsubmitted input. Up to 100 previous plans can be retained locally;
  the app never silently removes the oldest plan. Restore accepts backups up to
  50 MB. Prior-plan records are not automatically shared with AI or used as
  observations in a newly confirmed baseline.

**Current boundaries:** this remains an established-baseline supporting plan,
not a complete event progression system. Goal priorities influence
scheduling and curated content; they do not justify invented sport-specific
workloads. Garmin FIT and Apple Health activity import are not implemented.
There is no Garmin account connection.

### Built-in and real custom exercises

Confirm equipment during setup to use the expanded library automatically.
An unfinished draft from an older release asks for equipment confirmation inside
the AI workspace before sharing a new brief. Existing campaigns retain their old
prescriptions: use the explicit weekly review to propose a future selection.
The library includes
kettlebell movements, carries, mobility and supported execution variants.
Choose four to seven equipped exercises; complementary A/B sessions cover the
selected pool rather than repeating the same bundle. Unavailable movements are
excluded, and excessive work is omitted rather than forced past the safety floor.
The four-to-seven limit is the active routine size, not the library size. The
coaching workspace shows how many movements match the confirmed equipment.

Each exercise has **How, focus & why** guidance and editable personal notes.
Controlled repetitions, slow lowering and fast concentric intent use distinct
supported identities and engine prescriptions. Fast intent is not a jump or
ballistic lift. Changing prose never changes execution or dose; a new variant
does not inherit another variant's working weight.

Repetitions use per-set logs. Carries and mobility use seconds, with optional
kilograms for carries. Actual overruns and extra sets already performed can be
recorded honestly: they are flagged separately, not turned into higher prescriptions
or successful calibration. Established rower, bike and SkiErg routines require explicit
modality-specific baselines and matching equipment; they do not erase or duplicate
the existing running baseline. No conditioning is inferred from owning equipment.

**Create an exercise** works without AI. Supply its name, description, focus,
purpose and actual equipment requirements, then choose a supported movement
profile and acknowledge the technique/profile fit. An AI reply can propose the
same kind of real definition, but cannot approve it on your behalf. A supported,
approved definition can enter the selected routine and receive engine-generated
prescriptions and its own actual logs.

The engine profile owns execution style, units, conservative scheduling costs
and dose limits. Neither manual prose nor AI can override sets, repetitions,
seconds, weights, effort targets, costs, baseline volume or calendar placement.
An unknown or incompatible profile is rejected, not treated as zero-cost work.
Human acknowledgement and software validation are not technique assessment,
medical clearance or proof that a new movement is safe.

Revisions preview and apply to **next week only**. Changing a custom technique
creates a new exercise identity; old IDs, prescriptions, logs and weight records
stay attached to the original definition. Library versions, recovery and fatigue
reductions remain intact. Health holds and unfinished logs cannot be bypassed.
Existing campaigns are not silently upgraded. Work outside the supported profile
contract cannot become a scheduled exercise by hiding instructions in a note.

Prescription ceilings and scheduling costs are explicit engineering policies,
not validated physiological measurements. The
[tempo review](https://pmc.ncbi.nlm.nih.gov/articles/PMC8310485/) does not establish
one universally optimal tempo or transferable safe load. The
[RIR review](https://pmc.ncbi.nlm.nih.gov/articles/PMC11127506/) does not justify
applying resistance-training RIR estimates to timed carries or throwing; those
units do not use artificial repetitions or RIR.

### One coaching workspace: built-in, API or external chat

The final **Review & build** step and explicit **weekly review** offer the same
workspace. AI is optional in both, not a prerequisite for Goal or Routine:

- **Built-in:** select compatible exercises, create custom exercises manually,
  review the week and edit local reference cards without a model or API key.
- **Use my AI chat:** copy a coaching brief or download `hybrid-coach-brief.txt`,
  give it to a chat such as Claude or ChatGPT, discuss the choices in ordinary
  language, then ask for the **final app reply**. Paste that JSON reply or upload its
  JSON/text file, review native cards, and apply. The brief asks the AI to keep
  schema keys and date-handling details out of the conversation, not the final export.
  No account integration or API key is needed. Provider upload and usage limits vary.
- **Connect API:** configure an OpenAI-compatible endpoint once per open tab.
  Explicit requests use the same instructions, versioned reply and validator as
  the manual round trip. Nothing sends automatically.

The `hybrid-coach-reply` **version-2** envelope contains a context ID, a bounded
goal/exercise proposal, `customExercises` and reference cards. `customExercises`
is an array of real profile-bound definitions; use an empty array when none are
proposed. Compatible version-1 replies remain accepted without that field.
Neither format is a campaign backup.

Overlong AI review summaries are shortened to 1,200 characters with a visible
notice instead of blocking an otherwise valid reply. Exercise proposals and
reference cards are not shortened. Equipment names such as a confirmed weighted
implement may appear in reference notes; new load, set, repetition, duration and
scheduling instructions remain rejected.
Context changes (equipment, goal, baseline, calendar, recorded work or cards) invalidate
old replies; copy a refreshed brief into the same conversation when this happens.
An external chat cannot see an app update: paste the fresh brief and ask it to
replace the earlier one if it still describes the old catalog.
Otherwise there is one export and one final import, not a file exchange every turn.
Unknown fields, duplicate JSON keys, invalid exercise/resource IDs and oversized
replies are rejected. Imports revalidate at Apply and never replace saved logs.
Matching card IDs explicitly update those cards; unrelated cards are preserved.

Write a goal such as keeping regular easy runs and strength sessions around a
busy week. At the final review, AI may help interpret the goal, suggest equipped
library exercises or author new profile-bound custom definitions. Review the
interpretation, definitions and added/removed selection before applying.
An explicitly chosen event date or the app's progress-review date remains in
the brief; AI does not replace it with a guessed date. Exercise-only requests
preserve the reviewed goal and date.

AI can author a custom movement's descriptive fields and propose a supplied
profile, but cannot supply or override quantities, costs, loads or a schedule.
The deterministic engine costs the approved selection, determines its dose
and applies the independent safety floor. Locked weeks cannot be rewritten.
A future-week review stages suggestions for explicit approval, not an automatic
change to the campaign.

### End-of-week review and explicit sharing

The weekly review compares prescribed work with **this week's recorded actuals**:
sets, repetitions, seconds, weights, duration and effort, plus notes and recorded
health flags. Partial work, overruns, time skips, fatigue skips, removals,
omissions and unlogged sessions remain distinct. Missing actuals stay unknown,
even when a session is marked completed; the prescription never fills them in.

Built-in review and next-week planning work without AI. If you choose external
chat or an API, both use **one previewable brief** containing this scoped review.
Preview it before copying, downloading or sending: notes, health flags and
recorded performance may be sensitive. AI can explain patterns and propose a
next-week exercise selection or custom definitions. The user approves the
selection; the engine handles adaptation, dose and scheduling. AI cannot
rewrite observations, diagnose symptoms or bypass health holds.

Use a local OpenAI-compatible endpoint or a remote HTTPS `/chat/completions`
endpoint. Configure it yourself and confirm the exact payload before sending.
No request occurs merely by opening a panel. Endpoint, model and API key stay in
memory throughout the open tab, including after setup: disconnect or reload to
clear them. They are never included in training data, chat briefs or backups.
The previewable brief includes the goal/date, resources, baseline session amounts,
availability/fixed sessions, selected exercise IDs, eligible catalog and profiles,
custom definitions, reference cards and relevant planned sessions. A **weekly
review** additionally includes that week's actual logs, notes and health flags
as described above. Setup sharing does not include training logs. Neither brief
exports the entire training history, raw activity files or API keys.
Copying/downloading is local; sharing with another service is your explicit action.

**Reference cards and custom exercises are different.** Reference cards are
editable notes, not executable prescriptions. Their titles, instructions and
equipment labels cannot rename an exercise, change its dose or add work. Real
custom exercises instead use the explicit profile-bound definition and approval
path above. Unsupported ideas may remain unscheduled, unverified reference
drafts; no prose filter can prove their technique safe. Neither kind of content
rewrites historical observations. Reference cards are campaign-wide, not
historical session snapshots. Manual edits, approved custom definitions and
supported campaign backups work offline; asking a remote model does not.

The browser connects directly to the chosen endpoint, with no proxy or
application backend. CORS, mixed-content and local-network restrictions still
apply; the endpoint must support browser use. A phone's `localhost` means the
phone, not a computer running a model. For another device, use an explicitly
configured HTTPS endpoint rather than expecting LAN HTTP to work. No model is
bundled, and API usage may be charged by the selected provider.

### Connection troubleshooting

- HTTP 401/403: check the key, API permissions and account access.
- HTTP 429: check the provider's quota/rate limits.
- HTTP 500/502/503: the service or gateway could not complete the request.
  A 503 does **not** establish that JSON mode or `max_completion_tokens` is wrong.
  Wait before retrying; if it persists, check provider status or select another
  model available to your account.
- HTTP 408/504, or the app's 20-second timeout: consider a faster available model.

The app never automatically retries or switches models. Failed requests do not
apply suggestions, and raw provider error bodies are deliberately not displayed
because they may contain private details.

For Google AI Studio, use Google's
[OpenAI-compatible endpoint](https://ai.google.dev/gemini-api/docs/openai):
`https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`.
Choose a model your project can access. Google's
[`gemini-3.1-flash-lite`](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)
is a documented low-latency option for classification and structured extraction,
not a guarantee of account availability or a successful live call. See Google's
[troubleshooting guidance](https://ai.google.dev/gemini-api/docs/troubleshooting).

Password masking does not hide a browser-held key from automation or every
accessibility snapshot. Use fake keys and mocked endpoints for shared automated
tests. Run real-key checks in a separate browser/profile not connected to the
automation, and share only sanitized errors, never request headers or keys.

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

The public homepage is at `/`; the campaign planner is at `/app/` on the same
origin. Existing IndexedDB records and backup files are untouched. Opening the
planner does not migrate, upload or erase data from the removed screens.

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
their query and fragment. The app ignores the retired view selector and opens
the current campaign, not the old planner. It does not inspect old training records.

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
real directory-index HTML files, not client-side routes. The app rewrite targets
the canonical `/app/`, not `/app/index.html`: Cloudflare rejects the latter as a
potential loop through its automatic extension-stripping redirect.

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
at a time. Saved weeks keep their exercise assignments; an explicit approved
revision can change the future selection without rewriting them.

- Running stays easy and relative to conversational effort; no invented pace,
  heart-rate zones, threshold tests, or intervals.
- The campaign setup keeps first-exposure templates separate from observations
  and uses its own conservative caps.
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
Exercise choices can change during setup or an approved next-week revision,
not by rewriting an already saved week.
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

Compatibility engines remain under `engine/legacy/` with auditable old-contract
tests. They do not expose a retired planner or archive screen. The current app
does not open, migrate or delete the old planner database; its records and
existing backup files remain on the device. Campaign restore accepts supported
campaign backups only. Unsupported versions and corrupt backups fail visibly.

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
- The app is complete without a model, including manual custom exercises and
  weekly review. Optional AI may explain recorded work, interpret goals or
  propose profile-bound definitions and a future selection for approval; it
  must never control quantities, costs, loads, duration, placement or safety.

Native Node tests cover the engine, safety, dates, campaign compatibility, backups,
storage transactions, and offline caching. CI runs lint, tests, and a typed
production build. No test framework or runtime database dependency is needed.

The MIT license permanently grants use/modification rights to these releases.
It does not restrict what third parties may charge for their own forks.
