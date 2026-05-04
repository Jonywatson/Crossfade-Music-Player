// sw.js
const CACHE_NAME = 'music-player-v2'; // ← Bump this number

self.addEventListener('install', event => {
  self.skipWaiting(); // Force activate new SW immediately
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key)) // Delete old cache
      );
    })
  );
  self.clients.claim(); // Take control immediately
});