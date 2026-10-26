// D4: layout do Painel em 6 estados (semana atual, mês, detalhe de Código
// aberto numa semana passada, período vazio; D5b: dia de hoje, ano atual com
// 12 barras e a tabela mês a mês; D6: contexto com nome de 40 letras sem
// espaço, com o detalhe aberto, na resposta de /tags trocada; D7c: "Comparar
// tags" com 3 escolhidas, aviso de aninhada e a busca aberta, e com 5, uma de
// nome longo, e a mensagem do limite) × 8 larguras, janela real. As checagens
// de coluna, tabela e nome valem pras duas seções.
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
const byId = new Map(tags.map((t) => [t.id, t]))
const pathOf = (t) => (t.parentId ? `${pathOf(byId.get(t.parentId))} › ${t.name}` : t.name)
const idOf = (p) => tags.find((t) => pathOf(t) === p).id
const ano = `periodo=ano&inicio=${new Date().getFullYear()}-01-01`
const three = ['Vestibular › Matemática › Álgebra', 'Matemática › Álgebra', 'Vestibular'].map(idOf)
const five = [codigo, idOf('Código › Empresa › equipamentos-medicos'), ...three.slice(0, 2), idOf('Linguagens')]
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 7)
const states = {
  semana: '/painel',
  mes: '/painel?periodo=mes&inicio=' + ymd(new Date()).slice(0, 8) + '01',
  detalhe: `/painel?periodo=semana&inicio=${ymd(monday)}&contexto=${codigo}`,
  vazio: '/painel?periodo=semana&inicio=2025-01-06',
  dia: '/painel?periodo=dia&inicio=' + ymd(new Date()),
  ano: `/painel?periodo=ano&inicio=${new Date().getFullYear()}-01-01`,
  longo: `/painel?periodo=semana&inicio=${ymd(monday)}&contexto=${codigo}&tags=${five.join(',')}`,
  tags: `/painel?${ano}&tags=${three.join(',')}`,
}
// Depois de abrir: o que digitar na busca de tags (lista aberta / limite)
const typing = { tags: 'mat', longo: 'x' }
const LONG = 'Implementacaodesistemasembarcadosmedicos'
const widths = [320, 360, 375, 414, 640, 768, 1024, 1280]

