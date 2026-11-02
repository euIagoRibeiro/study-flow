// Corrida entre apagar obra e gravar registro. Uso (raiz do repo):
//   node --env-file=backend/.env <este arquivo>
// Uma conexão própria segura a linha que interessa, e cada pedido só avança
// depois de o banco mostrar o outro parado na trava (pg_stat_activity): a
// intercalação é sempre a mesma, sem depender de tempo.
// Ordem do PUT: registro, obra, tags. A trava depois do applyTags cai no caso "PUT
// antes". O deadlock dela não dá pra forçar aqui: mora dentro do UPDATE da raiz,
// entre travar o registro e conferir as FKs (provado com um trigger de sonda, em
// banco temporário; ver docs/progresso.md, O2b).
// Prefixo teste-corrida-o; apaga tudo no finally (pg).
import pg from 'pg'
import { API } from '../config.mjs'
import { deleteExecutions } from '../limpeza.mjs'
const { Pool } = pg
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-corrida-o'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = { error: text.slice(0, 80) } }
  return { status: res.status, body: parsed }
}
const detail = (r) => `status ${r.status}${r.body?.error ? `: ${r.body.error}` : ''}`
const must = async (...args) => {
  const r = await api(...args)
  if (r.status >= 300) throw new Error(`${args[1]}: ${detail(r)}`)
  return r.body
}
const tag = (name, parentId = null) => must('POST', '/tags', { name, parentId })

