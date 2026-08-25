/* ---------- Variant C: Feed & Map ----------
   A scrollable card feed is the primary affordance, with RSVP as an inline,
   one-tap action on the card itself — closer to the "going / interested"
   social framing than a modal-only interaction. Map sits alongside on wide
   screens, tab-switched on mobile. */

const VariantC = (() => {
  let runs = [], scope = 'week', nowOnly = false, typeFilter = 'all', map, markers = [], mobileView = 'feed';

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
          <button type="button" class="chip-toggle" id="now-chip">Now</button>
          <button type="button" class="icon-btn" id="profile-btn" aria-label="Profile">&#128100;</button>
        </div>
      </header>

      <div class="mobile-tabs">
        <button type="button" class="mobile-tab active" data-view="feed">Feed</button>
        <button type="button" class="mobile-tab" data-view="map">Map</button>
      </div>

      <main class="split-main">
        <section id="feed-pane" class="feed-pane">
          <div class="feed-header">
            <div class="sheet-title">All runs</div>
            <div id="type-filter-row" class="list-filter-row">${SharedUI.typeFilterChipsHtml(typeFilter)}</div>
          </div>
          <div id="feed-list" class="feed-list"></div>
        </section>
        <section id="map-pane" class="map-pane"><div id="map-c" class="map-surface"></div></section>
      </main>
    `;

    SharedUI.initLanding(() => {});
    map = MapHelper.createMap('map-c');

    SharedUI.wireTypeFilter(document.getElementById('type-filter-row'), (key) => { typeFilter = key; render(); });

    document.querySelectorAll('.scope-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        scope = btn.dataset.scope;
        document.querySelectorAll('.scope-btn').forEach(b => b.classList.toggle('active', b === btn));
        render();
      });
    });
    document.getElementById('now-chip').addEventListener('click', (e) => {
      nowOnly = !nowOnly;
      e.currentTarget.classList.toggle('active', nowOnly);
      render();
    });
    document.getElementById('profile-btn').addEventListener('click', () => SharedUI.openOnboarding(Velocity.getPrefs() || {}));

    document.querySelectorAll('.mobile-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        mobileView = tab.dataset.view;
        document.querySelectorAll('.mobile-tab').forEach(t => t.classList.toggle('active', t === tab));
        document.querySelector('.split-main').classList.toggle('show-map', mobileView === 'map');
        if (mobileView === 'map') setTimeout(() => map.resize(), 50);
      });
    });

    document.addEventListener('velocity:prefs-changed', render);

    Velocity.loadRuns().then(data => { runs = data; render(); });
  }

  function inScope() {
    const now = new Date();
    let items = runs
      .map(r => ({ r, status: Velocity.statusOf(r, now) }))
      .filter(x => Velocity.withinScope(x.status, x.r, scope))
      .filter(x => typeFilter === 'all' || x.r.type_key === typeFilter);
    if (nowOnly) items = items.filter(x => x.status.phase === 'soon');
    return items.sort((a, b) => a.status.minutesDiff - b.status.minutesDiff);
  }

  const RSVP_OPTIONS = [
    { key: 'going', label: 'Going' },
    { key: 'interested', label: 'Interested' },
    { key: 'not_going', label: 'Not going' },
  ];

  function cardHtml(r, status) {
    const visual = Velocity.pinVisual(r);
    const currentRsvp = Velocity.getRsvp(r.id);
    return `
      <article class="feed-card" data-run-id="${r.id}">
        <div class="tag-row">
          <span class="tag kind-${r.kind}">${r.kind === 'one_off' ? 'One-off' : 'Recurring'}</span>
          <span class="tag">${Velocity.typeLabel(r)}</span>
          ${visual.ring ? '<span class="tag lime">Freebies</span>' : ''}
        </div>
        <div class="feed-card-name">${r.name}</div>
        <div class="feed-card-meta">${r.location_name} &middot; ${status.phase === 'soon' ? status.label : Velocity.scheduleLabel(r)}</div>
        <div class="feed-rsvp-row">
          ${RSVP_OPTIONS.map(o => `<button type="button" class="rsvp-btn rsvp-${o.key}${currentRsvp === o.key ? ' active' : ''}" data-status="${o.key}">${o.label}</button>`).join('')}
          <a class="feed-register" href="${r.register_link}" target="_blank" rel="noopener" data-nostop>Register here</a>
        </div>
      </article>
    `;
  }

  function render() {
    const items = inScope();

    document.getElementById('feed-list').innerHTML = items.length
      ? items.map(({ r, status }) => cardHtml(r, status)).join('')
      : '<div class="empty-state"><p>Nothing matches right now.</p></div>';

    document.querySelectorAll('.feed-card').forEach(card => {
      const run = runs.find(r => r.id === card.dataset.runId);
      card.querySelectorAll('.rsvp-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = Velocity.setRsvp(run.id, btn.dataset.status);
          card.querySelectorAll('.rsvp-btn').forEach(b => b.classList.toggle('active', b.dataset.status === next));
          SharedUI.toast(next ? `Marked ${btn.textContent.toLowerCase()}` : 'RSVP cleared');
        });
      });
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-nostop]') || e.target.closest('.rsvp-btn')) return;
        SharedUI.openRunDetail(run);
      });
    });

    MapHelper.clearMarkers(markers);
    markers.push(...MapHelper.addMarkers(map, items.map(x => x.r), SharedUI.openRunDetail));
  }

  return { mount };
})();
