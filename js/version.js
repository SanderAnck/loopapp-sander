// Single source of truth for the app version.
// Loaded by both the page (window) and the service worker (importScripts).
// Bump this on every release so the service worker refreshes its cache.
self.PACE_VERSION = '0.8.1';
