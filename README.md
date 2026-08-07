# VelocityAE

A map-based dashboard for discovering run clubs around Dubai.

## What it is

Velocity shows run clubs on an interactive map — click a pin to see a club's
usual meeting spot, pace, run day/time, and a link to their Instagram,
WhatsApp channel, or registration page. Instead of digging through scattered
updates across Instagram, WhatsApp, Strava clubs, Telegram groups, or Meetup
pages to figure out where and when a club is running, it's all in one place.

The standout feature is **Run Now** — a button that checks the current time
against every club's weekly schedule and surfaces anything running within the
next few hours, sorted by distance if you share your location. It's built for
the moment someone thinks "I want to run right now, who's out there?"

This started as a personal/friends-use prototype for a small, hand-picked set
of Dubai run clubs, with the data updated manually. It's also meant to be an
easy way for someone new to Dubai to find a run club to join in under 60
seconds, without digging through Instagram and WhatsApp. The longer-term
vision is a full "Google Maps for run clubs" — covering many more clubs,
letting club organizers manage their own listings, adding user preferences
(pace, run type) and community ratings, and eventually growing into the kind
of platform that could be pitched to investors.

## Features

- **Interactive map** — every club plotted as a pin around Dubai
- **Club detail panel** — pace, run type, usual day/time, location, and a
  direct link to the club (Instagram, WhatsApp, or registration page)
- **Run Now** — time-aware matching against each club's weekly schedule, with
  optional location-based distance sorting
- **Purple/orange themed UI** — light background, Space Grotesk + Inter type

## Tech

Plain HTML/CSS/JS, Leaflet.js + OpenStreetMap for the map, no backend — club
data lives in `clubs.json` and is hosted as a static site on GitHub Pages.

See `CLAUDE.md` for the technical breakdown (file structure, data schema, and
how the Run Now logic works) if you're picking this up in an editor.
