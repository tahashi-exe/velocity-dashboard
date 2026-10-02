/* ---------- v2 prototype: shared chrome ----------
   Landing → onboarding → run detail panel → toast, used by Variant A
   (the only variant left — B/C and the switcher were dropped once this
   one was picked to keep iterating on). */

const SharedUI = (() => {
  const overlay = document.getElementById('overlay');
  const runPanel = document.getElementById('run-panel');
  const runPanelContent = document.getElementById('run-panel-content');
  const landingPage = document.getElementById('landing-page');
  const onboardingModal = document.getElementById('onboarding-modal');
  const onboardingSteps = document.getElementById('onboarding-steps');
  const installModal = document.getElementById('install-modal');
  const installSteps = document.getElementById('install-steps');

  // Captured as early as possible (script-parse time, before any user
  // interaction) — Chrome only fires this once per pageload.
  let deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });
  window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; });

  // Going / Not going is the RSVP. Interested is a save-for-later: with
  // accounts on, those runs collect on the user's Interested list (a wishlist),
  // separate from My runs. One status per run, so deciding Going or Not going
  // takes a run off the list. "Not interested" was dropped to keep this simple.
  const RSVP_OPTIONS = [
    { key: 'going', label: 'Going' },
    { key: 'not_going', label: 'Not going' },
    { key: 'interested', label: 'Interested' },
  ];

  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // Closes any other open panel first — without this, opening one panel
  // (e.g. the calendar) while another is already open (e.g. a run detail)
  // leaves both stacked on screen at once, squeezing whatever's behind them.
  function openPanel(panel) {
    document.querySelectorAll('.panel.open').forEach(p => { if (p !== panel) p.classList.remove('open'); });
    panel.classList.add('open');
    overlay.classList.add('open');
  }
  function closeAllPanels() {
    document.querySelectorAll('.panel.open').forEach(p => p.classList.remove('open'));
    overlay.classList.remove('open');
    stopPhotoSlideshow();
  }
  overlay.addEventListener('click', closeAllPanels);
  document.getElementById('run-panel-close').addEventListener('click', closeAllPanels);

  // Photo slideshow (run detail panel) — crossfades between a club's photos,
  // one at a time. A single timer is enough since only one run panel is ever
  // open; stopPhotoSlideshow() is called before every re-render and on panel
  // close so a stale interval never outlives the DOM nodes it points at.
  let slideshowTimer = null;
  function stopPhotoSlideshow() {
    if (slideshowTimer) { clearInterval(slideshowTimer); slideshowTimer = null; }
  }
  function startPhotoSlideshow(container) {
    const photos = container.querySelectorAll('.run-photo');
    if (photos.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let index = 0;
    slideshowTimer = setInterval(() => {
      photos[index].classList.remove('active');
      index = (index + 1) % photos.length;
      photos[index].classList.add('active');
    }, 3500);
  }
  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Toast wording for an RSVP change. `tapped` is the button that was
  // pressed, `next` the resulting status (null when that press cleared it).
  // The "Interested list" wording only applies with accounts on; static mode
  // has no such list and keeps its original messages.
  function rsvpToast(tapped, next) {
    if (next === 'interested') return Backend.enabled ? 'Saved to Interested' : 'Marked interested';
    if (next === 'going') return 'Marked going';
    if (next === 'not_going') return 'Marked not going';
    return Backend.enabled && tapped === 'interested' ? 'Removed from Interested' : 'RSVP cleared';
  }

  // "3 going · 1 interested" — anonymous totals from the backend. Empty in
  // static mode, where there is nobody else's RSVP to count.
  function countsLabel(run) {
    if (!Backend.enabled) return '';
    const c = Backend.countsFor(run.id);
    return [c.going ? `${c.going} going` : '', c.interested ? `${c.interested} interested` : '']
      .filter(Boolean).join(' · ');
  }

  // The run currently shown in the detail panel, so an RSVP saved elsewhere
  // (after sign-in, or on sign-out) can refresh it in place.
  let currentRun = null;

  // Reflects a run's RSVP state. Updates the open panel in place when it is
  // already showing that run (a full re-render would restart the slideshow),
  // otherwise opens it.
  function showRsvpState(run) {
    if (currentRun && currentRun.id === run.id && runPanel.classList.contains('open')) {
      const status = Velocity.getRsvp(run.id);
      runPanelContent.querySelectorAll('.rsvp-btn').forEach(b => b.classList.toggle('active', b.dataset.status === status));
      const countsEl = document.getElementById('rsvp-counts');
      if (countsEl) countsEl.textContent = countsLabel(run);
      return;
    }
    openRunDetail(run);
  }
  document.addEventListener('velocity:auth-changed', () => {
    if (currentRun && runPanel.classList.contains('open')) showRsvpState(currentRun);
  });

  // PRD.md §4.5 order: kind badge -> type -> schedule -> register here ->
  // RSVP -> freebies. location/notes/last_updated stay as supporting info.
  function openRunDetail(run) {
    stopPhotoSlideshow();
    currentRun = run;
    const now = new Date();
    const status = Velocity.statusOf(run, now);
    const visual = Velocity.pinVisual(run);
    const currentRsvp = Velocity.getRsvp(run.id);
    const photos = run.photos || [];
    // null on records predating the cost field — the row is dropped rather than
    // rendered as "unknown", so older entries look finished, not broken.
    const costText = Velocity.costLabel(run);

    runPanelContent.innerHTML = `
      ${photos.length ? `
      <div class="run-photos" id="run-photos">
        ${photos.map((src, i) => `<img class="run-photo${i === 0 ? ' active' : ''}" src="${escapeAttr(src)}" alt="${escapeAttr(run.name)} photo ${i + 1}" loading="lazy">`).join('')}
      </div>` : ''}
      <div class="tag-row">
        <span class="tag kind-${run.kind}">${run.kind === 'one_off' ? 'One-off' : 'Recurring'}</span>
        <span class="tag">${Velocity.typeLabel(run)}</span>
        ${visual.ring ? '<span class="tag lime">Freebies</span>' : ''}
      </div>
      <div class="run-title">${run.name}</div>
      <div class="run-location">${run.location_name}</div>

      <div class="info-row">
        <span class="label">Schedule</span>
        <span class="value">${Velocity.scheduleLabel(run)}</span>
      </div>
      <div class="info-row">
        <span class="label">Right now</span>
        <span class="value">${status.phase === 'expired' ? 'Already happened' : status.label}</span>
      </div>
      ${costText ? `
      <div class="info-row">
        <span class="label">Cost</span>
        <span class="value${run.cost === 'free' ? ' value-free' : ''}">${costText}</span>
      </div>` : ''}

      <a class="register-btn" href="${run.register_link}" target="_blank" rel="noopener">Register here</a>
      <button type="button" class="ics-btn" id="ics-btn">Add to calendar</button>
      <a class="ics-btn" href="https://www.google.com/maps/search/?api=1&query=${run.lat},${run.lng}" target="_blank" rel="noopener">Open in Maps</a>

      <div class="rsvp-row" role="group" aria-label="RSVP">
        ${RSVP_OPTIONS.map(o => `<button type="button" class="rsvp-btn rsvp-${o.key}${currentRsvp === o.key ? ' active' : ''}" data-status="${o.key}">${o.label}</button>`).join('')}
      </div>
      ${Backend.enabled ? `
      <div class="rsvp-counts" id="rsvp-counts">${countsLabel(run)}</div>
      <div class="rsvp-note">Your RSVP is for your own calendar. To join the run, use "Register here" too.</div>` : ''}

      ${run.notes ? `<div class="run-notes">${run.notes}</div>` : ''}
      <div class="updated-note">Last updated ${run.last_updated}${Backend.enabled ? '' : ' &middot; not synced (local prototype)'}</div>
    `;

    // Both go through AuthUI.require: in static mode and when signed in it
    // acts straight away; a guest in backend mode gets the sign-in sheet first
    // (PRD.md §4.8b) and the action completes once they're in.
    document.getElementById('ics-btn').addEventListener('click', () => {
      AuthUI.require({ type: 'ics', runId: run.id }, `Sign in to add ${run.name} to your calendar`);
    });
    runPanelContent.querySelectorAll('.rsvp-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const status = btn.dataset.status;
        AuthUI.require({ type: 'rsvp', runId: run.id, status },
          status === 'interested' ? `Sign in to save ${run.name} to Interested` : `Sign in to save your RSVP for ${run.name}`);
      });
    });

    openPanel(runPanel);
    if (photos.length) startPhotoSlideshow(document.getElementById('run-photos'));
  }

  /* ---------- install-to-homescreen tutorial ----------
     Platform-aware: iOS has no programmatic install, so it's an
     illustrated manual walkthrough; Android/Chrome gets the real
     beforeinstallprompt flow; desktop skips entirely. Shows every
     session until display-mode reports installed (no dismiss-forever
     flag — see PRD.md §4.7 discussion pattern: this mirrors that same
     "don't persist a skip" call). */

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isAndroid() { return /Android/.test(navigator.userAgent); }
  function isStandaloneInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  const SHARE_ICON_SVG = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3v12M7 8l5-5 5 5"/>
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>
    </svg>`;
  const PLUS_ICON_SVG = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>
    </svg>`;
  const DOWNLOAD_ICON_SVG = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3v12M7 11l5 5 5-5"/><path d="M5 20h14"/>
    </svg>`;

  function closeInstallModal() { installModal.classList.remove('open'); }

  function maybeShowInstallTutorial(onDone) {
    if (isStandaloneInstalled()) { onDone(); return; }
    if (isIOS()) { openInstallTutorial('ios', onDone); return; }
    if (isAndroid()) { openInstallTutorial('android', onDone); return; }
    onDone(); // desktop — skip entirely
  }

  function openInstallTutorial(platform, onDone) {
    const finish = () => { closeInstallModal(); onDone(); };

    if (platform === 'ios') {
      installSteps.innerHTML = `
        <div class="install-title">Install VelocityAE</div>
        <div class="install-sub">Add it to your home screen for one-tap access, like a real app.</div>
        <div class="install-step-row"><div class="install-step-icon">${SHARE_ICON_SVG}</div><div class="install-step-text"><span class="install-step-num">1.</span>Tap the Share icon in Safari's toolbar</div></div>
        <div class="install-step-row"><div class="install-step-icon">${PLUS_ICON_SVG}</div><div class="install-step-text"><span class="install-step-num">2.</span>Scroll down and tap "Add to Home Screen"</div></div>
        <div class="install-step-row"><div class="install-step-icon">${DOWNLOAD_ICON_SVG}</div><div class="install-step-text"><span class="install-step-num">3.</span>Tap "Add" to confirm</div></div>
        <div class="install-nav"><button class="ob-btn secondary" id="install-close">Got it</button></div>
      `;
      document.getElementById('install-close').addEventListener('click', finish);
    } else {
      const canPrompt = !!deferredInstallPrompt;
      installSteps.innerHTML = `
        <div class="install-title">Install VelocityAE</div>
        <div class="install-sub">${canPrompt
          ? 'Add it to your home screen for one-tap access, like a real app.'
          : 'Open the ⋮ menu in Chrome and tap "Install app" to add it to your home screen.'}</div>
        <div class="install-nav">
          <button class="ob-btn secondary" id="install-skip">Not now</button>
          ${canPrompt ? '<button class="ob-btn primary" id="install-go">Install</button>' : '<button class="ob-btn primary" id="install-close">Got it</button>'}
        </div>
      `;
      document.getElementById('install-skip').addEventListener('click', finish);
      const goBtn = document.getElementById('install-go');
      if (goBtn) {
        goBtn.addEventListener('click', async () => {
          if (!deferredInstallPrompt) { finish(); return; }
          deferredInstallPrompt.prompt();
          await deferredInstallPrompt.userChoice;
          deferredInstallPrompt = null; // one-shot
          finish();
        });
      }
      const closeBtn = document.getElementById('install-close');
      if (closeBtn) closeBtn.addEventListener('click', finish);
    }

    installModal.classList.add('open');
  }

  /* ---------- landing + onboarding (unchanged shape from v1) ---------- */

  const OB_STEPS = [
    { key: 'about', title: 'About you', sub: 'Nothing shared beyond this device.', fields: [
      { type: 'text', key: 'name', label: 'Name' },
    ]},
    { key: 'runstyle', title: 'Run style', sub: 'Pick what fits best.', fields: [
      { type: 'choice', key: 'type_key', label: 'Type', options: Velocity.CATEGORIES.running.types.map(t => t.key) },
    ]},
    { key: 'location', title: 'Location preference', sub: '', fields: [
      { type: 'choice', key: 'surface', label: 'Where do you like to run?', options: ['track', 'beach', 'road', 'indoor'] },
    ]},
    { key: 'extras', title: 'Extras', sub: '', fields: [
      { type: 'choice', key: 'wantsFreebies', label: 'Interested in freebies / collabs?', options: ['Yes', 'No'] },
    ]},
  ];

  let obIndex = 0, obData = {}, obOnComplete = null;

  // onComplete fires once, whether onboarding is Finished or Skipped — but
  // NOT when reopened from the profile-edit button (which calls this with
  // no second argument), so the install tutorial only fires on a genuine
  // landing→app transition, never on a prefs re-edit.
  function openOnboarding(prefill, onComplete) {
    obIndex = 0;
    obData = prefill ? { ...prefill } : {};
    obOnComplete = onComplete || null;
    renderObStep();
    onboardingModal.classList.add('open');
  }
  function closeOnboarding() { onboardingModal.classList.remove('open'); }

  function renderObStep() {
    const step = OB_STEPS[obIndex];
    // The "device only" promise on the first step stops being true once
    // signed in, where savePrefs() mirrors the answers to the profile.
    const sub = step.key === 'about' && Backend.user() ? 'Saved to your account, so it follows you across devices.' : step.sub;
    const fieldsHtml = step.fields.map(f => {
      if (f.type === 'text') {
        const val = obData[f.key] != null ? obData[f.key] : '';
        return `<input class="ob-input" type="text" placeholder="${f.label}" data-key="${f.key}" value="${val}" />`;
      }
      const options = f.options.map(opt => {
        const selected = obData[f.key] === opt ? ' selected' : '';
        return `<div class="ob-option${selected}" data-key="${f.key}" data-value="${opt}">${Velocity.capitalize(opt).replace(/_/g, ' ')}</div>`;
      }).join('');
      return `<div class="ob-step-sub" style="margin:14px 0 6px;font-weight:700;color:var(--text);">${f.label}</div><div class="ob-options">${options}</div>`;
    }).join('');

    onboardingSteps.innerHTML = `
      <div class="ob-progress">Step ${obIndex + 1} of ${OB_STEPS.length}</div>
      <div class="ob-step-title">${step.title}</div>
      ${sub ? `<div class="ob-step-sub">${sub}</div>` : ''}
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
      opt.addEventListener('click', () => { obData[opt.dataset.key] = opt.dataset.value; renderObStep(); });
    });
    document.getElementById('ob-back').addEventListener('click', () => {
      if (obIndex === 0) {
        closeOnboarding();
        if (obOnComplete) { const cb = obOnComplete; obOnComplete = null; cb(); }
        return;
      }
      obIndex--; renderObStep();
    });
    document.getElementById('ob-next').addEventListener('click', () => {
      if (obIndex < OB_STEPS.length - 1) { obIndex++; renderObStep(); return; }
      Velocity.savePrefs(obData);
      closeOnboarding();
      document.dispatchEvent(new CustomEvent('velocity:prefs-changed'));
      if (obOnComplete) { const cb = obOnComplete; obOnComplete = null; cb(); }
    });
  }

  /* ---------- type filter chips (Variant A's bottom sheet) ---------- */

  function typeFilterChipsHtml(active) {
    const options = [{ key: 'all', label: 'All' }, ...Velocity.CATEGORIES.running.types];
    return options.map(o => `<button type="button" class="type-chip${active === o.key ? ' active' : ''}" data-type="${o.key}">${o.label}</button>`).join('');
  }

  function wireTypeFilter(container, onChange) {
    container.querySelectorAll('.type-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.type-chip').forEach(b => b.classList.toggle('active', b === btn));
        onChange(btn.dataset.type);
      });
    });
  }

  function initLanding(onEnter) {
    document.getElementById('lets-run-btn').addEventListener('click', () => {
      landingPage.classList.add('hidden');
      LandingMap.destroy();
      if (!Velocity.getPrefs()) {
        openOnboarding({}, () => maybeShowInstallTutorial(onEnter));
      } else {
        maybeShowInstallTutorial(onEnter);
      }
    });
  }

  // Straight into the app, no hero, onboarding or install tutorial. Used when
  // the page load is a return from Google's sign-in redirect: the user was
  // already in the app a moment ago and is coming back to finish an action.
  function skipLanding() {
    landingPage.classList.add('hidden');
    LandingMap.destroy();
  }

  return {
    toast, openPanel, closeAllPanels, openRunDetail, showRsvpState, rsvpToast, escapeHtml,
    openOnboarding, initLanding, skipLanding, typeFilterChipsHtml, wireTypeFilter,
  };
})();
