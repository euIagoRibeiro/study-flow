// Bateria do P2 (API da fase de trabalho).
// Uso (da raiz do repo): node --env-file=backend/.env <este arquivo>
// Cria o próprio contexto com fases, um sem fases, uma subtag e uma tarefa;
// apaga tudo no finally (via pg, porque execução não tem rota de apagar).
import { join } from 'node:path'

import pg from 'pg'
import { API } from '../config.mjs'
const { Pool } = pg

const PREFIX = 'teste-p2'
const results = []
function check(name, ok, detail = '') {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? ` (${detail})` : ''}`)
}

// O backend em dev reinicia sozinho às vezes: esperar antes de cada pedido
async function waitForApi() {
  for (let i = 0; i < 30; i++) {
    try {
      if ((await fetch(API + '/tasks')).ok) return
    } catch {}
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

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const ids = { tags: [], task: null }
try {
  // Preparação (pela API, como a tela faria)
  const code = (await api('POST', '/tags', { name: `${PREFIX} code` })).body
  const estudo = (await api('POST', '/tags', { name: `${PREFIX} estudo` })).body
  const solo = (await api('POST', '/tags', { name: `${PREFIX} solo` })).body
  const sub = (await api('POST', '/tags', { name: 'projeto', parentId: code.id })).body
  ids.tags.push(sub.id, code.id, estudo.id, solo.id)
  const task = (await api('POST', '/tasks', { title: `${PREFIX} tarefa` })).body
  ids.task = task.id
  if (!code.id || !estudo.id || !solo.id || !sub.id || !task.id) {
    throw new Error('preparação falhou')
  }

  // --- Tags
  const tags = await api('GET', '/tags')
  check('GET /tags traz tracksPhase booleano em todas',
    tags.status === 200 && tags.body.every((t) => typeof t.tracksPhase === 'boolean'))

  let r = await api('PATCH', `/tags/${sub.id}`, { tracksPhase: true })
  // Pela regra de contexto, não por outro motivo (ex.: campo desconhecido)
  check('ligar fases numa subtag: 400 pela regra de contexto',
    r.status === 400 && /contexto/i.test(r.body?.error ?? ''), detail(r))

  r = await api('PATCH', `/tags/${code.id}`, { tracksPhase: true })
  check('ligar fases num contexto: 200', r.status === 200 && r.body.tracksPhase === true, detail(r))
  await api('PATCH', `/tags/${solo.id}`, { tracksPhase: true })

  r = await api('POST', '/tags', { name: `${PREFIX} via post`, tracksPhase: true })
  if (r.body?.id) ids.tags.push(r.body.id)
  check('POST não liga fases (campo ignorado ou recusado)',
    r.status === 400 || (r.status === 201 && r.body.tracksPhase === false), detail(r))

  // --- Registrar
  const completedAt = new Date().toISOString()
  const base = { taskId: task.id, completedAt }

  r = await api('POST', '/executions', { ...base, rootTagId: code.id, tagIds: [sub.id], phase: 'prototipo' })
  const execId = r.body?.id
  check('registrar com fase num contexto com fases: 201',
    r.status === 201 && r.body.phase === 'prototipo' && r.body.rootTagId === code.id, detail(r))

  r = await api('POST', '/executions', { ...base, rootTagId: estudo.id, tagIds: [], phase: 'prototipo' })
  check('registrar com fase num contexto sem fases: 400', r.status === 400, detail(r))

  r = await api('POST', '/executions', { ...base, phase: 'prototipo' })
  check('registrar com fase sem tag: 400', r.status === 400, detail(r))

  r = await api('POST', '/executions', { ...base, rootTagId: code.id, tagIds: [], phase: 'concluido' })
  check('fase fora do enum: 400', r.status === 400, detail(r))

  r = await api('POST', '/executions', { ...base, rootTagId: estudo.id, tagIds: [] })
  check('registrar sem fase continua funcionando: 201', r.status === 201 && r.body.phase === null, detail(r))

  // --- Editar
  const put = (body) => api('PUT', `/executions/${execId}`, { description: 'editada', completedAt, ...body })

  r = await put({})
  check('PUT sem phase mantém a fase', r.status === 200 && r.body.phase === 'prototipo' &&
    r.body.description === 'editada', detail(r))

  r = await put({ phase: 'validacao' })
  check('PUT só com phase troca a fase e mantém as tags', r.status === 200 &&
    r.body.phase === 'validacao' && r.body.rootTagId === code.id && r.body.tagIds.includes(sub.id), detail(r))

  r = await put({ phase: null })
  check('PUT phase null limpa', r.status === 200 && r.body.phase === null, detail(r))

  await put({ phase: 'requisitos' })
  r = await put({ rootTagId: estudo.id, tagIds: [] })
  check('trocar pra contexto sem fases sem mandar phase: 200 e fase limpa',
    r.status === 200 && r.body.rootTagId === estudo.id && r.body.phase === null, detail(r))

  r = await put({ rootTagId: code.id, tagIds: [sub.id], phase: 'implementacao' })
  check('trocar de volta mandando a fase: 200', r.status === 200 &&
    r.body.phase === 'implementacao' && r.body.rootTagId === code.id, detail(r))

  r = await put({ rootTagId: estudo.id, tagIds: [], phase: 'prototipo' })
  check('trocar pra contexto sem fases mandando fase: 400', r.status === 400, detail(r))
  const after = (await api('GET', '/executions')).body.find((e) => e.id === execId)
  check('a recusa não mudou nada (transação desfeita)',
    after?.phase === 'implementacao' && after?.rootTagId === code.id && after?.description === 'editada')

  r = await put({ rootTagId: null, tagIds: [] })
  check('tirar todas as tags sem mandar phase: 200 e fase limpa',
    r.status === 200 && r.body.rootTagId === null && r.body.phase === null, detail(r))
  await put({ rootTagId: code.id, tagIds: [sub.id], phase: 'implementacao' })

  // --- Recusas do lado das tags
  r = await api('PATCH', `/tags/${code.id}`, { tracksPhase: false })
  check('desligar fases de contexto usado com fase: 409', r.status === 409, detail(r))

  r = await api('POST', '/executions', { ...base, rootTagId: solo.id, tagIds: [], phase: 'requisitos' })
  check('registrar com fase em contexto sem subtags: 201', r.status === 201, detail(r))
  r = await api('DELETE', `/tags/${solo.id}`)
  check('apagar contexto usado com fase: 409 (não 500)', r.status === 409, detail(r))
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  if (ids.task) {
    await pool.query(
      `DELETE FROM task_execution_tags WHERE task_execution_id IN
         (SELECT id FROM task_executions WHERE task_id = $1)`, [ids.task])
    await pool.query('DELETE FROM task_executions WHERE task_id = $1', [ids.task])
    await pool.query('DELETE FROM tasks WHERE id = $1', [ids.task])
  }
  for (const id of ids.tags) await pool.query('DELETE FROM tags WHERE id = $1', [id])
  const left = await pool.query(
    `SELECT (SELECT count(*) FROM tags WHERE name LIKE '${PREFIX}%')::int +
            (SELECT count(*) FROM tasks WHERE title LIKE '${PREFIX}%')::int AS n`)
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
