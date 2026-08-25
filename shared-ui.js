/* ---------- v2 prototype: shared chrome ----------
   Landing → onboarding → run detail panel → toast. Identical across all
   three variants (PRD.md §4.3/§4.5 card hierarchy lives here once, since the
   variants disagree about *layout*, not about what a run card says). */

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

  const RSVP_OPTIONS = [
    { key: 'going', label: 'Going' },
    { key: 'interested', label: 'Interested' },
    { key: 'not_interested', label: 'Not interested' },
    { key: 'not_going', label: 'Not going' },
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
  }
  overlay.addEventListener('click', closeAllPanels);
  document.getElementById('run-panel-close').addEventListener('click', closeAllPanels);

  // PRD.md §4.5 order: kind badge -> type -> schedule -> register here ->
  // RSVP -> freebies. location/notes/last_updated stay as supporting info.
  function openRunDetail(run) {
    const now = new Date();
    const status = Velocity.statusOf(run, now);
    const visual = Velocity.pinVisual(run);
    const currentRsvp = Velocity.getRsvp(run.id);

    runPanelContent.innerHTML = `
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

      <a class="register-btn" href="${run.register_link}" target="_blank" rel="noopener">Register here</a>
      <button type="button" class="ics-btn" id="ics-btn">Add to calendar</button>

      <div class="rsvp-row" role="group" aria-label="RSVP">
        ${RSVP_OPTIONS.map(o => `<button type="button" class="rsvp-btn rsvp-${o.key}${currentRsvp === o.key ? ' active' : ''}" data-status="${o.key}">${o.label}</button>`).join('')}
      </div>

      ${run.notes ? `<div class="run-notes">${run.notes}</div>` : ''}
      <div class="updated-note">Last updated ${run.last_updated} &middot; not synced (local prototype)</div>
    `;

    document.getElementById('ics-btn').addEventListener('click', () => {
      Velocity.downloadICS(run);
      toast('Calendar file downloaded');
    });
    runPanelContent.querySelectorAll('.rsvp-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = Velocity.setRsvp(run.id, btn.dataset.status);
        runPanelContent.querySelectorAll('.rsvp-btn').forEach(b => b.classList.toggle('active', b.dataset.status === next));
        toast(next ? `Marked ${btn.textContent.toLowerCase()}` : 'RSVP cleared');
      });
    });

    openPanel(runPanel);
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
      { type: 'choice', key: 'surface', label: 'Where do you like to run?', options: ['track', 'beach', 'road'] },
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
    const fieldsHtml = step.fields.map(f => {
      if (f.type === 'text') {
        const val = obData[f.key] != null ? obData[f.key] : '';
        return `<input class="ob-input" type="text" placeholder="${f.label}" data-key="${f.key}" value="${val}" />`;
      }
      const options = f.options.map(opt => {
        const selected = obData[f.key] === opt ? ' selected' : '';
        return `<div class="ob-option${selected}" data-key="${f.key}" data-value="${opt}">${Velocity.capitalize(opt)}</div>`;
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

  /* ---------- type filter chips (shared by Variant A's sheet + Variant C's feed) ---------- */

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
      document.getElementById('variant-switcher').classList.add('visible');
      if (!Velocity.getPrefs()) {
        openOnboarding({}, () => maybeShowInstallTutorial(onEnter));
      } else {
        maybeShowInstallTutorial(onEnter);
      }
    });
  }

  return { toast, openPanel, closeAllPanels, openRunDetail, openOnboarding, initLanding, typeFilterChipsHtml, wireTypeFilter };
})();
