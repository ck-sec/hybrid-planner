export interface OfflineStatus {
  kind: 'checking' | 'disabled' | 'installing' | 'ready' | 'failed'
  message: string
}

export type WorkerRegistrar = Pick<ServiceWorkerContainer, 'register'>

export function observeOfflineWorker(
  workerPath: string | null,
  pageURL: string,
  serviceWorker: WorkerRegistrar | undefined,
  notify: (status: OfflineStatus) => void,
): () => void {
  if (workerPath === null) {
    notify({ kind: 'disabled', message: 'Offline app caching is not enabled for this build.' })
    return () => {}
  }
  if (!serviceWorker) {
    notify({ kind: 'failed', message: 'Offline registration is unavailable in this browser or context. Reopening the app may require a connection.' })
    return () => {}
  }

  let workerURL: URL
  try {
    const page = new URL(pageURL)
    workerURL = new URL(workerPath, page)
    if (!workerPath.trim() || workerURL.origin !== page.origin || !['http:', 'https:'].includes(workerURL.protocol)) {
      throw new Error('The offline worker must be a same-origin HTTP(S) resource.')
    }
  } catch {
    notify({ kind: 'failed', message: 'Offline registration failed: this build has an invalid worker address. Reopening the app may require a connection.' })
    return () => {}
  }

  let cancelled = false
  let stopWatchingWorker = () => {}
  let stopWatchingRegistration = () => {}
  notify({ kind: 'installing', message: 'Preparing the offline app copy. Keep this page open until activation is confirmed.' })

  void (async () => {
    try {
      const registration = await serviceWorker.register(workerURL.href, { scope: new URL('.', workerURL).href })
      if (cancelled) return

      function watchWorker(worker: ServiceWorker) {
        stopWatchingWorker()
        const reportState = () => {
          if (cancelled) return
          if (worker.state === 'activated') {
            notify({ kind: 'ready', message: 'Offline-ready. The cached app is activated in this browser. Reopen this same address to use it without a connection.' })
          } else if (worker.state === 'redundant') {
            notify({ kind: 'failed', message: 'Offline installation failed or was superseded. Reopen this page online to retry; offline access is not confirmed.' })
          } else if (worker.state === 'installed') {
            notify({ kind: 'installing', message: 'Offline copy downloaded, but not activated yet. If this persists, close other app tabs and reopen this page.' })
          } else {
            notify({ kind: 'installing', message: 'Preparing the offline app copy. Keep this page open until activation is confirmed.' })
          }
        }
        worker.addEventListener('statechange', reportState)
        stopWatchingWorker = () => worker.removeEventListener('statechange', reportState)
        reportState()
      }

      const watchUpdate = () => {
        if (cancelled) return
        const worker = registration.installing ?? registration.waiting ?? registration.active
        if (worker) watchWorker(worker)
      }
      registration.addEventListener('updatefound', watchUpdate)
      stopWatchingRegistration = () => registration.removeEventListener('updatefound', watchUpdate)
      watchUpdate()
    } catch {
      if (!cancelled) notify({ kind: 'failed', message: 'Offline registration failed. Reopen this page online over HTTPS (or localhost) to retry. Your saved training data is unchanged.' })
    }
  })()

  return () => {
    cancelled = true
    stopWatchingWorker()
    stopWatchingRegistration()
  }
}
