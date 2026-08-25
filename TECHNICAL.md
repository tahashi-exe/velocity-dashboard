# Velocity — Technical / Architecture Doc (v2)

Companion to `PRD.md` (product-facing: vision, features, UX). This covers
schema, backend, and implementation detail for the same v2 changes. Nothing
here has been built yet — this is a plan.

## 1. Current architecture (v1) recap

Static site, no build step, no backend. `clubs.json` (recurring) +
`events.json` (one-off) are hand-edited flat files, read directly by
`script.js` via `fetch()`. The private Telegram bot (`telegram-bot/`, a
grammy-based Node process) is the only structured write path today — it
parses a fill-in-the-blanks template, shows a preview, and on approval
commits directly to those JSON files via GitHub's Contents API
(`telegram-bot/src/github.js`).

## 2. Data model (v2)

Collapses `clubs.json` + `events.json` into one backend table, plus new
tables for categories, accounts, and RSVPs.

**`categories` table** — one row per category. Launch data: a single row,
`running`. Adding a category later is an insert here, not a schema change.
| Field | Type | Notes |
|---|---|---|
| `key` | text, pk | e.g. `running` |
| `label` | text | e.g. "Running" |

**`category_types` table** — defines the valid "type" values per category,
so each category can have its own list length (running has 5, a future
category might have 2).
| Field | Type | Notes |
|---|---|---|
| `category_key` | fk → `categories.key` | |
| `type_key` | text | e.g. `training` |
| `label` | text | e.g. "Training" |
| `is_training_equivalent` | boolean | drives the red-pin rule in §4, default `false` |

