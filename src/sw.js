// Service worker for the production build. vite.config.js copies this to
// dist/sw.js and puts VERSION and FILES (the build output to cache) above it.

const CACHE = `space-game-${VERSION}`;

self.addEventListener('install', (e) => {
  // Revalidate instead of trusting the HTTP cache. GitHub Pages sends
  // max-age=600 and a stale index.html could get cached next to newer assets.
  // 'no-cache' still gets a 304 for files the page just downloaded, so the
  // first install doesn't fetch the whole build a second time.
  const reqs = FILES.map((f) => new Request(f, { cache: 'no-cache' }));
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(reqs)));
});

self.addEventListener('activate', (e) => {
  // starsong- is what the caches were called before the rename
  const old = (k) => (k.startsWith('space-game-') || k.startsWith('starsong-')) && k !== CACHE;
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter(old).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// sent by the page when the player clicks the update button on the title screen
self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // page loads get the cached index.html whatever the query string (?play=continue etc).
  // Other navigations like /robots.txt go to the network.
  const page = req.mode === 'navigate' && /\/(index\.html)?$/.test(url.pathname);
  if (req.mode === 'navigate' && !page) return;
  e.respondWith(
    caches
      .open(CACHE)
      .then((c) => c.match(page ? 'index.html' : req, { ignoreVary: true }))
      .then((hit) => hit || fetch(req), () => fetch(req))
  );
});
