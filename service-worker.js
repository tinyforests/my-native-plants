const CACHE_NAME = 'fmnp-national-v2';

const urlsToCache = [
  '/',
  '/index.html',
  '/about.html',
  '/contact.html',
  '/manifest.json'
];

// Install — pre-cache the shell, then take over immediately.
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache).catch(() => {}))
  );
});

// Activate — drop every old cache (including the v1 Victoria build) and claim clients.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Network-first for navigations so a new deploy is always seen; fall back to cache offline.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const isNavigation = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
    );
    return;
  }

  // Everything else: cache-first, then network.
  event.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
