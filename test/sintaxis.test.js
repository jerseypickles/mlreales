import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Un archivo que no parsea bota el arranque entero en Render. Pasó el
// 17-sep-2026: un comentario dejó afuera un paréntesis en una ruta que ningún
// test importaba, y el deploy falló. Esto revisa TODO src, se importe o no.
const archivos = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? archivos(p) : p.endsWith('.js') ? [p] : []
})

test('todo archivo de src parsea', () => {
  const rotos = []
  for (const f of archivos('src')) {
    try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }) } catch (err) { rotos.push(`${f}: ${String(err.stderr).split('\n').slice(0, 3).join(' ')}`) }
  }
  assert.deepEqual(rotos, [])
})
