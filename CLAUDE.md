# Velocity — Run Club Discovery Dashboard

## What this is
A map dashboard for discovering Dubai run clubs and one-off run events,
tagline "VelocityAE — Stay on the move." Landing page -> onboarding
(local preferences) -> map with color-coded pins. Tap a pin or list row for
details. "Run Now" surfaces everything running soon, or the closest upcoming
runs if nothing qualifies within the next few hours.

This file describes the app **as it exists today**. `PRD.md` holds the v2
product plan and `TECHNICAL.md` the schema/backend design — parts of both are
now built (see Current status), but everything backend-shaped in them is not.

The app runs in one of two modes, chosen by `config.js`:

- **Static mode** — what the live GitHub Pages site runs today. No backend:
  runs come from the JSON files, and RSVP and preferences are **localStorage
  mocks only** — nothing syncs, nothing is shared between devices, and nobody
  is asked to sign in.
- **Backend mode** — accounts and synced RSVPs on Supabase (`PRD.md` §4.8,
  §4.8b; `TECHNICAL.md` §5–6). Built, but only switched on for `localhost`,
  where it talks to the `velocity-dev` project. The live site moves to it at
  cutover (`TECHNICAL.md` §11), once there is a prod project and the Telegram
  bot writes to Supabase instead of the JSON files.

Everything below describes static mode unless it says otherwise; "Accounts
(backend mode)" covers what changes when the backend is on.

## Tech stack
- **Hosting:** GitHub Pages (static, deploys from `main` branch)
- **Map:** MapLibre GL JS v4 + OpenFreeMap vector tiles (free, no API key).
  Note the `@4` CDN tag resolves to 4.7.1, which has **no `setProjection`** —
  that's a v5+ API. `landing-map.js` attempts it in a try/catch and degrades
  to a flat zoom (see its header comment before "fixing" this).
- **Data:** `clubs.json` (recurring) + `events.json` (one-off) — flat files,
  edited via the Telegram bot (§ below) or by hand. In backend mode the app
  reads the `runs` table instead and keeps the JSON files as a fallback
- **Backend (backend mode only):** Supabase (Postgres + Auth), called straight
  from the browser with supabase-js. The SDK is loaded on demand by
  `backend.js`, so static mode never requests it
- **Frontend:** Plain HTML/CSS/JS, no framework, no build step. Scripts are
  plain `<script>` tags loaded in dependency order by `index.html`.
- **Fonts:** Bricolage Grotesque (display — wordmark, hero, panel titles,
  calendar date numerals) + Plus Jakarta Sans (body/UI), via Google Fonts.
  Referenced through `--font-display` / `--font-body` in `:root`.
- **Theme:** Light background, purple (`#6D28D9`) + lime green (`#A3E635`).
  The legal pages use a standalone `legal.css` mirroring the same tokens,
  because `style.css` locks `html`/`body` to `overflow: hidden` for the map
- **PWA:** installable to the iOS home screen — `manifest.webmanifest` plus a
  deliberately minimal `sw.js` (installability only; **no offline caching**)

## File structure
```
/
├── index.html          # Shell: landing, onboarding + install modals, run panel
├── style.css           # Theme + all component styles
├── config.js           # Which backend, if any (null = static mode). Public values only
├── backend.js          # Backend: Supabase client, sign-in, synced RSVPs, profile
├── data.js             # Velocity: data layer — load, normalize, status, prefs, RSVP, .ics
├── shared-ui.js        # SharedUI: landing, onboarding, install tutorial, run detail panel
├── auth-ui.js          # AuthUI: gated actions, sign-in sheet, account panel
├── variant-a.js        # VariantA: topbar, map, bottom sheet, Run Now, Explore — mounts the app
├── calendar.js         # Calendar: day-band calendar rendering
├── map-helpers.js      # MapHelper: MapLibre setup + marker creation
├── landing-map.js      # LandingMap: decorative animated map behind the hero
├── sw.js               # Service worker — installability only, caches nothing
├── manifest.webmanifest, icon*.png/svg
├── privacy.html, terms.html, guidelines.html   # Static legal pages (+ legal.css)
├── clubs.json          # Recurring run clubs
├── events.json         # One-off events
├── supabase/           # Schema migration, JSON→SQL seed script, SETUP.md (dashboard steps)
├── PRD.md / TECHNICAL.md   # v2 product plan + schema/backend design
├── README.md           # Public-facing project description
└── CLAUDE.md           # This file
```

The old v1 single-file app (`script.js`, Leaflet-based) was deleted once the
module split above replaced it. `PRD.md` §3 still describes it, correctly
labelled as a historical "v1 recap" — don't read that section as current.

