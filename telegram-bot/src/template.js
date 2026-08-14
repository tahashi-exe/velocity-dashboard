const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const PACE = ['easy / social', 'tempo', 'training']

const CLUB_FIELDS = [
  { key: 'name', required: true },
  { key: 'location_name', required: true },
  { key: 'maps_link', required: false, convenience: true },
  { key: 'lat', required: true, type: 'number' },
  { key: 'lng', required: true, type: 'number' },
  { key: 'pace', required: true, enum: PACE },
  { key: 'type', required: true, enum: ['social', 'training', 'track'] },
  { key: 'surface', required: true, enum: ['track', 'beach', 'road'] },
  { key: 'freebies', required: true, type: 'boolean' },
  { key: 'day', required: true, enum: DAYS },
  { key: 'time', required: true, type: 'time' },
  { key: 'link', required: true, type: 'url' },
  { key: 'notes', required: false },
]

const EVENT_FIELDS = [
  { key: 'name', required: true },
  { key: 'location_name', required: true },
  { key: 'maps_link', required: false, convenience: true },
  { key: 'lat', required: true, type: 'number' },
  { key: 'lng', required: true, type: 'number' },
  { key: 'pace', required: true, enum: PACE },
  { key: 'type', required: true, enum: ['social', 'training'] },
  { key: 'surface', required: true, enum: ['track', 'beach', 'road'] },
  { key: 'freebies', required: true, type: 'boolean' },
  { key: 'date', required: true, type: 'date' },
  { key: 'time', required: true, type: 'time' },
  { key: 'link', required: true, type: 'url' },
  { key: 'notes', required: false },
]

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

export function fieldsFor(collection) {
  return collection === 'clubs' ? CLUB_FIELDS : EVENT_FIELDS
}

function hintFor(field) {
  if (field.key === 'maps_link') return '(optional — paste a Google Maps link and leave lat/lng below blank)'
  if (field.enum) return field.enum.join(' | ')
  if (field.type === 'number') return ''
  if (field.type === 'boolean') return 'yes or no'
  if (field.type === 'time') return 'HH:MM, 24h, e.g. 18:30'
  if (field.type === 'date') return 'YYYY-MM-DD'
  if (field.type === 'url') return ''
  if (field.key === 'notes') return '(optional)'
  return ''
}

function formatExisting(field, value) {
  if (value === undefined || value === null) return ''
  if (field.type === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

export function buildTemplate(collection, existing = null) {
  const fields = fieldsFor(collection)
  const lines = fields.map((field) => {
    const value = existing ? formatExisting(field, existing[field.key]) : hintFor(field)
    return `${field.key}: ${value}`
  })
  return lines.join('\n')
}

function validateField(field, rawValue) {
  const value = (rawValue || '').trim()
  if (!value) {
    if (field.required) return { error: 'missing' }
    return { value: '' }
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

export async function parseTemplate(collection, text) {
  const fields = fieldsFor(collection)
  const raw = {}

  for (const line of text.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    raw[key] = line.slice(idx + 1).trim()
  }

  const record = {}
  const errors = []

  const mapsLink = (raw.maps_link || '').trim()
  let mapsCoords = null
  if (mapsLink) {
    if (!/^https?:\/\//i.test(mapsLink)) {
      errors.push('maps_link — must be a link starting with http:// or https://')
    } else {
      mapsCoords = await resolveMapsLink(mapsLink)
      if (!mapsCoords) {
        errors.push("maps_link — couldn't find coordinates in that link. Try the link from the pin's Share button, or fill in lat/lng manually instead")
      }
    }
  }

  for (const field of fields) {
    if (field.convenience) continue
    if ((field.key === 'lat' || field.key === 'lng') && mapsCoords) {
      record[field.key] = mapsCoords[field.key]
      continue
    }
    const result = validateField(field, raw[field.key])
    if (result.error) errors.push(`${field.key} — ${result.error}`)
    else record[field.key] = result.value
  }

  return { record, errors }
}

export function recordSummary(record) {
  return Object.entries(record)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')
}
