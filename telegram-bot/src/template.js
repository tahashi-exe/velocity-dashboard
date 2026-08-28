/* Field definitions, validation, and the guided step machine.
   Deliberately free of any grammy import so it can be unit-tested (and
   reasoned about) on its own — index.js owns all Telegram I/O. */

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

// The five running types the live app actually filters on — these must stay in
// sync with CATEGORIES.running.types in data.js. ("track" is legacy; data.js
// still maps it to training so the older records keep working.)
export const TYPE_OPTIONS = [
  { value: 'social', label: 'Social' },
  { value: 'tempo', label: 'Tempo' },
  { value: 'training', label: 'Training' },
  { value: 'long_run', label: 'Long run' },
  { value: 'pyramid', label: 'Pyramid session' },
]

export const SURFACE_OPTIONS = [
  { value: 'track', label: 'Track' },
  { value: 'beach', label: 'Beach' },
  { value: 'road', label: 'Road' },
  { value: 'indoor', label: 'Indoor' },
]

export const COST_OPTIONS = [
  { value: 'free', label: 'Free' },
  { value: 'paid', label: 'Paid' },
]

export const DAY_OPTIONS = DAYS.map((day) => ({ value: day, label: day[0].toUpperCase() + day.slice(1) }))

function values(options) {
  return options.map((option) => option.value)
}

/* ---------- steps ----------
   Each step declares: the record key(s) it fills, the prompt copy Taha sees,
   an input kind (text | choice | boolean | location) and, for anything typed,
   a field descriptor that validateField() understands. "{thing}" in prompt
   copy is replaced with "club" or "event". */

const STEP_NAME = {
  key: 'name',
  title: 'Name',
  kind: 'text',
  prompt: "What's the {thing} called?\nSend it exactly as it should appear on the map.",
  field: { key: 'name', required: true },
}

const STEP_LOCATION_NAME = {
  key: 'location_name',
  title: 'Meeting point',
  kind: 'text',
  prompt: 'Where does it meet?\nJust the place name people would recognise — e.g. "Kite Beach" or "Orto Cafe, Jumeirah".',
  field: { key: 'location_name', required: true },
}

const STEP_LOCATION = {
  key: 'location',
  title: 'Map pin',
  kind: 'location',
  keys: ['lat', 'lng'],
  prompt: 'Now the exact spot. Any one of these:\n\n'
    + '• Tap the paperclip → Location and drop a pin (easiest on your phone)\n'
    + '• Paste a Google Maps link (Share → Copy link)\n'
    + '• Or type the coordinates: 25.1950, 55.2358',
}

const STEP_TYPE = {
  key: 'type',
  title: 'Run type',
  kind: 'choice',
  options: TYPE_OPTIONS,
  prompt: 'What kind of run is it?',
  field: { key: 'type', required: true, enum: values(TYPE_OPTIONS) },
}

const STEP_SURFACE = {
  key: 'surface',
  title: 'Surface',
  kind: 'choice',
  options: SURFACE_OPTIONS,
  prompt: 'What do people run on?',
  field: { key: 'surface', required: true, enum: values(SURFACE_OPTIONS) },
}

const STEP_FREEBIES = {
  key: 'freebies',
  title: 'Freebies',
  kind: 'boolean',
  prompt: 'Are there freebies? Coffee, swag, recovery, anything free on the day.',
  field: { key: 'freebies', required: true, type: 'boolean' },
}

// Cost is about paying to take part; freebies is about free things handed out
// on the day. They are independent — a free run can hand out free coffee, and a
// paid race can hand out a free finisher tee — so both questions get asked.
const STEP_COST = {
  key: 'cost',
  title: 'Cost',
  kind: 'choice',
  options: COST_OPTIONS,
  prompt: 'Does it cost anything to take part?\nFree means anyone can just turn up. Paid means an entry fee or a ticket.',
  field: { key: 'cost', required: true, enum: values(COST_OPTIONS) },
}

// Only asked when Cost is Paid — see visibleSteps(). Optional even then: a post
// can be clearly ticketed without naming a figure, and that shouldn't block
// publishing.
const STEP_PRICE = {
  key: 'price',
  title: 'Price',
  kind: 'text',
  optional: true,
  when: (answers) => answers.cost === 'paid',
  prompt: 'How much?\nAmount with the currency — e.g. "AED 50". Tap Skip if the price isn\'t stated.',
  field: { key: 'price', required: false },
}

