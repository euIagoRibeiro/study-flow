// Nota por sessão (NB1b): PATCH /time-entries/:id { note }. Sobe o app EM PROCESSO (a partir de BACKEND_DIR ou do backend real)
// numa porta própria: o console.error do servidor é capturável, e as mutações rodam numa cópia sem mexer na API de desenvolvimento.
// Cobre: sessão rodando e concluída, trim, '' e null, 2000 aceito e 2001 recusado sem eco do texto, corpo sem note ou com tipo
// errado, id inválido e inexistente, estimada (400, nada gravado), a nota sobrevivendo ao PUT de horários (inclusive reabrindo),
// ao Pausar, ao Finalizar e ao Retomar (a sessão nova nasce sem nota), PATCH e Finalizar ao mesmo tempo, excluir sessão levando a
// nota, e NENHUM texto de nota em resposta de erro nem em log. Dados próprios (prefixo teste-nota), em março de 2025, apagados
// no fim; pausa a sessão do seed e devolve a linha exata. Frases inventadas, nunca texto de anotação real.
// Uso (raiz do repo): node --env-file=backend/.env tests/api/notas-test.mjs
// BACKEND_DIR: uma cópia do backend (mutação), com node_modules ligado ao do repo
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pg from 'pg'
import { sessionCookie } from '../sessao.mjs'
import { deleteExecutions, pauseRunning, resumeRunning } from '../limpeza.mjs'

if (!process.env.DATABASE_URL || !process.env.TEST_PASSWORD) {
  console.error('DATABASE_URL ou TEST_PASSWORD ausente: rode com --env-file=backend/.env')
  process.exit(2)
}
const REAL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend')
const BACKEND = process.env.BACKEND_DIR ?? REAL
const mod = (file) => import(pathToFileURL(join(BACKEND, 'src', file)).href)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-nota'
const FRASE = 'frase inventada para a nota de teste'
const OUTRA = 'segunda frase inventada da nota'
const GHOST = '00000000-0000-4000-8000-000000000000'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}

