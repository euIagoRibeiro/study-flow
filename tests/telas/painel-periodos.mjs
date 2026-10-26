// D5b: Dia e Ano no seletor (Dia | Semana | Mês | Ano). Dia: total, pizza e
// tabela, sem barras (e sem pedir o período). Ano: 12 barras por mês SEM valor
// em cima + tabela mês a mês. URL, rótulos, anterior/próximo e a troca de tipo.
// Compara com a API do mesmo período. Só lê: nada é gravado.
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
// Datas locais de Brasília (−03) sem depender do fuso desta máquina
const local = (ymd) => new Date(`${ymd}T00:00:00-03:00`)
const ymdOf = (d) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10)
const addDays = (ymd, n) => ymdOf(new Date(local(ymd).getTime() + n * 86400e3 + 12 * 3600e3))
const mondayOf = (ymd) => addDays(ymd, -((new Date(local(ymd).getTime() + 12 * 3600e3).getUTCDay() + 6) % 7))
const todayYmd = ymdOf(new Date())
const year = Number(todayYmd.slice(0, 4))
const api = async (route, start, end, extra = {}) =>
  (await fetch(`${API}/dashboard/${route}?${new URLSearchParams({ de: local(start).toISOString(), ate: local(end).toISOString(), fuso: FUSO, ...extra })}`)).json()
