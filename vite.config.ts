import react from '@vitejs/plugin-react'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { offlineWorkerSource } from './scripts/offline-worker.ts'
import { offlineManifest } from './scripts/offline-manifest.ts'

function offlineShell(): Plugin {
  let outputDirectory: string
  let workerUrl = './sw.js'
  return {
    name: 'local-first-offline-shell',
    apply: 'build',
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir)
      workerUrl = `${config.base}sw.js`
    },
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: 'offline-worker', content: workerUrl }, injectTo: 'head' }]
    },
    async closeBundle() {
      const { version, urls } = await offlineManifest(outputDirectory)
      await writeFile(resolve(outputDirectory, 'sw.js'), offlineWorkerSource(version, urls))
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), offlineShell()],
})
