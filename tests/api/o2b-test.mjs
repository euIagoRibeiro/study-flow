// Bateria do O2b (workId e linkUrl nos registros). Uso (raiz do repo):
//   node --env-file=backend/.env <este arquivo>
// Contrato (ausente mantém, null limpa), o servidor não preenche o caminho, e os
// dois campos em TODA resposta de registro: POST fechado, POST aberto, PUT de
// edição, finalizar, reabrir, PUT do treino e a lista. Não existe GET de um
// registro: a lista é a única leitura. Prefixo teste-o2b; apaga tudo no finally.
import pg from 'pg'
import { API } from '../config.mjs'
import { deleteExecutions } from '../limpeza.mjs'
const { Pool } = pg
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
// Obras antes da bateria: a limpeza confere a diferença, não depende do que o seed tem
const worksBefore = (await pool.query('SELECT count(*)::int AS n FROM works')).rows[0].n
const P = 'teste-o2b'
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
const detail = (r) => `status ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`
const must = async (...args) => {
  const r = await api(...args)
  if (r.status >= 300) throw new Error(`${args[1]}: ${detail(r)}`)
  return r.body
}
const GHOST = '00000000-0000-4000-8000-00000000abcd'
const LINK = 'https://youtu.be/53UGUF39CKM?is=BZ0Y'
const now = () => new Date().toISOString()
let task = null
const tags = []
const fromList = async (id) => (await must('GET', '/executions')).find((e) => e.id === id)

