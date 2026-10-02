/* A clubs.json / events.json record -> a row of the Supabase `runs` table
   (TECHNICAL.md §2).

   This is the one place that mapping lives for anything that writes to the
   database: the bot's publish step and supabase/seed-from-json.mjs both use
   it. It mirrors data.js toRun(), the browser's own normalization of the same
   records, and the two must agree — above all on the slug, which is the run's
   id in the app and what users' RSVPs hang off.

   Pure functions, no network and no env, so the tests run offline. */

const TYPE_KEYS = ['social', 'tempo', 'training', 'long_run', 'pyramid']

export function kindFor(collection) {
  return collection === 'clubs' ? 'recurring' : 'one_off'
}

// Same as data.js slug(), plus the kind suffix toRun() adds.
export function slugOf(name, kind) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return `${base}-${kind}`
}

export function toRunRow(record, kind) {
  const cost = record.cost === 'free' || record.cost === 'paid' ? record.cost : null
  const details = {}
  if (record.surface) details.surface = record.surface
  if (record.pace) details.pace = record.pace // retired, but carried like the JSON does

  return {
    slug: slugOf(record.name, kind),
    category_key: 'running',
    // Legacy `track` and anything unrecognised read as training, as in
    // data.js mapOldTypeToKey(). The table rejects unknown types outright.
    type_key: TYPE_KEYS.includes(record.type) ? record.type : 'training',
    kind,
    name: record.name,
    location_name: record.location_name || '',
    lat: Number(record.lat),
    lng: Number(record.lng),
    freebies: !!record.freebies,
    cost, // null = unknown, never "free"
    price: cost === 'paid' && record.price ? String(record.price) : '',
    day_of_week: kind === 'recurring' ? String(record.day).toLowerCase() : null,
    event_date: kind === 'one_off' ? record.date : null,
    time: record.time,
    register_link: record.link || '',
    photos: Array.isArray(record.photos) ? record.photos.filter(Boolean).slice(0, 3) : [],
    notes: record.notes || '',
    details,
    last_updated: record.last_updated || null,
  }
}
