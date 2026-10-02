/* Drafts kept in the Supabase `bot_sessions` table, one row per chat.

   The Edge Function has no memory between updates and no disk, so whatever a
   half-finished entry holds has to live here. Same contract as the file-backed
   store index.js builds from drafts.js: async get / set / delete by chat id.

   Plain fetch against the REST endpoint with the project's service key, which
   the function is given automatically. The table has row-level security on and
   no policies, so nothing but that key can read it. */

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // same shelf life as drafts.js

export function supabaseSessionStore({ url, key, fetchImpl = fetch }) {
  const endpoint = `${url}/rest/v1/bot_sessions`
  const row = (chatId) => `${endpoint}?chat_id=eq.${encodeURIComponent(chatId)}`
  const headers = (prefer) => ({
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  })

  async function check(response, what) {
    if (!response.ok) throw new Error(`Could not ${what} the draft: ${response.status} ${await response.text()}`)
    return response
  }

  return {
    async get(chatId) {
      const response = await check(await fetchImpl(`${row(chatId)}&select=session,updated_at`, { headers: headers() }), 'load')
      const [found] = await response.json()
      if (!found) return null
      if (Date.now() - new Date(found.updated_at).getTime() > MAX_AGE_MS) return null
      return found.session
    },

    async set(chatId, session) {
      await check(await fetchImpl(`${endpoint}?on_conflict=chat_id`, {
        method: 'POST',
        headers: headers('resolution=merge-duplicates,return=minimal'),
        body: JSON.stringify({ chat_id: String(chatId), session, updated_at: new Date().toISOString() }),
      }), 'save')
    },

    async delete(chatId) {
      await check(await fetchImpl(row(chatId), { method: 'DELETE', headers: headers('return=minimal') }), 'clear')
    },
  }
}
