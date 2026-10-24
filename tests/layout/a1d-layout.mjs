// A1d: Registrar e editar ABERTOS, com "Quando" e "Duração", de 320 a 1280.
// Rolagem lateral, algo passando da borda, folga do anel de foco (4px)
// dos campos novos dentro de quem corta. Só lê: não grava nada.
import puppeteer from 'puppeteer-core'
import { APP, CHROME } from '../config.mjs'

const FIELDS = ['Quando', 'Duração estimada (min, opcional)']

function measure(page) {
  return page.evaluate((fields) => {
    const doc = document.documentElement
    const vw = doc.clientWidth
    const all = [...document.querySelectorAll('body *')]
    const style = (el) => getComputedStyle(el).overflowX
    const scrollers = all.filter((el) => ['auto', 'scroll'].includes(style(el)))
    const inside = (el) => scrollers.some((s) => s !== el && s.contains(el))
    const past = all.filter((el) => !inside(el) && el.getBoundingClientRect().right > vw + 0.5).length
    let ring = Infinity
    let found = 0
    for (const l of document.querySelectorAll('label')) {
      if (!fields.includes(l.querySelector('span')?.textContent.trim())) continue
      const input = l.querySelector('input')
      found++
      const r = input.getBoundingClientRect()
      let room = Math.min(r.left, vw - r.right)
      for (let p = input.parentElement; p; p = p.parentElement) {
        if (p !== doc && p !== document.body && ['auto', 'scroll', 'hidden', 'clip'].includes(style(p))) {
          const c = p.getBoundingClientRect()
          room = Math.min(room, r.left - c.left, c.right - r.right)
        }
      }
      ring = Math.min(ring, room)
    }
    return { page: doc.scrollWidth - doc.clientWidth, past, found, ring: Math.round(ring * 10) / 10 }
  }, FIELDS)
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
    await page.goto(`${APP}/executar?tarefa=5eed0000-0000-4000-8000-000000000005`, { waitUntil: 'networkidle0' })
    cases.push(['registrar', await measure(page), 2])
    for (const description of ['Gameplay em inglês (listening)', 'Window functions']) {
      await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
      await page.evaluate((d) => {
        const a = [...document.querySelectorAll('article')].find((x) => x.textContent.includes(d))
        a.querySelector('button[aria-label^="Editar registro"]').click()
        a.scrollIntoView({ block: 'center' })
      }, description)
      await page.waitForFunction(() => [...document.querySelectorAll('article form label span')]
        .some((s) => s.textContent.trim() === 'Quando'))
      cases.push([`editar "${description.slice(0, 16)}…"`, await measure(page), 2])
    }
    for (const [name, m, expected] of cases) {
      const fail = m.page > 0 || m.past > 0 || m.found !== expected || m.ring < 4
      if (fail) bad++
      console.log(`${fail ? 'FALHOU' : 'OK    '} ${name} ${width}px: página +${m.page}px, passa da borda ${m.past}, ` +
        `campos novos ${m.found}, folga do foco ${m.ring}px`)
    }
  }
} finally {
  await browser.close()
}
console.log(`\n${bad === 0 ? 'tudo certo' : `${bad} com problema`}`)
process.exitCode = bad ? 1 : 0
