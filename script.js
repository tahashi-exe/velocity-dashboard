/* ---------- Setup ---------- */

const DUBAI_CENTER = [25.2048, 55.2708];
const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const RUN_NOW_LOOKAHEAD_MIN = 180; // "within the next few hours"
const RUN_NOW_LOOKBACK_MIN = 60;   // still show a run that started recently
const WEEK_MIN = 7 * 24 * 60;
const PREFS_KEY = 'velocity_prefs';

let map, allItems = [], markers = [];
let filterMode = 'all'; // 'all' | 'match'
let listExpanded = false;

const clubPanel = document.getElementById('club-panel');
const clubPanelContent = document.getElementById('club-panel-content');
const runnowPanel = document.getElementById('runnow-panel');
const runnowContent = document.getElementById('runnow-content');
const filtersPanel = document.getElementById('filters-panel');
const filtersContent = document.getElementById('filters-content');
const overlay = document.getElementById('overlay');
const listSheet = document.getElementById('list-sheet');
const listContent = document.getElementById('list-content');
const thisWeekBanner = document.getElementById('this-week-banner');

function initMap() {
  map = L.map('map', { zoomControl: true }).setView(DUBAI_CENTER, 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}

/* ---------- Data loading ---------- */

async function loadData() {
  const [clubsRes, eventsRes] = await Promise.all([
    fetch('clubs.json'),
    fetch('events.json')
  ]);
  const clubs = (await clubsRes.json()).map(c => ({ ...c, kind: 'recurring' }));
  const events = (await eventsRes.json()).map(e => ({ ...e, kind: 'oneoff' }));
  allItems = [...clubs, ...events];
  renderAll();
}

function renderAll() {
  renderMarkers();
  renderList();
}

/* ---------- Color coding ---------- */

function getColor(item) {
  if (item.kind === 'oneoff') return 'black';
  if (item.freebies) return 'green';
  if (item.type === 'training') return 'red';
  return 'white';
}

function coloredIcon(color, name) {
  return L.divIcon({
    className: '',
    html: `
      <div class="club-marker-wrap">
        <div class="marker-label">${name}</div>
        <div class="club-marker color-${color}"></div>
      </div>
    `,
    iconSize: [30, 56],
    iconAnchor: [15, 28]
  });
}

/* ---------- Status logic (recurring + one-off) ---------- */

// Returns { phase: 'soon' | 'upcoming' | 'expired', minutesDiff, label }
function getItemStatus(item, now) {
  if (item.kind === 'oneoff') {
    const [y, m, d] = item.date.split('-').map(Number);
    const [h, mi] = item.time.split(':').map(Number);
    const target = new Date(y, m - 1, d, h, mi, 0, 0);
    const minutesDiff = (target - now) / 60000;
    if (minutesDiff >= -RUN_NOW_LOOKBACK_MIN && minutesDiff <= RUN_NOW_LOOKAHEAD_MIN) {
      return { phase: 'soon', minutesDiff, label: soonLabel(minutesDiff) };
    }
    if (minutesDiff > RUN_NOW_LOOKAHEAD_MIN) {
      return { phase: 'upcoming', minutesDiff, label: `${formatDate(target)}, ${formatTime(item.time)}` };
    }
    return { phase: 'expired', minutesDiff, label: 'Already happened' };
  }

  // Recurring: search a window for a "soon" occurrence first
  const targetDay = DAYS.indexOf(item.day.toLowerCase());
  const [h, m] = item.time.split(':').map(Number);
  for (let offset = -1; offset <= 7; offset++) {
    const d = new Date(now);
    d.setDate(now.getDate() + offset);
    if (d.getDay() !== targetDay) continue;
    d.setHours(h, m, 0, 0);
    const minutesDiff = (d - now) / 60000;
    if (minutesDiff >= -RUN_NOW_LOOKBACK_MIN && minutesDiff <= RUN_NOW_LOOKAHEAD_MIN) {
      return { phase: 'soon', minutesDiff, label: soonLabel(minutesDiff) };
    }
  }
  // No "soon" occurrence — find the next upcoming one (always exists within a week)
  for (let offset = 0; offset <= 7; offset++) {
    const d = new Date(now);
    d.setDate(now.getDate() + offset);
    if (d.getDay() !== targetDay) continue;
    d.setHours(h, m, 0, 0);
    const minutesDiff = (d - now) / 60000;
    if (minutesDiff >= 0) {
      return { phase: 'upcoming', minutesDiff, label: `${capitalize(item.day)}, ${formatTime(item.time)}` };
    }
  }
  return { phase: 'expired', minutesDiff: Infinity, label: '' };
}

function soonLabel(minutesDiff) {
  return minutesDiff <= 0
    ? `Started ${Math.abs(Math.round(minutesDiff))} min ago`
    : `In ${formatMinutes(minutesDiff)}`;
}

/* ---------- Markers ---------- */

function renderMarkers() {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  const items = visibleItems();
  items.forEach(item => {
    const color = getColor(item);
    const marker = L.marker([item.lat, item.lng], { icon: coloredIcon(color, item.name) }).addTo(map);
    marker.on('click', () => openDetailPanel(item));
    markers.push(marker);
  });
}

function visibleItems() {
  const prefs = getPrefs();
  if (filterMode === 'match' && prefs) {
    return allItems.filter(item => matchesPrefs(item, prefs));
  }
  return allItems;
}

function matchesPrefs(item, prefs) {
  let ok = true;
  if (prefs.sessionType) ok = ok && item.type === prefs.sessionType;
  if (prefs.surface) ok = ok && (item.surface === prefs.surface || !item.surface);
  return ok;
}

/* ---------- Detail panel ---------- */

function openDetailPanel(item) {
  const status = getItemStatus(item, new Date());
  const scheduleLine = item.kind === 'oneoff'
    ? `${formatDate(parseDateOnly(item.date))}, ${formatTime(item.time)}`
    : `${capitalize(item.day)}s, ${formatTime(item.time)}`;

  clubPanelContent.innerHTML = `
    <div class="tag-row">
      <span class="tag">${item.kind === 'oneoff' ? 'One-off event' : item.type}</span>
      <span class="tag lime">${item.pace}</span>
      ${item.freebies ? '<span class="tag lime">Freebies</span>' : ''}
    </div>
    <div class="club-title">${item.name}</div>
    <div class="club-location">${item.location_name}</div>

    <div class="info-row">
      <span class="label">${item.kind === 'oneoff' ? 'When' : 'Usual run'}</span>
      <span class="value">${scheduleLine}</span>
    </div>
    <div class="info-row">
      <span class="label">Right now</span>
      <span class="value">${status.label}</span>
    </div>

    ${item.notes ? `<div class="club-notes">${item.notes}</div>` : ''}

    <a class="club-link-btn" href="${item.link}" target="_blank" rel="noopener">Open club link</a>
    <div class="updated-note">Last updated ${item.last_updated}</div>
  `;
  openPanel(clubPanel);
}

/* ---------- Run Now ---------- */

document.getElementById('run-now-btn').addEventListener('click', handleRunNow);

let runNowPool = [];
let runNowUsingSoon = false;
let runNowUserLoc = null;
let runNowSortMode = 'time'; // 'time' | 'distance'

function handleRunNow() {
  runnowContent.innerHTML = `<div class="empty-state"><div class="emoji">📍</div><p>Finding runs near you…</p></div>`;
  openPanel(runnowPanel);
  runNowSortMode = 'time';

  if (!navigator.geolocation) {
    computeRunNow(null);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => computeRunNow({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    () => computeRunNow(null),
    { timeout: 8000 }
  );
}

function computeRunNow(userLoc) {
  const now = new Date();
  const scored = visibleItems()
    .map(item => ({ item, status: getItemStatus(item, now) }))
    .filter(s => s.status.phase !== 'expired');

  const soon = scored.filter(s => s.status.phase === 'soon');
  runNowUsingSoon = soon.length > 0;

  // Time priority is always the base set: soonest-running clubs if any exist,
  // otherwise the closest upcoming ones (capped so the list stays useful).
  let pool = runNowUsingSoon
    ? [...soon].sort((a, b) => a.status.minutesDiff - b.status.minutesDiff)
    : [...scored].sort((a, b) => a.status.minutesDiff - b.status.minutesDiff).slice(0, 8);

  if (userLoc) {
    pool.forEach(s => { s.distanceKm = haversineKm(userLoc.lat, userLoc.lng, s.item.lat, s.item.lng); });
  }

  runNowPool = pool;
  runNowUserLoc = userLoc;
  renderRunNowPanel();
}

function renderRunNowPanel() {
  if (runNowPool.length === 0) {
    runnowContent.innerHTML = `
      <div class="runnow-header">Run Now</div>
      <div class="empty-state">
        <div class="emoji">🌙</div>
        <p>No upcoming runs found right now.</p>
      </div>
    `;
    return;
  }

  const sorted = [...runNowPool].sort((a, b) =>
    runNowSortMode === 'distance' && runNowUserLoc
      ? a.distanceKm - b.distanceKm
      : a.status.minutesDiff - b.status.minutesDiff
  );

  const headerNote = runNowUsingSoon
    ? 'running soon'
    : 'nothing running in the next few hours — closest upcoming';

  const sortToggle = runNowUserLoc ? `
    <div class="filter-toggle-row" style="margin-bottom:16px;">
      <div class="filter-toggle${runNowSortMode === 'time' ? ' active' : ''}" id="sort-time">Soonest first</div>
      <div class="filter-toggle${runNowSortMode === 'distance' ? ' active' : ''}" id="sort-distance">Nearest first</div>
    </div>
  ` : '';

  runnowContent.innerHTML = `
    <div class="runnow-header">Run Now</div>
    <div class="runnow-sub">${sorted.length} ${sorted.length > 1 ? 'options' : 'option'} — ${headerNote}</div>
    ${sortToggle}
    ${sorted.map(s => `
      <div class="runnow-card">
        <span class="runnow-status">${s.status.phase === 'soon' ? s.status.label : 'Next up: ' + s.status.label}</span>
        <div class="club-title">${s.item.name}</div>
        <div class="runnow-meta">${s.item.location_name}</div>
        <div class="runnow-meta">${s.item.pace}${s.distanceKm != null ? ' · ' + s.distanceKm.toFixed(1) + ' km away' : ''}</div>
      </div>
    `).join('')}
  `;

  if (runNowUserLoc) {
    document.getElementById('sort-time').addEventListener('click', () => { runNowSortMode = 'time'; renderRunNowPanel(); });
    document.getElementById('sort-distance').addEventListener('click', () => { runNowSortMode = 'distance'; renderRunNowPanel(); });
  }
}

/* ---------- List / Map sheet ---------- */

function renderList() {
  const now = new Date();
  const items = visibleItems()
    .map(item => ({ item, status: getItemStatus(item, now) }))
    .filter(s => s.status.phase !== 'expired')
    .sort((a, b) => a.status.minutesDiff - b.status.minutesDiff);

  const thisWeek = items.filter(s => s.status.minutesDiff <= WEEK_MIN);
  thisWeekBanner.textContent = thisWeek.length > 0
    ? `🏃 Runs this week: ${thisWeek.length}`
    : `No runs found this week`;

  listContent.innerHTML = items.map(s => `
    <div class="list-row" data-name="${s.item.name}">
      <span class="legend-dot ${getColor(s.item)}"></span>
      <div class="list-row-info">
        <div class="list-row-name">${s.item.name}</div>
        <div class="list-row-meta">${s.item.location_name} · ${s.status.phase === 'soon' ? s.status.label : s.status.label}</div>
      </div>
    </div>
  `).join('');

  listContent.querySelectorAll('.list-row').forEach(row => {
    row.addEventListener('click', () => {
      const item = allItems.find(i => i.name === row.dataset.name);
      if (item) openDetailPanel(item);
    });
  });
}

/* Sheet expand/collapse via handle click + basic drag */
const sheetHandle = document.getElementById('sheet-handle');
sheetHandle.addEventListener('click', () => setSheetExpanded(!listExpanded));

function setSheetExpanded(val) {
  listExpanded = val;
  listSheet.classList.toggle('expanded', listExpanded);
}

let dragStartY = null;
sheetHandle.addEventListener('pointerdown', e => { dragStartY = e.clientY; });
window.addEventListener('pointerup', e => {
  if (dragStartY === null) return;
  const delta = e.clientY - dragStartY;
  if (delta < -30) setSheetExpanded(true);
  else if (delta > 30) setSheetExpanded(false);
  dragStartY = null;
});

/* ---------- Onboarding ---------- */

const onboardingModal = document.getElementById('onboarding-modal');
const onboardingSteps = document.getElementById('onboarding-steps');

const OB_STEPS = [
  {
    key: 'about',
    title: 'About you',
    sub: 'Nothing shared beyond this device.',
    fields: [
      { type: 'text', key: 'name', label: 'Name' },
      { type: 'number', key: 'age', label: 'Age' }
    ]
  },
  {
    key: 'runstyle',
    title: 'Run style',
    sub: 'Pick what fits best.',
    fields: [
      { type: 'choice', key: 'pace', label: 'Pace', options: ['Easy / social', 'Tempo', 'Training'] },
      { type: 'choice', key: 'sessionType', label: 'Session type', options: ['social', 'training'] }
    ]
  },
  {
    key: 'location',
    title: 'Location preference',
    sub: '',
    fields: [
      { type: 'choice', key: 'surface', label: 'Where do you like to run?', options: ['track', 'beach'] }
    ]
  },
  {
    key: 'extras',
    title: 'Extras',
    sub: '',
    fields: [
      { type: 'choice', key: 'wantsFreebies', label: 'Interested in clubs with collabs, freebies, or coffee after runs?', options: ['Yes', 'No'] }
    ]
  }
];

let obIndex = 0;
let obData = {};

function getPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function savePrefs(data) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(data));
}

function openOnboarding(prefill) {
  obIndex = 0;
  obData = prefill ? { ...prefill } : {};
  renderObStep();
  onboardingModal.classList.add('open');
}

function closeOnboarding() {
  onboardingModal.classList.remove('open');
}

function renderObStep() {
  const step = OB_STEPS[obIndex];
  const fieldsHtml = step.fields.map(f => {
    if (f.type === 'text' || f.type === 'number') {
      const val = obData[f.key] != null ? obData[f.key] : '';
      return `<input class="ob-input" type="${f.type}" placeholder="${f.label}" data-key="${f.key}" value="${val}" />`;
    }
    const options = f.options.map(opt => {
      const selected = obData[f.key] === opt ? ' selected' : '';
      return `<div class="ob-option${selected}" data-key="${f.key}" data-value="${opt}">${opt}</div>`;
    }).join('');
    return `<div class="ob-step-sub" style="margin:14px 0 6px;font-weight:700;color:var(--text);">${f.label}</div><div class="ob-options">${options}</div>`;
  }).join('');

  onboardingSteps.innerHTML = `
    <div class="ob-progress">Step ${obIndex + 1} of ${OB_STEPS.length}</div>
    <div class="ob-step-title">${step.title}</div>
    ${step.sub ? `<div class="ob-step-sub">${step.sub}</div>` : ''}
    ${fieldsHtml}
    <div class="ob-nav">
      <button class="ob-btn secondary" id="ob-back">${obIndex === 0 ? 'Skip' : 'Back'}</button>
      <button class="ob-btn primary" id="ob-next">${obIndex === OB_STEPS.length - 1 ? 'Finish' : 'Next'}</button>
    </div>
  `;

  onboardingSteps.querySelectorAll('input.ob-input').forEach(input => {
    input.addEventListener('input', () => { obData[input.dataset.key] = input.value; });
  });
  onboardingSteps.querySelectorAll('.ob-option').forEach(opt => {
    opt.addEventListener('click', () => {
      obData[opt.dataset.key] = opt.dataset.value;
      renderObStep();
    });
  });
  document.getElementById('ob-back').addEventListener('click', () => {
    if (obIndex === 0) { closeOnboarding(); return; }
    obIndex--; renderObStep();
  });
  document.getElementById('ob-next').addEventListener('click', () => {
    if (obIndex < OB_STEPS.length - 1) { obIndex++; renderObStep(); return; }
    savePrefs(obData);
    closeOnboarding();
    renderAll();
  });
}

document.getElementById('profile-btn').addEventListener('click', () => {
  openOnboarding(getPrefs() || {});
});

/* ---------- Legend popover ---------- */

const legendBtn = document.getElementById('legend-btn');
const legendPopover = document.getElementById('legend-popover');

legendBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = legendPopover.classList.toggle('open');
  legendBtn.setAttribute('aria-expanded', String(isOpen));
});

