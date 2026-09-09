import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'
import type { Connect, Plugin } from 'vite'
import { marketingPages, notFoundPage, siteOrigin, sitemap } from './scripts/marketing.ts'

function staticSite(): Plugin {
  let outputDirectory: string
  let base = '/'
  let building = false
  const pages = marketingPages()
  const servePages = (render: boolean): Connect.NextHandleFunction => (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith(base) || !['GET', 'HEAD'].includes(request.method ?? 'GET')) return next()
    const path = '/' + url.pathname.slice(base.length)
    const canonical = path.replace(/\/index\.html$/, '/')
    const page = pages.find(page => page.path === canonical || page.path === `${canonical}/`)
    if ((page && path !== page.path) || path === '/app' || path === '/app/index.html') {
      response.writeHead(301, { Location: `${base}${(page?.path ?? '/app/').slice(1)}${url.search}` })
      response.end()
    } else if (path.startsWith('/app/') && path !== '/app/') {
      response.writeHead(302, { Location: `${base}app/${url.search}` })
      response.end()
    } else if (page && render) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(request.method === 'HEAD' ? undefined : page.html)
    } else {
      if (page) request.url = `${base}${page.path.slice(1)}index.html${url.search}`
      if (path === '/app/') request.url = `${base}app/index.html${url.search}`
      next()
    }
  }
  const missingPage: Connect.NextHandleFunction = (request, response, next) => {
    // Vite renders the HTML entry after plugin post-middleware, with the base stripped.
    if (request.url?.split('?')[0] === '/app/index.html') return next()
    if (!request.headers.accept?.includes('text/html')) return next()
    response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(request.method === 'HEAD' ? undefined : notFoundPage(base))
  }
  return {
    name: 'static-marketing-site',
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir)
      building = config.command === 'build'
      base = config.base === './' || config.base === '' ? '/' : config.base
    },
    configureServer(server) {
      server.middlewares.use(servePages(true))
      return () => server.middlewares.use(missingPage)
    },
    configurePreviewServer(server) {
      server.middlewares.use(servePages(false))
      return () => server.middlewares.use(missingPage)
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      async handler() {
        if (!building) return
        for (const page of pages) {
          const path = resolve(outputDirectory, `.${page.path}index.html`)
          await mkdir(dirname(path), { recursive: true })
          await writeFile(path, page.html)
        }
        await writeFile(resolve(outputDirectory, '404.html'), notFoundPage(base))
        await writeFile(resolve(outputDirectory, 'sitemap.xml'), sitemap(pages))
        await writeFile(resolve(outputDirectory, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${siteOrigin}/sitemap.xml\n`)
      },
    },
  }
}

export default defineConfig({
  base: './',
  appType: 'mpa',
  build: { rolldownOptions: { input: resolve(import.meta.dirname, 'app', 'index.html') } },
  plugins: [staticSite()],
})
