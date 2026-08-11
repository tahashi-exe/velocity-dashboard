/* ---------- Setup ---------- */

const DUBAI_CENTER = [25.2048, 55.2708];
const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const RUN_NOW_LOOKAHEAD_MIN = 180; // "within the next few hours"
const RUN_NOW_LOOKBACK_MIN = 60;   // still show a run that started recently

let map, clubs = [], markers = [];

const clubPanel = document.getElementById('club-panel');
const clubPanelContent = document.getElementById('club-panel-content');
const runnowPanel = document.getElementById('runnow-panel');
const runnowContent = document.getElementById('runnow-content');
const overlay = document.getElementById('overlay');

function initMap() {
  map = L.map('map', { zoomControl: true }).setView(DUBAI_CENTER, 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}

function purpleIcon(active, name) {
  return L.divIcon({
    className: '',
    html: `
      <div class="club-marker-wrap">
        <div class="marker-label">${name}</div>
        <div class="club-marker${active ? ' active' : ''}"></div>
      </div>
    `,
    iconSize: [30, 56],
    iconAnchor: [15, 28]
  });
}

/* ---------- Data loading ---------- */

async function loadClubs() {
  const res = await fetch('clubs.json');
  clubs = await res.json();
  renderMarkers();
}

function renderMarkers() {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  clubs.forEach(club => {
    const status = getRunStatus(club, new Date());
    const marker = L.marker([club.lat, club.lng], { icon: purpleIcon(status.isSoon, club.name) }).addTo(map);
    marker.on('click', () => openClubPanel(club));
    markers.push(marker);
  });
}

/* ---------- Club detail panel ---------- */

function openClubPanel(club) {
  const status = getRunStatus(club, new Date());
  clubPanelContent.innerHTML = `
    <div class="tag-row">
      <span class="tag">${club.type}</span>
      <span class="tag lime">${club.pace}</span>
    </div>
    <div class="club-title">${club.name}</div>
    <div class="club-location">${club.location_name}</div>

    <div class="info-row">
      <span class="label">Usual run</span>
      <span class="value">${capitalize(club.day)}s, ${formatTime(club.time)}</span>
    </div>
    <div class="info-row">
      <span class="label">Right now</span>
      <span class="value">${status.label}</span>
    </div>

    ${club.notes ? `<div class="club-notes">${club.notes}</div>` : ''}

    <a class="club-link-btn" href="${club.link}" target="_blank" rel="noopener">Open club link</a>
    <div class="updated-note">Last updated ${club.last_updated}</div>
  `;
  openPanel(clubPanel);
}

/* ---------- Run Now ---------- */

document.getElementById('run-now-btn').addEventListener('click', handleRunNow);

function handleRunNow() {
  runnowContent.innerHTML = `<div class="empty-state"><div class="emoji">📍</div><p>Finding runs near you…</p></div>`;
  openPanel(runnowPanel);

  if (!navigator.geolocation) {
    showRunNowResults(null);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => showRunNowResults({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    () => showRunNowResults(null), // permission denied / unavailable — fall back to time-only
    { timeout: 8000 }
  );
}

function showRunNowResults(userLoc) {
  const now = new Date();
  let matches = clubs
    .map(club => ({ club, status: getRunStatus(club, now) }))
    .filter(m => m.status.isSoon);

  if (userLoc) {
    matches.forEach(m => {
      m.distanceKm = haversineKm(userLoc.lat, userLoc.lng, m.club.lat, m.club.lng);
    });
    matches.sort((a, b) => a.distanceKm - b.distanceKm);
  } else {
    matches.sort((a, b) => a.status.minutesDiff - b.status.minutesDiff);
  }

  if (matches.length === 0) {
    runnowContent.innerHTML = `
      <div class="runnow-header">Run Now</div>
      <div class="empty-state">
        <div class="emoji">🌙</div>
        <p>Nothing running in the next few hours.<br>Check back closer to a club's usual time.</p>
      </div>
    `;
    return;
  }

  runnowContent.innerHTML = `
    <div class="runnow-header">Run Now</div>
    <div class="runnow-sub">${matches.length} club${matches.length > 1 ? 's' : ''} running soon${userLoc ? ', nearest first' : ''}</div>
    ${matches.map(m => `
      <div class="runnow-card">
        <span class="runnow-status">${m.status.label}</span>
        <div class="club-title">${m.club.name}</div>
        <div class="runnow-meta">${m.club.location_name}</div>
        <div class="runnow-meta">${m.club.pace}${m.distanceKm != null ? ' · ' + m.distanceKm.toFixed(1) + ' km away' : ''}</div>
      </div>
    `).join('')}
  `;
}

/* ---------- Time logic ---------- */

// Finds the closest occurrence (past or future) of a weekly club time relative to `now`,
// and reports whether it falls within the "running soon" window.
function getRunStatus(club, now) {
  const targetDay = DAYS.indexOf(club.day.toLowerCase());
  const [h, m] = club.time.split(':').map(Number);

  for (let offset = -1; offset <= 7; offset++) {
    const d = new Date(now);
    d.setDate(now.getDate() + offset);
    if (d.getDay() !== targetDay) continue;
    d.setHours(h, m, 0, 0);
    const minutesDiff = (d - now) / 60000;
    if (minutesDiff >= -RUN_NOW_LOOKBACK_MIN && minutesDiff <= RUN_NOW_LOOKAHEAD_MIN) {
      return {
        isSoon: true,
        minutesDiff,
        label: minutesDiff <= 0
          ? `Started ${Math.abs(Math.round(minutesDiff))} min ago`
          : `In ${formatMinutes(minutesDiff)}`
      };
    }
  }
  return { isSoon: false, minutesDiff: Infinity, label: 'Not running soon' };
}

function formatMinutes(min) {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
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

/* ---------- Panel open/close ---------- */

function openPanel(panel) {
  panel.classList.add('open');
  overlay.classList.add('open');
}
function closeAllPanels() {
  clubPanel.classList.remove('open');
  runnowPanel.classList.remove('open');
  overlay.classList.remove('open');
}

document.getElementById('close-panel').addEventListener('click', closeAllPanels);
document.getElementById('close-runnow').addEventListener('click', closeAllPanels);
overlay.addEventListener('click', closeAllPanels);

/* ---------- Landing page ---------- */

const landingPage = document.getElementById('landing-page');

document.getElementById('lets-run-btn').addEventListener('click', () => {
  landingPage.classList.add('hidden');
});

/* ---------- Init ---------- */

initMap();
loadClubs();
