/**
 * Admin dashboard PWA — precaches same-origin shell assets only.
 * Fetch: only shell URLs below (cache-first); everything else bypasses SW (no stale API/Firebase init).
 */
const ADMIN_SHELL_CACHE = "admin-shell-v11";

const PRECACHE_URLS = [
  "/admin.html",
  "/admin.webmanifest",
  "/css/styles.css",
  "/js/firebase-init.js",
  "/js/payment-service.js",
  "/js/admin.js",
  "/js/admin-upload.js",
  "/js/ad-booking-shared.js",
  "/js/admin-ads.js",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png"
];

const SHELL_PATHNAMES = new Set(
  PRECACHE_URLS.map((u) => {
    try {
      return new URL(u, self.location.origin).pathname;
    } catch (_e) {
      return u.startsWith("/") ? u : "/" + u;
    }
  })
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(ADMIN_SHELL_CACHE)
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch((err) => {
              console.warn("[admin-shell-sw] precache skip:", url, err && err.message);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("admin-shell-") && k !== ADMIN_SHELL_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (!SHELL_PATHNAMES.has(url.pathname)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request);
    })
  );
});
