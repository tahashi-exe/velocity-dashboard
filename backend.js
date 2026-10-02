/* ---------- Backend: Supabase client, sign-in, synced RSVPs ----------
   TECHNICAL.md §5–6. Active only when config.js supplies a backend; with
   `backend: null`, `enabled` is false, nothing here loads or runs, and the rest
   of the app behaves exactly as the static localStorage prototype did.

   The SDK is loaded on demand rather than from a <script> tag in index.html,
   so the static-mode site makes no request to it at all.

   Runs keep their slug as the app-facing id (data.js); the database uuid only
   appears in here, behind slugToId. */

const Backend = (() => {
  const cfg = (typeof VELOCITY_CONFIG !== 'undefined' && VELOCITY_CONFIG.backend) || null;
  const enabled = !!cfg;
  const SDK_URL = 'https://unpkg.com/@supabase/supabase-js@2';
  const LOCAL_RSVP_KEY = 'velocity_rsvp_v2';
  const PREFS_KEY = 'velocity_prefs';
  // The statuses the app still uses. The database enum also has
  // 'not_interested', retired with its button; a device's old local copy of
  // one is simply not carried over.
  const STATUSES = ['going', 'not_going', 'interested'];

  let client = null;
  let session = null;
  let profile = null;
  let runRows = null;   // cached rows of `runs`
  let slugToId = {};
  let rsvps = {};       // run uuid -> status, the signed-in user's own
  let counts = {};      // run uuid -> { going, interested }
  let userLoad = Promise.resolve(); // settles once the current user's data is in
  // Which sign-in methods the project has switched on. The sheet only offers
  // these, so enabling Google or Apple in Supabase is all it takes to show
  // that button — and a provider that isn't set up can't strand anyone on an
  // error page.
  let providers = { google: false, apple: false, email: true };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(s);
    });
  }

  function emit() { document.dispatchEvent(new CustomEvent('velocity:auth-changed')); }

  // Resolves true once the client exists and any session (including one being
  // completed from an OAuth redirect's ?code=) has been restored; false if the
  // backend is off or unreachable, in which case callers fall back to JSON.
  const ready = enabled ? init() : Promise.resolve(false);

  async function init() {
    try {
      await loadScript(SDK_URL);
      client = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
      });
      const [restored] = await Promise.all([client.auth.getSession(), loadProviders()]);
      session = restored.data.session;

      client.auth.onAuthStateChange((event, next) => {
        const before = session ? session.user.id : null;
        session = next;
        const after = session ? session.user.id : null;
        if (before === after) return; // token refresh, not a different user
        // supabase-js deadlocks if its own API is awaited inside this callback,
        // so the follow-up queries run on the next tick.
        userLoad = new Promise(resolve => setTimeout(resolve, 0))
          .then(loadForCurrentUser)
          .catch(e => console.warn('Velocity: could not load account data', e))
          .then(emit);
      });

      if (session) {
        userLoad = loadForCurrentUser().catch(e => console.warn('Velocity: could not load account data', e));
        await userLoad;
      } else {
        refreshCounts().catch(() => {});
      }
      return true;
    } catch (e) {
      console.warn('Velocity: backend unavailable, using the static data files', e);
      client = null;
      session = null;
      return false;
    }
  }

  async function loadProviders() {
    try {
      const res = await fetch(`${cfg.supabaseUrl}/auth/v1/settings`, { headers: { apikey: cfg.supabaseKey } });
      const external = (await res.json()).external || {};
      providers = { google: !!external.google, apple: !!external.apple, email: external.email !== false };
    } catch (e) { /* keep the email-only default */ }
  }

  async function loadForCurrentUser() {
    if (!session) {
      profile = null;
      rsvps = {};
    } else {
      const uid = session.user.id;
      const [p, r] = await Promise.all([
        client.from('profiles').select('*').eq('id', uid).maybeSingle(),
        client.from('rsvps').select('run_id,status'),
      ]);
      if (p.error) throw p.error;
      if (r.error) throw r.error;
      profile = p.data;
      rsvps = Object.fromEntries(r.data.map(x => [x.run_id, x.status]));
      await adoptDeviceData();
    }
    await refreshCounts().catch(() => {});
  }

  // First sign-in on a device that was used as a guest: carry its local RSVPs
  // and onboarding prefs into the account (PRD.md §4.8b), then record which
  // Terms version the sign-in sheet's fine print covered.
  async function adoptDeviceData() {
    if (!profile) return;
    const uid = session.user.id;

    let local = {};
    try { local = JSON.parse(localStorage.getItem(LOCAL_RSVP_KEY)) || {}; } catch (e) { /* unreadable — nothing to adopt */ }
    if (Object.keys(local).length) {
      await fetchRuns();
      const rows = Object.entries(local)
        .filter(([slug, status]) => slugToId[slug] && !rsvps[slugToId[slug]] && STATUSES.includes(status))
        .map(([slug, status]) => ({ user_id: uid, run_id: slugToId[slug], status }));
      if (rows.length) {
        const { error } = await client.from('rsvps').upsert(rows);
        if (error) throw error; // keep the local copy for the next attempt
        rows.forEach(x => { rsvps[x.run_id] = x.status; });
      }
      localStorage.removeItem(LOCAL_RSVP_KEY);
    }

    const patch = {};
    let localPrefs = null;
    try { localPrefs = JSON.parse(localStorage.getItem(PREFS_KEY)); } catch (e) { /* treated as none */ }
    const accountPrefs = profile.prefs && Object.keys(profile.prefs).length ? profile.prefs : null;
    if (accountPrefs) {
      // The account's copy wins, so prefs follow the user to a new device.
      localStorage.setItem(PREFS_KEY, JSON.stringify(accountPrefs));
      document.dispatchEvent(new CustomEvent('velocity:prefs-changed'));
    } else if (localPrefs) {
      patch.prefs = localPrefs;
    }
    const prefsName = ((accountPrefs || localPrefs || {}).name || '').trim();
    if (!profile.display_name && prefsName) patch.display_name = prefsName.slice(0, 60);
    if (profile.terms_version !== VELOCITY_CONFIG.termsVersion) patch.terms_version = VELOCITY_CONFIG.termsVersion;
    if (Object.keys(patch).length) await updateProfile(patch);
  }

  async function fetchRuns() {
    if (runRows) return runRows;
    const { data, error } = await client.from('runs').select('*');
    if (error) throw error;
    runRows = data;
    slugToId = Object.fromEntries(data.map(r => [r.slug, r.id]));
    return data;
  }

  async function refreshCounts() {
    const { data, error } = await client.rpc('run_counts');
    if (error) throw error;
    counts = Object.fromEntries(data.map(c => [c.run_id, c]));
  }

  /* ---------- sign-in ---------- */

  // Back to this exact page; must be on the project's redirect allow-list.
  function redirectUrl() { return location.origin + location.pathname; }

  // 'google' or 'apple'. Navigates away; the session is completed in init()
  // when the provider redirects back with ?code=.
  async function signInWithProvider(provider) {
    const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo: redirectUrl() } });
    if (error) throw error;
  }

  async function sendEmailCode(email) {
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: redirectUrl() },
    });
    if (error) throw error;
  }

  async function verifyEmailCode(email, token) {
    const { error } = await client.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw error;
    await userLoad; // set by the auth listener, which has fired by now
  }

  async function signOut() {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw error;
    await userLoad;
  }

  /* ---------- RSVPs ---------- */

  function rsvpFor(slug) { return rsvps[slugToId[slug]] || null; }
  function countsFor(slug) { return counts[slugToId[slug]] || { going: 0, interested: 0 }; }

  // `toggle` mirrors the buttons (tap the active one to clear). Replaying an
  // action after sign-in passes toggle:false, so a returning user who taps
  // Going on a run they're already going to doesn't end up un-RSVP'd.
  async function setRsvp(slug, status, { toggle = true } = {}) {
    const id = slugToId[slug];
    if (!client || !session || !id) throw new Error('RSVP unavailable');
    const current = rsvps[id] || null;
    const next = toggle && current === status ? null : status;
    if (next === current) return current;

    const apply = value => { if (value) rsvps[id] = value; else delete rsvps[id]; };
    apply(next);
    const uid = session.user.id;
    const { error } = next
      ? await client.from('rsvps').upsert({ user_id: uid, run_id: id, status: next })
      : await client.from('rsvps').delete().eq('user_id', uid).eq('run_id', id);
    if (error) { apply(current); throw error; }
    await refreshCounts().catch(() => {});
    return next;
  }

  /* ---------- account ---------- */

  async function updateProfile(patch) {
    const { data, error } = await client.from('profiles').update(patch).eq('id', session.user.id).select().single();
    if (error) throw error;
    profile = data;
    return data;
  }

  // Everything held about the user, for Account → Download my data.
  async function exportMyData() {
    const uid = session.user.id;
    const [p, r] = await Promise.all([
      client.from('profiles').select('*').eq('id', uid).single(),
      client.from('rsvps').select('status,created_at,updated_at,runs(slug,name)'),
    ]);
    if (p.error) throw p.error;
    if (r.error) throw r.error;
    return {
      exported_at: new Date().toISOString(),
      account: {
        email: session.user.email,
        created_at: session.user.created_at,
        sign_in_methods: (session.user.app_metadata && session.user.app_metadata.providers) || [],
      },
      profile: p.data,
      rsvps: r.data.map(x => ({
        run: x.runs ? x.runs.name : null,
        run_id: x.runs ? x.runs.slug : null,
        status: x.status,
        created_at: x.created_at,
        updated_at: x.updated_at,
      })),
    };
  }

  // Erases the auth user; profile, RSVPs and RSVP history cascade with it. The
  // device's own copy of the prefs goes too, since it holds the user's name.
  async function deleteAccount() {
    const { error } = await client.rpc('delete_my_account');
    if (error) throw error;
    localStorage.removeItem(PREFS_KEY);
    localStorage.removeItem(LOCAL_RSVP_KEY);
    await client.auth.signOut({ scope: 'local' }).catch(() => {});
    await userLoad;
    document.dispatchEvent(new CustomEvent('velocity:prefs-changed'));
  }

  return {
    enabled, ready,
    available: () => !!client,
    user: () => (session ? session.user : null),
    profile: () => profile,
    providers: () => providers,
    fetchRuns, rsvpFor, countsFor, setRsvp,
    signInWithProvider, sendEmailCode, verifyEmailCode, signOut,
    updateProfile, exportMyData, deleteAccount,
  };
})();
