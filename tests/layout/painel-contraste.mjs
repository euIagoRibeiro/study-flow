// D4: contraste das cores do Painel MEDIDO NO PIXEL, claro e escuro. Fatias
// (no centro de cada uma, longe das bordas e do fio), bolinhas da legenda,
// barras: ≥ 3:1 contra o fundo de verdade (página ou cartão do detalhe).
// Texto dos gráficos (% e valores, dias): ≥ 4,5:1, pelo pixel mais forte do
// glifo. Confere também que o pixel lido É a cor do token (não mediu o
// lugar errado). Semana passada com o detalhe de Código (6 contextos: a
// fatia cinza de "outros" entra). D7c: "Comparar tags" com 5 escolhidas (as 5
// cores): barras contra o fundo, bolinha do chip contra o fundo DO CHIP,
// texto do chip, bolinhas da tabela. Barras e chips são HTML: print da
// janela + coordenadas da tela (o print por elemento da seção saiu cortado).
import puppeteer from 'puppeteer-core'
import pngjs from 'pngjs'
import { API, APP, CHROME } from '../config.mjs'
const { PNG } = pngjs

let ok = 0, bad = 0
const check = (cond, msg) => { cond ? ok++ : bad++; if (!cond) console.log('FALHOU', msg) }
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const rgbOf = (css) => css.match(/\d+/g).slice(0, 3).map(Number)
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 3)

