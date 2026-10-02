/* Tests for the database mirror: the record -> `runs` row mapping and the
   two-step save. No network: saveRun takes its fetch as a parameter, and a
   scripted stand-in records what was sent. */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { kindFor, slugOf, toRunRow } from '../src/run-row.js'
import { saveRun, supabaseConfig } from '../src/supabase.js'

const CLUB = {
  name: 'ON Run Club',
  location_name: 'Orto Cafe, Jumeirah',
  lat: 25.1950095,
  lng: 55.2357981,
  pace: 'easy / social',
  type: 'social',
  surface: 'road',
  freebies: true,
  day: 'saturday',
  time: '05:45',
  link: 'https://onrunclubdxb.splashthat.eu',
  notes: '',
  last_updated: '2026-08-05',
}

/* ---------- mapping ---------- */

test('slug matches the id the app derives in data.js', () => {
  // data.js: slug(name) + '-' + kind
  assert.equal(slugOf('ON Run Club', 'recurring'), 'on-run-club-recurring')
  assert.equal(slugOf('ONO- One night only Track session', 'one_off'), 'ono-one-night-only-track-session-one_off')
  assert.equal(slugOf('  Café & Run!  ', 'recurring'), 'caf-run-recurring')
})

test('collections map to run kinds', () => {
  assert.equal(kindFor('clubs'), 'recurring')
  assert.equal(kindFor('events'), 'one_off')
})

test('a club becomes a recurring row', () => {
  const row = toRunRow(CLUB, 'recurring')
  assert.equal(row.slug, 'on-run-club-recurring')
  assert.equal(row.kind, 'recurring')
  assert.equal(row.day_of_week, 'saturday')
  assert.equal(row.event_date, null)
  assert.equal(row.register_link, CLUB.link)
  assert.deepEqual(row.details, { surface: 'road', pace: 'easy / social' })
  assert.deepEqual(row.photos, [])
})

test('an event becomes a one-off row with a date and no weekday', () => {
  const row = toRunRow({ ...CLUB, name: 'Night Track', day: undefined, date: '2026-11-14' }, 'one_off')
  assert.equal(row.kind, 'one_off')
  assert.equal(row.event_date, '2026-11-14')
  assert.equal(row.day_of_week, null)
})

test('legacy and unknown types read as training', () => {
  assert.equal(toRunRow({ ...CLUB, type: 'track' }, 'recurring').type_key, 'training')
  assert.equal(toRunRow({ ...CLUB, type: 'whatever' }, 'recurring').type_key, 'training')
  assert.equal(toRunRow({ ...CLUB, type: 'long_run' }, 'recurring').type_key, 'long_run')
})

test('cost is unknown unless recorded, and price only rides with paid', () => {
  // The bot stores an unanswered cost as '', older records omit it entirely.
  assert.equal(toRunRow({ ...CLUB, cost: '' }, 'recurring').cost, null)
  assert.equal(toRunRow(CLUB, 'recurring').cost, null)

  const free = toRunRow({ ...CLUB, cost: 'free', price: 'AED 50' }, 'recurring')
  assert.equal(free.cost, 'free')
  assert.equal(free.price, '') // the table rejects a price on a non-paid run

  const paid = toRunRow({ ...CLUB, cost: 'paid', price: 'AED 50' }, 'recurring')
  assert.equal(paid.price, 'AED 50')
})

test('photos are capped at three and blanks dropped', () => {
  const row = toRunRow({ ...CLUB, photos: ['a', '', 'b', 'c', 'd'] }, 'recurring')
  assert.deepEqual(row.photos, ['a', 'b', 'c'])
})

/* ---------- config ---------- */

test('the mirror is off unless both values are set', () => {
  assert.equal(supabaseConfig({}), null)
  assert.equal(supabaseConfig({ SUPABASE_URL: 'https://x.supabase.co' }), null)
  assert.equal(supabaseConfig({ SUPABASE_SECRET_KEY: 'k' }), null)
  assert.deepEqual(
    supabaseConfig({ SUPABASE_URL: ' https://x.supabase.co/ ', SUPABASE_SECRET_KEY: ' k ' }),
    { url: 'https://x.supabase.co', key: 'k' },
  )
})

/* ---------- saving ---------- */

// Returns a fetch stand-in that answers from `script` in order and records
// each call.
function scriptedFetch(script) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, prefer: options.headers.Prefer, body: JSON.parse(options.body), key: options.headers.apikey })
    const { status = 200, json = [], text = '' } = script.shift()
    return { ok: status >= 200 && status < 300, status, json: async () => json, text: async () => text }
  }
  return { calls, fetchImpl }
}

