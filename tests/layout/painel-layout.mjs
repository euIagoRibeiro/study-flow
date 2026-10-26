// D4: layout do Painel em 6 estados (semana atual, mês, detalhe de Código
// aberto numa semana passada, período vazio; D5b: dia de hoje, ano atual com
// 12 barras e a tabela mês a mês) × 8 larguras, janela real.
// Confere: sem rolagem lateral, nada fora da coluna, rótulos dos gráficos
// dentro do desenho (texto fora do viewBox some cortado), tabela sem
// estourar, fonte dos gráficos ≥ 9px e folga do anel de foco.
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME, out } from '../config.mjs'

let ok = 0, bad = 0
const check = (cond, msg) => { cond ? ok++ : bad++; if (!cond) console.log('FALHOU', msg) }
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const tags = await (await fetch(`${API}/tags`)).json()
const codigo = tags.find((t) => t.name === 'Código' && t.level === 1).id
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 7)
const states = {
  semana: '/painel',
  mes: '/painel?periodo=mes&inicio=' + ymd(new Date()).slice(0, 8) + '01',
  detalhe: `/painel?periodo=semana&inicio=${ymd(monday)}&contexto=${codigo}`,
  vazio: '/painel?periodo=semana&inicio=2025-01-06',
  dia: '/painel?periodo=dia&inicio=' + ymd(new Date()),
  ano: `/painel?periodo=ano&inicio=${new Date().getFullYear()}-01-01`,
}
const widths = [320, 360, 375, 414, 640, 768, 1024, 1280]

const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  const page = await browser.newPage()
  await page.emulateTimezone('America/Sao_Paulo')
  for (const width of widths) {
    for (const [name, path] of Object.entries(states)) {
      await page.setViewport({ width, height: 900 })
      await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
      await pause(300)
      const tag = `${width}px ${name}`
      const m = await page.evaluate(() => {
        const de = document.documentElement
        const main = document.querySelector('main').getBoundingClientRect()
        const section = document.querySelector('section[aria-label="Tempo"]')
        const outside = [...section.querySelectorAll('*')].filter((e) => {
          const r = e.getBoundingClientRect()
          // sr-only (legenda da tabela pro leitor de tela): 1px fora do fluxo, não aparece
          if (e.closest('.sr-only')) return false
          return r.width > 0 && (r.right > main.right + 0.5 || r.left < main.left - 0.5)
        }).map((e) => e.tagName + ':' + (e.textContent ?? '').slice(0, 15))
        // Texto do SVG fora do viewBox é cortado: a caixa de cada <text> dentro do desenho
        const svgs = [...section.querySelectorAll('svg[role="img"]')].map((svg) => {
          const vb = svg.viewBox.baseVal
          const cut = [...svg.querySelectorAll('text')].filter((t) => {
            const b = t.getBBox()
            return b.x < vb.x - 0.5 || b.y < vb.y - 0.5 || b.x + b.width > vb.x + vb.width + 0.5 || b.y + b.height > vb.y + vb.height + 0.5
          }).map((t) => t.textContent)
          const scale = svg.getBoundingClientRect().width / vb.width
          const minFont = Math.min(...[...svg.querySelectorAll('text')].map((t) => parseFloat(getComputedStyle(t).fontSize) * scale))
          return { label: svg.getAttribute('aria-label').slice(0, 20), cut, minFont, texts: svg.querySelectorAll('text').length }
        })
        const tables = [...section.querySelectorAll('table')].map((t) => t.getBoundingClientRect().width - t.parentElement.getBoundingClientRect().width)
        // Folga do foco (anel de 4px) até qualquer ancestral que corta
        const gaps = [...document.querySelectorAll('main button, main a')].map((el) => {
          const r = el.getBoundingClientRect()
          let a = el.parentElement, min = Math.min(de.clientWidth - r.right, r.left)
          while (a && a !== document.body) {
            const st = getComputedStyle(a)
            if (st.overflowX !== 'visible' || st.overflowY !== 'visible') {
              const b = a.getBoundingClientRect()
              min = Math.min(min, r.left - b.left, b.right - r.right, r.top - b.top, b.bottom - r.bottom)
            }
            a = a.parentElement
          }
          return { min, text: el.textContent.trim().slice(0, 15) }
        })
        return { scroll: de.scrollWidth - de.clientWidth, outside, svgs, tables, gaps, text: section.textContent }
      })
      check(m.scroll <= 0, `${tag}: rolagem lateral ${m.scroll}px`)
      check(m.outside.length === 0, `${tag}: fora da coluna ${m.outside.slice(0, 3)}`)
      check(m.tables.every((d) => d <= 0.5), `${tag}: tabela mais larga que o contêiner ${m.tables}`)
      for (const s of m.svgs) {
        check(s.cut.length === 0, `${tag} ${s.label}: rótulo cortado ${s.cut}`)
        check(s.minFont >= 9, `${tag} ${s.label}: fonte de ${s.minFont.toFixed(1)}px`)
      }
      const tight = m.gaps.filter((g) => g.min < 4)
      check(tight.length === 0, `${tag}: foco com folga < 4px ${JSON.stringify(tight.slice(0, 3))}`)
      // O estado esperado montou (bateria que não mede nada tem que falhar)
      const expected = { semana: 2, mes: 2, detalhe: 3, vazio: 0, dia: 1, ano: 2 }[name]
      check(m.svgs.length === expected, `${tag}: ${m.svgs.length} gráficos (esperado ${expected})`)
      if (name === 'vazio') check(m.text.includes('Nenhum tempo dedicado'), `${tag}: estado vazio não montou`)
      if (name === 'ano') check(m.tables.length === 2, `${tag}: ${m.tables.length} tabelas (esperado: contexto + meses)`)
      if (width === 320 || (width === 1280 && name === 'detalhe')) {
        await page.screenshot({ path: out(`painel-${name}-${width}.png`), fullPage: true })
      }
    }
  }
} catch (err) {
  check(false, `erro: ${err.message}`)
} finally {
  await browser.close()
  console.log(`${ok} de ${ok + bad}`)
  process.exitCode = bad === 0 && ok > 0 ? 0 : 1
}
