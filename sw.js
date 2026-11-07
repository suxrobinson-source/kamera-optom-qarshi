/* Minimal service worker: tarmoq birinchi, internet yo'q bo'lsa — oxirgi saqlangan sahifa.
   API (/api) so'rovlari keshlanmaydi, shuning uchun narx va ombor har doim yangi. */
const CACHE = 'ko-shell-v1';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.includes('/api/')) return;               // API ni keshlama
  if (req.mode !== 'navigate' && !/\.(png|jpg|jpeg|svg|webp|woff2?|css|js)$/i.test(url.pathname)) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && url.origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((m) => m || (req.mode === 'navigate' ? caches.match('./app.html') : undefined)))
  );
});