const DB = { url: 'https://x.supabase.co', key: 'secret' }

test('a new record is upserted on its slug', async () => {
  const { calls, fetchImpl } = scriptedFetch([{ status: 201 }])
  const row = toRunRow(CLUB, 'recurring')
  const result = await saveRun({ ...DB, row, fetchImpl })

  assert.equal(result.action, 'saved')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/runs?on_conflict=slug')
  assert.match(calls[0].prefer, /resolution=merge-duplicates/)
  assert.equal(calls[0].key, 'secret')
  assert.deepEqual(calls[0].body, row)
})

test('an edit updates the row with the old slug, so a rename keeps its RSVPs', async () => {
  const { calls, fetchImpl } = scriptedFetch([{ status: 200, json: [{ id: 'abc' }] }])
  const row = toRunRow({ ...CLUB, name: 'ON Running Club' }, 'recurring')
  const result = await saveRun({ ...DB, row, previousSlug: 'on-run-club-recurring', fetchImpl })

  assert.equal(result.action, 'updated')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'PATCH')
  assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/runs?slug=eq.on-run-club-recurring')
  assert.equal(calls[0].body.slug, 'on-running-club-recurring')
})

test('an edit to a record the database has never seen falls back to an upsert', async () => {
  const { calls, fetchImpl } = scriptedFetch([{ status: 200, json: [] }, { status: 201 }])
  const result = await saveRun({ ...DB, row: toRunRow(CLUB, 'recurring'), previousSlug: 'on-run-club-recurring', fetchImpl })

  assert.equal(result.action, 'saved')
  assert.deepEqual(calls.map((c) => c.method), ['PATCH', 'POST'])
})

test('a database error is surfaced with its status and message', async () => {
  const { fetchImpl } = scriptedFetch([{ status: 401, text: 'Invalid API key' }])
  await assert.rejects(
    saveRun({ ...DB, row: toRunRow(CLUB, 'recurring'), fetchImpl }),
    /Supabase could not save "ON Run Club": 401 Invalid API key/,
  )
})

/* ---------- drafts in the database ---------- */

import { supabaseSessionStore } from '../src/session-store.js'

test('a stored draft comes back; a missing one is null', async () => {
  const session = { collection: 'clubs', action: 'add', mode: 'form', answers: {} }
  const { calls, fetchImpl } = scriptedFetch([
    { json: [{ session, updated_at: new Date().toISOString() }] },
    { json: [] },
  ])
  // scriptedFetch parses a body, and GET has none.
  const store = supabaseSessionStore({ ...DB, fetchImpl: (url, options) => fetchImpl(url, { ...options, body: 'null' }) })

  assert.deepEqual(await store.get('4242'), session)
  assert.equal(await store.get('4242'), null)
  assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/bot_sessions?chat_id=eq.4242&select=session,updated_at')
  assert.equal(calls[0].key, 'secret')
})

test('a draft older than a week is treated as gone', async () => {
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
  const { fetchImpl } = scriptedFetch([{ json: [{ session: { mode: 'form' }, updated_at: old }] }])
  const store = supabaseSessionStore({ ...DB, fetchImpl: (url, options) => fetchImpl(url, { ...options, body: 'null' }) })
  assert.equal(await store.get('4242'), null)
})

test('saving a draft upserts on the chat id, and clearing deletes the row', async () => {
  const { calls, fetchImpl } = scriptedFetch([{ status: 201 }, { status: 204 }])
  const store = supabaseSessionStore({ ...DB, fetchImpl: (url, options) => fetchImpl(url, { ...options, body: options.body || 'null' }) })

  await store.set(4242, { mode: 'photos' })
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/bot_sessions?on_conflict=chat_id')
  assert.match(calls[0].prefer, /resolution=merge-duplicates/)
  assert.equal(calls[0].body.chat_id, '4242')
  assert.deepEqual(calls[0].body.session, { mode: 'photos' })

  await store.delete(4242)
  assert.equal(calls[1].method, 'DELETE')
  assert.equal(calls[1].url, 'https://x.supabase.co/rest/v1/bot_sessions?chat_id=eq.4242')
})

test('a draft that cannot be saved is an error, not a silent loss', async () => {
  const { fetchImpl } = scriptedFetch([{ status: 500, text: 'boom' }])
  const store = supabaseSessionStore({ ...DB, fetchImpl })
  await assert.rejects(store.set(4242, { mode: 'form' }), /Could not save the draft: 500 boom/)
})
