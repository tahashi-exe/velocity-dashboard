/* Prints the blank form the bot sends for each collection, straight from
   template.js.

   claude-skill/SKILL.md hardcodes those blocks so Claude can fill one in
   without reading the source. That's a copy, and copies drift — adding Cost
   and Price mid-flow already invalidated one earlier version of that file.
   Run `npm run form` after touching the steps and update SKILL.md if the
   output no longer matches its two code blocks.

   No Telegram, no secrets, no network — safe to run anywhere. */

import { buildForm } from './template.js'

for (const collection of ['clubs', 'events']) {
  console.log(`--- ${collection} (${collection === 'clubs' ? '/newclub' : '/newevent'}) ---`)
  console.log(buildForm(collection, {}))
  console.log()
}
