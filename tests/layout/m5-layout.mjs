// M5: formulários ABERTOS com os campos de medida, de 320 a 1280: Registrar
// (Linguagens, 4 tipos), Finalizar (Linguagens), editar no Histórico e no
// cartão da Lista (1106 trocado pra Linguagens: tipos + aviso). Não salva nada.
import puppeteer from 'puppeteer-core'
import { APP, CHROME, out } from '../config.mjs'

function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    const vw = doc.clientWidth
    const all = [...document.querySelectorAll('body *')]
    const style = (el) => getComputedStyle(el).overflowX
    const scrollers = all.filter((el) => ['auto', 'scroll'].includes(style(el)))
    const inside = (el) => scrollers.some((s) => s !== el && s.contains(el))
    const past = all.filter((el) => !inside(el) && el.getBoundingClientRect().right > vw + 0.5).length
    const bars = scrollers.filter((s) => s.offsetHeight - s.clientHeight > 0).length
    const form = document.querySelector('[data-form="f"]')
    const fr = form.getBoundingClientRect()
    const card = form.closest('article') ?? form.parentElement
    const cr = card.getBoundingClientRect()
    let ring = Infinity
    const els = [...form.querySelectorAll('input, select, button, p, fieldset')]
    for (const el of form.querySelectorAll('input, select, button')) {
      const r = el.getBoundingClientRect()
      ring = Math.min(ring, r.left, vw - r.right)
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (p !== doc && p !== document.body && ["auto", "scroll", "hidden", "clip"].includes(style(p))) {
          const q = p.getBoundingClientRect()
          ring = Math.min(ring, r.left - q.left, q.right - r.right)
        }
      }
    }
    const outOfForm = els.filter((el) => el.getBoundingClientRect().right > fr.right + 0.5).length
    const hasWarning = !!form.querySelector('p[role="status"]')
    const kinds = form.querySelectorAll('fieldset input').length
    return { page: doc.scrollWidth - doc.clientWidth, past, bars, ring: Math.round(ring * 10) / 10, outOfForm, hasWarning, kinds }
  })
}
async function markForm(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-form]').forEach((x) => x.removeAttribute('data-form'))
    ;[...document.querySelectorAll('form')].find((f) =>
      [...f.querySelectorAll('label span')].some((x) => x.textContent.trim() === 'Contexto')).setAttribute('data-form', 'f')
  })
}
async function chooseContext(page, text) {
  const v = await page.evaluate((o) => {
    const lab = [...document.querySelector('[data-form="f"]').querySelectorAll('label')]
      .find((x) => x.querySelector('span')?.textContent.trim() === 'Contexto')
    const sel = lab.querySelector('select')
    sel.setAttribute('data-pick', '1')
    return [...sel.options].find((x) => x.text === o).value
  }, text)
  await page.select('[data-pick="1"]', v)
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  ignoreDefaultArgs: ['--hide-scrollbars'],
})
let bad = 0
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const scenarios = {
    async registrar() {
      await page.goto(`${APP}/executar?tarefa=5eed0000-0000-4000-8000-000000000009`, { waitUntil: 'networkidle0' })
      await markForm(page)
    },
    async finalizar() {
      await page.goto(`${APP}/executar?tarefa=5eed0000-0000-4000-8000-000000000004`, { waitUntil: 'networkidle0' })
      await markForm(page)
    },
    async historico() {
      await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
      await page.evaluate(() => [...document.querySelectorAll('article')].find((x) => x.textContent.includes('Novo protótipo'))
        .querySelector('button[aria-label^="Editar registro"]').click())
      await markForm(page)
    },
    async lista() {
      await page.goto(APP, { waitUntil: 'networkidle0' })
      await page.evaluate(() => {
        const a = [...document.querySelectorAll('article')].find((x) => x.querySelector('h3, h2')?.textContent.includes('Projeto ai-boundaries'))
        a.querySelector('button[aria-haspopup="menu"]').click()
      })
      await page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((b) => b.textContent.trim() === 'Ver histórico').click())
      await page.evaluate(() => [...document.querySelectorAll('article li, article div')].reverse()
        .find((x) => x.textContent.includes('Novo protótipo') && x.querySelector('button[aria-label^="Editar registro"]'))
        .querySelector('button[aria-label^="Editar registro"]').click())
      await markForm(page)
    },
  }
  for (const width of [320, 375, 414, 768, 1024, 1280]) {
    await page.setViewport({ width, height: 900 })
    for (const [name, open] of Object.entries(scenarios)) {
      await open()
      await chooseContext(page, 'Linguagens')
      await new Promise((r) => setTimeout(r, 150))
      const m = await measure(page)
      const needsWarning = name === 'historico' || name === 'lista'
      const fail = m.page > 0 || m.past > 0 || m.bars > 0 || m.outOfForm > 0 || m.ring < 4 || m.kinds !== 4 || m.hasWarning !== needsWarning
      if (fail) bad++
      console.log(`${fail ? 'FALHOU' : 'OK    '} ${name} ${width}px: página +${m.page}px, passa da borda ${m.past}, barras ${m.bars}, ` +
        `fora do formulário ${m.outOfForm}, folga do foco ${m.ring}px, tipos ${m.kinds}, aviso ${m.hasWarning}`)
      if (width === 320) {
        await page.evaluate(() => document.querySelector('[data-form="f"] fieldset').scrollIntoView({ block: 'center' }))
        await page.screenshot({ path: out(`m5-form-${name}-320.png`) })
      }
    }
  }
} finally {
  await browser.close()
}
console.log(`\n${bad === 0 ? 'tudo certo' : `${bad} com problema`}`)
process.exitCode = bad ? 1 : 0
