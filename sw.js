/* =========================================================
   Routa — service worker
   Caches the app shell so Routa opens instantly and works offline.
   Only same-origin GET requests are handled; Firebase calls always
   go to the network.
   On every deploy: change the version in CACHE below AND the ?v= on the
   style/script tags in index.html (they must match).
   ========================================================= */
const CACHE = 'routa-v2.6.4';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './vendor/inter-font.css',
  './vendor/noto-sans-thai-font.css',
  './script.js',
  './shapegrid.js',
  './clickspark.js',
  './borderglow.js',
  './dock.js',
  './gooeynav.js',
  './celebrate.js',
  './config.js',
  './i18n.js',
  './manifest.webmanifest',
  './vendor/chart.umd.min.js',
  './vendor/firebase-app-compat.js',
  './vendor/firebase-auth-compat.js',
  './vendor/firebase-firestore-compat.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon-apple-180.png',
];

// Fetch every file fresh from the server (bypassing the browser's HTTP cache), so one
// version's files are always stored together — never a new page with an old stylesheet.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => /^(routa|cadence)-/.test(k) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const NETWORK_TIMEOUT_MS = 3000;

// Network first: when online, every file comes from the server (revalidated, so it's cheap),
// which keeps the page, styles and scripts on the same version. The cache is used when
// offline or when the network takes too long, so the app still opens instantly-ish anywhere.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Files are stored without their ?v= version tag, so each one is cached once
    const bare = new URL(request.url); bare.search = '';
    const key = request.mode === 'navigate' ? './index.html' : bare.href;
    const cached = await cache.match(key, { ignoreSearch: true });
    const network = fetch(request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok && res.type === 'basic') cache.put(key, res.clone());
        return res;
      })
      .catch(() => null);
    if (!cached) return (await network) || new Response('Offline', { status: 503, statusText: 'Offline' });
    // Wait briefly for the network; fall back to the cached copy if it's slow or unreachable
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
    const fresh = await Promise.race([network, timeout]);
    if (fresh && fresh.ok) return fresh;
    event.waitUntil(network);
    return cached;
  })());
});
