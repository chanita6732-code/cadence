/* =========================================================
   Cadence — service worker
   Caches the app shell so Cadence opens instantly and works offline.
   Only same-origin GET requests are handled; Firebase calls always
   go to the network. Bump CACHE when you deploy a new version.
   ========================================================= */
const CACHE = 'cadence-v2.3.0';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './vendor/inter-font.css',
  './vendor/noto-sans-thai-font.css',
  './script.js',
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
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cadence-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Stale-while-revalidate: answer from cache immediately, refresh the cache in the background
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = request.mode === 'navigate' ? './index.html' : request;
    const cached = await cache.match(key, { ignoreSearch: request.mode === 'navigate' });
    const network = fetch(request)
      .then((res) => {
        if (res.ok && res.type === 'basic') cache.put(key, res.clone());
        return res;
      })
      .catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    return (await network) || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
