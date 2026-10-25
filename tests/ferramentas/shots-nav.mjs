// Prints pra comparar a navegação antes × depois da 4ª aba (D4). Celular:
// print da JANELA (a barra de baixo é fixa); desktop: página inteira.
// Uso: node ferramentas/shots-nav.mjs antes|depois (relógio congelado em
// out/clock-nav.txt). Depois: node ferramentas/shots-nav.mjs comparar
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pixelmatch from 'pixelmatch'
import pngjs from 'pngjs'
import puppeteer from 'puppeteer-core'
import { APP, CHROME, OUT } from '../config.mjs'
const { PNG } = pngjs

const label = process.argv[2]
const pages = [['lista', '/'], ['executar', '/executar'], ['historico', '/historico'], ['tags', '/tags']]

if (label === 'comparar') {
  // Celular: diferença só nas linhas da barra de baixo (as últimas `bar` linhas)
  // Desktop: conteúdo abaixo do topo idêntico (antes a partir de 65px, depois de 107)
  const meta = JSON.parse(readFileSync(join(OUT, 'nav-depois', 'meta.json'), 'utf8'))
  for (const file of readdirSync(join(OUT, 'nav-antes')).filter((f) => f.endsWith('.png')).sort()) {
    const a = PNG.sync.read(readFileSync(join(OUT, 'nav-antes', file)))
    const b = PNG.sync.read(readFileSync(join(OUT, 'nav-depois', file)))
    const width = Number(file.match(/-(\d+)\.png$/)[1])
    if (width < 640) {
      const diff = new PNG({ width: a.width, height: a.height })
      pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0 })
      let outside = 0, inside = 0
      const barTop = a.height - meta[file].bar
      for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
        const i = (y * a.width + x) * 4
        if (diff.data[i] === 255 && diff.data[i + 1] === 0 && diff.data[i + 2] === 0) { if (y >= barTop) inside++; else outside++ }
      }
      console.log(`${file}: ${outside} pixels diferentes FORA da barra de baixo (${inside} dentro)`)
    } else {
      const h = Math.min(a.height - 65, b.height - 107)
      const crop = (img, y0) => { const o = new PNG({ width: img.width, height: h }); PNG.bitblt(img, o, 0, y0, img.width, h, 0, 0); return o }
      const ca = crop(a, 65), cb = crop(b, 107)
      const n = pixelmatch(ca.data, cb.data, null, ca.width, h, { threshold: 0 })
      console.log(`${file}: ${n} pixels diferentes abaixo do topo (altura ${a.height} → ${b.height})`)
    }
  }
  process.exit(0)
}

if (!['antes', 'depois'].includes(label)) throw new Error('uso: antes|depois|comparar')
const clockFile = join(OUT, 'clock-nav.txt')
if (!existsSync(clockFile)) writeFileSync(clockFile, String(Date.now()))
const frozen = Number(readFileSync(clockFile, 'utf8'))
const dir = join(OUT, `nav-${label}`)
mkdirSync(dir, { recursive: true })
const meta = {}
const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument((t) => {
    const Real = Date
    globalThis.Date = class extends Real { constructor(...a) { super(...(a.length ? a : [t])) } static now() { return t } }
  }, frozen)
  for (const [name, path] of pages) {
    for (const width of [320, 375, 768, 1280]) {
      await page.setViewport({ width, height: 800 })
      await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
      await new Promise((r) => setTimeout(r, 300))
      const file = `${name}-${width}.png`
      meta[file] = { bar: await page.evaluate(() => Math.ceil(document.querySelector('nav[aria-label="Principal"]').getBoundingClientRect().height) + 1) }
      await page.screenshot({ path: join(dir, file), fullPage: width >= 640 })
    }
  }
} finally {
  await browser.close()
}
writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta))
console.log(`prints em out/nav-${label}/`)
