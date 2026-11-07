// S6: chips das escolhas no Histórico e no cartão da Lista (o lugar mais
// estreito), janela real com a barra de rolagem, 320 a 1280: seed e pior caso
// injetado na resposta (5 seleções, uma múltipla com 30 opções MARCADAS, nomes de
// 30 letras sem espaço). O cartão pode ficar alto; nada vaza. Contraste no pixel,
// nos dois temas: o texto do chip é vigiado (4,74:1 no escuro).
import pngjs from 'pngjs'
import { API, APP, CHROME, out } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'

const { PNG } = pngjs
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? ` (${detail})` : ''}`)
}
const WIDTHS = [320, 360, 375, 414, 640, 768, 1280]
const [selections, tasks, executions] = await Promise.all(['selections', 'tasks', 'executions'].map(async (p) => (await apiFetch(`${API}/${p}`)).json()))
const task = tasks.find((t) => t.title === 'Desenhar')
const record = executions.find((e) => e.taskId === task.id && e.selections.length > 0 && e.completedAt && e.description)
if (!record) throw new Error('registro do seed com escolhas não achado')
const option = (i) => ({ id: crypto.randomUUID(), name: `${'x'.repeat(28)}${String(i).padStart(2, '0')}`, position: i + 1, active: true })
const long = (letter, multiple, size) => ({ id: crypto.randomUUID(), tagId: record.rootTagId, name: letter.repeat(30), multiple, active: true,
  options: Array.from({ length: size }, (_, i) => option(i)) })
const injected = [long('m', true, 30), long('n', false, 1), long('o', false, 1), long('p', false, 1), long('q', false, 1)]
const worstSelections = JSON.stringify([...selections, ...injected])
const worstExecutions = JSON.stringify(executions.map((e) => (e.id === record.id
  ? { ...e, selections: injected.map((s) => ({ selectionId: s.id, optionIds: s.options.map((o) => o.id) })) }
  : e)))

const luminance = ([r, g, b]) => {
  const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

let browser
try {
  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  let worst = false
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const headers = { 'Access-Control-Allow-Origin': '*' }
    if (worst && req.method() === 'GET' && req.url() === `${API}/selections`) {
      return req.respond({ status: 200, contentType: 'application/json', headers, body: worstSelections })
    }
    if (worst && req.method() === 'GET' && req.url() === `${API}/executions`) {
      return req.respond({ status: 200, contentType: 'application/json', headers, body: worstExecutions })
    }
    req.continue()
  })
  const inHistory = async () => {
    await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  }
  const inList = async () => {
    await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
    await page.evaluate((title) => document.querySelector(`button[aria-label="Mais ações de ${title}"]`).click(), task.title)
    await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Ver histórico').click())
    await new Promise((r) => setTimeout(r, 250))
  }
  const measure = (description) => page.evaluate((description) => {
    const useful = document.documentElement.clientWidth
    const article = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === description))
    const list = article.querySelector('[data-selection-chips]')
    const box = article.getBoundingClientRect()
    const items = [...list.querySelectorAll(':scope > li')]
    const rects = (el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      return [...range.getClientRects()]
    }
    const texts = items.flatMap((li) => [...li.querySelectorAll('span')]).flatMap(rects)
    const boxes = items.map((li) => li.getBoundingClientRect())
    const overlap = boxes.some((a, i) => boxes.some((b, j) => j > i && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5))
    return {
      chips: items.length,
      scroll: document.documentElement.scrollWidth - useful,
      textOut: Math.max(0, ...texts.map((r) => Math.max(r.right - box.right, box.left - r.left))),
      chipOut: Math.max(0, ...boxes.map((r) => r.right - box.right)),
      textOutChip: Math.max(0, ...items.flatMap((li) => {
        const r = li.getBoundingClientRect()
        return [...li.querySelectorAll('span')].flatMap(rects).map((t) => t.right - r.right)
      })),
      overlap,
      height: Math.round(list.getBoundingClientRect().height),
      commas: items.map((li) => (li.textContent.match(/, /g) ?? []).length),
    }
  }, description)
  for (const [state, flag] of [['seed', false], ['pior caso', true]]) for (const [where, enter, file] of [['Histórico', inHistory, 'historico'], ['Lista', inList, 'lista']]) {
    worst = flag
    for (const width of WIDTHS) {
      await page.setViewport({ width, height: 800 })
      await enter()
      const m = await measure(record.description)
      const tag = `${where}, ${state} ${width}px`
      check(`${tag}: chips presentes`, m.chips === (flag ? 5 : record.selections.length), `${m.chips}`)
      check(`${tag}: sem rolagem lateral`, m.scroll <= 0, `${m.scroll}px`)
      check(`${tag}: texto dentro do cartão`, m.textOut <= 0.5, `${m.textOut}px`)
      check(`${tag}: chip dentro do cartão`, m.chipOut <= 0.5, `${m.chipOut}px`)
      check(`${tag}: texto dentro do chip`, m.textOutChip <= 0.5, `${m.textOutChip}px`)
      check(`${tag}: chips sem sobrepor`, !m.overlap)
      if (flag) check(`${tag}: as 30 opções marcadas no chip`, m.commas[0] === 29 || m.commas.includes(29), `${m.commas}`)
      if (width === 320) {
        await page.evaluate((description) => [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === description)).scrollIntoView({ block: 'start' }), record.description)
        await new Promise((r) => setTimeout(r, 200))
        await page.screenshot({ path: out(`s6-${file}${flag ? '-pior' : ''}-320.png`) })
      }
    }
  }

  // Contraste no pixel, dentro do chip. Fundo = a cor mais frequente lá dentro:
  // um ponto só já caiu fora dele e deu os 6,39 / 5,74 errados (CLAUDE.md)
  worst = false
  await page.setViewport({ width: 390, height: 900 })
  for (const [scheme, known] of [['light', 5.6], ['dark', 4.74]]) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await inHistory()
    await page.evaluate((description) => {
      const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === description))
      a.querySelector('[data-selection-chips] li').scrollIntoView({ block: 'center', behavior: 'instant' })
    }, record.description)
    await new Promise((r) => setTimeout(r, 300))
    const area = await page.evaluate((description) => {
      const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === description))
      const li = a.querySelector('[data-selection-chips] li')
      const r = li.getBoundingClientRect()
      // O rótulo, em tinta-suave: é o texto vigiado (o valor, em tinta, tem folga)
      const label = li.querySelector('span').getBoundingClientRect()
      return { left: Math.ceil(r.left), top: Math.ceil(r.top), right: Math.floor(r.right), bottom: Math.floor(r.bottom), labelLeft: Math.floor(label.left), labelRight: Math.ceil(label.right) }
    }, record.description)
    // Print da janela, com o chip recortado da imagem pelas coordenadas da tela
    const png = PNG.sync.read(await page.screenshot({ captureBeyondViewport: false }))
    const pixel = (x, y) => { const i = (png.width * y + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]] }
    const counts = new Map()
    for (let x = area.left + 4; x < area.right - 4; x++) for (let y = area.top + 3; y < area.bottom - 3; y++) {
      const key = pixel(x, y).join()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const background = [...counts].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number)
    let best = 0
    for (let x = area.labelLeft; x < area.labelRight; x++) for (let y = area.top + 3; y < area.bottom - 3; y++) best = Math.max(best, ratio(pixel(x, y), background))
    check(`contraste do chip, ${scheme}: ≥ 4,5`, best >= 4.5, best.toFixed(2))
    check(`contraste do chip, ${scheme}: leu o chip de verdade (vigiado ${known})`, Math.abs(best - known) < 0.25, best.toFixed(2))
    console.log(`contraste ${scheme}: ${best.toFixed(2)} (fundo ${background})`)
  }
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser?.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length && ok > 0 ? 0 : 1
}
