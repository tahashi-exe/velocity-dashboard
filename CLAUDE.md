# Velocity — Run Club Discovery Dashboard

## What this is
A map dashboard for discovering Dubai run clubs, tagline "VelocityAE — Find
your next run." A landing page (bouncing pin, "Let's Run?" CTA) leads into a
map with pins for each club — click a pin to see location, pace, usual
day/time, and a link. "Run Now" checks current time (and optionally live
location) to surface clubs running soon. Currently a static site on GitHub
Pages, no backend — full scope and roadmap is in `PRD.md`.

**Live and deployed** at tahashi-exe's GitHub Pages. Originally built for
personal/friends use; PRD.md defines a much larger future scope (sign-up,
RSVPs, reviews, Supabase backend, Telegram bot data intake, PWA install,
eventually a general wellness-discovery platform).

## Tech stack
- **Hosting:** GitHub Pages (static, deploys from `main` branch) — current
  phase. `PRD.md` §6 covers the planned migration to a Supabase backend for
  features that need real data storage (sign-up, RSVPs, reviews).
- **Map:** Leaflet.js + OpenStreetMap tiles (free, no API key)
- **Data:** `clubs.json` — flat file, hand-edited
- **Frontend:** Plain HTML/CSS/JS, no framework, no build step
- **Fonts:** Helvetica Neue / Helvetica / Arial (system font, bold weight
  throughout — no external font loading)
- **Theme:** Light background, purple (`#6D28D9`) + lime green (`#A3E635`)
  accents

## File structure
```
/
├── index.html    # Landing page, map, top bar, side panels
├── style.css     # Purple/lime theme
├── script.js     # Landing transition, map rendering, panels, Run Now logic
├── clubs.json    # Run club data
├── PRD.md        # Full product spec — current + planned features
├── README.md     # Public-facing project description
└── CLAUDE.md     # This file
```

## Data schema (`clubs.json`)
Clubs run on a **recurring weekly schedule**, not a fixed date. (PRD.md adds
a separate one-off `events` concept, not yet implemented in code.)
```json
{
  "name": "string",
  "location_name": "string",
  "lat": 0.0,
  "lng": 0.0,
  "pace": "easy / social | tempo | training",
  "type": "social | training | track",
  "day": "monday..sunday (lowercase)",
  "time": "HH:MM (24h)",
  "link": "url — instagram, whatsapp, or registration link",
  "notes": "string",
  "last_updated": "YYYY-MM-DD"
}
```
⚠️ Any hand-edit to this file must stay valid JSON (run it through a
validator before committing) — one syntax error breaks parsing for the
entire file, taking down all pins, not just the edited entry.

## UI notes
- Club detail / Run Now panels open from the **left** side (not right).
- Map markers show the club's **name as a label above the pin**
  (`.marker-label` in a `.club-marker-wrap`).
- Landing page (`#landing-page`) shows on every load currently — a
  first-visit-only skip (via localStorage) is planned alongside onboarding
  (PRD.md §4.2), not yet built.

## Run Now logic (script.js)
- `getRunStatus(club, now)` finds the closest occurrence (past or future) of
  a club's weekly day+time relative to now, flags it "soon" if it started
  within the last 60 min or starts within the next 180 min (configurable at
  the top of `script.js`).
- If the user grants location permission, matching clubs are sorted by
  distance (haversine); otherwise sorted by soonest start time.
- Current behavior: if nothing qualifies within the window, shows an empty
  state. **PRD.md §4.8 changes this** — Run Now should always surface the
  single nearest upcoming run regardless of window, not yet implemented.

## How data gets updated
No live scraping (Instagram/WhatsApp don't offer free APIs for this).
Currently: update `clubs.json` directly in GitHub's web editor, commit —
GitHub Pages rebuilds automatically in about a minute. **Planned:** a
Telegram bot that AI-parses pasted club info and writes to the data source
directly (PRD.md §10) — bridges to GitHub API commits until Supabase exists.

## Conventions
- Keep dependency-light; no framework unless the project clearly outgrows it.
- No API keys required for current scope (Leaflet + OSM are free/keyless).
- See `PRD.md` §6 before adding sign-up/RSVP/reviews — those need a real
  backend and must not store personal data (phone numbers) in this public
  repo.

## Current status
- [x] index.html / style.css / script.js scaffolded
- [x] clubs.json seeded (ON Run Club, The Uncommon Club, Frame Run Club, LFG)
- [x] Live on GitHub Pages
- [x] Reskin: lime/purple theme, Helvetica Bold, landing page, left-side
      panels, pin name labels
- [ ] Onboarding, list/map toggle, filters, freebies page, updated Run Now
- [ ] Supabase backend, sign-up/auth, RSVPs, reviews
- [ ] PWA manifest for iOS install
- [ ] Telegram bot data intake
- [ ] Glowing GPX routes (pending GPX files from Taha)

## Possible next steps
See `PRD.md` §7 for the full phased roadmap.
