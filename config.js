/* ---------- Backend config ----------
   Both values below are public by design. The publishable key only grants
   what the database's row-level security allows a guest or the signed-in user
   (see supabase/README.md). The SECRET key never belongs in this file, or
   anywhere in the frontend.

   `backend: null` keeps the app in its original static mode: runs come from
   clubs.json / events.json, RSVPs and prefs stay in localStorage, and nothing
   asks anyone to sign in. That is what the live site gets until PROD is set at
   cutover (TECHNICAL.md §11). Local development talks to the dev project. */

const VELOCITY_CONFIG = (() => {
  const DEV = {
    supabaseUrl: 'https://lxbawcwywniasqiriske.supabase.co',
    supabaseKey: 'sb_publishable_enHTlxY-uGkJOMabBzz2Xg_bh6OMVHn',
  };
  const PROD = null;

  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  return {
    backend: isLocal ? DEV : PROD,
    // Bump when terms.html / privacy.html change materially; stored on the
    // profile as the version the user accepted.
    termsVersion: '0.1',
  };
})();
