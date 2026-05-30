/*
 * Frag Protocol service worker.
 *
 * Purpose is twofold: it makes the site installable as a PWA (the install
 * prompt requires a registered SW with a fetch handler), and it gives the
 * installed app a basic offline mode after the first visit.
 *
 * Strategy: network-first for same-origin GETs, falling back to the cache when
 * offline. The app's JS/WASM/asset files are content-hashed by Vite, so a fresh
 * network response is always preferred and the cache is just a safety net.
 * Cross-origin requests (notably the ws:// game server) are left untouched.
 */
const CACHE = 'frag-protocol-v1';

self.addEventListener('install', () => {
  // Take over as soon as the new worker is ready — no waiting for old tabs.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only handle our own origin; never intercept the WebSocket server or CDNs.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(req);
      // Cache successful, fully-fetched same-origin responses for offline use.
      if (fresh && fresh.ok && (fresh.type === 'basic' || fresh.type === 'default')) {
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const cached = await cache.match(req);
      if (cached) return cached;
      // SPA navigation offline: serve the cached app shell if we have it.
      if (req.mode === 'navigate') {
        const shell = (await cache.match('index.html')) || (await cache.match('./'));
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
