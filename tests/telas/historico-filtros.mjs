// Histórico: os filtros que já existiam (Período e Frequência), fixados ANTES do filtro por dia (?dia=, commit C2).
// Respostas INJETADAS de GET /executions e GET /time-entries (nada é gravado), fuso fixo America/Sao_Paulo. O esperado
// sai de contas de data feitas aqui (Intl e texto), nunca de matchesPeriod nem de localDayKey do app.
// 1) estado inicial; 2) cada chip de Período × cada Frequência (25 combinações): quais registros aparecem; 3) a Frequência
// filtra pelo snapshot (taskFrequencyAtTime), não pela frequência atual da tarefa; 4) mensagem de lista vazia;
// 5) o registro aberto não aparece; 6) o estado fica só na tela (URL sem query; ir à Lista e voltar reinicia).
// Uso: node --env-file=backend/.env tests/telas/historico-filtros.mjs
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

const executions = await (await apiFetch(`${API}/executions`)).json()
const tasks = await (await apiFetch(`${API}/tasks`)).json()
const template = executions.find((e) => e.completedAt !== null)
if (!template) throw new Error('seed sem registro concluído (o molde das respostas)')

// Dia local de hoje (Intl, fuso fixo) e contas de dia em texto
const TZ = 'America/Sao_Paulo'
const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
const addDays = (key, n) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// Registros nas bordas de cada período (dia local, hora local, frequência do snapshot)
const RECORDS = [
  ['hf hoje 00:30', 0, '00:30:00', 'none'],
  ['hf hoje 07:00', 0, '07:00:00', 'daily'],
  ['hf ontem 23:30', -1, '23:30:00', 'weekly'],
  ['hf 6 dias 00:30', -6, '00:30:00', 'none'],
  ['hf 7 dias 23:30', -7, '23:30:00', 'daily'],
  ['hf 15 dias', -15, '12:00:00', 'monthly'],
  ['hf 45 dias', -45, '12:00:00', 'none'],
  ['hf 200 dias', -200, '12:00:00', 'weekly'],
  ['hf 400 dias', -400, '12:00:00', 'daily'],
].map(([title, offset, time, frequency], i) => {
  const day = addDays(todayKey, offset)
  return { title, day, frequency, execution: {
    ...template, id: id(i + 1), taskTitleAtTime: title, taskFrequencyAtTime: frequency, description: null,
    completedAt: new Date(`${day}T${time}-03:00`).toISOString(),
    rootTagId: null, tagIds: [], phase: null, measure: null, workout: null, selections: [], workId: null, linkUrl: null,
  } }
})
const openRecord = { ...RECORDS[0].execution, id: id(900), taskTitleAtTime: 'hf aberto', completedAt: null }
const bodies = { '/api/executions': [...RECORDS.map((r) => r.execution), openRecord], '/api/time-entries': [] }

// O esperado de cada período, por dia local (texto)
const inPeriod = {
  all: () => true,
  today: (day) => day === todayKey,
  '7d': (day) => day >= addDays(todayKey, -6),
  month: (day) => day.slice(0, 7) === todayKey.slice(0, 7),
  year: (day) => day.slice(0, 4) === todayKey.slice(0, 4),
}
const PERIODS = [['Tudo', 'all'], ['Hoje', 'today'], ['7 dias', '7d'], ['Este mês', 'month'], ['Este ano', 'year']]
const FREQUENCIES = ['all', 'none', 'daily', 'weekly', 'monthly']
const expectedTitles = (period, frequency) =>
  RECORDS.filter((r) => inPeriod[period](r.day) && (frequency === 'all' || r.frequency === frequency)).map((r) => r.title).sort()

