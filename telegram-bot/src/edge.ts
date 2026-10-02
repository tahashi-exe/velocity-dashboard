/* Supabase Edge Function entry point: the bot's permanent home.

   Telegram delivers each message as a POST to this function (a webhook), so
   nothing has to stay running in between and it costs nothing to host. All
   the behaviour is in bot.js; this file only wires it to the webhook, to the
   database-backed draft store and to the function's secrets.

   Secrets, set in the Supabase dashboard (Edge Functions -> Secrets):
     TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID, GITHUB_TOKEN, GITHUB_REPOSITORY
     GITHUB_BRANCH (optional, defaults to main)
   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase itself.

   Deployed with JWT verification off, because Telegram can't send a Supabase
   token. Updates are authenticated instead by Telegram's own secret-token
   header, checked by grammy on every POST; the secret is derived from the bot
   token, so only Telegram (told it at setup) and this function know it.

   GET  .../telegram-bot         which secrets are missing, if any
   GET  .../telegram-bot?setup   registers this URL as the bot's webhook
   POST .../telegram-bot         a Telegram update

   The setup call is open to anyone on purpose: all it can do is point the bot
   at this same function again, and it answers with nothing private. */

import { Bot, InlineKeyboard, webhookCallback } from 'npm:grammy@1.45.1'
import { createBot, REQUIRED_ENV } from './bot.js'
import { supabaseSessionStore } from './session-store.js'

const FUNCTION_NAME = 'telegram-bot'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function build() {
  const env: Record<string, string | undefined> = {}
  for (const key of [...REQUIRED_ENV, 'GITHUB_BRANCH']) env[key] = Deno.env.get(key)

  const database = {
    url: Deno.env.get('SUPABASE_URL')!.replace(/\/+$/, ''),
    key: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  }
  const { bot } = createBot({
    grammy: { Bot, InlineKeyboard },
    env,
    database,
    store: supabaseSessionStore(database),
  })
  const secretToken = await sha256Hex(`velocity-webhook:${env.TELEGRAM_BOT_TOKEN}`)

  return {
    bot,
    secretToken,
    webhookUrl: `${database.url}/functions/v1/${FUNCTION_NAME}`,
    // A publish with photos makes several calls to GitHub; grammy's default
    // 10 seconds can be too tight for that.
    handle: webhookCallback(bot, 'std/http', { secretToken, timeoutMilliseconds: 55_000 }),
  }
}

// Built once per running instance and reused across the updates it serves.
let built: ReturnType<typeof build> | null = null

Deno.serve(async (req: Request) => {
  const missing = REQUIRED_ENV.filter((key: string) => !Deno.env.get(key))

  if (req.method === 'GET') {
    if (missing.length) return json({ ok: false, missing })

    if (!new URL(req.url).searchParams.has('setup')) return json({ ok: true })

    try {
      const { bot, secretToken, webhookUrl } = await (built ??= build())
      await bot.api.setWebhook(webhookUrl, {
        secret_token: secretToken,
        allowed_updates: ['message', 'callback_query'],
      })
      const [me, info] = await Promise.all([bot.api.getMe(), bot.api.getWebhookInfo()])
      return json({
        ok: true,
        bot: me.username,
        webhook: info.url,
        pending_updates: info.pending_update_count,
        last_error: info.last_error_message ?? null,
      })
    } catch (error) {
      return json({ ok: false, error: (error as Error).message }, 500)
    }
  }

  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)
  if (missing.length) return json({ ok: false, missing }, 500)

  const { handle } = await (built ??= build())
  return handle(req)
})
