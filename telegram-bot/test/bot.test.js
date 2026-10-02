/* End-to-end tests for bot.js: real grammy, simulated Telegram updates, and
   scripted stand-ins for the Telegram API, GitHub and Supabase. No network.

   Every update is handled by a brand-new bot built over the same store, the
   way the Edge Function may serve each one from a fresh instance. A flow that
   only works because something stayed in memory fails here. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Bot, InlineKeyboard } from 'grammy'

import { createBot } from '../src/bot.js'
import { toBase64 } from '../src/github.js'

const ADMIN = 4242
const ENV = {
  TELEGRAM_BOT_TOKEN: '1:test-token',
  TELEGRAM_ADMIN_CHAT_ID: String(ADMIN),
  GITHUB_TOKEN: 'gh-test',
  GITHUB_REPOSITORY: 'owner/repo',
}
const DATABASE = { url: 'https://db.example', key: 'service-key' }

const EXISTING_CLUB = {
  name: 'ON Run Club', location_name: 'Orto Cafe, Jumeirah', lat: 25.1950095, lng: 55.2357981,
  pace: 'easy / social', type: 'social', surface: 'road', freebies: true, day: 'saturday',
  time: '05:45', link: 'https://onrunclubdxb.splashthat.eu', notes: '', last_updated: '2026-08-05',
}

const NEW_CLUB_BLOCK = `name: Velocity Test Club
location_name: Dubai Marina Walk
location: 25.0805, 55.1403
type: social
surface: road
freebies: no
cost: free
price: only if paid, e.g. AED 50
day: sunday
time: 06:30
link: https://example.com/club
notes: Test entry`

function encodeFile(data) {
  return toBase64(new TextEncoder().encode(JSON.stringify(data, null, 2)))
}
function decodeFile(base64) {
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))))
}

// A whole pretend world: what's on GitHub, what's in the drafts store, and a
// log of everything the bot sent to Telegram, GitHub and Supabase.
function world({ clubs = [EXISTING_CLUB], database = DATABASE, supabase = () => ({ status: 201 }) } = {}) {
  const state = {
    clubs, drafts: new Map(), telegram: [], github: [], supabase: [], photoUploads: [], updateId: 1,
  }

  const store = {
    async get(id) { const s = state.drafts.get(id); return s ? JSON.parse(s) : null },
    async set(id, session) { state.drafts.set(id, JSON.stringify(session)) }, // must survive serialization
    async delete(id) { state.drafts.delete(id) },
  }

  const respond = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  })

  async function fetchImpl(url, options = {}) {
    const method = options.method || 'GET'
    if (url.startsWith('https://api.github.com/')) {
      state.github.push({ method, url })
      if (url.includes('/contents/clubs.json')) {
        if (method === 'GET') return respond(200, { sha: 'sha-1', content: encodeFile(state.clubs) })
        state.clubs = decodeFile(JSON.parse(options.body).content)
        return respond(200, { commit: { html_url: 'https://github.com/owner/repo/commit/abc' } })
      }
      if (url.includes('/contents/club-photos/')) {
        state.photoUploads.push({ url, base64: JSON.parse(options.body).content })
        return respond(201, { commit: {} })
      }
    }
    if (url.startsWith('https://api.telegram.org/file/')) return respond(200, '')
    if (url.startsWith(DATABASE.url)) {
      const call = { method, url, body: JSON.parse(options.body) }
      state.supabase.push(call)
      const { status, json = [] } = supabase(call, state.supabase.length)
      return respond(status, status >= 400 ? 'database is down' : json)
    }
    throw new Error(`Unexpected request: ${method} ${url}`)
  }

  // A fresh bot per update, sharing only the store.
  async function send(update) {
    const { bot } = createBot({ grammy: { Bot, InlineKeyboard }, env: ENV, database, store, fetchImpl })
    bot.botInfo = { id: 1, is_bot: true, first_name: 'Velocity', username: 'velocity_test_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false }
    bot.api.config.use(async (prev, method, payload) => {
      state.telegram.push({ method, payload })
      if (method === 'getFile') return { ok: true, result: { file_id: payload.file_id, file_unique_id: 'u', file_path: 'photos/file_7.jpg' } }
      if (method === 'sendMessage') return { ok: true, result: { message_id: state.telegram.length, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text } }
      return { ok: true, result: true }
    })
    await bot.handleUpdate({ update_id: state.updateId++, ...update })
  }

  const from = (id) => ({ id, is_bot: false, first_name: 'T' })
  const chat = (id) => ({ id, type: 'private', first_name: 'T' })

  return {
    state,
    text: (text, id = ADMIN) => send({
      message: {
        message_id: state.updateId, date: 0, chat: chat(id), from: from(id), text,
        ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}),
      },
    }),
    photo: (id = ADMIN) => send({
      message: { message_id: state.updateId, date: 0, chat: chat(id), from: from(id), photo: [{ file_id: 'small', file_unique_id: 's', width: 90, height: 90 }, { file_id: 'large', file_unique_id: 'l', width: 800, height: 800 }] },
    }),
    tap: (data, id = ADMIN) => send({
      callback_query: { id: 'cb', from: from(id), chat_instance: 'x', data, message: { message_id: 1, date: 0, chat: chat(id), text: 'x' } },
    }),
    lastMessage: () => state.telegram.filter((c) => c.method === 'sendMessage').at(-1).payload,
    // The callback data of a button on the most recent message, by its label.
    button(label) {
      const rows = this.lastMessage().reply_markup.inline_keyboard
      return rows.flat().find((b) => b.text.startsWith(label)).callback_data
    },
    draft: () => (state.drafts.has(String(ADMIN)) ? JSON.parse(state.drafts.get(String(ADMIN))) : null),
  }
}

async function fillNewClub(w) {
  await w.text('/newclub')
  await w.text(NEW_CLUB_BLOCK)
}

/* ---------- the whole flow ---------- */

