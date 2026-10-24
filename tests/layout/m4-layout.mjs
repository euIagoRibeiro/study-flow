// M4: formulário de medida ABERTO na raiz (Código, editar) e num neto
// (Código › Pessoal › ai-boundaries, definir), de 320 a 1280. Só lê.
import puppeteer from 'puppeteer-core'
import { APP, CHROME, out } from '../config.mjs'

function measure(page, formLabel) {
  return page.evaluate((fl) => {
    const doc = document.documentElement
    const vw = doc.clientWidth
    const all = [...document.querySelectorAll('body *')]
    const style = (el) => getComputedStyle(el).overflowX
    const scrollers = all.filter((el) => ['auto', 'scroll'].includes(style(el)))
    const inside = (el) => scrollers.some((s) => s !== el && s.contains(el))
    const past = all.filter((el) => !inside(el) && el.getBoundingClientRect().right > vw + 0.5).length
    const form = document.querySelector(`form[aria-label="${fl}"]`)
    let ring = Infinity
    for (const el of form.querySelectorAll('input, button')) {
      const r = el.getBoundingClientRect()
      let room = Math.min(r.left, vw - r.right)
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (p !== doc && p !== document.body && ['auto', 'scroll', 'hidden', 'clip'].includes(style(p))) {
          const c = p.getBoundingClientRect()
          room = Math.min(room, r.left - c.left, c.right - r.right)
        }
      }
      ring = Math.min(ring, room)
    }
    // Algum campo/botão saindo do próprio formulário (o cartão corta)
    const fr = form.getBoundingClientRect()
    const outOfForm = [...form.querySelectorAll('input, button, p')].filter((el) => el.getBoundingClientRect().right > fr.right + 0.5).length
    return { page: doc.scrollWidth - doc.clientWidth, past, ring: Math.round(ring * 10) / 10, outOfForm }
  }, formLabel)
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
    for (const [name, path, item, formLabel] of [
      ['raiz (editar)', 'Código', 'Editar medida', 'Medida de Código'],
      ['neto (definir)', 'Código › Pessoal › ai-boundaries', 'Definir medida', 'Medida de ai-boundaries'],
    ]) {
      await page.goto(`${APP}/tags`, { waitUntil: 'networkidle0' })
      for (const n of ['Código', 'Pessoal']) {
        await page.evaluate((x) => {
          const b = document.querySelector(`button[aria-label="Subtags de ${x}"]`)
          if (b && b.getAttribute('aria-expanded') !== 'true') b.click()
        }, n)
        await new Promise((r) => setTimeout(r, 150))
      }
      await page.evaluate((p) => document.querySelector(`button[aria-haspopup="menu"][aria-label="Mais ações de ${p}"]`).click(), path)
      await page.evaluate((i) => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((b) => b.textContent.trim() === i).click(), item)
      await page.waitForSelector(`form[aria-label="${formLabel}"]`)
      // Definir: dois tipos na lista, como quem está preenchendo
      if (item === 'Definir medida') {
        for (let i = 0; i < 2; i++) {
          await page.evaluate((fl) => [...document.querySelector(`form[aria-label="${fl}"]`).querySelectorAll('button')]
            .find((b) => b.textContent.trim() === 'Tipo').click(), formLabel)
        }
      }
      const m = await measure(page, formLabel)
      const fail = m.page > 0 || m.past > 0 || m.outOfForm > 0 || m.ring < 4
      if (fail) bad++
      console.log(`${fail ? 'FALHOU' : 'OK    '} ${name} ${width}px: página +${m.page}px, passa da borda ${m.past}, ` +
        `fora do formulário ${m.outOfForm}, folga do foco ${m.ring}px`)
      if (width === 320) {
        await page.evaluate((fl) => document.querySelector(`form[aria-label="${fl}"]`).scrollIntoView({ block: 'start' }), formLabel)
        await page.screenshot({ path: out(`m4-form-${item === 'Definir medida' ? 'neto' : 'raiz'}-320.png`) })
      }
    }
  }
} finally {
  await browser.close()
}
console.log(`\n${bad === 0 ? 'tudo certo' : `${bad} com problema`}`)
process.exitCode = bad ? 1 : 0
