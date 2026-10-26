// D6: comparação com o período anterior. Duas partes:
// 1. Relógio CONGELADO no navegador (respostas da API trocadas): o "ponto
//    equivalente" do período em andamento (o "ate" do pedido do anterior) em
//    dia, semana, mês, ano, 31 contra fevereiro, 29/02 contra ano sem ele,
//    semana na virada do ano, período passado inteiro, meia-noite exata,
//    período vazio com tempo no anterior; rótulo e média por dia.
// 2. Dados do seed, relógio real: coluna "vs. anterior" = conta com a API
//    (semanas passadas, "novo" / "sem tempo agora", linha só do anterior sem
//    bolinha), detalhe (subtags e fases) e a semana atual até o mesmo ponto.
// Só lê: nada é gravado.
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME } from '../config.mjs'

const FUSO = 'America/Sao_Paulo'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const duration = (seconds) => {
  const m = Math.round(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}min`
}
// A regra combinada (2026-10-25), escrita de novo aqui: diferença pelos
// minutos arredondados, % pelos segundos, sem cor
const diffOf = (cur, prev) => {
  if (prev === 0) return cur === 0 ? 'igual' : 'novo'
  if (cur === 0) return 'sem tempo agora'
  const min = Math.round(cur / 60) - Math.round(prev / 60)
  if (min === 0) return 'igual'
  const pct = Math.round(((cur - prev) / prev) * 100)
  return `${min > 0 ? '+' : '−'}${duration(Math.abs(min) * 60)}${pct === 0 ? '' : ` (${pct > 0 ? '+' : '−'}${Math.abs(pct)}%)`}`
}
// Instante de uma hora local de Brasília (−03, sem horário de verão desde 2019)
const at = (t) => new Date(`${t.replace(' ', 'T')}-03:00`)
const iso = (t) => at(t).toISOString()
const ymdOf = (d) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10)
const local = (ymd) => new Date(`${ymd}T00:00:00-03:00`)
const addDays = (ymd, n) => ymdOf(new Date(local(ymd).getTime() + n * 86400e3 + 12 * 3600e3))
const mondayOf = (ymd) => addDays(ymd, -((new Date(local(ymd).getTime() + 12 * 3600e3).getUTCDay() + 6) % 7))
const api = async (route, de, ate, extra = {}) =>
  (await fetch(`${API}/dashboard/${route}?${new URLSearchParams({ de: de.toISOString(), ate: ate.toISOString(), fuso: FUSO, ...extra })}`)).json()

const tags = await (await fetch(`${API}/tags`)).json()
const nameOf = (id) => (id === null ? '(sem tag)' : tags.find((t) => t.id === id)?.name)
const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  // ======== 1. relógio congelado
  {
    const page = await browser.newPage()
    page.setDefaultTimeout(10000)
    await page.emulateTimezone(FUSO)
    await page.setViewport({ width: 390, height: 900 })
    // Date congelado: o valor vem do teste a cada página aberta
    await page.evaluateOnNewDocument(() => {
      const Real = Date
      let t = null
      globalThis.__setNow = (v) => { t = v }
      globalThis.Date = class extends Real {
        constructor(...a) { super(...(a.length ? a : [t ?? Real.now()])) }
        static now() { return t ?? Real.now() }
      }
    })
    const contextReqs = []
    let fake = { current: 3600, previous: 1800 }
    let currentDe = null
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const url = new URL(req.url())
      if (url.pathname === '/dashboard/tempo-por-contexto') {
        contextReqs.push(url)
        const isCurrent = url.searchParams.get('de') === currentDe
        const seconds = isCurrent ? fake.current : fake.previous
        return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ totalSeconds: seconds, overlap: false, running: [], items: seconds ? [{ tagId: null, seconds }] : [] }) })
      }
      req.continue()
    })
    const open = async (now, query, de) => {
      contextReqs.length = 0
      currentDe = iso(de)
      await page.goto('about:blank')
      await page.evaluateOnNewDocument((v) => { globalThis.__frozen = v }, at(now).getTime())
      await page.evaluateOnNewDocument(() => globalThis.__setNow(globalThis.__frozen))
      await page.goto(`${APP}/painel?${query}`, { waitUntil: 'networkidle0' })
      await pause(200)
      return page.evaluate(() => {
        const s = document.querySelector('section[aria-label="Tempo"]')
        return {
          text: s?.textContent.replace(/\s+/g, ' ') ?? '',
          lines: [...(s?.querySelectorAll('p') ?? [])].map((p) => p.textContent.replace(/\s+/g, ' ').trim()),
        }
      })
    }
    const prevReq = () => contextReqs.filter((u) => u.searchParams.get('de') !== currentDe)
    const cases = [
      ['dia em andamento', '2025-03-26 15:32', 'periodo=dia&inicio=2025-03-26', '2025-03-26 00:00', '2025-03-25 00:00', '2025-03-25 15:32', 'vs. ontem, até 15h32'],
      ['semana em andamento (quarta)', '2025-03-26 15:32', 'periodo=semana&inicio=2025-03-24', '2025-03-24 00:00', '2025-03-17 00:00', '2025-03-19 15:32', 'vs. semana passada, até qua., 15h32'],
      ['mês em andamento (dia 26)', '2025-03-26 15:32', 'periodo=mes&inicio=2025-03-01', '2025-03-01 00:00', '2025-02-01 00:00', '2025-02-26 15:32', 'vs. mês passado, até dia 26, 15h32'],
      ['31/03 contra fevereiro: fevereiro inteiro', '2025-03-31 15:32', 'periodo=mes&inicio=2025-03-01', '2025-03-01 00:00', '2025-02-01 00:00', '2025-03-01 00:00', 'vs. mês passado inteiro'],
      ['ano em andamento', '2025-10-26 15:32', 'periodo=ano&inicio=2025-01-01', '2025-01-01 00:00', '2024-01-01 00:00', '2024-10-26 15:32', 'vs. ano passado, até 26 de out., 15h32'],
      ['29/02/2028 contra 2027: até o fim de fevereiro', '2028-02-29 10:00', 'periodo=ano&inicio=2028-01-01', '2028-01-01 00:00', '2027-01-01 00:00', '2027-03-01 00:00', 'vs. ano passado, até o fim de 28 de fev.'],
      ['semana na virada do ano (qui 01/01/2026)', '2026-01-01 09:05', 'periodo=semana&inicio=2025-12-29', '2025-12-29 00:00', '2025-12-22 00:00', '2025-12-25 09:05', 'vs. semana passada, até qui., 9h05'],
      ['período passado: o anterior inteiro', '2025-03-26 15:32', 'periodo=semana&inicio=2025-03-10', '2025-03-10 00:00', '2025-03-03 00:00', '2025-03-10 00:00', 'vs. semana anterior'],
    ]
    for (const [name, now, query, de, pde, pate, label] of cases) {
      const s = await open(now, query, de)
      const p = prevReq()
      check(`${name}: pede o anterior de ${pde} até ${pate}`, p.length >= 1 && p.every((u) => u.searchParams.get('de') === iso(pde) && u.searchParams.get('ate') === iso(pate)),
        p.map((u) => `${u.searchParams.get('de')}..${u.searchParams.get('ate')}`).join(' ') || 'nenhum pedido do anterior')
      check(`${name}: "${label}: +30min (+100%)"`, s.lines.includes(`${label}: +30min (+100%)`), JSON.stringify(s.lines))
    }
    // Média por dia: em andamento, dias decorridos contando hoje; passado, todos
    let s = await open('2025-03-26 15:32', 'periodo=mes&inicio=2025-03-01', '2025-03-01 00:00')
    check('média do mês em andamento: 1h00 / 26 dias = 2min/dia', s.lines.includes('2min/dia · 26 dias'), JSON.stringify(s.lines))
    s = await open('2025-03-26 15:32', 'periodo=semana&inicio=2025-03-10', '2025-03-10 00:00')
    check('média de semana passada: 7 dias (60/7 = 9min)', s.lines.includes('9min/dia · 7 dias'), JSON.stringify(s.lines))
    s = await open('2025-03-26 15:32', 'periodo=dia&inicio=2025-03-26', '2025-03-26 00:00')
    check('dia: sem média', !s.text.includes('/dia'), s.text.slice(0, 160))
    // Meia-noite exata: nada do anterior ainda (sem pedido inválido de = ate)
    s = await open('2025-03-26 00:00', 'periodo=dia&inicio=2025-03-26', '2025-03-26 00:00')
    check('meia-noite exata: não pede o anterior; "vs. ontem, até 0h00: novo"', prevReq().length === 0 && s.lines.includes('vs. ontem, até 0h00: novo'), JSON.stringify(s.lines))
    // Vazio agora, com tempo no anterior
    fake = { current: 0, previous: 5400 }
    s = await open('2025-03-26 15:32', 'periodo=semana&inicio=2025-03-10', '2025-03-10 00:00')
    check('período vazio com tempo no anterior: mensagem + "vs. semana anterior: sem tempo agora"', s.text.includes('Nenhum tempo dedicado nesta semana.') && s.lines.includes('vs. semana anterior: sem tempo agora'), JSON.stringify(s.lines))
    fake = { current: 0, previous: 0 }
    s = await open('2025-03-26 15:32', 'periodo=semana&inicio=2025-03-10', '2025-03-10 00:00')
    check('vazio nos dois: só a mensagem', s.text.includes('Nenhum tempo dedicado nesta semana.') && !s.text.includes('vs.'), JSON.stringify(s.lines))
    await page.close()
  }

  // ======== 2. dados do seed, relógio real
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.emulateTimezone(FUSO)
  await page.setViewport({ width: 390, height: 900 })
  const reqs = []
  page.on('request', (req) => { if (req.url().startsWith(`${API}/dashboard/`)) reqs.push(new URL(req.url())) })
  const read = () => page.evaluate(() => {
    const s = document.querySelector('section[aria-label="Tempo"]')
    const tables = [...(s?.querySelectorAll('table') ?? [])].map((t) => ({
      caption: t.querySelector('caption')?.textContent.trim(),
      head: [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
      rows: [...t.querySelectorAll('tbody tr')].map((tr) => ({
        cells: ((tds) => [tds[0]?.textContent.trim(), tds[1]?.querySelector('span.block')?.textContent.trim(), tds[1]?.querySelector('span.block + span.block')?.textContent.trim(), tds[2] ? [...tds[2].querySelectorAll('span.block')].map((b) => b.textContent.trim()).join(' ') : undefined])([...tr.children]),
        dot: !!tr.querySelector('td span[aria-hidden="true"]'),
      })),
    }))
    return { tables, lines: [...(s?.querySelectorAll(':scope > p') ?? [])].map((p) => p.textContent.replace(/\s+/g, ' ').trim()) }
  })
  const settle = async () => {
    for (let i = 0; i < 50; i++) {
      const r = await read()
      if (r.tables.length > 0 && !(await page.evaluate(() => document.body.textContent.includes('Carregando')))) return r
      await pause(100)
    }
    return read()
  }
  const today = ymdOf(new Date())
  const mon = mondayOf(today)
  // Linhas esperadas: as do período + as só do anterior, com a diferença
  const expectedRows = (cur, prev, key, name) => {
    const before = new Map(prev.map((x) => [key(x), x.seconds]))
    const present = new Set(cur.map(key))
    return [
      ...cur.map((x) => [name(x), duration(x.seconds), diffOf(x.seconds, before.get(key(x)) ?? 0)]),
      ...prev.filter((x) => !present.has(key(x))).map((x) => [name(x), duration(0), diffOf(0, x.seconds)]),
    ]
  }
  const got = (table) => (table?.rows ?? []).map((r) => [r.cells[0], r.cells[1], r.cells[3]])
  // Semanas passadas: procura uma com "novo" e uma com "sem tempo agora"
  let sawNew = false, sawGone = false, weeksChecked = 0
  const pctSeen = []
  for (let k = 1; k <= 12 && !(sawNew && sawGone && weeksChecked >= 2); k++) {
    const start = addDays(mon, -7 * k)
    const [cur, prev] = await Promise.all([
      api('tempo-por-contexto', local(start), local(addDays(start, 7))),
      api('tempo-por-contexto', local(addDays(start, -7)), local(start)),
    ])
    const exp = expectedRows(cur.items, prev.items, (x) => x.tagId ?? 'sem', (x) => nameOf(x.tagId))
    const hasNew = exp.some((r) => r[2] === 'novo'), hasGone = exp.some((r) => r[2] === 'sem tempo agora')
    if (weeksChecked >= 2 && !(hasNew && !sawNew) && !(hasGone && !sawGone)) continue
    await page.goto(`${APP}/painel?periodo=semana&inicio=${start}`, { waitUntil: 'networkidle0' })
    const r = await settle()
    const t = r.tables.find((x) => x.head[0] === 'Contexto')
    check(`semana de ${start}: cabeçalho com "vs. anterior"`, JSON.stringify(t?.head) === JSON.stringify(['Contexto', 'Tempo', 'vs. anterior']), JSON.stringify(t?.head))
    check(`semana de ${start}: linhas e diferenças = API (${exp.length} linhas)`, JSON.stringify(got(t)) === JSON.stringify(exp), `${JSON.stringify(got(t))} x ${JSON.stringify(exp)}`)
    check(`semana de ${start}: bolinha só nas linhas com tempo (${cur.items.length})`, (t?.rows ?? []).filter((x) => x.dot).length === cur.items.length && (t?.rows ?? []).every((x, i) => x.dot === (i < cur.items.length)), JSON.stringify(t?.rows.map((x) => x.dot)))
    check(`semana de ${start}: linha do total = API`, r.lines.includes(`vs. semana anterior: ${diffOf(cur.totalSeconds, prev.totalSeconds)}`), JSON.stringify(r.lines))
    pctSeen.push(...(t?.rows ?? []).map((x) => x.cells[2]))
    sawNew ||= hasNew; sawGone ||= hasGone; weeksChecked++
  }
  // Formato único (2026-10-26): 3 colunas, % do total embaixo do tempo
  check('% do total na 2ª linha do tempo, em toda linha', weeksChecked > 0 && pctSeen.length > 0 && pctSeen.every((x) => /^(<1|\d+)%$/.test(x)), JSON.stringify(pctSeen))
  check('o seed tem semana com "novo" e com "sem tempo agora" (conferidas)', sawNew && sawGone, `novo ${sawNew}, sem tempo ${sawGone}`)

  // Detalhe: subtags (Vestibular) e fases (Código) com a coluna
  const start = addDays(mon, -7)
  for (const [ctxName, kind] of [['Vestibular', 'subtag'], ['Código', 'fase']]) {
    const ctx = tags.find((t) => t.name === ctxName && t.level === 1)
    await page.goto(`${APP}/painel?periodo=semana&inicio=${start}&contexto=${ctx.id}`, { waitUntil: 'networkidle0' })
    await pause(300)
    const r = await settle()
    const route = kind === 'subtag' ? 'tempo-por-subtag' : 'tempo-por-fase'
    const [cur, prev] = await Promise.all([
      api(route, local(start), local(addDays(start, 7)), { contexto: ctx.id }),
      api(route, local(addDays(start, -7)), local(start), { contexto: ctx.id }),
    ])
    const labels = { requisitos: 'Requisitos', prototipo: 'Protótipo', validacao: 'Validação', implementacao: 'Implementação' }
    const exp = kind === 'subtag'
      ? expectedRows(cur.items, prev.items, (x) => x.tagId ?? 'sem', (x) => (x.tagId === null ? '(sem subtag)' : tags.find((t) => t.id === x.tagId)?.name))
      : expectedRows(cur.items, prev.items, (x) => x.phase ?? 'sem', (x) => (x.phase === null ? '(sem fase)' : labels[x.phase]))
    const t = r.tables.find((x) => x.head[0] === (kind === 'subtag' ? 'Subtag' : 'Fase'))
    check(`detalhe de ${ctxName}: ${kind} com "vs. anterior" = API (${exp.length} linhas)`, exp.length > 0 && JSON.stringify(got(t)) === JSON.stringify(exp), `${JSON.stringify(got(t))} x ${JSON.stringify(exp)}`)
  }

  // Semana atual: o anterior até o mesmo ponto (agora − 7 dias, mesma hora)
  reqs.length = 0
  const before = Date.now()
  await page.goto(`${APP}/painel`, { waitUntil: 'networkidle0' })
  const r = await settle()
  const prevReq = reqs.find((u) => u.pathname.endsWith('tempo-por-contexto') && u.searchParams.get('de') === local(addDays(mon, -7)).toISOString())
  const ate = new Date(prevReq?.searchParams.get('ate') ?? 0)
  check('semana atual: o anterior vai até agora − 7 dias', prevReq && ate.getTime() >= before - 7 * 86400e3 && ate.getTime() <= Date.now() - 7 * 86400e3, `${prevReq?.search}`)
  const [cur, prev] = await Promise.all([
    api('tempo-por-contexto', local(mon), local(addDays(mon, 7))),
    api('tempo-por-contexto', local(addDays(mon, -7)), ate),
  ])
  const line = r.lines.find((l) => l.startsWith('vs. semana passada, até '))
  // a sessão rodando do seed cresce entre o pedido da tela e o daqui: aceita
  // o total de qualquer segundo do último minuto (o % é pelos segundos: uma
  // tolerância só de minuto deu "+400%" na tela x "+401%" aqui)
  const okLine = Array.from({ length: 61 }, (_, k) => cur.totalSeconds - k).some((c) => line?.endsWith(`: ${diffOf(c, prev.totalSeconds)}`))
  check('semana atual: "vs. semana passada, até <dia>, <hora>: <diferença>" = API', !!line && okLine, `${line} x ${diffOf(cur.totalSeconds, prev.totalSeconds)}`)
  const dayCount = Math.round((local(today) - local(mon)) / 86400e3) + 1
  check(`semana atual: média com ${dayCount} dia(s) decorridos`, r.lines.some((l) => l.endsWith(`/dia · ${dayCount} ${dayCount === 1 ? 'dia' : 'dias'}`)), JSON.stringify(r.lines))
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
