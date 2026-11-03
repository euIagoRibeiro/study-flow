// Bateria do O2c (progresso derivado e measureCurrent). Uso (raiz do repo):
//   node --env-file=backend/.env <este arquivo>
// Conta à mão em registros próprios (prefixo teste-o2c): tipos mistos, registro
// aberto, registro sem valor, outra medida, várias sessões e sessão rodando.
// Pausa a sessão rodando do seed e devolve no fim; apaga tudo no finally.
import pg from 'pg'
import { API } from '../config.mjs'
import { deleteExecutions, pauseRunning, resumeRunning } from '../limpeza.mjs'
const { Pool } = pg
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
// Obras antes da bateria: a limpeza confere a diferença, não depende do que o seed tem
const worksBefore = (await pool.query('SELECT count(*)::int AS n FROM works')).rows[0].n
const P = 'teste-o2c'
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
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const must = async (...args) => {
  const r = await api(...args)
  if (r.status >= 300) throw new Error(`${args[1]}: ${r.status} ${JSON.stringify(r.body)}`)
  return r.body
}
const tag = (name, parentId = null) => must('POST', '/tags', { name, parentId })
const now = () => new Date().toISOString()
const seen = async (id) => (await must('GET', '/works')).find((w) => w.id === id)
const show = (w) => JSON.stringify({ records: w?.records, seconds: w?.seconds, progress: w?.progress, measureCurrent: w?.measureCurrent })
const session = (id, started, minutes) => pool.query(
  'INSERT INTO time_entries (task_execution_id, started_at, ended_at) VALUES ($1, $2, $3)',
  [id, new Date(started).toISOString(), new Date(started + minutes * 60000).toISOString()])

const paused = await pauseRunning(pool)
let taskId = null
const tagIds = []