const STEP_DAY = {
  key: 'day',
  title: 'Day',
  kind: 'choice',
  options: DAY_OPTIONS,
  prompt: 'Which day does it run, every week?',
  field: { key: 'day', required: true, enum: DAYS },
}

const STEP_DATE = {
  key: 'date',
  title: 'Date',
  kind: 'text',
  prompt: 'What date is it on?\nFormat YYYY-MM-DD — e.g. 2026-09-14.',
  field: { key: 'date', required: true, type: 'date' },
}

const STEP_TIME = {
  key: 'time',
  title: 'Start time',
  kind: 'text',
  prompt: 'What time does it start?\n24-hour clock — e.g. 05:45 or 19:30.',
  field: { key: 'time', required: true, type: 'time' },
}

const STEP_LINK = {
  key: 'link',
  title: 'Link',
  kind: 'text',
  prompt: 'Where can people sign up or follow along?\nInstagram profile or booking page — it has to start with https://.',
  field: { key: 'link', required: true, type: 'url' },
}

const STEP_PHOTOS = {
  key: 'photos',
  title: 'Photos',
  kind: 'text',
  optional: true,
  prompt: 'Got photos for the map slideshow preview? Attach up to 3 photos right here in the chat — '
    + "I'll upload them — or paste direct image links instead, one per line.\n"
    + 'Tap Done when you have what you want, or Skip if there are none.',
  field: { key: 'photos', required: false, type: 'photoList' },
}

const STEP_NOTES = {
  key: 'notes',
  title: 'Notes',
  kind: 'text',
  optional: true,
  prompt: 'Anything worth flagging? Pace groups, parking, "bring cash" — keep it short.\nTap Skip if there is nothing.',
  field: { key: 'notes', required: false },
}

const SHARED_HEAD = [STEP_NAME, STEP_LOCATION_NAME, STEP_LOCATION, STEP_TYPE, STEP_SURFACE, STEP_FREEBIES, STEP_COST, STEP_PRICE]
const SHARED_TAIL = [STEP_TIME, STEP_LINK, STEP_PHOTOS, STEP_NOTES]

const CLUB_STEPS = [...SHARED_HEAD, STEP_DAY, ...SHARED_TAIL]
const EVENT_STEPS = [...SHARED_HEAD, STEP_DATE, ...SHARED_TAIL]

const CLUB_KEYS = ['name', 'location_name', 'lat', 'lng', 'type', 'surface', 'freebies', 'cost', 'price', 'day', 'time', 'link', 'photos', 'notes']
const EVENT_KEYS = ['name', 'location_name', 'lat', 'lng', 'type', 'surface', 'freebies', 'cost', 'price', 'date', 'time', 'link', 'photos', 'notes']

export function stepsFor(collection) {
  return collection === 'clubs' ? CLUB_STEPS : EVENT_STEPS
}

/* The list the step machine actually walks. A step with a `when` predicate
   drops out when the predicate is false against the answers so far, so Price
   simply doesn't exist as a question on a free run.

   Every piece of index math — stepIndex, "step N of M", Back, the field menu,
   validation — must go through this and never through stepsFor(), or the
   indices refer to two different lists. Because the list is derived from the
   current answers each time it's read, changing Cost re-shapes it immediately:
   answering "free" advances past where Price would have been, and switching a
   record from paid to free stops validating (and stops showing) a Price that
   is no longer asked for. */
export function visibleSteps(collection, answers) {
  const seen = answers || {}
  return stepsFor(collection).filter((step) => (step.when ? step.when(seen) : true))
}

export function recordKeys(collection) {
  return collection === 'clubs' ? CLUB_KEYS : EVENT_KEYS
}

export function fieldsFor(collection) {
  return stepsFor(collection).filter((step) => step.field).map((step) => step.field)
}

export function thingFor(collection) {
  return collection === 'clubs' ? 'club' : 'event'
}

export function promptText(step, collection) {
  return step.prompt.replace(/\{thing\}/g, thingFor(collection))
}

/* ---------- maps links ---------- */

// Matches lat/lng out of a Google Maps URL. Tried in priority order: the
// !3d/!4d pair is the pin's exact coordinate on "place" URLs (most accurate),
// then the ?q= param, then the @lat,lng viewport-center form (least precise
// but present on nearly every maps.google.com URL).
const MAPS_URL_PATTERNS = [
  /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
  /[?&]q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
  /@(-?\d+\.\d+),(-?\d+\.\d+)/,
]

