// Fix do chip "Fases": em cada linha da árvore de tags, a seta fica dentro
// do botão do nome, nenhum chip encosta no nome/seta (folga >= 8px na mesma
// linha) e nada passa da borda da linha. Com o seed e com 2 contextos de
// nome longo injetados na resposta da API (nada no banco).
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME, OUT } from '../config.mjs'

const LONG = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Desenvolvimento de software profissional', parentId: null, level: 1, active: true, tracksPhase: true },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'filho', parentId: 'aaaaaaaa-0000-4000-8000-000000000001', level: 2, active: true, tracksPhase: false },
  { id: 'aaaaaaaa-0000-4000-8000-000000000003', name: 'Paralelepipedalmente', parentId: null, level: 1, active: true, tracksPhase: true },
  { id: 'aaaaaaaa-0000-4000-8000-000000000004', name: 'filho', parentId: 'aaaaaaaa-0000-4000-8000-000000000003', level: 2, active: true, tracksPhase: false },
]
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? ` (${detail})` : ''}`)
}

function inspect(page) {
  return page.evaluate(() => {
    const problems = []
    const longBreaks = []
    let rows = 0
    let wrapped = 0
    const seen = new Set()
    for (const li of document.querySelectorAll('li')) {
      const row = li.firstElementChild
      // Só a árvore de tags: a seção Exercícios (A3d) tem linhas parecidas
      if (li.closest('section[aria-label="Exercícios"]')) continue
      if (!row || row.tagName !== 'DIV' || seen.has(row) || !row.querySelector('button[aria-label^="Mais ações de"]')) continue
      seen.add(row)
      rows++
      const btn = row.querySelector('button[aria-label^="Subtags de"]')
      const nameEl = btn ?? row.querySelector('span')
      const label = nameEl.textContent.trim()
      const rr = row.getBoundingClientRect()
      const nr = nameEl.getBoundingClientRect()
      // Seta e texto dentro do botão
      if (btn) {
        const svg = btn.querySelector('svg').getBoundingClientRect()
        if (svg.right > nr.right + 0.5) problems.push(`${label}: seta ${(svg.right - nr.right).toFixed(1)}px fora do botão`)
        const range = document.createRange()
        range.selectNodeContents(btn)
        for (const r of range.getClientRects()) {
          if (r.width > 0 && r.right > nr.right + 0.5) { problems.push(`${label}: texto vaza do botão`); break }
        }
      }
      // O que o nome ocupa de verdade (texto + seta), não só a caixa
      const range = document.createRange()
      range.selectNodeContents(nameEl)
      const pieces = [...range.getClientRects()].filter((r) => r.width > 0)
      for (const chip of row.querySelectorAll('span.rounded-full')) {
        const c = chip.getBoundingClientRect()
        for (const p of pieces) {
          const sameLine = c.top < p.bottom && p.top < c.bottom
          if (sameLine && c.left - p.right < 8 && c.right > p.left) {
            problems.push(`${label}: chip "${chip.textContent.trim()}" a ${(c.left - p.right).toFixed(1)}px do nome`)
          }
        }
        if (c.top >= nr.bottom - 0.5) wrapped++
      }
      // Palavra quebrada no meio (só falha em palavra curta, até 10 letras)
      const text = nameEl.firstChild?.nodeType === 3 ? nameEl.firstChild : (nameEl.querySelector('span') ?? nameEl).firstChild
      if (text) {
        let i = 0
        for (const word of text.textContent.split(/([ -])/)) {
          if (word.trim().length > 1) {
            const w = document.createRange()
            w.setStart(text, i)
            w.setEnd(text, i + word.length)
            const tops = new Set([...w.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)))
            if (tops.size > 1) (word.length <= 10 ? problems : longBreaks).push(`${label}: "${word}" quebrada no meio`)
          }
          i += word.length
        }
      }
      // O que desceu não encosta na linha "Medida" logo abaixo
      const below = row.nextElementSibling
      if (below?.tagName === 'P' && below.textContent.startsWith('Medida')) {
        const clusterBottom = Math.max(...[...row.querySelectorAll('span.rounded-full, span.tabular-nums')].map((e) => e.getBoundingClientRect().bottom))
        const gap = below.getBoundingClientRect().top - clusterBottom
        if (gap < 4) problems.push(`${label}: ${gap.toFixed(1)}px até a linha Medida`)
      }
      for (const el of row.querySelectorAll('*')) {
        if (el.getBoundingClientRect().right > rr.right + 0.5) { problems.push(`${label}: ${el.tagName} passa da linha`); break }
      }
    }
    const doc = document.documentElement
    return { rows, wrapped, problems, longBreaks, pageScroll: doc.scrollWidth - doc.clientWidth }
  })
}
async function expandAll(page) {
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => document.querySelectorAll('button[aria-expanded="false"][aria-label^="Subtags de"]').forEach((b) => b.click()))
    await new Promise((r) => setTimeout(r, 150))
  }
}

const realTags = await (await fetch(`${API}/tags`)).json()
const browser = await puppeteer.launch({
  executablePath: CHROME,
  ignoreDefaultArgs: ['--hide-scrollbars'],
})
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  let inject = false
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (inject && req.method() === 'GET' && req.url() === `${API}/tags`) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify([...realTags, ...LONG]),
      })
    } else req.continue()
  })
  for (const scenario of ['seed', 'nomes longos']) {
    inject = scenario === 'nomes longos'
    for (const width of [320, 375, 414, 768, 1024, 1280]) {
      await page.setViewport({ width, height: 900 })
      await page.goto(`${APP}/tags`, { waitUntil: 'networkidle0' })
      await expandAll(page)
      const m = await inspect(page)
      check(`${scenario} ${width}px: ${m.rows} linhas, ${m.wrapped} chip(s) na linha de baixo${m.longBreaks.length ? '; palavra longa quebrada (aceito): ' + m.longBreaks.map((x) => x.split('"')[1]).join(', ') : ''}`,
        m.rows === (scenario === 'seed' ? 21 : 25) && m.problems.length === 0 && m.pageScroll === 0, [...m.problems, m.pageScroll ? `página +${m.pageScroll}px` : ''].filter(Boolean).join('; '))
      if (width === 320) await page.screenshot({ path: `${OUT}/chip-tags-${scenario === 'seed' ? 'seed' : 'longos'}-320.png`, fullPage: true })
    }
  }
} finally {
  await browser.close()
}
const ok = results.filter(Boolean).length
console.log(`\n${ok} de ${results.length}`)
process.exitCode = ok === results.length ? 0 : 1
