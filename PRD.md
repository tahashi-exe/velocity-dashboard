# Velocity — Product Requirements Document (v2)

This is the product-facing PRD — vision, features, and UX. Schema, backend,
and implementation detail live in the companion doc, `TECHNICAL.md`. Neither
document has been built yet; this is a plan.

It supersedes the `PRD.md` referenced elsewhere in this repo (in `CLAUDE.md`
and `README.md`) — that file never actually existed in the repo's history, so
this is the first real one.

## 1. Vision

Velocity is a map-based discovery app: open it, see what's happening around
you, and plan your week around it. It launches with **running** as its only
category (clubs and one-off run events, same as today), but the product and
data model are built so additional categories (e.g. yoga, padel, general
meetups) can be added later without a redesign — see §4.1 and
`TECHNICAL.md` §3 for how that extensibility works.

## 2. Guiding principles

- Mobile-first — most usage is someone checking their phone before heading
  out.
- No AI in the admin data-entry path (the Telegram bot stays deterministic
  template parsing, not AI extraction).
- Keep secrets out of frontend code; anything requiring a key or credential
  lives server-side.
- The category system should let a new category get added later via data,
  not a schema migration or a code rewrite.

## 3. Current state (v1) recap

Static site (`index.html` / `style.css` / `script.js`), no build step, no
backend. Leaflet.js + OpenStreetMap raster tiles. Data lives in `clubs.json`
(recurring, weekly) and `events.json` (one-off) — flat files hand-edited via
GitHub or via the private Telegram bot (`telegram-bot/`), which writes commits
through GitHub's Contents API. Onboarding preferences are local-only
(`localStorage`, key `velocity_prefs`). Run Now (`computeRunNow` in
`script.js`) surfaces what's on soon, falling back to the closest upcoming
run. No accounts, no RSVPs, no calendar view.

## 4. Feature & logic changes (v2)

### 4.1 Categories — running only at launch, extensible by design
The app supports multiple activity categories, but only **Running** is
actually designed and launched in this PRD. Each category defines its own
short list of "types" — Running's is **social / tempo / training / long run
/ pyramid session**; a future category can be as simple as just **social /
training**, per your direction. Adding a new category later means adding its
type list as data, not changing the app's code or database schema (see
`TECHNICAL.md` §3).

### 4.2 Map: migrate to MapLibre GL JS
Replace Leaflet + OSM raster tiles with MapLibre GL JS, using a free,
keyless vector tile source — keeps the "no API key required" property of v1.
Pin rendering logic is updated per §4.3 below and ported from Leaflet's
`L.divIcon`/`L.marker` to MapLibre's marker API.

### 4.3 Pin visuals: kind + type color, freebies as a separate ring
Today, one color has to represent everything (one-off beats freebies beats
training beats regular), so a one-off event that also has freebies just
shows black — the freebies signal disappears. Fixed as two independent
visual layers:

- **Base pin color** (kind + type, one wins in this order):
  **black** = one-off event, **red** = training-type, **white** =
  regular/recurring, non-training.
- **Freebies ring** — a colored ring/border added around *any* pin,
  regardless of its base color, when the event includes freebies. So a
  one-off event with freebies now shows as a **black pin with a ring**
  instead of losing the freebies signal to black.

This base-color rule (kind, then whether the type is training) is written to
generalize to future categories that have a training-equivalent type, not
just running — see `TECHNICAL.md` §4 for the exact logic and how it reads
per-category type lists.

### 4.4 Time scope: "This Week" / "This Month" toggle
The top bar gains a date display plus a segmented toggle (**This Week** /
**This Month**). This is a global scope filter — it controls what's shown
across the map, the list sheet, and the calendar view (§4.9) simultaneously.
Replaces the current "runs this week" banner inside the list sheet.

