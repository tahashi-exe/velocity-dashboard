// The Telegram bot's Edge Function.
//
// The bot's code lives in telegram-bot/src/. Rather than keeping a copy here,
// this loads it from GitHub at one exact commit, so what runs is byte for byte
// what was tested and pushed. A push alone changes nothing: to ship a change,
// put the new commit's full id below and deploy this file as the function
// `telegram-bot` with JWT verification off (telegram-bot/README.md, "Shipping
// a change").
import 'https://raw.githubusercontent.com/tahashi-exe/velocity-dashboard/fa53914f4f87ce8407c1f5a3cd9faccd0d5f6223/telegram-bot/src/edge.ts'
