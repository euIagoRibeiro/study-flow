// Bateria da A1b (API da duração estimada).
// Uso (raiz do repo): node --env-file=backend/.env <este arquivo>
// Cria a própria tarefa; apaga tudo no finally (pg), esperando a API antes
// de cada pedido.
import { join } from 'node:path'

import pg from 'pg'
import { API } from '../config.mjs'
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const TITLE = 'teste-a1b'
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
const ms = (iso) => new Date(iso).getTime()
const MIN = 60_000
// Sessões de um registro, direto do GET (a fonte que a tela usa hoje)
const entriesOf = async (id) =>
  (await api('GET', '/time-entries')).body.filter((e) => e.taskExecutionId === id)
const estimateOf = async (id) => (await entriesOf(id)).filter((e) => e.estimated)

let taskId = null
try {
  taskId = (await api('POST', '/tasks', { title: TITLE })).body.id
  const quando = '2026-10-20T01:00:00.000Z' // 22:00 do dia 19 em Brasília
  const base = { taskId, description: 'a1b', completedAt: quando }

  // --- POST
  let r = await api('POST', '/executions', { ...base, estimatedMinutes: 45 })
  const execId = r.body?.id
  const est = (await estimateOf(execId))[0]
  check('POST com 45 min: 201 e uma sessão estimada', r.status === 201 && est !== undefined, detail(r))
  check('âncora: fim = Quando, início 45 min antes',
    est && ms(est.endedAt) === ms(quando) && ms(est.endedAt) - ms(est.startedAt) === 45 * MIN)
  check('resposta traz timeEntries do registro (com a estimada)',
    Array.isArray(r.body?.timeEntries) && r.body.timeEntries.some((e) => e.estimated && e.id === est?.id))
  check('GET /time-entries: estimated booleano em todas',
    (await api('GET', '/time-entries')).body.every((e) => typeof e.estimated === 'boolean'))

  r = await api('POST', '/executions', { ...base, completedAt: null, estimatedMinutes: 45 })
  check('registro aberto com estimativa: 400', r.status === 400, detail(r))
  for (const bad of [0, 1441, 2.5]) {
    r = await api('POST', '/executions', { ...base, estimatedMinutes: bad })
    check(`estimatedMinutes ${bad}: 400`, r.status === 400, detail(r))
  }

  // --- PUT
  const put = (body) => api('PUT', `/executions/${execId}`, { description: 'a1b', completedAt: quando, ...body })
  r = await put({})
  const kept = await estimateOf(execId)
  check('PUT sem estimatedMinutes mantém a estimativa',
    r.status === 200 && kept.length === 1 && kept[0].id === est.id && ms(kept[0].startedAt) === ms(est.startedAt))

  const ontem = '2026-10-19T01:00:00.000Z'
  r = await api('PUT', `/executions/${execId}`, { description: 'a1b', completedAt: ontem })
  let moved = (await estimateOf(execId))[0]
  check('mudar o Quando move a estimativa e mantém 45 min', r.status === 200 && moved &&
    ms(moved.endedAt) === ms(ontem) && ms(moved.endedAt) - ms(moved.startedAt) === 45 * MIN)
  check('resposta do PUT traz a estimada já movida',
    r.body?.timeEntries?.some((e) => e.estimated && ms(e.endedAt) === ms(ontem)))

  r = await api('PUT', `/executions/${execId}`, { description: 'a1b', completedAt: ontem, estimatedMinutes: 30 })
  moved = await estimateOf(execId)
  check('trocar pra 30 min (continua uma só, ancorada)', r.status === 200 && moved.length === 1 &&
    ms(moved[0].endedAt) === ms(ontem) && ms(moved[0].endedAt) - ms(moved[0].startedAt) === 30 * MIN)

  r = await api('PUT', `/executions/${execId}`, { description: 'a1b', completedAt: ontem, estimatedMinutes: null })
  check('null remove a estimativa', r.status === 200 && (await estimateOf(execId)).length === 0, detail(r))

  // Cronômetro + estimativa: sessão de cronômetro inserida direto (já há uma rodando no seed)
  const timer = (await pool.query(
    `INSERT INTO time_entries (task_execution_id, started_at, ended_at)
     VALUES ($1, $2::timestamptz - interval '2 hours', $2::timestamptz - interval '90 minutes')
     RETURNING started_at, ended_at`, [execId, ontem])).rows[0]
  r = await api('PUT', `/executions/${execId}`, { description: 'a1b', completedAt: quando, estimatedMinutes: 20 })
  const all = await entriesOf(execId)
  const t = all.find((e) => !e.estimated)
  check('estimativa + cronômetro convivem; cronômetro não se move com o Quando',
    r.status === 200 && all.length === 2 && all.some((e) => e.estimated) &&
    ms(t.startedAt) === timer.started_at.getTime() && ms(t.endedAt) === timer.ended_at.getTime())

  // --- Sessões
  const estimated = (await estimateOf(execId))[0]
  r = await api('PUT', `/time-entries/${estimated.id}`, { startedAt: estimated.startedAt, endedAt: estimated.endedAt })
  check('editar sessão estimada: 400', r.status === 400, detail(r))
  r = await api('PUT', `/time-entries/${t.id}`, { startedAt: t.startedAt, endedAt: t.endedAt })
  check('editar sessão de cronômetro continua 200', r.status === 200, detail(r))

  // --- Reabrir com estimativa
  r = await api('PUT', `/executions/${execId}`, { description: 'a1b', completedAt: null })
  const still = (await api('GET', '/executions')).body.find((e) => e.id === execId)
  check('reabrir registro com estimativa: 400 e nada muda',
    r.status === 400 && ms(still.completedAt) === ms(quando) && (await estimateOf(execId)).length === 1, detail(r))

  // --- Sobreposição (de propósito)
  const a = await api('POST', '/executions', { ...base, estimatedMinutes: 60 })
  const b = await api('POST', '/executions', { ...base, estimatedMinutes: 90 })
  check('duas estimativas sobrepostas, registros diferentes: as duas 201',
    a.status === 201 && b.status === 201, `${a.status}, ${b.status}`)

  r = await api('POST', '/executions', { ...base })
  check('registrar sem estimativa continua funcionando (sem sessão)',
    r.status === 201 && (await entriesOf(r.body.id)).length === 0, detail(r))
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
  const left = await pool.query(`SELECT count(*)::int AS n FROM tasks WHERE title = $1`, [TITLE])
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
