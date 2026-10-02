/* Node entry point: runs the bot on your own machine with long polling, and
   keeps drafts in a local file.

   The bot normally runs as a Supabase Edge Function (edge.ts), which Telegram
   reaches by webhook. Starting this takes the bot over: grammy removes the
   webhook so it can poll, and the Edge Function stops receiving messages
   until its webhook is registered again (see README, "Running it locally"). */

import 'dotenv/config'
import { Bot, InlineKeyboard } from 'grammy'
import { createBot, REQUIRED_ENV } from './bot.js'
import { deleteDraft, draftsFile, loadDrafts, saveDraft } from './drafts.js'
import { supabaseConfig } from './supabase.js'
import { thingFor } from './template.js'

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`)
}

// drafts.js behind the async store contract bot.js expects.
const store = {
  async get(chatId) { return loadDrafts().get(String(chatId)) || null },
  async set(chatId, session) { saveDraft(chatId, session) },
  async delete(chatId) { deleteDraft(chatId) },
}

const { bot, render } = createBot({
  grammy: { Bot, InlineKeyboard },
  env: process.env,
  // null unless SUPABASE_URL and SUPABASE_SECRET_KEY are both set, in which
  // case every publish is also mirrored into the `runs` table.
  database: supabaseConfig(),
  store,
})

const adminChatId = String(process.env.TELEGRAM_ADMIN_CHAT_ID)

// Restored drafts: tell Taha what survived the restart and re-ask the question
// he was on, so a crash never silently swallows a half-typed entry.
async function announceRestoredDraft() {
  const session = loadDrafts().get(adminChatId)
  if (!session) return
  const what = session.action === 'update' ? `edit of "${session.matchName}"` : `new ${thingFor(session.collection)}`
  const notice = `I restarted, but your ${what} was saved — carrying on where we left off. /cancel to drop it.`
  const fakeCtx = {
    chat: { id: adminChatId },
    reply: (text, other) => bot.api.sendMessage(adminChatId, text, other),
  }
  try {
    await render(fakeCtx, session, notice)
  } catch (error) {
    console.error('Could not restore draft:', error.message)
  }
}

bot.start({
  drop_pending_updates: false,
  onStart: () => { announceRestoredDraft() },
})
console.log(`Velocity Telegram bot is running. Drafts file: ${draftsFile()}`)
