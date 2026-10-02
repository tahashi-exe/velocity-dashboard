# Supabase backend

Schema and data import for the backend described in `TECHNICAL.md` §2 and §5–6.
Nothing in the live site reads from Supabase yet. The site still uses
`clubs.json` and `events.json` until cutover (`TECHNICAL.md` §11).

**Project:** `velocity-dev` (Mumbai / `ap-south-1`, ref `lxbawcwywniasqiriske`,
`https://lxbawcwywniasqiriske.supabase.co`) has the migration and seed applied.
It is the only project, and for the friends phase it is also the live one. A
separate production project comes before a public launch.

**Setting up sign-in:** [`SETUP.md`](SETUP.md) walks through the dashboard
steps: the email sender, email templates, addresses, Google sign-in and the
bot's key.

| File | What it is |
|---|---|
| `migrations/20260930000000_init.sql` | Tables, row-level security, triggers, `run_counts()`, `delete_my_account()`, and the `running` category and type rows |
| `migrations/20261002000000_bot_sessions.sql` | The Telegram bot's drafts table. Service key only |
| `functions/telegram-bot/index.ts` | The bot's Edge Function: one line that loads `telegram-bot/src/edge.ts` from GitHub at a pinned commit (added when the bot is first deployed) |
| `seed-from-json.mjs` | Turns `clubs.json` and `events.json` into `seed.sql`. It builds rows with `telegram-bot/src/run-row.js`, the same mapping the bot uses, so run slugs match the ids the app uses today |
| `seed.sql` | Generated output. Regenerate it right before cutover so records the bot added since are included |

## Applying it

With the Supabase CLI (`brew install supabase/tap/supabase`):

```bash
supabase init            # once. Creates config.toml and keeps this migrations folder
supabase link --project-ref <project-ref>
supabase db push         # applies migrations/
node supabase/seed-from-json.mjs > supabase/seed.sql
```

Then run `seed.sql` in the dashboard's SQL editor. It's an idempotent upsert on
`slug`, so running it again only refreshes rows.

A new project (a future production one) needs all of this. On `velocity-dev`
only the seed is ever re-run, to bring the table back in line with the JSON
files.

## Access model

| Role | Can do |
|---|---|
| `anon` (guest, publishable key) | Read `categories`, `category_types`, `runs`. Call `run_counts()` |
| `authenticated` (signed in) | The same, plus read and update their own `profiles` row, and read, add, change and clear their own `rsvps`. Call `delete_my_account()` |
| Secret key (Telegram bot, dashboard) | Everything. Keep it server-side only (Railway env) and never in this repo or the frontend |

`rsvp_log` records every RSVP change and has no API access at all. Read it from
the dashboard.