let browser
try {
  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.emulateTimezone(TZ)
  await page.setViewport({ width: 390, height: 900 })
  const writes = []
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      writes.push(`${req.method()} ${req.url()}`)
      return req.abort()
    }
    const path = new URL(req.url()).pathname
    if (bodies[path]) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(bodies[path]) })
    req.continue()
  })

  const open = async () => {
    await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('main article')
  }
  const state = () => page.evaluate(() => ({
    titles: [...document.querySelectorAll('main article h4')].map((h) => h.textContent.trim()).sort(),
    cards: document.querySelectorAll('main article').length,
    pressed: [...document.querySelectorAll('[role="group"][aria-label="Período"] button')]
      .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()),
    chips: [...document.querySelectorAll('[role="group"][aria-label="Período"] button')].map((b) => b.textContent.trim()),
    frequency: document.querySelector('select[aria-label="Frequência"]')?.value ?? null,
    empty: [...document.querySelectorAll('main p')].some((p) => p.textContent.trim() === 'Nenhuma execução encontrada com esses filtros.'),
    where: location.pathname + location.search,
  }))
  const pickPeriod = async (label) => {
    await page.evaluate((text) => {
      [...document.querySelectorAll('[role="group"][aria-label="Período"] button')].find((b) => b.textContent.trim() === text).click()
    }, label)
    await pause(60)
  }
  const pickFrequency = async (value) => {
    await page.select('select[aria-label="Frequência"]', value)
    await pause(60)
  }

  // ---------- 1. estado inicial
  await open()
  let s = await state()
  check('os 5 chips de Período, na ordem', s.chips.join('|') === 'Tudo|Hoje|7 dias|Este mês|Este ano', s.chips.join('|'))
  check('estado inicial: "Tudo" marcado e só ele', s.pressed.join('|') === 'Tudo', s.pressed.join('|'))
  check('estado inicial: Frequência "Todas"', s.frequency === 'all', s.frequency)
  check('estado inicial: todos os registros concluídos, e só eles', s.titles.join('|') === expectedTitles('all', 'all').join('|'), s.titles.join('|'))
  check('o registro aberto não aparece', !s.titles.includes('hf aberto'))
  check('estado inicial: URL sem query', s.where === '/historico', s.where)
  check('as bordas dos dados de teste existem (hoje, 7 dias e mês têm menos que tudo)',
    expectedTitles('today', 'all').length < expectedTitles('7d', 'all').length && expectedTitles('7d', 'all').length < RECORDS.length)

  // ---------- 2. 5 períodos × 5 frequências
  let combos = 0
  const wrong = []
  const emptyWrong = []
  for (const [label, period] of PERIODS) {
    await pickPeriod(label)
    for (const frequency of FREQUENCIES) {
      await pickFrequency(frequency)
      const now = await state()
      const want = expectedTitles(period, frequency)
      combos++
      if (now.titles.join('|') !== want.join('|')) wrong.push(`${label}+${frequency}: ${now.titles.join(',')} ≠ ${want.join(',')}`)
      if (now.empty !== (want.length === 0)) emptyWrong.push(`${label}+${frequency}: mensagem ${now.empty}, esperado ${want.length === 0}`)
      if (now.pressed.join('|') !== label || now.frequency !== frequency) wrong.push(`${label}+${frequency}: marcas ${now.pressed} / ${now.frequency}`)
    }
  }
  check('as 25 combinações de Período × Frequência percorridas', combos === 25, `${combos}`)
  check('cada combinação mostra exatamente os registros esperados (e as marcas dos controles acompanham)', wrong.length === 0, wrong.slice(0, 3).join(' || '))
  check('a mensagem de lista vazia aparece quando não há registro, e só então', emptyWrong.length === 0, emptyWrong.slice(0, 3).join(' || '))
  const emptyCombos = PERIODS.flatMap(([, period]) => FREQUENCIES.filter((f) => expectedTitles(period, f).length === 0).map((f) => `${period}+${f}`))
  check('pelo menos uma combinação vazia e uma cheia foram exercitadas', emptyCombos.length > 0 && emptyCombos.length < 25, emptyCombos.join(','))

  // ---------- 3. a Frequência filtra pelo snapshot, não pela frequência atual da tarefa
  const currentFrequency = tasks.find((t) => t.id === template.taskId)?.frequency
  const snapshots = new Set(RECORDS.map((r) => r.frequency))
  check('a tarefa do molde tem UMA frequência atual, e os registros têm 4 snapshots diferentes (o filtro só passa pelo snapshot)',
    currentFrequency !== undefined && snapshots.size === 4 && [...snapshots].some((f) => f !== currentFrequency))
  await pickPeriod('Tudo')
  await pickFrequency('weekly')
  s = await state()
  check('Frequência "Semanal" mostra os dois registros com snapshot semanal, mesmo com a tarefa em outra frequência', s.titles.join('|') === ['hf 200 dias', 'hf ontem 23:30'].join('|'), s.titles.join('|'))

  // ---------- 4. a URL não muda com os filtros; ir à Lista e voltar reinicia
  check('depois de mexer nos filtros, a URL continua sem query', (await state()).where === '/historico')
  await page.evaluate(() => [...document.querySelectorAll('nav a')].find((a) => a.textContent.trim() === 'Lista').click())
  await pause(300)
  await page.evaluate(() => [...document.querySelectorAll('nav a')].find((a) => a.textContent.trim() === 'Histórico').click())
  await page.waitForSelector('main article')
  s = await state()
  check('voltar ao Histórico pela aba reinicia: "Tudo" e "Todas"', s.pressed.join('|') === 'Tudo' && s.frequency === 'all', `${s.pressed} / ${s.frequency}`)

  // ---------- 5. mensagem com a lista toda vazia
  bodies['/api/executions'] = []
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await pause(300)
  s = await state()
  check('sem nenhum registro, a mensagem de lista vazia aparece e não há cartões', s.empty && s.cards === 0, JSON.stringify({ empty: s.empty, cards: s.cards }))

  check('nada foi gravado (todo pedido que não é de leitura foi abortado, e nenhum saiu)', writes.length === 0, writes.join(' | '))
} finally {
  await browser?.close().catch(() => {})
}

const ok = results.filter(Boolean).length
console.log(`\n${ok} de ${results.length}`)
process.exitCode = ok === results.length ? 0 : 1
