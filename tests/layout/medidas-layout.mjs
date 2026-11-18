// Painel, medidas (MA4): layout da seção "Medidas" em 8 larguras (320 a 1280), janela real, em 4 estados:
// com dados (5 medidas), com nomes de 30 letras (o máximo do banco) sem espaço (medida e tipo), período vazio e erro com o
// "Tentar de novo". Dados próprios (tests/medidas-dados.mjs), apagados no fim e conferidos por prefixo e
// pelas contagens totais. Confere: sem rolagem lateral (página e contêineres), nada fora da coluna, tabela
// dentro do contêiner, nome comum (até 10 letras) numa linha só, fonte >= 12px, folga do anel de foco e
// alvo de toque do botão, e que o estado esperado montou (bateria que não mede nada tem que falhar).
import pg from 'pg'
import { API, APP, CHROME, out } from '../config.mjs'
import { launch } from '../sessao.mjs'
import { cleanMedidas, counts, leftovers, seedMedidas, WEEK } from '../medidas-dados.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (os dados são inseridos pelo banco)')
  process.exit(2)
}
let ok = 0, bad = 0
const check = (cond, msg) => { cond ? ok++ : bad++; if (!cond) console.log('FALHOU', msg) }
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
if (Object.values(await leftovers(pool)).some((n) => n > 0)) await cleanMedidas(pool) // rodada interrompida
const before = await counts(pool)

const widths = [320, 360, 375, 414, 640, 768, 1024, 1280]
const states = {
  dados: { path: `/painel?periodo=semana&inicio=${WEEK}`, long: false },
  longo: { path: `/painel?periodo=semana&inicio=${WEEK}`, long: true },
  vazio: { path: '/painel?periodo=semana&inicio=2025-01-06', long: false },
  erro: { path: `/painel?periodo=semana&inicio=${WEEK}`, long: false },
}
const LONG_MEASURE = 'Questoesdeprovasanterioresdovv'
const LONG_KIND = 'Acertosemquestoesdeprovasanter'

let browser
try {
  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  await page.emulateTimezone('America/Sao_Paulo')
  let failing = false
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (failing && req.url().startsWith(`${API}/dashboard/medidas`)) {
      return req.respond({ status: 500, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"x"}' })
    }
    req.continue()
  })
  let seeded = null
  for (const [name, state] of Object.entries(states)) {
    if (seeded !== state.long) { await seedMedidas(pool, { longNames: state.long }); seeded = state.long }
    failing = name === 'erro'
    for (const width of widths) {
      await page.setViewport({ width, height: 900 })
      await page.goto(`${APP}${state.path}`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('main section[aria-label="Medidas"]', { timeout: 15000 })
      for (let i = 0; i < 60; i++) {
        if (await page.evaluate(() => { const s = document.querySelector('section[aria-label="Medidas"]'); return !!s && !s.textContent.includes('Carregando') })) break
        await pause(100)
      }
      await pause(200)
      const tag = `${width}px ${name}`
      const m = await page.evaluate(() => {
        const de = document.documentElement
        const main = document.querySelector('main').getBoundingClientRect()
        const section = document.querySelector('section[aria-label="Medidas"]')
        if (!section) return null
        const all = [...section.querySelectorAll('*')].filter((e) => !e.closest('.sr-only'))
        const outside = all.filter((e) => {
          const r = e.getBoundingClientRect()
          return r.width > 0 && (r.right > main.right + 0.5 || r.left < main.left - 0.5)
        }).map((e) => e.tagName + ':' + (e.textContent ?? '').slice(0, 15))
        const scrollers = all.filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline').map((e) => e.tagName + ':' + (e.textContent ?? '').slice(0, 15))
        const tables = [...section.querySelectorAll('table')].map((t) => {
          const st = getComputedStyle(t.parentElement)
          const content = t.parentElement.getBoundingClientRect().width - ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, k) => sum + parseFloat(st[k]), 0)
          return t.getBoundingClientRect().width - content
        })
        const broken = [...section.querySelectorAll('tbody tr td:first-child')].filter((td) => {
          const text = td.textContent.trim()
          if (/\s/.test(text) || text.length > 10) return false
          const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT)
          const tops = new Set()
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const range = document.createRange(); range.selectNodeContents(n)
            for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top))
          }
          return tops.size > 1
        }).map((td) => td.textContent.trim())
        const minFont = Math.min(...all.filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => parseFloat(getComputedStyle(e).fontSize)))
        const buttons = [...section.querySelectorAll('button')].map((el) => {
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
          return { min, height: r.height }
        })
        return {
          scroll: de.scrollWidth - de.clientWidth, outside, scrollers, tables, broken, minFont, buttons,
          h3: [...section.querySelectorAll('h3')].map((h) => h.textContent.trim()),
          tableCount: section.querySelectorAll('table').length,
          text: section.textContent.replace(/\s+/g, ' '),
          alert: !!section.querySelector('[role="alert"]'),
        }
      })
      if (!m) { check(false, `${tag}: a seção Medidas não existe`); continue }
      check(m.scroll <= 0, `${tag}: rolagem lateral ${m.scroll}px`)
      check(m.outside.length === 0, `${tag}: fora da coluna ${m.outside.slice(0, 3)}`)
      check(m.scrollers.length === 0, `${tag}: contêiner com rolagem lateral ${m.scrollers.slice(0, 3)}`)
      check(m.tables.every((d) => d <= 0.5), `${tag}: tabela mais larga que o contêiner ${m.tables}`)
      check(m.broken.length === 0, `${tag}: nome comum quebrado no meio: ${m.broken}`)
      check(m.minFont >= 12, `${tag}: fonte de ${m.minFont}px`)
      const tight = m.buttons.filter((b) => b.min < 4)
      check(tight.length === 0, `${tag}: foco com folga < 4px ${JSON.stringify(tight)}`)
      // O estado esperado montou
      if (name === 'dados') check(m.h3.length === 5 && m.tableCount === 3 && m.text.includes('1.001 Páginas'), `${tag}: dados não montaram ${m.h3.length} ${m.tableCount}`)
      if (name === 'longo') check(m.h3.length === 5 && m.tableCount === 3 && m.text.includes(LONG_MEASURE) && m.text.includes(LONG_KIND), `${tag}: nomes longos não montaram ${m.h3}`)
      if (name === 'vazio') check(m.h3.length === 0 && m.text.includes('Nenhuma medida registrada nesta semana.'), `${tag}: vazio não montou`)
      if (name === 'erro') {
        check(m.alert && m.buttons.length === 1 && m.buttons[0].height >= 44, `${tag}: erro com botão de 44px não montou ${JSON.stringify(m.buttons)}`)
      }
      if (width === 320 || width === 1280) {
        await page.screenshot({ path: out(`medidas-${name}-${width}.png`), fullPage: true })
      }
    }
  }
} catch (err) {
  check(false, `erro: ${err.message}`)
} finally {
  await browser?.close()
  await cleanMedidas(pool)
  const left = await leftovers(pool)
  check(Object.values(left).every((n) => n === 0), `linhas com o prefixo dos dados temporários: ${JSON.stringify(left)}`)
  const after = await counts(pool)
  check(JSON.stringify(after) === JSON.stringify(before), `contagens totais mudaram: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
  await pool.end()
  console.log(`${ok} de ${ok + bad}`)
  process.exitCode = bad === 0 && ok > 0 ? 0 : 1
}
