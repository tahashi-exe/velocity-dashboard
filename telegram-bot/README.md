# Velocity private Telegram admin bot

A private assistant for maintaining VelocityAE's `clubs.json` and `events.json`.
It is separate from the GitHub Pages website and runs as its own always-on
Node.js process (see [Deploying to Railway](#deploying-to-railway) below).

There is no AI involved. The bot sends you a fill-in-the-blanks template for
a club or event, you edit the values in Telegram and send it back, and the
bot shows you a preview. Nothing is written until you press **Approve and
publish** — that's the only step that creates a GitHub commit, and GitHub
Pages redeploys from it automatically.

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
| `/newclub` | Blank template for a new recurring club |
| `/editclub <exact name>` | Template pre-filled with an existing club's values |
| `/newevent` | Blank template for a new one-off event |
| `/editevent <exact name>` | Template pre-filled with an existing event's values |
| `/listclubs` / `/listevents` | Names of everything currently in the data, so you know the exact spelling to pass to `/editclub` / `/editevent` |
| `/cancel` | Discard whatever template you were mid-way through filling in |

Flow:

1. Send `/newclub` (or `/editclub "Frame Run Club"`, etc).
2. The bot replies with a template like:
   ```
   name: 
   location_name: 
   maps_link: (optional — paste a Google Maps link and leave lat/lng below blank)
   lat: 
   lng: 
   pace: easy / social | tempo | training
   type: social | training | track
   surface: track | beach | road
   freebies: yes or no
   day: monday | tuesday | wednesday | thursday | friday | saturday | sunday
   time: HH:MM, 24h, e.g. 18:30
   link: 
   notes: (optional)
   ```
3. Copy it, fill in every value after each `key:` (for edits, only change what's
   different — the rest is already filled in), and send it back as one message.
4. If something's missing or invalid, the bot tells you exactly which field
   and why — fix it and resend the whole template.
5. Once it parses cleanly, you get a preview with **Approve and publish** /
   **Reject** buttons. Approve creates one GitHub commit and replies with its
   link. Reject discards it — nothing changes.
6. Wait about 1–2 minutes for GitHub Pages to deploy, then refresh VelocityAE.

**Coordinates:** open the spot in Google Maps, tap Share → Copy Link, and
paste that into `maps_link:` — leave `lat:`/`lng:` blank and the bot fills
them in automatically (works with both full links and shortened
`maps.app.goo.gl` ones). If it can't find coordinates in the link (rare —
usually an odd redirect), it'll tell you, and you can paste the lat/lng
numbers directly instead: right-click the pin in Maps and they're at the top
of the context menu.

## Current limits

- The bot only accepts messages from the configured Telegram chat ID.
- Text only — no screenshot/photo parsing (that required the AI step, which
  this version deliberately doesn't use).
- Pending templates and unapproved previews are held in memory. If the bot
  restarts before you approve, just resend the update.
- `/editclub` / `/editevent` match on exact existing name (case-insensitive).
  Renaming is fine — edit the `name:` line in the template; the bot still
  knows which original record to replace.

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
