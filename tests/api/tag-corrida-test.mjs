// Corrida entre apagar tag e gravar registro. Uso (raiz do repo):
//   node --env-file=backend/.env <este arquivo>
// Uma conexão própria segura a linha que interessa, e cada pedido só avança
// depois de o banco mostrar o outro parado na trava (pg_stat_activity), então
// a intercalação é sempre a mesma, sem depender de tempo.
// Cria a própria árvore (prefixo teste-corrida); apaga tudo no finally (pg).
import pg from 'pg'
import { API } from '../config.mjs'
import { apiFetch } from '../sessao.mjs'
const { Pool } = pg
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-corrida'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? ` (${detail})` : ''}`)
}
async function waitForApi() {
  for (let i = 0; i < 30; i++) {
    try { if ((await apiFetch(`${API}/tasks`)).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('API não respondeu em 30s')
}
async function api(method, path, body) {
  const res = await apiFetch(API + path, {
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

// Espera até `count` pedidos da API (fora as conexões desta bateria) estarem
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
const links = async (id) =>
  (await pool.query(
    `SELECT t.name FROM task_execution_tags l JOIN tags t ON t.id = l.tag_id
     WHERE l.task_execution_id = $1 ORDER BY t.name`,
    [id],
  )).rows.map((r) => r.name).join(',')
const exists = async (id) =>
  (await pool.query('SELECT 1 FROM tags WHERE id = $1', [id])).rowCount === 1

await waitForApi()
const hold = await pool.connect()
const holdPid = (await hold.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
const mine = [holdPid]
const completedAt = new Date().toISOString()
let taskId = null

try {
  const task = await must('POST', '/tasks', { title: `${P} tarefa` })
  taskId = task.id
  const root = await tag(`${P} raiz`)
  const otherRoot = await tag(`${P} outra`)
  const record = async (tagIds, rootTagId = root.id) =>
    (await must('POST', '/executions', {
      taskId, description: 'corrida', completedAt, rootTagId, tagIds,
    })).id
  const put = (id, tagIds, rootTagId = root.id) =>
    api('PUT', `/executions/${id}`, { description: 'corrida', completedAt, rootTagId, tagIds })

  // 1. O ciclo: o PUT soltou a ligação da tag usada e parou antes de religar;
  // o DELETE trava a tag e espera a ligação; ao religar, o PUT esperaria a tag.
  // A linha (registro, irmã) segura pela conexão própria para o PUT no INSERT
  {
    const irma = await tag(`${P} a irma`, root.id)
    const usada = await tag(`${P} b usada`, root.id)
    const id = await record([usada.id])
    await hold.query('BEGIN')
    await hold.query(
      `INSERT INTO task_execution_tags (task_execution_id, tag_id, tag_parent_id, root_tag_id)
       VALUES ($1, $2, $3, $3)`,
      [id, irma.id, root.id],
    )
    const gravar = put(id, [irma.id, usada.id])
    check('ciclo: PUT parado religando', await blocked(1, mine))
    const apagar = api('DELETE', `/tags/${usada.id}`)
    check('ciclo: DELETE também parado', await blocked(2, mine))
    await hold.query('ROLLBACK')
    const [p, d] = await Promise.all([gravar, apagar])
    check('ciclo: PUT grava', p.status === 200, detail(p))
    check('ciclo: DELETE responde 409 de tag em uso', d.status === 409 && /em uso/.test(d.body.error), detail(d))
    check('ciclo: a tag e as ligações ficam', (await exists(usada.id)) &&
      (await links(id)) === `${P} a irma,${P} b usada`, await links(id))
  }

  // 2. Tag livre, DELETE primeiro: o PUT chega com o apagar em andamento
  {
    const livre = await tag(`${P} livre 2`, root.id)
    const id = await record([])
    await hold.query('BEGIN')
    await hold.query('DELETE FROM tags WHERE id = $1', [livre.id])
    const gravar = put(id, [livre.id])
    check('apagar antes: PUT parado na tag', await blocked(1, mine))
    await hold.query('COMMIT')
    const p = await gravar
    check('apagar antes: PUT recebe 400 amigável', p.status === 400 && /não existe/.test(p.body.error), detail(p))
    check('apagar antes: registro sem ligação', (await links(id)) === '')
  }

  // 3. O apagar que esperava é desfeito: o PUT segue
  {
    const livre = await tag(`${P} livre 3`, root.id)
    const id = await record([])
    await hold.query('BEGIN')
    await hold.query('DELETE FROM tags WHERE id = $1', [livre.id])
    const gravar = put(id, [livre.id])
    check('apagar desfeito: PUT parado na tag', await blocked(1, mine))
    await hold.query('ROLLBACK')
    const p = await gravar
    check('apagar desfeito: PUT grava a tag', p.status === 200 && (await links(id)) === `${P} livre 3`, detail(p))
  }

  // 4. Tag livre, PUT primeiro: conferiu a tag e parou antes de religar; o
  // DELETE chega no meio. Sem proteção, a tag some e o PUT devolve 200 sem ela
  {
    const antiga = await tag(`${P} antiga`, root.id)
    const livre = await tag(`${P} livre 4`, root.id)
    const id = await record([antiga.id])
    await hold.query('BEGIN')
    await hold.query(
      'SELECT 1 FROM task_execution_tags WHERE task_execution_id = $1 FOR UPDATE',
      [id],
    )
    const gravar = put(id, [livre.id])
    check('PUT antes: PUT parado soltando as ligações', await blocked(1, mine))
    const apagar = api('DELETE', `/tags/${livre.id}`)
    const parado = await blocked(2, mine)
    const d0 = parado ? null : await apagar
    await hold.query('ROLLBACK')
    const [p, d] = await Promise.all([gravar, d0 ?? apagar])
    check('PUT antes: DELETE espera o PUT', parado, detail(d))
    check('PUT antes: PUT grava', p.status === 200, detail(p))
    check('PUT antes: a tag nova ficou no registro', (await links(id)) === `${P} livre 4`, await links(id) || 'sem ligação')
    check('PUT antes: DELETE responde 409', d.status === 409, detail(d))
  }

  // 5. A raiz livre, DELETE primeiro
  {
    const raiz = await tag(`${P} raiz livre`)
    const id = await record([], otherRoot.id)
    await hold.query('BEGIN')
    await hold.query('DELETE FROM tags WHERE id = $1', [raiz.id])
    const gravar = put(id, [], raiz.id)
    check('raiz: PUT parado na raiz', await blocked(1, mine))
    await hold.query('COMMIT')
    const p = await gravar
    check('raiz: PUT recebe 400 amigável', p.status === 400 && /não existe/.test(p.body.error), detail(p))
    const { rows } = await pool.query('SELECT root_tag_id FROM task_executions WHERE id = $1', [id])
    check('raiz: registro continua na raiz antiga', rows[0].root_tag_id === otherRoot.id)
  }

  // 6. Criar registro com o apagar em andamento (a mesma função grava as tags)
  {
    const livre = await tag(`${P} livre 6`, root.id)
    await hold.query('BEGIN')
    await hold.query('DELETE FROM tags WHERE id = $1', [livre.id])
    const criar = api('POST', '/executions', {
      taskId, description: 'corrida', completedAt, rootTagId: root.id, tagIds: [livre.id],
    })
    check('criar: POST parado na tag', await blocked(1, mine))
    await hold.query('COMMIT')
    const c = await criar
    check('criar: POST recebe 400 amigável', c.status === 400 && /não existe/.test(c.body.error), detail(c))
  }

  // 7. Dois registros na mesma tag não fazem fila um pelo outro
  {
    const comum = await tag(`${P} comum`, root.id)
    const parado = await record([comum.id])
    const outro = await record([comum.id])
    await hold.query('BEGIN')
    await hold.query(
      'SELECT 1 FROM task_execution_tags WHERE task_execution_id = $1 FOR UPDATE',
      [parado],
    )
    const gravar = put(parado, [comum.id])
    check('mesma tag: 1º PUT parado', await blocked(1, mine))
    const segundo = await Promise.race([
      put(outro, [comum.id]),
      new Promise((r) => setTimeout(() => r({ status: 'preso' }), 2000)),
    ])
    check('mesma tag: 2º PUT passa sem esperar', segundo.status === 200, detail(segundo))
    await hold.query('ROLLBACK')
    const p = await gravar
    check('mesma tag: 1º PUT grava', p.status === 200, detail(p))
  }

  // 8. Arquivar a raiz com um PUT no meio: fila, sem ciclo
  {
    const raiz = await tag(`${P} raiz arquivar`)
    const sub = await tag(`${P} sub arquivar`, raiz.id)
    const id = await record([sub.id], raiz.id)
    await hold.query('BEGIN')
    await hold.query(
      'SELECT 1 FROM task_execution_tags WHERE task_execution_id = $1 FOR UPDATE',
      [id],
    )
    const gravar = put(id, [sub.id], raiz.id)
    check('arquivar: PUT parado', await blocked(1, mine))
    const arquivar = api('PATCH', `/tags/${raiz.id}`, { active: false })
    check('arquivar: PATCH espera o PUT', await blocked(2, mine))
    await hold.query('ROLLBACK')
    const [p, a] = await Promise.all([gravar, arquivar])
    check('arquivar: os dois respondem 200', p.status === 200 && a.status === 200, `${detail(p)}; ${detail(a)}`)
  }

  // 9. Sem corrida, nada muda
  {
    const livre = await tag(`${P} livre 7`, root.id)
    const d = await api('DELETE', `/tags/${livre.id}`)
    check('sem corrida: apagar tag livre = 204', d.status === 204, detail(d))
    const usada = await tag(`${P} usada 7`, root.id)
    await record([usada.id])
    const e = await api('DELETE', `/tags/${usada.id}`)
    check('sem corrida: apagar tag usada = 409', e.status === 409, detail(e))
  }
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await hold.query('ROLLBACK').catch(() => {})
  hold.release()
  const roots = `SELECT id FROM tags WHERE parent_id IS NULL AND name LIKE '${P}%'`
  await pool.query(`DELETE FROM task_execution_tags WHERE task_execution_id IN
    (SELECT id FROM task_executions WHERE task_id IN (SELECT id FROM tasks WHERE title LIKE '${P}%'))`)
  await pool.query(`DELETE FROM task_executions WHERE task_id IN (SELECT id FROM tasks WHERE title LIKE '${P}%')`)
  await pool.query(`DELETE FROM tasks WHERE title LIKE '${P}%'`)
  await pool.query(`DELETE FROM tags WHERE level = 2 AND root_id IN (${roots})`)
  await pool.query(`DELETE FROM tags WHERE parent_id IS NULL AND name LIKE '${P}%'`)
  const left = await pool.query(
    `SELECT (SELECT count(*) FROM tags WHERE name LIKE '${P}%')::int +
            (SELECT count(*) FROM tasks WHERE title LIKE '${P}%')::int AS n`)
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
