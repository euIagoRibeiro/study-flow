// Painel, medidas dentro das linhas do Tempo (MA2b): layout da tabela "Tempo dedicado por contexto" com as
// linhas-irmãs e as linhas só de medida, em 8 larguras (320 a 1280), janela real, em 4 estados: dados (a semana
// de 07/04/2025 com tempo, tests/medidas-dados.mjs), nomes longos (contexto de 40 letras, medida e tipo de 30,
// sem espaço), 3 medidas num contexto (resposta ampliada por interceptação) e erro das medidas (linha
// discreta com "Tentar de novo"). Dados próprios, apagados no fim e conferidos por prefixo e pelas contagens.
// Confere: sem rolagem lateral (página e contêineres), nada fora da coluna, tabela dentro do contêiner, o
// texto da linha-irmã alinhado ao nome do contexto, sem sobrepor a linha de cima, fonte >= 12px, anel de
// foco com folga, e que o estado esperado montou (bateria que não mede nada tem que falhar).
import pg from 'pg'
import { API, APP, CHROME, out } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'
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
const week = `/painel?periodo=semana&inicio=${WEEK}`
const states = {
  dados: { long: false },
  longo: { long: true },
  tres: { long: false },
  erro: { long: false },
}
const LONG_MEASURE = 'Questoesdeprovasanterioresdovv'