test('a new club goes form -> photos -> preview -> GitHub and the database', async () => {
  const w = world()

  await w.text('/newclub')
  assert.match(w.lastMessage().text, /New club/)
  assert.equal(w.draft().mode, 'form')

  await w.text(NEW_CLUB_BLOCK)
  assert.match(w.lastMessage().text, /Every field checks out/)
  assert.equal(w.draft().mode, 'photos')

  await w.tap(w.button('Skip'))
  assert.match(w.lastMessage().text, /Add new club to clubs\.json/)
  assert.match(w.lastMessage().text, /Nothing is written until you tap Approve/)
  assert.equal(w.state.github.length, 0, 'nothing is written before Approve')

  await w.tap(w.button('Approve'))
  assert.match(w.lastMessage().text, /Published to GitHub and saved to the database/)
  assert.match(w.lastMessage().text, /commit\/abc/)

  // GitHub: the record was appended to clubs.json
  assert.equal(w.state.clubs.length, 2)
  const saved = w.state.clubs[1]
  assert.equal(saved.name, 'Velocity Test Club')
  assert.equal(saved.cost, 'free')
  assert.match(saved.last_updated, /^\d{4}-\d{2}-\d{2}$/)

  // Supabase: one upsert, matching that record
  assert.equal(w.state.supabase.length, 1)
  const call = w.state.supabase[0]
  assert.equal(call.method, 'POST')
  assert.match(call.url, /\/rest\/v1\/runs\?on_conflict=slug$/)
  assert.equal(call.body.slug, 'velocity-test-club-recurring')
  assert.equal(call.body.day_of_week, 'sunday')
  assert.equal(call.body.last_updated, saved.last_updated)

  assert.equal(w.draft(), null, 'the draft is cleared once published')
})

test('with no database configured it publishes to GitHub only, as before', async () => {
  const w = world({ database: null })
  await fillNewClub(w)
  await w.tap(w.button('Skip'))
  await w.tap(w.button('Approve'))

  assert.match(w.lastMessage().text, /^Published to GitHub\. /)
  assert.equal(w.state.supabase.length, 0)
  assert.equal(w.state.clubs.length, 2)
})

/* ---------- failure and retry ---------- */

test('a failed database write is retried without a second commit', async () => {
  // First database call fails, the second succeeds.
  const w = world({ supabase: (call, n) => ({ status: n === 1 ? 500 : 201 }) })
  await fillNewClub(w)
  await w.tap(w.button('Skip'))
  const approve = w.button('Approve')
  const edit = w.button('Edit')

  await w.tap(approve)
  assert.match(w.lastMessage().text, /site files are updated on GitHub, but the database write failed/)
  assert.equal(w.state.clubs.length, 2)
  assert.ok(w.draft().published, 'the draft remembers the commit')
  const commitsSoFar = w.state.github.filter((c) => c.method === 'PUT').length

  // Editing is refused now: the commit is already in.
  await w.tap(edit)
  assert.equal(w.draft().mode, 'preview')

  await w.tap(approve)
  assert.match(w.lastMessage().text, /Published to GitHub and saved to the database/)
  assert.equal(w.state.github.filter((c) => c.method === 'PUT').length, commitsSoFar, 'no second commit')
  assert.equal(w.state.clubs.length, 2)
  assert.equal(w.state.supabase.length, 2)
  assert.equal(w.draft(), null)
})

