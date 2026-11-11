// O4d: chip da obra e link do registro no Histórico e no cartão da Lista (o lugar
// mais estreito), janela real com a barra de rolagem, 320 a 1280. Registro do
// seed de Desenhar com obra, escolhas e sessão (lido pela API: o texto não fica
// aqui). Estados: seed (a obra do registro, sem link), "link curto" (domínio
// comum, o caso do dia a dia pro toque) e pior caso injetado na resposta (título
// de 100 letras sem espaço, domínio de 63 letras, endereço de 2000 caracteres).
// Nada vaza; o link tem a altura dos botões "N sessões" e o mesmo espaço que a
// linha já dá entre eles (gap-x-2 = 8px na mesma linha, gap-y-1 = 4px entre
// linhas), e não encosta no lápis. Tempos (segundos): sessão de 25h01min01s com
// título de 100 letras, e um título real medido e estimado; o total desce pra
// linha de baixo só quando não cabe, e o cabeçalho tem no máximo as linhas do
// título com a largura toda, mais uma.
// Contraste no pixel, nos dois temas: o chip (a mesma classe do S6, vigiado) e o
// texto do link.
import pngjs from 'pngjs'
import { API, APP, CHROME, out } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'

const { PNG } = pngjs
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const WIDTHS = [320, 360, 375, 414, 640, 768, 1280]
const [works, tasks, executions, entries] = await Promise.all(['works', 'tasks', 'executions', 'time-entries'].map(async (p) => (await apiFetch(`${API}/${p}`)).json()))
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
  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  let state = null
  let times = null
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const headers = { 'Access-Control-Allow-Origin': '*' }
    if (times && req.method() === 'GET' && req.url() === `${API}/executions`) {
      return req.respond({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(times.executions) })
    }
    if (times && req.method() === 'GET' && req.url() === `${API}/time-entries`) {
      return req.respond({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(times.entries) })
    }
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

  // Tempos (segundos no Histórico), respostas injetadas: o registro só. "Longo":
  // título de 100 letras sem espaço e 25h01min01s (a mais larga com horas de 2
  // dígitos); "real": um título do dia a dia, medido e estimado. O total fica ao
  // lado do título quando cabe (sem encostar: o gap-3) e desce pra linha de baixo,
  // à direita, quando não cabe; o cabeçalho tem no máximo as linhas do título com
  // a largura toda, mais uma. A linha da sessão não invade o lápis; o total do dia
  // não encosta no rótulo; sem rolagem lateral. "Justo": título de N letras (fonte
  // de largura fixa) calculado em cada largura pra sobrar menos que o gap-3 ao lado
  // do total: prova o gap (sem ele, o total ficaria colado). "Sessão longa":
  // 1000h00min00s, a linha precisa quebrar pra caber com o lápis no cartão
  const end = new Date(record.completedAt).getTime()
  const template = entries.find((x) => x.taskExecutionId === record.id)
  const TIMES = [
    ['longo', 't'.repeat(100), 90061, false, '25h01min01s', '· 25h01min01s', '25h01min01s'],
    ['real', 'Assistir vídeo em inglês', 4052, false, '1h07min32s', '· 1h07min32s', '1h07min32s'],
    ['real estimado', 'Assistir vídeo em inglês', 82, true, '1min22s', '· 1min22s · estimada', '1min22s'],
    ['justo', null, 4052, false, '1h07min32s', '· 1h07min32s', '1h07min32s'],
    ['sessão longa', 'Assistir vídeo em inglês', 3_600_000, false, '1000h00min00s', '· 1000h00min00s', '1000h00min00s'],
  ]
  let sessionWrapped = 0
  for (const [caseName, fixedTitle, seconds, estimated, TOTAL, SESSION, DAY] of TIMES) {
    const setTimes = (title) => {
      times = {
        executions: [{ ...record, taskTitleAtTime: title }],
        entries: [{ ...template, id: crypto.randomUUID(), taskExecutionId: record.id, startedAt: new Date(end - seconds * 1000).toISOString(), endedAt: new Date(end).toISOString(), estimated }],
      }
    }
    for (const [where, enter] of places) {
      for (const width of WIDTHS) {
        await page.setViewport({ width, height: 800 })
        if (fixedTitle === null) {
          // Sonda: largura do cabeçalho, do total e de uma letra (a fonte do título é de largura fixa)
          setTimes('x')
          await enter()
          const n = await page.evaluate((description) => {
            const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === description))
            const h4 = a.querySelector('h4')
            const probe = document.createElement('span')
            probe.textContent = 'm'.repeat(40)
            probe.style.cssText = 'position: absolute; white-space: nowrap; visibility: hidden'
            h4.append(probe)
            const letter = probe.getBoundingClientRect().width / 40
            probe.remove()
            const room = h4.parentElement.getBoundingClientRect().width - h4.nextElementSibling.getBoundingClientRect().width
            return Math.floor((room - 1) / letter)
          }, record.description)
          setTimes('m'.repeat(n))
        } else setTimes(fixedTitle)
        await enter()
        await page.evaluate((description) => {
          const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === description))
          ;[...a.querySelectorAll('button')].find((b) => /sess(ão|ões)/.test(b.textContent)).click()
        }, record.description)
        await pause(200)
        const m = await page.evaluate((description) => {
          const useful = document.documentElement.clientWidth
          const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === description))
          const rects = (el) => {
            const range = document.createRange()
            range.selectNodeContents(el)
            return [...range.getClientRects()]
          }
          const h4 = a.querySelector('h4')
          const total = h4.nextElementSibling
          const header = h4.parentElement
          const line = [...a.querySelectorAll('li > div')].find((d) => /\d\d:\d\d–\d\d:\d\d/.test(d.textContent))
          const session = line?.querySelector('span')
          const pencil = line?.querySelector('button')
          const h3 = a.closest('section')?.querySelector('h3')
          const [label, day] = h3 ? h3.querySelectorAll('span') : []
          const titleBox = h4.getBoundingClientRect()
          const totalBox = total.getBoundingClientRect()
          const cardBox = a.getBoundingClientRect()
          const sessionRects = session ? rects(session) : []
          const headerBox = header.getBoundingClientRect()
          const titleRight = Math.max(...rects(h4).map((r) => r.right))
          const totalLeft = Math.min(...rects(total).map((r) => r.left))
          const gap3 = 0.75 * parseFloat(getComputedStyle(document.documentElement).fontSize)
          // o título com a largura toda: o total fora do fluxo
          total.style.display = 'none'
          const fullTitle = h4.getBoundingClientRect().height
          total.style.display = ''
          return {
            total: total.firstChild.textContent,
            session: session?.textContent ?? null,
            day: day?.textContent ?? null,
            scroll: document.documentElement.scrollWidth - useful,
            beside: totalBox.top < titleBox.bottom - 0.5,
            titleGap: totalLeft - titleRight,
            belowGap: totalBox.top - titleBox.bottom,
            rightGap: headerBox.right - totalBox.right,
            gap3,
            titleOut: Math.max(0, ...rects(h4).map((r) => r.right - titleBox.right)),
            grow: headerBox.height - fullTitle,
            lineHeight: parseFloat(getComputedStyle(h4).lineHeight),
            // sobra ao lado do total se o título (numa linha) e ele dividissem a linha
            spare: headerBox.width - totalBox.width - (titleRight - Math.min(...rects(h4).map((r) => r.left))),
            sessionLines: new Set(sessionRects.map((r) => Math.round(r.top))).size,
            lineOut: Math.max(0, ...sessionRects.map((r) => r.right - cardBox.right), pencil ? pencil.getBoundingClientRect().right - cardBox.right : 0),
            intoPencil: session && pencil ? Math.max(...rects(session).map((r) => r.right)) - pencil.getBoundingClientRect().left : null,
            dayGap: label && day ? Math.min(...rects(day).map((r) => r.left)) - Math.max(...rects(label).map((r) => r.right)) : null,
          }
        }, record.description)
        const tag = `${where}, ${caseName} ${width}px`
        check(`${tag}: total, sessão e dia (${TOTAL})`, m.total === TOTAL && m.day === DAY && (m.session ?? '').endsWith(SESSION), JSON.stringify([m.total, m.session, m.day]))
        check(`${tag}: sem rolagem lateral`, m.scroll <= 0, `${m.scroll}px`)
        check(`${tag}: título dentro do cabeçalho`, m.titleOut <= 0.5, `${m.titleOut}px`)
        if (m.beside) {
          check(`${tag}: total ao lado não encosta no título (≥ gap-3, ${m.gap3}px)`, m.titleGap >= m.gap3 - 0.5, `${m.titleGap.toFixed(1)}px`)
        } else {
          check(`${tag}: total embaixo, sem invadir o título e à direita`, m.belowGap >= -0.5 && Math.abs(m.rightGap) <= 0.5, `abaixo ${m.belowGap.toFixed(1)}px, direita ${m.rightGap.toFixed(1)}px`)
        }
        check(`${tag}: cabeçalho ≤ título com a largura toda + 1 linha (${m.lineHeight}px)`, m.grow <= m.lineHeight + 0.5, `${m.grow.toFixed(1)}px`)
        // a sessão estimada não tem lápis (ajusta-se pelo registro)
        if (estimated) check(`${tag}: sessão estimada, sem lápis`, m.session !== null && m.intoPencil === null, JSON.stringify([m.session, m.intoPencil]))
        else check(`${tag}: sessão não invade o lápis`, m.intoPencil !== null && m.intoPencil <= 0.5, String(m.intoPencil))
        check(`${tag}: total do dia não encosta no rótulo (≥ 8px)`, m.dayGap !== null && m.dayGap >= 7.5, String(m.dayGap))
        check(`${tag}: sessão e lápis dentro do cartão`, m.lineOut <= 0.5, `${m.lineOut}px`)
        if (fixedTitle === null) check(`${tag}: título justo, sobraria menos que o gap-3 ao lado do total (0 ≤ sobra < ${m.gap3}px)`, m.spare >= 0 && m.spare < m.gap3, `${m.spare.toFixed(1)}px`)
        if (caseName === 'sessão longa' && m.sessionLines > 1) sessionWrapped++
        if (width === 320 && caseName === 'longo') await page.screenshot({ path: out(`o4d-${where === 'Lista' ? 'lista' : 'historico'}-tempos-longos-320.png`) })
      }
    }
  }
  times = null
  // O caso só prova a quebra se a linha quebrou em algum lugar
  check(`sessão longa: a linha quebrou em ${sessionWrapped} de ${places.length * WIDTHS.length} combinações (> 0)`, sessionWrapped > 0, String(sessionWrapped))

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
