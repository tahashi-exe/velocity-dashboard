/* Tests for the paste-back form: rendering, parsing, validation and the
   session state machine.

   Node's built-in runner — no test dependency, in keeping with the rest of
   the bot. Run with `npm test` from telegram-bot/.

   template.js deliberately imports no grammy and touches no network except
   resolveMapsLink (which is only reached by a link-shaped location value, and
   isn't exercised here), so everything below runs offline. */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  addPhoto, applyForm, backToForm, buildForm, createSession, finishPhotos,
  parseForm, recordFrom, validateAll,
} from '../src/template.js'

// A complete, valid club form with every line filled in correctly.
const VALID_CLUB = `name: Sunset Striders
location_name: La Mer Beach
location: 25.2296, 55.2634
type: tempo
surface: beach
freebies: yes
cost: free
price: only if paid, e.g. AED 50
day: tuesday
time: 18:00
link: https://instagram.com/sunsetstriders
notes: Bring water`

/* ---------- rendering ---------- */

test('blank club form has one line per field, none pre-filled', () => {
  const lines = buildForm('clubs', {}).split('\n')
  assert.equal(lines.length, 12)
  assert.equal(lines[0], 'name: ')
  assert.ok(lines.some((l) => l.startsWith('day:')))
  assert.ok(!lines.some((l) => l.startsWith('date:')))
  // Photos are collected separately — an attachment can't ride inside text.
  assert.ok(!lines.some((l) => l.startsWith('photos:')))
})

test('event form swaps day for date', () => {
  const lines = buildForm('events', {}).split('\n')
  assert.ok(lines.some((l) => l === 'date: YYYY-MM-DD'))
  assert.ok(!lines.some((l) => l.startsWith('day:')))
})

test('price is on the blank form even though it only applies to paid runs', () => {
  // visibleSteps() would drop it (no cost answered yet); the form must still
  // show it or there'd be no way to fill it in.
  assert.ok(buildForm('clubs', {}).includes('price:'))
})

/* ---------- parsing ---------- */

test('a correctly filled form parses with no errors', async () => {
  const { answers, errors } = await parseForm('clubs', VALID_CLUB)
  assert.deepEqual(errors, [])
  assert.equal(answers.name, 'Sunset Striders')
  assert.equal(answers.lat, 25.2296)
  assert.equal(answers.lng, 55.2634)
  assert.equal(answers.type, 'tempo')
  assert.equal(answers.freebies, true)
  assert.equal(answers.cost, 'free')
})

test('every problem is reported in one pass, not one per resend', async () => {
  const { errors } = await parseForm('clubs', `name:
location_name: Somewhere
location: not a location
type: sprints
surface: gravel
freebies: maybe
cost: freeish
day: funday
time: 6pm
link: instagram.com/x
notes: optional`)
  assert.equal(errors.length, 9)
  for (const field of ['Name', 'Map pin', 'Run type', 'Surface', 'Freebies', 'Cost', 'Day', 'Start time', 'Link']) {
    assert.ok(errors.some((e) => e.startsWith(field)), `expected an error for ${field}`)
  }
})

test('a missing line is named so it can be found in the block', async () => {
  const { errors } = await parseForm('clubs', 'name: Only This')
  assert.ok(errors.some((e) => e.includes('"time:" line is missing')))
})

test('an untouched placeholder counts as blank, not as its own text', async () => {
  const { answers, errors } = await parseForm('clubs', VALID_CLUB)
  assert.deepEqual(errors, [])
  // "notes: Bring water" was filled; price still holds its hint.
  assert.equal(answers.price, undefined)
  const blanked = VALID_CLUB.replace('notes: Bring water', 'notes: optional')
  const second = await parseForm('clubs', blanked)
  assert.equal(second.answers.notes, '')
  assert.deepEqual(second.errors, [])
})

test('a blank required line is an error; a blank optional line is not', async () => {
  const { errors } = await parseForm('clubs', VALID_CLUB
    .replace('name: Sunset Striders', 'name:')
    .replace('notes: Bring water', 'notes:'))
  assert.equal(errors.length, 1)
  assert.ok(errors[0].startsWith('Name'))
})

test('only the first colon splits a line', async () => {
  const { answers } = await parseForm('clubs', VALID_CLUB.replace(
    'notes: Bring water',
    'notes: Meet at 6: sharp',
  ))
  assert.equal(answers.notes, 'Meet at 6: sharp')
  assert.equal(answers.link, 'https://instagram.com/sunsetstriders')
})

test('labels are accepted as well as raw values', async () => {
  const { answers, errors } = await parseForm('clubs', VALID_CLUB.replace('type: tempo', 'type: Long run'))
  assert.deepEqual(errors, [])
  assert.equal(answers.type, 'long_run')
})

/* ---------- conditional price ---------- */