Running's seed rows: `social`, `tempo`, `training` (`is_training_equivalent
= true`), `long_run`, `pyramid`.

**`runs` table** — one row per club or event, any category.
| Field | Type | Notes |
|---|---|---|
| `id` | uuid, pk | |
| `category_key` | fk → `categories.key` | `running` at launch |
| `name` | text | |
| `location_name` | text | |
| `lat`, `lng` | float | |
| `kind` | `recurring` \| `one_off` | drives base pin color, §4 |
| `type_key` | fk → `category_types.type_key` (scoped to the row's category) | |
| `freebies` | boolean | drives the freebies ring, §4 — universal across categories |
| `day_of_week` | text, nullable | set only when `kind = recurring` |
| `event_date` | date, nullable | set only when `kind = one_off` |
| `time` | time (HH:MM, 24h) | |
| `register_link` | url | labeled "Register here" in the UI |
| `notes` | text | |
| `details` | jsonb, nullable | category-specific extra fields that don't need their own column — e.g. running's `surface` (`track`/`beach`/`road`) lives here as `{"surface": "track"}` instead of a dedicated `surface` column, so a future category isn't stuck with an irrelevant `surface` field |
| `last_updated` | date | |

Rows are never hard-deleted (§7 below covers the read-time filtering for
expired one-offs instead).

**`profiles` table** — one row per account.
| Field | Type | Notes |
|---|---|---|
| `id` | uuid, references auth user | |
| `display_name` | text | |
| `auth_methods` | text[] | which of email/apple/google are linked, informational |
| preference fields | — | same shape as today's `velocity_prefs` (type interest, freebies interest), now synced instead of local-only |

**`rsvps` table** — one row per (user, run) pair.
| Field | Type | Notes |
|---|---|---|
| `id` | uuid, pk | |
| `user_id` | fk → `profiles.id` | |
| `run_id` | fk → `runs.id` | |
| `status` | `interested` \| `not_interested` \| `going` \| `not_going` | calendar "interested" (PRD §4.9) reads/writes this same field |
| `updated_at` | timestamp | |

## 3. Category extensibility

Adding a new category later is meant to be a data change, not a code
change: insert a `categories` row, insert its `category_types` rows, and the
existing card/filter UI (which already reads type options from
`category_types` rather than a hardcoded list) picks it up. The `details`
jsonb column absorbs whatever category-specific fields don't deserve a
dedicated column, so the `runs` table itself doesn't need new columns per
category either. Running is the only category actually built and launched
in this PRD (PRD §4.1) — this section just documents that the schema doesn't
block adding a second one later.

## 4. Pin color logic

Base color (first match wins):
```
kind == 'one_off'                         → black
category_types[type_key].is_training_equivalent → red
otherwise                                 → white
```
Freebies ring: rendered as a separate marker layer/border whenever
`freebies = true`, independent of the base color above — so a one-off event
with freebies is a **black pin with a ring**, not a green pin that hides the
"one-off" signal (the problem with the current single-color-priority logic
in `getColor`).

This reads `is_training_equivalent` from `category_types` rather than
hardcoding the string `"training"`, so the rule generalizes to any future
category that defines a training-equivalent type — for the running-only
launch, this produces exactly the same red/black/white mapping as before,
just decomposed into two independent visual layers instead of one priority
chain.

## 5. Auth

Supabase Auth supports email/password and OAuth (Apple, Google) natively, so
all three sign-in options from PRD §4.8b map directly onto it without a
custom auth layer. Users can have more than one linked method (e.g. sign up
with email, later add Google) — standard Supabase account-linking behavior,
no custom design needed here.

## 6. Backend & migration

- **Data:** `categories`, `category_types`, `runs`, `profiles`, `rsvps`
  tables as above, with row-level security so users can only write their
  own `profiles`/`rsvps` rows; `runs` stays admin/bot-writable only.
- **Frontend reads:** `data.js` reads from Supabase instead of fetching
  `clubs.json`/`events.json`. Recommended default: call the Supabase JS
  client directly from the browser (loaded via `<script>` tag, same pattern
  as Leaflet/MapLibre today) rather than standing up a separate API layer —
  keeps the "no build step" property of v1. Flagged as a default, not a
  hard requirement — worth revisiting if a use case needs server-side logic
  Supabase's client-side rules can't express.
- **Existing static JSON data** (`clubs.json`, `events.json`) gets migrated
  into `runs` as a one-time import, all rows tagged `category_key = running`.

## 7. Expired one-off handling

Expired one-offs are filtered out of every read (`WHERE event_date >=
today() OR kind = 'recurring'`) — a cheap query-level filter, not a
scheduled job, since rows are never deleted (PRD §4.7). No cleanup job is
needed for this; the "never hard-delete" decision actually simplifies this
compared to the grace-period approach considered earlier.

## 8. Telegram bot changes

The bot's job stays the same (deterministic template → preview → explicit
approve, no AI) but its publish step changes: `telegram-bot/src/github.js`
currently commits directly to `clubs.json`/`events.json` via GitHub's
Contents API. That gets replaced with a Supabase write (insert/update on
`runs`) so admin data entry keeps working once the backend is in place.
Template fields stay the same shape as today, since only the `running`
category is live — the template's `type:` line would only need to offer
other categories' type lists once a second category actually exists.

## 9. PWA implementation

Manifest + minimal service worker for install-to-home-screen only (PRD
§4.13) — no offline caching of map tiles or run data, no background sync.
Deliberately the smaller of the two options considered, to keep this phase
scoped.

## 10. Phased rollout (engineering-level)

1. **Backend foundation** — stand up Supabase, create
   `categories`/`category_types`/`runs`/`profiles`/`rsvps` schema, seed
   `categories`/`category_types` with the `running` rows, one-time import of
   existing `clubs.json`/`events.json` into `runs`.
2. **Telegram bot migration** — repoint the bot's publish step from GitHub
   commits to Supabase writes (§8).
3. **Frontend read migration** — `data.js` reads from Supabase; new
   type/kind card hierarchy (PRD §4.5), "Register here" label, recurring
   events shown as a permanent slot (PRD §4.6).
4. **Pin visuals** — implement the base-color + freebies-ring logic (§4).
5. **Map migration** — MapLibre GL JS + free vector tiles, port markers to
   the new pin visuals from step 4.
6. **Auth + RSVP** — email/password + Apple/Google sign-in (§5), Interested/
   Not interested/Going/Not going persisted per user (PRD §4.8).
7. **Calendar view + This Week/Month toggle** — day-box calendar (PRD §4.9),
   top bar scope toggle (PRD §4.4), expired one-off filtering (§7).
8. **Calendar export** — per-event `.ics` download (PRD §4.10).
9. **PWA** — manifest, icons, minimal service worker (§9).
