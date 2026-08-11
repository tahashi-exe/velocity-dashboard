# Velocity — Run Club Discovery Dashboard

## What this is
A map dashboard for discovering Dubai run clubs and one-off run events,
tagline "VelocityAE — Find your next run." Landing page -> onboarding
(local preferences) -> map with color-coded pins. Click a pin/list row for
details. "Run Now" surfaces what's running soon, or the closest upcoming run
if nothing qualifies within the next few hours. Full scope and roadmap is
in `PRD.md`.

Currently a static site on GitHub Pages — no backend yet. Sign-up, RSVPs,
and reviews (PRD.md §4.3, §4.10, §4.11) are blocked on the planned Supabase
migration (PRD.md §6) and are NOT built yet.

## Tech stack
- **Hosting:** GitHub Pages (static, deploys from `main` branch)
- **Map:** Leaflet.js + OpenStreetMap tiles (free, no API key)
- **Data:** `clubs.json` (recurring) + `events.json` (one-off) — flat files,
  hand-edited or via the planned Telegram bot (§ below)
- **Frontend:** Plain HTML/CSS/JS, no framework, no build step
- **Fonts:** Helvetica Neue / Helvetica / Arial (system font, bold weight)
- **Theme:** Light background, purple (`#6D28D9`) + lime green (`#A3E635`)

## File structure
```
/
├── index.html      # Landing, onboarding modal, topbar, map, panels, sheet
├── style.css       # Theme + all component styles
├── script.js       # All app logic (see breakdown below)
├── clubs.json      # Recurring run clubs
├── events.json     # One-off events (currently empty — add entries as needed)
├── PRD.md          # Full product spec — current + planned features
├── README.md       # Public-facing project description
└── CLAUDE.md       # This file
```

## Data schema

`clubs.json` (recurring, weekly):
```json
{
  "name": "string", "location_name": "string", "lat": 0.0, "lng": 0.0,
  "pace": "easy / social | tempo | training",
  "type": "social | training | track",
  "surface": "track | beach | road",
  "freebies": true,
  "day": "monday..sunday (lowercase)", "time": "HH:MM (24h)",
  "link": "url", "notes": "string", "last_updated": "YYYY-MM-DD"
}
```

`events.json` (one-off, single date):
```json
{
  "name": "string", "location_name": "string", "lat": 0.0, "lng": 0.0,
  "pace": "easy / social | tempo | training", "type": "social | training",
  "surface": "track | beach | road", "freebies": false,
  "date": "YYYY-MM-DD", "time": "HH:MM (24h)",
  "link": "url", "notes": "string", "last_updated": "YYYY-MM-DD"
}
```

⚠️ Hand-edits to either file must stay valid JSON — validate before
committing (one syntax error breaks parsing for the whole file).

## Pin color logic (script.js: `getColor`)
Priority order (first match wins): **one-off (black) → freebies (green) →
training (red) → repeated/regular (white)**.

## Preferences & filtering
- Onboarding (`OB_STEPS` in script.js) collects name, age, pace, session
  type, surface preference (track/beach), freebies interest.
- Stored in `localStorage` under `velocity_prefs` — **on-device only, no
  backend, no account.** This is separate from the future sign-up flow
  (PRD.md §4.3), which will need real accounts server-side.
- Profile icon (top right) reopens onboarding pre-filled for editing.
- Filters panel (right side, `#filters-panel`) toggles "View all" vs "Match
  my prefs" (`matchesPrefs()` — currently matches on session type + surface
  only, not full preference set — simple AND logic, easy to extend).
- Wellness category filters are shown locked; clicking shows a toast
  ("Featuring in the next release") per PRD.md §4.13.

## Status logic (script.js: `getItemStatus`)
Unified for both recurring and one-off items. Returns `phase`: `'soon'`
(within the -60/+180 min window), `'upcoming'` (next occurrence found but
outside that window), or `'expired'` (one-off event already passed).

## Run Now (script.js: `showRunNowResults`)
Per PRD.md §4.8 — always returns a result if any non-expired item exists:
prefers items in `'soon'` phase; if none, falls back to the closest
`'upcoming'` items instead of returning empty. Sorts by distance if location
is granted, else by time.

## List / Map sheet
`#list-sheet` — a bottom sheet toggled by tapping the handle (basic
pointer-drag also supported). Lists all visible items sorted by soonest,
with a "runs this week" count banner at the top (items within 7 days).

## How data gets updated
Manual: edit `clubs.json`/`events.json` directly in GitHub's web editor,
commit — GitHub Pages rebuilds in about a minute.
**Planned:** Telegram bot with AI parsing writes directly via GitHub's API
(PRD.md §10) — see `/telegram-bot` folder once built for the bot code and
its own setup instructions (separate hosting required, cannot run on GitHub
Pages).

## Conventions
- Keep dependency-light; no framework unless the project clearly outgrows it.
- No API keys required for the current frontend (Leaflet + OSM are
  free/keyless). The Telegram bot is a separate piece with its own secrets
  — never put those in this repo's frontend code.
- See `PRD.md` §6 before adding sign-up/RSVP/reviews — those need a real
  backend and must not store personal data (phone numbers) in this public
  repo.

## Current status
- [x] Reskin: lime/purple theme, Helvetica Bold, landing page, left-side
      panels, pin name labels
- [x] Onboarding (local prefs), profile icon, filters panel (locked
      wellness section), list/map toggle sheet, "runs this week" banner,
      Run Now fallback logic, one-off events data model, color-coded pins
- [ ] Supabase backend, sign-up/auth, RSVPs, reviews
- [ ] PWA manifest for iOS install
- [ ] Telegram bot (in progress — see /telegram-bot)
- [ ] Freebies page
- [ ] Glowing GPX routes (pending GPX files from Taha)

## Known simplifications (flagged for later refinement)
- `matchesPrefs()` only checks session type + surface, not pace/age/freebies
  interest — fine for a first pass, worth expanding once real usage shows
  what matters.
- `freebies`/`surface` values on the 4 existing clubs are Claude's best
  guesses, not confirmed by Taha — worth double-checking.
- List sheet drag is click/tap + simple pointer delta, not full physics —
  works but isn't buttery; fine for a prototype.
- Onboarding doesn't yet re-skip the landing page on repeat visits (PRD.md
  scope, not yet built).