### 4.5 Event/club card info hierarchy
Reorder and update the detail panel and list rows to show, in this order:
1. **Kind badge** — "Recurring" or "One-off"
2. **Type** — the category's type value (e.g. Training, Social)
3. **Schedule** — recurring shows as a standing slot ("Every Wednesday,
   19:30", see §4.6); one-off shows the specific date + time
4. **Register here** — renamed from the current plain link label
5. **RSVP buttons** — Going / Not going, plus Interested to save it for later (§4.8)
6. **Freebies** — "Freebies included" or nothing shown if false

`location_name`, the map pin, and `notes` stay as supporting info around
this ordered block, same as today.

### 4.6 Recurring events: permanent weekly slot (not a rolling date)
Recurring items are always displayed as a standing weekly slot ("Every
Wednesday, 19:30") — no "next occurrence" language or date rollover shown to
the user. Run Now (§4.11) still computes an actual next-occurrence
internally to sort and time it correctly; that's an implementation detail,
not something the user sees.

### 4.7 Expired one-off events: hidden, never deleted
Once a one-off event's date/time passes, it disappears from the app
immediately — but the record is **never hard-deleted**, per your call. It
stays in the backend indefinitely, available for future history/stats
features, just filtered out of every current view.

### 4.8 RSVP: Going / Not going, and Interested as a saved list
The RSVP itself is two options, **Going** and **Not going**, to keep it simple.
"Not interested" was dropped.

**Interested** stays as a third button, but it means "save this for later", like
a wishlist while shopping. Runs marked Interested collect on the user's own
**Interested list**, a separate page they can open when signed in. A run has one
status at a time, so deciding Going or Not going takes it off the list.

All of it persists per account and syncs across devices, which is what pulls
accounts (§4.8b) into this PRD.

### 4.8b Accounts & sign-in
Sign-in should take one tap. The options are **Continue with Google** and an
**email code**: type your email, get a 6-digit code, type it in, with no password.
**Continue with Apple** is added once the Apple Developer account exists. This
replaces the earlier email + password plan (see `TECHNICAL.md` §5 for why a code
rather than a link).

**Opening the app never asks anyone to sign in.** There's no wall, popup or cookie
banner. Guests get the full app: landing, onboarding, map, list, filters, run
details, Run Now, the calendar, Explore, "Register here" and "Open in Maps".

The sign-in sheet opens only when a guest taps something that has to be saved
to an account:

| Guest taps… | Sheet headline |
|---|---|
| Going / Not going | "Sign in to save your RSVP for *{run}*" |
| Interested | "Sign in to save *{run}* to Interested" |
| Interested (⋯ menu) | "Sign in to see your Interested list" |
| Add to calendar | "Sign in to add *{run}* to your calendar" |
| My runs (calendar) | "Sign in to see your runs" |
| Sign in (⋯ menu) | "Sign in to Velocity" |

The sheet slides up from the bottom. It shows the Google button, then "or" with an
email field, then fine print: *"By continuing you agree to the Terms and Community
Guidelines and acknowledge the Privacy Policy"*, with each linked. That fine print
is the consent record, stored with the Terms version on the profile. **Not now**
closes the sheet and leaves the guest exactly where they were.

After signing in, the action they tapped completes by itself, followed by a
toast such as "Marked going ✓". First sign-in only:
- Google users get their name and photo filled in.
- Email-code users get one optional "What should we call you?" step.
- Any RSVPs and prefs saved on the device come across into the account.

Signed-in users see **Account** in the ⋯ menu:
- Edit name and prefs.
- **Download my data**, a JSON file of their profile and RSVPs.
- **Delete account**, which erases everything immediately.
- Sign out.

Onboarding preferences (`velocity_prefs`) stay on the device for guests and sync
to the profile once signed in.

**My runs** is a toggle on the calendar that shows only the runs the user
marked Going, plus "Add all to calendar". It's only available when signed in.

**Interested** (⋯ menu and the Account panel) is the saved list from §4.8: each
saved run as a card, with a Remove button, opening the run to mark Going. It's
also only available when signed in.

Other people only ever see anonymous totals ("8 going · 5 interested"). Going
in Velocity doesn't register anyone with the club, and the RSVP UI says so next to
"Register here".

**Privacy pages** are `privacy.html`, `terms.html` and `guidelines.html`. They're
static and linked from the landing page and the ⋯ menu. Google's sign-in setup
requires them to be public.

### 4.9 Calendar view
A new view alongside the map/list: a weekly (or monthly, per the §4.4
toggle) grid of day boxes showing the runs scheduled that day. With accounts
on, the calendar highlights the runs the user is Going to; Interested runs are
kept on the Interested list (§4.8) instead. Both are the same per-run status
field, not two separate systems.

### 4.10 Calendar export (add to device calendar)
Each run gets an "Add to calendar" action that downloads a single `.ics`
file for that event — works with Apple Calendar, Google Calendar, Outlook,
and most other calendar apps. Per-event, not a whole-week bundle.

### 4.11 Run Now (updated)
Keeps its current job — always surface something if any non-expired item
exists, preferring what's happening in the near-term window, falling back to
the closest upcoming item — now scoped to the current category (Running) and
respecting the This Week/This Month filter (§4.4) for its candidate pool.
Distance-based sorting ("Nearest first," opt-in) is unchanged.

### 4.12 UI/UX polish
Animations and smoother transitions between views (landing → onboarding →
map, opening/closing panels, switching time scope, map ↔ calendar). Specific
motion spec is an implementation detail, not decided at the PRD level.

### 4.13 Mobile-first + PWA installability
Add a web app manifest, icons, and a minimal service worker so the site is
installable to an iOS home screen. Scope is installability only — no
offline caching of map tiles or run data in this pass.

## 5. Branding

Kept as-is for now: "VelocityAE," tagline "Find your next run," the RUNNow
button, and the running-shoe pin icon all stay unchanged even though the
underlying system now supports multiple categories. If/when a second
category actually launches, the running-specific language will likely need
a second look — flagged here for later, not addressed in this PRD.

## 6. Rollout plan (product-level)

1. Backend + accounts foundation (see `TECHNICAL.md` §5–6)
2. Telegram bot repointed to the new backend, so data entry doesn't regress
3. Frontend reads from the new backend; new card hierarchy (§4.5), pin
   visuals (§4.3), "Register here" label, recurring-as-permanent-slot (§4.6)
4. Map migration to MapLibre (§4.2)
5. Accounts + RSVP live (§4.8, §4.8b)
6. Calendar view + This Week/Month toggle (§4.4, §4.9), expired-event
   hiding (§4.7)
7. Calendar export (§4.10)
8. PWA + polish (§4.12, §4.13)

Engineering-level detail for each phase is in `TECHNICAL.md` §7.
