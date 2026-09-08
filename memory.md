# Hybrid Coach: project memory

Last updated: 2026-09-08.

This captures the product decisions and preferences established in the conversation,
not a verbatim transcript. Later decisions supersede earlier experiments. Consult
[README.md](README.md), the decision records and current code for implementation
details; the release snapshot below is historical, not a live deployment check.

## Project identity and purpose

- **Product:** Hybrid Coach.
- **Repository:** [ck-sec/hybrid-planner](https://github.com/ck-sec/hybrid-planner).
- **Website:** [hybridcoach.ai](https://hybridcoach.ai/).
- **Planner:** [hybridcoach.ai/app/](https://hybridcoach.ai/app/).
- This is the separate `hybrid-planner` project, not the older
  `hybrid-coach-product` subscription application. Do not bring its FastAPI,
  database server, authentication or billing architecture into this product.
- An open-source, local-first planner for people who run and lift, with room for
  their other sports and real-life commitments in the same week.
- The central value is an **open, auditable programming engine**, not another
  logbook or a paid AI wrapper. The user's motivating gap was that hybrid planning
  is usually closed/subscription-based while open alternatives focus on logging.
- Free forever and MIT licensed. Optional third-party AI may have its own costs.

## Delivery preference

- On 2026-09-08 the user set a standing instruction: **always push completed
  changes to production** after the relevant checks pass. Do not stop at local
  implementation unless the user explicitly requests that or a blocker prevents
  safe publication. Use the existing `hybrid-planner` Pages Git integration,
  verify the live release, and record the work here.

## Non-negotiables

Violating these is a product bug, even when the code otherwise works.

1. **No application backend.** Static SPA plus IndexedDB. No accounts,
   authentication, app server, environment configuration, telemetry or error
   reporting. Static hosting is delivery infrastructure, not a training-data service.
2. **Deterministic engine and checks.** The same complete inputs, including an
   explicitly submitted candidate week, produce the same result. No hidden
   clock or random choice may alter validation or scheduling.
3. **AI proposes; the app checks; the user approves.** On 2026-09-07 the user
   explicitly replaced the previous exercises-only AI boundary. AI may propose
   complete weeks, including quantities and placements. The later clarification
   makes the app a harness: **AI and the user decide training frequency, volume,
   rest and recovery**, including two-a-days and progression above reported
   training. Training-policy checks are advisory for newly approved AI weeks.
   Malformed data, unavailable equipment and rewriting recorded work remain
   blocked. AI cannot invent profiles, coefficients, facts or approvals. Passing
   data checks is not medical clearance. Built-in generation remains conservative.
4. **The whole app works without AI.** Planning, custom exercises, logging,
   review, backups and starting again must not require an API key.
5. **Engine independence.** [engine/](engine/) is pure TypeScript with zero
   runtime dependencies and no imports from [src/](src/). Enforce this boundary
   through linting and tests.
6. **No ACWR**, including disguised readiness or injury-risk gauges. See
   [decision 0003](docs/decisions/0003-no-acwr.md).
7. **No streaks, badges or rest-punishing gamification.** If milestones are added,
   they must not reset or become breakable through illness or rest.
8. **Checks are separate from scoring.** The built-in optimiser retains its
   independent training-policy floor. New AI weeks use explicitly versioned
   advisory training checks; hard integrity checks cannot be traded away.
   Existing stored weeks retain their original policy rather than changing silently.

## What problem the app solves

Useful AI training conversations are not a reliable training record:

- Exercise decisions, cues and revisions get buried in long chat threads.
- A new conversation needs the goal, routine and equipment context again.
- Equipment mentioned earlier can be missed; users should not have to scroll to
  rediscover which gym equipment they actually have.
- A suggested workout is not evidence that it happened. Actual sets, weights,
  interruptions and skips need structured records.
- Access to a cloud chat is not a substitute for an offline workout and logbook.
- Personal training notes and health flags should not be uploaded merely to use
  the planner.

The app keeps the structured record locally. AI is an optional conversation
partner supplied with a current, previewable brief. It does not automatically
remember app changes or synchronise an external conversation.

## UX and visual preferences

- Lean, polished, mobile-friendly and goal-first. Avoid cluttered technical forms,
  walls of configuration, repeated questions and extra import/export stages.
- Use a short sequential flow with optional detail disclosed when useful.
- Collect relevant context once, then offer AI at the final review, not as an
  interruption before the routine is complete.
- AI conversations should use ordinary coaching language. Schema keys, technical
  limits and date-handling internals belong in the final transfer format, not in
  every conversational answer.
- Keep exercise cards and the current week easy to find without revisiting chat.
- Do not turn the user's example sport into the product's default. Standard
  equipment, imagery, examples and marketing should remain sport-neutral.
- Keep the established cream/lapis palette, restrained plum accents and readable
  typography rather than returning to the initial utilitarian form-heavy design.
- Prefer one short instruction at the relevant decision over repeated disclaimers
  on every card. Keep actual-versus-planned distinctions, pain warnings and required
  consents visible. Group secondary edit, reorder and management controls.
- Use ordinary words such as week, workout, exercise and notes. Technical protocol
  wording can stay in the exact brief and optional explanations.
- The 2026-09-07 simplification pass changes copy and disclosure, not the approval
  contract. Larger merged-review or focused-workout flows remain recommendations,
  not approved replacements for the current process.

## Agreed planning workflow

1. **Goal:** free-text intent, with an optional explicit event date. Without an
   event, show a 12-week progress review rather than inventing one.
   The user chose any-day starts with rolling seven-day periods on 2026-09-08:
   a Wednesday start means Wednesday-Tuesday, then the next Wednesday-Tuesday.
2. **Routine:** desired running/lifting frequency and average session lengths, confirmed
   equipment and space, optional availability and fixed practices. Desired amounts
   are never treated as observed training. Optional Garmin CSV history provides
   evidence; gaps, comfort and unrecorded training still require confirmation.
   Club training must be clearly discoverable and collected before AI handover;
   include its days, start time and duration in both the brief and the weekly
   time/load constraints rather than adding it on top of the proposed plan.
   Use four sliders: runs/lifts per week (0-14) and average minutes per run/lift
   (0-180), with a live weekly calculation such as 30 min x 2 = 60 min/week.
   An average is not a per-session ceiling: a long run can be longer, and its
   day is for the user and AI to choose, not a mandatory weekend rule.
   Remove the redundant "Other session lengths" panel. These preferences must
   support actual higher-frequency AI weeks, not just record aspirations.
3. **Review & build:** external chat is the recommended optional assessment route.
   It gathers reported current training before proposing a week. The local
   assessment and built-in planner work without AI. Review reported facts and
   prescriptions, run app checks, then explicitly approve.
4. **Train and record:** use the local calendar and exercise cards; record actual
   work, partial sessions and skips honestly.
5. **Review the week:** use recorded actuals locally or explicitly share a scoped
   brief with AI. Carry the goal, baseline and approved direction forward; review
   the proposed next week rather than restarting the entire plan each time.
   A not-yet-approved revision must not erase the already-confirmed baseline.
   Without another AI reply, preview and explicitly approve a repeat of the
   originally approved AI pattern with new dates and identities. Do not silently
   switch to built-in quantities or turn a this-week skip, move or swap into a
   permanent template change. Future-preference notes remain context for review.

Other sports belong in the same week as fixed practices or activities. This does
not mean the app currently generates a complete coaching programme for every sport.

## Equipment and custom exercises

- Equipment is a core input across built-in planning, chat briefs and API requests.
- Offer simple editable equipment shortcuts plus custom resources/capabilities.
  A barbell does not imply a rack, bench or complete gym.
- Owning a rower, bike or SkiErg does not establish a conditioning baseline or
  authorise replacing running. Modality-specific work needs its own confirmed input.
- A fixed library alone was not sufficient. **Manual entry and AI must both be
  able to create real custom exercises**, not only reference comments.
- Each custom exercise has its own identity, name, equipment requirements,
  description, focus and reason for inclusion, linked to a supported engine profile.
- The profile owns units, execution constraints and scheduling costs.
  Training dose limits are advice in the new AI policy; technical format bounds
  remain enforced. AI can propose quantities within that contract. An unknown
  profile is rejected, not treated as free or zero-cost work.
- Human review is required before applying AI-proposed custom movements. Approval
  is not a claim of safe technique, medical clearance or proven sport transfer.
- Slow lowering, controlled repetitions and fast concentric intent can require
  different supported identities. Changing prose does not change the prescription.
  Fast intent is not permission to generate ballistic or unfamiliar high-skill work.
- Custom definitions are immutable under their IDs. Changed definitions need new
  IDs; weights and logs must not be borrowed from a different movement or variant.
- Personal reference cards remain separate from scheduled exercises.
- Mobility/mobilisation belongs in **both AI and built-in plans**. New built-in
  selections include a supported timed mobility exercise in the A/B rotation
  when confirmed equipment and space allow it,
  without forcing it back into explicitly edited selections or changing saved
  weeks. AI setup and weekly-review prompts request real scheduled mobility
  blocks with catalog/custom identities, units and doses, not notes alone.
  AI and the user choose appropriate placement and amounts; do not add a new
  mandatory training veto. Recorded mobility seconds and feedback carry into
  weekly review; custom mobility must fit the supported timed profile.
- Four to seven exercises is the built-in A/B template policy, not a universal
  conversation or authored-week limit. Authored weeks must support more than
  seven identities, including real custom strength, mobility and supported drill
  cards. Technical storage bounds are not recommended training quantities or a
  restriction on the number of ideas discussed in chat.

## AI modes and import contract

- **Built-in:** complete functionality without a model.
- **External chat:** preview and copy one brief, discuss in the user's
  chosen chat, then paste its final reply and review it in native UI.
  No file round trip is needed for every conversational turn. Recommend this
  route and link ChatGPT, Claude and privacy-focused Duck.ai, noting free usage
  limits and external-provider privacy policies without promising anonymity.
- The latest simplification is **copy/paste only** for chatbot handover: no
  download-brief or upload-reply controls. Keep the readable brief preview as a
  manual-copy fallback. Garmin CSV history upload and campaign backups are separate.
- On 2026-09-08 the user imposed a hard outgoing limit: **every send must be
  below 16,000 characters**, without oversized or split-message exceptions.
  Do not paste the full exercise library. AI chooses suitable exercises and
  supplies new real definitions using compact supported categories; existing
  references are for identity/history, not an obligatory exercise menu.
  Summarize large weekly logs and Garmin evidence with explicit omissions;
  preserve exact records locally and show the copied character count.
- Do not surface a separate rower/SkiErg conditioning-baseline setup in the routine
  flow. Preserve compatibility with previously saved equipment and conditioning data.
- **API:** a compatible endpoint uses the same brief, reply contract and validation.
  Configuration lasts for the open tab; each send is explicit.
- Continue the same chat or switch providers by supplying a fresh brief when the
  app context changes. Stale replies must not apply against changed context.
- The full-week transfer envelope is `hybrid-coach-reply` version 3, with compatible
  version 1/2 exercise-only imports. It is not a campaign backup. Full proposals
  stage separately from saved weeks and must pass an explicit checked preview.
- Exercise proposals, custom definitions and reference cards remain structured
  and strictly validated. Apply revalidates; AI cannot approve itself.
- A valid explanatory summary longer than 1,200 characters is shortened with a
  visible notice rather than blocking the whole reply. Validate the full original
  for HTML/control characters before shortening. Do not truncate exercise proposals.
- Confirmed weighted equipment names can appear in reference notes without being
  mistaken for a new prescribed load. Authored quantities belong in the structured
  week contract, not ambiguous instructions hidden in descriptive card text.

## Actuals, history and fresh starts

- Suggested or prefilled values are not completed training.
- Completed, partial, unlogged, removed and skipped sessions are distinct.
  Missing actuals remain unknown, even if a session was marked completed.
- Time skips do not imply fatigue. Fatigue skips reduce optional built-in work;
  AI weeks retain that feedback for review without silently changing approved
  quantities. Neither should create catch-up work or rewrite recorded history.
- Changes approved at weekly review affect the next week only. Midweek swaps are
  explicitly allowed for unperformed work: default to this session, with future
  preference separate. Preserve logged sets, their movement identities and the
  original prescription/change record; recheck the remaining work and never
  borrow a different exercise's weight. A swap cannot erase a pain report.
  Legacy/built-in holds retain their policy; new AI weeks keep health warnings
  visible without treating them as automatic planning or logging vetoes.
- Recheck edits against recorded actuals, including duration and quantity overruns,
  not just the original plan. Honest overrun logs remain savable; flag conflicts
  rather than rejecting or rewriting the record. Deleted optional work frees its
  slot, but its identity and prescription remain in retained history.
- Keep feedback lightweight and useful: confirmed actual sets/weights, actual
  duration, optional distance/average HR, easier/as-expected/harder and an honest
  early-finish outcome. Do not infer numerical RPE from a three-choice feeling.
  Explain which feedback informed the next proposal; do not force progression.
- The user explicitly chose to **keep logged workouts when scrapping a plan**.
- **Settings -> Start a new plan** requires confirmation, offers a backup, ends
  the active calendar and opens prefilled setup. Previous records remain read-only
  and accessible during setup as well as after building.
- Reconfirm the current baseline; do not automatically copy old observed weights
  or treat restarting as medical clearance. Previous-plan records are not
  automatically added to a new AI brief.
- The old planner/archive UI was deliberately removed. Preserve legacy stored data
  and compatibility code needed for old contracts; do not resurrect the retired UI.
- Current campaign history is not the removed archive.

## Privacy and storage

- IndexedDB is the source of saved training data; saves succeed only after the
  transaction commits. Revision checks protect against cross-tab overwrites.
- API credentials stay in tab memory, not IndexedDB, exports or backups. Never
  include real keys in fixtures, screenshots, accessibility captures or source.
- Browser verification should use synthetic data and mocked provider responses.
  A masked input is not sufficient evidence that a key cannot be exposed.
- Setup briefs omit app workout logs. Confirmed Garmin history can be included
  through a separate explicit sharing choice; omit source files, activity titles,
  locations and prior-plan records. Explicit weekly-review briefs can contain that
  week's actuals, notes, swaps and health flags; show exactly what will be shared.
- No automatic AI requests, hidden uploads, cloud sync or recovery.
- Offline use requires the first successful online load and confirmed activation
  of the offline copy. Remote AI still needs connectivity.
- Browser/origin-specific storage can be cleared, evicted or lost. Keep local
  backups; the offline app cache is not a training-data backup.
- Do not claim that nothing ever leaves the device: static hosting handles request
  metadata, and chosen AI providers receive explicitly shared information under
  their own policies.

## Marketing decisions

- The headline must lead with training, not AI or privacy:
  **"Running and lifting. One plan that fits."**
- Immediately broaden it with **"And room for the other sports you love."**
- Core idea: runs, lifts and practices in one week, not competing schedules.
- Keep the neutral sample calendar, including an additional sport's practice.
  No sport-specific hero illustration.
- Retain the explanation underneath:
  **"A chat can help you think. It isn't your training record."**
- Explain lost chat context, repeated equipment information, suggested versus
  completed work, offline access and privacy before detailing the setup workflow.
- Data ownership remains an important supporting message:
  **"Your data. Your workouts. Stay yours."**
- Describe actual support honestly. "Room for other sports" is not a promise of
  expert programming for every activity or guaranteed injury prevention.

## Technical map and verification

- React + TypeScript + Vite static SPA; Node 24+ for development and native tests.
- [engine/](engine/): deterministic planning, profiles, safety, versioned libraries.
- [src/campaign/](src/campaign/): current app, setup, local persistence and history.
- [handoff.ts](src/campaign/handoff.ts): shared chat/API contract and validation.
- [CoachingWorkbench.tsx](src/campaign/CoachingWorkbench.tsx): optional AI workflow.
- [custom-exercises.ts](src/campaign/custom-exercises.ts): custom definitions.
- [week-review.ts](src/campaign/week-review.ts): scoped actuals for weekly review.
- [plan-history.ts](src/campaign/plan-history.ts): restart and retained records.
- [scripts/marketing.ts](scripts/marketing.ts) and
  [public/marketing.css](public/marketing.css): public website.
- Keep [social-card.svg](public/social-card.svg) and its PNG rendering in sync.
- Existing checks: `npm test`, `npm run lint`, `npm run build`. Use focused tests
  for changed behaviour and browser checks for real workflows, mobile layout,
  persistence and offline operation where relevant.
- Existing deployment uses Git-integrated Cloudflare Pages. The public website
  is `/`; the private local workspace is `/app/`. Previews and production have
  separate browser storage. Test a preview before publishing and verify the live
  outcome before saying a change is live.

## Current boundaries and historical checks

- The built-in planner remains baseline-bounded. AI/user-approved training uses
  advisory training policies, not automatic progression or medical clearance.
- Physiological model calibration is off. Scheduling costs are engineering
  estimates, not measured readiness or validated injury-risk predictions. See
  [decision 0004](docs/decisions/0004-model-estimates-and-safety.md).
- Garmin activity-summary CSV import is implemented for English/German exports.
  It is not XLS, FIT import or a Garmin account connection. It can establish
  recorded dates, types, duration, distance and HR, not exercise-level lifting
  sets/weights or comfort/readiness. Use synthetic fixtures, not personal exports.
  Historical files are not automatically current baselines; reimports must not
  duplicate records. Garmin FIT and Apple Health imports remain outside this work.
- The previous release verified on **2026-09-06**, commit **`da82850`**, included:
  restored training headline, room for other sports, AI-context explanation,
  privacy-first positioning, plan restart with history, and AI import recovery.
- That release passed CI, marketing tests, lint/build and desktop/mobile checks.
  Treat these as a dated checkpoint, not proof about future changes.
- On 2026-09-07 the user approved implementation of the expanded training,
  Garmin evidence, authored-week handover, feedback and midweek-swap workflow.
  The release snapshot above predates that work; verify current implementation
  and validation results rather than treating this decision record as a release.
- The initial baseline-bounded authored policy is superseded for newly approved
  AI weeks by the later advisory decision above. App-owned workload profiles and
  hard data-integrity checks remain. Initial or novel
  exercise weights are not guessed. Existing saved baselines and API/backups remain
  compatible. Midweek swaps use already supported, equipped library identities
  with matching movement/execution and logging units; introducing a new definition
  belongs in setup or a next-week revision. Recorded timed totals cannot be split
  into guessed remaining work.
- On 2026-09-08 the user removed throwing-specific setup and new drill generation.
  Keep **generic fixed club sessions** to account for their time and load.
  Retain legacy throwing records/restoration, but do not invite new throwing
  definitions or replace club sessions with AI-generated practice drills.
- Local verification of the slider/advisory changes on 2026-09-07: **578 tests
  passed**, lint and production build passed. Browser checks covered 30 x 2 = 60,
  90/120-minute sliders, 14-session preferences, a 14-run/seven-day week with a
  longer run, approval/reload and unchanged next-week repetition. Reported
  training stayed separate from desired/planned totals. Mobile and desktop had
  no horizontal overflow. Isolated synthetic records were removed afterward.
  These were pre-release checks; the live release is recorded below.
- Local mobility verification on 2026-09-07: **153 targeted tests passed**,
  including built-in selection, AI/API handover, timed actuals, weekly review,
  repetition and saved-plan compatibility. Lint and production build passed.
  Browser checks confirmed the named mobility workout card, a 35-second actual
  surviving reload independently of its 30-second prescription, and no horizontal
  overflow at 390px. The isolated synthetic record was removed. These were
  pre-release checks.

## Work completed on 2026-09-07

- Reworked setup around desired runs/lifts and average duration, using four
  sliders and live weekly totals. Current training is reported separately;
  aspirations and imported activity summaries do not become invented baselines.
- Added local Garmin CSV evidence import with explicit units, sanitisation,
  duplicate/conflict checks and separate consent before sharing it with AI.
  Made club/fixed training days, times and durations available before handover.
- Implemented version-3 full-week AI handover, including real custom strength,
  timed mobility and supported throwing-drill identities, quantities and dates.
  Chat and API share validation, checked preview and explicit approval; older
  exercise-only replies remain supported.
- Made training-policy rules advisory for newly approved AI weeks, including
  high-frequency/two-a-day plans and long runs above the chosen average. Hard
  checks still protect valid data, equipment, fixed commitments and recorded
  work. Built-in and previously saved policies retain their intended behaviour.
- Added lightweight workout feedback and scoped next-week review. Without a new
  AI reply, the next-week preview repeats the originally approved pattern rather
  than silently reverting to built-in programming.
- Added reviewed midweek swaps for unperformed work, with this-session scope
  separate from future preferences. Actuals, identity-specific weights, partial
  work, overruns, skipped sessions and retained history are preserved.
- Simplified public-site, setup, AI, exercise-card and weekly-review messaging.
  External chat is the recommended optional route, with ChatGPT, Claude and
  Duck.ai links. Removed brief download/reply upload and separate rower/SkiErg
  baseline controls without removing equipment or saved-data support.
- Included mobilisation in new built-in A/B selections and AI setup/weekly
  prompts. Real timed cards can be logged and reviewed; existing approved weeks
  and explicitly edited selections are not rewritten.
- Corrected shared preview titles, repeated-advice display, exact conditioning
  equipment projection, repeated fixed-practice matching and swap validation
  after actual-set overruns. Release CI also caught the mobility default forcing
  unavailable floor-space exercises; it now uses the existing capability check
  without blocking otherwise equipped routines or assuming unconfirmed space.
- Updated the README and this memory, then published through the existing
  Git-integrated Cloudflare Pages release path after preview and CI validation.

## Verified live release on 2026-09-07

- Application release: [`24d339d`](https://github.com/ck-sec/hybrid-planner/commit/24d339df7e2827f85b45f6d8e7b0f87f2ad1467e),
  including the main implementation in `fb34391` and the equipment-compatible
  mobility correction. Fast-forwarded and pushed to `main`; no force push.
- [Hosted preview](https://e91a2e2c.hybrid-planner.pages.dev/app/) passed before
  production: working goal/routine flow, exact weekly slider totals, the named
  mobility selection and mobilisation instructions in the shared AI brief.
  Only the verified synthetic preview draft was removed afterward.
- [Release CI](https://github.com/ck-sec/hybrid-planner/actions/runs/34149820476)
  passed **584 tests, zero failures/skips**, lint and production build.
  [Production-branch CI](https://github.com/ck-sec/hybrid-planner/actions/runs/34150080976)
  also passed.
- Cloudflare Pages production deployment
  [`854c16a4`](https://854c16a4.hybrid-planner.pages.dev) succeeded at
  **18:04:09 UTC / 20:04:09 CEST** for that exact application commit.
- Verified HTTP 200 at [the public site](https://hybridcoach.ai/) and
  [the planner](https://hybridcoach.ai/app/). Production serves
  `index-DtK0L-XF.js`, matching the tested local build byte-for-byte
  (SHA-256 `a5671f9f7acfeb353acd3e3d72c1cb171f7b07d199d94863838f4b5c57c6f730`).
  The live browser loaded that bundle with an active service worker.
- Existing non-blocking warnings remain: the application bundle exceeds Vite's
  chunk-size warning threshold, and GitHub reports legacy declared action
  runtimes while running them on Node 24. No hosting configuration or secrets
  were changed, and no existing user training records were cleared.
- This is a dated deployment receipt for the application release. Documentation-
  only follow-up commits can advance `main` without changing the application
  bundle; recheck the actual production commit before future releases.

## Implemented and verified locally on 2026-09-08

- **Any-day starts:** setup and restart default to local today. Built-in and
  AI-authored weeks roll forward in seven-day periods; availability, club
  sessions, calendar labels, moving sessions and next-week handovers use actual
  weekdays. Tests cover all seven starts. Saved Monday plans and actuals retain
  their original dates and identities.
- **Generic club training only for new planning:** removed controlled-throwing
  setup/revision controls. New AI replies cannot introduce sport drills or
  replace fixed practices. Legacy saved throwing work remains readable and
  loggable. Generic-week screens no longer display the irrelevant old throwing
  feature explanation; stored warnings and real health reports are unchanged.
- **Strict compact handover:** clipboard and API routes share a compact builder
  with a hard 15,999-character budget, including the API's reply-request prefix.
  The preview is the copied text and displays its exact character count. No
  full library, raw activity dump or split-message exception is sent. If
  essential context cannot fit, an explicit error prevents sending.
- AI chooses exercises and mobilisation within supported execution profiles,
  using structured custom definitions rather than a fixed library menu.
  Compact current references preserve reusable identities; a collision-free
  prefix supports new definitions without listing all saved IDs. A regression
  approves 12 AI-chosen mobility definitions, logs one and restores them.
- Opt-in Garmin history and weekly logs become bounded summaries with explicit
  unknowns, missing values and omission counts. Planned versus actual work,
  early finishes, timed mobility, reported pain and holds stay distinct.
  Full records remain local, and complete-state fingerprints still invalidate
  stale replies. Large-fixture sizes: setup 12,748 copied / 12,830 API content;
  weekly review 13,130 copied / 13,212 API content characters.
- **Verification:** final full suite passed **617 tests, zero failures/skips**;
  lint, TypeScript/production build and diff whitespace checks passed.
  The existing non-blocking bundle-size warning remains.
- Browser verification: Wednesday September 9-15 and September 16-22 periods,
  club sessions on both Wednesdays, successful clipboard copy (8,766 characters),
  next-week brief (11,472 characters), approval/reload persistence, actual
  35-second mobility work without invented lifting sets, and no horizontal page
  overflow at 390px. Removed only the verified synthetic test campaign.
- Production publication was requested after local verification. The September 7
  receipt remains historical; the September 8 live receipt is recorded separately
  after verifying the deployed release.

## Verified live release on 2026-09-08

- Application commit: [`86e590f`](https://github.com/ck-sec/hybrid-planner/commit/86e590f1874df7db78108f99f47e17fc0f8dc81e).
  Pushed a release branch, verified the hosted preview and CI, then fast-forwarded
  `main` and pushed without force.
- [Release CI](https://github.com/ck-sec/hybrid-planner/actions/runs/34202013706)
  passed lint, tests and production build. Local verification passed all 617 tests.
- [Production-branch CI](https://github.com/ck-sec/hybrid-planner/actions/runs/34202340008)
  also passed all 617 tests with zero failures or skips.
- [Hosted preview](https://eff69b4e.hybrid-planner.pages.dev/app/) served the
  validated bundle byte-for-byte. Browser checks confirmed the today default,
  a Wednesday start, the fixed Wednesday club session, no throwing control and
  an 8,768-character AI brief without the full exercise library. Only the verified
  synthetic preview draft was removed.
- Cloudflare Pages production deployment
  [`e764e3f5`](https://e764e3f5.hybrid-planner.pages.dev) succeeded at
  **08:02:55 UTC / 10:02:55 CEST** for the exact application commit.
- After deployment completed, verified HTTP 200 at
  [the public site](https://hybridcoach.ai/), [the planner](https://hybridcoach.ai/app/)
  and the application asset. Live `index-b4T-s9Se.js` matches the tested local build
  (SHA-256 `cb8d9295f6b0f2e22763babf13d0494d142eb04d196b12518cb9302d6f5127a3`).
  The live browser loaded that bundle with an active service worker.
- The user's standing production-delivery preference is saved above. Existing
  training records, hosting settings and secrets were not changed by publication.
  This receipt identifies the application release; documentation-only follow-ups
  can advance `main` without changing its application bundle.
