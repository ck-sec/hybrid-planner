export function offlineWorkerSource(version: string, urls: readonly string[]): string {
  return `
const PREFIX = 'hybrid-planner-' + encodeURIComponent(self.registration.scope) + '-';
const CACHE = PREFIX + ${JSON.stringify(version)};
const ASSETS = ${JSON.stringify(urls)};
const SCOPE = new URL(self.registration.scope);
const APP = new URL('./app/', SCOPE);
const PAGES = new Set(ASSETS.filter(path => path.endsWith('/')).map(path => new URL(path, SCOPE).href));
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
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    // These are public, precached static files. Hosts may send Vary: Origin;
    // module requests carry Origin, while the precache requests may not.
    if (event.request.mode === 'navigate') {
      const canonical = new URL(url.pathname.replace(/\\/index\\.html$/, '/') + (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html') ? '' : '/'), url.origin);
      if (PAGES.has(canonical.href) && canonical.pathname !== url.pathname) {
        canonical.search = url.search;
        return Response.redirect(canonical.href, 301);
      }
      const key = url.pathname.startsWith(APP.pathname) ? APP.href : new URL(url.pathname, url.origin).href;
      if (PAGES.has(key)) return (await cache.match(key, { ignoreVary: true })) || fetch(event.request);
      return fetch(event.request);
    }
    return (await cache.match(event.request, { ignoreVary: true })) || fetch(event.request);
  }));
});
`
}