const dayLabel = (ymd, withYear) => new Date(`${ymd}T12:00:00-03:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: FUSO, ...(withYear ? { year: 'numeric' } : {}) })
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

const tags = await (await fetch(`${API}/tags`)).json()
const nameOf = (id) => (id === null ? '(sem tag)' : tags.find((t) => t.id === id)?.name)
const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.emulateTimezone(FUSO)
  await page.setViewport({ width: 390, height: 900 })
  const requests = []
  page.on('request', (req) => { if (req.url().startsWith(`${API}/dashboard/`)) requests.push(new URL(req.url())) })
  const screen = () => page.evaluate(() => {
    const s = document.querySelector('section[aria-label="Tempo"]')
    const tables = [...(s?.querySelectorAll('table') ?? [])].map((t) => ({
      caption: t.querySelector('caption')?.textContent.trim(),
      head: [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
      rows: [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim())),
    }))
    const bars = s?.querySelector('svg[role="img"][aria-label^="Barras"]')
    return {
      chips: [...document.querySelectorAll('button[aria-pressed]')].map((b) => [b.textContent.trim(), b.getAttribute('aria-pressed')]),
      period: document.querySelector('[role="group"][aria-label="Navegar no período"] p')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
      total: [...(s?.querySelectorAll('dt') ?? [])].find((dt) => dt.textContent.trim() === 'Tempo dedicado')?.nextElementSibling?.textContent.trim() ?? null,
      text: s?.textContent.replace(/\s+/g, ' ') ?? '',
      headings: [...(s?.querySelectorAll('h3') ?? [])].map((h) => h.textContent.trim()),
      pie: !!s?.querySelector('svg[role="img"][aria-label^="Pizza"]'),
      bars: bars ? { label: bars.getAttribute('aria-label'), rects: bars.querySelectorAll('rect').length, texts: [...bars.querySelectorAll('text')].map((t) => t.textContent) } : null,
      tables,
      url: location.pathname + location.search,
      nextDisabled: document.querySelector('button[aria-label="Próximo período"]')?.disabled ?? null,
    }
  })
  const settle = async () => {
    for (let i = 0; i < 40; i++) {
      const s = await screen()
      if (s.total !== null || /Nenhum tempo|Não foi possível/.test(s.text)) return s
      await pause(100)
    }
    return screen()
  }
  const click = (text) => page.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t).click(), text)
  const contextTable = (s) => s.tables.find((t) => t.head[0] === 'Contexto')
  const matches = (label, s, apiBody) => {
    check(`${label}: total = API (${duration(apiBody.totalSeconds)})`, s.total === duration(apiBody.totalSeconds), `${s.total}`)
    const got = (contextTable(s)?.rows ?? []).map((r) => [r[0], r[1]])
    const expected = apiBody.items.map((x) => [nameOf(x.tagId), duration(x.seconds)])
    check(`${label}: tabela por contexto = API`, JSON.stringify(got) === JSON.stringify(expected), `${JSON.stringify(got)} x ${JSON.stringify(expected)}`)
  }

  // ---- seletor com os 4 tipos
  await page.goto(`${APP}/painel`, { waitUntil: 'networkidle0' })
  let s = await settle()
  check('seletor: Dia | Semana | Mês | Ano, Semana marcada por padrão', JSON.stringify(s.chips) === JSON.stringify([['Dia', 'false'], ['Semana', 'true'], ['Mês', 'false'], ['Ano', 'false']]), JSON.stringify(s.chips))

  // ---- Dia (hoje)
  requests.length = 0
  await click('Dia')
  s = await settle()
  check('Dia: URL ?periodo=dia&inicio=<hoje>', s.url === `/painel?periodo=dia&inicio=${todayYmd}`, s.url)
  check('Dia: rótulo "dia da semana, dia de mês" sem o ano', s.period === dayLabel(todayYmd, false), `${s.period} x ${dayLabel(todayYmd, false)}`)
  const hoje = await api('tempo-por-contexto', todayYmd, addDays(todayYmd, 1))
  matches('Dia (hoje)', s, hoje)
  check('Dia: hoje tem tempo no seed (o caso não é vazio)', hoje.totalSeconds > 0, `${hoje.totalSeconds}`)
  check('Dia: pizza, e nenhuma barra nem título "Por …"', s.pie && s.bars === null && !s.headings.some((h) => h.startsWith('Por ')), JSON.stringify(s.headings))
  const dayReq = requests.filter((r) => r.pathname.endsWith('tempo-por-contexto')).at(-1)
  check('Dia: pedido da meia-noite de hoje à de amanhã', dayReq?.searchParams.get('de') === local(todayYmd).toISOString() && dayReq.searchParams.get('ate') === local(addDays(todayYmd, 1)).toISOString(), dayReq?.search)
  check('Dia: não pede o tempo por período', !requests.some((r) => r.pathname.endsWith('tempo-por-periodo')), requests.map((r) => r.pathname).join(' '))
  check('Dia: próximo desabilitado hoje', s.nextDisabled === true)
  await page.evaluate(() => document.querySelector('button[aria-label="Período anterior"]').click())
  s = await settle()
  const ontem = addDays(todayYmd, -1)
  check('Dia anterior: URL com ontem', s.url === `/painel?periodo=dia&inicio=${ontem}`, s.url)
  matches('Dia (ontem)', s, await api('tempo-por-contexto', ontem, todayYmd))
  check('Dia anterior: próximo habilitado', s.nextDisabled === false)
  await page.goto(`${APP}/painel?periodo=dia&inicio=2025-01-06`, { waitUntil: 'networkidle0' })
  s = await settle()
  check('Dia sem tempo: "Nenhum tempo dedicado neste dia."', s.text.includes('Nenhum tempo dedicado neste dia.'), s.text.slice(0, 120))
  check('Dia de outro ano: rótulo com o ano', s.period === dayLabel('2025-01-06', true), `${s.period} x ${dayLabel('2025-01-06', true)}`)
  // virada do ano no "próximo" e no "anterior"
  await page.goto(`${APP}/painel?periodo=dia&inicio=2025-12-31`, { waitUntil: 'networkidle0' })
  await settle()
  await page.evaluate(() => document.querySelector('button[aria-label="Próximo período"]').click())
  s = await settle()
  check('Dia: próximo de 31/12 é 01/01', s.url === '/painel?periodo=dia&inicio=2026-01-01', s.url)

  // ---- Ano (atual)
  await page.goto(`${APP}/painel`, { waitUntil: 'networkidle0' })
  await settle()
  requests.length = 0
  await click('Ano')
  s = await settle()
  check('Ano: URL ?periodo=ano&inicio=<1º de janeiro>', s.url === `/painel?periodo=ano&inicio=${year}-01-01`, s.url)
  check('Ano: rótulo é só o ano', s.period === String(year), s.period)
  const anoApi = await api('tempo-por-contexto', `${year}-01-01`, `${year + 1}-01-01`)
  matches('Ano', s, anoApi)
  const meses = await api('tempo-por-periodo', `${year}-01-01`, `${year + 1}-01-01`, { por: 'mes' })
  const yReq = requests.find((r) => r.pathname.endsWith('tempo-por-periodo'))
  check('Ano: pede por=mes, de 1º/01 a 1º/01 do ano seguinte', yReq?.searchParams.get('por') === 'mes' && yReq.searchParams.get('de') === local(`${year}-01-01`).toISOString() && yReq.searchParams.get('ate') === local(`${year + 1}-01-01`).toISOString(), yReq?.search)
  check('Ano: título "Por mês"', s.headings.includes('Por mês'), JSON.stringify(s.headings))
  check('Ano: 12 barras com rótulos jan…dez e NENHUM valor em cima', s.bars?.rects === 12 &&
    JSON.stringify(s.bars.texts) === JSON.stringify(['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']), JSON.stringify(s.bars))
  check('Ano: rótulo das barras aponta pra tabela', /tabela/.test(s.bars?.label ?? ''), s.bars?.label)
  const monthTable = s.tables.find((t) => t.head[0] === 'Mês')
  const expectedMonths = meses.items.map((x, i) => [MONTHS[i], duration(x.seconds)])
  check('Ano: tabela mês a mês = API (12 linhas, por extenso)', JSON.stringify(monthTable?.rows.map((r) => [r[0], r[1]])) === JSON.stringify(expectedMonths), `${JSON.stringify(monthTable?.rows)} x ${JSON.stringify(expectedMonths)}`)
  check('Ano: tabela de meses soma o total', meses.items.reduce((a, x) => a + x.seconds, 0) === anoApi.totalSeconds)
  check('Ano: tabela de meses depois das barras', s.tables.indexOf(monthTable) === s.tables.length - 1)
  check('Ano: próximo desabilitado no ano atual', s.nextDisabled === true)
  await page.evaluate(() => document.querySelector('button[aria-label="Período anterior"]').click())
  s = await settle()
  check('Ano anterior: URL e rótulo', s.url === `/painel?periodo=ano&inicio=${year - 1}-01-01` && s.period === String(year - 1), `${s.url} ${s.period}`)
  check('Ano sem tempo (o seed não tem ano passado): "Nenhum tempo dedicado neste ano."', s.text.includes('Nenhum tempo dedicado neste ano.'), s.text.slice(0, 120))

  // ---- início no meio do período cai no começo; troca de tipo
  requests.length = 0
  await page.goto(`${APP}/painel?periodo=ano&inicio=${year}-07-15`, { waitUntil: 'networkidle0' })
  s = await settle()
  check('Ano com início no meio: pede a partir de 1º/01', requests.some((r) => r.searchParams.get('de') === local(`${year}-01-01`).toISOString()), requests.map((r) => r.search).join(' '))
  await page.goto(`${APP}/painel?periodo=dia&inicio=2025-03-26`, { waitUntil: 'networkidle0' })
  await settle()
  await click('Semana')
  s = await settle()
  check('Dia passado → Semana: a semana que contém o dia (24/03)', s.url === '/painel?periodo=semana&inicio=2025-03-24', s.url)
  await click('Ano')
  s = await settle()
  check('Semana passada → Ano: o ano dela', s.url === '/painel?periodo=ano&inicio=2025-01-01', s.url)
  await click('Mês')
  s = await settle()
  check('Ano passado → Mês: janeiro dele', s.url === '/painel?periodo=mes&inicio=2025-01-01', s.url)
  await page.goto(`${APP}/painel?periodo=ano&inicio=${year}-01-01`, { waitUntil: 'networkidle0' })
  await settle()
  await click('Dia')
  s = await settle()
  check('Ano atual → Dia: hoje', s.url === `/painel?periodo=dia&inicio=${todayYmd}`, s.url)
  await page.goto(`${APP}/painel?periodo=dia&inicio=2025-02-30`, { waitUntil: 'networkidle0' })
  s = await settle()
  check('Dia inválido (30/02): cai na semana atual', s.url.includes('2025-02-30') && s.period?.includes(String(Number(mondayOf(todayYmd).slice(8)))) && s.chips.find((c) => c[0] === 'Semana')?.[1] === 'true', `${s.period} ${JSON.stringify(s.chips)}`)
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
