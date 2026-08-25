/* ---------- v2 prototype: variant switcher ----------
   Per the mattpocock/skills "prototype" UI skill: sub-shape A (variants on
   the existing route, gated by ?variant=), floating bottom-centre switcher,
   left/right arrows + keyboard, URL is shareable/reload-stable.
   NOT for production — this whole branch is throwaway (see PRD.md / the
   prototype skill's own rule 6: capture the winner, drop the rest). */

const VARIANTS = [
  { key: 'A', name: 'Map Sheet', mount: () => VariantA.mount() },
  { key: 'B', name: 'Weekly Planner', mount: () => VariantB.mount() },
  { key: 'C', name: 'Feed & Map', mount: () => VariantC.mount() },
];

function currentVariantKey() {
  const v = new URLSearchParams(location.search).get('variant');
  return VARIANTS.some(x => x.key === v) ? v : 'A';
}

function goToVariant(key) {
  const params = new URLSearchParams(location.search);
  params.set('variant', key);
  location.search = params.toString();
}

function mountSwitcher() {
  const bar = document.getElementById('variant-switcher');
  const idx = VARIANTS.findIndex(v => v.key === currentVariantKey());
  const current = VARIANTS[idx];

  bar.innerHTML = `
    <button type="button" class="switcher-arrow" id="switcher-prev" aria-label="Previous variant">&#8592;</button>
    <span class="switcher-label">${current.key} &middot; ${current.name}</span>
    <button type="button" class="switcher-arrow" id="switcher-next" aria-label="Next variant">&#8594;</button>
  `;

  const step = (dir) => {
    const next = (idx + dir + VARIANTS.length) % VARIANTS.length;
    goToVariant(VARIANTS[next].key);
  };
  document.getElementById('switcher-prev').addEventListener('click', () => step(-1));
  document.getElementById('switcher-next').addEventListener('click', () => step(1));

  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
}

function mountVariant() {
  const active = VARIANTS.find(v => v.key === currentVariantKey());
  document.getElementById('app-root').innerHTML = '';
  active.mount();
}
