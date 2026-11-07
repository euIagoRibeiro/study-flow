// Duração estimada com o eco embaixo do campo: Registrar, lápis no Histórico e
// lápis no cartão da Lista, de 320 a 1280 (janela real, barra de rolagem
// visível). Dois estados: vazio (a dica) e o eco mais longo ("= 23 h 59 min
// 59 s"). Sem rolagem lateral, nada além da borda, o texto da linha dentro do
// formulário e logo abaixo do campo, folga do anel de foco. Só lê: digita no
// campo, nunca salva (nenhum pedido de escrita).
// Uso (raiz do repo): node --env-file=backend/.env tests/layout/estimativa-layout.mjs
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME } from '../config.mjs'

const LABEL = 'Duração estimada (opcional)'
const FINANCAS = '5eed0000-0000-4000-8000-000000000005'
const E1301 = '5eed0000-0000-4000-8000-000000001301'
const STATES = { vazio: ['', 'Minutos, ou min:s'], longo: ['23:59:59', '= 23 h 59 min 59 s'] }
const WIDTHS = [320, 360, 375, 414, 768, 1024, 1280]
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  if (!ok) console.log(`FALHOU ${name} (${detail})`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

const record = (await (await fetch(`${API}/executions`)).json()).find((e) => e.id === E1301)
const task = (await (await fetch(`${API}/tasks`)).json()).find((t) => t.id === record.taskId)
const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
const writes = []
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  page.on('request', (req) => {
    if (!['GET', 'OPTIONS'].includes(req.method())) writes.push(`${req.method()} ${req.url()}`)
  })
  const clean = async (path) => {
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => sessionStorage.clear())
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
  }
  const pencil = async () => {
    const done = await page.evaluate((d) => {
      const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === d))
      const b = a?.querySelector('button[aria-label^="Editar registro"]')
      b?.click()
      return Boolean(b)
    }, record.description)
    if (!done) throw new Error('lápis do 1301 não achado')
    await page.waitForFunction((l) => [...document.querySelectorAll('article form label span')].some((s) => s.textContent.trim() === l), {}, LABEL)
  }
  const places = {
    registrar: () => clean(`/executar?tarefa=${FINANCAS}`),
    historico: async () => { await clean('/historico'); await pencil() },
    lista: async () => {
      await clean('/')
      await page.evaluate((t) => document.querySelector(`button[aria-label="Mais ações de ${t}"]`).click(), task.title)
      await pause(150)
      await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Ver histórico').click())
      await pause(300)
      await pencil()
    },
  }
  let measured = 0
  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 900 })
    for (const [place, enter] of Object.entries(places)) {
      for (const [state, [text, expected]] of Object.entries(STATES)) {
        await enter()
        const handle = await page.evaluateHandle((l) => [...document.querySelectorAll('main label')]
          .find((x) => x.querySelector('span')?.textContent.trim() === l)?.querySelector('input') ?? null, LABEL)
        const input = handle.asElement()
        if (!input) { check(`${place} ${width}px ${state}: campo achado`, false, 'sem campo'); continue }
        await input.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.focus(); el.select() })
        await page.keyboard.press('Backspace')
        if (text) await input.type(text)
        await pause(150)
        const m = await input.evaluate((el) => {
          const doc = document.documentElement
          const vw = doc.clientWidth
          const style = (x) => getComputedStyle(x).overflowX
          const all = [...document.querySelectorAll('body *')]
          const scrollers = all.filter((x) => ['auto', 'scroll'].includes(style(x)))
          const inside = (x) => scrollers.some((s) => s !== x && s.contains(x))
          const past = all.filter((x) => !inside(x) && x.getBoundingClientRect().right > vw + 0.5).length
          const label = el.closest('label')
          const note = label.querySelector('[data-estimate-note]')
          const form = el.closest('form')
          const fr = form.getBoundingClientRect()
          const pad = parseFloat(getComputedStyle(form).paddingRight) || 0
          const r = el.getBoundingClientRect()
          const range = document.createRange()
          range.selectNodeContents(note)
          const rects = [...range.getClientRects()]
          const textRight = Math.max(...rects.map((x) => x.right))
          const textLeft = Math.min(...rects.map((x) => x.left))
          const textTop = Math.min(...rects.map((x) => x.top))
          let ring = Math.min(r.left, vw - r.right)
          for (let p = el.parentElement; p; p = p.parentElement) {
            if (p !== doc && p !== document.body && ['auto', 'scroll', 'hidden', 'clip'].includes(style(p))) {
              const c = p.getBoundingClientRect()
              ring = Math.min(ring, r.left - c.left, c.right - r.right)
            }
          }
          return {
            page: doc.scrollWidth - doc.clientWidth, past, note: note.textContent, lines: rects.length,
            gap: Math.round((textTop - r.bottom) * 10) / 10, out: Math.round((textRight - (fr.right - pad)) * 10) / 10,
            left: Math.round((textLeft - r.left) * 10) / 10, ring: Math.round(ring * 10) / 10,
          }
        })
        measured++
        const tag = `${place} ${width}px ${state}`
        check(`${tag}: sem rolagem lateral`, m.page <= 0, `+${m.page}px`)
        check(`${tag}: nada passa da borda`, m.past === 0, `${m.past}`)
        check(`${tag}: a linha diz "${expected}"`, m.note === expected, m.note)
        check(`${tag}: a linha logo abaixo do campo (0 a 12px)`, m.gap >= 0 && m.gap <= 12, `${m.gap}px`)
        check(`${tag}: o texto dentro do formulário e alinhado ao campo`, m.out <= 0.5 && Math.abs(m.left) <= 0.5, `${m.out}px fora, ${m.left}px de recuo`)
        check(`${tag}: o texto numa linha só`, m.lines === 1, `${m.lines} linhas`)
        check(`${tag}: folga do anel de foco ≥ 4px`, m.ring >= 4, `${m.ring}px`)
      }
    }
  }
  check(`casos medidos: ${measured} de ${WIDTHS.length * 3 * 2}`, measured === WIDTHS.length * 3 * 2, `${measured}`)
  check('nenhum pedido de escrita', writes.length === 0, writes.join(', '))
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser.close()
}
const ok = results.filter(Boolean).length
console.log(`\n${ok} de ${results.length}`)
process.exitCode = ok === results.length ? 0 : 1
