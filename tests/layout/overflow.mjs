// P3: a tela atual (sem o P4) com o seed novo. Rolagem lateral de 320 a 1280.

import puppeteer from 'puppeteer-core'
import { APP, CHROME, out } from '../config.mjs'

const CODIGO = '5eed0000-0000-4000-9000-000000000400'
const PROGRAMAR = '5eed0000-0000-4000-8000-000000000012'
const pages = [
  ['lista', '/'],
  ['lista-codigo', `/?contexto=${CODIGO}`],
  ['historico', '/historico'],
  ['tags', '/tags'],
  ['executar-programar', `/executar?tarefa=${PROGRAMAR}`],
]
const widths = [320, 375, 414, 768, 1024, 1280]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  ignoreDefaultArgs: ['--hide-scrollbars'],
})
let failures = 0
try {
  const page = await browser.newPage()
  for (const [name, path] of pages) {
    for (const width of widths) {
      await page.setViewport({ width, height: 800 })
      await page.goto(APP + path, { waitUntil: 'networkidle0' })
      const m = await page.evaluate(() => {
        const doc = document.documentElement
        const vw = doc.clientWidth
        const scrollers = [...document.querySelectorAll('*')].filter((el) =>
          ['auto', 'scroll'].includes(getComputedStyle(el).overflowX),
        )
        const insideScroller = (el) => scrollers.some((s) => s !== el && s.contains(el))
        const past = [...document.querySelectorAll('body *')]
          .filter((el) => !insideScroller(el) && el.getBoundingClientRect().right > vw + 0.5)
          .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}"`)
        return {
          page: doc.scrollWidth - doc.clientWidth,
          scrollers: scrollers.map((s) => ({
            text: (s.textContent ?? '').trim().slice(0, 30),
            over: s.scrollWidth - s.clientWidth,
            bar: s.offsetHeight - s.clientHeight,
          })),
          past: past.slice(0, 3),
          codigo: document.body.innerText.includes('Código'),
        }
      })
      const bad = m.page > 0 || m.past.length > 0
      if (bad) failures++
      const sc = m.scrollers.map((s) => `[${s.text}: +${s.over}px, barra ${s.bar}]`).join(' ')
      console.log(`${bad ? 'FALHOU' : 'OK    '} ${name} ${width}px: página +${m.page}px` +
        `${m.past.length ? `, passa da borda: ${m.past.join('; ')}` : ''}` +
        `${sc ? ` · roláveis ${sc}` : ''}${m.codigo ? '' : ' · (sem "Código" na tela)'}`)
      if (width === 320) await page.screenshot({ path: out(`overflow-${name}-320.png`), fullPage: true })
    }
  }
} finally {
  await browser.close()
}
console.log(`\n${failures === 0 ? 'sem rolagem lateral' : `${failures} com problema`}`)
process.exitCode = failures ? 1 : 0