const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  const page = await browser.newPage()
  await page.emulateTimezone('America/Sao_Paulo')
  // Estado "longo": /tags com Código renomeado pra uma palavra de 40 letras
  let renaming = false
  await page.setRequestInterception(true)
  page.on('request', async (req) => {
    if (renaming && req.url() === `${API}/tags`) {
      const body = tags.map((t) => (t.id === codigo ? { ...t, name: LONG } : t))
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) })
    }
    req.continue()
  })
  for (const width of widths) {
    for (const [name, path] of Object.entries(states)) {
      await page.setViewport({ width, height: 900 })
      renaming = name === 'longo'
      await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
      await pause(300)
      if (typing[name]) {
        await page.type('section[aria-label="Comparar tags"] input', typing[name])
        await pause(150)
      }
      const tag = `${width}px ${name}`
      const m = await page.evaluate(() => {
        const de = document.documentElement
        const main = document.querySelector('main').getBoundingClientRect()
        const section = document.querySelector('section[aria-label="Tempo"]')
        const compare = document.querySelector('section[aria-label="Comparar tags"]')
        // Coluna, tabela e nome: nas duas seções
        const all = (sel) => [section, compare].filter(Boolean).flatMap((s) => [...s.querySelectorAll(sel)])
        const outside = all('*').filter((e) => {
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
        // Nome comum (sem espaço, até 10 letras: Vestibular, Linguagens) numa
        // linha só: quebrar dentro da palavra é só pra nome maior que isso
        const broken = all('tbody tr td:first-child').filter((td) => {
          const text = td.textContent.trim()
          if (/\s/.test(text) || text.length > 10) return false
          // só os nós de TEXTO (a caixa flex e a bolinha têm outro topo)
          const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT)
          const tops = new Set()
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const range = document.createRange(); range.selectNodeContents(n)
            for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top))
          }
          return tops.size > 1
        }).map((td) => td.textContent.trim())
        // contra a área de CONTEÚDO do pai: no cartão do detalhe, o padding
        // não é lugar da tabela (antes, comparar com a caixa inteira deixou
        // passar uma tabela 28px fora do cartão)
        const tables = all('table').map((t) => {
          const st = getComputedStyle(t.parentElement)
          // (clientWidth é inteiro; a tabela, fracionária: medir tudo em fração)
          const content = t.parentElement.getBoundingClientRect().width - ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, k) => sum + parseFloat(st[k]), 0)
          return t.getBoundingClientRect().width - content
        })
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
        // Barras das tags: a barra dentro da trilha e o valor sem encostar
        // nela (≥ 4px), o valor inteiro dentro da coluna
        const bars = [...(compare?.querySelectorAll('[role="img"] > div') ?? [])].map((row) => {
          const fill = row.querySelector('[style]').getBoundingClientRect()
          const track = row.querySelector('[style]').parentElement.getBoundingClientRect()
          const value = row.lastElementChild.lastElementChild.getBoundingClientRect()
          return { fillInside: fill.right <= track.right + 0.5, gap: value.left - fill.right, valueInside: value.right <= main.right + 0.5 }
        })
        const cmp = compare && {
          results: compare.querySelectorAll('ul[aria-label="Tags encontradas"] button').length,
          chips: compare.querySelectorAll('ul[aria-label="Tags escolhidas"] li').length,
          rows: compare.querySelectorAll('tbody tr').length,
          text: compare.textContent,
        }
        return { scroll: de.scrollWidth - de.clientWidth, outside, svgs, tables, gaps, broken, bars, cmp, text: section.textContent }
      })
      check(m.scroll <= 0, `${tag}: rolagem lateral ${m.scroll}px`)
      check(m.outside.length === 0, `${tag}: fora da coluna ${m.outside.slice(0, 3)}`)
      check(m.tables.every((d) => d <= 0.5), `${tag}: tabela mais larga que o contêiner ${m.tables}`)
      check(m.broken.length === 0, `${tag}: nome comum quebrado no meio: ${m.broken}`)
      for (const s of m.svgs) {
        check(s.cut.length === 0, `${tag} ${s.label}: rótulo cortado ${s.cut}`)
        check(s.minFont >= 9, `${tag} ${s.label}: fonte de ${s.minFont.toFixed(1)}px`)
      }
      const tight = m.gaps.filter((g) => g.min < 4)
      check(tight.length === 0, `${tag}: foco com folga < 4px ${JSON.stringify(tight.slice(0, 3))}`)
      // O estado esperado montou (bateria que não mede nada tem que falhar)
      const expected = { semana: 2, mes: 2, detalhe: 3, vazio: 0, dia: 1, ano: 2, longo: 3, tags: 2 }[name]
      check(m.svgs.length === expected, `${tag}: ${m.svgs.length} gráficos (esperado ${expected})`)
      if (name === 'vazio') check(m.text.includes('Nenhum tempo dedicado'), `${tag}: estado vazio não montou`)
      if (name === 'longo') check(m.text.includes(LONG), `${tag}: o nome longo não apareceu`)
      if (name === 'ano') check(m.tables.length === 2, `${tag}: ${m.tables.length} tabelas (esperado: contexto + meses)`)
      for (const b of m.bars) {
        check(b.fillInside && b.gap >= 4 && b.valueInside, `${tag}: barra de tag ${JSON.stringify(b)}`)
      }
      // Os estados da seção nova montaram
      if (name === 'tags') {
        check(m.cmp?.chips === 3 && m.cmp.rows === 3 && m.bars.length === 3 && m.cmp.results > 0 && m.cmp.text.includes('não somam'),
          `${tag}: comparar tags não montou ${JSON.stringify({ ...m.cmp, text: undefined, bars: m.bars.length })}`)
      }
      if (name === 'longo') {
        check(m.cmp?.chips === 5 && m.cmp.rows === 5 && m.cmp.text.includes(LONG) && m.cmp.text.includes('Já são 5 tags'),
          `${tag}: comparar tags (5, nome longo) não montou ${JSON.stringify({ ...m.cmp, text: m.cmp?.text.slice(0, 80) })}`)
      }
      if (width === 320 || (width === 1280 && ['detalhe', 'longo', 'tags'].includes(name))) {
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
