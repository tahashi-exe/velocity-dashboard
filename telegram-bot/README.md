# Velocity private Telegram admin bot

This is a private assistant for maintaining VelocityAE's `clubs.json` and
`events.json`. It is separate from the GitHub Pages website and must run on a
computer or a small Node.js host that stays online.

It accepts a text message, a forwarded Telegram post, or a screenshot. The bot
uses the OpenAI Responses API to produce a structured proposal. It does not
write anything until the owner presses **Approve and publish**. Approval writes
one GitHub commit; GitHub Pages then redeploys the site.

## 1. Create the bot

1. In Telegram, open [@BotFather](https://t.me/BotFather).
2. Send `/newbot`, choose a display name and username, and save the token.
3. Start a private chat with your new bot and send it `/start`.

You use this bot directly from your normal Telegram account. You do not need a
second personal account.

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
access control check—your `@cool_cat67` username is not used because usernames
can change.

Create a GitHub fine-grained personal access token limited to the Velocity
repository with **Contents: Read and write** permission. Add it as
`GITHUB_TOKEN`; set `GITHUB_REPOSITORY` to `owner/repository-name` and leave
`GITHUB_BRANCH=main` unless you deploy from another branch.

Create an OpenAI API key and add it as `OPENAI_API_KEY`. The bot uses the
Responses API with structured JSON output; `OPENAI_MODEL=gpt-5` is the default
and can be changed later after testing.

Never commit `.env`, paste a bot token into chat, or put any of these values in
the website JavaScript.

## 3. Run it

```bash
npm start
```

For development, keep that terminal open. For everyday use, deploy this folder
to an always-on Node.js host that supports a persistent process (for example,
Render, Railway, Fly.io, or a small VPS), then configure the same environment
variables in that host's dashboard. GitHub Pages cannot run a Telegram bot.

## How to use it

1. Send or forward a club/event announcement to your bot. Text works best;
   screenshots also work, especially with a short caption.
2. Include as much as you have: club/event name, date or weekday, time,
   location, event link, pace/type, and a Google Maps link for the meeting
   point.
3. The bot replies with a proposed `clubs.json` or `events.json` record.
4. If information is missing, send the requested details and resend the update.
5. Press **Approve and publish** only after checking the preview. The bot will
   create a GitHub commit and reply with its link.
6. Wait about 1–2 minutes for GitHub Pages to deploy, then refresh VelocityAE.

Example submission:

```text
Frame Run Club is moving to Thursday at 7:00pm.
Meet at Dubai Design District, Building 6.
Training road session. https://instagram.com/framerunclub
Maps: https://maps.google.com/?q=25.1866742,55.3019726
```

## Current limits

- The bot only accepts messages from the configured Telegram chat ID.
- It does not scrape Instagram or WhatsApp; it analyzes only what you send.
- Pending approval previews are stored in memory. If the bot restarts before
  approval, resend the update.
- The bot asks for exact coordinates instead of inventing them.
