// Layout do calendário do Histórico (commit C4), em 8 larguras (320 a 1280), claro e escuro, calendário aberto COM e SEM dia
// ativo, janela real (com a barra de rolagem clássica: sem --hide-scrollbars). Confere:
//  - sem rolagem lateral (página e qualquer contêiner com overflow dentro do calendário); 42 células dentro da coluna;
//  - células: largura >= 38 px (EXCEÇÃO documentada: em 320 com a barra de 15 px a coluna útil é 305 - 32 de margem = 273 px,
//    ou seja 39 px por célula; a regra geral de 44 px vale na ALTURA, que nunca cede) e altura >= 44 px;
//  - nenhuma célula sobreposta à vizinha (mesma linha e linhas seguidas);
//  - fonte >= 13 px; contraste NO PIXEL (fundo lido do próprio elemento, opacidade das ancestrais contada): texto >= 4,5:1
//    (número do dia por categoria, dia ativo, título, cabeçalho de semana), ponto marcador e seta de mês >= 3:1;
//  - botão "Calendário" com alvo de 44 px (altura e largura);
//  - ordem do Tab (Calendário, Mês anterior, Próximo mês, a ÚNICA célula tabulável, [Limpar, só com dia ativo], Frequência) e Shift+Tab de volta;
//  - anel de foco (outline de 2 px + 2 de afastamento) inteiro dentro da janela e não cortado por contêiner com overflow, em
//    CADA uma das 42 células, nos 2 botões de mês e no "Calendário".
// Nada é gravado. Uso: node --env-file=backend/.env tests/layout/historico-calendario-layout.mjs
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'

let ok = 0
let bad = 0
const check = (cond, msg) => { cond ? ok++ : bad++; if (!cond) console.log('FALHOU', msg) }
const TZ = 'America/Sao_Paulo'
const keyOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso))

const executions = (await (await apiFetch(`${API}/executions`)).json()).filter((e) => e.completedAt !== null)
const byDay = new Map()
for (const e of executions) byDay.set(keyOf(e.completedAt), (byDay.get(keyOf(e.completedAt)) ?? 0) + 1)
const busyDay = [...byDay].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0]?.[0]
if (!busyDay) throw new Error('o seed não tem registro concluído')

const widths = [320, 360, 375, 414, 640, 768, 1024, 1280]

// Tudo que roda na página: contraste no pixel, geometria e anel de foco
const measure = (page) => page.evaluate(() => {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const paint = (css, alpha, under) => {
    ctx.globalAlpha = 1
    ctx.fillStyle = `rgb(${under.join(',')})`
    ctx.fillRect(0, 0, 1, 1)
    ctx.globalAlpha = alpha
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
  }
  const solid = (css) => {
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 1, 1)
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
  }
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const backdrop = (el, fromParent = false) => {
    for (let a = fromParent ? el.parentElement : el; a; a = a.parentElement) {
      const bg = getComputedStyle(a).backgroundColor
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return solid(bg)
    }
    return solid(getComputedStyle(document.body).backgroundColor)
  }
  const opacityOf = (el) => { let o = 1; for (let a = el; a; a = a.parentElement) o *= parseFloat(getComputedStyle(a).opacity); return o }
  // fg = a cor do texto (ou do ponto) JÁ com a opacidade das ancestrais; fundo = o do próprio elemento
  const ratio = (el, fgCss, fromParent = false) => {
    const bg = backdrop(el, fromParent)
    const fg = paint(fgCss, opacityOf(el), bg)
    const [hi, lo] = [lum(fg), lum(bg)].sort((p, q) => q - p)
    return (hi + 0.05) / (lo + 0.05)
  }
  const textRatio = (el) => ratio(el, getComputedStyle(el).color)

  const wrapper = document.querySelector('[role="grid"]')?.parentElement
  const grid = document.querySelector('[role="grid"]')
  const main = document.querySelector('main').getBoundingClientRect()
  const toggle = [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Calendário')
  const cells = grid ? [...grid.querySelectorAll('[data-day]')] : []
  const nav = ['Mês anterior', 'Próximo mês'].map((l) => document.querySelector(`button[aria-label="${l}"]`))
  const title = grid ? document.getElementById(grid.getAttribute('aria-labelledby')) : null
  const headers = grid ? [...grid.querySelectorAll('[role="columnheader"]')] : []
  const rect = (el) => el.getBoundingClientRect()

  // rolagem lateral: página e qualquer elemento do calendário com overflow
  const overflowing = wrapper ? [wrapper, ...wrapper.querySelectorAll('*')].filter((el) => {
    const s = getComputedStyle(el)
    return (s.overflowX !== 'visible' || s.overflowY !== 'visible') && el.scrollWidth > el.clientWidth
  }).length : -1

  // geometria das células
  const r = cells.map(rect)
  let overlaps = 0
  for (let i = 0; i < r.length; i++) {
    if (i % 7 !== 6 && r[i].right > r[i + 1].left + 0.5) overlaps++
    if (i + 7 < r.length && r[i].bottom > r[i + 7].top + 0.5) overlaps++
  }
  const outsideColumn = r.filter((c) => c.left < main.left - 1 || c.right > main.right + 1).length

  // contraste do número do dia e do ponto, por categoria
  const categories = {}
  const note = (cat, kind, value) => { ((categories[cat] ??= {})[kind] ??= []).push(value) }
  for (const cell of cells) {
    const inActive = cell.closest('[role="gridcell"]').getAttribute('aria-selected') === 'true'
    const count = (cell.getAttribute('aria-label').match(/(\d+) registro/) ?? [0, 0])[1]
    const cls = cell.className
    const outOfMonth = /text-tinta-suave/.test(cls) && count > 0 // com registro, só os de fora do mês são suaves
    const cat = inActive ? 'dia ativo' : count > 0 ? (outOfMonth ? 'fora do mês, com registro' : 'no mês, com registro') : 'sem registro'
    const [numberEl, dotEl] = cell.querySelectorAll('span')
    note(cat, 'texto', textRatio(numberEl))
    if (count > 0 || inActive) {
      const dot = getComputedStyle(dotEl).backgroundColor
      if (dot !== 'rgba(0, 0, 0, 0)') note(cat, 'ponto', ratio(dotEl, dot, true))
    }
  }

  const fonts = [title, ...headers, ...cells.map((c) => c.querySelector('span'))].filter(Boolean).map((el) => parseFloat(getComputedStyle(el).fontSize))

  // setas de mês: ícone (3:1), com a opacidade de aria-disabled
  const arrows = nav.map((b) => b && { disabled: b.getAttribute('aria-disabled') === 'true', ratio: ratio(b, getComputedStyle(b).color) })

  return {
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overflowing, cellCount: cells.length, overlaps, outsideColumn,
    minW: Math.min(...r.map((c) => c.width)), minH: Math.min(...r.map((c) => c.height)),
    toggle: toggle ? { w: rect(toggle).width, h: rect(toggle).height } : null,
    navSizes: nav.map((b) => b && { w: rect(b).width, h: rect(b).height }),
    fonts: { min: Math.min(...fonts), count: fonts.length },
    categories: Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([kk, list]) => [kk, { min: Math.min(...list), n: list.length }]))])),
    title: title ? textRatio(title) : null,
    headers: headers.length ? Math.min(...headers.map(textRatio)) : null,
    arrows,
    selected: cells.filter((c) => c.closest('[role="gridcell"]').getAttribute('aria-selected') === 'true').length,
  }
})

