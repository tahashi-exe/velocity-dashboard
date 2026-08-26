# Velocity private Telegram admin bot

A private assistant for maintaining VelocityAE's `clubs.json` and `events.json`.
It is separate from the GitHub Pages website and runs as its own always-on
Node.js process (see [Deploying to Railway](#deploying-to-railway) below).

There is no AI involved. The bot asks you one question at a time — with
buttons wherever there is a fixed set of answers — then shows you a preview.
Nothing is written until you press **Approve and publish**; that's the only
step that creates a GitHub commit, and GitHub Pages redeploys from it
automatically.

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

Send `/newclub` (or `/newevent`). The bot then asks, one message at a time:

1. **Name** — type it exactly as it should appear on the map.
2. **Meeting point** — the place name people recognise ("Kite Beach").
3. **Map pin** — three ways, whichever is easiest (see below).
4. **Run type** — buttons: Social · Tempo · Training · Long run · Pyramid session.
5. **Surface** — buttons: Track · Beach · Road · Indoor.
6. **Freebies** — buttons: Yes · No.
7. **Day** (clubs) — buttons, Monday…Sunday.
   **Date** (events) — typed, `YYYY-MM-DD`.
8. **Start time** — typed, 24-hour `HH:MM`.
9. **Link** — Instagram profile or booking page, must start with `https://`.
10. **Photos** — optional, up to 3. Attach photos directly in the chat (the
    bot downloads and stages them) or paste direct image links, one per
    line — mix and match freely. Tap **Done** once you have what you want,
    or **Skip** for none.
11. **Notes** — optional; tap **Skip** if there's nothing.

Every question carries **Back** and **Cancel**; Notes and Photos also carry
**Skip** (Photos shows **Done** instead once at least one photo is added).
Anything typed that doesn't validate gets a plain-English reason and the same
question again — nothing else is lost. Fixed-choice fields are buttons, so an
invalid run type or day is impossible in the first place.

After the last question you get a preview with **Approve and publish**,
**Edit a field**, and **Reject**. Approve creates one GitHub commit, stamps
`last_updated` with today's Dubai date, and replies with the commit link.
Wait about 1–2 minutes for GitHub Pages to deploy, then refresh VelocityAE.

### The map pin — three ways

- **Drop a Telegram pin** (easiest on mobile): paperclip → Location → send.
- **Paste a Google Maps link**: Share → Copy link. Full links and shortened
  `maps.app.goo.gl` ones both work; the bot follows the redirect (and Google's
  consent page) to find the coordinates.
- **Type the numbers**: `25.1950, 55.2358`. In Maps, right-click the pin and
  the coordinates are at the top of the context menu.

If a link doesn't yield coordinates (rare — usually an odd redirect), the bot
says so and you can use either of the other two ways.

### Editing something that already exists

`/editclub Frame Run Club` shows the whole record as a list, with one button
per field:

```
Editing club "Frame Run Club"

Name: Frame Run Club
Meeting point: Dubai Design District
Map pin: 25.1866742, 55.3019726
Run type: Training
Surface: Road
Freebies: No
Day: Wednesday
Start time: 19:30
Link: https://www.instagram.com/framerunclub
Notes: (none)
```

Tap **Start time**, send `19:00`, and you're straight back at this list — no
re-walking the other nine questions. Tap **Review and publish** when you're
done, then **Approve and publish** on the preview.

A field flagged `⚠️` is one the bot can't publish as-is. That happens with
older records: `LFG` still stores the retired run type `track`, so editing it
asks you to pick one of the five real types before publishing. Fields the bot
no longer asks about (the retired `pace`) are kept in the JSON exactly as they
were.

### Run types

The five types match the filter chips in the live app exactly
(`data.js` → `CATEGORIES.running.types`): **social**, **tempo**, **training**,
**long_run**, **pyramid**. Older records storing `track` are read as
*training* by the site, so nothing breaks until you edit them.

## Drafts

Answers are written to a small JSON file after every step and deleted the
moment you publish or cancel. If the process restarts mid-entry, the bot picks
the session back up and re-asks the question you were on.

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

This keeps the bot running without your computer staying on.

1. Push this repo to GitHub if you haven't already (it already is, at
   `tahashi-exe/velocity-dashboard`).
2. In [Railway](https://railway.app), **New Project → Deploy from GitHub repo**,
   pick this repository.
3. Railway will try to build from the repo root — open the service's
   **Settings** and set **Root Directory** to `telegram-bot`. It auto-detects
   Node and runs `npm install` then `npm start`.
4. In the service's **Variables** tab, add `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_ADMIN_CHAT_ID`, `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, and
   `GITHUB_BRANCH` — same values as your local `.env`. Do not commit `.env`
   itself; Railway's variables are separate from the repo.
5. Deploy. Check the **Logs** tab for `Velocity Telegram bot is running.`
6. Send `/start` to your bot from Telegram to confirm it responds.

The bot uses long-polling (not a webhook), so it doesn't need an HTTP port
or a public URL — Railway just needs to keep the process alive, which the
free trial covers for a low-traffic personal bot like this one.