const tags = await (await fetch(`${API}/tags`)).json()
const codigo = tags.find((t) => t.name === 'Código' && t.level === 1).id
const byId = new Map(tags.map((t) => [t.id, t]))
const pathOf = (t) => (t.parentId ? `${pathOf(byId.get(t.parentId))} › ${t.name}` : t.name)
const idOf = (path) => tags.find((t) => pathOf(t) === path).id
const five = ['Vestibular › Matemática › Álgebra', 'Matemática › Álgebra', 'Vestibular', 'Código › Empresa › equipamentos-medicos', 'Linguagens'].map(idOf)
const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 7)
const ymd = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`

const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  const page = await browser.newPage()
  await page.emulateTimezone('America/Sao_Paulo')
  await page.setViewport({ width: 375, height: 900, deviceScaleFactor: 1 })
  for (const theme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }])
    await page.goto(`${APP}/painel?periodo=semana&inicio=${ymd}&contexto=${codigo}`, { waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 400))
    const palette = await page.evaluate(() => {
      const probe = document.createElement('span'); document.body.append(probe)
      const o = ['1', '2', '3', '4', '5', 'outros'].map((n) => { probe.style.color = `var(--categoria-${n})`; return getComputedStyle(probe).color })
      probe.remove(); return o
    })
    const tokens = palette.map(rgbOf)
    let slicesMeasured = 0, textsMeasured = 0, dotsMeasured = 0, barsMeasured = 0
    const lowest = { fatia: Infinity, barra: Infinity, texto: Infinity, bolinha: Infinity }
    // Cada gráfico: pixel de cada fatia/barra e de cada texto, contra o fundo dele
    const charts = await page.$$('svg[role="img"]')
    for (const svg of charts) {
      await svg.evaluate((s) => s.scrollIntoView({ block: 'center' }))
      const geo = await svg.evaluate((s) => {
        const vb = s.viewBox.baseVal
        const box = s.getBoundingClientRect()
        const k = box.width / vb.width
        // Ponto DENTRO de cada forma, longe da borda: pizza = ponto interno do
        // caminho mais longe do contorno (amostragem); barra = centro do rect
        const shapes = [...s.querySelectorAll('path, rect')].map((el) => {
          const fill = getComputedStyle(el).fill
          if (el.tagName === 'rect') {
            const b = el.getBBox()
            return b.height < 6 ? null : { fill, x: (b.x + b.width / 2) * k, y: (b.y + b.height / 2) * k }
          }
          const pt = s.createSVGPoint(); let best = null
          for (let x = 0; x < vb.width; x += 3) for (let y = 0; y < vb.height; y += 3) {
            pt.x = x; pt.y = y
            if (!el.isPointInFill(pt)) continue
            // distância até fora (raio crescente nas 8 direções)
            let d = 0
            for (; d < 40; d += 1) {
              const out = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]].some(([dx, dy]) => { pt.x = x + dx * d; pt.y = y + dy * d; return !el.isPointInFill(pt) })
              if (out) break
            }
            pt.x = x; pt.y = y
            if (!best || d > best.d) best = { d, x, y }
          }
          return best && best.d >= 4 ? { fill, x: best.x * k, y: best.y * k } : null
        }).filter(Boolean)
        const texts = [...s.querySelectorAll('text')].map((t) => { const b = t.getBBox(); return { text: t.textContent, x: b.x * k, y: b.y * k, w: b.width * k, h: b.height * k } })
        return { label: s.getAttribute('aria-label').slice(0, 24), shapes, texts, w: box.width, h: box.height }
      })
      const png = PNG.sync.read(await svg.screenshot())
      const px = (x, y) => { const i = (Math.round(y) * png.width + Math.round(x)) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]] }
      const bg = px(2, 2) // canto do SVG: o fundo de verdade atrás dele
      for (const sh of geo.shapes) {
        const c = px(sh.x, sh.y)
        const expected = rgbOf(sh.fill)
        check(near(c, expected), `${theme} ${geo.label}: o pixel ${c} não é a cor da forma ${expected}`)
        const cr = contrast(c, bg)
        check(cr >= 3, `${theme} ${geo.label}: forma ${c} sobre ${bg} = ${cr.toFixed(2)} (< 3)`)
        if (geo.label.startsWith('Pizza')) { slicesMeasured++; lowest.fatia = Math.min(lowest.fatia, cr) } else { barsMeasured++; lowest.barra = Math.min(lowest.barra, cr) }
      }
      for (const t of geo.texts) {
        let best = 1
        for (let x = Math.floor(t.x); x < t.x + t.w; x++) for (let y = Math.floor(t.y); y < t.y + t.h; y++) best = Math.max(best, contrast(px(x, y), bg))
        check(best >= 4.5, `${theme} ${geo.label}: texto "${t.text}" = ${best.toFixed(2)} (< 4,5)`)
        textsMeasured++
        lowest.texto = Math.min(lowest.texto, best)
      }
    }
    // Bolinhas da legenda: print do elemento que tem a bolinha e o nome (a
    // bolinha à esquerda; 4px depois dela, o vão até o texto = o fundo)
    const dots = await page.$$('section[aria-label="Tempo"] td span[aria-hidden="true"]')
    for (const dot of dots) {
      await dot.evaluate((d) => d.scrollIntoView({ block: 'center' }))
      const geo = await dot.evaluate((d) => {
        const p = d.parentElement.getBoundingClientRect(), r = d.getBoundingClientRect()
        return { cx: r.left - p.left + r.width / 2, cy: r.top - p.top + r.height / 2, gap: r.right - p.left + 4 }
      })
      const holder = await dot.evaluateHandle((d) => d.parentElement)
      const shot = PNG.sync.read(await holder.asElement().screenshot())
      const at = (x, y) => { const i = (Math.round(y) * shot.width + Math.round(x)) * 4; return [shot.data[i], shot.data[i + 1], shot.data[i + 2]] }
      const c = at(geo.cx, geo.cy)
      const bg = at(geo.gap, geo.cy)
      check(tokens.some((t) => near(t, c)), `${theme} bolinha: pixel ${c} não é uma cor da paleta`)
      check(contrast(c, bg) >= 3, `${theme} bolinha ${c} sobre ${bg} = ${contrast(c, bg).toFixed(2)}`)
      dotsMeasured++
      lowest.bolinha = Math.min(lowest.bolinha, contrast(c, bg))
    }
    const pies = (await Promise.all(charts.map((c) => c.evaluate((s) => s.getAttribute('aria-label'))))).filter((l) => l.startsWith('Pizza')).length
    check(pies === 2 && slicesMeasured >= 7, `${theme}: mediu ${slicesMeasured} fatias em ${pies} pizzas (esperado: as 6 do contexto + as do detalhe)`)
    check(barsMeasured >= 3 && textsMeasured >= 10 && dotsMeasured >= 7, `${theme}: mediu ${barsMeasured} barras, ${textsMeasured} textos, ${dotsMeasured} bolinhas`)
    console.log(`${theme}: ${slicesMeasured} fatias, ${barsMeasured} barras, ${textsMeasured} textos, ${dotsMeasured} bolinhas medidos; menor contraste: ${Object.entries(lowest).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}`)

    // ---- Comparar tags (D7c): as 5 cores
    await page.goto(`${APP}/painel?periodo=ano&inicio=${new Date().getFullYear()}-01-01&tags=${five.join(',')}`, { waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 400))
    const low = { barra: Infinity, chip: Infinity, textoChip: Infinity, bolinhaTabela: Infinity }
    let measured = { barras: 0, chips: 0, textos: 0, tabela: 0 }
    // Cada item: rola pro centro, print da JANELA, e lê pelas coordenadas da tela
    const shot = async (selector, index) => {
      await page.evaluate((sel, i) => document.querySelectorAll(sel)[i].scrollIntoView({ block: 'center' }), selector, index)
      await new Promise((r) => setTimeout(r, 100))
      const png = PNG.sync.read(await page.screenshot())
      return (x, y) => { const i = (Math.round(y) * png.width + Math.round(x)) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]] }
    }
    const BAR = 'section[aria-label="Comparar tags"] [role="img"] > div'
    for (let i = 0; i < 5; i++) {
      const at = await shot(BAR, i)
      const g = await page.evaluate((sel, i) => {
        const row = document.querySelectorAll(sel)[i]
        const fill = row.querySelector('[style]').getBoundingClientRect(), value = row.lastElementChild.lastElementChild.getBoundingClientRect()
        return { x: fill.left + Math.min(fill.width / 2, 20), y: fill.top + fill.height / 2, bgX: value.left - 3, w: fill.width }
      }, BAR, i)
      if (g.w < 4) continue // barra curta demais pra ler o meio (o tempo pequeno)
      const c = at(g.x, g.y), bg = at(g.bgX, g.y)
      check(near(c, tokens[i]), `${theme} barra ${i + 1}: pixel ${c} não é --categoria-${i + 1} ${tokens[i]}`)
      check(contrast(c, bg) >= 3, `${theme} barra ${i + 1}: ${c} sobre ${bg} = ${contrast(c, bg).toFixed(2)} (< 3)`)
      low.barra = Math.min(low.barra, contrast(c, bg)); measured.barras++
    }
    const CHIP = 'section[aria-label="Comparar tags"] ul[aria-label="Tags escolhidas"] li'
    for (let i = 0; i < 5; i++) {
      const at = await shot(CHIP, i)
      const g = await page.evaluate((sel, i) => {
        const li = document.querySelectorAll(sel)[i]
        const dot = li.querySelector('span[aria-hidden="true"]').getBoundingClientRect()
        const text = li.querySelector('span:not([aria-hidden])').getBoundingClientRect()
        return { dx: dot.left + dot.width / 2, dy: dot.top + dot.height / 2, bgX: dot.right + 3, text: { x: text.left, y: text.top, w: text.width, h: text.height } }
      }, CHIP, i)
      const c = at(g.dx, g.dy), bg = at(g.bgX, g.dy)
      check(near(c, tokens[i]), `${theme} bolinha do chip ${i + 1}: pixel ${c} não é --categoria-${i + 1}`)
      check(contrast(c, bg) >= 3, `${theme} bolinha do chip ${i + 1}: ${c} sobre o chip ${bg} = ${contrast(c, bg).toFixed(2)} (< 3)`)
      low.chip = Math.min(low.chip, contrast(c, bg)); measured.chips++
      let best = 1
      for (let x = Math.floor(g.text.x); x < g.text.x + g.text.w; x++) for (let y = Math.floor(g.text.y); y < g.text.y + g.text.h; y++) best = Math.max(best, contrast(at(x, y), bg))
      check(best >= 4.5, `${theme} texto do chip ${i + 1}: ${best.toFixed(2)} (< 4,5)`)
      low.textoChip = Math.min(low.textoChip, best); measured.textos++
    }
    const TDOT = 'section[aria-label="Comparar tags"] td span[aria-hidden="true"]'
    for (let i = 0; i < 5; i++) {
      const at = await shot(TDOT, i)
      const g = await page.evaluate((sel, i) => { const r = document.querySelectorAll(sel)[i].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, bgX: r.right + 3 } }, TDOT, i)
      const c = at(g.x, g.y), bg = at(g.bgX, g.y)
      check(near(c, tokens[i]), `${theme} bolinha da tabela ${i + 1}: pixel ${c} não é --categoria-${i + 1}`)
      check(contrast(c, bg) >= 3, `${theme} bolinha da tabela ${i + 1}: ${contrast(c, bg).toFixed(2)} (< 3)`)
      low.bolinhaTabela = Math.min(low.bolinhaTabela, contrast(c, bg)); measured.tabela++
    }
    check(measured.barras >= 4 && measured.chips === 5 && measured.textos === 5 && measured.tabela === 5, `${theme}: comparar tags mediu ${JSON.stringify(measured)}`)
    console.log(`${theme} comparar tags: ${JSON.stringify(measured)}; menor contraste: ${Object.entries(low).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}`)
  }
} catch (err) {
  check(false, `erro: ${err.message}`)
} finally {
  await browser.close()
  console.log(`${ok} de ${ok + bad}`)
  process.exitCode = bad === 0 && ok > 0 ? 0 : 1
}