function matchCoords(url) {
  for (const pattern of MAPS_URL_PATTERNS) {
    const match = url.match(pattern)
    if (match) return { lat: Number(match[1]), lng: Number(match[2]) }
  }
  return null
}

// Short links (maps.app.goo.gl, goo.gl/maps) don't carry coordinates
// themselves — resolve the redirect first. Some regions get routed through
// a Google consent page first; its `continue=` param holds the real link.
export async function resolveMapsLink(url) {
  const direct = matchCoords(url)
  if (direct) return direct

  let finalUrl
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000) })
    finalUrl = res.url || url
  } catch {
    return null
  }

  const resolved = matchCoords(finalUrl)
  if (resolved) return resolved

  try {
    const continueParam = new URL(finalUrl).searchParams.get('continue')
    if (continueParam) return matchCoords(decodeURIComponent(continueParam))
  } catch {
    // not a parseable URL or no continue param — nothing more to try
  }
  return null
}

/* ---------- validation ---------- */

export function validateField(field, rawValue) {
  // photoList round-trips as an array once answered (session.answers stores
  // the parsed list) but arrives as raw multi-line text the first time —
  // normalize both into the same newline-joined string before the rest of
  // this function's string-based logic runs.
  const normalizedRaw = Array.isArray(rawValue) ? rawValue.join('\n') : rawValue
  const value = typeof normalizedRaw === 'boolean' ? String(normalizedRaw) : (normalizedRaw || '').toString().trim()
  if (!value) {
    if (field.required) return { error: 'missing' }
    return { value: field.type === 'photoList' ? [] : '' }
  }
  if (field.type === 'photoList') {
    const urls = value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3)
    if (urls.some((u) => !/^https?:\/\//i.test(u))) {
      return { error: 'each photo must be a link starting with http:// or https://, one per line (max 3)' }
    }
    return { value: urls }
  }
  if (field.type === 'number') {
    const n = Number(value)
    return Number.isFinite(n) ? { value: n } : { error: 'must be a number' }
  }
  if (field.type === 'boolean') {
    const v = value.toLowerCase()
    if (['yes', 'true'].includes(v)) return { value: true }
    if (['no', 'false'].includes(v)) return { value: false }
    return { error: 'must be "yes" or "no"' }
  }
  if (field.type === 'time') {
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value)
      ? { value }
      : { error: 'must be 24h HH:MM, e.g. 18:30' }
  }
  if (field.type === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: 'must be YYYY-MM-DD' }
    return Number.isNaN(new Date(value).getTime()) ? { error: 'not a valid date' } : { value }
  }
  if (field.type === 'url') {
    return /^https?:\/\//i.test(value) ? { value } : { error: 'must be a link starting with http:// or https://' }
  }
  if (field.enum) {
    const normalized = value.toLowerCase().replace(/\s*\/\s*/g, ' / ').trim()
    const match = field.enum.find((option) => option.toLowerCase() === normalized)
    return match ? { value: match } : { error: `must be one of: ${field.enum.join(', ')}` }
  }
  return { value }
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6
}

// A location answer arrives as a native Telegram pin ({ latitude, longitude }),
// a Google Maps link, or typed "lat, lng".
export async function resolveLocationInput(input) {
  if (input && typeof input === 'object') {
    const lat = Number(input.latitude ?? input.lat)
    const lng = Number(input.longitude ?? input.lng)
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat: round6(lat), lng: round6(lng) }
    return { error: 'that pin had no coordinates on it' }
  }

  const text = String(input || '').trim()
  if (!text) return { error: 'send a pin, a Google Maps link, or "lat, lng"' }

  if (/^https?:\/\//i.test(text)) {
    const coords = await resolveMapsLink(text)
    if (!coords) {
      return {
        error: "I couldn't find coordinates in that link. Try the link from the pin's Share button, "
          + 'drop a Telegram pin instead, or type the numbers as "25.1950, 55.2358".',
      }
    }
    return { lat: round6(coords.lat), lng: round6(coords.lng) }
  }

  const match = text.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  if (!match) {
    return { error: 'that doesn\'t look like a pin, a maps link, or "lat, lng" — try one of those three' }
  }
  const lat = Number(match[1])
  const lng = Number(match[2])
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: 'those coordinates are out of range (lat -90..90, lng -180..180)' }
  return { lat: round6(lat), lng: round6(lng) }
}

