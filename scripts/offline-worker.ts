export function offlineWorkerSource(version: string, urls: readonly string[]): string {
  return `
const PREFIX = 'hybrid-planner-' + encodeURIComponent(self.registration.scope) + '-';
const CACHE = PREFIX + ${JSON.stringify(version)};
const ASSETS = ${JSON.stringify(urls)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    // These are public, precached static files. Hosts may send Vary: Origin;
    // module requests carry Origin, while the precache requests may not.
    if (event.request.mode === 'navigate') return (await cache.match('./index.html', { ignoreVary: true })) || fetch(event.request);
    return (await cache.match(event.request, { ignoreVary: true })) || fetch(event.request);
  }));
});
`
}
