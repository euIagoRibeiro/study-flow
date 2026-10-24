// Bateria da M2 (API das medidas). Uso (raiz do repo):
//   node --env-file=backend/.env <este arquivo>
// Cria a própria árvore (prefixo teste-m2), medidas e tarefa; apaga tudo
// no finally (pg), esperando a API antes de cada pedido.
import { join } from 'node:path'

import pg from 'pg'
import { API } from '../config.mjs'
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-m2'
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
const tag = async (name, parentId = null) => (await api('POST', '/tags', { name, parentId })).body

let taskId = null
try {
  // Árvore: V › VM › VMA, V › VF; C › CP; S (sem medida); X (vai ser arquivada)
  const V = await tag(`${P} vest`)
  const VM = await tag('mat', V.id)
  const VMA = await tag('alg', VM.id)
  const VF = await tag('fis', V.id)
  const C = await tag(`${P} code`)
  const CP = await tag('proj', C.id)
  const S = await tag(`${P} sem`)
  const X = await tag(`${P} arq`)
  const D = await tag(`${P} del`)
  await api('PATCH', `/tags/${X.id}`, { active: false })
  taskId = (await api('POST', '/tasks', { title: `${P} tarefa` })).body.id

  // --- Cadastro
  let r = await api('POST', '/measures', { tagId: V.id, name: 'questões', singular: 'questão', allowsDecimal: false, kinds: [] })
  const mV = r.body
  check('declarar medida sem tipos (Vestibular: questões)', r.status === 201 && mV?.tagId === V.id && mV.kinds?.length === 0, detail(r))
  r = await api('POST', '/measures', { tagId: VM.id, name: 'exercícios', singular: 'exercício', allowsDecimal: false, kinds: [] })
  const mVM = r.body
  check('subtag substitui (Matemática: exercícios)', r.status === 201, detail(r))
  r = await api('POST', '/measures', { tagId: C.id, name: 'exercícios', singular: 'exercício', allowsDecimal: false, kinds: ['refatoração', 'leitura', 'questões'] })
  const mC = r.body
  check('medida com 3 tipos num POST só', r.status === 201 && mC?.kinds?.length === 3, detail(r))
  const kind = (name) => mC.kinds.find((k) => k.name === name)
  r = await api('POST', '/measures', { tagId: V.id, name: 'outra', singular: 'outra', kinds: [] })
  check('segunda medida na mesma tag: 409', r.status === 409, detail(r))
  r = await api('POST', '/measures', { tagId: X.id, name: 'x', singular: 'x', kinds: [] })
  check('tag arquivada não recebe medida: 400', r.status === 400, detail(r))
  r = await api('POST', '/measures', { tagId: S.id, name: 'a', singular: 'a', kinds: ['leitura', ' Leitura '] })
  check('tipos repetidos no POST: 409, nada criado', r.status === 409 &&
    !(await api('GET', '/measures')).body.some((m) => m.tagId === S.id), detail(r))
  r = await api('POST', '/measures', { tagId: S.id, name: '  ', singular: 'a', kinds: [] })
  check('nome em branco: 400', r.status === 400, detail(r))
  r = await api('POST', `/measures/${mC.id}/kinds`, { name: 'LEITURA' })
  check('tipo novo repetido: 409', r.status === 409, detail(r))
  r = await api('POST', `/measures/${mC.id}/kinds`, { name: 'escrita' })
  check('tipo novo: 201', r.status === 201 && r.body?.name === 'escrita', detail(r))
  r = await api('PATCH', `/measures/${mV.id}`, { name: 'questões de prova' })
  check('renomear medida', r.status === 200 && r.body.name === 'questões de prova', detail(r))
  r = await api('GET', '/measures')
  check('GET /measures traz tipos', r.status === 200 && r.body.find((m) => m.id === mC.id)?.kinds.length === 4)
  const mD = (await api('POST', '/measures', { tagId: D.id, name: 'linhas', singular: 'linha', kinds: ['a', 'b'] })).body
  r = await api('DELETE', `/measures/${mD.id}`)
  check('apagar medida nunca usada (com os tipos): 204', r.status === 204 &&
    !(await api('GET', '/measures')).body.some((m) => m.id === mD.id), detail(r))
  await api('POST', '/measures', { tagId: D.id, name: 'linhas', singular: 'linha', kinds: [] })
  r = await api('DELETE', `/tags/${D.id}`)
  check('apagar tag que declara medida: 409 (não 500)', r.status === 409, detail(r))

  // --- Registros
  const completedAt = new Date().toISOString()
  const post = (rootTagId, leaf, measureValues) => api('POST', '/executions', {
    taskId, description: 'm2', completedAt, rootTagId, tagIds: leaf ? [leaf] : [], measureValues,
  })
  r = await post(C.id, null, [{ kindId: kind('refatoração').id, quantity: 3 }, { kindId: kind('leitura').id, quantity: 2 }])
  const e1 = r.body
  check('raiz com tipos misturados: 3 refatoração + 2 leitura', r.status === 201 && e1.measure?.measureId === mC.id &&
    e1.measure.values.length === 2 && e1.measure.values.every((v) => typeof v.quantity === 'number'), detail(r))
  r = await post(C.id, CP.id, [{ kindId: kind('questões').id, quantity: 1 }])
  check('subtag sem medida herda a da raiz', r.status === 201 && r.body.measure?.measureId === mC.id, detail(r))
  r = await post(V.id, VMA.id, [{ kindId: null, quantity: 4 }])
  const e3 = r.body
  check('mais próxima: Álgebra usa a de Matemática, não a de Vestibular', r.status === 201 && e3.measure?.measureId === mVM.id, detail(r))
  r = await post(V.id, VF.id, [{ kindId: null, quantity: 2 }])
  const e4 = r.body
  check('Física herda a de Vestibular', r.status === 201 && e4.measure?.measureId === mV.id, detail(r))
  r = await post(S.id, null, [{ kindId: null, quantity: 1 }])
  check('caminho sem medida: 400', r.status === 400, detail(r))
  r = await post(null, null, [{ kindId: null, quantity: 1 }])
  check('registro sem tag com medida: 400', r.status === 400, detail(r))
  r = await post(C.id, null, [{ kindId: null, quantity: 1 }])
  check('medida com tipos sem tipo: 400', r.status === 400, detail(r))
  r = await post(C.id, null, [{ kindId: '00000000-0000-4000-8000-000000000000', quantity: 1 }])
  check('tipo que não é da medida: 400', r.status === 400, detail(r))
  r = await post(C.id, null, [{ kindId: kind('leitura').id, quantity: 1 }, { kindId: kind('leitura').id, quantity: 2 }])
  check('mesmo tipo duas vezes: 400', r.status === 400, detail(r))
  r = await post(V.id, VMA.id, [{ kindId: null, quantity: 1 }, { kindId: null, quantity: 2 }])
  check('medida sem tipos com dois valores: 400', r.status === 400, detail(r))
  r = await post(V.id, VMA.id, [{ kindId: null, quantity: 2.5 }])
  check('decimal em medida inteira: 400', r.status === 400, detail(r))
  r = await post(V.id, VMA.id, [{ kindId: null, quantity: 0 }])
  check('quantidade zero: 400', r.status === 400, detail(r))
  r = await api('PATCH', `/measures/${mVM.id}`, { allowsDecimal: true })
  check('ligar decimal', r.status === 200 && r.body.allowsDecimal === true, detail(r))
  r = await post(V.id, VMA.id, [{ kindId: null, quantity: 2.5 }])
  const eDec = r.body
  check('decimal aceito depois de ligar', r.status === 201 && eDec.measure?.values[0].quantity === 2.5, detail(r))
  r = await post(V.id, VMA.id, [{ kindId: null, quantity: 2.555 }])
  check('3 casas: 400', r.status === 400, detail(r))
  r = await api('PATCH', `/measures/${mVM.id}`, { allowsDecimal: false })
  check('desligar decimal com valor decimal gravado: 409', r.status === 409, detail(r))

  // Tipo arquivado: novo não, mantido sim
  await api('PATCH', `/measure-kinds/${kind('leitura').id}`, { active: false })
  r = await post(C.id, null, [{ kindId: kind('leitura').id, quantity: 1 }])
  check('tipo arquivado em registro novo: 400', r.status === 400, detail(r))
  const put = (e, body) => api('PUT', `/executions/${e.id}`, { description: 'm2', completedAt, ...body })
  r = await put(e1, { measureValues: [{ kindId: kind('refatoração').id, quantity: 5 }, { kindId: kind('leitura').id, quantity: 2 }] })
  check('tipo arquivado mantido no registro que já tinha', r.status === 200 && r.body.measure.values.length === 2, detail(r))

  // Medida arquivada: sem volta ao ancestral
  await api('PATCH', `/measures/${mVM.id}`, { active: false })
  r = await post(V.id, VMA.id, [{ kindId: null, quantity: 1 }])
  check('medida mais próxima arquivada: 400 (não volta pra Vestibular)', r.status === 400, detail(r))
  r = await put(e3, { measureValues: [{ kindId: null, quantity: 6 }] })
  check('registro que já usava a medida arquivada pode mantê-la', r.status === 200 && r.body.measure?.measureId === mVM.id, detail(r))
  await api('PATCH', `/measures/${mVM.id}`, { active: true })

  // PUT: ausente mantém; salvar tags (mesmo caminho) mantém; tirar declarante apaga
  r = await put(e3, {})
  check('PUT sem measureValues mantém', r.status === 200 && r.body.measure?.values[0].quantity === 6)
  r = await put(e3, { rootTagId: V.id, tagIds: [VMA.id] })
  check('salvar tags no mesmo caminho (declarante na subtag) mantém a medida', r.status === 200 && r.body.measure?.measureId === mVM.id, detail(r))
  r = await put(e3, { rootTagId: V.id, tagIds: [VF.id] })
  check('tirar a declarante do caminho apaga a medida', r.status === 200 && r.body.measure === null, detail(r))
  r = await put(e1, { rootTagId: S.id, tagIds: [] })
  check('trocar a raiz apaga a medida', r.status === 200 && r.body.measure === null && r.body.rootTagId === S.id, detail(r))
  r = await put(e4, { measureValues: [] })
  check('measureValues [] remove', r.status === 200 && r.body.measure === null, detail(r))
  r = await put(e4, { rootTagId: V.id, tagIds: [VMA.id], measureValues: [{ kindId: null, quantity: 3 }] })
  check('trocar caminho mandando valores: grava na medida nova', r.status === 200 && r.body.measure?.measureId === mVM.id, detail(r))

  // Finalizar com medida e Desfazer (completedAt null) com as de antes
  r = await api('POST', '/executions', { taskId, description: 'm2 aberta', completedAt: null, rootTagId: C.id, tagIds: [] })
  const open = r.body
  r = await api('PUT', `/executions/${open.id}`, { description: 'm2 aberta', completedAt,
    measureValues: [{ kindId: kind('questões').id, quantity: 7 }] })
  check('finalizar com medida', r.status === 200 && r.body.measure?.values[0].quantity === 7, detail(r))
  r = await api('PUT', `/executions/${open.id}`, { description: 'm2 aberta', completedAt: null, measureValues: [] })
  check('desfazer volta sem medida', r.status === 200 && r.body.completedAt === null && r.body.measure === null, detail(r))

  // Apagar usados
  r = await api('DELETE', `/measures/${mC.id}`)
  check('apagar medida usada: 409', r.status === 409, detail(r))
  r = await api('DELETE', `/measure-kinds/${kind('questões').id}`)
  check('apagar tipo usado: 409', r.status === 409, detail(r))
  r = await api('GET', '/executions')
  check('GET /executions: measure null ou { measureId, values } em todas', r.body.every((e) =>
    e.measure === null || (typeof e.measure.measureId === 'string' && Array.isArray(e.measure.values))))
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await waitForApi()
  const tags = (await pool.query(`SELECT id FROM tags WHERE name LIKE $1 OR root_id IN (SELECT id FROM tags WHERE name LIKE $1)`, [`${P}%`])).rows.map((x) => x.id)
  if (taskId) {
    await pool.query(`DELETE FROM execution_measure_values WHERE task_execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)`, [taskId])
    await pool.query(`DELETE FROM execution_measures WHERE task_execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)`, [taskId])
    await pool.query(`DELETE FROM task_execution_tags WHERE task_execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)`, [taskId])
    await pool.query('DELETE FROM task_executions WHERE task_id = $1', [taskId])
    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId])
  }
  if (tags.length) {
    await pool.query('DELETE FROM measure_kinds WHERE measure_id IN (SELECT id FROM measures WHERE tag_id = ANY($1))', [tags])
    await pool.query('DELETE FROM measures WHERE tag_id = ANY($1)', [tags])
    for (const level of [3, 2, 1]) await pool.query('DELETE FROM tags WHERE id = ANY($1) AND level = $2', [tags, level])
  }
  const left = await pool.query(`SELECT (SELECT count(*) FROM tags WHERE name LIKE $1)::int + (SELECT count(*) FROM tasks WHERE title LIKE $1)::int + (SELECT count(*) FROM measures WHERE id::text NOT LIKE '5eed%')::int AS n`, [`${P}%`])
  check('dados de teste apagados (nenhuma medida fora do seed)', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
