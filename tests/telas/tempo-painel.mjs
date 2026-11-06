// Tempo corrigido no Finalizar: "+ Durou… (esta sessão)" recolhido no painel
// (abre e foca no mesmo toque); "Termina às HH:MM de hoje/ontem"; o Finalizar
// manda o fim = início da sessão rodando + duração, e a sessão termina no
// "Quando". Sem mexer, "agora". Zero, letras e mais que o decorrido barram, com
// o formulário mantido. Sessão de 2h ou mais: aviso "Rodando há X…" e o campo já
// aberto, sem foco. Passando da meia-noite, o registro cai em "Ontem". Pausado:
// sem campo. Memória ao sair e voltar; outra sessão (Pausar e Retomar), campo
// novo. Desfazer volta a "Rodando". Lápis da sessão mostra o motivo de um 400.
// Toques. Dados próprios (prefixo teste-tempo-p), apagados no fim; pausa a
// sessão do seed e devolve a linha exata. Uso (raiz do repo):
//   node --env-file=backend/.env tests/telas/tempo-painel.mjs
import pg from 'pg'
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME } from '../config.mjs'
import { deleteExecutions, pauseRunning, resumeRunning } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-tempo-p'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(method, path, body) {
  const res = await fetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}
const pad = (n) => String(n).padStart(2, '0')
const hhmm = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const dayWord = (iso) => {
  const d = new Date(iso), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1)
  return sameDay(d, today) ? 'de hoje' : sameDay(d, y) ? 'de ontem' : null
}
const plus = (iso, minutes) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString()

