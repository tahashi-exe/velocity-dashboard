# Velocity — Technical / Architecture Doc (v2)

Companion to `PRD.md` (product-facing: vision, features, UX). This covers
schema, backend, and implementation detail for the same v2 changes. The
frontend parts are built (see `CLAUDE.md`). The §2 schema exists as a tested
migration in `supabase/`, but it isn't applied to a live project or wired into
the app yet. Everything else backend-shaped is still a plan. §11 lists what has to
happen before the switch.

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
| `slug` | text, unique | `slug(name) + '-' + kind`, the id the static app already uses, so localStorage RSVPs map across on first sign-in |
| `category_key` | fk → `categories.key` | `running` at launch |
| `name` | text | |
| `location_name` | text | |
| `lat`, `lng` | float | |
| `kind` | `recurring` \| `one_off` | drives base pin color, §4 |
| `type_key` | fk → `category_types.type_key` (scoped to the row's category) | |
| `freebies` | boolean | drives the freebies ring, §4 — universal across categories |
| `cost` | `free` \| `paid`, nullable | null = unknown, never "free" |
| `price` | text | empty unless `cost = paid` (enforced by a check constraint) |
| `day_of_week` | text, nullable | set only when `kind = recurring` |
| `event_date` | date, nullable | set only when `kind = one_off` |
| `time` | time (HH:MM, 24h) | |
| `register_link` | url | labeled "Register here" in the UI |
| `photos` | text[], nullable | up to 3 image URLs, shown as a crossfading slideshow in the detail panel |
| `notes` | text | |
| `details` | jsonb, nullable | category-specific extra fields that don't need their own column — e.g. running's `surface` (`track`/`beach`/`road`/`indoor`) lives here as `{"surface": "track"}` instead of a dedicated `surface` column, so a future category isn't stuck with an irrelevant `surface` field |
| `last_updated` | date | |

Rows are never hard-deleted (§7 below covers the read-time filtering for
expired one-offs instead).

**`profiles` table** — one row per account.
| Field | Type | Notes |
|---|---|---|
| `id` | uuid, references auth user | created by a trigger on sign-up, pre-filled from Google's name/photo |
| `display_name` | text | |
| `avatar_url` | text | |
| `prefs` | jsonb | same shape as today's `velocity_prefs` object, now synced instead of local-only |
| `terms_version` | text | Terms/Privacy version the user accepted |
| `terms_accepted_at` | timestamp | stamped by a trigger whenever `terms_version` changes, so it can't be backdated |

(`auth_methods` was dropped. Linked sign-in methods already live in Supabase's
`auth.identities`.)

**`rsvps` table** — one row per (user, run) pair. The primary key is `(user_id, run_id)`,
so the app upserts. Clearing an RSVP deletes the row.
| Field | Type | Notes |
|---|---|---|
| `user_id` | fk → `profiles.id` | defaults to `auth.uid()` |
| `run_id` | fk → `runs.id` | |
| `status` | `going` \| `not_going` \| `interested` | `interested` is the saved-for-later list (PRD §4.8). The enum also still contains `not_interested`, retired with its button; the app never writes it and reads it as no RSVP |
| `created_at`, `updated_at` | timestamp | |

**`rsvp_log` table** — append-only history of every RSVP change (status null =
cleared), written by a trigger. No API access. It's for insight from the
dashboard only.

**Functions:** `run_counts()` returns anonymous going/interested totals per run
(never who). `delete_my_account()` deletes the caller's auth user, which cascades to
profile, RSVPs and history.

Implemented in `supabase/migrations/20260930000000_init.sql`. See
`supabase/README.md`.

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

Supabase Auth, with no custom auth layer. Sign-in options, per PRD §4.8b:

- **Continue with Google** (OAuth). This is the one-tap default.
- **Email code.** The user types a 6-digit code (`signInWithOtp`, with the email
  template sending `{{ .Token }}`). There's no password to create or forget. We use a
  code rather than a magic link because on phones the link often opens in a
  different browser (Gmail's in-app one) and loses the session.
- **Continue with Apple.** Added once there's an Apple Developer account ($99/yr).
  Its client secret expires every 6 months and must be regenerated.

Implementation notes:
- The browser client uses `flowType: 'pkce'`, so the OAuth redirect comes back with
  `?code=`.
- Before redirecting, the action the guest tapped (`{runSlug, status}`) is saved
  in `sessionStorage` and replayed once sign-in completes.
- Google refuses OAuth inside embedded webviews (Instagram's in-app browser),
  where friends will open shared links. Detect it and suggest "Open in
  Safari/Chrome". The email code still works there.
- The default Supabase mailer only sends to project team members, so email codes
  need custom SMTP (a dedicated Gmail with an App Password is enough at friends
  scale).
- On first sign-in, any `velocity_rsvp_v2` and `velocity_prefs` in localStorage
  are uploaded (keyed by `runs.slug`) and then cleared.

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
6. **Auth + RSVP** — Google / email-code sign-in, Apple later (§5); Going /
   Not going and the Interested list persisted per user (PRD §4.8).
7. **Calendar view + This Week/Month toggle** — day-box calendar (PRD §4.9),
   top bar scope toggle (PRD §4.4), expired one-off filtering (§7).
8. **Calendar export** — per-event `.ics` download (PRD §4.10).
9. **PWA** — manifest, icons, minimal service worker (§9).

## 11. Before switching to the backend

In order. Items 1–7 are account and console setup that only the owner can do.
Nothing here costs money except the optional Apple step.

1. **Mac tooling.** Accept the Xcode license (`sudo xcodebuild -license accept`).
   Until then `git` and `python3` are blocked. Then
   `brew install supabase/tap/supabase gh`.
2. **Supabase.** Create two free projects, `velocity-dev` and `velocity-prod`,
   in the region closest to the UAE. Keep each project's URL and **publishable**
   key: both are public and go in the frontend. The **secret** key goes only in
   the bot's Railway env.
3. **Auth URLs.** Set the Site URL to `https://tahashi-exe.github.io/velocity-dashboard/`.
   Add redirect URLs for that address with `/**` appended, plus `http://localhost:*/**`
   on dev.
4. **Email codes.** Set up custom SMTP (a dedicated Gmail with an App Password
   will do for now). Change the magic-link email template to send the 6-digit
   `{{ .Token }}`.
5. **Google sign-in.** In Google Cloud, create a project and a consent screen
   (homepage, `privacy.html` and `terms.html` URLs, scopes `openid email profile`
   only, published to production). Then create a Web OAuth client whose redirect
   URI is `https://<project-ref>.supabase.co/auth/v1/callback`. Paste the client ID
   and secret into Supabase → Auth → Providers → Google. The legal pages must be
   live on Pages before this step.
6. **Legal pages.** The contact email is filled in, and Velocity is described as an
   independent community project rather than a named owner. Once the Supabase
   region and email provider are chosen, name them in `privacy.html` §4. Before
   opening beyond friends, name the legal owner (a person or registered company)
   and have the pages reviewed.
7. **Apple (later).** Join the Apple Developer Program. Create an App ID, a Services ID and
   a Sign in with Apple key, then enter them in Supabase. Set a reminder to regenerate
   the secret every 6 months.
8. **Build** (see PRD §6 order): apply the migration to dev, then do the front-end
   read path, sign-in sheet, synced RSVPs, My runs, Account and the bot repoint
   (§8), all tested against dev.
9. **Cutover.** Regenerate and run `supabase/seed.sql` on prod, point the
   frontend config at prod, and deploy the bot change on Railway **at the same
   time**. Otherwise bot edits land in JSON the site no longer reads. Keep
   `clubs.json` / `events.json` as a read fallback until things are stable.
   Reverting the commit is the rollback.