test('price is kept on a paid run and ignored on a free one', async () => {
  const paid = await parseForm('clubs', VALID_CLUB
    .replace('cost: free', 'cost: paid')
    .replace('price: only if paid, e.g. AED 50', 'price: AED 50'))
  assert.equal(paid.answers.price, 'AED 50')

  const free = await parseForm('clubs', VALID_CLUB
    .replace('price: only if paid, e.g. AED 50', 'price: AED 50'))
  assert.equal(free.answers.price, undefined)
})

test('a price left over from paid never survives into a free record', () => {
  // The record assembler is the backstop: even if answers still hold a stale
  // price, a free run must not publish one.
  const record = recordFrom('clubs', { cost: 'free', price: 'AED 50', name: 'X' })
  assert.equal(record.price, '')
})

/* ---------- editing an existing record ---------- */

test('a pre-filled edit form round-trips without errors', async () => {
  const record = recordFrom('clubs', (await parseForm('clubs', VALID_CLUB)).answers)
  const reparsed = await parseForm('clubs', buildForm('clubs', record))
  assert.deepEqual(reparsed.errors, [])
  assert.equal(reparsed.answers.name, 'Sunset Striders')
  assert.equal(reparsed.answers.lat, 25.2296)
  assert.equal(reparsed.answers.type, 'tempo')
})

test('a legacy record shows placeholders for fields it never had', () => {
  // LFG in clubs.json: retired type "track", and no cost (added later).
  const form = buildForm('clubs', {
    name: 'LFG', location_name: 'Gems World Academy', lat: 25.08, lng: 55.21,
    type: 'track', surface: 'track', freebies: false, day: 'wednesday',
    time: '19:30', link: 'https://instagram.com/lfgdubai', notes: '',
  })
  assert.ok(form.includes('type: track'))
  // cost was never stored, so its line falls back to the hint and must be answered
  assert.ok(form.includes('cost: free | paid'))
})

test('a retired type value is rejected rather than silently republished', async () => {
  const { errors } = await parseForm('clubs', VALID_CLUB.replace('type: tempo', 'type: track'))
  assert.equal(errors.length, 1)
  assert.ok(errors[0].startsWith('Run type'))
})

test('validateAll catches a legacy value that never went through the form', () => {
  // The pre-publish backstop: answers loaded straight from an old record.
  const problems = validateAll('clubs', {
    name: 'LFG', location_name: 'x', lat: 25.08, lng: 55.21, type: 'track',
    surface: 'track', freebies: false, cost: 'free', day: 'wednesday',
    time: '19:30', link: 'https://x.com', photos: [], notes: '',
  })
  assert.equal(problems.length, 1)
  assert.equal(problems[0].key, 'type')
})

/* ---------- session state machine ---------- */

test('a session runs form -> photos -> preview', async () => {
  const session = createSession({ collection: 'clubs', action: 'add' })
  assert.equal(session.mode, 'form')

  applyForm(session, (await parseForm('clubs', VALID_CLUB)).answers)
  assert.equal(session.mode, 'photos')

  assert.equal(finishPhotos(session).ok, true)
  assert.equal(session.mode, 'preview')
  // Skipping photos still leaves a usable empty list on the record.
  assert.deepEqual(session.answers.photos, [])
})

test('photos accumulate, cap at 3, and survive going back to the form', async () => {
  const session = createSession({ collection: 'clubs', action: 'add' })
  applyForm(session, (await parseForm('clubs', VALID_CLUB)).answers)

  assert.equal(addPhoto(session, 'https://x/1.jpg').count, 1)
  assert.equal(addPhoto(session, 'https://x/2.jpg').count, 2)
  assert.equal(addPhoto(session, 'https://x/3.jpg').count, 3)
  assert.ok(addPhoto(session, 'https://x/4.jpg').error, 'a 4th photo must be refused')

  backToForm(session)
  assert.equal(session.mode, 'form')
  assert.equal(session.answers.photos.length, 3)
})

test('photos are refused outside the photos step', () => {
  const session = createSession({ collection: 'clubs', action: 'add' })
  assert.ok(addPhoto(session, 'https://x/1.jpg').error)
  assert.ok(finishPhotos(session).error)
})

/* ---------- the published record ---------- */

test('the assembled record has exactly the shape clubs.json expects', async () => {
  const session = createSession({ collection: 'clubs', action: 'add' })
  applyForm(session, (await parseForm('clubs', VALID_CLUB)).answers)
  addPhoto(session, 'https://x/1.jpg')
  finishPhotos(session)

  assert.deepEqual(recordFrom('clubs', session.answers), {
    name: 'Sunset Striders',
    location_name: 'La Mer Beach',
    lat: 25.2296,
    lng: 55.2634,
    type: 'tempo',
    surface: 'beach',
    freebies: true,
    cost: 'free',
    price: '',
    day: 'tuesday',
    time: '18:00',
    link: 'https://instagram.com/sunsetstriders',
    photos: ['https://x/1.jpg'],
    notes: 'Bring water',
  })
})
