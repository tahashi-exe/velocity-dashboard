# Velocity — Run Club Discovery Dashboard

## What this is
A personal/friends-use dashboard displaying Dubai run clubs on a map. Click a
pin to see club info (location, pace, usual run day/time, link). A "Run Now"
feature checks the current time (and optionally live location) to surface
clubs running within the next few hours. Static site, hosted on GitHub Pages —
no backend, no database.

This is a scoped precursor to a bigger future product ("Velocity") that would
eventually be a full app with user preferences and community ratings. For now
the goal is a working tool to validate the concept with friends.

## Tech stack
- **Hosting:** GitHub Pages (static, deploys from `main` branch)
- **Map:** Leaflet.js + OpenStreetMap tiles (free, no API key)
- **Data:** `clubs.json` — flat file, hand-edited
- **Frontend:** Plain HTML/CSS/JS, no framework, no build step
- **Fonts:** Space Grotesk (display) + Inter (body), via Google Fonts
- **Theme:** Light background, purple (`#6D28D9`) + orange (`#F97316`) accents

## File structure
```
/
├── index.html    # Map, top bar, side panels
├── style.css     # Purple/orange theme
├── script.js     # Map rendering, panels, Run Now logic
├── clubs.json    # Run club data
└── CLAUDE.md
```

## Data schema (`clubs.json`)
Clubs run on a **recurring weekly schedule**, not a fixed date:
```json
{
  "name": "string",
  "location_name": "string",
  "lat": 0.0,
  "lng": 0.0,
  "pace": "easy / social | tempo | training",
  "type": "social | training",
  "day": "monday..sunday (lowercase)",
  "time": "HH:MM (24h)",
  "link": "url — instagram, whatsapp, or registration link",
  "notes": "string",
  "last_updated": "YYYY-MM-DD"
}
```

## Run Now logic (script.js)
- `getRunStatus(club, now)` finds the closest occurrence (past or future) of a
  club's weekly day+time relative to now, and flags it "soon" if it started
  within the last 60 min or starts within the next 180 min (both configurable
  at the top of `script.js`).
- If the user grants location permission, matching clubs are sorted by
  distance (haversine); otherwise sorted by soonest start time.
- If nothing qualifies, shows an empty state rather than listing future runs.

## How data gets updated
No live scraping (Instagram/WhatsApp don't offer free APIs for this). Update
`clubs.json` directly in GitHub's web editor, commit — GitHub Pages rebuilds
automatically in about a minute.

## Conventions
- Keep dependency-light; no framework unless the project clearly outgrows it.
- No API keys required for current scope (Leaflet + OSM are free/keyless).
- Prototype for personal/friends use — favor iteration speed over scale.

## Current status
- [x] index.html / style.css / script.js scaffolded
- [x] clubs.json seeded with first 3 real Dubai clubs (ON Run Club, The
      Uncommon Club, Frame Run Club)
- [ ] GitHub Pages enabled and live
- [ ] Shared with friends for feedback

## Possible next steps
- Form-based intake to reduce manual JSON editing
- Filter UI by pace / run type
- More clubs
