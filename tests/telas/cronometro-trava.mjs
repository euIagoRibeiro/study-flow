// Trava contra clique duplo no painel do cronômetro (commit 2b). Depois de um Pausar ou Retomar que deu
// certo, o botão que aparece no lugar fica desabilitado por ~1,5 s (rótulo igual; nos dois sentidos); quem
// abre a tela com o registro estável não espera; Pausar que FALHA não trava; Pausar/Retomar e Finalizar não
// se sobrepõem (o Finalizar fica desabilitado com um Pausar em andamento e vice-versa); dois envios do
// Finalizar no mesmo instante (Enter com o botão desabilitado ainda envia o formulário) mandam UM só PUT.
// Respostas seguradas por interceptação pra deixar a ação "em voo". Dados próprios (prefixo teste-trava),
// apagados no fim; pausa a sessão do seed e devolve a linha exata. Uso (raiz do repo):
//   node --env-file=backend/.env tests/telas/cronometro-trava.mjs
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'
import { deleteExecutions, pauseRunning, resumeRunning } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-trava'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(method, path, body) {
  const res = await apiFetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString()

const seedSession = await pauseRunning(pool)
let taskId = null
let browser
try {
  taskId = (await api('POST', '/tasks', { title: `${P} tarefa` })).id
  const openRecord = async (startedAt) => {
    const rec = await api('POST', '/executions', { taskId, description: `${P} reg`, completedAt: null })
    const entry = await api('POST', '/time-entries', { taskExecutionId: rec.id, startedAt })
    return { id: rec.id, entry }
  }
  const sessionsOf = async (id) => (await pool.query('SELECT id, ended_at FROM time_entries WHERE task_execution_id = $1 ORDER BY started_at', [id])).rows
  const completed = async (id) => (await pool.query('SELECT completed_at FROM task_executions WHERE id = $1', [id])).rows[0].completed_at
  const closeOpen = async () => {
    await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL AND task_execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)', [taskId])
    await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [taskId])).rows.map((r) => r.id))
  }

  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 390, height: 900 })
  // Pedidos contados e respostas seguradas (ms) por tipo
  const seen = { putEntry: 0, postEntry: 0, putExec: 0 }
  const hold = { putEntry: 0, postEntry: 0, putExec: 0 }
  let failPause = false
  let failFinish = false
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const kind = req.method() === 'PUT' && /\/time-entries\/[0-9a-f-]+$/.test(req.url()) ? 'putEntry'
      : req.method() === 'POST' && req.url().endsWith('/time-entries') ? 'postEntry'
        : req.method() === 'PUT' && /\/executions\/[0-9a-f-]+$/.test(req.url()) ? 'putExec' : null
    if (!kind) return req.continue()
    seen[kind]++
    if (kind === 'putEntry' && failPause) {
      return req.respond({ status: 500, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"x"}' })
    }
    if (kind === 'putExec' && failFinish) {
      return req.respond({ status: 500, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"x"}' })
    }
    if (hold[kind] > 0) return setTimeout(() => req.continue(), hold[kind])
    req.continue()
  })
  const reset = () => { seen.putEntry = 0; seen.postEntry = 0; seen.putExec = 0 }
  const state = (label) => page.evaluate((l) => {
    const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === l)
    return b ? { disabled: b.disabled, text: b.textContent.trim() } : null
  }, label)
  const click = (label) => page.evaluate((l) => [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === l).click(), label)
  const waitLabel = (label) => page.waitForFunction((l) => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === l), {}, label)
  const open = async () => {
    await page.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => sessionStorage.clear())
    await page.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Finalizar'))
    await pause(200)
  }
  // Tempo até o botão habilitar (ms), a partir de agora
  const untilEnabled = async (label, limit = 4000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < limit) {
      const s = await state(label)
      if (s && !s.disabled) return Date.now() - t0
      await pause(25)
    }
    return null
  }

  // ---------- 1. estável ao abrir: sem espera
  let r = await openRecord(ago(30))
  await open()
  let s = await state('Pausar')
  check('abrir com a sessão rodando: o Pausar já está habilitado', s?.disabled === false, JSON.stringify(s))
  await pool.query('UPDATE time_entries SET ended_at = now() WHERE id = $1', [r.entry.id])
  await open()
  s = await state('Retomar')
  check('abrir com o registro pausado: o Retomar já está habilitado (sem espera)', s?.disabled === false, JSON.stringify(s))

  // ---------- 2. depois do Pausar, o Retomar trava ~1,5 s (rótulo igual)
  await pool.query('UPDATE time_entries SET ended_at = NULL WHERE id = $1', [r.entry.id])
  await open()
  await click('Pausar')
  await waitLabel('Retomar')
  s = await state('Retomar')
  check('depois do Pausar: o Retomar aparece desabilitado, com o mesmo rótulo', s?.disabled === true && s.text === 'Retomar', JSON.stringify(s))
  await pause(700)
  s = await state('Retomar')
  check('0,7 s depois: o Retomar continua desabilitado', s?.disabled === true, JSON.stringify(s))
  let waited = await untilEnabled('Retomar')
  check('o Retomar volta sozinho (menos de 1,6 s depois dos 0,7 s)', waited !== null && waited < 1600, String(waited))
  check('nada foi criado enquanto o Retomar esteve travado', (await sessionsOf(r.id)).length === 1)

  // ---------- 3. depois do Retomar, o Pausar trava ~1,5 s
  await click('Retomar')
  await waitLabel('Pausar')
  s = await state('Pausar')
  check('depois do Retomar: o Pausar aparece desabilitado, com o mesmo rótulo', s?.disabled === true && s.text === 'Pausar', JSON.stringify(s))
  await pause(700)
  s = await state('Pausar')
  check('0,7 s depois: o Pausar continua desabilitado', s?.disabled === true, JSON.stringify(s))
  waited = await untilEnabled('Pausar')
  check('o Pausar volta sozinho (menos de 1,6 s depois dos 0,7 s)', waited !== null && waited < 1600, String(waited))
  check('o Retomar criou UMA sessão nova (2 no registro) e uma está rodando', (await sessionsOf(r.id)).length === 2 && (await sessionsOf(r.id)).filter((x) => x.ended_at === null).length === 1)

  // ---------- 4. Pausar que FALHA não trava
  failPause = true
  reset()
  await click('Pausar')
  await page.waitForFunction(() => document.querySelector('[role="alert"] p') !== null).catch(() => {})
  await pause(150)
  s = await state('Pausar')
  check('Pausar com 500: o botão continua Pausar e HABILITADO (só a troca que deu certo trava)', s?.disabled === false, JSON.stringify(s))
  failPause = false

  // ---------- 5. dois cliques no Pausar, com a resposta segurada: um PUT só
  hold.putEntry = 900
  reset()
  await page.evaluate(() => { const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Pausar'); b.click(); b.click() })
  await pause(1500)
  check('dois cliques no mesmo instante no Pausar: UM pedido', seen.putEntry === 1, `${seen.putEntry}`)
  hold.putEntry = 0
  await waitLabel('Retomar')
  await untilEnabled('Retomar')

  // ---------- 6. dois cliques no Retomar, com a resposta segurada: um POST só
  hold.postEntry = 900
  reset()
  const before = (await sessionsOf(r.id)).length
  await page.evaluate(() => { const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Retomar'); b.click(); b.click() })
  await pause(1500)
  check('dois cliques no mesmo instante no Retomar: UM pedido e UMA sessão nova', seen.postEntry === 1 && (await sessionsOf(r.id)).length === before + 1, `${seen.postEntry} ${(await sessionsOf(r.id)).length - before}`)
  hold.postEntry = 0
  await waitLabel('Pausar')
  await untilEnabled('Pausar')

  // ---------- 7. Finalizar desabilitado com um Pausar em andamento (e nada sai)
  hold.putEntry = 1200
  reset()
  await click('Pausar')
  await pause(300)
  s = await state('Finalizar')
  check('Pausar em andamento: o Finalizar está desabilitado', s?.disabled === true, JSON.stringify(s))
  await click('Finalizar')
  await pause(200)
  check('clicar no Finalizar durante o Pausar não manda nada', seen.putExec === 0, `${seen.putExec}`)
  await pause(1300)
  hold.putEntry = 0
  s = await state('Finalizar')
  check('Pausar terminou: o Finalizar volta habilitado', s?.disabled === false, JSON.stringify(s))
  await waitLabel('Retomar')
  await untilEnabled('Retomar')

  // ---------- 8. Retomar/Pausar desabilitados com o Finalizar em andamento
  hold.putExec = 1200
  reset()
  await click('Finalizar')
  await pause(300)
  s = await state('Retomar')
  check('Finalizar em andamento: o Retomar está desabilitado', s?.disabled === true, JSON.stringify(s))
  await click('Retomar')
  await pause(200)
  check('clicar no Retomar durante o Finalizar não manda nada', seen.postEntry === 0, `${seen.postEntry}`)
  await pause(1300)
  hold.putExec = 0
  check('o Finalizar terminou (registro concluído) e nenhuma sessão nova foi criada', (await completed(r.id)) !== null && (await sessionsOf(r.id)).every((x) => x.ended_at !== null))
  await closeOpen()

  // ---------- 9. dois envios do Finalizar no mesmo instante (Enter com o botão desabilitado): um PUT
  r = await openRecord(ago(30))
  await open()
  hold.putExec = 900
  reset()
  await page.evaluate(() => { const form = document.querySelector('main form[id^="finalizar-"]'); form.requestSubmit(); form.requestSubmit() })
  await pause(1500)
  check('dois envios do Finalizar no mesmo instante: UM pedido', seen.putExec === 1, `${seen.putExec}`)
  hold.putExec = 0
  await pause(300)
  check('o registro foi concluído uma vez', (await completed(r.id)) !== null)
  await closeOpen()

  // ---------- 10. Finalizar que FALHA solta a trava: o botão volta e a 2ª tentativa grava
  r = await openRecord(ago(30))
  await open()
  failFinish = true
  reset()
  await click('Finalizar')
  await pause(600)
  s = await state('Finalizar')
  check('Finalizar com 500: o botão volta habilitado e o registro continua aberto', s?.disabled === false && (await completed(r.id)) === null && seen.putExec === 1, `${JSON.stringify(s)} ${seen.putExec}`)
  s = await state('Pausar')
  check('depois do Finalizar que falhou, o Pausar também está habilitado', s?.disabled === false, JSON.stringify(s))
  failFinish = false
  await click('Finalizar')
  await pause(800)
  check('a 2ª tentativa do Finalizar grava (a trava foi solta)', (await completed(r.id)) !== null && seen.putExec === 2, `${seen.putExec}`)
  await closeOpen()
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false, String(err.stack).split('\n').slice(0, 3).join(' | '))
} finally {
  await browser?.close().catch(() => {})
  if (taskId) {
    await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [taskId])).rows.map((r) => r.id))
    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId])
  }
  await resumeRunning(pool, seedSession)
  const left = await pool.query(`SELECT (SELECT count(*) FROM tasks WHERE title LIKE $1)::int + (SELECT count(*) FROM task_executions WHERE description = $2)::int AS n`, [`${P}%`, `${P} reg`])
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  const running = await pool.query('SELECT count(*)::int AS n FROM time_entries WHERE ended_at IS NULL')
  check('a sessão rodando do seed voltou (uma rodando)', running.rows[0].n === seedSession.length, `${running.rows[0].n}`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
