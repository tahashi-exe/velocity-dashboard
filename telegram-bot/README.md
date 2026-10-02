# Velocity private Telegram admin bot

A private assistant for maintaining VelocityAE's runs: `clubs.json` and
`events.json` on GitHub, and the `runs` table in the app's database. It is
separate from the GitHub Pages website and runs as a Supabase Edge Function
(see [Where it runs](#where-it-runs) below), so there is no server to keep
alive and nothing to pay for.

There is no AI involved. The bot sends one block containing every field; you
fill it in and send it back as a single message, add photos, then get a
preview. Nothing is written until you press **Approve and publish**; that's
the only step that creates a GitHub commit, and GitHub Pages redeploys from it
automatically.

Photos are the one thing not in the block — a Telegram attachment is always
its own message — so they're asked for immediately after it.

## 1. Create the bot

1. In Telegram, open [@BotFather](https://t.me/BotFather).
2. Send `/newbot`, choose a display name and username, and save the token.
3. Start a private chat with your new bot and send it `/start`.

You use this bot directly from your normal Telegram account — no second
account needed.

## 2. Give it its secrets

The bot needs four values. They are entered once in the Supabase dashboard and
never appear in this repo. `supabase/SETUP.md` Part 5 walks through it click by
click.

| Secret | What it is |
|---|---|
| `TELEGRAM_BOT_TOKEN` | The token from @BotFather |
| `TELEGRAM_ADMIN_CHAT_ID` | Your *numeric* Telegram ID (send any message to @userinfobot). This is the access check: the bot answers nobody else. Your `@username` is not used, because usernames can change |
| `GITHUB_TOKEN` | A fine-grained personal access token limited to this repository, with **Contents: Read and write** |
| `GITHUB_REPOSITORY` | `owner/repository-name` |

`GITHUB_BRANCH` is optional and defaults to `main`. The database address and
key are supplied by Supabase itself.

Never commit a token, paste one into a chat, or put any of these values in the
website's JavaScript. A token that has been pasted somewhere should be replaced:
`/revoke` in @BotFather, or delete and recreate the GitHub token.

## How to use it

| Command | What it does |
|---|---|
| `/newclub` | Walks you through a new recurring club |
| `/newevent` | Walks you through a new one-off event |
| `/editclub <exact name>` | Field menu for an existing club — change just one thing |
| `/editevent <exact name>` | Field menu for an existing event |
| `/listclubs` / `/listevents` | Names of everything currently in the data |
| `/cancel` | Drop whatever you were part-way through |

`/editclub` and `/editevent` with **no name** list the existing records as
tappable buttons, so you don't have to get the spelling right on a phone.

### Adding something new

Send `/newclub` (or `/newevent`). The bot replies with one block containing
every field:

```
name: 
location_name: 
location: maps link, or 25.1950, 55.2358
type: social | tempo | training | long_run | pyramid
surface: track | beach | road | indoor
freebies: yes | no
cost: free | paid
price: only if paid, e.g. AED 50
day: monday | tuesday | wednesday | thursday | friday | saturday | sunday
time: HH:MM (24-hour)
link: https://...
notes: optional
```

Tap the block to copy it, replace the value after each colon, and send the
whole thing back as **one message**. Events get a `date: YYYY-MM-DD` line
instead of `day:`.

A few things worth knowing:

- **Placeholders count as blank.** Leave `notes: optional` untouched and it
  publishes as empty, not as the literal word "optional". Same for every
  other hint.
- **Only the first colon splits a line**, so `https://` links and notes like
  `Meet at 6: sharp` survive intact.
- **`price` is ignored unless `cost` is `paid`.** No need to clear it.
- **Everything wrong comes back in one list** — fix it all and resend the
  block once, rather than a round trip per mistake.
- **`freebies` vs `cost`** are independent: cost is whether you pay to *take
  part*, freebies is free stuff handed out on the day. A free run can hand out
  free coffee; a paid race can hand out a free finisher tee.

Once the block validates, the bot asks for **photos** — up to 3, either
attached directly in the chat (the bot downloads and stages them) or pasted
as direct image links, one per line. Mix and match freely. Tap **Done** when
finished, or **Skip** if there are none. Photos are separate because a
Telegram attachment is always its own message and can't ride inside pasted
text.

Then you get a preview with **Approve and publish**, **Edit the form**, and
**Reject**. Approve creates one GitHub commit, stamps `last_updated` with
today's Dubai date, and replies with the commit link. Wait about 1–2 minutes
for GitHub Pages to deploy, then refresh VelocityAE.

### The database

Approve does a second write after the GitHub commit: the same record goes into
the `runs` table that the app reads once accounts are switched on
(`TECHNICAL.md` §8). The reply then says **Published to GitHub and saved to
the database**.

The JSON files stay the bot's source of truth: `/editclub` and the lists still
read from GitHub, and the app keeps the JSON files as its fallback.

- An edit updates the database row the record had before the edit, so renaming
  a club keeps its row and everyone's RSVPs for it.
- If the commit succeeds but the database write fails, the bot says so and
  keeps the draft. Tap **Approve and publish** again to retry just the database;
  nothing is committed twice. **Edit the form** is refused at that point, since
  the commit is already in, and **Reject** leaves things as they are.

### The location line — three ways

- **Paste a Google Maps link**: Share → Copy link. Full links and shortened
  `maps.app.goo.gl` ones both work; the bot follows the redirect (and Google's
  consent page) to find the coordinates.
- **Type the numbers**: `25.1950, 55.2358`. In Maps, right-click the pin and
  the coordinates are at the top of the context menu.
- **Drop a Telegram pin** (paperclip → Location). A pin can't be typed into a
  pasted block, so the bot replies with the coordinates as copyable text for
  you to paste into the `location:` line.

Coordinates are rounded to six decimal places — roughly 10cm, far finer than
any meeting point needs. If a link doesn't yield coordinates (rare — usually
an odd redirect), the bot says so and you can use either of the other ways.

### Editing something that already exists

`/editclub Frame Run Club` sends the same block, pre-filled with what's
already stored:

```
name: Frame Run Club
location_name: Dubai Design District
location: 25.1866742, 55.3019726
type: training
surface: road
freebies: no
cost: free | paid
day: wednesday
time: 19:30
link: https://www.instagram.com/framerunclub
notes: optional
```

Change the lines you need, leave the rest, and send it back. Any field with no
stored value shows its placeholder instead — above, `cost` was added after this
record was written, so it still needs answering.

Fields the bot no longer asks about (the retired `pace`) are kept in the JSON
exactly as they were — the edit merges over the stored record rather than
replacing it.

Older records can hold values the form no longer accepts: `LFG` still stores
the retired run type `track`, which isn't one of the five options. Those are
caught before the preview and sent back to the form for fixing.

### Run types

The five types match the filter chips in the live app exactly
(`data.js` → `CATEGORIES.running.types`): **social**, **tempo**, **training**,
**long_run**, **pyramid**. Older records storing `track` are read as
*training* by the site, so nothing breaks until you edit them.

## Drafts

Whatever you've entered so far is saved after every message and deleted the
moment you publish or cancel, so you can leave an entry half-finished and come
back to it. Send any message and the bot carries on from where it was; a draft
left alone for a week is dropped.

On Supabase the drafts live in the `bot_sessions` table. They have to: the
function keeps nothing in memory between two messages.

## Current limits

- The bot only accepts messages from the configured Telegram chat ID.
- Photos are accepted and stored as-is (uploaded straight into the repo
  under `club-photos/`) — the bot never looks *at* what's in them. No
  screenshot parsing or auto-cropping; that would need an AI step, which
  this version deliberately doesn't use.
- Attached photos are only fetched from Telegram and uploaded to GitHub at
  **Approve and publish**, same as every other field — but if publishing
  fails partway (photos land, then the `clubs.json`/`events.json` write
  fails), the already-uploaded photos stay on GitHub rather than rolling
  back; retrying Approve won't re-upload them.
- One entry at a time per chat; starting `/newclub` drops any earlier draft.
- `/editclub` / `/editevent` match on exact existing name (case-insensitive).
  Renaming is fine — edit the Name field; the bot still knows which original
  record to replace.

## Where it runs

As a Supabase Edge Function named `telegram-bot`, in the same project as the
app's database. Telegram delivers each message to it as a web request (a
webhook), the function handles it and goes back to sleep.

It used to run on Railway as an always-on process. Railway's free trial ended
and every deployment there was removed, which is why it moved.

### How the code is laid out

| File | What it is |
|---|---|
| `src/bot.js` | The bot itself: every command, message handler and button |
| `src/template.js` | Field definitions, validation and the paste-back form |
| `src/github.js`, `src/supabase.js`, `src/run-row.js` | The two writes a publish makes, and the record → database row mapping |
| `src/session-store.js` | Drafts in the `bot_sessions` table |
| `src/edge.ts` | Entry point on Supabase: webhook in, `bot.js` does the rest |
| `src/index.js` | Entry point under Node, for running it on your own machine |

`bot.js` uses nothing that only exists in Node, and is handed grammy by
whichever entry point starts it, so the same file runs in both places.

### Shipping a change

The function doesn't hold a copy of the code. `supabase/functions/telegram-bot/index.ts`
is one line that loads `src/edge.ts` from GitHub **at one exact commit**, so
what runs is byte for byte what was tested and pushed.

1. Run `npm test`, commit and push.
2. Put that commit's full id in `supabase/functions/telegram-bot/index.ts`.
3. Deploy that file as the function `telegram-bot`, with JWT verification
   **off** (Telegram can't send a Supabase token; see below for what protects
   it instead). With the Supabase CLI:

   ```bash
   supabase functions deploy telegram-bot --no-verify-jwt
   ```

4. Open `https://<project-ref>.supabase.co/functions/v1/telegram-bot?setup` once.
   It tells Telegram where to send messages and answers with the bot's
   username and the webhook address.

Pushing alone changes nothing: the function keeps running the commit it was
deployed with.

### Checking on it

`https://<project-ref>.supabase.co/functions/v1/telegram-bot` answers
`{"ok":true}` when all four secrets are set, or lists the names of the ones
that are missing. Opening it with `?setup` also reports how many messages are
waiting and the last delivery error, if any. Neither ever shows a secret.
Detailed logs are in the Supabase dashboard under Edge Functions.

### What protects it

The function's address is public, as any webhook's is. Every message Telegram
sends carries a secret header; grammy rejects a request without the right one.
That secret is derived from the bot token, so nothing extra has to be stored,
and replacing the token changes it: run `?setup` again after a `/revoke`.

On top of that the bot only answers `TELEGRAM_ADMIN_CHAT_ID`.

### Running it locally

For trying a change before shipping it:

```bash
npm install
cp .env.example .env    # then fill in the four values
npm start
```

**This takes the bot over.** A bot can be reached by webhook or by polling, not
both, and starting it locally removes the webhook. Messages then come to your
machine until you stop it (`Ctrl-C`) and open the `?setup` address again to
hand the bot back to Supabase.

Locally, drafts are kept in a file (`DRAFTS_FILE`, by default in the system
temp directory), and the database write only happens if `SUPABASE_URL` and
`SUPABASE_SECRET_KEY` are in `.env`.

## Tests

```bash
npm test
```

Covers form rendering, parsing, validation, the conditional price, legacy
records and the session state machine (`template.test.js`); the database row
mapping and both stores (`database.test.js`); and whole conversations driven
through real grammy with Telegram, GitHub and Supabase scripted
(`bot.test.js`). Those last ones build a fresh bot for every message, the way
the Edge Function can, so anything that only works by staying in memory fails.

Node's built-in runner, no test dependency. Everything runs offline — no
Telegram, no GitHub, no secrets — so it's safe to run anywhere, including CI.

`npm run form` prints the blank block for both collections. Run it after
changing any field and update `claude-skill/SKILL.md` if the output no longer
matches the two code blocks in there.
