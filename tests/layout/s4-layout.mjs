// S4: layout das seleções na tela de tags, janela real com a barra de rolagem,
// 320 a 1280: seed + pior caso injetado (30 opções de 30 letras sem espaço).
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME, out } from '../config.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? ` (${detail})` : ''}`)
}
const WIDTHS = [320, 360, 375, 414, 640, 768, 1280]
const selections = await (await fetch(`${API}/selections`)).json()
const tags = await (await fetch(`${API}/tags`)).json()
const option = (i) => ({ id: crypto.randomUUID(), name: `${'x'.repeat(29)}${i % 10}`, position: i + 1, active: true })
const long = (tagId) => ({ id: crypto.randomUUID(), tagId, name: 'y'.repeat(30), multiple: true, active: true,
  options: Array.from({ length: 30 }, (_, i) => option(i)) })
const byName = (name) => tags.find((t) => t.name === name)
// Nível 3 é a linha mais estreita da árvore
const worst = [...selections, long(byName('Desenho').id), long(byName('Perspectiva').id), long(null)]
const opened = [byName('Desenho').id, byName('Fundamentos').id]

let browser
try {
  browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.evaluateOnNewDocument((ids) => localStorage.setItem('studyflow:tags-abertas', JSON.stringify(ids)), opened)
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.method() === 'GET' && req.url() === `${API}/selections`) {
      req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(worst) })
    } else req.continue()
  })
  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 800 })
    await page.goto(`${APP}/tags`, { waitUntil: 'networkidle0' })
    const m = await page.evaluate(() => {
      const useful = document.documentElement.clientWidth
      const rows = [...document.querySelectorAll('p')].filter((p) => p.textContent.startsWith('Seleção:'))
      const general = [...document.querySelectorAll('section[aria-label="Seleções gerais"] li')]
      const all = [...rows, ...general]
      // Pelo texto (Range), não pela caixa: o bloco não cresce quando o texto estoura
      const rects = (el) => {
        const range = document.createRange()
        range.selectNodeContents(el)
        return [...range.getClientRects()]
      }
      const contentRight = (el) => el.getBoundingClientRect().right - parseFloat(getComputedStyle(el).paddingRight)
      const longGeneral = general.find((el) => el.textContent.startsWith('yyy'))
      const wide = Math.max(...rects(longGeneral).map((r) => r.width))
      return {
        useful,
        scroll: document.documentElement.scrollWidth - useful,
        count: all.length,
        leaks: all.filter((el) => Math.max(...rects(el).map((r) => r.right)) > contentRight(el) + 0.5).length,
        longLines: new Set(rects(longGeneral).map((r) => Math.round(r.top))).size,
        wide: Math.round(wide),
        room: Math.round(contentRight(longGeneral) - longGeneral.getBoundingClientRect().left),
        // Pares em sequência no mesmo cartão: a de baixo começa depois da de cima
        overlaps: rows.filter((el, i) => {
          const next = rows[i + 1]
          return next && next.parentElement === el.parentElement &&
            next.getBoundingClientRect().top < el.getBoundingClientRect().bottom - 7
        }).length,
      }
    })
    check(`${width}: sem rolagem lateral`, m.scroll <= 0, `${m.scroll}`)
    check(`${width}: achou todas as linhas`, m.count === selections.filter((s) => s.active).length + 3, `${m.count}`)
    check(`${width}: nenhum texto passa da área da linha`, m.leaks === 0, `${m.leaks}`)
    if (width === 320) {
      check('320: a geral de 30 opções quebra em várias linhas', m.longLines >= 10,
        `${m.longLines} linhas, a maior com ${m.wide}px em ${m.room}px`)
    }
    check(`${width}: linhas sem cobrir umas às outras`, m.overlaps === 0, `${m.overlaps}`)
    if (width === 320 || width === 375) await page.screenshot({ path: out(`s4a-${width}.png`) })
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Nova tag').click())
    await page.waitForSelector('form input')
    const f = await page.evaluate(() => {
      const form = document.querySelector('form')
      const hint = form.querySelector('p')
      return { scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        hint: Boolean(hint), inside: hint && hint.getBoundingClientRect().right <= form.getBoundingClientRect().right }
    })
    check(`${width}: formulário "Nova tag" com o aviso dentro`, f.hint && f.inside && f.scroll <= 0, JSON.stringify(f))
    if (width === 320) await page.screenshot({ path: out('s4a-nova-tag-320.png') })
  }
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser?.close().catch(() => {})
}
console.log(`\n${results.filter(Boolean).length} de ${results.length}`)
process.exitCode = results.every(Boolean) ? 0 : 1
