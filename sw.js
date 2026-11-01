// ImmunTrack service worker: keeps the app usable offline in the field.
// Network first (so updates arrive immediately), cached copy when there is no signal.
const CACHE = 'immuntrack-v1';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/api.js', 'js/ui.js', 'js/camera.js', 'js/config.js', 'js/vaccinator.js', 'js/supervisor.js',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // database calls are POST — never cached
  const url = new URL(req.url);
  if (url.pathname.includes('/rest/v1/')) return;
  if (url.hostname.includes('tile.openstreetmap.org')) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && (url.origin === location.origin || url.hostname.includes('jsdelivr') || url.hostname.includes('cdnjs'))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
