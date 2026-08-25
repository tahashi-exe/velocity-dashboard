/* ---------- Variant B: Weekly Planner ----------
   Calendar is the primary affordance — lands directly on "plan your week,"
   the vision from PRD.md §1. Map is secondary, reached via a floating
   button that opens a full-screen overlay rather than living on-screen. */

const VariantB = (() => {
  let runs = [], scope = 'week', map = null;

  function mount() {
    const root = document.getElementById('app-root');
    root.innerHTML = `
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">V</span>
          <span class="brand-name">Velocity</span>
        </div>
        <div class="scope-toggle" role="group" aria-label="Time scope">
          <button type="button" class="scope-btn active" data-scope="week">This Week</button>
          <button type="button" class="scope-btn" data-scope="month">This Month</button>
        </div>
        <div class="topbar-actions">
          <button type="button" class="icon-btn" id="profile-btn" aria-label="Profile">&#128100;</button>
        </div>
      </header>

      <main class="planner-main">
        <div id="week-rail-mount"></div>
        <div id="cal-mount" class="cal-mount"></div>
      </main>

      <button type="button" class="fab" id="map-fab" aria-label="Open map">&#128506;&#65039;</button>

      <div id="map-modal" class="map-modal" aria-hidden="true">
        <button type="button" class="panel-close map-modal-close" id="map-modal-close">&times;</button>
        <div id="map-b" class="map-surface"></div>
      </div>
    `;

    SharedUI.initLanding(() => {});

    document.querySelectorAll('.scope-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        scope = btn.dataset.scope;
        document.querySelectorAll('.scope-btn').forEach(b => b.classList.toggle('active', b === btn));
        renderCalendar();
      });
    });

    document.getElementById('profile-btn').addEventListener('click', () => SharedUI.openOnboarding(Velocity.getPrefs() || {}));

    document.getElementById('map-fab').addEventListener('click', () => {
      document.getElementById('map-modal').classList.add('open');
      if (!map) {
        map = MapHelper.createMap('map-b');
        map.on('load', () => MapHelper.addMarkers(map, inScope().map(x => x.r), SharedUI.openRunDetail));
      } else {
        setTimeout(() => map.resize(), 50);
      }
    });
    document.getElementById('map-modal-close').addEventListener('click', () => {
      document.getElementById('map-modal').classList.remove('open');
    });

    document.addEventListener('velocity:prefs-changed', renderCalendar);

    Velocity.loadRuns().then(data => { runs = data; renderCalendar(); });
  }

  function inScope() {
    const now = new Date();
    return runs
      .map(r => ({ r, status: Velocity.statusOf(r, now) }))
      .filter(x => Velocity.withinScope(x.status, x.r, scope));
  }

  function renderCalendar() {
    const items = inScope().map(x => x.r);

    const railMount = document.getElementById('week-rail-mount');
    railMount.innerHTML = '';
    railMount.appendChild(Calendar.buildWeekRail(runs));

    const calMount = document.getElementById('cal-mount');
    calMount.innerHTML = '';
    calMount.appendChild(Calendar.buildGrid(items, scope, SharedUI.openRunDetail));
  }

  return { mount };
})();
