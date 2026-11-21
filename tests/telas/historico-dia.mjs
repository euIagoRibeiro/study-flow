// Histórico: filtro por dia (?dia=AAAA-MM-DD, commit C2). O dia é o dia LOCAL do "Quando" do registro (o mesmo do agrupamento).
// 1) o filtro: contagem de cada dia conferida contra a API por Intl (fuso fixo America/Sao_Paulo), inclusive um registro
// criado AQUI de ontem às 22:30 locais (= hoje 01:30 UTC: o dia local e o dia UTC diferem); 2) rótulo "Dia: …" e "Limpar";
// 3) ?dia= inválido: ignorado sem erro e sem reescrever a URL; 4) o dia substitui o Período (nenhum chip marcado) e a Frequência
// continua valendo; 5) tocar em QUALQUER chip de Período (até no que já está guardado, e com o dia inválido) remove o
// parâmetro; 6) mensagens de dia vazio; 7) "Limpar": remove só o parâmetro (replace, a Frequência fica), foco no chip do
// Período; 8) recarregar mantém o dia, voltar do navegador restaura, a aba do menu abre sem dia.
// Cria um registro e o apaga no finally (contagens do banco conferidas antes e depois).
// Uso: node --env-file=backend/.env tests/telas/historico-dia.mjs
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'
import { deleteExecutions } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) throw new Error('rodar com --env-file=../backend/.env (npm run telas)')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const counts = async () => (await pool.query(
  `SELECT (SELECT count(*) FROM tasks)::int AS tasks, (SELECT count(*) FROM task_executions)::int AS executions,
          (SELECT count(*) FROM time_entries)::int AS entries`)).rows[0]