// Espera até `count` pedidos da API (fora as conexões da bateria) estarem
// parados numa trava. Sem isso a intercalação não aconteceu: falha
async function blocked(count, mine) {
  for (let i = 0; i < 300; i++) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'
         AND pid <> ALL($1)`,
      [mine],
    )
    if (rows[0].n >= count) return true
    await new Promise((r) => setTimeout(r, 20))
  }
  return false
}
const workOf = async (id) => (await pool.query('SELECT work_id FROM task_executions WHERE id = $1', [id])).rows[0]?.work_id ?? null
const exists = async (id) => (await pool.query('SELECT 1 FROM works WHERE id = $1', [id])).rowCount === 1

const hold = await pool.connect()
const mine = [(await hold.query('SELECT pg_backend_pid() AS pid')).rows[0].pid]
const completedAt = new Date().toISOString()
let taskId = null
const tagIds = []

try {
  const task = await must('POST', '/tasks', { title: `${P} tarefa` })
  taskId = task.id
  const R1 = await tag(`${P} raiz 1`)
  const R2 = await tag(`${P} raiz 2`)
  const M = await tag(`${P} meio`, R2.id)
  const L = await tag(`${P} folha`, M.id)
  tagIds.push(L.id, M.id, R1.id, R2.id)
  let n = 0
  const work = async () => must('POST', '/works', { title: `${P} obra ${++n}`, defaultTagId: R1.id, defaultTaskId: taskId })
  const record = async (body = {}) => (await must('POST', '/executions', { taskId, description: 'corrida', completedAt, rootTagId: R1.id, tagIds: [], ...body })).id
  const put = (id, body) => api('PUT', `/executions/${id}`, { description: 'corrida', completedAt, ...body })
  // Prende o PUT no INSERT das ligações, DEPOIS de trocar a raiz: o pai de um
  // nível 3 entra no fechamento e só é tocado ali, pela FK
  const parkAfterRoot = async () => {
    await hold.query('BEGIN')
    await hold.query('SELECT 1 FROM tags WHERE id = $1 FOR UPDATE', [M.id])
  }

  // 1. O apagar chega primeiro
  {
    const w = await work()
    const id = await record()
    await hold.query('BEGIN')
    await hold.query('DELETE FROM works WHERE id = $1', [w.id])
    const gravar = put(id, { workId: w.id })
    check('apagar antes: PUT parado na obra', await blocked(1, mine))
    await hold.query('COMMIT')
    const p = await gravar
    check('apagar antes: PUT recebe 400 amigável', p.status === 400 && /Obra/.test(p.body.error), detail(p))
    check('apagar antes: registro sem obra', (await workOf(id)) === null)
  }

  // 2. O apagar é desfeito
  {
    const w = await work()
    const id = await record()
    await hold.query('BEGIN')
    await hold.query('DELETE FROM works WHERE id = $1', [w.id])
    const gravar = put(id, { workId: w.id })
    check('apagar desfeito: PUT parado na obra', await blocked(1, mine))
    await hold.query('ROLLBACK')
    const p = await gravar
    check('apagar desfeito: PUT grava', p.status === 200 && (await workOf(id)) === w.id, detail(p))
  }

  // 3. O PUT chega primeiro e para depois de ligar a obra
  {
    const w = await work()
    const id = await record()
    await parkAfterRoot()
    const gravar = put(id, { workId: w.id, rootTagId: R2.id, tagIds: [L.id] })
    check('PUT antes: PUT parado', await blocked(1, mine))
    const apagar = api('DELETE', `/works/${w.id}`)
    check('PUT antes: DELETE também parado', await blocked(2, mine))
    await hold.query('ROLLBACK')
    const [p, d] = await Promise.all([gravar, apagar])
    check('PUT antes: PUT grava', p.status === 200 && (await workOf(id)) === w.id, detail(p))
    check('PUT antes: DELETE responde 409', d.status === 409, detail(d))
    check('PUT antes: a obra fica', await exists(w.id))
  }

  // 4. POST com o apagar em andamento
  {
    const w = await work()
    await hold.query('BEGIN')
    await hold.query('DELETE FROM works WHERE id = $1', [w.id])
    const criar = api('POST', '/executions', { taskId, description: 'corrida', completedAt, workId: w.id })
    check('POST: parado na obra', await blocked(1, mine))
    await hold.query('COMMIT')
    const c = await criar
    check('POST: 400 amigável', c.status === 400 && /Obra/.test(c.body.error), detail(c))
  }

  // 5. O registro JÁ aponta pra obra e o PUT troca a raiz: fila, sem ciclo. O
  // próprio UPDATE da raiz reconfere a FK da obra (linha criada na transação)
  {
    const w = await work()
    const id = await record({ workId: w.id })
    await parkAfterRoot()
    const gravar = put(id, { workId: w.id, rootTagId: R2.id, tagIds: [L.id] })
    check('troca de raiz: PUT parado depois de trocar a raiz', await blocked(1, mine))
    const apagar = api('DELETE', `/works/${w.id}`)
    check('troca de raiz: DELETE também parado', await blocked(2, mine))
    await hold.query('ROLLBACK')
    const [p, d] = await Promise.all([gravar, apagar])
    check('troca de raiz: PUT grava (sem deadlock)', p.status === 200, detail(p))
    check('troca de raiz: DELETE responde 409 (sem deadlock)', d.status === 409, detail(d))
    check('troca de raiz: registro com a raiz nova e a obra', (await workOf(id)) === w.id)
  }

  // 6. Dois registros na mesma obra não fazem fila
  {
    const w = await work()
    const first = await record()
    const second = await record()
    await parkAfterRoot()
    const gravar = put(first, { workId: w.id, rootTagId: R2.id, tagIds: [L.id] })
    check('mesma obra: 1º PUT parado', await blocked(1, mine))
    const r = await Promise.race([put(second, { workId: w.id }), new Promise((s) => setTimeout(() => s({ status: 'preso' }), 2000))])
    check('mesma obra: 2º PUT passa sem esperar', r.status === 200, detail(r))
    await hold.query('ROLLBACK')
    const p = await gravar
    check('mesma obra: 1º PUT grava', p.status === 200, detail(p))
  }

  // 7. Mudar o status com um PUT no meio
  {
    const w = await work()
    const id = await record()
    await parkAfterRoot()
    const gravar = put(id, { workId: w.id, rootTagId: R2.id, tagIds: [L.id] })
    check('status: PUT parado', await blocked(1, mine))
    const r = await Promise.race([api('PATCH', `/works/${w.id}`, { status: 'pausado' }), new Promise((s) => setTimeout(() => s({ status: 'preso' }), 2000))])
    check('status: PATCH passa sem esperar', r.status === 200, detail(r))
    await hold.query('ROLLBACK')
    const p = await gravar
    check('status: PUT grava', p.status === 200, detail(p))
  }
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await hold.query('ROLLBACK').catch(() => {})
  hold.release()
  if (taskId) {
    const ids = (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [taskId])).rows.map((r) => r.id)
    await deleteExecutions(pool, ids)
  }
  await pool.query(`DELETE FROM works WHERE title LIKE '${P}%'`)
  if (taskId) await pool.query('DELETE FROM tasks WHERE id = $1', [taskId])
  for (const id of tagIds) await pool.query('DELETE FROM tags WHERE id = $1', [id])
  const left = await pool.query(
    `SELECT (SELECT count(*) FROM works)::int + (SELECT count(*) FROM tags WHERE name LIKE '${P}%')::int +
            (SELECT count(*) FROM tasks WHERE title LIKE '${P}%')::int AS n`)
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