// Resolves one step's raw input into the record values it fills.
export async function applyStepInput(step, input) {
  if (step.kind === 'location') {
    const result = await resolveLocationInput(input)
    if (result.error) return { error: result.error }
    return { values: { lat: result.lat, lng: result.lng } }
  }

  if (step.kind === 'choice') {
    const raw = String(input ?? '').trim().toLowerCase()
    const option = step.options.find((o) => o.value === raw || o.label.toLowerCase() === raw)
    if (!option) {
      return { error: `Tap one of the buttons, or type one of: ${step.options.map((o) => o.label).join(', ')}` }
    }
    return { values: { [step.key]: option.value } }
  }

  const result = validateField(step.field, input)
  if (result.error) return { error: `${step.title} — ${result.error}` }
  return { values: { [step.key]: result.value } }
}

/* ---------- session (the step machine) ----------
   mode:
     'walk'    — answering the questions in order (stepIndex points at one)
     'field'   — answering a single question reached from the field menu
     'menu'    — the field menu (edit / review before preview)
     'preview' — waiting on the Approve and publish tap */

export function answersFromRecord(collection, record) {
  const answers = {}
  if (!record) return answers
  for (const key of recordKeys(collection)) {
    if (record[key] !== undefined && record[key] !== null) answers[key] = record[key]
  }
  return answers
}

export function createSession({ collection, action, matchName = null, record = null }) {
  const editing = action === 'update'
  return {
    collection,
    action,
    matchName,
    answers: answersFromRecord(collection, record),
    // Everything the record already had that we no longer ask about (e.g. the
    // retired `pace` field) is preserved through publish, not through here.
    stepIndex: editing ? null : 0,
    mode: editing ? 'menu' : 'walk',
    previewId: null,
    savedAt: Date.now(),
  }
}

export function currentStep(session) {
  if (session.mode !== 'walk' && session.mode !== 'field') return null
  return visibleSteps(session.collection, session.answers)[session.stepIndex] || null
}

export function stepNumber(session) {
  const steps = visibleSteps(session.collection, session.answers)
  return { index: session.stepIndex, total: steps.length }
}

function afterAnswer(session) {
  if (session.mode === 'field') {
    session.mode = 'menu'
    session.stepIndex = null
    return
  }
  const steps = visibleSteps(session.collection, session.answers)
  if (session.stepIndex + 1 >= steps.length) {
    session.mode = 'preview'
    session.stepIndex = null
    return
  }
  session.stepIndex += 1
}

export async function submitAnswer(session, input) {
  const step = currentStep(session)
  if (!step) return { error: 'There is no question waiting for an answer right now.' }

  const result = await applyStepInput(step, input)
  if (result.error) return { error: result.error }

  Object.assign(session.answers, result.values)
  session.previewId = null
  afterAnswer(session)
  return { ok: true, mode: session.mode }
}

// Photos accumulate one at a time (each attached photo, or each pasted link)
// instead of arriving as a single typed answer — so unlike every other field,
// there's no one-shot submitAnswer() for it. addPhoto() appends and stays on
// the step; finishPhotos() commits whatever's accumulated (possibly none) and
// advances, reusing submitAnswer's own validation/advance logic.
export function addPhoto(session, url) {
  const step = currentStep(session)
  if (!step || step.key !== 'photos') return { error: 'Not currently on the photos question.' }
  const existing = Array.isArray(session.answers.photos) ? session.answers.photos : []
  if (existing.length >= 3) return { error: 'Already have 3 photos — tap Done to continue, or Back to start over.' }
  session.answers.photos = [...existing, url]
  session.previewId = null
  return { ok: true, count: session.answers.photos.length }
}

export async function finishPhotos(session) {
  const step = currentStep(session)
  if (!step || step.key !== 'photos') return { error: 'Not currently on the photos question.' }
  return submitAnswer(session, session.answers.photos || [])
}

export function skipStep(session) {
  const step = currentStep(session)
  if (!step) return { error: 'There is no question waiting right now.' }
  if (!step.optional) return { error: `${step.title} is required — it can't be skipped.` }
  session.answers[step.key] = ''
  session.previewId = null
  afterAnswer(session)
  return { ok: true, mode: session.mode }
}

