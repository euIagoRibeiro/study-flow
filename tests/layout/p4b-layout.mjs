// P4b: os 3 formulários ABERTOS com o campo de fase, de 320 a 1280.
// Rolagem lateral (página e roláveis), algo passando da borda e a folga
// do anel de foco (4px) do campo Fase dentro de quem corta (overflow).
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME, out } from '../config.mjs'

const BOOK = '5eed0000-0000-4000-8000-000000000401'
const CODIGO = '5eed0000-0000-4000-9000-000000000400'
const EQUIP = '5eed0000-0000-4000-9000-000000000421'
async function waitForApi() {
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(`${API}/tasks`)).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('API não respondeu')
}
async function putBook(body) {
  await waitForApi()
  await fetch(`${API}/executions/${BOOK}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

async function choose(page, label, text) {
  const value = await page.evaluate((l, t) => {
    const lab = [...document.querySelectorAll('label')].find(
      (x) => x.querySelector('span')?.textContent.trim() === l && x.querySelector('select'))
    const sel = lab.querySelector('select')
    document.querySelectorAll('[data-pick]').forEach((x) => x.removeAttribute('data-pick'))
    sel.setAttribute('data-pick', '1')
    return [...sel.options].find((o) => o.text === t).value
  }, label, text)
  await page.select('[data-pick="1"]', value)
}

function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    const vw = doc.clientWidth
    const all = [...document.querySelectorAll('body *')]
    const clips = (el) => ['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(el).overflowX)
    const scrollers = all.filter((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX))
    const inside = (el) => scrollers.some((s) => s !== el && s.contains(el))
    const past = all.filter((el) => !inside(el) && el.getBoundingClientRect().right > vw + 0.5)
    const lab = [...document.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent.trim() === 'Fase')
    const sel = lab?.querySelector('select')
    let ring = null
    if (sel) {
      const r = sel.getBoundingClientRect()
      let room = Math.min(r.left, vw - r.right)
      for (let p = sel.parentElement; p; p = p.parentElement) {
        if (p !== doc && p !== document.body && clips(p)) {
          const c = p.getBoundingClientRect()
          room = Math.min(room, r.left - c.left, c.right - r.right)
        }
      }
      ring = Math.round(room * 10) / 10
    }
    return {
      page: doc.scrollWidth - doc.clientWidth,
      scrollers: scrollers.filter((s) => s.scrollWidth > s.clientWidth && s.offsetHeight - s.clientHeight > 0).length,
      past: past.length,
      ring,
    }
  })
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  ignoreDefaultArgs: ['--hide-scrollbars'],
})
let bad = 0
try {
  const page = await browser.newPage()
  for (const width of [320, 375, 414, 768, 1024, 1280]) {
    await page.setViewport({ width, height: 900 })
    const cases = []

    await waitForApi()
    await page.goto(`${APP}/executar?tarefa=5eed0000-0000-4000-8000-000000000011`, { waitUntil: 'networkidle0' })
    await choose(page, 'Em Código', 'Pessoal')
    await choose(page, 'Em Código › Pessoal', 'ai-boundaries')
    cases.push(['registrar', await measure(page)])
    if (width === 320) await page.screenshot({ path: out('p4b-registrar-320.png'), fullPage: true })

    await putBook({ description: null, completedAt: null, rootTagId: CODIGO, tagIds: [EQUIP], phase: 'implementacao' })
    await page.goto(`${APP}/executar?tarefa=5eed0000-0000-4000-8000-000000000004`, { waitUntil: 'networkidle0' })
    cases.push(['finalizar', await measure(page)])
    await putBook({ description: null, completedAt: null, rootTagId: null, tagIds: [], phase: null })

    await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('article')].find((a) => a.textContent.includes('Integração com o sensor'))
      card.querySelector('button[aria-label^="Editar registro"]').click()
      card.scrollIntoView({ block: 'center' })
    })
    await page.waitForFunction(() => [...document.querySelectorAll('label span')].some((s) => s.textContent.trim() === 'Fase'))
    cases.push(['editar', await measure(page)])
    if (width === 320) await page.screenshot({ path: out('p4b-editar-320.png') })

    for (const [name, m] of cases) {
      const fail = m.page > 0 || m.past > 0 || m.scrollers > 0 || m.ring === null || m.ring < 4
      if (fail) bad++
      console.log(`${fail ? 'FALHOU' : 'OK    '} ${name} ${width}px: página +${m.page}px, passa da borda ${m.past}, ` +
        `rolável com barra ${m.scrollers}, folga do foco no campo Fase ${m.ring}px`)
    }
  }
} finally {
  await putBook({ description: null, completedAt: null, rootTagId: null, tagIds: [], phase: null })
  await browser.close()
}
console.log(`\n${bad === 0 ? 'tudo certo' : `${bad} com problema`}`)
process.exitCode = bad ? 1 : 0
