// Segundos no Histórico (cada sessão, total do registro e total do dia) e no
// "antes:" do painel do cronômetro. 1) O formatador, importado na página pelo Vite
// (/src/dates.ts): 0 s, 59 s, 60 s, 3599 s, 3600 s, 86399 s, mais de 24 h e o
// arredondamento. 2) O Histórico com respostas INJETADAS de GET /executions e
// GET /time-entries (nada é gravado): o total do registro é a soma dos segundos
// já arredondados das sessões, e o do dia, a soma dos totais dos cartões; o
// estimado sem as unidades zeradas do fim ("15min", "1h", "1min22s"), no cartão,
// na sessão e no dia só de estimados (o dia misto fica cheio). 3) O
// "antes:" com sessões de segundos quebrados. Fuso fixo (America/Sao_Paulo).
// Uso: node --env-file=backend/.env tests/telas/historico-segundos.mjs
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

const [executions, entries] = await Promise.all(['executions', 'time-entries'].map(async (p) => (await apiFetch(`${API}/${p}`)).json()))
const recordTemplate = executions.find((e) => e.completedAt !== null)
const entryTemplate = entries.find((e) => e.endedAt !== null)
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const iso = (ms) => new Date(ms).toISOString()
const at = (local) => new Date(`${local}-03:00`).getTime() // hora local de São Paulo

// Registros: título, fim do registro, durações das sessões em milissegundos
// (a última termina no fim do registro, as outras um minuto antes cada)
const RECORDS = [
  ['hs 59', '2026-11-02T10:00:00', [59_000]],
  ['hs 60', '2026-11-02T11:00:00', [60_000]],
  ['hs 3599', '2026-11-02T13:00:00', [3_599_000]],
  ['hs 0,4 x3', '2026-11-02T14:00:00', [400, 400, 400]],
  ['hs 1,6 x2', '2026-11-02T15:00:00', [1_600, 1_600]],
  ['hs 25h', '2026-11-04T20:00:00', [90_061_000]],
  ['hs est 15', '2026-11-06T10:00:00', [900_000], true],
  ['hs est 1:22', '2026-11-06T11:00:00', [82_000], true],
  ['hs misto med', '2026-11-07T10:00:00', [900_000]],
  ['hs misto est', '2026-11-07T11:00:00', [900_000], true],
  ['hs dia est 15', '2026-11-08T10:00:00', [900_000], true],
  ['hs dia est 1h', '2026-11-08T12:00:00', [3_600_000], true],
]
const fakeExecutions = []
const fakeEntries = []
let n = 1
for (const [title, end, durations, estimated = false] of RECORDS) {
  const recordId = id(n++)
  const endMs = at(end)
  fakeExecutions.push({
    ...recordTemplate, id: recordId, taskTitleAtTime: title, description: null, completedAt: iso(endMs),
    rootTagId: null, tagIds: [], phase: null, measure: null, workout: null, selections: [], workId: null, linkUrl: null,
  })
  durations.forEach((ms, i) => {
    const stop = endMs - (durations.length - 1 - i) * 60_000
    fakeEntries.push({ ...entryTemplate, id: id(n++), taskExecutionId: recordId, startedAt: iso(stop - ms), endedAt: iso(stop), estimated })
  })
}
// Painel: registro aberto da mesma tarefa, duas sessões fechadas de 59,4 s e
// 60,4 s (59 + 60 = 119 s; pelos milissegundos daria 120 s) e uma rodando
const openId = id(900)
const openExecutions = [{ ...fakeExecutions[0], id: openId, taskTitleAtTime: 'hs aberto', completedAt: null }]
const now = Date.now()
const openEntries = [
  { ...entryTemplate, id: id(901), taskExecutionId: openId, startedAt: iso(now - 3_600_000), endedAt: iso(now - 3_600_000 + 59_400), estimated: false },
  { ...entryTemplate, id: id(902), taskExecutionId: openId, startedAt: iso(now - 1_800_000), endedAt: iso(now - 1_800_000 + 60_400), estimated: false },
  { ...entryTemplate, id: id(903), taskExecutionId: openId, startedAt: iso(now - 300_000), endedAt: null, estimated: false },
]

