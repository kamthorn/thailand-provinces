/* Service worker: makes the demo page and address data work offline.
 * - app shell (page + library): network-first, falls back to cache
 * - v2/ data: stale-while-revalidate (instant from cache, refreshed in background)
 * Bump VERSION when changing this file's strategy or the shell file list. */
const VERSION = 'v1';
const CACHE = 'thai-address-' + VERSION;
const SHELL = ['./', 'index.html', 'thai-address.js', 'v2/address.json', 'v2/provinces.json'];

self.addEventListener('install', (e) => {
  // addAll is all-or-nothing; tolerate a failed precache so install never blocks on a bad network
  e.waitUntil(caches.open(CACHE).then((c) =>
    Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('thai-address-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function refresh(req, cache) {
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope).pathname;
  const isData = url.pathname.startsWith(scope + 'v2/');

  if (isData) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const net = refresh(req, c);
      if (hit) { net.catch(() => {}); return hit; }
      return net;
    }));
  } else if (req.mode === 'navigate' || /\.(?:html|js)$/.test(url.pathname)) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      try { return await refresh(req, c); }
      catch (err) { return (await c.match(req, { ignoreSearch: true })) || (await c.match('index.html')) || Response.error(); }
    }));
  }
});