// Anel de foco de UM elemento: estilo, largura e se o retângulo do anel cabe na janela e em todo ancestral com overflow
const ringOf = (selector) => `(() => {
  const el = ${selector}
  if (!el) return null
  el.focus({ preventScroll: true })
  const s = getComputedStyle(el)
  const g = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset)
  const b = el.getBoundingClientRect()
  const ring = { left: b.left - g, right: b.right + g, top: b.top - g, bottom: b.bottom + g }
  const vw = document.documentElement.clientWidth
  let clippedBy = null
  for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
    const o = getComputedStyle(a)
    if (o.overflowX === 'visible' && o.overflowY === 'visible') continue
    const r = a.getBoundingClientRect()
    if (ring.left < r.left - 0.5 || ring.right > r.right + 0.5 || ring.top < r.top - 0.5 || ring.bottom > r.bottom + 0.5) { clippedBy = a.tagName + '.' + String(a.className).slice(0, 30); break }
  }
  return { focused: document.activeElement === el, style: s.outlineStyle, width: parseFloat(s.outlineWidth), insideWindow: ring.left >= 0 && ring.right <= vw, clippedBy }
})()`

let browser
try {
  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.emulateTimezone(TZ)
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    for (const width of widths) {
      for (const withDay of [true, false]) {
        const t = `${scheme} ${width} ${withDay ? 'com dia ativo' : 'sem dia ativo'}`
        await page.setViewport({ width, height: 900 })
        await page.goto(`${APP}/historico${withDay ? `?dia=${busyDay}` : ''}`, { waitUntil: 'networkidle0' })
        await page.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Calendário'))
        await page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Calendário').click())
        await page.waitForFunction(() => document.querySelectorAll('[role="grid"] [data-day]').length > 0 && document.activeElement?.dataset?.day)

        const m = await measure(page)
        check(m.pageOverflow <= 0, `${t}: rolagem lateral da página ${m.pageOverflow}px`)
        check(m.overflowing === 0, `${t}: contêiner do calendário com rolagem (${m.overflowing})`)
        check(m.cellCount === 42 && m.outsideColumn === 0, `${t}: 42 células dentro da coluna (${m.cellCount}, fora ${m.outsideColumn})`)
        check(m.minW >= 38, `${t}: largura mínima da célula ${m.minW.toFixed(1)}px (exceção: >= 38)`)
        check(m.minH >= 43.9, `${t}: altura mínima da célula ${m.minH.toFixed(1)}px (>= 44)`)
        check(m.overlaps === 0, `${t}: células sobrepostas ${m.overlaps}`)
        check(m.fonts.min >= 13 && m.fonts.count > 40, `${t}: fonte mínima ${m.fonts.min}px em ${m.fonts.count} textos`)
        check(m.toggle && m.toggle.h >= 44 && m.toggle.w >= 44, `${t}: alvo do Calendário ${JSON.stringify(m.toggle)}`)
        check(m.navSizes.every((s) => s && s.h >= 44 && s.w >= 44), `${t}: alvo dos botões de mês ${JSON.stringify(m.navSizes)}`)
        check(m.selected === (withDay ? 1 : 0), `${t}: células com aria-selected ${m.selected}`)
        const cats = m.categories
        check(withDay ? !!cats['dia ativo'] : !cats['dia ativo'], `${t}: categoria "dia ativo" ${withDay ? 'presente' : 'ausente'}`)
        for (const need of ['no mês, com registro', 'sem registro']) check(!!cats[need], `${t}: categoria "${need}" existe na amostra`)
        for (const [cat, kinds] of Object.entries(cats)) {
          if (kinds.texto) check(kinds.texto.min >= 4.5, `${t}: contraste do número (${cat}) ${kinds.texto.min.toFixed(2)} em ${kinds.texto.n} dias`)
          if (kinds.ponto) check(kinds.ponto.min >= 3, `${t}: contraste do ponto (${cat}) ${kinds.ponto.min.toFixed(2)} em ${kinds.ponto.n} dias`)
        }
        check(m.title >= 4.5, `${t}: contraste do título ${m.title?.toFixed(2)}`)
        check(m.headers >= 4.5, `${t}: contraste do cabeçalho de semana ${m.headers?.toFixed(2)}`)
        for (const [i, a] of m.arrows.entries()) check(a && a.ratio >= 3, `${t}: contraste da seta ${i === 0 ? 'anterior' : 'próximo'} (${a?.disabled ? 'aria-disabled' : 'ativa'}) ${a?.ratio.toFixed(2)}`)

        // Ordem do Tab: Calendário > Mês anterior > Próximo mês > a única célula tabulável > Frequência; e Shift+Tab de volta
        await page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Calendário').focus())
        const order = []
        const name = () => page.evaluate(() => {
          const a = document.activeElement
          return a?.dataset?.day ? `célula ${a.dataset.day}` : a?.getAttribute('aria-label') ?? a?.textContent?.trim()
        })
        for (let i = 0; i < (withDay ? 5 : 4); i++) { await page.keyboard.press('Tab'); order.push(await name()) }
        const roving = await page.evaluate(() => document.querySelector('[data-day][tabindex="0"]')?.dataset.day)
        check(order.join('|') === `Mês anterior|Próximo mês|célula ${roving}|${withDay ? 'Limpar filtro do dia|' : ''}Frequência`, `${t}: ordem do Tab ${order.join(' > ')}`)
        await page.keyboard.down('Shift'); for (let i = 0; i < (withDay ? 2 : 1); i++) await page.keyboard.press('Tab'); await page.keyboard.up('Shift')
        check(await name() === `célula ${roving}`, `${t}: Shift+Tab volta para a célula ${roving}`)

        // Anel de foco: o teclado acabou de ser usado, então o foco programático é "focus-visible"
        const rings = []
        for (const sel of [`[...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Calendário')`, `document.querySelector('button[aria-label="Mês anterior"]')`, `document.querySelector('button[aria-label="Próximo mês"]')`]) rings.push(await page.evaluate(ringOf(sel)))
        const dayKeys = await page.evaluate(() => [...document.querySelectorAll('[role="grid"] [data-day]')].map((c) => c.dataset.day))
        for (const key of dayKeys) rings.push(await page.evaluate(ringOf(`document.querySelector('[data-day="${key}"]')`)))
        const brokenRing = rings.filter((r) => !r || !r.focused || r.style === 'none' || r.width < 2)
        const clipped = rings.filter((r) => r && (r.clippedBy || !r.insideWindow))
        check(rings.length === 45 && brokenRing.length === 0, `${t}: anel de foco visível nos 45 focáveis (sem anel em ${brokenRing.length}: ${JSON.stringify(brokenRing[0])})`)
        check(clipped.length === 0, `${t}: anel inteiro dentro da janela e sem corte (${clipped.length}: ${JSON.stringify(clipped[0])})`)
        if (width === 320) console.log(`  ${t}: célula mínima ${m.minW.toFixed(1)} x ${m.minH.toFixed(1)} px`)
      }
    }
  }
} finally {
  await browser?.close().catch(() => {})
}
console.log(`\n${ok} de ${ok + bad}`)
process.exitCode = bad === 0 && ok > 0 ? 0 : 1
