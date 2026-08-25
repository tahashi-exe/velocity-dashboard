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

  function openPanel(panel) { panel.classList.add('open'); overlay.classList.add('open'); }
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

  let obIndex = 0, obData = {};

  function openOnboarding(prefill) {
    obIndex = 0;
    obData = prefill ? { ...prefill } : {};
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
      if (obIndex === 0) { closeOnboarding(); return; }
      obIndex--; renderObStep();
    });
    document.getElementById('ob-next').addEventListener('click', () => {
      if (obIndex < OB_STEPS.length - 1) { obIndex++; renderObStep(); return; }
      Velocity.savePrefs(obData);
      closeOnboarding();
      document.dispatchEvent(new CustomEvent('velocity:prefs-changed'));
    });
  }

  function initLanding(onEnter) {
    document.getElementById('lets-run-btn').addEventListener('click', () => {
      landingPage.classList.add('hidden');
      if (!Velocity.getPrefs()) openOnboarding({});
      onEnter();
    });
  }

  return { toast, openPanel, closeAllPanels, openRunDetail, openOnboarding, initLanding };
})();
