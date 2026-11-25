// Service worker: precaches the app shell so Pace opens offline.
// The cache name includes the app version, so bumping js/version.js
// makes every phone download the new files once.

importScripts('js/version.js');

const CACHE = `pace-${self.PACE_VERSION}`;
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/version.js',
  'js/app.js',
  'js/views.js',
  'js/setup.js',
  'js/profile.js',
  'js/ui.js',
  'js/db.js',
  'js/platform.js',
  'js/coach/vdot.js',
  'js/connect.js',
  'js/sync/provider.js',
  'js/sync/intervals.js',
  'js/sync/workout-text.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-64.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pace-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The page asks us to activate right away when the user taps "Bijwerken".
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// Cache first for our own files, network for everything else.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
    })
  );
});
