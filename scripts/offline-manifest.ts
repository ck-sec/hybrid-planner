import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const nonCacheableFiles = new Set(['_headers', '_redirects', '_routes.json', '404.html'])

export async function offlineManifest(directory: string): Promise<{ version: string; urls: string[] }> {
  const files = (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter(file => file.isFile() && file.name !== 'sw.js')
    .map(file => resolve(file.parentPath, file.name))
    .sort()
  const hash = createHash('sha256')
  const urls: string[] = []
  for (const file of files) {
    const path = relative(directory, file).replaceAll('\\', '/')
    // Static hosts can redirect index.html; navigation needs an unredirected shell.
    const url = `./${path.replace(/(^|\/)index\.html$/, '$1')}`
    hash.update(url)
    hash.update(await readFile(file))
    // A 404 response would fail cache.addAll, just like a hosting directive.
    if (!nonCacheableFiles.has(path)) urls.push(url)
  }
  return { version: hash.digest('hex').slice(0, 16), urls }
}
