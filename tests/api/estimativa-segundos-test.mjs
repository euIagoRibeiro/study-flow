// Duração estimada em segundos: estimatedSeconds (1 a 86400) ao lado do
// estimatedMinutes, que continua valendo; os dois no mesmo pedido = 400. A
// duração é conferida no banco, em microssegundos (a sessão estimada termina
// no "Quando" e começa N segundos antes, exato).
// Uso (raiz do repo): node --env-file=backend/.env tests/api/estimativa-segundos-test.mjs
// Cria a própria tarefa (teste-estimativa-s) e apaga tudo no finally.
import pg from 'pg'
import { API } from '../config.mjs'
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const TITLE = 'teste-estimativa-s'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? ` (${detail})` : ''}`)
}
async function waitForApi() {
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(`${API}/tasks`)).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('API não respondeu em 30s')
}
async function api(method, path, body) {
  await waitForApi()
  const res = await fetch(API + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const detail = (r) => `status ${r.status}${r.body?.error ? `: ${r.body.error}` : ''}`
// A estimada do registro no banco: fim, duração em segundos (com fração) e o "Quando"
async function estimateOf(id) {
  const r = await pool.query(
    `SELECT te.id, te.ended_at = e.completed_at AS anchored,
            extract(epoch FROM te.ended_at - te.started_at)::float8 AS seconds
     FROM time_entries te JOIN task_executions e ON e.id = te.task_execution_id
     WHERE te.task_execution_id = $1 AND te.estimated`, [id])
  return r.rows
}

let taskId = null
if (!process.env.DATABASE_URL) {
  console.log('FALHOU sem DATABASE_URL (a limpeza usa o banco direto): nada foi criado')
  process.exit(1)
}
try {
  taskId = (await api('POST', '/tasks', { title: TITLE })).body.id
  const quando = '2026-10-20T01:00:12.345Z'
  const base = { taskId, description: 'estimativa-s', completedAt: quando }

  // --- POST
  let r = await api('POST', '/executions', { ...base, estimatedSeconds: 82 })
  const id = r.body?.id
  let est = await estimateOf(id)
  check('POST com 82 s: 201, uma estimada, termina no "Quando", 82 s exatos',
    r.status === 201 && est.length === 1 && est[0].anchored && est[0].seconds === 82, `${detail(r)} ${JSON.stringify(est)}`)
  check('resposta traz a estimada nas sessões do registro',
    r.body?.timeEntries?.some((e) => e.estimated && e.id === est[0]?.id))

  r = await api('POST', '/executions', { ...base, estimatedSeconds: 86400 })
  check('86400 s (24 h): aceito', r.status === 201 && (await estimateOf(r.body.id))[0]?.seconds === 86400, detail(r))

  r = await api('POST', '/executions', { ...base, estimatedMinutes: 45 })
  check('estimatedMinutes continua valendo (45 min = 2700 s)',
    r.status === 201 && (await estimateOf(r.body.id))[0]?.seconds === 2700, detail(r))

  r = await api('POST', '/executions', { ...base, estimatedMinutes: 1, estimatedSeconds: 82 })
  check('os dois campos juntos: 400 com o motivo', r.status === 400 && /não os dois/.test(r.body?.error ?? ''), detail(r))
  r = await api('POST', '/executions', { ...base, estimatedMinutes: null, estimatedSeconds: 82 })
  check('os dois juntos, um deles null: 400', r.status === 400, detail(r))

  r = await api('POST', '/executions', { ...base, completedAt: null, estimatedSeconds: 82 })
  check('registro aberto com estimatedSeconds: 400', r.status === 400, detail(r))
  for (const bad of [0, 86401, 1.5, '82', -5]) {
    r = await api('POST', '/executions', { ...base, estimatedSeconds: bad })
    check(`estimatedSeconds ${JSON.stringify(bad)}: 400`, r.status === 400, detail(r))
  }

  // --- PUT
  const put = (body, completedAt = quando) =>
    api('PUT', `/executions/${id}`, { description: 'estimativa-s', completedAt, ...body })
  const first = (await estimateOf(id))[0]
  r = await put({})
  est = await estimateOf(id)
  check('PUT sem estimativa mantém a mesma (id e 82 s)',
    r.status === 200 && est.length === 1 && est[0].id === first.id && est[0].seconds === 82, detail(r))

  const ontem = '2026-10-19T01:00:12.345Z'
  r = await put({}, ontem)
  est = await estimateOf(id)
  check('mudar o "Quando" leva a estimativa junto, com os mesmos 82 s',
    r.status === 200 && est.length === 1 && est[0].anchored && est[0].seconds === 82, JSON.stringify(est))

  r = await put({ estimatedSeconds: 4030 }, ontem)
  est = await estimateOf(id)
  check('trocar pra 4030 s (1:07:10): uma só, ancorada', r.status === 200 && est.length === 1 && est[0].anchored && est[0].seconds === 4030, JSON.stringify(est))

  r = await put({ estimatedMinutes: 30 }, ontem)
  est = await estimateOf(id)
  check('PUT com estimatedMinutes 30 continua valendo (1800 s)', r.status === 200 && est[0]?.seconds === 1800, JSON.stringify(est))

  r = await put({ estimatedMinutes: 20, estimatedSeconds: 82 }, ontem)
  est = await estimateOf(id)
  check('PUT com os dois: 400 e nada muda', r.status === 400 && est[0]?.seconds === 1800, detail(r))

  r = await put({ estimatedSeconds: null }, ontem)
  check('estimatedSeconds null remove', r.status === 200 && (await estimateOf(id)).length === 0, detail(r))

  r = await put({ estimatedSeconds: 82 }, ontem)
  r = await api('PUT', `/executions/${id}`, { description: 'estimativa-s', completedAt: null, estimatedSeconds: 60 })
  est = await estimateOf(id)
  check('reabrir mandando estimatedSeconds: 400 e a estimada fica', r.status === 400 && est[0]?.seconds === 82, detail(r))
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await waitForApi()
  if (taskId) {
    await pool.query(`DELETE FROM time_entries WHERE task_execution_id IN
                        (SELECT id FROM task_executions WHERE task_id = $1)`, [taskId])
    await pool.query('DELETE FROM task_executions WHERE task_id = $1', [taskId])
    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId])
  }
  const left = await pool.query('SELECT count(*)::int AS n FROM tasks WHERE title = $1', [TITLE])
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
