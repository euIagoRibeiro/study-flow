// Recorta uma faixa de um print. Uso: node ferramentas/crop.mjs <png> <saída> <y> <altura>
import { readFileSync, writeFileSync } from 'node:fs'
import pngjs from 'pngjs'
const { PNG } = pngjs
const [src, dst, y0, h] = process.argv.slice(2)
const img = PNG.sync.read(readFileSync(src))
const out = new PNG({ width: img.width, height: Number(h) })
PNG.bitblt(img, out, 0, Number(y0), img.width, Number(h), 0, 0)
writeFileSync(dst, PNG.sync.write(out))
