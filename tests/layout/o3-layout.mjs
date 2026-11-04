// O3b: layout da seção "Obras" em 7 larguras, janela real (barra de rolagem
// visível). Pior caso injetado na resposta (nada no banco): 30 obras, títulos de
// 100 caracteres sem espaço, progresso com 8 dígitos e uma medida de 30 letras;
// a edição de uma obra com tag e tarefa arquivadas. A diferença de contagem de
// obras confere que nada foi gravado. Uso (raiz do repo):
//   node --env-file=backend/.env tests/layout/o3-layout.mjs
import pg from 'pg'
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME, OUT } from '../config.mjs'
import { worksSnapshot } from '../limpeza.mjs'
const { Pool } = pg
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env')
  process.exit(2)
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  if (!ok) console.log(`FALHOU ${name} (${detail})`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const get = async (p) => (await fetch(API + p)).json()
const WIDTHS = [320, 360, 375, 414, 768, 1024, 1280]

const before = await worksSnapshot(pool)
const seedWorks = await get('/works')
const seedMeasures = await get('/measures')
const tasks = await get('/tasks')
const tags = await get('/tags')
const id = (n) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`
const perfume = tags.find((t) => t.name === 'Perfume' && !t.parentId)
const archivedTag = tags.find((t) => t.name === 'projeto-antigo')
const archivedTask = tasks.find((t) => !t.active)
const longMeasure = { id: id(99), tagId: perfume.id, name: 'm'.repeat(30), singular: 'm'.repeat(30), allowsDecimal: true, active: true, kinds: [] }
const statuses = ['em_andamento', 'pausado', 'concluido', 'abandonado']
const capitulos = seedMeasures.find((m) => m.name === 'capítulos')
const fake = Array.from({ length: 30 }, (_, i) => ({
  id: id(i),
  title: i % 3 === 0 ? `${i}${'T'.repeat(99 - String(i).length)}` : `Obra de teste ${i} com um título razoável`,
  status: i < 20 ? 'em_andamento' : statuses[i % 4],
  defaultTagId: i === 1 ? archivedTag.id : perfume.id,
  defaultTaskId: i === 1 ? archivedTask.id : tasks.find((t) => t.active).id,
  measureId: i % 2 === 0 ? longMeasure.id : null,
  total: i % 4 === 0 ? 99999999.99 : null,
  url: null,
  defaultTagActive: i !== 1,
  defaultTaskActive: i !== 1,
  measureCurrent: i % 5 !== 0,
  records: i * 37,
  seconds: i * 9999,
  progress: i % 2 === 0 ? 99999999.99 : null,
}))

// Medida antiga: soma "capítulos" (real) em Perfume, cuja mais próxima é a injetada de 30 letras
const stale = { ...fake[3], id: id(98), title: 'Obra de teste com a medida antiga', measureId: capitulos.id, measureCurrent: false, total: 99999999.99, progress: 1234.5 }
fake.push(stale)

let browser
try {
  browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  let injected = false
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const respond = (body) => req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) })
    if (injected && req.method() === 'GET' && req.url() === `${API}/works`) return respond([...seedWorks, ...fake])
    if (injected && req.method() === 'GET' && req.url() === `${API}/measures`) return respond([...seedMeasures, longMeasure])
    req.continue()
  })
  const S = 'section[aria-label="Obras"]'
  const open = async () => {
    await page.goto(`${APP}/tags`, { waitUntil: 'networkidle0' })
    await pause(250)
  }
  const click = (selector, text) => page.evaluate((sel, t) => [...document.querySelectorAll(sel)].find((b) => b.textContent.trim().startsWith(t)).click(), selector, text)
  const chooseIn = (label, text) => page.evaluate((S, label, text) => {
    const el = [...document.querySelectorAll(`${S} form label`)].find((l) => l.querySelector('span')?.textContent.trim().startsWith(label))?.querySelector('select')
    if (!el) throw new Error(`campo ${label} não existe`)
    const option = [...el.options].find((o) => o.textContent === text)
    if (!option) throw new Error(`opção ${text} não existe em ${label}`)
    el.value = option.value
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, S, label, text)

  const measure = (state) => page.evaluate((S, state) => {
    const out = []
    const section = document.querySelector(S)
    if (!section) return [{ ok: false, what: 'seção ausente' }]
    const useful = document.documentElement.clientWidth
    const box = section.getBoundingClientRect()
    out.push({ ok: document.documentElement.scrollWidth <= useful, what: `rolagem lateral da página: ${document.documentElement.scrollWidth} > ${useful}` })
    out.push({ ok: box.right <= useful + 0.5 && box.left >= -0.5, what: `seção fora da tela (${box.left}..${box.right} em ${useful})` })
    // Texto de verdade (Range), não a caixa: a caixa não cresce quando o texto estoura
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT)
    // Uma checagem por texto medido (OK ou FALHOU): o total não cresce quando falha
    let texts = 0
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || node.parentElement.closest('[role="group"]') || node.parentElement.closest('select')) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const card = node.parentElement.closest('ul, form, p, h3, button') ?? section
      const c = card.getBoundingClientRect()
      const leak = [...range.getClientRects()].find((r) => r.right > c.right + 0.5 || r.left < c.left - 0.5)
      texts++
      out.push({ ok: !leak, what: `texto vaza: "${node.textContent.slice(0, 25)}"${leak ? ` ${leak.left.toFixed(1)}..${leak.right.toFixed(1)} em ${c.left.toFixed(1)}..${c.right.toFixed(1)}` : ''}` })
    }
    // Fixa: a bateria não passa sem medir (cada linha tem ao menos o título, mais o h3 e a descrição)
    const rowCount = section.querySelectorAll('ul > li').length
    out.push({ ok: texts > 0 && texts >= rowCount + 2, what: `textos medidos: ${texts}, esperado ao menos ${rowCount + 2}` })
    // ⋯ dentro do cartão e no meio da linha
    const menus = [...section.querySelectorAll('button[aria-label^="Mais ações da obra"]')]
    if (state !== 'novo' && state !== 'editar') out.push({ ok: menus.length > 0, what: 'nenhum ⋯' })
    for (const m of menus) {
      const r = m.getBoundingClientRect(), card = m.closest('ul').getBoundingClientRect(), li = m.closest('li').getBoundingClientRect()
      out.push({ ok: r.right <= card.right + 0.5 && r.left >= card.left, what: `⋯ fora do cartão (${r.right} > ${card.right})` })
      out.push({ ok: r.top >= li.top - 0.5 && r.bottom <= li.bottom + 0.5, what: '⋯ fora da linha' })
    }
    // Título sempre começa à esquerda e não encosta no ⋯
    for (const li of section.querySelectorAll('ul > li')) {
      const title = li.querySelector('span'), dots = li.querySelector('button[aria-label^="Mais ações"]')
      if (!title || !dots) continue
      const range = document.createRange()
      range.selectNodeContents(title)
      const right = Math.max(...[...range.getClientRects()].map((r) => r.right))
      out.push({ ok: right <= dots.getBoundingClientRect().left + 0.5, what: `título encosta no ⋯ (${right} > ${dots.getBoundingClientRect().left})` })
    }
    // Campos com largura útil; foco com folga até a borda da janela
    for (const f of section.querySelectorAll('form input, form select')) {
      out.push({ ok: f.getBoundingClientRect().width >= 100, what: `campo estreito (${f.getBoundingClientRect().width})` })
    }
    for (const f of section.querySelectorAll('button, input, select, a')) {
      if (f.closest('[role="group"]')) continue
      const r = f.getBoundingClientRect()
      out.push({ ok: useful - r.right >= 4 && r.left >= 4, what: `foco sem folga: "${(f.textContent || f.tagName).trim().slice(0, 20)}" ${r.left.toFixed(1)}..${r.right.toFixed(1)} em ${useful}` })
    }
    // A linha dos filtros rola, sem barra visível
    const scroller = section.querySelector('[aria-label="Filtrar obras por status"]')
    if (scroller) out.push({ ok: scroller.offsetHeight - scroller.clientHeight === 0, what: `barra visível nos filtros (${scroller.offsetHeight - scroller.clientHeight}px)` })
    return out
  }, S, state)

  const states = {
    seed: async () => { injected = false; await open(); await click(`${S} [aria-label="Filtrar obras por status"] button`, 'Todas') },
    trinta: async () => { injected = true; await open(); await click(`${S} [aria-label="Filtrar obras por status"] button`, 'Todas') },
    novo: async () => {
      injected = false
      await open()
      await click(`${S} button`, 'Nova obra')
      await pause(150)
      await chooseIn('Contexto', 'Leitura')
      await chooseIn('Em Leitura', 'Mangá')
    },
    'editar-antiga': async () => {
      injected = true
      await open()
      await click(`${S} [aria-label="Filtrar obras por status"] button`, 'Todas')
      await page.evaluate((l) => document.querySelector(`button[aria-label="${l}"]`).click(), `Mais ações da obra ${stale.title}`)
      await pause(100)
      await click('[role="menuitem"]', 'Editar')
      await pause(150)
    },
    editar: async () => {
      injected = true
      await open()
      await click(`${S} [aria-label="Filtrar obras por status"] button`, 'Todas')
      await page.evaluate((l) => document.querySelector(`button[aria-label="${l}"]`).click(), `Mais ações da obra ${fake[1].title}`)
      await pause(100)
      await click('[role="menuitem"]', 'Editar')
      await pause(150)
    },
  }
  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 900 })
    for (const [state, setup] of Object.entries(states)) {
      await setup()
      await pause(150)
      const found = await measure(state)
      for (const f of found) check(`${state} ${width}: ${f.what}`, f.ok, f.what)
      if (state === 'editar-antiga') {
        const opts = await page.evaluate((S) => [...[...document.querySelectorAll(`${S} form label`)].find((l) => l.textContent.startsWith('Medida')).querySelector('select').options].map((o) => o.textContent), S)
        check(`editar-antiga ${width}: 3 opções, a antiga primeiro`, opts.join(' | ') === `capítulos (medida antiga) | ${longMeasure.name} | Nenhuma`, opts.join(' | '))
      }
      if (state === 'editar') {
        const labels = await page.evaluate((S) => [...document.querySelectorAll(`${S} form select`)].flatMap((s) => [...s.selectedOptions].map((o) => o.textContent)), S)
        check(`editar ${width}: tag e tarefa arquivadas aparecem como "(arquivada)"`, labels.filter((t) => t.endsWith('(arquivada)')).length === 2, labels.join(' | '))
      }
      if (state === 'trinta') {
        const lines = await page.evaluate((S) => document.querySelectorAll(`${S} ul > li`).length, S)
        check(`trinta ${width}: as injetadas + as do seed na lista`, lines === fake.length + seedWorks.length, String(lines))
        const titleLines = await page.evaluate((S, t) => {
          const span = [...document.querySelectorAll(`${S} ul > li > div > div > span:first-child`)].find((s) => s.textContent === t)
          const range = document.createRange(); range.selectNodeContents(span)
          return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size
        }, S, fake[0].title)
        check(`trinta ${width}: título de 100 sem espaço quebra (${titleLines} linhas)`, titleLines >= 2, String(titleLines))
      }
      if (width === 320 || width === 1280) {
        await page.evaluate((S) => (document.querySelector(`${S} form`) ?? document.querySelector(S)).scrollIntoView({ block: 'start' }), S)
        await pause(100)
        await page.screenshot({ path: `${OUT}/o3-${state}-${width}.png` })
      }
    }
  }
  const after = await worksSnapshot(pool)
  check('nada gravado: diferença de contagem de obras 0', after.length === before.length, `${before.length} → ${after.length}`)
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false, err.message)
} finally {
  await browser?.close()
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length && results.length > 0 ? 0 : 1
}
