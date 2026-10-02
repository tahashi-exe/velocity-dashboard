/* Mirrors a published record into the Supabase `runs` table, so the app's
   backend mode sees what the bot publishes (TECHNICAL.md §8).

   The JSON files on GitHub stay the bot's source of truth; this is a second
   write after that commit succeeds. Plain fetch against the project's REST
   endpoint, no client library, in keeping with the rest of the bot.

   Optional: with SUPABASE_URL / SUPABASE_SECRET_KEY unset the bot behaves
   exactly as it did before and only writes to GitHub. */

export function supabaseConfig(env = globalThis.process?.env ?? {}) {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, '')
  const key = env.SUPABASE_SECRET_KEY?.trim()
  return url && key ? { url, key } : null
}

function headers(key, prefer) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: prefer,
  }
}

// An edit goes to the row that has the slug the record had *before* the edit,
// so renaming a club keeps its row and every RSVP attached to it. If that row
// isn't there (the club predates the database, or the two drifted apart), and
// for any new record, it falls through to an upsert on the new slug.
export async function saveRun({ url, key, row, previousSlug = null, fetchImpl = fetch }) {
  const endpoint = `${url}/rest/v1/runs`

  if (previousSlug) {
    const response = await fetchImpl(`${endpoint}?slug=eq.${encodeURIComponent(previousSlug)}`, {
      method: 'PATCH',
      headers: headers(key, 'return=representation'),
      body: JSON.stringify(row),
    })
    if (!response.ok) {
      throw new Error(`Supabase could not update "${row.name}": ${response.status} ${await response.text()}`)
    }
    if ((await response.json()).length) return { action: 'updated' }
  }

  const response = await fetchImpl(`${endpoint}?on_conflict=slug`, {
    method: 'POST',
    headers: headers(key, 'resolution=merge-duplicates,return=minimal'),
    body: JSON.stringify(row),
  })
  if (!response.ok) {
    throw new Error(`Supabase could not save "${row.name}": ${response.status} ${await response.text()}`)
  }
  return { action: 'saved' }
}
