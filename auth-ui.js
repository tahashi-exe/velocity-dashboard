/* ---------- AuthUI: gated actions, sign-in sheet, account panel ----------
   PRD.md §4.8b. Opening the app never asks anyone to sign in. The sheet only
   appears when a guest taps something that has to be saved to an account
   (an RSVP, Add to calendar, My runs) or picks Sign in from the menu, and
   whatever they tapped completes by itself once they're in.

   In static mode (config.js `backend: null`) require() simply performs the
   action, so the rest of the app can call it unconditionally. */

const AuthUI = (() => {
  const PENDING_KEY = 'velocity_pending_action';
  const PENDING_TTL_MS = 10 * 60 * 1000;

  const modal = document.getElementById('auth-modal');
  const steps = document.getElementById('auth-steps');
  const accountPanel = document.getElementById('account-panel');
  const accountContent = document.getElementById('account-content');
  const esc = SharedUI.escapeHtml;

  let pendingAction = null; // what the guest tapped, replayed after sign-in
  let sheetHeadline = '';
  let verifyingCode = false; // the Verify button is mid-flight in this tab

  const GOOGLE_SVG = `
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>`;
  const APPLE_SVG = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M16.37 12.78c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.62-1.7-3.19-1.73-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.19-1.54 2.67-.39 6.62 1.11 8.79.73 1.06 1.61 2.25 2.75 2.21 1.1-.04 1.52-.71 2.86-.71 1.33 0 1.71.71 2.88.69 1.19-.02 1.94-1.08 2.67-2.15.84-1.23 1.19-2.42 1.21-2.48-.03-.01-2.32-.89-2.34-3.54zM14.18 6.3c.61-.74 1.02-1.76.91-2.78-.88.04-1.94.59-2.57 1.32-.56.65-1.06 1.7-.93 2.7.98.08 1.98-.5 2.59-1.24z"/>
    </svg>`;

  /* ---------- gated actions ---------- */

  // action: { type: 'rsvp', runId, status } | { type: 'ics', runId }
  //       | { type: 'myruns' } | { type: 'interested' } | { type: 'signin' }
  async function require(action, headline) {
    if (Backend.enabled) await Backend.ready;
    if (!Backend.enabled || Backend.user()) { perform(action, { toggle: true }); return; }
    if (!Backend.available()) { SharedUI.toast('Can\'t reach Velocity right now. Try again in a moment.'); return; }
    openSheet(action, headline);
  }

  // `toggle` is true only for a direct tap by someone already able to act;
  // a replay after sign-in sets the status outright (see Backend.setRsvp).
  // `afterRedirect` means the page reloaded on the way back from Google, so
  // there's no user gesture left to hang a file download on.
  async function perform(action, { toggle = false, afterRedirect = false } = {}) {
    try {
      if (action.type === 'rsvp' || action.type === 'ics') {
        const run = Velocity.findRun(action.runId);
        if (!run) return;
        if (action.type === 'rsvp') {
          const next = await Velocity.setRsvp(run.id, action.status, { toggle });
          SharedUI.showRsvpState(run);
          SharedUI.toast(SharedUI.rsvpToast(action.status, next));
        } else if (afterRedirect) {
          SharedUI.openRunDetail(run);
          SharedUI.toast('You\'re signed in. Tap "Add to calendar" to download.');
        } else {
          Velocity.downloadICS(run);
          SharedUI.toast('Calendar file downloaded');
        }
      } else if (action.type === 'myruns') {
        document.dispatchEvent(new CustomEvent('velocity:open-calendar', { detail: { mine: true } }));
      } else if (action.type === 'interested') {
        document.dispatchEvent(new CustomEvent('velocity:open-interested'));
      } else if (action.type === 'signin') {
        const name = (Backend.profile() || {}).display_name;
        SharedUI.toast(name ? `Signed in as ${name}` : 'You\'re signed in');
      }
    } catch (e) {
      console.warn('Velocity: action failed', e);
      SharedUI.toast('Couldn\'t save that. Check your connection and try again.');
    }
  }

  /* ---------- pending action across the Google redirect ---------- */

  function storePending(action) {
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ action, at: Date.now() })); } catch (e) { /* private mode */ }
  }
  function readPending() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(PENDING_KEY));
      return raw && Date.now() - raw.at < PENDING_TTL_MS ? raw.action : null;
    } catch (e) { return null; }
  }
  function clearPending() {
    try { sessionStorage.removeItem(PENDING_KEY); } catch (e) { /* private mode */ }
  }

  /* ---------- sign-in sheet ---------- */

  // Google refuses OAuth inside embedded webviews, which is where a link
  // shared on Instagram and similar apps opens.
  function inAppBrowser() {
    return /Instagram|FBAN|FBAV|FB_IAB|Line\/|TikTok|musical_ly|Snapchat|LinkedInApp/i.test(navigator.userAgent);
  }

  function friendlyError(e) {
    const msg = (e && e.message) || '';
    if (/rate limit|security purposes|too many/i.test(msg)) return 'Too many attempts. Wait a minute and try again.';
    if (/expired|invalid/i.test(msg)) return 'That code isn\'t right or has expired. Check it, or resend a new one.';
    if (/not authorized/i.test(msg)) return 'Email sign-in isn\'t available for this address yet.';
    if (/signups? not allowed/i.test(msg)) return 'New sign-ups are closed right now.';
    if (/fetch|network/i.test(msg)) return 'Can\'t reach Velocity right now. Check your connection.';
    return msg || 'Something went wrong. Try again.';
  }

  function showError(msg) {
    const el = document.getElementById('auth-error');
    if (el) el.textContent = msg || '';
  }

  // Disables a button for the duration of an async step, restoring its label
  // afterwards unless the sheet has been re-rendered in the meantime.
  async function withBusy(btn, busyLabel, fn) {
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = busyLabel;
    try { return await fn(); }
    finally {
      if (btn.isConnected) { btn.disabled = false; btn.innerHTML = label; }
    }
  }

  function openSheet(action, headline) {
    pendingAction = action;
    sheetHeadline = headline;
    renderChoose('');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeSheet() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    pendingAction = null;
  }

  function renderChoose(email) {
    const providers = Backend.providers();
    const socialButtons = [
      providers.apple ? `<button type="button" class="auth-provider auth-apple" data-provider="apple">${APPLE_SVG}<span>Continue with Apple</span></button>` : '',
      providers.google ? `<button type="button" class="auth-provider auth-google" data-provider="google">${GOOGLE_SVG}<span>Continue with Google</span></button>` : '',
    ].join('');

    steps.innerHTML = `
      <div class="ob-step-title" id="auth-title">${esc(sheetHeadline)}</div>
      <div class="ob-step-sub">It's free, and your RSVPs and calendar follow you to any device.</div>
      ${providers.google && inAppBrowser() ? `
      <div class="auth-hint">Google sign-in doesn't work inside this app's built-in browser. Open this page in Safari or Chrome, or use an email code below.</div>` : ''}
      ${socialButtons}
      ${socialButtons && providers.email ? '<div class="auth-or"><span>or</span></div>' : ''}
      ${providers.email ? `
      <form id="auth-email-form" novalidate>
        <input class="ob-input" id="auth-email" type="email" inputmode="email" autocomplete="email"
               autocapitalize="off" spellcheck="false" placeholder="Email address" aria-label="Email address" value="${esc(email)}" />
        <button type="submit" class="ob-btn primary auth-wide" id="auth-email-send">Email me a code</button>
      </form>` : ''}
      <div class="auth-error" id="auth-error" role="alert"></div>
      <p class="auth-fine">By continuing you agree to the <a href="terms.html" target="_blank" rel="noopener">Terms</a>
        and <a href="guidelines.html" target="_blank" rel="noopener">Community Guidelines</a>, and acknowledge the
        <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</p>
      <div class="ob-nav auth-nav">
        <button type="button" class="ob-btn secondary" id="auth-cancel">Not now</button>
      </div>
    `;

    document.getElementById('auth-cancel').addEventListener('click', closeSheet);

    steps.querySelectorAll('.auth-provider').forEach(btn => {
      btn.addEventListener('click', () => withBusy(btn, 'Opening…', async () => {
        showError('');
        // The page is about to navigate away, so the tapped action has to
        // outlive it; init() picks it up on the way back.
        storePending(pendingAction);
        try {
          await Backend.signInWithProvider(btn.dataset.provider);
        } catch (e) {
          clearPending();
          showError(friendlyError(e));
        }
      }));
    });

    const form = document.getElementById('auth-email-form');
    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const value = document.getElementById('auth-email').value.trim();
        if (!/^\S+@\S+\.\S+$/.test(value)) { showError('Enter a valid email address.'); return; }
        withBusy(document.getElementById('auth-email-send'), 'Sending…', async () => {
          showError('');
          try {
            await Backend.sendEmailCode(value);
            renderCode(value);
          } catch (e) {
            showError(friendlyError(e));
          }
        });
      });
    }
  }

  // A code typed into this same tab, rather than a magic link: on phones the
  // link tends to open in a different browser and lose the session
  // (TECHNICAL.md §5).
  function renderCode(email) {
    steps.innerHTML = `
      <div class="ob-step-title" id="auth-title">Check your email</div>
      <div class="ob-step-sub">We emailed <strong>${esc(email)}</strong>. Type the code from that email here, or tap the link in it. It can take a minute to arrive.</div>
      <form id="auth-code-form" novalidate>
        <input class="ob-input auth-code" id="auth-code" type="text" inputmode="numeric" autocomplete="one-time-code"
               maxlength="10" placeholder="Code" aria-label="Sign-in code" />
        <button type="submit" class="ob-btn primary auth-wide" id="auth-code-verify">Verify</button>
      </form>
      <div class="auth-error" id="auth-error" role="alert"></div>
      <div class="ob-nav auth-nav">
        <button type="button" class="ob-btn secondary" id="auth-back">Use a different email</button>
        <button type="button" class="ob-btn secondary" id="auth-resend">Resend code</button>
      </div>
    `;

    const input = document.getElementById('auth-code');
    input.focus();

    document.getElementById('auth-back').addEventListener('click', () => renderChoose(email));

    const resend = document.getElementById('auth-resend');
    resend.addEventListener('click', () => withBusy(resend, 'Sending…', async () => {
      showError('');
      try {
        await Backend.sendEmailCode(email);
        SharedUI.toast('New code sent');
      } catch (e) {
        showError(friendlyError(e));
      }
    }));

    document.getElementById('auth-code-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const code = input.value.replace(/\D/g, '');
      if (code.length < 6) { showError('Enter the code from the email.'); return; }
      withBusy(document.getElementById('auth-code-verify'), 'Checking…', async () => {
        showError('');
        verifyingCode = true;
        try {
          await Backend.verifyEmailCode(email, code);
          finishSignIn();
        } catch (e) {
          showError(friendlyError(e));
        } finally {
          verifyingCode = false;
        }
      });
    });
  }

  // The sheet has done its job: close it and complete whatever was tapped.
  // `fromBackground` is true when sign-in arrived without a tap in this tab,
  // so there's no gesture to hang a file download on.
  function finishSignIn({ fromBackground = false } = {}) {
    if (!modal.classList.contains('open')) return;
    const action = pendingAction;
    closeSheet();
    if (action) perform(action, { afterRedirect: fromBackground });
  }

  /* ---------- account panel ---------- */

  function openAccount() {
    renderAccount();
    SharedUI.openPanel(accountPanel);
  }

  function renderAccount() {
    const user = Backend.user();
    if (!user) return;
    const profile = Backend.profile() || {};
    const name = profile.display_name || '';
    const initial = (name || user.email || '?').trim().charAt(0).toUpperCase();

    accountContent.innerHTML = `
      <div class="account-head">
        ${profile.avatar_url
          ? `<img class="account-avatar" src="${esc(profile.avatar_url)}" alt="" referrerpolicy="no-referrer" />`
          : `<div class="account-avatar account-avatar-initial" aria-hidden="true">${esc(initial)}</div>`}
        <div class="account-head-text">
          <div class="run-title">${esc(name || 'Your account')}</div>
          <div class="run-location">${esc(user.email || '')}</div>
        </div>
      </div>

      <form id="account-name-form" class="account-section">
        <label class="filter-section-title" for="account-name">Name</label>
        <input class="ob-input" id="account-name" type="text" maxlength="60" autocomplete="name"
               placeholder="What should we call you?" value="${esc(name)}" />
        <button type="submit" class="ics-btn" id="account-name-save">Save name</button>
      </form>

      <div class="account-section">
        <button type="button" class="ics-btn" id="account-myruns">My runs</button>
        <button type="button" class="ics-btn" id="account-interested">Interested</button>
        <button type="button" class="ics-btn" id="account-prefs">Run preferences</button>
        <button type="button" class="ics-btn" id="account-export">Download my data</button>
        <button type="button" class="ics-btn" id="account-signout">Sign out</button>
      </div>

      <div class="account-section">
        <button type="button" class="account-delete-link" id="account-delete">Delete account</button>
        <div class="account-confirm" id="account-confirm" hidden>
          <p>This permanently deletes your account, your RSVPs and their history. It can't be undone.</p>
          <div class="ob-nav">
            <button type="button" class="ob-btn secondary" id="account-delete-cancel">Cancel</button>
            <button type="button" class="ob-btn account-delete-btn" id="account-delete-confirm">Delete my account</button>
          </div>
        </div>
      </div>

      <nav class="account-legal" aria-label="Legal">
        <a href="privacy.html">Privacy</a>
        <a href="terms.html">Terms</a>
        <a href="guidelines.html">Community Guidelines</a>
      </nav>
    `;

    // Each handler reports its own failure; the panel stays as it was.
    const guarded = (btn, busyLabel, failMsg, fn) => withBusy(btn, busyLabel, async () => {
      try { await fn(); } catch (e) { console.warn('Velocity: account action failed', e); SharedUI.toast(failMsg); }
    });

    document.getElementById('account-name-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const value = document.getElementById('account-name').value.trim();
      guarded(document.getElementById('account-name-save'), 'Saving…', 'Couldn\'t save your name. Try again.', async () => {
        await Backend.updateProfile({ display_name: value || null });
        renderAccount();
        SharedUI.toast('Name saved');
      });
    });

    document.getElementById('account-myruns').addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('velocity:open-calendar', { detail: { mine: true } }));
    });

    document.getElementById('account-interested').addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('velocity:open-interested'));
    });

    document.getElementById('account-prefs').addEventListener('click', () => {
      SharedUI.closeAllPanels();
      SharedUI.openOnboarding(Velocity.getPrefs() || {});
    });

    const exportBtn = document.getElementById('account-export');
    exportBtn.addEventListener('click', () => guarded(exportBtn, 'Preparing…', 'Couldn\'t prepare your data. Try again.', async () => {
      const data = await Backend.exportMyData();
      Velocity.downloadFile(JSON.stringify(data, null, 2), 'application/json', 'velocity-my-data.json');
      SharedUI.toast('Your data was downloaded');
    }));

    const signOutBtn = document.getElementById('account-signout');
    signOutBtn.addEventListener('click', () => guarded(signOutBtn, 'Signing out…', 'Couldn\'t sign out. Try again.', async () => {
      await Backend.signOut();
      SharedUI.closeAllPanels();
      SharedUI.toast('Signed out');
    }));

    const confirmBox = document.getElementById('account-confirm');
    document.getElementById('account-delete').addEventListener('click', () => { confirmBox.hidden = false; });
    document.getElementById('account-delete-cancel').addEventListener('click', () => { confirmBox.hidden = true; });
    const deleteBtn = document.getElementById('account-delete-confirm');
    deleteBtn.addEventListener('click', () => guarded(deleteBtn, 'Deleting…', 'Couldn\'t delete your account. Try again.', async () => {
      await Backend.deleteAccount();
      SharedUI.closeAllPanels();
      SharedUI.toast('Your account has been deleted');
    }));
  }

  /* ---------- menu entry + startup ---------- */

  function updateMenu() {
    const btn = document.getElementById('account-btn');
    if (!btn) return;
    btn.hidden = !Backend.enabled;
    btn.innerHTML = Backend.user() ? '&#9881;&#65039; Account' : '&#128273; Sign in';
    // The Interested list lives on the account, so it's a backend-mode entry.
    document.getElementById('interested-btn').hidden = !Backend.enabled;
  }

  // Strips what the sign-in redirect left in the address bar, so a reload or a
  // shared link doesn't carry a spent code or an old error.
  function cleanUrl() {
    const url = new URL(location.href);
    const keys = ['code', 'error', 'error_code', 'error_description'];
    if (!keys.some(k => url.searchParams.has(k)) && !/error=/.test(url.hash)) return;
    keys.forEach(k => url.searchParams.delete(k));
    if (/error=/.test(url.hash)) url.hash = '';
    history.replaceState(history.state, '', url.toString());
  }

  // Called once from index.html, after VariantA.mount() has built the menu.
  async function init() {
    updateMenu();
    document.addEventListener('velocity:auth-changed', () => {
      updateMenu();
      // Signed in while the sheet sat open, by tapping the link in the email
      // instead of typing the code. The link opens in a new tab, and supabase-js
      // signs in every open tab of the app at once, so without this the tab
      // the user started in stays stuck on "Check your email" with their
      // action never completed. (The Verify button finishes up by itself.)
      if (Backend.user() && !verifyingCode) finishSignIn({ fromBackground: true });
      if (!accountPanel.classList.contains('open')) return;
      if (Backend.user()) renderAccount(); else SharedUI.closeAllPanels();
    });
    document.getElementById('account-panel-close').addEventListener('click', SharedUI.closeAllPanels);

    const accountBtn = document.getElementById('account-btn');
    if (accountBtn) {
      accountBtn.addEventListener('click', () => {
        document.getElementById('more-menu').classList.remove('open');
        document.getElementById('more-btn').setAttribute('aria-expanded', 'false');
        if (Backend.user()) openAccount();
        else require({ type: 'signin' }, 'Sign in to Velocity');
      });
    }

    if (!Backend.enabled) return;

    const params = new URLSearchParams(location.search);
    const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
    const failed = params.has('error') || hashParams.has('error');
    const arrivedWithCode = params.has('code');
    const stored = readPending();
    // Coming back from the provider: the user was in the app a moment ago, so
    // don't make them go through the hero and onboarding again.
    if (params.has('code') || failed || stored) SharedUI.skipLanding();

    await Backend.ready;
    updateMenu();
    clearPending();
    cleanUrl();

    if (failed) { SharedUI.toast('Sign-in didn\'t complete. Try again.'); return; }
    if (!Backend.user()) return;
    if (!stored) {
      // Arrived by the email link, which opens its own tab: nothing to replay
      // here (the tab the user started in completes their action), but the
      // skipped landing shouldn't leave them wondering whether it worked.
      if (arrivedWithCode) SharedUI.toast('You\'re signed in');
      return;
    }
    await Velocity.runsReady();
    perform(stored, { afterRedirect: true });
  }

  return { init, require, openAccount };
})();