## Data schema

The JSON files keep their original v1 field names on disk; `data.js`'s
`toRun()` normalizes them into the internal `run` shape at load time.

`clubs.json` (recurring, weekly):
```json
{
  "name": "string", "location_name": "string", "lat": 0.0, "lng": 0.0,
  "type": "social | tempo | training | long_run | pyramid",
  "surface": "track | beach | road | indoor",
  "freebies": true,
  "cost": "free | paid", "price": "string (empty unless cost is paid)",
  "day": "monday..sunday (lowercase)", "time": "HH:MM (24h)",
  "link": "url", "photos": ["url", "url", "url"],
  "notes": "string", "last_updated": "YYYY-MM-DD"
}
```

`events.json` (one-off, single date): same, but `"date": "YYYY-MM-DD"`
instead of `"day"`.

Notes:
- **`pace` is retired.** Older records still carry it and edits preserve it,
  but nothing reads it and the bot no longer asks for it.
- **`type` legacy values:** `track` (and anything unrecognised) maps to
  `training` via `mapOldTypeToKey()` in `data.js`. Known keys pass through.
  `LFG` in `clubs.json` is still `"track"` and relies on this.
- `surface` lives on the internal run as `details.surface`.
- **`cost` / `price`** — `cost` is whether you pay to take part (`free` /
  `paid`); `freebies` is separately about free things handed out on the day, so
  the two are independent. `price` only carries a value when `cost` is `paid`
  and is cleared otherwise, including on a Paid → Free edit. Both were added
  after the first records were written, so records predating them have no
  `cost`; the bot flags that on the first edit. `data.js`'s `toRun()` normalizes
  an absent or unrecognised `cost` to `null` — meaning *unknown*, never *free* —
  and `costLabel()` returns `null` for it so the detail panel omits the row
  rather than asserting anything.
- **`photos`** is optional — up to 3 image URLs. Missing/absent on older
  records (normalized to `[]` in `data.js`'s `toRun()`), which just means no
  slideshow renders. Filled in via the Telegram bot's "Photos" step (attach
  photos directly in the chat — the bot uploads them to `club-photos/` in
  this repo and stores the resulting `raw.githubusercontent.com` URL — or
  paste direct image links) or by hand; the detail panel (`shared-ui.js`:
  `openRunDetail`) crossfades between them on a timer when there are 2+.

⚠️ Hand-edits must stay valid JSON — one syntax error breaks the whole file.

## Pin visuals (`data.js`: `pinVisual`)
**Two independent layers**, not a priority chain:
- **Base color** — `one_off` → black, else training-equivalent type → red,
  else → white
- **Freebies ring** — a lime ring drawn around *any* pin when `freebies` is
  true, regardless of base color

This split exists deliberately: the old single-color priority chain meant a
one-off event that also had freebies rendered black and lost the freebies
signal entirely. Keep the two layers independent.

Only `training` carries `trainingEquivalent: true` in `CATEGORIES.running.types`,
so `tempo` / `long_run` / `pyramid` currently render as white pins.

## Preferences & filtering
- Onboarding (`OB_STEPS` in `shared-ui.js`) collects name, run type, surface,
  and freebies interest. Stored in `localStorage` under `velocity_prefs` —
  **on-device only, no account.**