let browser
const writes = []
try {
  if (!recordTemplate || !entryTemplate) throw new Error('seed sem registro concluído ou sem sessão fechada (o molde das respostas)')
  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.emulateTimezone('America/Sao_Paulo')
  await page.setViewport({ width: 390, height: 900 })
  let bodies = null
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      writes.push(`${req.method()} ${req.url()}`)
      return req.abort()
    }
    const path = new URL(req.url()).pathname
    if (bodies && req.method() === 'GET' && bodies[path]) {
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(bodies[path]) })
    }
    req.continue()
  })

  // ---------- 1. formatador
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
  const f = await page.evaluate(async () => {
    const d = await import('/src/dates.ts')
    const s = (x) => d.formatSeconds(x)
    return {
      0: s(0), 59: s(59), 59.5: s(59.5), 60: s(60), 3599: s(3599), 3600: s(3600), 3661: s(3661),
      86399: s(86399), 90061: s(90061), 360000: s(360000),
      ms499: s(d.sessionSeconds(499)),
      m900: s(900), e900: d.formatSeconds(900, true), e82: d.formatSeconds(82, true), e3600: d.formatSeconds(3600, true),
      e5400: d.formatSeconds(5400, true), e3622: d.formatSeconds(3622, true), e0: d.formatSeconds(0, true), ms500: s(d.sessionSeconds(500)), ms59500: s(d.sessionSeconds(59_500)), neg: s(d.sessionSeconds(-1000)),
    }
  })
  const expected = {
    0: '0s', 59: '59s', 59.5: '1min00s', 60: '1min00s', 3599: '59min59s', 3600: '1h00min00s', 3661: '1h01min01s',
    86399: '23h59min59s', 90061: '25h01min01s', 360000: '100h00min00s',
    ms499: '0s',
    m900: '15min00s', e900: '15min', e82: '1min22s', e3600: '1h', e5400: '1h30min', e3622: '1h00min22s', e0: '0s', ms500: '1s', ms59500: '1min00s', neg: '0s',
  }
  for (const [key, want] of Object.entries(expected)) {
    check(`formatador: ${key} → ${want}`, f[key] === want, f[key])
  }

  // ---------- 2. Histórico (respostas injetadas)
  bodies = { '/api/executions': fakeExecutions, '/api/time-entries': fakeEntries }
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await page.waitForFunction((n) => document.querySelectorAll('main article').length === n, {}, fakeExecutions.length)
  // abre as sessões de todos os cartões
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('main article button[aria-expanded]')) if (/sess(ão|ões)/.test(b.textContent)) b.click()
  })
  await pause(300)
  const cards = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('main article')].map((a) => {
    const h4 = a.querySelector('h4')
    const total = h4.nextElementSibling?.firstChild?.textContent ?? null
    const label = h4.nextElementSibling?.querySelector('span')?.textContent.trim() ?? null
    const sessions = [...a.querySelectorAll('li > div')].filter((d) => /\d\d:\d\d–\d\d:\d\d/.test(d.textContent))
      .map((d) => d.querySelector('span').textContent.split(' · ')[1])
    const h3 = a.closest('section').querySelector('h3')
    return [h4.textContent.trim(), { total, label, sessions, day: h3.querySelectorAll('span')[1]?.textContent ?? null, dayLabel: h3.querySelector('span').textContent }]
  })))
  const CASES = [
    ['hs 59', '59s', ['59s']],
    ['hs 60', '1min00s', ['1min00s']],
    ['hs 3599', '59min59s', ['59min59s']],
    ['hs 0,4 x3', '0s', ['0s', '0s', '0s']],
    ['hs 1,6 x2', '4s', ['2s', '2s']],
    ['hs 25h', '25h01min01s', ['25h01min01s']],
    ['hs est 15', '15min', ['15min']],
    ['hs est 1:22', '1min22s', ['1min22s']],
    ['hs misto med', '15min00s', ['15min00s']],
    ['hs misto est', '15min', ['15min']],
    ['hs dia est 15', '15min', ['15min']],
    ['hs dia est 1h', '1h', ['1h']],
  ]
  for (const [title, total, sessions] of CASES) {
    const c = cards[title]
    check(`Histórico, ${title}: sessões ${sessions.join(', ')}`, c && JSON.stringify(c.sessions) === JSON.stringify(sessions), JSON.stringify(c?.sessions))
    check(`Histórico, ${title}: total do registro ${total} (soma das sessões arredondadas)`, c?.total === total, c?.total)
  }
  // dia 02/11: 59 + 60 + 3599 + 0 + 4 = 3722 s; dia 04/11: 90061 s
  check('Histórico: total do dia 02/11 = 1h02min02s (soma dos cartões)', cards['hs 59']?.day === '1h02min02s', `${cards['hs 59']?.day} (${cards['hs 59']?.dayLabel})`)
  check('Histórico: total do dia 04/11 = 25h01min01s', cards['hs 25h']?.day === '25h01min01s', `${cards['hs 25h']?.day} (${cards['hs 25h']?.dayLabel})`)
  // estimado: sem as unidades zeradas no cartão, na sessão e no dia só de
  // estimados; o dia misto (medido + estimado), cheio
  check('Histórico: total do dia 06/11 = 16min22s (900 + 82, só estimados)', cards['hs est 15']?.day === '16min22s', cards['hs est 15']?.day)
  check('Histórico: total do dia 08/11 só de estimados = 1h15min (900 + 3600)', cards['hs dia est 15']?.day === '1h15min', cards['hs dia est 15']?.day)
  check('Histórico: total do dia 07/11 misto = 30min00s (cheio)', cards['hs misto med']?.day === '30min00s', cards['hs misto med']?.day)
  check('Histórico: o cartão estimado diz "estimado"', cards['hs est 15']?.label === 'estimado' && cards['hs 59']?.label === null, JSON.stringify([cards['hs est 15']?.label, cards['hs 59']?.label]))
  check('Histórico: os registros de 02/11 no mesmo dia', ['hs 60', 'hs 3599', 'hs 0,4 x3', 'hs 1,6 x2'].every((t) => cards[t]?.dayLabel === cards['hs 59']?.dayLabel) && cards['hs 25h']?.dayLabel !== cards['hs 59']?.dayLabel, JSON.stringify(Object.fromEntries(Object.entries(cards).map(([k, v]) => [k, v.dayLabel]))))

  // ---------- 3. "antes:" no painel do cronômetro
  bodies = { '/api/executions': openExecutions, '/api/time-entries': openEntries }
  await page.goto(`${APP}/executar?tarefa=${openExecutions[0].taskId}`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => [...document.querySelectorAll('main p')].some((p) => p.textContent.startsWith('Sessão ')))
  const before = await page.evaluate(() => [...document.querySelectorAll('main p')].find((p) => p.textContent.startsWith('Sessão ')).textContent)
  check('painel: "Sessão 3 · antes: 1min59s" (59 + 60, cada sessão arredondada)', before === 'Sessão 3 · antes: 1min59s', before)
  check('nenhum pedido de escrita saiu', writes.length === 0, writes.join(' | '))
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser?.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length && ok > 0 ? 0 : 1
}