// ---- contas de data feitas aqui (Intl e texto), nunca com o código do app
const TZ = 'America/Sao_Paulo'
const keyOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso))
const todayKey = keyOf(new Date().toISOString())
const addDays = (key, n) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const labelOf = (key) => {
  if (key === todayKey) return 'hoje'
  if (key === addDays(todayKey, -1)) return 'ontem'
  const [y, m, d] = key.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${weekday}, ${d} ${MONTHS[m - 1]}${y === Number(todayKey.slice(0, 4)) ? '' : ` ${y}`}`
}
const yesterday = addDays(todayKey, -1)
const NIGHT = `${yesterday}T22:30:00-03:00`
const MARK = 'hd noite de ontem'

const before = await counts()
let browser
let createdId = null
try {
  const tasks = await (await apiFetch(`${API}/tasks`)).json()
  const task = tasks.find((t) => t.title === 'Exercício físico')
  if (!task) throw new Error('o seed não tem "Exercício físico" (reseed?)')
  const created = await apiFetch(`${API}/executions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: task.id, description: MARK, completedAt: new Date(NIGHT).toISOString() }),
  })
  if (created.status !== 201) throw new Error(`criar o registro de teste: ${created.status} ${await created.text()}`)
  createdId = (await created.json()).id
  check('o registro de teste (ontem 22:30 locais) cai em dias diferentes no fuso local e em UTC',
    keyOf(NIGHT) === yesterday && new Date(NIGHT).toISOString().slice(0, 10) === todayKey, `${keyOf(NIGHT)} / ${new Date(NIGHT).toISOString()}`)

  const all = (await (await apiFetch(`${API}/executions`)).json()).filter((e) => e.completedAt !== null)
  const ofDay = (key, frequency = 'all') => all.filter((e) => keyOf(e.completedAt) === key && (frequency === 'all' || e.taskFrequencyAtTime === frequency))
  // um dia mais antigo com 2 registros ou mais (do seed), fora de hoje e de ontem
  const byDay = new Map()
  for (const e of all) byDay.set(keyOf(e.completedAt), (byDay.get(keyOf(e.completedAt)) ?? 0) + 1)
  const busyDay = [...byDay].filter(([k, n]) => n >= 2 && k < yesterday).sort((a, b) => (a[0] < b[0] ? 1 : -1))[0]?.[0]
  if (!busyDay) throw new Error('o seed não tem um dia antigo com 2 registros')
  const dailyDay = [...byDay.keys()].find((k) => ofDay(k, 'daily').length > 0 && ofDay(k, 'daily').length < ofDay(k).length)
  check('os dados de teste existem: ontem tem o registro criado, há um dia antigo com 2+ e um dia com frequências misturadas',
    ofDay(yesterday).some((e) => e.description === MARK) && byDay.get(busyDay) >= 2 && dailyDay !== undefined, `${busyDay} ${dailyDay}`)

  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.emulateTimezone(TZ)
  await page.setViewport({ width: 390, height: 900 })
  const writes = []
  let empty = false
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      writes.push(`${req.method()} ${req.url()}`)
      return req.abort()
    }
    if (empty && new URL(req.url()).pathname === '/api/executions') {
      return req.respond({ status: 200, contentType: 'application/json', body: '[]' })
    }
    req.continue()
  })
  const open = async (query) => {
    await page.goto(`${APP}/historico${query}`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => document.querySelector('main article') || document.querySelector('main p'))
    await settle()
  }
  const state = () => page.evaluate(() => {
    const dayRow = [...document.querySelectorAll('main span')].find((s) => s.textContent.startsWith('Dia:'))
    const clear = document.querySelector('button[aria-label="Limpar filtro do dia"]')
    return {
      cards: document.querySelectorAll('main article').length,
      descriptions: [...document.querySelectorAll('main article')].map((a) => a.textContent),
      pressed: [...document.querySelectorAll('[role="group"][aria-label="Período"] button')]
        .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()),
      dayRow: dayRow?.textContent.replace(/\s+/g, ' ').trim() ?? null,
      clear: clear ? { text: clear.textContent.trim(), height: Math.round(clear.getBoundingClientRect().height) } : null,
      frequency: document.querySelector('select[aria-label="Frequência"]')?.value ?? null,
      message: [...document.querySelectorAll('main p')].map((p) => p.textContent.trim()).find((t) => /^Nenhum/.test(t)) ?? null,
      groups: [...document.querySelectorAll('main section h3 span:first-child')].map((s) => s.textContent.trim()),
      where: location.pathname + location.search,
      active: document.activeElement?.textContent?.trim() ?? null,
      historyLength: history.length,
    }
  })
  // Espera a tela parar de mudar: duas leituras iguais seguidas (redesenhar 100+ cartões leva mais que uma pausa fixa)
  const settle = async () => {
    const read = () => page.evaluate(() => JSON.stringify([
      location.search, document.querySelectorAll('main article').length,
      [...document.querySelectorAll('[role="group"][aria-label="Período"] button[aria-pressed="true"]')].map((b) => b.textContent),
      !!document.querySelector('button[aria-label="Limpar filtro do dia"]'),
      [...document.querySelectorAll('main p')].map((p) => p.textContent).join('|'),
    ]))
    let last = await read()
    for (let i = 0; i < 50; i++) {
      await pause(120)
      const now = await read()
      if (now === last) return
      last = now
    }
    throw new Error('a tela não parou de mudar em 6 s')
  }
  const tapChip = async (label) => {
    await page.evaluate((text) => [...document.querySelectorAll('[role="group"][aria-label="Período"] button')].find((b) => b.textContent.trim() === text).click(), label)
    // o redesenho vem depois da URL: espera o chip marcado e a linha do dia sumida, e então a tela parar
    await page.waitForFunction((text) => !document.querySelector('button[aria-label="Limpar filtro do dia"]') &&
      [...document.querySelectorAll('[role="group"][aria-label="Período"] button')].some((b) => b.textContent.trim() === text && b.getAttribute('aria-pressed') === 'true'), { timeout: 3000 }, label).catch(() => {})
    await settle()
  }
  const pickFrequency = async (value) => { await page.select('select[aria-label="Frequência"]', value); await settle() }

  // ---------- 1. o filtro e o rótulo
  const allCount = all.length
  await open(`?dia=${yesterday}`)
  let s = await state()
  check('ontem: a contagem confere com a API (por Intl) e inclui o registro de 22:30', s.cards === ofDay(yesterday).length && s.descriptions.some((t) => t.includes(MARK)), `${s.cards} / ${ofDay(yesterday).length}`)
  check('ontem: o grupo do dia é "Ontem" e é o único', s.groups.join('|') === 'Ontem', s.groups.join('|'))
  check('rótulo "Dia: ontem" e botão "Limpar"', s.dayRow === 'Dia: ontem' && s.clear?.text === 'Limpar', `${s.dayRow} / ${s.clear?.text}`)
  check('o botão "Limpar" tem 44 px de altura', (s.clear?.height ?? 0) >= 44, `${s.clear?.height}`)
  check('com o dia ativo nenhum chip de Período está marcado', s.pressed.length === 0, s.pressed.join('|'))
  check('a URL não muda ao abrir', s.where === `/historico?dia=${yesterday}`, s.where)

  await open(`?dia=${todayKey}`)
  s = await state()
  check('hoje (o dia UTC do registro de 22:30): só os de hoje, SEM o registro de ontem à noite', s.cards === ofDay(todayKey).length && !s.descriptions.some((t) => t.includes(MARK)), `${s.cards} / ${ofDay(todayKey).length}`)
  check('rótulo "Dia: hoje"', s.dayRow === 'Dia: hoje', s.dayRow)

  await open(`?dia=${busyDay}`)
  s = await state()
  check(`um dia antigo (${busyDay}): contagem e rótulo "${labelOf(busyDay)}"`, s.cards === byDay.get(busyDay) && s.dayRow === `Dia: ${labelOf(busyDay)}`, `${s.cards} / ${s.dayRow}`)
  check('o dia antigo mostra um grupo só', s.groups.length === 1, s.groups.join('|'))

  // ---------- 2. a Frequência continua valendo
  await open(`?dia=${dailyDay}`)
  await pickFrequency('daily')
  s = await state()
  check('dia + Frequência "Diária": só os registros do dia com esse snapshot', s.cards === ofDay(dailyDay, 'daily').length && s.cards < ofDay(dailyDay).length, `${s.cards} / ${ofDay(dailyDay, 'daily').length}`)
  check('a linha do dia continua e o parâmetro também', s.dayRow === `Dia: ${labelOf(dailyDay)}` && s.where === `/historico?dia=${dailyDay}`, `${s.dayRow} / ${s.where}`)

  // ---------- 3. ?dia= inválido: ignorado, sem erro, sem reescrever a URL
  for (const bad of ['2026-02-30', 'lixo', '', '2026-11-1', '2026-13-01', '2026-11-20T10:00', 'a&dia=b']) {
    await open(`?dia=${bad}`)
    s = await state()
    check(`?dia=${bad || '(vazio)'}: tudo aparece, "Tudo" marcado, sem linha do dia e sem erro`,
      s.cards === allCount && s.pressed.join('|') === 'Tudo' && s.dayRow === null && s.clear === null && s.message === null, `${s.cards}/${allCount} ${s.pressed} ${s.dayRow} ${s.message}`)
    check(`?dia=${bad || '(vazio)'}: a URL não é reescrita`, s.where === `/historico?dia=${bad}`, s.where)
  }
  await open('?dia=2026-02-30')
  await tapChip('Hoje')
  s = await state()
  check('com o dia inválido, tocar num chip remove o parâmetro (e o chip vale)', s.where === '/historico' && s.pressed.join('|') === 'Hoje' && s.cards === ofDay(todayKey).length, `${s.where} ${s.pressed} ${s.cards}`)

  // ---------- 4. tocar em qualquer chip de Período tira o dia
  await open(`?dia=${busyDay}`)
  await tapChip('Hoje')
  s = await state()
  check('dia válido + chip "Hoje": parâmetro removido, "Hoje" marcado, registros de hoje', s.where === '/historico' && s.pressed.join('|') === 'Hoje' && s.dayRow === null && s.cards === ofDay(todayKey).length, `${s.where} ${s.pressed} ${s.cards}`)
  await open(`?dia=${busyDay}`)
  await tapChip('Tudo')
  s = await state()
  check('toque no chip igual ao atual ("Tudo"): o parâmetro dia saiu da URL', !s.where.includes('dia='), s.where)
  check('dia válido + chip "Tudo" (o que já era o Período guardado): também remove o parâmetro', s.where === '/historico' && s.pressed.join('|') === 'Tudo' && s.dayRow === null && s.cards === allCount, `${s.where} ${s.pressed} ${s.cards}`)
  await open('?dia=lixo')
  await tapChip('Tudo')
  s = await state()
  check('dia inválido + chip "Tudo" (o já guardado): remove o parâmetro', s.where === '/historico', s.where)

  // ---------- 5. mensagens de dia vazio (resposta injetada: nenhum registro)
  empty = true
  for (const [key, want] of [[todayKey, 'Nenhum registro hoje.'], [yesterday, 'Nenhum registro ontem.'], ['2000-01-01', 'Nenhum registro em sáb, 1 jan 2000.']]) {
    await open(`?dia=${key}`)
    s = await state()
    check(`dia vazio ${key}: "${want}", com a linha do dia e o "Limpar"`, s.message === want && s.cards === 0 && s.dayRow !== null && s.clear !== null, `${s.message} / ${s.dayRow}`)
  }
  await open(`?dia=${todayKey}`)
  await pickFrequency('weekly')
  s = await state()
  check('dia vazio com Frequência: "Nenhum registro hoje com essa frequência."', s.message === 'Nenhum registro hoje com essa frequência.', s.message)
  await open('')
  s = await state()
  check('sem dia, a mensagem antiga continua a mesma', s.message === 'Nenhuma execução encontrada com esses filtros.', s.message)
  empty = false

  // ---------- 6. "Limpar"
  await open(`?dia=${busyDay}`)
  await pickFrequency('daily')
  const lengthBefore = (await state()).historyLength
  await page.evaluate(() => document.querySelector('button[aria-label="Limpar filtro do dia"]').click())
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Limpar filtro do dia"]'), { timeout: 3000 }).catch(() => {})
  await settle()
  s = await state()
  check('Limpar: o parâmetro dia saiu da URL', !s.where.includes('dia='), s.where)
  check('Limpar: parâmetro removido, sem linha do dia, "Tudo" marcado de volta', s.where === '/historico' && s.dayRow === null && s.pressed.join('|') === 'Tudo', `${s.where} ${s.dayRow} ${s.pressed}`)
  check('Limpar mantém a Frequência escolhida e filtra por ela', s.frequency === 'daily' && s.cards === all.filter((e) => e.taskFrequencyAtTime === 'daily').length, `${s.frequency} ${s.cards}`)
  check('Limpar troca a entrada do histórico (replace): o tamanho do histórico não cresce', s.historyLength === lengthBefore, `${lengthBefore} → ${s.historyLength}`)
  check('o foco vai ao chip do Período que volta a valer ("Tudo")', s.active === 'Tudo', s.active)

  // ---------- 7. recarregar, voltar do navegador, aba do menu
  await open(`?dia=${busyDay}`)
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('main article')
  s = await state()
  check('recarregar mantém o dia', s.where === `/historico?dia=${busyDay}` && s.cards === byDay.get(busyDay) && s.dayRow !== null, `${s.where} ${s.cards}`)
  await page.evaluate(() => [...document.querySelectorAll('nav a')].find((a) => a.textContent.trim() === 'Lista').click())
  await page.waitForFunction(() => location.pathname === '/' && !document.querySelector('[role="group"][aria-label="Período"]'))
  await page.goBack()
  await page.waitForSelector('button[aria-label="Limpar filtro do dia"]')
  await settle()
  s = await state()
  check('ir à Lista e voltar do navegador restaura o dia', s.where === `/historico?dia=${busyDay}` && s.cards === byDay.get(busyDay), `${s.where} ${s.cards}`)
  await page.evaluate(() => [...document.querySelectorAll('nav a')].find((a) => a.textContent.trim() === 'Lista').click())
  await page.waitForFunction(() => location.pathname === '/' && !document.querySelector('[role="group"][aria-label="Período"]'))
  await page.evaluate(() => [...document.querySelectorAll('nav a')].find((a) => a.textContent.trim() === 'Histórico').click())
  await page.waitForFunction(() => location.pathname === '/historico' && !document.querySelector('button[aria-label="Limpar filtro do dia"]') &&
    [...document.querySelectorAll('[role="group"][aria-label="Período"] button')].some((b) => b.textContent.trim() === 'Tudo' && b.getAttribute('aria-pressed') === 'true'))
  await settle()
  s = await state()
  check('pela aba do menu o Histórico abre sem dia', s.where === '/historico' && s.dayRow === null && s.cards === allCount, `${s.where} ${s.cards}`)

  // ---------- 8. o dia substitui o Período, que fica guardado (a URL ganha o ?dia= por dentro do app, como fará o calendário)
  await open('')
  await tapChip('Hoje')
  await page.evaluate((url) => {
    history.pushState({ usr: null, key: `dia-${Date.now()}`, idx: (history.state?.idx ?? 0) + 1 }, '', url)
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  }, `/historico?dia=${busyDay}`)
  await page.waitForSelector('button[aria-label="Limpar filtro do dia"]')
  await settle()
  s = await state()
  check('com o Período "Hoje" guardado, o dia antigo mostra os registros DO DIA (o Período não filtra) e nenhum chip marcado', s.cards === byDay.get(busyDay) && s.pressed.length === 0, `${s.cards} / ${byDay.get(busyDay)} ${s.pressed}`)
  await page.evaluate(() => document.querySelector('button[aria-label="Limpar filtro do dia"]').click())
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Limpar filtro do dia"]'))
  await settle()
  s = await state()
  check('Limpar volta ao Período guardado ("Hoje"): chip marcado, registros de hoje, foco nele', s.pressed.join('|') === 'Hoje' && s.cards === ofDay(todayKey).length && s.active === 'Hoje', `${s.pressed} ${s.cards}/${ofDay(todayKey).length} ${s.active}`)

  check('nada foi gravado pela tela', writes.length === 0, writes.join(' | '))
} finally {
  await browser?.close().catch(() => {})
  if (createdId) await deleteExecutions(pool, [createdId])
  const after = await counts()
  check('o banco volta ao que era (tarefas, registros e sessões iguais)', JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} → ${JSON.stringify(after)}`)
  await pool.end()
}

const ok = results.filter(Boolean).length
console.log(`\n${ok} de ${results.length}`)
process.exitCode = ok === results.length ? 0 : 1
