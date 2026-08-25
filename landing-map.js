/* ---------- Landing background: "world coming into focus" ----------
   A decorative, non-interactive MapLibre map behind the landing hero.
   Starts zoomed way out and flies into Dubai on load. Attempts MapLibre's
   native 3D globe projection first — but that API only exists from
   MapLibre GL JS v5 onward, and this app's unpkg `@4` CDN tag resolves to
   4.7.1 (verified live), which doesn't have `setProjection` at all. The
   try/catch below means this silently degrades to a flat mercator zoom,
   which is what's actually shipping today — bumping to `@5` app-wide was
   judged too risky to do untested just for this cosmetic effect, since
   variants A/B/C all depend on the same CDN script for their real maps. */

const LandingMap = (() => {
  let map = null;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const container = document.getElementById('landing-map');

  if (container) {
    map = new maplibregl.Map({
      container: 'landing-map',
      style: MapHelper.STYLE_URL,
      center: MapHelper.DUBAI_CENTER,
      zoom: reduceMotion ? 11 : 1.6,
      attributionControl: { compact: true },
      interactive: false,
    });

    try { map.setProjection({ type: 'globe' }); } catch (e) { /* older MapLibre build — degrades to flat map */ }

    map.once('load', () => {
      const flyIn = () => {
        if (!map) return;
        map.flyTo({
          center: MapHelper.DUBAI_CENTER,
          zoom: 11,
          duration: reduceMotion ? 0 : 3200,
          curve: 1.42,
          essential: true,
        });
      };
      if (reduceMotion) flyIn();
      else setTimeout(flyIn, 900);
    });
  }

  function destroy() {
    if (map) { map.remove(); map = null; }
  }

  return { destroy };
})();
