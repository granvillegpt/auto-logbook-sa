/* Service worker for admin PWA only. Scope: /admin/ */
const CACHE_NAME = 'admin-reviews-sw-v4';

const ASSETS_TO_CACHE = [
  '/admin/reviews.html',
  '/admin/admin.webmanifest',
  '/css/styles.css',
  '/js/services/reviewService.js',
  '/js/services/storageAdapter.js',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png'
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
  const pwaIcon =
    url.pathname === '/assets/icons/icon-192.png' ||
    url.pathname === '/assets/icons/icon-512.png';
  if (url.pathname.startsWith('/admin/') || url.pathname === '/css/styles.css' ||
      url.pathname.startsWith('/js/services/') || pwaIcon) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});