let BASE = ''
async function api(method, path, body) {
  const headers = { Cookie: `sf_session=${await sessionCookie(BASE)}`, 'X-StudyFlow': '1' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
  return { status: res.status, body: parsed, text }
}
const detail = (r) => `status ${r.status} ${r.text?.slice(0, 160)}`
const patch = (id, body) => api('PATCH', `/time-entries/${id}`, body)
const noteOf = async (id) => (await pool.query('SELECT note FROM time_entries WHERE id = $1', [id])).rows[0]?.note
const day = (hh, mm = 0) => `2025-03-10T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString()

// Tudo o que o servidor (em processo) escreve no console durante a chamada
async function logged(fn) {
  const lines = []
  const saved = { error: console.error, warn: console.warn, log: console.log }
  const grab = (...args) => lines.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' '))
  console.error = grab; console.warn = grab; console.log = grab
  try { await fn() } finally { Object.assign(console, saved) }
  return lines.join('\n')
}

const seedSession = await pauseRunning(pool)
const executions = []
const taskIds = []
let server
try {
  const auth = await mod('auth.js')
  const { createApp, errorHandler } = await mod('app.js')
  server = createApp(auth.loadConfig(process.env)).listen(0, '127.0.0.1')
  await new Promise((done) => server.once('listening', done))
  BASE = `http://127.0.0.1:${server.address().port}`

  const newTask = async () => { const id = (await api('POST', '/tasks', { title: `${P} tarefa ${taskIds.length}` })).body.id; taskIds.push(id); return id }
  // Um registro aberto por tarefa (índice do banco): cada registro aberto usa a sua
  const record = async (completedAt, extra = {}) => {
    const r = await api('POST', '/executions', { taskId: await newTask(), description: P, completedAt, ...extra })
    executions.push(r.body.id)
    return r.body.id
  }
  const add = async (executionId, from, to) =>
    (await pool.query('INSERT INTO time_entries (task_execution_id, started_at, ended_at) VALUES ($1, $2, $3) RETURNING id', [executionId, from, to])).rows[0].id

  // ---------- sessão concluída
  const r1 = await record(day(15))
  const s1 = await add(r1, day(13), day(13, 30))
  let r = await patch(s1, { note: FRASE })
  check('concluída: 200 e a sessão volta com a nota', r.status === 200 && r.body?.id === s1 && r.body?.note === FRASE && r.body?.estimated === false && r.body?.endedAt !== null, detail(r))
  check('a nota está no banco', (await noteOf(s1)) === FRASE)
  const list = await api('GET', '/time-entries')
  check('GET /time-entries traz a nota (e as outras sessões com null)', list.body?.find((e) => e.id === s1)?.note === FRASE && list.body?.every((e) => 'note' in e), detail(list))

  // ---------- trim, vazio e null
  r = await patch(s1, { note: `   ${FRASE}\n  ` })
  check('trim: espaços e quebra de linha nas pontas saem', r.status === 200 && r.body?.note === FRASE && (await noteOf(s1)) === FRASE, detail(r))
  for (const [label, value] of [['texto vazio', ''], ['só espaços', '   '], ['só tabulação e quebra de linha', '\n\t \r\n'], ['null', null]]) {
    await patch(s1, { note: FRASE })
    r = await patch(s1, { note: value })
    check(`${label}: apaga a nota (vira null)`, r.status === 200 && r.body?.note === null && (await noteOf(s1)) === null, detail(r))
  }

  // ---------- limite: 2000 aceito, 2001 recusado sem eco
  r = await patch(s1, { note: 'b'.repeat(2000) })
  check('2000 caracteres: aceito', r.status === 200 && (await noteOf(s1))?.length === 2000, detail(r))
  r = await patch(s1, { note: ` ${'c'.repeat(2000)} ` })
  check('2000 caracteres com espaço nas pontas: o trim vem antes do limite', r.status === 200 && (await noteOf(s1)) === 'c'.repeat(2000), detail(r))
  const LONG = 'zq-frase-inventada-longa '.repeat(100).slice(0, 2001)
  let text = ''
  text = await logged(async () => { r = await patch(s1, { note: LONG }) })
  check('2001 caracteres: 400 com a mensagem do limite', r.status === 400 && r.body?.error === 'note pode ter no máximo 2000 caracteres', detail(r))
  check('2001: a resposta e o log não repetem o texto, e a nota de antes ficou', !r.text.includes('zq-frase') && !text.includes('zq-frase') && (await noteOf(s1)) === 'c'.repeat(2000), `${r.text.slice(0, 100)} | log: ${text.slice(0, 100)}`)

  // ---------- corpo inválido
  await patch(s1, { note: FRASE })
  const bad = [['corpo vazio {}', {}], ['sem corpo', undefined], ['número', { note: 123 }], ['lista', { note: [FRASE] }], ['objeto', { note: { a: FRASE } }], ['outro campo no lugar', { texto: FRASE }]]
  let badOk = true; const badWhy = []
  text = await logged(async () => {
    for (const [label, body] of bad) {
      const b = await patch(s1, body)
      if (b.status !== 400 || b.text.includes('123') || b.text.includes(FRASE)) { badOk = false; badWhy.push(`${label}: ${detail(b)}`) }
    }
  })
  check('corpo sem note, ou com número, lista, objeto: 400, sem eco no erro', badOk, badWhy.join(' | '))
  check('os corpos inválidos não escrevem o texto no log e a nota ficou', !text.includes(FRASE) && (await noteOf(s1)) === FRASE, text.slice(0, 120))

  // ---------- id inválido e inexistente
  r = await patch('nao-e-uuid', { note: FRASE })
  check('id que não é uuid: 404', r.status === 404 && r.body?.error === 'Sessão não encontrada', detail(r))
  r = await patch(GHOST, { note: FRASE })
  check('id inexistente: 404 (não 400)', r.status === 404 && r.body?.error === 'Sessão não encontrada', detail(r))

  // ---------- estimada: 400 e nada gravado
  const rE = await record(day(15), { estimatedSeconds: 1800 })
  const est = (await pool.query('SELECT id FROM time_entries WHERE task_execution_id = $1 AND estimated', [rE])).rows[0]?.id
  check('o registro estimado tem a sessão estimada', !!est)
  text = await logged(async () => { r = await patch(est, { note: FRASE }) })
  check('estimada: 400 "não tem nota" e nada gravado', r.status === 400 && /Sessão estimada não tem nota/.test(r.body?.error ?? '') && (await noteOf(est)) === null, detail(r))
  check('estimada: sem eco do texto na resposta nem no log', !r.text.includes(FRASE) && !text.includes(FRASE), `${r.text} | ${text.slice(0, 100)}`)
  r = await patch(est, { note: null })
  check('estimada: até apagar a nota é 400 (a regra é da sessão, não do texto)', r.status === 400, detail(r))

  // ---------- o PUT de horários não apaga a nota (inclusive reabrindo)
  const r7 = await record(day(15))
  const s7 = await add(r7, day(10), day(10, 30))
  await patch(s7, { note: FRASE })
  r = await api('PUT', `/time-entries/${s7}`, { startedAt: day(10, 5), endedAt: day(10, 40) })
  check('PUT de horários: 200 e a nota continua (resposta e banco)', r.status === 200 && r.body?.note === FRASE && (await noteOf(s7)) === FRASE, detail(r))
  const rOpen = await record(null)
  const sOld = await add(rOpen, day(9), day(9, 30))
  await patch(sOld, { note: FRASE })
  r = await api('PUT', `/time-entries/${sOld}`, { startedAt: day(9), endedAt: null })
  check('PUT reabrindo a sessão (endedAt null): 200, rodando, e a nota continua', r.status === 200 && r.body?.endedAt === null && r.body?.note === FRASE && (await noteOf(sOld)) === FRASE, detail(r))
  await api('PUT', `/time-entries/${sOld}`, { startedAt: day(9), endedAt: day(9, 30) })

  // ---------- rodando, Pausar, Retomar, Finalizar
  const rF = await record(null)
  const run = (await api('POST', '/time-entries', { taskExecutionId: rF, startedAt: minutesAgo(30) })).body
  r = await patch(run.id, { note: FRASE })
  check('sessão RODANDO: 200 e a nota gravada (endedAt segue null)', r.status === 200 && r.body?.endedAt === null && r.body?.note === FRASE && (await noteOf(run.id)) === FRASE, detail(r))
  r = await api('PUT', `/time-entries/${run.id}`, { startedAt: run.startedAt, endedAt: minutesAgo(20) })
  check('Pausar (PUT com endedAt): a nota continua', r.status === 200 && r.body?.endedAt !== null && r.body?.note === FRASE && (await noteOf(run.id)) === FRASE, detail(r))
  r = await api('POST', '/time-entries', { taskExecutionId: rF, startedAt: minutesAgo(10) })
  const second = r.body
  check('Retomar: a sessão nova nasce SEM nota e a anterior mantém a dela', r.status === 201 && second?.note === null && (await noteOf(second.id)) === null && (await noteOf(run.id)) === FRASE, detail(r))
  await patch(second.id, { note: OUTRA })
  r = await api('PUT', `/executions/${rF}`, { description: P, completedAt: new Date().toISOString() })
  const notes = (r.body?.timeEntries ?? []).map((e) => e.note)
  check('Finalizar: 200, fecha a sessão rodando e as duas notas continuam (resposta e banco)',
    r.status === 200 && notes.join('|') === [FRASE, OUTRA].join('|') && (await noteOf(run.id)) === FRASE && (await noteOf(second.id)) === OUTRA &&
    (await pool.query('SELECT count(*)::int AS n FROM time_entries WHERE task_execution_id = $1 AND ended_at IS NULL', [rF])).rows[0].n === 0, `${detail(r)} ${notes}`)

  // ---------- PATCH e Finalizar ao mesmo tempo (a nota e o fechamento sobrevivem, qualquer que seja a ordem)
  const N = 10
  let ok = 0; const why = []
  for (let i = 1; i <= N; i++) {
    const e = await record(null)
    const sess = (await api('POST', '/time-entries', { taskExecutionId: e, startedAt: minutesAgo(5) })).body
    const note = `${FRASE} ${i}`
    const [p, f] = await Promise.all([patch(sess.id, { note }), api('PUT', `/executions/${e}`, { description: P, completedAt: new Date().toISOString() })])
    const row = (await pool.query('SELECT note, ended_at, (SELECT completed_at FROM task_executions WHERE id = $2) AS done FROM time_entries WHERE id = $1', [sess.id, e])).rows[0]
    if (p.status === 200 && f.status === 200 && row.note === note && row.ended_at !== null && row.done !== null) ok++
    else why.push(`#${i}: PATCH ${p.status}, Finalizar ${f.status}, nota ${row.note === note}, fechada ${row.ended_at !== null}`)
  }
  check(`PATCH e Finalizar simultâneos, ${N} vezes: nota gravada, sessão fechada e registro concluído em todas`, ok === N, why.join(' | '))

  // ---------- excluir a sessão leva a nota; a outra fica
  const rD = await record(day(15))
  const sa = await add(rD, day(11), day(11, 30))
  const sb = await add(rD, day(12), day(12, 30))
  await patch(sa, { note: 'nota inventada da sessão A, só para sumir' })
  await patch(sb, { note: OUTRA })
  r = await api('DELETE', `/time-entries/${sa}`)
  const gone = (await pool.query("SELECT count(*)::int AS n FROM time_entries WHERE note LIKE '%só para sumir%'")).rows[0].n
  check('excluir a sessão com nota: 200, a nota some junto e a da outra sessão fica (resposta e banco)',
    r.status === 200 && gone === 0 && (await noteOf(sb)) === OUTRA && r.body?.timeEntries?.length === 1 && r.body.timeEntries[0].note === OUTRA, detail(r))

  // ---------- sem sessão e sem o cabeçalho
  const cookie = await sessionCookie(BASE)
  const url = `${BASE}/time-entries/${GHOST}`
  const noCookie = await fetch(url, { method: 'PATCH', headers: { 'X-StudyFlow': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ note: FRASE }) })
  check('PATCH sem cookie de sessão: 401', noCookie.status === 401, `${noCookie.status}`)
  // O cabeçalho X-StudyFlow é só do DELETE (sem corpo); com corpo, quem protege é o requireJson (outra origem exigiria preflight)
  const notJson = await fetch(`${BASE}/time-entries/${s1}`, { method: 'PATCH', headers: { Cookie: `sf_session=${cookie}`, 'Content-Type': 'text/plain' }, body: `note=${FRASE}` })
  check('PATCH com corpo que não é JSON: 415 e nada gravado', notJson.status === 415 && (await noteOf(s1)) === FRASE, `${notJson.status}`)

  // ---------- o errorHandler não deixa o texto da nota escapar num erro 500 do Postgres (message, detail, where trazem a linha)
  const pgErr = Object.assign(new Error(`new row violates check constraint; Failing row contains (${FRASE})`),
    { code: '23514', constraint: 'time_entries_note_length', table: 'time_entries', detail: `Failing row contains (${FRASE})`, where: `PL/pgSQL ${FRASE}` })
  const res500 = { code: 0, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
  text = await logged(async () => errorHandler(pgErr, { method: 'PATCH', originalUrl: `/time-entries/${GHOST}` }, res500, () => {}))
  check('erro 500 do Postgres com a nota na linha: o log diz onde (código e constraint), sem o texto, e a resposta é genérica',
    res500.code === 500 && /Erro 500 em PATCH \/time-entries\//.test(text) && /time_entries_note_length/.test(text) && !text.includes(FRASE) && !JSON.stringify(res500.body).includes(FRASE), `${text.slice(0, 160)} | ${JSON.stringify(res500.body)}`)
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false, String(err.stack).split('\n').slice(0, 3).join(' | '))
} finally {
  await new Promise((done) => (server ? server.close(done) : done()))
  await deleteExecutions(pool, executions)
  if (taskIds.length) await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [taskIds])
  await resumeRunning(pool, seedSession)
  const left = await pool.query(`SELECT (SELECT count(*) FROM tasks WHERE title LIKE $1)::int + (SELECT count(*) FROM task_executions WHERE description = $2)::int AS n`, [`${P}%`, P])
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  const running = await pool.query('SELECT count(*)::int AS n FROM time_entries WHERE ended_at IS NULL')
  check('a sessão rodando do seed voltou (uma rodando)', running.rows[0].n === seedSession.length, `${running.rows[0].n}`)
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length && ok > 0 ? 0 : 1
  process.exit()
}
