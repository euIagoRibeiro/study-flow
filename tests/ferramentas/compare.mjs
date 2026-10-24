// Compara duas pastas de prints em tests/out/. Uso: node ferramentas/compare.mjs antes depois
// Grava out/diff-<arquivo>.png de cada print diferente (pixel em vermelho)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pixelmatch from 'pixelmatch'
import pngjs from 'pngjs'
import { OUT as here } from '../config.mjs'
const { PNG } = pngjs
const [a, b] = process.argv.slice(2)
for (const file of readdirSync(join(here, a)).sort()) {
  const x = PNG.sync.read(readFileSync(join(here, a, file)))
  const y = PNG.sync.read(readFileSync(join(here, b, file)))
  if (x.width !== y.width || x.height !== y.height) {
    console.log(`${file}: tamanho mudou ${x.width}x${x.height} → ${y.width}x${y.height}`)
    continue
  }
  const diff = new PNG({ width: x.width, height: x.height })
  const n = pixelmatch(x.data, y.data, diff.data, x.width, x.height, { threshold: 0 })
  if (n) writeFileSync(join(here, `diff-${file}`), PNG.sync.write(diff))
  console.log(`${file}: ${n} pixels diferentes`)
}