try {
  const R = await must('POST', '/tags', { name: `${P} raiz` })
  const S = await must('POST', '/tags', { name: `${P} sub`, parentId: R.id })
  const Other = await must('POST', '/tags', { name: `${P} outra` })
  const Train = await must('POST', '/tags', { name: `${P} treino` })
  tags.push(S.id, R.id, Other.id, Train.id)
  await must('PATCH', `/tags/${Train.id}`, { tracksWorkout: true })
  task = await must('POST', '/tasks', { title: `${P} tarefa` })
  const work = await must('POST', '/works', { title: `${P} obra`, defaultTagId: S.id, defaultTaskId: task.id })
  const done = await must('POST', '/works', { title: `${P} concluida`, defaultTagId: S.id, defaultTaskId: task.id, status: 'concluido' })
  const base = { taskId: task.id, description: 'o2b', completedAt: now() }
  const same = (e, w, l) => e.workId === w && e.linkUrl === l

  // Toda resposta de registro traz os dois campos
  let r = await api('POST', '/executions', { ...base, workId: work.id, linkUrl: LINK })
  const id = r.body?.id
  check('POST fechado devolve os dois', r.status === 201 && same(r.body, work.id, LINK), detail(r))
  check('lista devolve os dois', same(await fromList(id), work.id, LINK), JSON.stringify(await fromList(id)))
  r = await api('PUT', `/executions/${id}`, { description: 'editado', completedAt: now() })
  check('PUT de edição devolve os dois e mantém', r.status === 200 && same(r.body, work.id, LINK), detail(r))
  r = await api('POST', '/executions', { taskId: task.id, description: null, completedAt: null, workId: work.id, linkUrl: LINK, rootTagId: Train.id })
  const open = r.body?.id
  check('POST aberto devolve os dois', r.status === 201 && same(r.body, work.id, LINK), detail(r))
  const [exercise] = await must('GET', '/exercises')
  r = await api('PUT', `/executions/${open}/workout`, { workout: [{ exerciseId: exercise.id, sets: [{ reps: 8, weightKg: null }] }] })
  check('PUT do treino devolve os dois', r.status === 200 && same(r.body, work.id, LINK), detail(r))
  r = await api('PUT', `/executions/${open}`, { description: 'fim', completedAt: now() })
  check('finalizar devolve os dois', r.status === 200 && r.body.completedAt && same(r.body, work.id, LINK), detail(r))
  r = await api('PUT', `/executions/${open}`, { description: null, completedAt: null })
  check('reabrir devolve os dois', r.status === 200 && r.body.completedAt === null && same(r.body, work.id, LINK), detail(r))
  r = await api('PUT', `/executions/${open}`, { description: 'fim', completedAt: now(), workout: [] })
  check('finalizar de novo mantém', r.status === 200 && same(r.body, work.id, LINK), detail(r))
  r = await api('GET', `/executions/${id}`)
  check('não existe GET de um registro', r.status === 404, detail(r))
  const seedRecord = (await must('GET', '/executions')).find((e) => e.id.startsWith('5eed'))
  check('registro antigo vem com null nos dois', seedRecord.workId === null && seedRecord.linkUrl === null, JSON.stringify(seedRecord).slice(0, 120))

  // O servidor não preenche o caminho
  r = await api('POST', '/executions', { ...base, workId: work.id })
  check('POST com obra e sem caminho: sem caminho', r.status === 201 && r.body.rootTagId === null && r.body.tagIds.length === 0, detail(r))
  const plain = r.body.id
  r = await api('PUT', `/executions/${plain}`, { ...base, workId: done.id })
  check('PUT trocando a obra: caminho não muda', r.status === 200 && r.body.rootTagId === null && r.body.workId === done.id, detail(r))
  r = await api('PUT', `/executions/${plain}`, { ...base, rootTagId: Other.id })
  check('caminho fora do padrão da obra: a obra fica', r.status === 200 && r.body.workId === done.id && r.body.rootTagId === Other.id, detail(r))
  r = await api('POST', '/executions', { ...base, workId: done.id })
  check('obra de qualquer status é aceita', r.status === 201 && r.body.workId === done.id, detail(r))

  // Ausente mantém, null limpa
  r = await api('PUT', `/executions/${id}`, { description: 'x', completedAt: now(), workId: null })
  check('workId null limpa e mantém o link', r.status === 200 && same(r.body, null, LINK), detail(r))
  r = await api('PUT', `/executions/${id}`, { description: 'x', completedAt: now(), linkUrl: null })
  check('linkUrl null limpa', r.status === 200 && same(r.body, null, null), detail(r))
  r = await api('PUT', `/executions/${id}`, { description: 'x', completedAt: now(), linkUrl: 'HTTP://Exemplo.com/A' })
  check('esquema em minúsculas, o resto intacto', r.status === 200 && r.body.linkUrl === 'http://Exemplo.com/A', detail(r))
  r = await api('PUT', `/executions/${id}`, { description: 'x', completedAt: now(), linkUrl: '   ' })
  check('link vazio limpa', r.status === 200 && r.body.linkUrl === null, detail(r))
  r = await api('POST', '/executions', { ...base })
  check('POST sem os campos: null', r.status === 201 && same(r.body, null, null), detail(r))
  r = await api('POST', '/executions', { ...base, linkUrl: '' })
  check('POST com link vazio: null', r.status === 201 && r.body.linkUrl === null, detail(r))

  // Recusas
  for (const [name, linkUrl] of [['javascript:', 'javascript:alert(1)'], ['ftp', 'ftp://a.b'], ['com espaço', 'http://a b'], ['http:// sozinho', 'http://'], ['2001 caracteres', `http://${'x'.repeat(1994)}`]]) {
    r = await api('POST', '/executions', { ...base, linkUrl })
    check(`link ${name}: 400`, r.status === 400, detail(r))
  }
  r = await api('POST', '/executions', { ...base, workId: 'abc' })
  check('workId inválido: 400', r.status === 400, detail(r))
  r = await api('POST', '/executions', { ...base, workId: GHOST })
  check('POST com obra inexistente: 400', r.status === 400 && /Obra/.test(r.body.error), detail(r))
  r = await api('PUT', `/executions/${id}`, { description: 'x', completedAt: now(), workId: GHOST })
  check('PUT com obra inexistente: 400', r.status === 400 && /Obra/.test(r.body.error), detail(r))
  check('recusado não gravou nada', (await fromList(id)).workId === null, JSON.stringify(await fromList(id)).slice(0, 100))
  r = await api('DELETE', `/works/${work.id}`)
  check('apagar obra com registro: 409', r.status === 409, detail(r))
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  if (task) {
    const ids = (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [task.id])).rows.map((row) => row.id)
    await deleteExecutions(pool, ids)
  }
  await pool.query(`DELETE FROM works WHERE title LIKE '${P}%'`)
  if (task) await pool.query('DELETE FROM tasks WHERE id = $1', [task.id])
  for (const id of tags) await pool.query('DELETE FROM tags WHERE id = $1', [id])
  const left = await pool.query(
    `SELECT abs((SELECT count(*) FROM works)::int - $1) + (SELECT count(*) FROM tags WHERE name LIKE '${P}%')::int +
            (SELECT count(*) FROM tasks WHERE title LIKE '${P}%')::int AS n`, [worksBefore])
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
