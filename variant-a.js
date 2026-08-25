/* ---------- Variant A: Map Sheet ----------
   Closest to v1's shape: full-bleed map is the primary affordance, a
   draggable bottom sheet lists everything, Run Now and the calendar are
   both one tap away but secondary. */

const VariantA = (() => {
  let runs = [], map, markers = [], scope = 'week', typeFilter = 'all';

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
          <button type="button" class="run-now-btn" id="run-now-btn"><span class="run-now-dot"></span>Run Now</button>
          <div class="more-wrap">
            <button type="button" class="icon-btn" id="more-btn" aria-label="More" aria-expanded="false">&#8942;</button>
            <div class="more-menu" id="more-menu">
              <button type="button" class="more-menu-item" id="cal-btn">&#128197; Calendar</button>
              <button type="button" class="more-menu-item" id="profile-btn">&#128100; Profile</button>
            </div>
          </div>
        </div>
      </header>

      <main id="map-a" class="map-surface"></main>

      <section id="list-sheet" class="list-sheet">
        <div id="sheet-handle" class="sheet-handle"><span class="handle-bar"></span></div>
        <div class="sheet-title">All runs</div>
        <div id="type-filter-row" class="list-filter-row">${SharedUI.typeFilterChipsHtml(typeFilter)}</div>
        <div id="list-content" class="list-content"></div>
      </section>

      <aside id="cal-panel" class="panel panel-right" aria-hidden="true">
        <button class="panel-close" id="cal-panel-close">&times;</button>
        <div class="run-title" style="margin-top:6px;">Calendar</div>
        <div id="cal-panel-body"></div>
      </aside>
    `;

    map = MapHelper.createMap('map-a');
    SharedUI.initLanding(() => {});

    SharedUI.wireTypeFilter(document.getElementById('type-filter-row'), (key) => { typeFilter = key; render(); });

    document.querySelectorAll('.scope-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        scope = btn.dataset.scope;
        document.querySelectorAll('.scope-btn').forEach(b => b.classList.toggle('active', b === btn));
        render();
      });
    });

    const moreBtn = document.getElementById('more-btn');
    const moreMenu = document.getElementById('more-menu');
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = moreMenu.classList.toggle('open');
      moreBtn.setAttribute('aria-expanded', String(isOpen));
    });
    document.addEventListener('click', (e) => {
      if (!moreMenu.classList.contains('open')) return;
      if (e.target === moreBtn || moreMenu.contains(e.target)) return;
      moreMenu.classList.remove('open');
      moreBtn.setAttribute('aria-expanded', 'false');
    });

    const sheet = document.getElementById('list-sheet');
    document.getElementById('sheet-handle').addEventListener('click', () => sheet.classList.toggle('expanded'));
    let dragStartY = null;
    document.getElementById('sheet-handle').addEventListener('pointerdown', e => { dragStartY = e.clientY; });
    window.addEventListener('pointerup', e => {
      if (dragStartY === null) return;
      const delta = e.clientY - dragStartY;
      if (delta < -30) sheet.classList.add('expanded');
      else if (delta > 30) sheet.classList.remove('expanded');
      dragStartY = null;
    });

    document.getElementById('cal-btn').addEventListener('click', () => {
      moreMenu.classList.remove('open');
      document.getElementById('cal-panel-body').innerHTML = '';
      document.getElementById('cal-panel-body').appendChild(Calendar.buildGrid(runs, scope, SharedUI.openRunDetail, true));
      SharedUI.openPanel(document.getElementById('cal-panel'));
    });
    document.getElementById('cal-panel-close').addEventListener('click', SharedUI.closeAllPanels);

    document.getElementById('profile-btn').addEventListener('click', () => {
      moreMenu.classList.remove('open');
      SharedUI.openOnboarding(Velocity.getPrefs() || {});
    });
    document.getElementById('run-now-btn').addEventListener('click', handleRunNow);
    document.addEventListener('velocity:prefs-changed', render);

    Velocity.loadRuns().then(data => { runs = data; render(); });
  }

  function inScope() {
    const now = new Date();
    return runs
      .map(r => ({ r, status: Velocity.statusOf(r, now) }))
      .filter(x => Velocity.withinScope(x.status, x.r, scope))
      .filter(x => typeFilter === 'all' || x.r.type_key === typeFilter)
      .sort((a, b) => a.status.minutesDiff - b.status.minutesDiff);
  }

  function render() {
    const items = inScope();

    MapHelper.clearMarkers(markers);
    markers.push(...MapHelper.addMarkers(map, items.map(x => x.r), SharedUI.openRunDetail));

    document.getElementById('list-content').innerHTML = items.map(({ r, status }) => {
      const visual = Velocity.pinVisual(r);
      return `
        <div class="list-row" data-run-id="${r.id}">
          <span class="legend-dot color-${visual.base}${visual.ring ? ' has-ring' : ''}"></span>
          <div class="list-row-info">
            <div class="list-row-name">${r.name}</div>
            <div class="list-row-meta">${r.location_name} &middot; ${status.phase === 'soon' ? status.label : Velocity.scheduleLabel(r)}</div>
          </div>
        </div>
      `;
    }).join('') || '<div class="empty-state"><p>Nothing in this window.</p></div>';

    document.querySelectorAll('#list-content .list-row').forEach(row => {
      row.addEventListener('click', () => {
        const r = runs.find(x => x.id === row.dataset.runId);
        if (r) SharedUI.openRunDetail(r);
      });
    });
  }

  function handleRunNow() {
    const now = new Date();
    const scored = runs.map(r => ({ r, status: Velocity.statusOf(r, now) })).filter(x => x.status.phase !== 'expired');
    const soon = scored.filter(x => x.status.phase === 'soon').sort((a, b) => a.status.minutesDiff - b.status.minutesDiff);
    const pool = soon.length ? soon : scored.sort((a, b) => a.status.minutesDiff - b.status.minutesDiff).slice(0, 5);
    if (pool.length) {
      SharedUI.toast(soon.length ? `${pool.length} running soon` : 'Nothing soon — showing closest upcoming');
      SharedUI.openRunDetail(pool[0].r);
    } else {
      SharedUI.toast('No runs found');
    }
  }

  return { mount };
})();
