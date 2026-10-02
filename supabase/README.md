# Supabase backend

Schema and data import for the backend described in `TECHNICAL.md` §2 and §5–6.
Nothing in the live site reads from Supabase yet. The site still uses
`clubs.json` and `events.json` until cutover.

**Projects:** `velocity-dev` (Mumbai / `ap-south-1`, ref `lxbawcwywniasqiriske`,
`https://lxbawcwywniasqiriske.supabase.co`) has the migration and seed applied.
There is no prod project yet; it gets created at cutover.

| File | What it is |
|---|---|
| `migrations/20260930000000_init.sql` | Tables, row-level security, triggers, `run_counts()`, `delete_my_account()`, and the `running` category and type rows |
| `seed-from-json.mjs` | Turns `clubs.json` and `events.json` into `seed.sql`. It uses the same normalization as `data.js` `toRun()`, so run slugs match the ids the app uses today |
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

Do this on `velocity-dev` first, then on `velocity-prod` on cutover day.

## Access model

| Role | Can do |
|---|---|
| `anon` (guest, publishable key) | Read `categories`, `category_types`, `runs`. Call `run_counts()` |
| `authenticated` (signed in) | The same, plus read and update their own `profiles` row, and read, add, change and clear their own `rsvps`. Call `delete_my_account()` |
| Secret key (Telegram bot, dashboard) | Everything. Keep it server-side only (Railway env) and never in this repo or the frontend |

`rsvp_log` records every RSVP change and has no API access at all. Read it from
the dashboard.
