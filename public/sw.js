// Retire the previously installed offline planner without touching training data.
const prefix = 'hybrid-planner-' + encodeURIComponent(self.registration.scope) + '-'

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key.startsWith(prefix)).map(key => caches.delete(key)))
    await self.clients.claim()
    await self.registration.unregister()
  })())
})