const seedSession = await pauseRunning(pool)
let taskId = null
let browser
try {
  const T = await api('POST', '/tasks', { title: `${P} tarefa` })
  taskId = T.id
  let n = 0
  // Registro aberto com a sessão começando `ago` minutos atrás (ou num instante dado)
  const openRecord = async (startedAt) => {
    n += 1
    const description = `${P} reg ${n}`
    const rec = await api('POST', '/executions', { taskId, description, completedAt: null })
    const entry = await api('POST', '/time-entries', { taskExecutionId: rec.id, startedAt })
    return { id: rec.id, description, entry }
  }
  const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString()
  const rowOf = async (id) => (await pool.query('SELECT completed_at FROM task_executions WHERE id = $1', [id])).rows[0]
  const sessionsOf = async (id) => (await pool.query('SELECT id, started_at, ended_at FROM time_entries WHERE task_execution_id = $1 ORDER BY started_at', [id])).rows
  const closeOpen = async () => {
    await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL AND task_execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)', [taskId])
    await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = $1 AND completed_at IS NULL', [taskId])).rows.map((r) => r.id))
  }

  browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 390, height: 900 })
  const puts = []
  page.on('request', (req) => {
    if (req.method() === 'PUT' && /\/executions\/[0-9a-f-]+$/.test(req.url())) puts.push(JSON.parse(req.postData()))
  })
  const go = async () => {
    await page.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Finalizar'))
    await pause(200)
  }
  const fresh = async () => {
    puts.length = 0
    await page.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.evaluate(() => sessionStorage.clear())
    await go()
  }
  const field = () => page.evaluate(() => {
    const block = document.querySelector('main form [data-duration-field]')
    const input = block?.querySelector('input') ?? null
    return {
      block: block !== null,
      button: block?.querySelector('button')?.textContent.trim() ?? null,
      input: input !== null,
      focused: input !== null && document.activeElement === input,
      value: input?.value ?? null,
      label: block?.querySelector('label span')?.textContent ?? null,
      end: block?.querySelector('p')?.textContent ?? null,
      warning: document.querySelector('main [data-long-warning]')?.textContent ?? null,
    }
  })
  const openField = async () => {
    if (!(await field()).input) {
      await page.evaluate(() => document.querySelector('main form [data-duration-field] button').click())
      await pause(150)
    }
  }
  const typeDuration = async (text) => {
    await openField()
    const handle = await page.$('main form [data-duration-field] input')
    await handle.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.select() })
    await page.keyboard.press('Backspace')
    if (text) await handle.type(text)
    await pause(200)
  }
  const typeDescription = async (text) => {
    const handle = await page.evaluateHandle(() => [...document.querySelectorAll('main form label')].find((l) => l.querySelector('span')?.textContent === 'O que foi feito (opcional)').querySelector('input'))
    await handle.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.select() })
    await page.keyboard.press('Backspace')
    await handle.type(text)
  }
  const description = () => page.evaluate(() => [...document.querySelectorAll('main form label')].find((l) => l.querySelector('span')?.textContent === 'O que foi feito (opcional)').querySelector('input').value)
  const formError = () => page.evaluate(() => document.querySelector('main [role="alert"]')?.textContent.trim() ?? '')
  const finish = () => page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Finalizar').click())
  const finished = async () => {
    await finish()
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith('Desfazer')))
    await pause(300)
  }

  // ---------- 1. sessão curta: recolhido; abrir foca; "Termina às"; Finalizar com o fim corrigido
  let r = await openRecord(ago(30))
  await fresh()
  let f = await field()
  const order = await page.evaluate(() => {
    const form = document.querySelector('main form')
    return { last: form.lastElementChild?.matches('[data-duration-field]') ?? false, beforeIsLink: form.lastElementChild?.previousElementSibling?.matches('[data-link-field]') ?? false }
  })
  check('rodando: "Durou" é o último bloco do formulário, logo depois do Link', order.last && order.beforeIsLink, JSON.stringify(order))
  check('sessão curta: "+ Durou… (esta sessão)" recolhido, sem aviso', f.block && f.button === '+ Durou… (esta sessão)' && !f.input && f.warning === null, JSON.stringify(f))
  await page.evaluate(() => document.querySelector('main form [data-duration-field] button').click())
  await pause(150)
  f = await field()
  check('abrir: campo "Durou (min, esta sessão)" com o foco', f.input && f.focused && f.label === 'Durou (min, esta sessão)', JSON.stringify(f))
  await typeDuration('20')
  const end20 = plus(r.entry.startedAt, 20)
  f = await field()
  check('"Termina às" com a hora e o dia certos', f.end === `Termina às ${hhmm(end20)} ${dayWord(end20)}.`, `${f.end} x ${hhmm(end20)} ${dayWord(end20)}`)
  await finished()
  check('Finalizar manda o fim = início + 20 min', puts.length === 1 && puts[0].completedAt === end20, JSON.stringify(puts.map((p) => p.completedAt)))
  let s = await sessionsOf(r.id)
  check('banco: sessão termina no "Quando" (início + 20 min)', s.length === 1 && s[0].ended_at?.toISOString() === end20 && (await rowOf(r.id)).completed_at?.toISOString() === end20, JSON.stringify(s))

  // ---------- 2. Desfazer: rodando de novo, desde o início original
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Desfazer')).click())
  await page.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Finalizar'))
  await pause(600)
  s = await sessionsOf(r.id)
  f = await field()
  check('Desfazer: registro aberto, a mesma sessão rodando de novo', (await rowOf(r.id)).completed_at === null && s.length === 1 && s[0].ended_at === null, JSON.stringify(s))
  check('Desfazer: o "Durou" volta recolhido e vazio (sessão curta)', f.block && !f.input, JSON.stringify(f))

  // ---------- 3. sem mexer: "agora"
  puts.length = 0
  const before = Date.now()
  await finished()
  const sent = puts[0] ? new Date(puts[0].completedAt).getTime() : 0
  check('sem mexer: Finalizar manda "agora"', puts.length === 1 && sent >= before - 1000 && sent <= Date.now() + 1000, JSON.stringify(puts.map((p) => p.completedAt)))

  // ---------- 4. validações: zero, letras, mais que o decorrido; o formulário fica
  r = await openRecord(ago(30))
  await fresh()
  await typeDescription('texto do painel')
  for (const [text, expected] of [['0', 'Durou: minutos inteiros, de 1 a 1440.'], ['abc', 'Durou: minutos inteiros, de 1 a 1440.']]) {
    await typeDuration(text)
    puts.length = 0
    await finish()
    await pause(400)
    check(`"${text}" barra com a frase da tela, sem pedido`, (await formError()) === expected && puts.length === 0, `${await formError()} ${puts.length}`)
  }
  await typeDuration('45')
  puts.length = 0
  await finish()
  await pause(400)
  const err45 = await formError()
  const max = Number(err45.match(/no máximo (\d+) min/)?.[1])
  check('mais que o decorrido barra ("no máximo N min")', /^Durou: no máximo \d+ min \(o tempo desta sessão até agora\)\.$/.test(err45) && max >= 30 && max < 45 && puts.length === 0, err45)
  check('recusado: o resto do formulário fica', (await description()) === 'texto do painel' && (await rowOf(r.id)).completed_at === null)

  // ---------- 5. memória: sair e voltar; Pausar e Retomar = outra sessão, campo novo
  await typeDuration('15')
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await go()
  f = await field()
  check('memória: sair e voltar mantém o "15", aberto', f.input && f.value === '15', JSON.stringify(f))
  await page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Pausar').click())
  await page.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Retomar'))
  await pause(300)
  f = await field()
  check('pausado: sem o "Durou" e sem aviso', !f.block && f.warning === null, JSON.stringify(f))
  await page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Retomar').click())
  await page.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Pausar'))
  await pause(300)
  f = await field()
  check('Retomar (outra sessão): "Durou" recolhido e vazio', f.block && !f.input, JSON.stringify(f))
  await closeOpen()

  // ---------- 5b. 1h30: ainda abaixo do limite (2h), sem aviso e recolhido
  r = await openRecord(ago(90))
  await fresh()
  f = await field()
  check('sessão de 1h30: sem aviso, "Durou" recolhido', f.warning === null && f.block && !f.input, JSON.stringify(f))
  await closeOpen()

  // ---------- 6. sessão longa: aviso e campo à vista, sem foco
  r = await openRecord(ago(360))
  await fresh()
  f = await field()
  check('sessão de 6h: aviso "Rodando há 6h…", que leva ao Finalizar', /^Rodando há 6h0\d\. Durou quanto\? Informe em "Durou" e finalize, sem pausar\.$/.test(f.warning ?? ''), f.warning)
  check('sessão de 6h: campo já aberto, sem foco', f.input && !f.focused, JSON.stringify(f))
  await typeDuration('90')
  await finished()
  const end90 = plus(r.entry.startedAt, 90)
  check('sessão longa: Finalizar com início + 90 min', puts.at(-1)?.completedAt === end90 && (await rowOf(r.id)).completed_at?.toISOString() === end90, JSON.stringify(puts.at(-1)?.completedAt))

  // ---------- 7. passando da meia-noite: começou ontem às 22:30, durou 60 → ontem 23:30
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
  const lateStart = new Date(midnight.getTime() - 90 * 60_000).toISOString()
  r = await openRecord(lateStart)
  await fresh()
  await typeDuration('60')
  const end60 = plus(lateStart, 60)
  f = await field()
  check('meia-noite: "Termina às 23:30 de ontem."', f.end === 'Termina às 23:30 de ontem.', f.end)
  await finished()
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('article')
  const group = await page.evaluate((d) => [...document.querySelectorAll('article')].find((a) => [...a.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === d))?.closest('section')?.getAttribute('aria-label') ?? null, r.description)
  check('meia-noite: o registro cai em "Ontem" no Histórico', group === 'Ontem' && (await rowOf(r.id)).completed_at?.toISOString() === end60, group)

  // ---------- 8. lápis da sessão: o motivo do servidor (fim no futuro)
  const shown = await page.evaluate((d) => {
    const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === d))
    ;[...a.querySelectorAll('button')].find((b) => /sess(ão|ões)/.test(b.textContent)).click()
    return true
  }, r.description)
  await pause(200)
  await page.evaluate((d) => {
    const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === d))
    a.querySelector('button[aria-label^="Editar sessão"]').click()
  }, r.description)
  await pause(200)
  const future = new Date(Date.now() + 60 * 60_000)
  const local = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`
  await page.evaluate((d, v) => {
    const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === d))
    const input = [...a.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent === 'Fim').querySelector('input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    ;[...a.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Salvar').click()
  }, r.description, local)
  await pause(600)
  const message = await page.evaluate((d) => [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === d))?.querySelector('[role="alert"]')?.textContent.trim() ?? '', r.description)
  check('lápis da sessão: mostra o motivo do servidor', shown && message === 'A sessão não pode terminar no futuro.', message)
  check('lápis da sessão recusado: sessão intacta', (await sessionsOf(r.id))[0].ended_at?.toISOString() === end60)
  await page.close()

  // ---------- 9. toques: Finalizar normal 1; com "Durou" na sessão curta e na longa, +1
  const touch = await browser.newPage()
  await touch.setViewport({ width: 375, height: 800, hasTouch: true, isMobile: true })
  await touch.evaluateOnNewDocument(() => {
    window.__taps = 0
    addEventListener('pointerdown', () => { window.__taps++ }, true)
  })
  const tapEl = async (handle) => {
    await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await handle.tap()
    await pause(300)
  }
  const tapsFor = async (startedAt, withDuration) => {
    await openRecord(startedAt)
    await touch.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'networkidle0' })
    await touch.evaluate(() => sessionStorage.clear())
    await touch.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'networkidle0' })
    await touch.evaluate(() => { window.__taps = 0 })
    if (withDuration) {
      const opened = await touch.$('main form [data-duration-field] input')
      await tapEl(opened ?? await touch.$('main form [data-duration-field] button'))
      await touch.keyboard.type('10')
    }
    await tapEl(await touch.evaluateHandle(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Finalizar')))
    await touch.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith('Desfazer')))
    return touch.evaluate(() => window.__taps)
  }
  const plain = await tapsFor(ago(30), false)
  const short = await tapsFor(ago(30), true)
  const long = await tapsFor(ago(300), true)
  console.log(`TOQUES Finalizar: normal ${plain}, com "Durou" (curta) ${short}, (longa) ${long}; previsto 1, 2, 2`)
  check('toques: normal 1; "Durou" +1 na curta e na longa', plain === 1 && short === 2 && long === 2, `${plain} ${short} ${long}`)
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser?.close().catch(() => {})
  if (taskId) {
    await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL AND task_execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)', [taskId])
    await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [taskId])).rows.map((r) => r.id))
    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId])
  }
  await resumeRunning(pool, seedSession)
  const left = await pool.query(`SELECT count(*)::int AS n FROM tasks WHERE title LIKE '${P}%'`)
  const running = await pool.query('SELECT count(*)::int AS n FROM time_entries WHERE ended_at IS NULL')
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  check('sessão do seed devolvida', running.rows[0].n === seedSession.length, `${running.rows[0].n} x ${seedSession.length}`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
