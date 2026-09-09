# Velocity private Telegram admin bot

A private assistant for maintaining VelocityAE's `clubs.json` and `events.json`.
It is separate from the GitHub Pages website and runs as its own always-on
Node.js process (see [Deploying to Railway](#deploying-to-railway) below).

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

## 2. Install and configure

From this directory:

```bash
npm install
cp .env.example .env
```

Fill in `TELEGRAM_BOT_TOKEN`, then discover your numeric chat ID:

```bash
npm run discover-chat-id
```

Copy the printed number into `TELEGRAM_ADMIN_CHAT_ID` in `.env`. This is the
access control check — your `@username` is not used because usernames can
change.

Create a GitHub fine-grained personal access token limited to the Velocity
repository with **Contents: Read and write** permission. Add it as
`GITHUB_TOKEN`; set `GITHUB_REPOSITORY` to `owner/repository-name` and leave
`GITHUB_BRANCH=main` unless you deploy from another branch.

Optionally set `DRAFTS_FILE` to control where in-progress answers are saved
(see [Drafts](#drafts) below). The default is a file in the system temp
directory, which is fine everywhere.

Never commit `.env`, paste a bot token into chat, or put any of these values
in the website JavaScript.

## 3. Run it locally

```bash
npm start
```

Keep that terminal open while testing. For everyday use, deploy it — see
below.

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

Answers are written to a small JSON file whenever they change and deleted the
moment you publish or cancel. If the process restarts mid-entry, the bot picks
the session back up and re-sends whatever it was waiting on — the form
pre-filled with what you'd already entered, the photos prompt, or the preview.

**This protects against restarts and crashes, not redeploys.** Railway gives
each deploy a fresh filesystem, so anything half-finished when you push new
code is gone — start it again. Set `DRAFTS_FILE` to a path on a mounted volume
if you ever want drafts to survive deploys too.

## Current limits

- The bot only accepts messages from the configured Telegram chat ID.
- Photos are accepted and stored as-is (uploaded straight into the repo
  under `club-photos/`) — the bot never looks *at* what's in them. No
  screenshot parsing or auto-cropping; that would need an AI step, which
  this version deliberately doesn't use.
- Attached photos are staged locally and only uploaded to GitHub at
  **Approve and publish**, same as every other field — but if publishing
  fails partway (photos land, then the `clubs.json`/`events.json` write
  fails), the already-uploaded photos stay on GitHub rather than rolling
  back; retrying Approve won't re-upload them.
- One entry at a time per chat; starting `/newclub` drops any earlier draft.
- `/editclub` / `/editevent` match on exact existing name (case-insensitive).
  Renaming is fine — edit the Name field; the bot still knows which original
  record to replace.

## Deploying to Railway

This keeps the bot running without your computer staying on. It's live now as
the `velocity-telegram-bot` project.

> **`git push` does not deploy the bot.** The service is **not** connected to
> a GitHub repo — it's deployed by uploading this directory with the Railway
> CLI. Pushing to `main` updates the website (GitHub Pages) but leaves the bot
> running whatever was last uploaded. This has already caused one round of
> "why is the bot still on the old version?", so it's worth remembering.

### Shipping a change

From this directory:

```bash
railway up
```

That uploads the folder, builds it, and swaps the container over. Files listed
in `.gitignore` — including `.env` — are excluded, so secrets stay out of the
upload; Railway supplies them from its own **Variables** instead.

Confirm it took with `railway status` (the active deployment's timestamp should
be the moment you deployed) and `railway logs` (look for
`Velocity Telegram bot is running.`). Then send `/newclub` in Telegram: the new
flow replies with one copy-paste block, the old one asked "Name — step 1 of 12".

Expect a single `409` in the logs right after a deploy — the outgoing container
drains while the new one starts, so for a second or two both are polling. It
restarts itself and settles. A 409 that keeps repeating means something else is
polling; see below.

### Variables

Set in the service's **Variables** tab, not in the repo: `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_ADMIN_CHAT_ID`, `GITHUB_TOKEN`, `GITHUB_REPOSITORY`. `GITHUB_BRANCH`
is optional and defaults to `main`; `DRAFTS_FILE` is optional too (see
[Drafts](#drafts)).

Railway auto-detects Node and runs `npm install` then `npm start`. No
Dockerfile, Procfile or `railway.json` is needed — `package.json` (including
`engines.node >= 20`) is the whole build contract.

### If you'd rather push-to-deploy

Connect the service to the GitHub repo in Railway's **Settings → Source**, and
set **Root Directory** to `telegram-bot` so it builds the right folder. After
that `git push` deploys the bot as well as the site, and `railway up` is no
longer needed.

### Only one copy can run at a time

Telegram allows a single long-polling client per bot token. If the bot is
running on your laptop *and* on Railway, Telegram rejects the second one with
`409 Conflict: terminated by other getUpdates request`, and the two will trade
messages unpredictably — some of your replies reaching one process, some the
other.

So before running it locally, pause the Railway service — otherwise the two
kill each other in a loop: each restart displaces the other's poll, which
crashes it, which restarts it. Stop a local copy with `Ctrl-C` or
`pkill -f "node src/index.js"`. A 409 repeating in either set of logs means
both are live.

Note that a plain `getUpdates` call can't detect this — a fresh call always
*wins* the slot, so it succeeds whether or not something else is polling. Only
a long-lived poll reveals a competitor, by being displaced. `railway logs` is
the quicker check.

### No HTTP port is expected

The bot long-polls rather than serving a webhook, so it needs no port and no
public URL. Railway may still show a "no open ports detected" notice on the
service — that's expected for a worker process and not a failure. Don't add a
healthcheck; there's nothing to answer it.

A low-traffic personal bot like this sits comfortably inside the free trial's
usage.

## Tests

```bash
npm test
```

Covers form rendering, parsing, validation, the conditional price, legacy
records, and the session state machine. Node's built-in runner, no test
dependency. Everything runs offline — no Telegram, no GitHub, no secrets — so
it's safe to run anywhere, including CI.

`npm run form` prints the blank block for both collections. Run it after
changing any field and update `claude-skill/SKILL.md` if the output no longer
matches the two code blocks in there.
