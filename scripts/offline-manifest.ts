import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const hostingFiles = new Set(['_headers', '_redirects', '_routes.json'])

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
    const url = path === 'index.html' ? './' : `./${path}`
    hash.update(url)
    hash.update(await readFile(file))
    // Hosting directives affect cached responses, but are not fetchable assets.
    if (!hostingFiles.has(path)) urls.push(url)
  }
  return { version: hash.digest('hex').slice(0, 16), urls }
}
