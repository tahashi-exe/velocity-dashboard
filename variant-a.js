/* ---------- Variant A: Map Sheet ----------
   Full-bleed map is the primary affordance, a draggable bottom sheet lists
   everything, Run Now and the calendar are both one tap away but secondary.
   The only variant left in the prototype — B and C were dropped along with
   the switcher once this one was picked to keep iterating on. */

const EXPLORE_LOCKED = ['Yoga', 'Pilates', 'Badminton', 'Padel', 'Cycling'];

const VariantA = (() => {
  let runs = [], map, markers = [], scope = 'week', typeFilter = 'all', matchPrefs = false;
  let runNowPool = [], runNowUsingSoon = false, runNowUserLoc = null, runNowSortMode = 'time';

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
              <button type="button" class="more-menu-item" id="explore-btn">&#129517; Explore</button>
              <button type="button" class="more-menu-item" id="profile-btn">&#128100; Profile</button>
            </div>
          </div>
        </div>
      </header>

      <main id="map-a" class="map-surface"></main>

      <section id="list-sheet" class="list-sheet">
        <div id="sheet-handle" class="sheet-handle"><span class="handle-bar"></span></div>
        <div class="sheet-title-row">
          <div class="sheet-title">All runs</div>
          <button type="button" id="prefs-filter-btn" class="prefs-chip${matchPrefs ? ' active' : ''}">Match my prefs</button>
        </div>
        <div id="type-filter-row" class="list-filter-row">${SharedUI.typeFilterChipsHtml(typeFilter)}</div>
        <div id="list-content" class="list-content"></div>
      </section>

      <aside id="cal-panel" class="panel panel-right" aria-hidden="true">
        <button class="panel-close" id="cal-panel-close">&times;</button>
        <div class="run-title" style="margin-top:6px;">Calendar</div>
        <div id="cal-panel-body"></div>
      </aside>

      <aside id="runnow-panel" class="panel panel-left" aria-hidden="true">
        <button class="panel-close" id="runnow-panel-close">&times;</button>
        <div id="runnow-content"></div>
      </aside>

      <aside id="explore-panel" class="panel panel-right" aria-hidden="true">
        <button class="panel-close" id="explore-panel-close">&times;</button>
        <div class="run-title" style="margin-top:6px;">Explore</div>
        <div class="filter-section-title">More activities, coming soon</div>
        ${EXPLORE_LOCKED.map(a => `<div class="locked-chip" data-label="${a}">${a} <span class="lock-icon">&#128274;</span></div>`).join('')}
      </aside>
    `;

    map = MapHelper.createMap('map-a');
    SharedUI.initLanding(() => {});

    SharedUI.wireTypeFilter(document.getElementById('type-filter-row'), (key) => { typeFilter = key; render(); });

    const prefsBtn = document.getElementById('prefs-filter-btn');
    prefsBtn.addEventListener('click', () => {
      if (!Velocity.getPrefs()) {
        SharedUI.openOnboarding({}, () => {
          matchPrefs = !!Velocity.getPrefs();
          prefsBtn.classList.toggle('active', matchPrefs);
          render();
        });
        return;
      }
      matchPrefs = !matchPrefs;
      prefsBtn.classList.toggle('active', matchPrefs);
      render();
    });

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

    document.getElementById('explore-btn').addEventListener('click', () => {
      moreMenu.classList.remove('open');
      SharedUI.openPanel(document.getElementById('explore-panel'));
    });
    document.getElementById('explore-panel-close').addEventListener('click', SharedUI.closeAllPanels);
    document.querySelectorAll('#explore-panel .locked-chip').forEach(chip => {
      chip.addEventListener('click', () => SharedUI.toast(`${chip.dataset.label} — coming in a future update`));
    });

    document.getElementById('run-now-btn').addEventListener('click', handleRunNow);
    document.getElementById('runnow-panel-close').addEventListener('click', SharedUI.closeAllPanels);
    document.addEventListener('velocity:prefs-changed', render);

    Velocity.loadRuns().then(data => { runs = data; render(); });
  }

  function inScope() {
    const now = new Date();
    const prefs = Velocity.getPrefs();
    return runs
      .map(r => ({ r, status: Velocity.statusOf(r, now) }))
      .filter(x => Velocity.withinScope(x.status, x.r, scope))
      .filter(x => typeFilter === 'all' || x.r.type_key === typeFilter)
      .filter(x => !matchPrefs || Velocity.matchesPrefs(x.r, prefs))
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
    }).join('') || `<div class="empty-state"><p>${matchPrefs ? 'Nothing matches your prefs in this window.' : 'Nothing in this window.'}</p></div>`;

    document.querySelectorAll('#list-content .list-row').forEach(row => {
      row.addEventListener('click', () => {
        const r = runs.find(x => x.id === row.dataset.runId);
        if (r) SharedUI.openRunDetail(r);
      });
    });
  }

  // Run Now: shows every non-expired option (not just the top pick), sorted
  // by closest time by default, with a "Nearest location" toggle once
  // geolocation resolves — matches the original v1 panel design.
  function handleRunNow() {
    document.getElementById('runnow-content').innerHTML = `<div class="empty-state"><div class="emoji">&#128205;</div><p>Finding runs near you&hellip;</p></div>`;
    SharedUI.openPanel(document.getElementById('runnow-panel'));
    runNowSortMode = 'time';
    runNowUserLoc = null;

    const now = new Date();
    const scored = runs.map(r => ({ r, status: Velocity.statusOf(r, now) })).filter(x => x.status.phase !== 'expired');
    const soon = scored.filter(x => x.status.phase === 'soon');
    runNowUsingSoon = soon.length > 0;
    runNowPool = (runNowUsingSoon ? soon : scored).sort((a, b) => a.status.minutesDiff - b.status.minutesDiff);

    renderRunNowPanel();

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => { runNowUserLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude }; renderRunNowPanel(); },
        () => {},
        { timeout: 8000 }
      );
    }
  }

  function renderRunNowPanel() {
    const content = document.getElementById('runnow-content');

    if (!runNowPool.length) {
      content.innerHTML = `
        <div class="runnow-header">Run Now</div>
        <div class="empty-state"><div class="emoji">&#127769;</div><p>No upcoming runs found right now.</p></div>
      `;
      return;
    }

    if (runNowUserLoc) {
      runNowPool.forEach(x => { x.distanceKm = Velocity.haversineKm(runNowUserLoc.lat, runNowUserLoc.lng, x.r.lat, x.r.lng); });
    }

    const sorted = [...runNowPool].sort((a, b) =>
      runNowSortMode === 'distance' && runNowUserLoc ? a.distanceKm - b.distanceKm : a.status.minutesDiff - b.status.minutesDiff
    );

    const headerNote = runNowUsingSoon ? 'running soon' : 'nothing running soon — closest upcoming';
    const sortToggle = runNowUserLoc ? `
      <div class="filter-toggle-row" style="margin-bottom:16px;">
        <div class="filter-toggle${runNowSortMode === 'time' ? ' active' : ''}" id="sort-time">Closest time</div>
        <div class="filter-toggle${runNowSortMode === 'distance' ? ' active' : ''}" id="sort-distance">Nearest location</div>
      </div>
    ` : '';

    content.innerHTML = `
      <div class="runnow-header">Run Now</div>
      <div class="runnow-sub">${sorted.length} ${sorted.length > 1 ? 'options' : 'option'} &mdash; ${headerNote}</div>
      ${sortToggle}
      ${sorted.map(({ r, status, distanceKm }) => `
        <div class="runnow-card" data-run-id="${r.id}">
          <span class="runnow-status">${status.label}</span>
          <div class="runnow-card-name">${r.name}</div>
          <div class="runnow-meta">${r.location_name}</div>
          <div class="runnow-meta">${Velocity.typeLabel(r)}${distanceKm != null ? ' &middot; ' + distanceKm.toFixed(1) + ' km away' : ''}</div>
        </div>
      `).join('')}
    `;

    content.querySelectorAll('.runnow-card').forEach(card => {
      card.addEventListener('click', () => {
        const r = runs.find(x => x.id === card.dataset.runId);
        if (r) SharedUI.openRunDetail(r);
      });
    });

    if (runNowUserLoc) {
      document.getElementById('sort-time').addEventListener('click', () => { runNowSortMode = 'time'; renderRunNowPanel(); });
      document.getElementById('sort-distance').addEventListener('click', () => { runNowSortMode = 'distance'; renderRunNowPanel(); });
    }
  }

  return { mount };
})();
