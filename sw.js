// Installability only (PRD.md §4.13 / TECHNICAL.md §9) — no offline caching
// of map tiles or run data, deliberately the smaller of the two options
// considered. A service worker is still required for iOS home-screen install.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
