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

Still a static site on GitHub Pages, no backend. Accounts and synced RSVPs
(`PRD.md` §4.8, §4.8b) remain blocked on the Supabase migration
(`TECHNICAL.md` §5–6). RSVP and preferences exist today as **localStorage
mocks only** — nothing syncs, nothing is shared between devices.

## Tech stack
- **Hosting:** GitHub Pages (static, deploys from `main` branch)
- **Map:** MapLibre GL JS v4 + OpenFreeMap vector tiles (free, no API key).
  Note the `@4` CDN tag resolves to 4.7.1, which has **no `setProjection`** —
  that's a v5+ API. `landing-map.js` attempts it in a try/catch and degrades
  to a flat zoom (see its header comment before "fixing" this).
- **Data:** `clubs.json` (recurring) + `events.json` (one-off) — flat files,
  edited via the Telegram bot (§ below) or by hand
- **Frontend:** Plain HTML/CSS/JS, no framework, no build step. Scripts are
  plain `<script>` tags loaded in dependency order by `index.html`.
- **Fonts:** Bricolage Grotesque (display — wordmark, hero, panel titles,
  calendar date numerals) + Plus Jakarta Sans (body/UI), via Google Fonts.
  Referenced through `--font-display` / `--font-body` in `:root`.
- **Theme:** Light background, purple (`#6D28D9`) + lime green (`#A3E635`)
- **PWA:** installable to the iOS home screen — `manifest.webmanifest` plus a
  deliberately minimal `sw.js` (installability only; **no offline caching**)

## File structure
```
/
├── index.html          # Shell: landing, onboarding + install modals, run panel
├── style.css           # Theme + all component styles
├── data.js             # Velocity: data layer — load, normalize, status, prefs, RSVP, .ics
├── shared-ui.js        # SharedUI: landing, onboarding, install tutorial, run detail panel
├── variant-a.js        # VariantA: topbar, map, bottom sheet, Run Now, Explore — mounts the app
├── calendar.js         # Calendar: day-band calendar rendering
├── map-helpers.js      # MapHelper: MapLibre setup + marker creation
├── landing-map.js      # LandingMap: decorative animated map behind the hero
├── sw.js               # Service worker — installability only, caches nothing
├── manifest.webmanifest, icon*.png/svg
├── clubs.json          # Recurring run clubs
├── events.json         # One-off events
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
- **RSVP** — Going / Interested / Not interested / Not going, per run, stored
  in `localStorage` (`velocity_rsvp_v2`). Not synced, deliberately.
- **Add to calendar** — per-event `.ics` download (`data.js`: `downloadICS`).
- **Open in Maps** — links straight to `google.com/maps/search/?api=1&query=lat,lng`
  using the run's existing coordinates (no new field, no bot change needed).
  Opens the native Google Maps app on a phone that has it, else the web map.

Only one UI variant exists (`variant-a.js`). Two others and a switcher were
prototyped and deliberately deleted once this one was chosen.

## How data gets updated
Hand-edit `clubs.json` / `events.json` in GitHub's web editor and commit —
Pages rebuilds in about a minute.

**Telegram bot** (`/telegram-bot`): a private always-on Node process (grammy),
separate from this static site, deliberately with **no AI/API dependency**.
It sends every field at once as a `key: value` block (`buildForm()` in
`template.js`), which Taha fills in and sends back as one message
(`parseForm()`), then asks for photos, then shows a preview. Only an explicit
**Approve and publish** tap commits, via GitHub's Contents API
(`telegram-bot/src/github.js`).

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

In-progress answers persist to disk (`telegram-bot/src/drafts.js`) so a
restart resumes — though Railway's filesystem is ephemeral across *redeploys*.
Note `drafts.js` whitelists valid session modes; it must be updated in step
with any mode change or every saved draft is silently discarded on boot.
Deployed on Railway (root directory `telegram-bot`) — see
`telegram-bot/README.md`.

Keep the bot deterministic. The no-AI constraint is a deliberate design
decision, not an oversight.

## Conventions
- Keep dependency-light; no framework unless the project clearly outgrows it.
  The bot's form parsing is hand-rolled for this reason rather than pulling in
  `@grammyjs/conversations`.
- No API keys in the frontend (MapLibre + OpenFreeMap are free/keyless). The
  Telegram bot has its own secrets in `telegram-bot/.env` — **never** read,
  print, or commit that file, and never put those values in frontend code.
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
- [ ] Supabase backend, accounts/sign-in, synced RSVPs
- [ ] Freebies page
- [ ] Glowing GPX routes (pending GPX files from Taha)

## Known simplifications (flagged for later refinement)
- RSVP and prefs are `localStorage` only — clearing site data loses them, and
  nothing is shared between devices or viewers.
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
