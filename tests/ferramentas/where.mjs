// Faixas de linhas (y) onde o diff tem pixel marcado
// Uso: node ferramentas/where.mjs out/diff-historico-375.png
import { readFileSync } from 'node:fs'
import pngjs from 'pngjs'
const { PNG } = pngjs
for (const file of process.argv.slice(2)) {
  const png = PNG.sync.read(readFileSync(file))
  const rows = []
  for (let y = 0; y < png.height; y++) {
    let hit = false
    for (let x = 0; x < png.width && !hit; x++) {
      const i = (y * png.width + x) * 4
      // pixelmatch marca diferença em vermelho puro
      if (png.data[i] === 255 && png.data[i + 1] === 0 && png.data[i + 2] === 0) hit = true
    }
    if (hit) rows.push(y)
  }
  const bands = []
  for (const y of rows) {
    const last = bands[bands.length - 1]
    if (last && y - last[1] <= 2) last[1] = y
    else bands.push([y, y])
  }
  console.log(file, bands.map(([a, b]) => `${a}-${b}`).join(' '))
}
