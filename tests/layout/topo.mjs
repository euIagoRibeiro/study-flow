// Navegação com 4 abas: topo do desktop em duas linhas (título, tags e tema
// em cima; abas embaixo) e barra de 4 abas no celular. 5 telas × 8 larguras,
// janela real. E o foco por teclado: nada escondido atrás do topo fixo
// (desktop, scroll-padding-top) nem da barra de baixo (celular).
import puppeteer from 'puppeteer-core'
import { APP, CHROME, out } from '../config.mjs'

let ok = 0, bad = 0
const check = (cond, msg) => { cond ? ok++ : bad++; if (!cond) console.log('FALHOU', msg) }
const pages = ['/', '/executar', '/historico', '/painel', '/tags']
const widths = [320, 360, 375, 414, 640, 768, 1024, 1280]

const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  const page = await browser.newPage()
  await page.emulateTimezone('America/Sao_Paulo')
  const heights = new Set()
  for (const width of widths) {
    for (const path of pages) {
      await page.setViewport({ width, height: 800 })
      await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
      await new Promise((r) => setTimeout(r, 200))
      const m = await page.evaluate(() => {
        const de = document.documentElement
        const header = document.querySelector('header')
        const nav = header.querySelector('nav[aria-label="Principal"]')
        const main = document.querySelector('main').getBoundingClientRect()
        const links = [...nav.querySelectorAll('a')].map((a) => {
          const r = a.getBoundingClientRect()
          return { top: Math.round(r.top), w: Math.round(r.width), cut: a.scrollWidth > a.clientWidth + 0.5 }
        })
        const topItems = [...header.children].filter((c) => c !== nav).map((c) => c.getBoundingClientRect())
        return {
          scroll: de.scrollWidth - de.clientWidth,
          desktop: innerWidth >= 640,
          outside: [...header.querySelectorAll('h1, a, button')].filter((e) => {
            const r = e.getBoundingClientRect()
            return r.right > main.right + 0.5 || r.left < main.left - 0.5
          }).map((e) => e.getAttribute('aria-label') ?? e.textContent.trim()),
          links,
          navTop: nav.getBoundingClientRect().top,
          titleRowBottom: Math.max(...topItems.map((r) => r.bottom)),
          barHeight: Math.round(header.parentElement.getBoundingClientRect().height),
          bottomBar: Math.round(nav.getBoundingClientRect().height),
        }
      })
      const tag = `${width}px ${path}`
      check(m.scroll <= 0, `${tag}: rolagem lateral ${m.scroll}px`)
      check(m.links.length === 4 && m.links.every((l) => !l.cut), `${tag}: abas ${JSON.stringify(m.links)}`)
      if (m.desktop) {
        check(m.outside.length === 0, `${tag}: fora da coluna ${m.outside}`)
        check(new Set(m.links.map((l) => l.top)).size === 1, `${tag}: abas em mais de uma linha`)
        check(m.navTop >= m.titleRowBottom - 0.5, `${tag}: abas não ficaram abaixo do título`)
        heights.add(m.barHeight)
      } else {
        check(new Set(m.links.map((l) => l.w)).size === 1, `${tag}: abas de larguras diferentes ${m.links.map((l) => l.w)}`)
        check(m.bottomBar <= 70, `${tag}: barra de baixo com ${m.bottomBar}px`)
      }
    }
    if (width === 320 || width === 640) {
      await page.goto(`${APP}/painel`, { waitUntil: 'networkidle0' })
      await page.screenshot({ path: out(`topo-${width}.png`) })
    }
  }
  check(heights.size === 1, `topo do desktop com alturas diferentes entre as telas: ${[...heights]}`)
  console.log(`altura do topo no desktop: ${[...heights]}px`)

  // Foco por teclado nos DOIS sentidos: com Tab, o elemento entra pela borda
  // de baixo (é onde a barra do celular esconde); com Shift+Tab, pela de cima
  // (onde o topo do desktop esconde). Só Tab pra frente nunca pegaria o topo
  for (const [width, path, back] of [[1280, '/historico', true], [640, '/historico', true], [1280, '/', true], [1280, '/historico', false], [375, '/historico', false], [375, '/', false], [375, '/historico', true]]) {
    await page.setViewport({ width, height: 800 })
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.activeElement?.blur())
    if (back) {
      // Começa do fim da página: o último focável
      await page.evaluate(() => {
        const all = [...document.querySelectorAll('a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])')]
        all.at(-1)?.focus()
        window.scrollTo(0, document.documentElement.scrollHeight)
      })
    }
    let covered = 0, count = 0, worst = 0
    for (let i = 0; i < 400; i++) {
      if (back) {
        await page.keyboard.down('Shift')
        await page.keyboard.press('Tab')
        await page.keyboard.up('Shift')
      } else {
        await page.keyboard.press('Tab')
      }
      const f = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return null
        const r = el.getBoundingClientRect()
        const header = document.querySelector('header')
        const nav = header.querySelector('nav[aria-label="Principal"]')
        const desktop = innerWidth >= 640
        // O que está DENTRO da barra fixa não conta (está na barra, não atrás)
        if ((desktop ? header.parentElement : nav).contains(el)) return { skip: true, key: el.outerHTML.slice(0, 80) }
        const over = desktop
          ? header.parentElement.getBoundingClientRect().bottom - r.top
          : r.bottom - nav.getBoundingClientRect().top
        return { over, key: el.outerHTML.slice(0, 80) }
      })
      if (!f) break
      if (f.skip) continue
      count++
      if (f.over > 0.5) { covered++; worst = Math.max(worst, f.over) }
    }
    const dir = back ? 'Shift+Tab' : 'Tab'
    check(count > 10, `${width}px ${path} ${dir}: só ${count} focos (a bateria não andou)`)
    check(covered === 0, `${width}px ${path} ${dir}: ${covered} de ${count} focos atrás da barra fixa (até ${Math.round(worst)}px)`)
    console.log(`foco ${width}px ${path} ${dir}: ${count} elementos, ${covered} escondidos`)
  }
} catch (err) {
  check(false, `erro: ${err.message}`)
} finally {
  await browser.close()
  console.log(`${ok} de ${ok + bad}`)
  process.exitCode = bad === 0 && ok > 0 ? 0 : 1
}
