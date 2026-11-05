// O4d: chip da obra e link do registro no Histórico e no cartão da Lista (o lugar
// mais estreito), janela real com a barra de rolagem, 320 a 1280. Registro do
// seed de Desenhar com obra, escolhas e sessão (lido pela API: o texto não fica
// aqui). Estados: seed (a obra do registro, sem link), "link curto" (domínio
// comum, o caso do dia a dia pro toque) e pior caso injetado na resposta (título
// de 100 letras sem espaço, domínio de 63 letras, endereço de 2000 caracteres).
// Nada vaza; o link tem a altura dos botões "N sessões" e o mesmo espaço que a
// linha já dá entre eles (gap-x-2 = 8px na mesma linha, gap-y-1 = 4px entre
// linhas), e não encosta no lápis. Contraste no pixel, nos dois temas: o chip
// (a mesma classe do S6, vigiado) e o texto do link.
import puppeteer from 'puppeteer-core'
import pngjs from 'pngjs'
import { API, APP, CHROME, out } from '../config.mjs'

const { PNG } = pngjs
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const WIDTHS = [320, 360, 375, 414, 640, 768, 1280]
const [works, tasks, executions, entries] = await Promise.all(['works', 'tasks', 'executions', 'time-entries'].map(async (p) => (await fetch(`${API}/${p}`)).json()))
const task = tasks.find((t) => t.title === 'Desenhar')
const record = executions
  .filter((e) => e.taskId === task.id && e.completedAt && e.workId && e.description && e.selections.length > 0 &&
    entries.some((x) => x.taskExecutionId === e.id))
  .sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1))[0]