test('rejecting after the commit says what was and was not written', async () => {
  const w = world({ supabase: () => ({ status: 500 }) })
  await fillNewClub(w)
  await w.tap(w.button('Skip'))
  const reject = w.button('Reject')
  await w.tap(w.button('Approve'))

  await w.tap(reject)
  assert.match(w.lastMessage().text, /site files on GitHub are updated, the database is not/)
  assert.equal(w.draft(), null)
})

/* ---------- editing ---------- */

test('renaming a club updates the same database row', async () => {
  const w = world({ supabase: () => ({ status: 200, json: [{ id: 'row-1' }] }) })

  await w.text('/editclub ON Run Club')
  assert.match(w.lastMessage().text, /Editing club "ON Run Club"/)

  // Send the pre-filled block back with a new name and a cost.
  const block = w.lastMessage().text.match(/<pre>([\s\S]*)<\/pre>/)[1]
    .replace(/&amp;/g, '&')
    .replace('name: ON Run Club', 'name: ON Running Club')
    .replace(/^cost: .*$/m, 'cost: free')
  await w.text(block)
  await w.tap(w.button('Skip'))
  await w.tap(w.button('Approve'))

  assert.match(w.lastMessage().text, /saved to the database/)
  assert.equal(w.state.clubs.length, 1)
  assert.equal(w.state.clubs[0].name, 'ON Running Club')
  assert.equal(w.state.clubs[0].pace, 'easy / social', 'fields the form no longer asks about survive')

  const call = w.state.supabase[0]
  assert.equal(call.method, 'PATCH')
  assert.match(call.url, /slug=eq\.on-run-club-recurring$/)
  assert.equal(call.body.slug, 'on-running-club-recurring')
  assert.deepEqual(call.body.details, { surface: 'road', pace: 'easy / social' })
})

/* ---------- photos ---------- */

test('an attached photo is fetched and uploaded only at Approve', async () => {
  const w = world()
  await fillNewClub(w)

  await w.photo()
  assert.match(w.lastMessage().text, /Photo 1 of 3 added/)
  const draft = w.draft()
  assert.equal(draft.pendingUploads[0].fileId, 'large', 'the largest size is kept, by id')
  assert.equal(draft.pendingUploads[0].base64, undefined, 'the image itself is not stored in the draft')
  assert.equal(w.state.photoUploads.length, 0)

  await w.tap(w.button('Done'))
  await w.tap(w.button('Approve'))

  assert.equal(w.state.photoUploads.length, 1)
  assert.match(w.state.photoUploads[0].url, /club-photos\/[a-z0-9]+\.jpg$/)
  assert.equal(w.state.photoUploads[0].base64, toBase64(new Uint8Array([1, 2, 3, 4])))
  const [photoUrl] = w.state.clubs[1].photos
  assert.match(photoUrl, /^https:\/\/raw\.githubusercontent\.com\/owner\/repo\/main\/club-photos\//)
  assert.deepEqual(w.state.supabase[0].body.photos, [photoUrl])
})

/* ---------- access and validation ---------- */

test('anyone but the admin is turned away and leaves no trace', async () => {
  const w = world()
  await w.text('/newclub', 999)
  assert.match(w.lastMessage().text, /private Velocity admin bot/)
  assert.equal(w.state.drafts.size, 0)
  assert.equal(w.state.github.length, 0)
})

test('a block with problems publishes nothing and keeps the draft', async () => {
  const w = world()
  await w.text('/newclub')
  await w.text(NEW_CLUB_BLOCK.replace('time: 06:30', 'time: half six'))
  assert.match(w.lastMessage().text, /Nothing published\. Fix these/)
  assert.equal(w.draft().mode, 'form')
})

test('/cancel drops the draft from the store', async () => {
  const w = world()
  await w.text('/newclub')
  assert.ok(w.draft())
  await w.text('/cancel')
  assert.equal(w.draft(), null)
  assert.match(w.lastMessage().text, /Cancelled/)
})

test('adding a club that already exists is refused before anything is written', async () => {
  const w = world()
  await w.text('/newclub')
  await w.text(NEW_CLUB_BLOCK.replace('name: Velocity Test Club', 'name: on run club'))
  await w.tap(w.button('Skip'))
  await w.tap(w.button('Approve'))

  assert.match(w.lastMessage().text, /already exists in clubs\.json/)
  assert.equal(w.state.clubs.length, 1)
  assert.equal(w.state.supabase.length, 0)
  assert.equal(w.draft().published, undefined)
})
