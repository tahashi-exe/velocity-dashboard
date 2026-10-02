-- Drafts for the Telegram admin bot, which runs as an Edge Function and so has
-- no memory or disk between messages (telegram-bot/src/session-store.js).
-- One row per chat, holding whatever a half-finished entry has collected.
--
-- Row-level security is on with no policies, and the browser roles hold no
-- privileges on it: only the service key the function is given can touch it.

create table public.bot_sessions (
  chat_id    text primary key,
  session    jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.bot_sessions enable row level security;
revoke all on public.bot_sessions from anon, authenticated;
