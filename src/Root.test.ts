import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

test('all app bookmarks open the current campaign without touching browser data', async t => {
  const rootUrl = new URL('./Root.tsx', import.meta.url)
  const campaignUrl = new URL('./campaign/CampaignApp.tsx', import.meta.url)
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (url === campaignUrl.href) {
        return { format: 'module', shortCircuit: true, source: 'export default function CampaignApp() { return null }' }
      }
      if (url !== rootUrl.href) return nextLoad(url, context)
      return {
        format: 'module', shortCircuit: true,
        source: ts.transpileModule(readFileSync(rootUrl, 'utf8'), {
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
        }).outputText,
      }
    },
  })
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalDatabase = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  t.mock.method(globalThis, 'fetch', () => assert.fail('Routing must not make a request'))
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    get: () => assert.fail('Routing must leave every browser database untouched'),
  })
  try {
    const { default: Root } = await import('./Root.tsx')
    const { default: CampaignApp } = await import('./campaign/CampaignApp.tsx')
    for (const search of ['', '?view=legacy', '?view=legacy&keep=1', '?view=unknown']) {
      const location = { pathname: '/app/', search, hash: '#session/saved' }
      Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } })
      assert.equal(Root().type, CampaignApp, search)
      assert.deepEqual(location, { pathname: '/app/', search, hash: '#session/saved' })
    }
  } finally {
    hooks.deregister()
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (originalDatabase) Object.defineProperty(globalThis, 'indexedDB', originalDatabase)
    else Reflect.deleteProperty(globalThis, 'indexedDB')
  }
})
