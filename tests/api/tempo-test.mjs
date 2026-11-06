// Tempo corrigido no Finalizar: nenhum registro termina, e nenhuma sessão começa
// ou termina, no futuro (tolerância de 5 minutos pro relógio do celular).
// Registrar (POST), Finalizar e o lápis (PUT do registro); Retomar (POST da
// sessão), Pausar e o lápis da sessão (PUT da sessão). Finalizar com o fim
// corrigido (início + duração) fecha a sessão rodando exatamente no "Quando".
// Mensagens em português de tela; no Finalizar e no Pausar (fechar o que está
// aberto) com "Confira o horário do aparelho.", no lápis sem. Dados próprios (prefixo teste-tempo),
// apagados no fim; pausa a sessão do seed e devolve a linha exata. Uso (raiz):
//   node --env-file=backend/.env tests/api/tempo-test.mjs
import pg from 'pg'
import { API } from '../config.mjs'
import { deleteExecutions, pauseRunning, resumeRunning } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-tempo'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
async function api(method, path, body) {
  const res = await fetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const detail = (r) => `status ${r.status}${r.body?.error ? `: ${r.body.error}` : ''}`
const at = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString()
const FUTURE_END = 'O registro não pode terminar no futuro.'
const SESSION_END = 'A sessão não pode terminar no futuro.'
// Só no Finalizar e no Pausar (fechar o que está aberto): o fim é o "agora" do aparelho
const CLOCK = ' Confira o horário do aparelho.'

const seedSession = await pauseRunning(pool)
let taskId = null
try {
  const task = await api('POST', '/tasks', { title: `${P} tarefa` })
  taskId = task.body.id
  const post = (completedAt) => api('POST', '/executions', { taskId, description: P, completedAt })
  const row = async (id) => (await pool.query('SELECT completed_at FROM task_executions WHERE id = $1', [id])).rows[0]
  const sessionsOf = async (id) => (await pool.query('SELECT id, started_at, ended_at FROM time_entries WHERE task_execution_id = $1 ORDER BY started_at', [id])).rows

  // ---------- Registrar (POST)
  let r = await post(at(10))
  check('Registrar com "Quando" 10 min no futuro: 400', r.status === 400 && r.body?.error === FUTURE_END, detail(r))
  r = await post(at(1))
  check('Registrar com "Quando" 1 min no futuro (tolerância): 201', r.status === 201, detail(r))
  const closed = r.body?.id

  // ---------- registro aberto e sessões (POST /time-entries = Iniciar/Retomar)
  r = await post(null)
  check('registro aberto (completedAt null): sem a regra, 201', r.status === 201, detail(r))
  const open = r.body?.id
  r = await api('POST', '/time-entries', { taskExecutionId: open, startedAt: at(10) })
  check('sessão começando 10 min no futuro: 400', r.status === 400 && r.body?.error === 'A sessão não pode começar no futuro.', detail(r))
  r = await api('POST', '/time-entries', { taskExecutionId: open, startedAt: at(-120) })
  check('sessão começando há 2h: 201, rodando', r.status === 201 && r.body?.endedAt === null, detail(r))
  const running = r.body

  // ---------- Finalizar
  const finish = (completedAt, extra = {}) => api('PUT', `/executions/${open}`, { description: P, completedAt, ...extra })
  r = await finish(at(10))
  let s = await sessionsOf(open)
  check('Finalizar com fim 10 min no futuro: 400 com "Confira o horário", registro aberto e sessão rodando', r.status === 400 && r.body?.error === FUTURE_END + CLOCK &&(await row(open)).completed_at === null && s[0].ended_at === null, detail(r))
  r = await finish(at(-125))
  check('Finalizar antes do início da sessão: 400 em português', r.status === 400 && r.body?.error === 'O registro não pode terminar antes do início da sessão em andamento.', detail(r))
  const corrected = new Date(new Date(running.startedAt).getTime() + 30 * 60_000).toISOString()
  r = await finish(corrected)
  s = await sessionsOf(open)
  const done = (await row(open)).completed_at
  check('Finalizar com início + 30 min: 200', r.status === 200, detail(r))
  check('a sessão termina exatamente no "Quando" do registro', s.length === 1 && s[0].ended_at?.toISOString() === corrected && done?.toISOString() === corrected, JSON.stringify({ s, done }))

  // ---------- lápis do registro (PUT de registro fechado)
  r = await api('PUT', `/executions/${closed}`, { description: P, completedAt: at(30) })
  check('lápis com "Quando" no futuro: 400, sem "Confira o horário"', r.status === 400 && r.body?.error === FUTURE_END, detail(r))
  r = await api('PUT', `/executions/${closed}`, { description: P, completedAt: at(-60) })
  check('lápis com "Quando" no passado: 200', r.status === 200, detail(r))

  // ---------- lápis da sessão e Pausar (PUT /time-entries)
  const entry = s[0]
  const putEntry = (startedAt, endedAt) => api('PUT', `/time-entries/${entry.id}`, { startedAt, endedAt })
  r = await putEntry(entry.started_at.toISOString(), at(10))
  check('lápis da sessão terminando 10 min no futuro: 400, sem "Confira o horário"', r.status === 400 && r.body?.error === SESSION_END, detail(r))
  r = await putEntry(at(10), at(20))
  check('sessão começando no futuro: 400', r.status === 400 && r.body?.error === 'A sessão não pode começar no futuro.', detail(r))
  r = await putEntry(at(-30), at(-60))
  check('fim antes do início: 400 em português', r.status === 400 && r.body?.error === 'O fim da sessão precisa ser depois do início.', detail(r))
  r = await putEntry(entry.started_at.toISOString(), at(1))
  check('fim 1 min no futuro (tolerância): 200', r.status === 200, detail(r))
  r = await putEntry(entry.started_at.toISOString(), corrected)
  check('fim no passado: 200', r.status === 200, detail(r))

  // ---------- Pausar (PUT da sessão rodando)
  r = await post(null)
  const paused = r.body?.id
  r = await api('POST', '/time-entries', { taskExecutionId: paused, startedAt: at(-30) })
  const live = r.body
  r = await api('PUT', `/time-entries/${live?.id}`, { startedAt: live?.startedAt, endedAt: at(10) })
  const still = await sessionsOf(paused)
  check('Pausar com fim 10 min no futuro: 400 com "Confira o horário", sessão rodando', r.status === 400 && r.body?.error === SESSION_END + CLOCK && still.length === 1 && still[0].ended_at === null, detail(r))
  r = await api('PUT', `/time-entries/${live?.id}`, { startedAt: live?.startedAt, endedAt: at(0) })
  check('Pausar agora: 200', r.status === 200 && r.body?.endedAt !== null, detail(r))
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  if (taskId) {
    await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [taskId])).rows.map((r) => r.id))
    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId])
  }
  await resumeRunning(pool, seedSession)
  const left = await pool.query(`SELECT count(*)::int AS n FROM tasks WHERE title LIKE '${P}%'`)
  const runningNow = await pool.query('SELECT count(*)::int AS n FROM time_entries WHERE ended_at IS NULL')
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  check('sessão do seed devolvida', runningNow.rows[0].n === seedSession.length, `${runningNow.rows[0].n} x ${seedSession.length}`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
