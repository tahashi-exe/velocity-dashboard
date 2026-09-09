# Velocity intake skill

Turns a screenshot, poster, or typed details into a **filled-in bot form** —
one paste-ready block matching the field format the Velocity Telegram bot
expects.

## Why a form block

On `/newclub` the bot replies with one `key: value` line per field and waits
for the whole thing back. It parses every line at once and reports every
problem together, so a complete correct block publishes in a single message.
That makes "get the values right" the entire job — which is what Claude is
useful for, and why the bot itself stays deterministic with no AI in it.

## Setup (once)

On desktop, claude.ai → Settings → Capabilities → Skills → upload `SKILL.md`
(zip this folder if an archive is required). Skills sync to the mobile app.

## Daily use

1. Screenshot the post (or Share → Claude from Instagram).
2. Send it to Claude. The skill fires on its own. Include the post URL in the
   same message if you have one — `link:` is required and must be `https://`.
3. Claude replies with the command to send and a filled-in block, plus a note
   on anything it inferred or couldn't find.
4. In Telegram: send `/newclub`, then paste the block as one message.
5. Attach photos when asked, or Skip. Check the preview. **Approve and
   publish**.

## What the output looks like

> Send `/newclub`, then paste:

```
name: Sunrise Runners
location_name: La Mer, Jumeirah
location: 25.2364, 55.2622
type: social
surface: beach
freebies: yes
cost: free
price: only if paid, e.g. AED 50
day: friday
time: 06:00
link: https://instagram.com/sunriserunners
notes: 5k and 10k routes
```

> The post doesn't say whether it costs anything — I read "all welcome" as
> free, worth confirming. `price:` is left as-is since it's ignored on a free
> run.

Two details that look wrong but aren't: `price:` still showing its hint text
is correct on a free run (the line is skipped), and `notes: optional` left
untouched counts as blank rather than publishing the word "optional".

## Keeping it aligned with the bot

`SKILL.md` hardcodes both form blocks so Claude doesn't have to read the
source. That's a copy, and copies drift — adding Cost and Price mid-flow
already invalidated one earlier version of this file.

After changing anything in `template.js`, run:

```
npm run form
```

and update the two code blocks in `SKILL.md` if the output no longer matches.
No secrets or network involved.
