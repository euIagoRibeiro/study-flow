// Retomar (POST /time-entries) × Finalizar (PUT /executions/:id): nunca sobra registro concluído com
// sessão rodando. O INSERT … SELECT do Retomar pega só FOR KEY SHARE no registro (pela FK), que não
// conflita com o UPDATE do Finalizar; o FOR SHARE do SELECT conflita, então o Retomar espera o
// Finalizar e depois vê o registro concluído (400). Provas: (1) intercalação forçada, com o UPDATE do
// Finalizar segurado por esta bateria e a espera conferida em pg_stat_activity; (2) a consequência
// (cronômetro novo em outra tarefa); (3) as duas rotas reais ao mesmo tempo, nas duas ordens.
// Dados próprios (prefixo teste-corrida), apagados no fim; pausa a sessão do seed e devolve a linha exata.
// Uso (raiz do repo): node --env-file=backend/.env tests/api/sessao-corrida-test.mjs
import pg from 'pg'
import { API } from '../config.mjs'
import { apiFetch } from '../sessao.mjs'
import { deleteExecutions, pauseRunning, resumeRunning } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-corrida'
const ROUNDS = 30
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(method, path, body) {
  const res = await apiFetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
  return { status: res.status, body: parsed }
}
const detail = (r) => `status ${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}`
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString()
const CLOSED = 'Execução não encontrada ou já finalizada'

const seedSession = await pauseRunning(pool)
const executions = []
const taskIds = []
const lockClient = await pool.connect()
try {
  const newTask = async () => { const id = (await api('POST', '/tasks', { title: `${P} tarefa ${taskIds.length}` })).body.id; taskIds.push(id); return id }
  // Registro aberto com uma sessão já pausada (o caso do Retomar)
  const pausedRecord = async () => {
    const r = await api('POST', '/executions', { taskId: await newTask(), description: P, completedAt: null })
    executions.push(r.body.id)
    await pool.query('INSERT INTO time_entries (task_execution_id, started_at, ended_at) VALUES ($1, $2, $3)', [r.body.id, iso(-120_000), iso(-60_000)])
    return r.body.id
  }
  const state = async (id) => (await pool.query(
    `SELECT (SELECT completed_at IS NOT NULL FROM task_executions WHERE id = $1) AS done,
            (SELECT count(*)::int FROM time_entries WHERE task_execution_id = $1) AS sessions,
            (SELECT count(*)::int FROM time_entries WHERE task_execution_id = $1 AND ended_at IS NULL) AS running`, [id])).rows[0]
  const waiting = async () => (await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`)).rows[0].n
  const waitFor = async (n) => { for (let i = 0; i < 40; i++) { if ((await waiting()) >= n) return true; await pause(100) } return false }

  // ---------- (1) intercalação forçada: o Finalizar fez o UPDATE e ainda não deu COMMIT
  const e1 = await pausedRecord()
  await lockClient.query('BEGIN')
  await lockClient.query('UPDATE task_executions SET completed_at = $2 WHERE id = $1', [e1, iso()])
  await lockClient.query('UPDATE time_entries SET ended_at = $2 WHERE task_execution_id = $1 AND ended_at IS NULL', [e1, iso()])
  const retomar = api('POST', '/time-entries', { taskExecutionId: e1, startedAt: iso() })
  check('1: o Retomar espera o Finalizar em andamento', await waitFor(1), `${await waiting()} esperando`)
  await lockClient.query('COMMIT')
  const r1 = await retomar
  check('1: depois do Finalizar, o Retomar é recusado (400, registro já finalizado)', r1.status === 400 && r1.body?.error === CLOSED, detail(r1))
  const s1 = await state(e1)
  check('1: registro concluído, nenhuma sessão rodando, nenhuma sessão nova', s1.done && s1.running === 0 && s1.sessions === 1, JSON.stringify(s1))

  // ---------- (2) a consequência da corrida antiga: uma sessão rodando travava todo cronômetro novo
  const other = await api('POST', '/executions', { taskId: await newTask(), description: P, completedAt: null })
  executions.push(other.body.id)
  const next = await api('POST', '/time-entries', { taskExecutionId: other.body.id, startedAt: iso() })
  check('2: iniciar o cronômetro em outra tarefa continua possível (201)', next.status === 201, detail(next))
  await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL')

  // ---------- (3) as duas rotas reais ao mesmo tempo, nas duas ordens de disparo
  const tally = { anomalies: 0, retomadaGanhou: 0, finalizarGanhou: 0, finalizarRecusado: 0, outros: 0 }
  for (let i = 0; i < ROUNDS; i++) {
    const e = await pausedRecord()
    const fin = () => api('PUT', `/executions/${e}`, { description: null, completedAt: iso() })
    const ret = () => api('POST', '/time-entries', { taskExecutionId: e, startedAt: iso() })
    const [x, y] = await Promise.all(i % 2 === 0 ? [fin(), ret()] : [ret(), fin()])
    const [f, r] = i % 2 === 0 ? [x, y] : [y, x]
    const s = await state(e)
    if (s.done && s.running > 0) tally.anomalies++
    if (f.status === 200 && r.status === 201) tally.retomadaGanhou++
    else if (f.status === 200 && r.status === 400) tally.finalizarGanhou++
    else if (f.status === 400 && r.status === 201 && !s.done && s.running === 1) tally.finalizarRecusado++
    else { tally.outros++; tally.odd = [...(tally.odd ?? []), `Finalizar ${f.status} ${JSON.stringify(f.body)?.slice(0, 120)} / Retomar ${r.status} ${JSON.stringify(r.body)?.slice(0, 120)}`] }
    await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL AND task_execution_id = $1', [e])
  }
  check(`3: ${ROUNDS} disparos simultâneos, nenhum registro concluído com sessão rodando`, tally.anomalies === 0, JSON.stringify(tally))
  check('3: todo disparo terminou em Finalizar 200 (Retomar 201 ou 400) ou Finalizar recusado por terminar antes da sessão nova (registro aberto, uma rodando)', tally.outros === 0, JSON.stringify(tally))
  console.log(`      (Retomar antes do Finalizar: ${tally.retomadaGanhou}; Finalizar antes: ${tally.finalizarGanhou}; Finalizar recusado: ${tally.finalizarRecusado})`)
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false, String(err.stack).split(String.fromCharCode(10)).slice(0, 3).join(' | '))
} finally {
  await lockClient.query('ROLLBACK').catch(() => {})
  lockClient.release()
  await deleteExecutions(pool, executions)
  if (taskIds.length) await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [taskIds])
  await resumeRunning(pool, seedSession)
  const left = await pool.query(`SELECT (SELECT count(*) FROM tasks WHERE title LIKE $1)::int + (SELECT count(*) FROM task_executions WHERE description = $2)::int AS n`, [`${P}%`, P])
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  const running = await pool.query('SELECT count(*)::int AS n FROM time_entries WHERE ended_at IS NULL')
  check('a sessão rodando do seed voltou (uma rodando)', running.rows[0].n === seedSession.length, `${running.rows[0].n}`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
