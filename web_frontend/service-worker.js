'use strict';

const CACHE_NAME = 'mygame-shell-__BUILD_TAG__';
const AUDIO_CACHE_NAME = 'mygame-audio-__BUILD_TAG__';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/site.css',
  './src/shell.js',
  './src/health.css',
  './src/styles.css',
  './src/pwa.js',
  './src/health.js',
  './src/app.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/img/car_base.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => (
        (key.startsWith('mygame-shell-') && key !== CACHE_NAME)
        || (key.startsWith('mygame-audio-') && key !== AUDIO_CACHE_NAME)
      ))
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') {
    return;
  }

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.includes('/assets/audio/')) {
    event.respondWith(
      caches.open(AUDIO_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) {
          return cached;
        }
        const response = await fetch(req);
        if (response.ok && response.status === 200 && !req.headers.has('range')) {
          cache.put(req, response.clone()).catch(() => {});
        }
        return response;
      })
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((res) => res || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'CACHE_AUDIO' || !Array.isArray(data.urls)) {
    return;
  }
  const urls = data.urls
    .filter((rawUrl) => typeof rawUrl === 'string')
    .map((rawUrl) => new URL(rawUrl, self.location.href))
    .filter((url) => url.origin === self.location.origin && url.pathname.includes('/assets/audio/'));
  if (!urls.length) {
    return;
  }
  event.waitUntil(
    caches.open(AUDIO_CACHE_NAME).then((cache) => Promise.all(urls.map(async (url) => {
      const request = new Request(url.href, { cache: 'reload' });
      const cached = await cache.match(request);
      if (cached) {
        return;
      }
      const response = await fetch(request);
      if (response.ok && response.status === 200) {
        await cache.put(request, response.clone());
      }
    }))).catch(() => {})
  );
});