// Back: from a menu-opened field, back to the menu; otherwise one question up.
export function goBack(session) {
  if (session.mode === 'field') {
    session.mode = 'menu'
    session.stepIndex = null
    return { ok: true, mode: session.mode }
  }
  if (session.mode === 'preview') {
    session.mode = 'walk'
    session.stepIndex = visibleSteps(session.collection, session.answers).length - 1
    session.previewId = null
    return { ok: true, mode: session.mode }
  }
  if (session.mode === 'walk' && session.stepIndex > 0) {
    session.stepIndex -= 1
    return { ok: true, mode: session.mode }
  }
  return { error: 'This is the first question — /cancel to start over.' }
}

export function openField(session, key) {
  const index = visibleSteps(session.collection, session.answers).findIndex((step) => step.key === key)
  if (index === -1) return { error: 'Unknown field.' }
  session.mode = 'field'
  session.stepIndex = index
  session.previewId = null
  return { ok: true }
}

export function openMenu(session) {
  session.mode = 'menu'
  session.stepIndex = null
  return { ok: true }
}

/* ---------- record assembly, display, whole-record validation ---------- */

export function recordFrom(collection, answers) {
  const record = {}
  for (const key of recordKeys(collection)) {
    const value = answers[key]
    if (key === 'notes') record[key] = value === undefined || value === null ? '' : String(value)
    else if (key === 'lat' || key === 'lng') record[key] = Number(value)
    else if (key === 'freebies') record[key] = value === true
    else if (key === 'photos') record[key] = Array.isArray(value) ? value : []
    else if (key === 'cost') record[key] = value === 'free' || value === 'paid' ? value : ''
    // A price only means anything alongside a paid cost. Dropping it otherwise
    // stops a stale figure surviving a Paid -> Free edit and rendering as
    // "Free — AED 50".
    else if (key === 'price') record[key] = answers.cost === 'paid' && value ? String(value) : ''
    else record[key] = value === undefined || value === null ? '' : value
  }
  return record
}

export function displayValue(step, answers) {
  if (step.kind === 'location') {
    const { lat, lng } = answers
    return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) ? `${lat}, ${lng}` : '—'
  }
  const value = answers[step.key]
  if (step.field && step.field.type === 'photoList') {
    const urls = Array.isArray(value) ? value : []
    return urls.length ? `${urls.length} photo${urls.length > 1 ? 's' : ''}` : '(none)'
  }
  if (value === undefined || value === null || value === '') return step.optional ? '(none)' : '—'
  if (step.kind === 'boolean') return value ? 'Yes' : 'No'
  if (step.options) {
    const option = step.options.find((o) => o.value === value)
    return option ? option.label : String(value)
  }
  return String(value)
}

// Returns { key, title, problem } for every step whose current answer is not
// publishable — used before the preview, and to flag legacy values (e.g. the
// old type "track") when editing an existing record.
export function validateAll(collection, answers) {
  const problems = []
  for (const step of visibleSteps(collection, answers)) {
    if (step.kind === 'location') {
      const lat = Number(answers.lat)
      const lng = Number(answers.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        problems.push({ key: step.key, title: step.title, problem: 'no valid coordinates yet' })
      }
      continue
    }
    if (step.kind === 'choice') {
      const value = answers[step.key]
      if (!step.options.some((o) => o.value === value)) {
        problems.push({ key: step.key, title: step.title, problem: `pick one of: ${step.options.map((o) => o.label).join(', ')}` })
      }
      continue
    }
    if (step.kind === 'boolean') {
      if (typeof answers[step.key] !== 'boolean') {
        problems.push({ key: step.key, title: step.title, problem: 'answer yes or no' })
      }
      continue
    }
    const result = validateField(step.field, answers[step.key])
    if (result.error) problems.push({ key: step.key, title: step.title, problem: result.error })
  }
  return problems
}

export function summaryLines(collection, answers) {
  const problems = new Map(validateAll(collection, answers).map((p) => [p.key, p]))
  return visibleSteps(collection, answers).map((step) => {
    const flag = problems.has(step.key) ? '  ⚠️' : ''
    return `${step.title}: ${displayValue(step, answers)}${flag}`
  })
}

export function recordSummary(collection, answers) {
  return summaryLines(collection, answers).join('\n')
}