document.addEventListener('click', (e) => {
  if (!legendPopover.classList.contains('open')) return;
  if (e.target === legendBtn || legendPopover.contains(e.target)) return;
  legendPopover.classList.remove('open');
  legendBtn.setAttribute('aria-expanded', 'false');
});

/* ---------- Filters panel ---------- */

const WELLNESS_LOCKED = ['Yoga', 'Pilates', 'Recovery Hubs', 'Other Sports'];

document.getElementById('filters-btn').addEventListener('click', () => {
  renderFilters();
  openPanel(filtersPanel);
});

function renderFilters() {
  filtersContent.innerHTML = `
    <div class="club-title" style="margin-top:6px;">Filters</div>
    <div class="filter-section-title">Show</div>
    <div class="filter-toggle-row">
      <div class="filter-toggle${filterMode === 'all' ? ' active' : ''}" id="filter-all">View all</div>
      <div class="filter-toggle${filterMode === 'match' ? ' active' : ''}" id="filter-match">Match my prefs</div>
    </div>

    <div class="filter-section-title">Wellness (coming soon)</div>
    ${WELLNESS_LOCKED.map(w => `<div class="locked-chip" data-label="${w}">${w} <span class="lock-icon">🔒</span></div>`).join('')}
  `;

  document.getElementById('filter-all').addEventListener('click', () => { filterMode = 'all'; renderFilters(); renderAll(); });
  document.getElementById('filter-match').addEventListener('click', () => {
    if (!getPrefs()) { openOnboarding({}); return; }
    filterMode = 'match'; renderFilters(); renderAll();
  });
  filtersContent.querySelectorAll('.locked-chip').forEach(chip => {
    chip.addEventListener('click', () => showToast('Featuring in the next release'));
  });
}

function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}

/* ---------- Helpers ---------- */

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

/* ---------- Panel open/close ---------- */

function openPanel(panel) {
  panel.classList.add('open');
  overlay.classList.add('open');
}
function closeAllPanels() {
  clubPanel.classList.remove('open');
  runnowPanel.classList.remove('open');
  filtersPanel.classList.remove('open');
  overlay.classList.remove('open');
}

document.getElementById('close-panel').addEventListener('click', closeAllPanels);
document.getElementById('close-runnow').addEventListener('click', closeAllPanels);
document.getElementById('close-filters').addEventListener('click', closeAllPanels);
overlay.addEventListener('click', closeAllPanels);

/* ---------- Landing page ---------- */

const landingPage = document.getElementById('landing-page');

document.getElementById('lets-run-btn').addEventListener('click', () => {
  landingPage.classList.add('hidden');
  if (!getPrefs()) {
    openOnboarding({});
  }
});

/* ---------- Init ---------- */

initMap();
loadData();