try {
  const R = await tag(`${P} raiz`)
  const S = await tag(`${P} sub`, R.id)
  const Z = await tag(`${P} outra`)
  const Free = await tag(`${P} sem medida`)
  tagIds.push(S.id, R.id, Z.id, Free.id)
  taskId = (await must('POST', '/tasks', { title: `${P} tarefa` })).id
  const mR = await must('POST', '/measures', { tagId: R.id, name: 'itens', singular: 'item', allowsDecimal: true, kinds: ['a', 'b'] })
  const mZ = await must('POST', '/measures', { tagId: Z.id, name: 'outros', singular: 'outro', allowsDecimal: false, kinds: [] })
  const kind = Object.fromEntries(mR.kinds.map((k) => [k.name, k.id]))

  const w = await must('POST', '/works', { title: `${P} completa`, defaultTagId: R.id, defaultTaskId: taskId, measureId: mR.id, total: 113 })
  check('POST devolve os campos derivados', w.records === 0 && w.seconds === 0 && w.progress === 0 && w.measureCurrent === true, show(w))

  // Obra com medida e zero registros: 0, não null
  check('medida e zero registros: progress 0, não null', (await seen(w.id)).progress === 0, show(await seen(w.id)))
  const empty = await must('POST', '/works', { title: `${P} sem medida`, defaultTagId: Free.id, defaultTaskId: taskId })
  check('sem medida: progress null', (await seen(empty.id)).progress === null, show(await seen(empty.id)))
  check('sem medida num caminho sem medida: measureCurrent verdadeiro', (await seen(empty.id)).measureCurrent === true, show(await seen(empty.id)))

  const record = (body) => must('POST', '/executions', { taskId, description: 'o2c', completedAt: now(), workId: w.id, rootTagId: R.id, tagIds: [], ...body })
  // Fechado, tipos mistos, duas sessões: 3 + 2,5 uma vez só, 30 min
  const a = await record({ measureValues: [{ kindId: kind.a, quantity: 3 }, { kindId: kind.b, quantity: 2.5 }] })
  const t0 = Date.now() - 86400000
  await session(a.id, t0, 10)
  await session(a.id, t0 + 3600000, 20)
  // Aberto, com valor: 4, conta
  const open = await must('POST', '/executions', { taskId, description: 'o2c', completedAt: null, workId: w.id, rootTagId: R.id, tagIds: [] })
  await must('PUT', `/executions/${open.id}`, { description: 'o2c', completedAt: null, measureValues: [{ kindId: kind.a, quantity: 4 }] })
  // Fechado, sem valor: conta como registro, não soma
  await record({})
  // Em outro caminho, com outra medida: conta como registro, o valor não soma
  await record({ rootTagId: Z.id, measureValues: [{ kindId: null, quantity: 7 }] })
  // De outra obra: não entra em nada
  const other = await must('POST', '/works', { title: `${P} vizinha`, defaultTagId: R.id, defaultTaskId: taskId, measureId: mR.id })
  await record({ workId: other.id, measureValues: [{ kindId: kind.a, quantity: 100 }] })

  let got = await seen(w.id)
  check('progress soma os tipos, aberto incluso, uma vez só (3 + 2,5 + 4)', got.progress === 9.5, show(got))
  check('progress fora da outra medida e da outra obra', (await seen(other.id)).progress === 100, show(await seen(other.id)))
  check('records conta abertos, sem valor e fora do caminho', got.records === 4, show(got))
  check('seconds soma as sessões (30 min)', got.seconds === 1800, show(got))

  // Sessão rodando conta até agora
  await pool.query('INSERT INTO time_entries (task_execution_id, started_at) VALUES ($1, $2)', [open.id, new Date(Date.now() - 120000).toISOString()])
  got = await seen(w.id)
  check('sessão rodando conta até agora (30 + 2 min)', got.seconds >= 1918 && got.seconds <= 1930, show(got))
  await pool.query('DELETE FROM time_entries WHERE task_execution_id = $1 AND ended_at IS NULL', [open.id])

  // Tempo em obra sem medida
  const plain = await must('POST', '/executions', { taskId, description: 'o2c', completedAt: now(), workId: empty.id })
  await session(plain.id, t0, 45)
  got = await seen(empty.id)
  check('sem medida: registros e tempo', got.records === 1 && got.seconds === 2700 && got.progress === null, show(got))

  // measureCurrent acompanha a árvore
  const child = await must('POST', '/works', { title: `${P} herdada`, defaultTagId: S.id, defaultTaskId: taskId, measureId: mR.id })
  check('medida herdada: measureCurrent verdadeiro', child.measureCurrent === true, show(child))
  // Obras que vão ficar com a medida antiga (criadas antes da subtag ganhar a dela)
  const Zs = await tag(`${P} outra sub`, Z.id)
  tagIds.unshift(Zs.id)
  const old = await must('POST', '/works', { title: `${P} antiga`, defaultTagId: S.id, defaultTaskId: taskId, measureId: mR.id, total: 50 })
  const oldInt = await must('POST', '/works', { title: `${P} antiga inteira`, defaultTagId: Zs.id, defaultTaskId: taskId, measureId: mZ.id, total: 5 })
  const oldH = await must('POST', '/works', { title: `${P} antiga h`, defaultTagId: S.id, defaultTaskId: taskId, measureId: mR.id, total: 7 })
  const mS = await must('POST', '/measures', { tagId: S.id, name: 'nova', singular: 'nova', allowsDecimal: false, kinds: [] })
  await must('POST', '/measures', { tagId: Zs.id, name: 'outra nova', singular: 'outra nova', allowsDecimal: false, kinds: [] })
  check('subtag ganhou medida própria: measureCurrent falso', (await seen(child.id)).measureCurrent === false, show(await seen(child.id)))

  // Medida antiga: título, status, tarefa e link não exigem a medida atual; o
  // total é conferido contra a medida gravada; measureId ou defaultTagId no
  // pedido (mesmo o mesmo valor) pedem a conferência completa
  const keeps = (w, measureId, total) => w.measureId === measureId && w.total === total && w.measureCurrent === false
  const same = async (w) => JSON.stringify(await seen(w.id))
  let r = await api('PATCH', `/works/${old.id}`, { status: 'pausado' })
  check('a) medida antiga, PATCH só com status: 200, medida e total iguais', r.status === 200 && r.body.status === 'pausado' && keeps(r.body, mR.id, 50), `${r.status} ${JSON.stringify(r.body)}`)
  r = await api('PATCH', `/works/${old.id}`, { title: `${P} antiga renomeada` })
  check('b) medida antiga, PATCH só com título: 200, medida mantida', r.status === 200 && keeps(r.body, mR.id, 50), `${r.status} ${JSON.stringify(r.body)}`)
  r = await api('PATCH', `/works/${old.id}`, { total: 60 })
  check('c) medida antiga, PATCH só com total: 200 contra a medida gravada', r.status === 200 && keeps(r.body, mR.id, 60), `${r.status} ${JSON.stringify(r.body)}`)
  let before = await same(oldInt)
  r = await api('PATCH', `/works/${oldInt.id}`, { total: 5.5 })
  check('d) medida antiga inteira, total 5,5: recusado e nada muda', r.status === 400 && (await same(oldInt)) === before, `${r.status} ${JSON.stringify(r.body)}`)
  r = await api('PATCH', `/works/${oldInt.id}`, { total: 6 })
  check('d) medida antiga inteira, total 6: 200', r.status === 200 && keeps(r.body, mZ.id, 6), `${r.status} ${JSON.stringify(r.body)}`)
  before = await same(old)
  r = await api('PATCH', `/works/${old.id}`, { measureId: mR.id })
  check('e) reenviar a medida antiga (não é a mais próxima): 400 e nada muda', r.status === 400 && /mais próxima/.test(r.body?.error ?? '') && (await same(old)) === before, `${r.status} ${JSON.stringify(r.body)}`)
  r = await api('PATCH', `/works/${old.id}`, { defaultTagId: S.id })
  check('f) reenviar o mesmo caminho revalida: 400 e nada muda', r.status === 400 && /mais próxima/.test(r.body?.error ?? '') && (await same(old)) === before, `${r.status} ${JSON.stringify(r.body)}`)
  before = await same(oldH)
  r = await api('PATCH', `/works/${oldH.id}`, { measureId: null })
  check('h) tirar só a medida com total gravado: 400 "total precisa de uma medida" e nada muda', r.status === 400 && /total precisa de uma medida/.test(r.body?.error ?? '') && (await same(oldH)) === before, `${r.status} ${JSON.stringify(r.body)}`)
  r = await api('PATCH', `/works/${oldH.id}`, { measureId: null, total: null })
  check('h) tirar medida e total juntos: 200 e limpa os dois', r.status === 200 && r.body.measureId === null && r.body.total === null, `${r.status} ${JSON.stringify(r.body)}`)
  before = await same(empty)
  r = await api('PATCH', `/works/${empty.id}`, { total: 5 })
  check('i) total sozinho numa obra sem medida: 400 "total precisa de uma medida" e nada muda', r.status === 400 && /total precisa de uma medida/.test(r.body?.error ?? '') && (await same(empty)) === before, `${r.status} ${JSON.stringify(r.body)}`)
  await must('PATCH', `/measures/${mS.id}`, { active: false })
  check('medida nova arquivada continua sendo a mais próxima', (await seen(child.id)).measureCurrent === false, show(await seen(child.id)))
  await must('DELETE', `/measures/${mS.id}`)
  check('medida nova apagada: volta a verdadeiro', (await seen(child.id)).measureCurrent === true, show(await seen(child.id)))
  // Obra sem medida num caminho que ganhou uma
  const mFree = await must('POST', '/measures', { tagId: Free.id, name: 'ganhou', singular: 'ganhou', allowsDecimal: false, kinds: [] })
  check('sem medida num caminho que ganhou uma: measureCurrent falso', (await seen(empty.id)).measureCurrent === false, show(await seen(empty.id)))
  const patched = await must('PATCH', `/works/${empty.id}`, { measureId: mFree.id })
  check('PATCH devolve os campos derivados', patched.measureCurrent === true && patched.progress === 0 && patched.records === 1 && patched.seconds === 2700, show(patched))
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  if (taskId) {
    const ids = (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [taskId])).rows.map((r) => r.id)
    await deleteExecutions(pool, ids)
  }
  await pool.query(`DELETE FROM works WHERE title LIKE '${P}%'`)
  if (taskId) await pool.query('DELETE FROM tasks WHERE id = $1', [taskId])
  await pool.query('DELETE FROM measure_kinds WHERE measure_id IN (SELECT id FROM measures WHERE tag_id = ANY($1::uuid[]))', [tagIds])
  await pool.query('DELETE FROM measures WHERE tag_id = ANY($1::uuid[])', [tagIds])
  for (const id of tagIds) await pool.query('DELETE FROM tags WHERE id = $1', [id])
  await resumeRunning(pool, paused)
  const left = await pool.query(
    `SELECT abs((SELECT count(*) FROM works)::int - $1) + (SELECT count(*) FROM tags WHERE name LIKE '${P}%')::int +
            (SELECT count(*) FROM tasks WHERE title LIKE '${P}%')::int AS n`, [worksBefore])
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
