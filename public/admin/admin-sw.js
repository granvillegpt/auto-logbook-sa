/* Service worker for admin PWA only. Scope: /admin/ */
const CACHE_NAME = 'admin-pwa-v1';

const ASSETS_TO_CACHE = [
  '/admin/reviews.html',
  '/admin/admin.webmanifest',
  '/css/styles.css',
  '/js/services/reviewService.js',
  '/js/services/storageAdapter.js',
  '/assets/logos/favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/admin/') || url.pathname === '/css/styles.css' ||
      url.pathname.startsWith('/js/services/') || url.pathname.startsWith('/assets/logos/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});
