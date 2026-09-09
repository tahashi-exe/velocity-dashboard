---
name: velocity-intake
description: Turn a screenshot, poster, Instagram post, or typed details about a Dubai run club or run event into a filled-in Velocity bot form — one paste-ready block matching the bot's exact field format. Use whenever Taha shares run club or run event information to add to the Velocity map.
---

# Velocity — run club intake

Taha adds runs to the Velocity map through a Telegram bot. On `/newclub` or
`/newevent` the bot replies with a **form block** — one `key: value` line per
field — and waits for the whole thing to be sent back filled in. It parses
every line at once and reports every problem together.

So the output here is exactly that block, filled in, ready to paste as a
single Telegram message. Not a summary, not JSON, not prose.

## Getting the content

- **Screenshot or poster (best)** — read the caption, on-image text, and any
  visible location tag.
- **Typed details** — use as given.
- **A bare Instagram URL** — Instagram blocks fetching, so the link cannot be
  read. Never guess at what the post says; ask for a screenshot and keep the
  URL for the `link:` line.

## Pick the command

- **`/newclub`** — repeats weekly ("every Tuesday", "weekly social run").
  Uses a `day:` line. Default to this when unsure.
- **`/newevent`** — a single dated occasion: a race, a pop-up, a "special
  edition". Uses a `date:` line instead.

## Output

Say which command to send, then give the block in a code fence so it is one
tap to copy. Every line must be present — a missing line for a required field
is an error. Use the lowercase values exactly as listed.

### `/newclub`

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

### `/newevent`

Identical, but `day:` is replaced by `date: YYYY-MM-DD`.

## Field rules

The bot validates every line and lists all problems at once, so a wrong value
costs one round trip for the whole form. Get these exactly right.

- **name** — the club's own name as written in the post. Do not derive it from
  the account handle if the post names the club differently.
- **location_name** — the recognisable place name only ("Kite Beach", "Orto
  Cafe, Jumeirah"), not a full address.
- **location** — `lat, lng` only for a place you can position confidently (a
  well-known Dubai landmark). Otherwise **leave the hint line untouched** and
  say in your reply that the pin needs setting by hand — a Google Maps link
  pasted on that line also works. Never approximate coordinates: a wrong pin
  on a public map is worse than one Taha fixes in five seconds.
- **type** — one of `social`, `tempo`, `training`, `long_run`, `pyramid`.
  Use the underscored value, not the display label. "Easy 5k, all welcome" is
  `social`; a coached or interval session is `training`; a stadium or 400m loop
  is `training` with `surface: track`.
- **surface** — one of `track`, `beach`, `road`, `indoor`.
- **freebies** — `yes` only if the post mentions something actually free on
  the day (coffee, breakfast, merch, samples). Silence means `no`.
- **cost** — whether you pay to **take part**. A different question from
  freebies, and independent of it: a free run handing out free coffee is
  `cost: free` + `freebies: yes`; a paid race with a free finisher tee is
  `cost: paid` + `freebies: yes`. Look for "free to join" / "no charge" on one
  side, and an entry fee, ticket link, "AED 50", or a paid booking platform
  (Platinumlist, Eventbrite) on the other. **If the post says nothing either
  way, pick the more likely value but flag it in your reply** — most club runs
  are free, but this writes a claim onto a public map, so Taha should know it
  was inferred rather than read.
- **price** — amount with currency, e.g. `AED 50`. Only meaningful when
  `cost: paid`; on a free run the line is ignored, so leaving the hint text is
  correct. If clearly ticketed but no figure is given, leave the hint.
- **day** — lowercase weekday. **date** — `YYYY-MM-DD`; posts often say
  "Sat 14th" with no year, so resolve against today and take the nearest future
  match, flagging it if the year is genuinely ambiguous.
- **time** — 24-hour `HH:MM`. "6am" is `06:00`, "5.30pm" is `17:30`. Never
  `6:00 AM` — it is rejected.
- **link** — required, must start with `https://`. An Instagram profile URL is
  fine. If the post gives no link, use `https://instagram.com/<handle>` of the
  posting account and say that you did.
- **notes** — distance options, pace groups, parking, "bring cash", tiered
  price breakdowns. Keep it short. Leave the word `optional` in place if there
  is nothing to say.

Leaving a line's hint text untouched counts as blank, which is fine for
optional fields (`price`, `notes`) and an error for required ones.

## After the form

Photos are a separate step: once the form is accepted the bot asks for
attachments. If the source image is a good club photo, say to attach it there;
otherwise tap Skip. Then the bot shows a preview, and **Approve and publish**
is the only thing that writes to GitHub.

## Close with what is uncertain

After the block, briefly state:

- anything **inferred** rather than read from the source (especially `cost`),
- anything the source **did not mention** at all,
- whether the **pin** still needs setting.

Taha sees a full preview before publishing, so flagging doubt is cheap and a
confident wrong answer is not.

## Multiple runs

One form per `/newclub`. If a post lists a whole week's schedule, produce a
separate block for each, clearly headed, and say they must be sent one at a
time.

## Editing an existing club

If the club is already on the map, the command is `/editclub <name>`. The bot
replies with the same form **pre-filled** with the current record. Give back
the whole block with only the changed lines altered — every line still has to
be present.
