/* ---------- shared data layer ----------
   Produces the runs[] shape from TECHNICAL.md §2 and owns status, prefs,
   RSVP and .ics logic.

   Two modes, decided by config.js (see backend.js):
   - static: runs come from clubs.json/events.json, RSVP and prefs are
     localStorage only, nothing syncs. This is what the live site runs today.
   - backend: runs come from Supabase, RSVPs belong to the signed-in user and
     prefs are mirrored to their profile. The JSON files remain the fallback
     if Supabase can't be reached. */

const Velocity = (() => {
  const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const LOOKAHEAD_MIN = 180; // "running soon" window, matches v1 Run Now
  const LOOKBACK_MIN = 60;
  const WEEK_MIN = 7 * 24 * 60;
  const MONTH_MIN = 31 * 24 * 60;
  const PREFS_KEY = 'velocity_prefs';
  const RSVP_KEY = 'velocity_rsvp_v2';

  // TECHNICAL.md §2 categories/category_types — running only, schema ready for more.
  const CATEGORIES = {
    running: {
      key: 'running',
      label: 'Running',
      types: [
        { key: 'social', label: 'Social' },
        { key: 'tempo', label: 'Tempo' },
        { key: 'training', label: 'Training', trainingEquivalent: true },
        { key: 'long_run', label: 'Long run' },
        { key: 'pyramid', label: 'Pyramid session' },
      ],
    },
  };

  function slug(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  // Records already carry the 5-value running taxonomy above, so pass those
  // through untouched — collapsing them was hiding the Tempo/Long run/Pyramid
  // filters entirely. v1's legacy `track` (and anything unrecognised) still
  // reads as "training" for pin-color/type purposes, with the track detail
  // living in `details.surface`.
  const TYPE_KEYS = CATEGORIES.running.types.map(t => t.key);
  function mapOldTypeToKey(oldType) {
    return TYPE_KEYS.includes(oldType) ? oldType : 'training';
  }

  function toRun(item, kind) {
    return {
      id: slug(item.name) + '-' + kind,
      category: 'running',
      kind, // 'recurring' | 'one_off'
      name: item.name,
      location_name: item.location_name,
      lat: item.lat,
      lng: item.lng,
      type_key: mapOldTypeToKey(item.type),
      freebies: !!item.freebies,
      // Whether you pay to take part — distinct from `freebies`, which is about
      // free things handed out on the day. Records written before the bot asked
      // this have neither field; they normalize to null, which reads as
      // "unknown" everywhere rather than as "free".
      cost: item.cost === 'free' || item.cost === 'paid' ? item.cost : null,
      price: item.cost === 'paid' && item.price ? String(item.price) : '',
      day_of_week: kind === 'recurring' ? item.day : null,
      event_date: kind === 'one_off' ? item.date : null,
      time: item.time,
      register_link: item.link,
      notes: item.notes || '',
      photos: Array.isArray(item.photos) ? item.photos.filter(Boolean).slice(0, 3) : [],
      details: { surface: item.surface, pace: item.pace },
      last_updated: item.last_updated,
    };
  }

  // A `runs` table row -> the same internal shape toRun() produces. `id` stays
  // the slug so everything keyed on run ids is identical in both modes.
  function fromRow(row) {
    return {
      id: row.slug,
      category: row.category_key,
      kind: row.kind,
      name: row.name,
      location_name: row.location_name,
      lat: row.lat,
      lng: row.lng,
      type_key: row.type_key,
      freebies: row.freebies,
      cost: row.cost,
      price: row.price,
      day_of_week: row.day_of_week,
      event_date: row.event_date,
      time: row.time.slice(0, 5), // Postgres `time` comes back as HH:MM:SS
      register_link: row.register_link,
      notes: row.notes,
      photos: row.photos || [],
      details: row.details || {},
      last_updated: row.last_updated,
    };
  }

  async function loadRunsFromJson() {
    const [clubsRes, eventsRes] = await Promise.all([fetch('clubs.json'), fetch('events.json')]);
    const clubs = await clubsRes.json();
    const events = await eventsRes.json();
    return [
      ...clubs.map(c => toRun(c, 'recurring')),
      ...events.map(e => toRun(e, 'one_off')),
    ];
  }

  let loadedRuns = [];
  let runsPromise = null;

  function loadRuns() {
    runsPromise = (async () => {
      if (await Backend.ready) {
        try {
          const rows = await Backend.fetchRuns();
          if (rows.length) return rows.map(fromRow);
        } catch (e) {
          console.warn('Velocity: could not read runs from the backend, using the JSON files', e);
        }
      }
      return loadRunsFromJson();
    })().then(runs => { loadedRuns = runs; return runs; });
    return runsPromise;
  }

  // For code that needs a run by id but didn't load the list itself (replaying
  // an action after sign-in).
  function runsReady() { return runsPromise || Promise.resolve(loadedRuns); }
  function findRun(id) { return loadedRuns.find(r => r.id === id) || null; }

  // null when the run predates the cost field — callers omit the row entirely
  // rather than claiming anything about a price nobody recorded.
  function costLabel(run) {
    if (run.cost === 'free') return 'Free';
    if (run.cost !== 'paid') return null;
    return run.price || 'Paid (amount not listed)';
  }

  function typeInfo(run) {
    return CATEGORIES[run.category].types.find(t => t.key === run.type_key);
  }

  function typeLabel(run) {
    const t = typeInfo(run);
    return t ? t.label : run.type_key;
  }

  // PRD.md §4.3 — base pin color reads kind + type; freebies is a separate
  // ring layer so it never overwrites the kind/type signal (TECHNICAL.md §4).
  function pinVisual(run) {
    let base;
    if (run.kind === 'one_off') base = 'black';
    else if (typeInfo(run) && typeInfo(run).trainingEquivalent) base = 'red';
    else base = 'white';
    return { base, ring: !!run.freebies };
  }

  /* ---------- status / scheduling (ported from v1 getItemStatus) ---------- */

  function statusOf(run, now) {
    if (run.kind === 'one_off') {
      const [y, m, d] = run.event_date.split('-').map(Number);
      const [h, mi] = run.time.split(':').map(Number);
      const target = new Date(y, m - 1, d, h, mi, 0, 0);
      const minutesDiff = (target - now) / 60000;
      if (minutesDiff >= -LOOKBACK_MIN && minutesDiff <= LOOKAHEAD_MIN) {
        return { phase: 'soon', minutesDiff, label: soonLabel(minutesDiff) };
      }
      if (minutesDiff > LOOKAHEAD_MIN) {
        return { phase: 'upcoming', minutesDiff, label: `${formatDate(target)}, ${formatTime(run.time)}` };
      }
      return { phase: 'expired', minutesDiff, label: 'Already happened' };
    }

    const targetDay = DAYS.indexOf(run.day_of_week.toLowerCase());
    const [h, m] = run.time.split(':').map(Number);
    for (let offset = -1; offset <= 7; offset++) {
      const d = new Date(now);
      d.setDate(now.getDate() + offset);
      if (d.getDay() !== targetDay) continue;
      d.setHours(h, m, 0, 0);
      const minutesDiff = (d - now) / 60000;
      if (minutesDiff >= -LOOKBACK_MIN && minutesDiff <= LOOKAHEAD_MIN) {
        return { phase: 'soon', minutesDiff, label: soonLabel(minutesDiff), nextDate: d };
      }
    }
    for (let offset = 0; offset <= 7; offset++) {
      const d = new Date(now);
      d.setDate(now.getDate() + offset);
      if (d.getDay() !== targetDay) continue;
      d.setHours(h, m, 0, 0);
      const minutesDiff = (d - now) / 60000;
      if (minutesDiff >= 0) {
        return { phase: 'upcoming', minutesDiff, label: `Next: ${capitalize(run.day_of_week)}, ${formatTime(run.time)}`, nextDate: d };
      }
    }
    return { phase: 'expired', minutesDiff: Infinity, label: '' };
  }

  function soonLabel(minutesDiff) {
    return minutesDiff <= 0
      ? `Started ${Math.abs(Math.round(minutesDiff))} min ago`
      : `In ${formatMinutes(minutesDiff)}`;
  }

  // PRD.md §4.6 — recurring runs are always *displayed* as a standing weekly
  // slot, never a rolling date. The next-occurrence math above still exists
  // (Run Now, sorting, .ics) — this is purely the label shown to the user.
  function scheduleLabel(run) {
    if (run.kind === 'one_off') {
      return `${formatDate(parseDateOnly(run.event_date))}, ${formatTime(run.time)}`;
    }
    return `Every ${capitalize(run.day_of_week)}, ${formatTime(run.time)}`;
  }

  // PRD.md §4.7 — expired one-offs are filtered out of every view (never
  // hard-deleted server-side, but that's a backend concern — TECHNICAL.md §7).
  function withinScope(status, run, scope) {
    if (status.phase === 'expired') return false;
    if (run.kind === 'recurring') return true;
    const cap = scope === 'month' ? MONTH_MIN : WEEK_MIN;
    return status.minutesDiff <= cap;
  }

  /* ---------- RSVP ----------
     Static mode: a localStorage mock, not synced. Backend mode: the signed-in
     user's rows in `rsvps` (TECHNICAL.md §2); a guest has none, and the UI
     asks them to sign in before calling setRsvp (auth-ui.js). */

  function getRsvpMap() {
    try { return JSON.parse(localStorage.getItem(RSVP_KEY)) || {}; } catch (e) { return {}; }
  }
  // 'not_interested' was retired along with its button; a stale local value
  // reads as no RSVP.
  const RSVP_STATUSES = ['going', 'not_going', 'interested'];
  function getRsvp(runId) {
    const status = Backend.enabled ? Backend.rsvpFor(runId) : getRsvpMap()[runId];
    return RSVP_STATUSES.includes(status) ? status : null;
  }
  // Resolves to the run's new status, or null if cleared. `toggle: false`
  // sets the status outright instead of clearing it when it's already active.
  async function setRsvp(runId, status, { toggle = true } = {}) {
    if (Backend.enabled) return Backend.setRsvp(runId, status, { toggle });
    const map = getRsvpMap();
    map[runId] = toggle && map[runId] === status ? null : status; // tap again to clear
    if (!map[runId]) delete map[runId];
    localStorage.setItem(RSVP_KEY, JSON.stringify(map));
    return map[runId] || null;
  }

  /* ---------- prefs (same shape as v1 velocity_prefs) ----------
     localStorage is always the working copy. When signed in, saves are also
     mirrored to the profile so they follow the user across devices. */

  function getPrefs() {
    try { const raw = localStorage.getItem(PREFS_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function savePrefs(data) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(data));
    if (Backend.user()) {
      Backend.updateProfile({ prefs: data }).catch(e => console.warn('Velocity: prefs saved on this device only', e));
    }
  }

  // "Match my prefs" filter — the one thing onboarding's answers actually
  // drive today. Each field only constrains the match if the user answered
  // it (an unset field never excludes a run).
  function matchesPrefs(run, prefs) {
    if (!prefs) return true;
    if (prefs.type_key && run.type_key !== prefs.type_key) return false;
    if (prefs.surface && run.details.surface && run.details.surface !== prefs.surface) return false;
    if (prefs.wantsFreebies === 'Yes' && !run.freebies) return false;
    return true;
  }

  /* ---------- .ics export (PRD.md §4.10 — per-event download) ---------- */

  function nextOccurrence(run, now) {
    if (run.kind === 'one_off') {
      const [y, m, d] = run.event_date.split('-').map(Number);
      const [h, mi] = run.time.split(':').map(Number);
      return new Date(y, m - 1, d, h, mi, 0, 0);
    }
    const status = statusOf(run, now);
    return status.nextDate || now;
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function toICSDate(d) {
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  }
  function escapeICS(s) { return String(s || '').replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n'); }
  const ICS_DAY = { sunday: 'SU', monday: 'MO', tuesday: 'TU', wednesday: 'WE', thursday: 'TH', friday: 'FR', saturday: 'SA' };

  function veventLines(run, now) {
    const start = nextOccurrence(run, now);
    const end = new Date(start.getTime() + 60 * 60000);
    const lines = [
      'BEGIN:VEVENT',
      `UID:${run.id}@velocityae.prototype`,
      `DTSTAMP:${toICSDate(now)}`,
      `DTSTART:${toICSDate(start)}`,
      `DTEND:${toICSDate(end)}`,
      `SUMMARY:${escapeICS(run.name)}`,
      `LOCATION:${escapeICS(run.location_name)}`,
      `DESCRIPTION:${escapeICS(run.notes)}`,
    ];
    if (run.kind === 'recurring') lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${ICS_DAY[run.day_of_week]}`);
    lines.push('END:VEVENT');
    return lines;
  }

  // One calendar file holding every given run (a single run for the detail
  // panel's button, several for My runs' "Add all to calendar").
  function icsForRuns(runList) {
    const now = new Date();
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VelocityAE//Prototype//EN',
      ...runList.flatMap(run => veventLines(run, now)),
      'END:VCALENDAR',
    ].join('\r\n');
  }
  function icsForRun(run) { return icsForRuns([run]); }

  function downloadFile(content, type, filename) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadICS(run) { downloadFile(icsForRun(run), 'text/calendar', `${slug(run.name)}.ics`); }
  function downloadICSForRuns(runList, filename) { downloadFile(icsForRuns(runList), 'text/calendar', filename); }

  /* ---------- generic helpers ---------- */

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function formatTime(t) {
    const [h, m] = t.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  }
  function formatMinutes(min) {
    if (min < 60) return `${Math.round(min)} min`;
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  function parseDateOnly(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function formatDate(d) {
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  return {
    DAYS, WEEK_MIN, MONTH_MIN, CATEGORIES,
    loadRuns, runsReady, findRun, typeInfo, typeLabel, pinVisual, statusOf, scheduleLabel, withinScope,
    getRsvp, setRsvp, getPrefs, savePrefs, matchesPrefs, costLabel,
    icsForRun, downloadICS, downloadICSForRuns, downloadFile, nextOccurrence,
    capitalize, formatTime, formatMinutes, parseDateOnly, formatDate, haversineKm, slug,
  };
})();
