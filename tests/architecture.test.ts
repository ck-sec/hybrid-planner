import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('the actual lint configuration enforces the engine boundary and deterministic APIs', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'hybrid-planner-lint-'))
  try {
    copyFileSync(join(project, '.oxlintrc.json'), join(temporary, '.oxlintrc.json'))
    mkdirSync(join(temporary, 'engine'))
    const cases = [
      { file: 'probe.ts', source: "import '../src/App.tsx'", error: 'must never depend on the application' },
      { file: 'probe.ts', source: "import type { State } from '../src/storage.ts'", error: 'must never depend on the application' },
      { file: 'probe.ts', source: "import '@/storage'", error: 'must never depend on the application' },
      { file: 'probe.ts', source: "export { default } from '../src/App.tsx'", error: 'must never depend on the application' },
      { file: 'probe.ts', source: "void import('../src/App.tsx')", error: 'must never depend on the application' },
      { file: 'probe.ts', source: "import 'react'", error: 'zero dependencies' },
      { file: 'probe.ts', source: "import 'node:fs'", error: 'zero dependencies' },
      { file: 'probe.ts', source: 'export const value = Math.random()', error: 'randomness' },
      { file: 'probe.ts', source: 'export const value = Date.now()', error: 'clock' },
      { file: 'probe.ts', source: "import './types.ts'", error: null },
      { file: 'probe.test.ts', source: "import 'node:test'", error: null },
      { file: 'probe.test.ts', source: "import '../src/App.tsx'", error: 'must never depend on the application' },
    ]
    for (const fixture of cases) {
      const file = join('engine', fixture.file)
      writeFileSync(join(temporary, file), fixture.source)
      const result = spawnSync(process.execPath, [join(project, 'node_modules', 'oxlint', 'bin', 'oxlint'), file], {
        cwd: temporary,
        encoding: 'utf8',
      })
      assert.ifError(result.error)
      const output = result.stdout + result.stderr
      if (fixture.error) {
        assert.notEqual(result.status, 0, `Lint allowed ${fixture.source}`)
        assert.ok(output.includes(fixture.error), output)
      } else {
        assert.equal(result.status, 0, output)
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
