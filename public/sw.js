// A minimal Service Worker required to trigger the PWA Install Prompt
const CACHE_NAME = 'manifest-cache-v1';

self.addEventListener('install', event => {
    self.skipWaiting(); // Instantly activate the new service worker
});

self.addEventListener('activate', event => {
    event.waitUntil(clients.claim());
});

// A dummy fetch event handler. Browsers require this to show the install prompt.
// We are just letting requests pass through normally to the server.
self.addEventListener('fetch', event => {
    event.respondWith(
        fetch(event.request).catch(() => {
            // Fallback if offline (optional caching logic goes here later)
            return caches.match(event.request);
        })
    );
});