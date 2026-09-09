# Hybrid Coach

The marketing site for Hybrid Coach, a project for people who run and lift.

## Current status

This checkout includes the marketing site and the current Hybrid Coach MVP.
Today the planner is browser-local and focused on manual week planning,
flexible aerobic/strength/mobility work, optional club training, weekly review,
and a vendor-neutral AI copy/paste JSON loop. Direct provider API integration
is future work.

The marketing homepage, guides, approach page, privacy page, planner entry
point, and brand assets remain in this repo.

## Guided setup

The AI path has four screens: **Goal**, **Your week**, **Equipment**, and **Ready**.
Training tiles reveal frequency sliders and preferred days; aerobic activities
use one optional free-text field. Strength programming stays in the AI conversation.
Equipment presets list their contents, with individual toggles and custom additions.
Optional club cards ask only for a day, time, and short description. They appear as
timetable reminders without inventing a workout category or duration; older detailed
club workouts remain supported. Drafts save locally, and finishing creates the
copyable AI brief directly. Manual planning does not require setup.

## Training and feedback

Approve an AI preview with **Looks good - take me to my week** to save it and open
the planner. Warm-up and cool-down cards show instructions without requesting extra
data. Main exercise cards show planned targets separately from recorded weights,
sets, reps, and comments. Previously recorded warm-up/cool-down data remains available.
Use **Save log** to keep progress in the browser. Pending valid logs are also saved
before moving sessions or generating the next-week brief. Saving one workout does
not discard edits on another. Unmarked exercises stay unknown rather than being
counted as completed; week-two prompts include the original plan and actual feedback.

## Development

Use Node.js 24 or later.

```sh
npm ci
npm run dev
```

The existing checks are:

```sh
npm run lint
npm test
npm run build
```

`npm run preview` serves the production output locally.

## Site structure

- [scripts/marketing.ts](scripts/marketing.ts) renders the public pages, metadata,
  sitemap, and 404 page.
- [scripts/marketing-content.ts](scripts/marketing-content.ts) contains the guides.
- [public/](public/) contains shared styling, branding, and static host rules.
- [app/index.html](app/index.html) loads the browser-local planner entry point.
- [src/](src/) contains the planner shell, local data contracts, storage, and
  AI handoff code.
- [vite.config.ts](vite.config.ts) serves the site during development and writes
  the marketing HTML during the build.
- [tests/](tests/) covers marketing content, navigation, planner contracts, and
  browser-local data behavior.

## Static hosting

Build with `npm run build` and publish `dist` to the existing static host. The
Cloudflare Pages build command and output directory remain unchanged. No backend,
credentials, or environment variables are required. For a subdirectory deployment,
build with an explicit base, for example `npm run build -- --base=/preview/`.

Keep [public/sw.js](public/sw.js) available at its existing URL. It is a retirement
worker for older installs, not part of the current MVP flow: when an existing
browser registration updates online, it removes only that registration's old
planner asset caches and unregisters itself. It has no fetch handler and is not
registered by the current site.

The current MVP keeps records in the browser. There is no application backend,
automatic cloud sync, or direct AI provider API integration. Existing backups
remain the user's files.

MIT licensed. See [LICENSE](LICENSE).