const long = { ...works.find((w) => w.id === record?.workId), id: crypto.randomUUID(), title: `${'o'.repeat(100)}` }
const SHORT = 'https://www.exemplo.com/video?t=42'
const HOST = `${'d'.repeat(63)}.com`
const LONG = `https://${HOST}/${'a'.repeat(2000 - 9 - HOST.length)}`
const STATES = {
  seed: null,
  'link curto': { linkUrl: SHORT },
  'pior caso': { linkUrl: LONG, workId: long.id },
}

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
  if (!record) throw new Error('registro de Desenhar com obra, escolhas e sessão não achado no seed')
  if (LONG.length !== 2000) throw new Error(`endereço do pior caso com ${LONG.length} caracteres`)
  browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  let state = null
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const headers = { 'Access-Control-Allow-Origin': '*' }
    if (state && req.method() === 'GET' && req.url() === `${API}/executions`) {
      const body = JSON.stringify(executions.map((e) => (e.id === record.id ? { ...e, ...state } : e)))
      return req.respond({ status: 200, contentType: 'application/json', headers, body })
    }
    if (state && req.method() === 'GET' && req.url() === `${API}/works`) {
      return req.respond({ status: 200, contentType: 'application/json', headers, body: JSON.stringify([...works, long]) })
    }
    req.continue()
  })
  const inHistory = async () => {
    await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  }
  const inList = async () => {
    await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
    await page.evaluate((title) => document.querySelector(`button[aria-label="Mais ações de ${title}"]`).click(), task.title)
    await pause(100)
    await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Ver histórico').click())
    await pause(250)
  }
  const measure = (description) => page.evaluate((description) => {
    const useful = document.documentElement.clientWidth
    const article = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === description))
    const box = article.getBoundingClientRect()
    const rects = (el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      return [...range.getClientRects()]
    }
    const list = article.querySelector('[data-work-chips]')
    const items = list ? [...list.querySelectorAll(':scope > li')] : []
    const texts = items.flatMap((li) => [...li.querySelectorAll('span')]).flatMap(rects)
    const link = article.querySelector('a[data-record-link]')
    const sessions = [...article.querySelectorAll('button')].find((b) => /sess(ão|ões)/.test(b.textContent))
    const pencil = article.querySelector('button[aria-label^="Editar registro"]')
    const r = (el) => el?.getBoundingClientRect() ?? null
    const L = r(link)
    const S = r(sessions)
    const Pn = r(pencil)
    // Na mesma linha (as caixas se cruzam na vertical): o vão horizontal; senão, o vertical
    const gap = (a, b) => {
      if (!a || !b) return null
      const sameLine = a.top < b.bottom && b.top < a.bottom
      return sameLine ? { line: 'mesma', px: Math.max(a.left - b.right, b.left - a.right) } : { line: 'outra', px: Math.max(a.top - b.bottom, b.top - a.bottom) }
    }
    return {
      chips: items.length,
      scroll: document.documentElement.scrollWidth - useful,
      textOut: Math.max(0, ...[...texts, ...(link ? rects(link) : [])].map((t) => Math.max(t.right - box.right, box.left - t.left))),
      chipOut: Math.max(0, ...items.map((li) => li.getBoundingClientRect().right - box.right)),
      textOutChip: Math.max(0, ...items.flatMap((li) => {
        const c = li.getBoundingClientRect()
        return [...li.querySelectorAll('span')].flatMap(rects).map((t) => t.right - c.right)
      })),
      link: L && {
        height: L.height,
        textOut: Math.max(0, ...rects(link).map((t) => Math.max(t.right - L.right, L.left - t.left))),
        margin: Math.min(L.left, useful - L.right),
      },
      sessionsHeight: S?.height ?? null,
      toSessions: gap(L, S),
      toPencil: gap(L, Pn),
    }
  }, description)

  const places = [['Histórico', inHistory, 'historico'], ['Lista', inList, 'lista']]
  for (const [name, change] of Object.entries(STATES)) for (const [where, enter, file] of places) {
    state = change
    for (const width of WIDTHS) {
      await page.setViewport({ width, height: 800 })
      await enter()
      const m = await measure(record.description)
      const tag = `${where}, ${name} ${width}px`
      check(`${tag}: chip da obra presente`, m.chips === 1, `${m.chips}`)
      check(`${tag}: sem rolagem lateral`, m.scroll <= 0, `${m.scroll}px`)
      check(`${tag}: texto dentro do cartão`, m.textOut <= 0.5, `${m.textOut}px`)
      check(`${tag}: chip dentro do cartão`, m.chipOut <= 0.5, `${m.chipOut}px`)
      check(`${tag}: texto dentro do chip`, m.textOutChip <= 0.5, `${m.textOutChip}px`)
      if (!change) {
        check(`${tag}: sem link no registro sem link`, m.link === null, JSON.stringify(m.link))
        continue
      }
      check(`${tag}: link presente, texto dentro dele`, m.link !== null && m.link.textOut <= 0.5, JSON.stringify(m.link))
      // Numa linha, a altura dos botões "N sessões"; domínio que quebra (pior caso)
      // cresce, nunca fica menor que eles
      if (name === 'link curto') check(`${tag}: link com a altura dos botões "N sessões"`, m.link !== null && m.sessionsHeight !== null && Math.abs(m.link.height - m.sessionsHeight) < 0.5, `${m.link?.height} x ${m.sessionsHeight}`)
      else check(`${tag}: link quebrado nunca menor que os botões "N sessões"`, m.link !== null && m.sessionsHeight !== null && m.link.height >= m.sessionsHeight - 0.5, `${m.link?.height} x ${m.sessionsHeight}`)
      check(`${tag}: espaço até "N sessões" ≥ o da linha (8px na mesma, 4px entre linhas)`, m.toSessions !== null && m.toSessions.px >= (m.toSessions.line === 'mesma' ? 8 : 4) - 0.5, JSON.stringify(m.toSessions))
      check(`${tag}: não encosta no lápis (≥ 8px)`, m.toPencil !== null && (m.toPencil.line === 'outra' || m.toPencil.px >= 7.5), JSON.stringify(m.toPencil))
      check(`${tag}: folga do foco do link ≥ 4px`, m.link !== null && m.link.margin >= 4, `${m.link?.margin}px`)
      if (width === 320) {
        await page.evaluate((description) => [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === description)).scrollIntoView({ block: 'start' }), record.description)
        await pause(200)
        await page.screenshot({ path: out(`o4d-${file}-${name.replace(' ', '-')}-320.png`) })
      }
    }
  }

  // Contraste no pixel. Fundo = a cor mais frequente na área (um ponto só já caiu
  // fora do elemento, CLAUDE.md). Chip: a classe do S6, valor vigiado; link: texto
  // tinta-suave sobre o cartão, com pixels de texto contados (não leu vazio)
  state = STATES['link curto']
  await page.setViewport({ width: 390, height: 900 })
  for (const [scheme, known] of [['light', 5.6], ['dark', 4.74]]) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await inHistory()
    await page.evaluate((description) => {
      const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === description))
      a.scrollIntoView({ block: 'center', behavior: 'instant' })
    }, record.description)
    await pause(300)
    const areas = await page.evaluate((description) => {
      const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === description))
      const li = a.querySelector('[data-work-chips] li')
      const c = li.getBoundingClientRect()
      const label = li.querySelector('span').getBoundingClientRect()
      const link = a.querySelector('a[data-record-link]').getBoundingClientRect()
      return {
        chip: { left: Math.ceil(c.left), top: Math.ceil(c.top), right: Math.floor(c.right), bottom: Math.floor(c.bottom), textLeft: Math.floor(label.left), textRight: Math.ceil(label.right) },
        link: { left: Math.floor(link.left) - 4, top: Math.ceil(link.top), right: Math.ceil(link.right) + 4, bottom: Math.floor(link.bottom), textLeft: Math.floor(link.left), textRight: Math.ceil(link.right) },
      }
    }, record.description)
    const png = PNG.sync.read(await page.screenshot({ captureBeyondViewport: false }))
    const pixel = (x, y) => { const i = (png.width * y + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]] }
    const read = (area, inset) => {
      const counts = new Map()
      for (let x = area.left + inset; x < area.right - inset; x++) for (let y = area.top + 3; y < area.bottom - 3; y++) {
        const key = pixel(x, y).join()
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      const background = [...counts].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number)
      let best = 0
      let ink = 0
      for (let x = area.textLeft; x < area.textRight; x++) for (let y = area.top + 3; y < area.bottom - 3; y++) {
        const v = ratio(pixel(x, y), background)
        best = Math.max(best, v)
        if (v >= 3) ink++
      }
      return { best, ink }
    }
    const chip = read(areas.chip, 4)
    const link = read(areas.link, 0)
    check(`contraste do chip, ${scheme}: ≥ 4,5 e o valor vigiado (${known})`, chip.best >= 4.5 && Math.abs(chip.best - known) < 0.25, chip.best.toFixed(2))
    check(`contraste do link, ${scheme}: ≥ 4,5, lido no texto (${link.ink} pixels de texto)`, link.best >= 4.5 && link.ink > 20, `${link.best.toFixed(2)} com ${link.ink} pixels`)
    console.log(`contraste ${scheme}: chip ${chip.best.toFixed(2)}, link ${link.best.toFixed(2)}`)
  }
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser?.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length && ok > 0 ? 0 : 1
}
