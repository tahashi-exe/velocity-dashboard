/* Field definitions, validation, and the paste-back form.
   Deliberately free of any grammy import so it can be unit-tested (and
   reasoned about) on its own — index.js owns all Telegram I/O.

   The STEP_* objects below are the single source of truth for every field's
   label, options and validation rules. They were originally walked one
   question at a time; the flow now renders them all at once as a "key: value"
   block (see buildForm/parseForm), but the definitions did not change. */

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

/* The steps that actually apply to a record. A step with a `when` predicate
   drops out when the predicate is false against the answers so far, so Price
   simply doesn't exist on a free run.

   Because the list is derived from the current answers each time it's read,
   changing Cost re-shapes it immediately: switching a record from paid to free
   stops validating (and stops showing) a Price that is no longer asked for.
   The preview summary and the pre-publish check both go through this, so a
   stale Price can never reach a published record. */
export function visibleSteps(collection, answers) {
  const seen = answers || {}
  return stepsFor(collection).filter((step) => (step.when ? step.when(seen) : true))
}

export function recordKeys(collection) {
  return collection === 'clubs' ? CLUB_KEYS : EVENT_KEYS
}

export function thingFor(collection) {
  return collection === 'clubs' ? 'club' : 'event'
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

/* ---------- the form ----------
   Every text field is asked at once as a "key: value" block that Taha edits
   and sends back in one message. Photos can't ride along in pasted text —
   a Telegram attachment is always its own message — so they're collected
   immediately afterwards, and are the one field excluded from the block.

   The STEP_* definitions above stay the single source of truth for labels,
   options and validation; this section only changes how they're presented. */

const PHOTO_KEY = 'photos'

// Price is deliberately included even though visibleSteps() would drop it on a
// blank form (no cost answered yet) — it has to be on the page for Taha to
// fill in. parseForm() re-applies the `when` predicate, so a price typed
// against a free run is simply ignored rather than rejected.
export function formSteps(collection) {
  return stepsFor(collection).filter((step) => step.key !== PHOTO_KEY)
}

// The greyed-out placeholder after each colon. Also does double duty as a
// sentinel: parseForm() treats a value still exactly equal to its hint as
// "left blank", so an untouched `notes: optional` doesn't publish the literal
// word "optional".
export function formHint(step) {
  if (step.kind === 'choice') return step.options.map((o) => o.value).join(' | ')
  if (step.kind === 'boolean') return 'yes | no'
  if (step.kind === 'location') return 'maps link, or 25.1950, 55.2358'
  if (step.key === 'date') return 'YYYY-MM-DD'
  if (step.key === 'time') return 'HH:MM (24-hour)'
  if (step.key === 'link') return 'https://...'
  if (step.key === 'price') return 'only if paid, e.g. AED 50'
  if (step.optional) return 'optional'
  return ''
}

function formValue(step, answers) {
  if (step.kind === 'location') {
    const { lat, lng } = answers
    return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) ? `${lat}, ${lng}` : ''
  }
  const value = answers[step.key]
  if (value === undefined || value === null || value === '') return ''
  if (step.kind === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

// Blank for a new record, pre-filled for an edit. Either way every line is
// present, so the reply is always a complete record.
export function buildForm(collection, answers) {
  const seen = answers || {}
  return formSteps(collection)
    .map((step) => `${step.key}: ${formValue(step, seen) || formHint(step)}`)
    .join('\n')
}

/* Parses a sent-back block into answers. Collects *every* problem rather than
   stopping at the first, so one reply lists everything that needs fixing
   instead of trickling errors out one resend at a time. */
export async function parseForm(collection, text) {
  const raw = {}
  for (const line of String(text || '').split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    // Only the first colon splits — URLs and "AED 50: early bird" survive.
    raw[key] = line.slice(idx + 1).trim()
  }

  const answers = {}
  const errors = []

  for (const step of formSteps(collection)) {
    // Re-applied against answers built so far, so Price disappears the moment
    // Cost parses as "free" — same rule the preview and publish paths use.
    if (step.when && !step.when(answers)) continue

    let value = raw[step.key]
    if (value === undefined) {
      if (!step.optional) errors.push(`${step.title} — the "${step.key}:" line is missing`)
      else answers[step.key] = ''
      continue
    }

    if (value === formHint(step)) value = ''
    if (!value) {
      if (!step.optional) errors.push(`${step.title} — needs a value`)
      else answers[step.key] = ''
      continue
    }

    if (step.kind === 'location') {
      const resolved = await resolveLocationInput(value)
      if (resolved.error) errors.push(`${step.title} — ${resolved.error}`)
      else Object.assign(answers, { lat: resolved.lat, lng: resolved.lng })
      continue
    }

    if (step.kind === 'choice') {
      const normalized = value.toLowerCase()
      const option = step.options.find((o) => o.value === normalized || o.label.toLowerCase() === normalized)
      if (!option) errors.push(`${step.title} — must be one of: ${step.options.map((o) => o.value).join(', ')}`)
      else answers[step.key] = option.value
      continue
    }

    const result = validateField(step.field, value)
    if (result.error) errors.push(`${step.title} — ${result.error}`)
    else answers[step.key] = result.value
  }

  return { answers, errors }
}

/* ---------- session ----------
   mode:
     'form'    — waiting for the filled-in block to come back
     'photos'  — waiting for attachments, or Done/Skip
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
  return {
    collection,
    action,
    matchName,
    // Everything the record already had that we no longer ask about (e.g. the
    // retired `pace` field) is preserved through publish, not through here.
    answers: answersFromRecord(collection, record),
    mode: 'form',
    previewId: null,
    pendingUploads: [],
    savedAt: Date.now(),
  }
}

// Merges a parsed form over whatever the session already held, so photos
// attached before an edit survive a re-send of the block.
export function applyForm(session, answers) {
  Object.assign(session.answers, answers)
  session.mode = 'photos'
  session.previewId = null
}

export function backToForm(session) {
  session.mode = 'form'
  session.previewId = null
}

export function addPhoto(session, url) {
  if (session.mode !== 'photos') return { error: 'Not on the photos step right now.' }
  const existing = Array.isArray(session.answers.photos) ? session.answers.photos : []
  if (existing.length >= 3) return { error: 'Already have 3 photos — tap Done to continue.' }
  session.answers.photos = [...existing, url]
  session.previewId = null
  return { ok: true, count: session.answers.photos.length }
}

export function finishPhotos(session) {
  if (session.mode !== 'photos') return { error: 'Not on the photos step right now.' }
  if (!Array.isArray(session.answers.photos)) session.answers.photos = []
  session.mode = 'preview'
  session.previewId = null
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