- Profile (in the topbar's ⋯ menu) reopens onboarding pre-filled.
- **"Match my prefs"** chip in the bottom sheet toggles filtering by those
  answers (`matchesPrefs()` in `data.js`): type must match exactly; surface
  only constrains when the run has one set; freebies only applies if the user
  opted in. Tapping it with no saved prefs opens onboarding first and only
  activates if the user actually finishes.
- **Type filter chips** (All / Social / Tempo / Training / Long run / Pyramid
  session) filter the sheet and the map markers together.
- **"Free" chip** in the bottom sheet, beside "Match my prefs" — cost is an
  independent axis from run type, so it's an on/off toggle rather than another
  (single-select) type chip. It matches `cost === 'free'` strictly: a run with
  no cost recorded is unknown, not free, and stays out. Because no record
  predating the bot's Cost question has the field, this can legitimately empty
  the list — `emptyMessage()` in `variant-a.js` says so in as many words
  instead of showing a bare "nothing here".
- **Scope toggle** in the topbar switches This Week / This Month.

## Status logic (`data.js`: `statusOf`)
Unified for recurring and one-off. Returns `phase`: `'soon'` (within the
-60/+180 min window), `'upcoming'`, or `'expired'` (one-off already passed).

Recurring runs are always *displayed* as a standing weekly slot ("Every
Wednesday, 19:30") per PRD.md §4.6 — but `statusOf` still computes a real next
occurrence internally for sorting, Run Now, and `.ics` export. Don't remove
that math when touching the display.

Expired one-offs are filtered out of every view (`withinScope`).

## Run Now (`variant-a.js`: `handleRunNow` / `renderRunNowPanel`)
Opens a panel listing **every** non-expired option — not just the top pick.
Sorted by **closest time** by default; a "Nearest location" toggle appears
only once geolocation resolves, so distance sorting is opt-in. Falls back to
the closest upcoming runs when nothing is in the `'soon'` window.

## Other UI
- **Bottom sheet** (`#list-sheet`) — collapsed to a full-width bottom bar
  (grab pill + "All runs" label) sitting flush on the bottom edge; tap or pull
  it up to expand. Holds "All runs" + filters + the list. The collapsed peek is
  `--sheet-peek` in `style.css` and **must equal the rendered height of
  `.sheet-handle`** — when the two drifted apart, a sliver of the title row
  showed under the bar. Until the sheet has been opened once, the bar plays a
  3-cycle `sheet-nudge` bounce inviting a pull-up; opening it drops the hint
  and remembers that in `localStorage` (`velocity_sheet_hint_seen`).
- **Calendar** (⋯ → Calendar, `calendar.js`) — vertically stacked day bands in
  a fixed per-weekday pastel palette, big date numerals, runs as dark pill
  chips. Recurring runs appear on every matching weekday in range. Days with
  no runs collapse to a quiet single line. Rendered "compact" in the panel.
- **Explore** (⋯ → Explore) — locked "coming soon" chips for Yoga, Pilates,
  Badminton, Padel, Cycling, teasing the multi-category future in
  `TECHNICAL.md` §3. Nothing behind them yet.
- **Install tutorial** (`shared-ui.js`) — platform-aware, shown after
  onboarding. iOS gets an illustrated Share → Add to Home Screen walkthrough
  (Safari has no install API); Android gets a real `beforeinstallprompt`
  button; desktop is skipped. Shows every session until actually installed.
- **RSVP** — Going / Not going / Interested, per run, stored in
  `localStorage` (`velocity_rsvp_v2`). Not synced, deliberately. Interested is
  a save-for-later; "Not interested" was removed, and a stale stored value of
  it reads as no RSVP (`getRsvp` in `data.js`).
- **Add to calendar** — per-event `.ics` download (`data.js`: `downloadICS`).
  Like RSVP, it's called through `AuthUI.require()`, which in static mode just
  performs the action.
- **Open in Maps** — links straight to `google.com/maps/search/?api=1&query=lat,lng`
  using the run's existing coordinates (no new field, no bot change needed).
  Opens the native Google Maps app on a phone that has it, else the web map.

Only one UI variant exists (`variant-a.js`). Two others and a switcher were
prototyped and deliberately deleted once this one was chosen.

## Accounts (backend mode)
On when `config.js` returns a `backend` (today: `localhost` → `velocity-dev`).
`Backend.enabled` is the switch every other module checks.

- **Runs** load from the `runs` table (`data.js`: `fromRow`), falling back to
  the JSON files if Supabase can't be reached. A run's `id` is its slug in both
  modes; the database uuid never leaves `backend.js`.
- **Sign-in is never asked for on open.** `AuthUI.require(action, headline)`
  gates RSVP, Add to calendar and My runs: signed in → acts; guest → opens the
  sign-in sheet, and the action completes by itself afterwards. Across the
  Google redirect the action waits in `sessionStorage`
  (`velocity_pending_action`), and that page load skips the landing hero.
- **Sign-in sheet** offers only the methods the Supabase project has enabled
  (read from its public `/auth/v1/settings`): Google and Apple buttons appear
  once those providers are switched on there, with no code change. Email works
  by typed code or by the link in the email. The link opens a new tab, and
  supabase-js then signs in every open tab at once, so the sheet listens for
  `velocity:auth-changed` and closes itself and completes the tapped action in
  the tab the user started in (`finishSignIn` in `auth-ui.js`).
- **RSVPs** are the signed-in user's rows in `rsvps`. A tap toggles; a replay
  after sign-in sets the status outright, so it can't clear an existing RSVP.
  The detail panel shows anonymous totals from `run_counts()`.
- **First sign-in on a device** uploads its localStorage RSVPs and prefs, sets
  the display name from the onboarding name, and records the accepted Terms
  version (`VELOCITY_CONFIG.termsVersion`).
- **My runs** — a toggle on the calendar panel showing only the runs marked
  Going, with "Add all to calendar".
- **Interested list** (⋯ → Interested, and from Account) — the wishlist: every
  run whose status is `interested`, as cards with a Remove button. One status
  per run, so marking Going or Not going takes a run off it. In backend mode
  the calendar highlights Going only; static mode has no list, so there
  Interested keeps its calendar highlight.
- **Account** (⋯ → Account) — edit name, run preferences, download my data
  (JSON), sign out, delete account.

## How data gets updated
Hand-edit `clubs.json` / `events.json` in GitHub's web editor and commit —
Pages rebuilds in about a minute.

**Telegram bot** (`/telegram-bot`): a private admin bot (grammy), separate
from this static site, deliberately with **no AI/API dependency**. It runs as
a Supabase Edge Function that Telegram calls by webhook.
It sends every field at once as a `key: value` block (`buildForm()` in
`template.js`), which Taha fills in and sends back as one message
(`parseForm()`), then asks for photos, then shows a preview. Only an explicit
**Approve and publish** tap commits, via GitHub's Contents API
(`telegram-bot/src/github.js`).

That same tap then mirrors the record into the `runs` table
(`telegram-bot/src/supabase.js`), so backend mode sees what the bot publishes.
GitHub stays the bot's source of truth and is written first; a failed database
write is retried by tapping Approve again, without a second commit.
`telegram-bot/src/run-row.js` is the single record → row mapping, shared with
`supabase/seed-from-json.mjs`, and it must keep producing the same slug as
`data.js`'s `toRun()`.

All of the bot's behaviour is in `telegram-bot/src/bot.js`, which uses nothing
Node-only and is handed grammy by its entry point: `edge.ts` on Supabase
(webhook, drafts in the `bot_sessions` table) or `index.js` under Node (long
polling, drafts in a file, for local runs). **Nothing may rely on memory
between two messages** — the Edge Function can serve each one from a fresh
instance, and `test/bot.test.js` builds a new bot per message to hold that
line. The function loads the code from GitHub at one pinned commit, so a push
alone doesn't change the running bot (`telegram-bot/README.md`, "Shipping a
change").

Session modes are `form` → `photos` → `preview`. Photos are the one field
excluded from the block, because a Telegram attachment is always its own
message; `Edit the form` and `Back to the form` return to `form` mode with
answers (photos included) preserved.

The `STEP_*` definitions in `template.js` remain the single source of truth
for every field's label, options and validation — the form only changes how
they're presented. A step may carry a `when` predicate (Price applies only to
a paid run); `visibleSteps()` derives the list that actually applies, and the
preview summary and pre-publish check both go through it, so a stale Price
can't reach a published record. `parseForm()` re-applies the same predicate.

The location line accepts a Maps link or typed coordinates. A dropped Telegram
pin can't be typed into a pasted block, so the bot replies with the
coordinates as copyable text instead. `/editclub <name>` sends the same block
pre-filled from the stored record, and publish merges over that record so
fields the bot no longer asks about (the retired `pace`) survive untouched.

In-progress answers are saved after every message
(`telegram-bot/src/session-store.js` on Supabase, `drafts.js` locally), so an
entry can be left half-finished and picked up later. Note `drafts.js`
whitelists valid session modes; it must be updated in step with any mode
change or every locally saved draft is silently discarded on boot. See
`telegram-bot/README.md`.

Keep the bot deterministic. The no-AI constraint is a deliberate design
decision, not an oversight.

## Conventions
- Keep dependency-light; no framework unless the project clearly outgrows it.
  The bot's form parsing is hand-rolled for this reason rather than pulling in
  `@grammyjs/conversations`.
- No secrets in the frontend (MapLibre + OpenFreeMap are free/keyless). The
  one key that does live there, the Supabase **publishable** key in
  `config.js`, is public by design: row-level security decides what it can do.
  The Supabase **secret** key must never appear in this repo. The Telegram bot
  has its own secrets in `telegram-bot/.env` — **never** read, print, or commit
  that file, and never put those values in frontend code.
- Keep static mode working: anything account-related checks `Backend.enabled`
  and leaves the static behaviour untouched when it is false.
- Respect `prefers-reduced-motion` — there's a global override at the end of
  `style.css`.
- See `PRD.md` §4.8/§4.8b and `TECHNICAL.md` §5–6 before adding accounts or
  RSVPs — those need the planned Supabase backend and must not store personal
  data (phone numbers) in this public repo.

## Current status
- [x] MapLibre migration, lime/purple theme, Bricolage/Jakarta type pairing
- [x] Onboarding (local prefs) + "Match my prefs" filter, type filter chips,
      This Week/This Month scope toggle
- [x] Two-layer pin visuals (kind/type color + independent freebies ring)
- [x] Run Now panel — all options, time or distance sorted
- [x] Calendar day-band view, Explore (coming soon) panel
- [x] RSVP + per-event `.ics` export (local only)
- [x] PWA manifest, service worker, platform-aware install tutorial
- [x] Telegram bot — single paste-back form, then photos (no AI)
- [x] Club photo slideshow (up to 3 photos, crossfade) — schema, panel
      rendering, and the bot's photos step (asked after the form block)
- [x] Free/paid `cost` (+ conditional `price`) — bot flow, detail-panel Cost
      row, and the "Free" filter chip
- [ ] Backfill `cost` on the 5 existing records (all currently unknown, so the
      Free chip matches nothing until then)
- [x] Privacy Policy / Terms / Community Guidelines pages, linked from the
      landing page and the ⋯ menu. Friends-preview drafts: no named legal
      owner yet and not legally reviewed (`TECHNICAL.md` §11 item 6)
- [x] Supabase schema (`supabase/migrations/`) + seed script, tested against
      Postgres (PGlite) incl. RLS and account deletion. Applied and seeded on
      the `velocity-dev` Supabase project (Mumbai, ref `lxbawcwywniasqiriske`);
      **nothing in the app reads from it yet**, and there is no prod project
- [x] Backend mode in the app: Supabase read path with JSON fallback, sign-in
      sheet, synced RSVPs with totals, My runs, Interested list, Account
      panel. Verified on `localhost` for guests and with a simulated signed-in
      user. Taha has signed in for real once, through the email link in
      Chrome: the account, Terms acceptance, an RSVP and its history all saved
- [ ] Real sign-in tests still to do: typed email code (needs `{{ .Token }}`
      in the Supabase email templates) and Google (`TECHNICAL.md` §11 item 5)
- [ ] Custom SMTP so sign-in emails come from Velocity, not "Supabase Auth",
      and can reach people outside the Supabase team (`TECHNICAL.md` §11 item 4)
- [x] Telegram bot mirrors each publish into Supabase as well as the JSON
      files (`TECHNICAL.md` §8), and is rebuilt to run as a Supabase Edge
      Function instead of on Railway, whose trial expired (every deployment
      there has been removed since 2026-09-09, so the bot has been offline).
      Tested offline end to end; the `bot_sessions` table is applied
- [ ] Bot deployed but not answering yet. The `telegram-bot` function is live
      at the commit named in `supabase/functions/telegram-bot/index.ts` and
      reports its four secrets as missing. Once they are set in Supabase
      (`supabase/SETUP.md` Part 5), opening the function's `?setup` address
      registers the webhook; then it needs a real end-to-end test from
      Telegram
- [ ] Cutover: for the friends phase the one project (`velocity-dev`) is the
      live one, so this is re-running the seed and setting `PROD` in
      `config.js`, once the bot above is deployed and sign-in is set up
      (`supabase/SETUP.md`)
- [ ] Sign in with Apple (needs an Apple Developer account)
- [ ] Freebies page
- [ ] Glowing GPX routes (pending GPX files from Taha)

## Known simplifications (flagged for later refinement)
- In static mode RSVP and prefs are `localStorage` only — clearing site data
  loses them, and nothing is shared between devices or viewers.
- After signing in with Google, "Add to calendar" isn't replayed
  automatically (a download needs a fresh tap after the page reload); the run
  reopens with a prompt to tap it again.
- `tempo` / `long_run` / `pyramid` runs render as white pins, since only
  `training` is flagged `trainingEquivalent`. Fine for now; revisit if those
  types get common enough to need their own color.
- `freebies` / `surface` values on the 4 existing clubs are Claude's best
  guesses, not confirmed by Taha — worth double-checking. `cost` was
  deliberately *not* guessed the same way: every existing record has it unset.
- The detail panel shows Cost but the list rows and map pins don't — a free run
  is only visible as such after opening it, or by using the Free chip.
- List sheet drag tracks the pointer live and snaps to the nearer end on
  release (biased toward opening), but it has no velocity/inertia physics — a
  fast flick is treated the same as a slow pull.
- The landing hero's "globe" is a flat zoom, not a real 3D globe — see the
  MapLibre version note in Tech stack.
- Onboarding doesn't re-skip the landing page on repeat visits.