let browser
try {
  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  await page.emulateTimezone('America/Sao_Paulo')
  let mode = 'dados'
  await page.setRequestInterception(true)
  page.on('request', async (req) => {
    const url = new URL(req.url())
    if (url.pathname.endsWith('/dashboard/medidas-por-contexto')) {
      if (mode === 'erro') {
        return req.respond({ status: 500, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"x"}' })
      }
      if (mode === 'tres') {
        // O contexto com mais tempo ganha 2 medidas a mais (3 no total), com tipos e um nome comprido
        const real = await (await apiFetch(req.url())).json()
        const first = real.items.find((item) => item.measures.length > 0)
        first.measures.push(
          { key: 'extra1', name: 'Exercícios resolvidos de matemática', singular: 'exercício resolvido de matemática', total: 12.5, executions: 3,
            kinds: [{ key: 'a', name: 'Fáceis', quantity: 7, executions: 2 }, { key: 'b', name: 'Difíceis', quantity: 4.5, executions: 1 }, { key: null, name: null, quantity: 1, executions: 1 }] },
          { key: 'extra2', name: 'Horas de videoaula', singular: 'hora de videoaula', total: 1, executions: 1, kinds: [] },
          // Nome e tipo de 48 e 40 letras sem espaço (o banco limita a 30; a resposta é fabricada pra provar que a linha quebra)
          { key: 'extra3', name: 'Exerciciosresolvidosdematematicaavancadaparaoenem', singular: 'exerciciosresolvidosdematematicaavancadaparaoenem', total: 3, executions: 1,
            kinds: [{ key: 'c', name: 'Resolvidoscomsucessoemprimeiratentativa', quantity: 2, executions: 1 }, { key: null, name: null, quantity: 1, executions: 1 }] },
        )
        return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(real) })
      }
    }
    req.continue()
  })
  let seeded = null
  for (const [name, state] of Object.entries(states)) {
    if (seeded !== state.long) { await seedMedidas(pool, { longNames: state.long, withTime: true }); seeded = state.long }
    mode = name
    for (const width of widths) {
      await page.setViewport({ width, height: 900 })
      await page.goto(`${APP}${week}`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('main section[aria-label="Tempo"] table', { timeout: 15000 })
      for (let i = 0; i < 60; i++) {
        const ready = await page.evaluate((expectAlert) => {
          const s = document.querySelector('section[aria-label="Tempo"]')
          return expectAlert ? !!s.querySelector('[role="alert"]') : !!s.querySelector('tr[data-measure-row]')
        }, name === 'erro')
        if (ready) break
        await pause(100)
      }
      await pause(200)
      const tag = `${width}px ${name}`
      const m = await page.evaluate(() => {
        const de = document.documentElement
        const main = document.querySelector('main').getBoundingClientRect()
        const section = document.querySelector('section[aria-label="Tempo"]')
        const table = [...section.querySelectorAll('table')].find((t) => t.querySelector('caption')?.textContent.trim() === 'Tempo dedicado por contexto')
        if (!table) return null
        const inTable = [...table.querySelectorAll('*')].filter((e) => !e.closest('.sr-only'))
        const outside = inTable.filter((e) => {
          const r = e.getBoundingClientRect()
          return r.width > 0 && (r.right > main.right + 0.5 || r.left < main.left - 0.5)
        }).map((e) => e.tagName + ':' + (e.textContent ?? '').slice(0, 15))
        // sr-only (legenda da tabela e prefixo de leitura): caixa de 1px cortada de propósito, não aparece
        const scrollers = [...section.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline' && !e.closest('svg') && !e.closest('.sr-only')).map((e) => e.tagName + ':' + (e.textContent ?? '').slice(0, 15))
        const st = getComputedStyle(table.parentElement)
        const content = table.parentElement.getBoundingClientRect().width - ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, k) => sum + parseFloat(st[k]), 0)
        const tableOver = table.getBoundingClientRect().width - content
        // O texto da linha-irmã alinhado ao nome do contexto da linha de cima, e sem sobrepor a de cima
        const subs = [...table.querySelectorAll('tr[data-measure-row]')]
        const misaligned = [], overlaps = []
        for (const sub of subs) {
          const prev = sub.previousElementSibling
          const nameEl = prev.querySelector('td span.flex').lastElementChild
          const p = sub.querySelector('p')
          if (Math.abs(nameEl.getBoundingClientRect().left - p.getBoundingClientRect().left) > 1.5) misaligned.push(prev.children[0].textContent.trim().slice(0, 12))
          if (sub.getBoundingClientRect().top < prev.getBoundingClientRect().bottom - 0.5) overlaps.push(prev.children[0].textContent.trim().slice(0, 12))
        }
        // Cada item da linha de tipos ("rótulo: número") é uma unidade: nunca fica partido em duas linhas
        const kindItems = [...table.querySelectorAll('tr[data-measure-row] td > div > div > p:nth-child(2) > span')]
        const splitItems = kindItems.filter((sp) => sp.getClientRects().length > 1).map((sp) => sp.textContent.trim())
        const texts = subs.flatMap((sub) => [...sub.querySelectorAll('p')])
        const minFont = texts.length ? Math.min(...texts.map((p) => parseFloat(getComputedStyle(p).fontSize))) : null
        const buttons = [...section.querySelectorAll('table button, [role="alert"] button')].map((el) => {
          const r = el.getBoundingClientRect()
          let a = el.parentElement, min = Math.min(de.clientWidth - r.right, r.left)
          while (a && a !== document.body) {
            const cs = getComputedStyle(a)
            if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
              const b = a.getBoundingClientRect()
              min = Math.min(min, r.left - b.left, b.right - r.right, r.top - b.top, b.bottom - r.bottom)
            }
            a = a.parentElement
          }
          return min
        })
        return {
          scroll: de.scrollWidth - de.clientWidth, outside, scrollers, tableOver, misaligned, overlaps, minFont, buttons, kindItems: kindItems.length, splitItems,
          rows: table.querySelectorAll('tbody tr').length,
          subs: subs.length,
          only: table.querySelectorAll('tr[data-measure-only]').length,
          blocksInFirst: subs[0]?.querySelectorAll('td > div > div').length ?? 0,
          text: table.textContent.replace(/\s+/g, ' '),
          alert: section.querySelector('[role="alert"]')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
        }
      })
      if (!m) { check(false, `${tag}: a tabela de contextos não existe`); continue }
      check(m.scroll <= 0, `${tag}: rolagem lateral ${m.scroll}px`)
      check(m.outside.length === 0, `${tag}: fora da coluna ${m.outside.slice(0, 3)}`)
      check(m.scrollers.length === 0, `${tag}: contêiner com rolagem lateral ${m.scrollers.slice(0, 3)}`)
      check(m.tableOver <= 0.5, `${tag}: tabela mais larga que o contêiner (${m.tableOver}px)`)
      check(m.misaligned.length === 0, `${tag}: linha-irmã desalinhada do nome: ${m.misaligned}`)
      check(m.overlaps.length === 0, `${tag}: linha-irmã sobre a linha de cima: ${m.overlaps}`)
      check(m.splitItems.length === 0, `${tag}: item da linha de tipos partido em duas linhas: ${m.splitItems}`)
      check(m.minFont === null || m.minFont >= 12, `${tag}: fonte de ${m.minFont}px`)
      check(m.buttons.every((g) => g >= 4), `${tag}: foco com folga < 4px ${JSON.stringify(m.buttons)}`)
      if (name !== 'erro') check(m.kindItems >= 4, `${tag}: itens da linha de tipos não montaram (${m.kindItems})`)
      // O estado esperado montou
      if (name === 'dados') check(m.rows === 11 && m.subs === 5 && m.only === 2, `${tag}: dados não montaram: ${m.rows} linhas, ${m.subs} irmãs, ${m.only} só de medida`)
      if (name === 'longo') check(m.rows === 11 && m.subs === 5 && m.only === 2 && m.text.includes('MDContextoComNomeMuitoLongoSemEspaco1') && m.text.toLowerCase().includes(LONG_MEASURE.toLowerCase()), `${tag}: nomes longos não montaram: ${m.rows} linhas`)
      if (name === 'tres') check(m.blocksInFirst === 4 && m.text.includes('3 exerciciosresolvidosdematematicaavancadaparaoenem') && m.text.includes('resolvidoscomsucessoemprimeiratentativa: 2 · sem tipo: 1') && m.text.includes('12,5 exercícios resolvidos de matemática') && m.text.includes('fáceis: 7 · difíceis: 4,5 · sem tipo: 1') && m.text.includes('1 hora de videoaula'), `${tag}: 4 medidas não montaram (${m.blocksInFirst})`)
      if (name === 'erro') check(m.subs === 0 && m.only === 0 && m.alert === 'Não foi possível carregar as medidas. Tentar de novo' && m.buttons.length >= 1, `${tag}: erro não montou: ${m.alert}`)
      if (width === 320 || width === 1280) await page.screenshot({ path: out(`medidas-linhas-${name}-${width}.png`), fullPage: true })
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
