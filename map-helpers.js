/* ---------- v2 prototype: MapLibre setup ----------
   PRD.md §4.2 — MapLibre GL JS + a free, keyless vector style (OpenFreeMap),
   replacing Leaflet + OSM raster tiles. Shared by variants A and C. */

const MapHelper = (() => {
  const DUBAI_CENTER = [55.2708, 25.2048]; // MapLibre wants [lng, lat]
  const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

  function createMap(containerId) {
    return new maplibregl.Map({
      container: containerId,
      style: STYLE_URL,
      center: DUBAI_CENTER,
      zoom: 11,
      attributionControl: { compact: true },
    });
  }

  function markerEl(run) {
    const visual = Velocity.pinVisual(run);
    const wrap = document.createElement('div');
    wrap.className = 'club-marker-wrap';
    wrap.innerHTML = `
      <div class="marker-label">${run.name}</div>
      <div class="club-marker color-${visual.base}${visual.ring ? ' has-ring' : ''}"></div>
    `;
    return wrap;
  }

  function addMarkers(map, runs, onClick) {
    return runs.map(run => {
      const el = markerEl(run);
      el.querySelector('.club-marker').addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(run);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([run.lng, run.lat])
        .addTo(map);
      return marker;
    });
  }

  function clearMarkers(markers) {
    markers.forEach(m => m.remove());
    markers.length = 0;
  }

  return { createMap, addMarkers, clearMarkers, DUBAI_CENTER, STYLE_URL };
})();
