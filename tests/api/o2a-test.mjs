// Bateria do O2a (cadastro de obras). Uso (raiz do repo):
//   node --env-file=backend/.env <este arquivo>
// Cria a própria árvore (prefixo teste-o2a), medidas, tarefas e um registro
// ligado por SQL (a escrita de workId pela API é o O2b); apaga tudo no finally.
import pg from 'pg'
import { API } from '../config.mjs'
import { apiFetch } from '../sessao.mjs'
const { Pool } = pg
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
// Obras antes da bateria: a limpeza confere a diferença, não depende do que o seed tem
const worksBefore = (await pool.query('SELECT count(*)::int AS n FROM works')).rows[0].n
const P = 'teste-o2a'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
async function waitForApi() {
  for (let i = 0; i < 30; i++) {
    try { if ((await apiFetch(`${API}/tasks`)).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('API não respondeu em 30s')
}
async function api(method, path, body) {
  await waitForApi()
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
const refused = (r, status, pattern) => r.status === status && pattern.test(r.body?.error ?? '')
const tag = (name, parentId = null) => must('POST', '/tags', { name, parentId })
const GHOST = '00000000-0000-4000-8000-00000000abcd'

let task = null
let idle = null
try {
  const R = await tag(`${P} raiz`)
  const A = await tag(`${P} a`, R.id)
  const A1 = await tag(`${P} a1`, A.id)
  const B = await tag(`${P} b`, R.id)
  const Z = await tag(`${P} z`)
  const Free = await tag(`${P} livre`)
  const Old = await tag(`${P} arquivada`)
  await must('PATCH', `/tags/${Old.id}`, { active: false })
  task = await must('POST', '/tasks', { title: `${P} tarefa` })
  idle = await must('POST', '/tasks', { title: `${P} outra` })
  const off = await must('POST', '/tasks', { title: `${P} arquivada` })
  await must('PATCH', `/tasks/${off.id}`, { active: false })
  const mR = await must('POST', '/measures', { tagId: R.id, name: 'capítulos', singular: 'capítulo', allowsDecimal: false, kinds: [] })
  const mA = await must('POST', '/measures', { tagId: A.id, name: 'páginas', singular: 'página', allowsDecimal: true, kinds: [] })
  const mZ = await must('POST', '/measures', { tagId: Z.id, name: 'itens', singular: 'item', allowsDecimal: false, kinds: [] })
  const base = { defaultTagId: B.id, defaultTaskId: task.id }
  const post = (title, extra = {}) => api('POST', '/works', { title, ...base, ...extra })

  // Criar
  let r = await post(`  ${P} Soul Eater  `)
  const w1 = r.body
  check('cria com o mínimo', r.status === 201 && w1.status === 'em_andamento' && w1.measureId === null && w1.total === null && w1.url === null, detail(r))
  check('título aparado', w1.title === `${P} Soul Eater`, w1.title)
  check('tag e tarefa ativas na resposta', w1.defaultTagActive === true && w1.defaultTaskActive === true, JSON.stringify(w1))
  r = await post(`${P} Bleach`, { status: 'pausado', measureId: mR.id, total: 113, url: 'HTTPS://Exemplo.com/A' })
  const w2 = r.body
  check('cria completo', r.status === 201 && w2.status === 'pausado' && w2.measureId === mR.id && w2.total === 113, detail(r))
  check('esquema em minúsculas, o resto intacto', w2.url === 'https://Exemplo.com/A', w2.url)
  r = await post(`${P} vazia`, { url: '   ' })
  check('url vazia vira NULL', r.status === 201 && r.body.url === null, detail(r))
  r = await post(`${P} Soul Eater`, { defaultTagId: Z.id })
  check('mesmo título em outra tag', r.status === 201, detail(r))
  const list = await must('GET', '/works')
  check('GET lista as obras', list.filter((w) => w.title.startsWith(P)).length === 4, `${list.length}`)

  // Medida mais próxima
  r = await api('POST', '/works', { title: `${P} m1`, defaultTagId: A1.id, defaultTaskId: task.id, measureId: mA.id, total: 12.5 })
  check('medida herdada do pai: a mais próxima', r.status === 201, detail(r))
  r = await api('POST', '/works', { title: `${P} m2`, defaultTagId: A1.id, defaultTaskId: task.id, measureId: mR.id })
  check('medida do avô, substituída no meio: recusada', refused(r, 400, /mais próxima/), detail(r))
  r = await post(`${P} m3`, { measureId: mZ.id })
  check('medida de outra árvore: recusada', refused(r, 400, /mais próxima/), detail(r))
  r = await post(`${P} m4`, { measureId: GHOST })
  check('medida inexistente: recusada', refused(r, 400, /mais próxima/), detail(r))
  r = await post(`${P} m5`, { total: 10 })
  check('total sem medida: recusado', refused(r, 400, /medida/), detail(r))
  r = await post(`${P} m6`, { measureId: mR.id, total: 1.5 })
  check('decimal em medida inteira: recusado', refused(r, 400, /decimal/), detail(r))

  // Validação
  for (const [name, title] of [['vazio', ''], ['só espaço', '   '], ['tabulação', '\t\t'], ['quebra de linha', '\n'], ['101 caracteres', 'x'.repeat(101)]]) {
    r = await post(title)
    check(`título ${name}: 400`, r.status === 400, detail(r))
  }
  r = await post(`  ${P} SOUL EATER `)
  check('título repetido: 409 com o motivo', refused(r, 409, /Já existe/), detail(r))
  r = await post(`${P} s`, { status: 'lendo' })
  check('status inválido: 400', r.status === 400, detail(r))
  for (const [name, url] of [['javascript:', 'javascript:alert(1)'], ['ftp', 'ftp://a.b'], ['com espaço', 'http://a b'], ['http:// sozinho', 'http://'], ['2001 caracteres', `http://${'x'.repeat(1994)}`]]) {
    r = await post(`${P} u`, { url })
    check(`url ${name}: 400`, r.status === 400, detail(r))
  }
  r = await post(`${P} t`, { defaultTagId: GHOST })
  check('tag inexistente: 400', refused(r, 400, /não existe/), detail(r))
  r = await post(`${P} t`, { defaultTaskId: GHOST })
  check('tarefa inexistente: 400', refused(r, 400, /não existe/), detail(r))
  r = await post(`${P} t`, { defaultTagId: Old.id })
  check('tag arquivada nova: 400', refused(r, 400, /arquivada/), detail(r))
  r = await post(`${P} t`, { defaultTaskId: off.id })
  check('tarefa arquivada nova: 400', refused(r, 400, /arquivada/), detail(r))
  r = await post(`${P} t`, { total: 0, measureId: mR.id })
  check('total zero: 400', r.status === 400, detail(r))
  r = await post(`${P} t`, { total: 1.234, measureId: mA.id })
  check('total com 3 casas: 400', r.status === 400, detail(r))

  // Editar
  r = await api('PATCH', `/works/${w1.id}`, { status: 'concluido', title: `${P} Soul Eater 2` })
  check('muda status e título', r.status === 200 && r.body.status === 'concluido' && r.body.title === `${P} Soul Eater 2`, detail(r))
  r = await api('PATCH', `/works/${w2.id}`, { url: '' })
  check('url vazia limpa', r.status === 200 && r.body.url === null, detail(r))
  r = await api('PATCH', `/works/${w2.id}`, { title: `${P} Bleach 2` })
  check('url ausente mantém o que está', r.status === 200 && r.body.total === 113 && r.body.measureId === mR.id, detail(r))
  r = await api('PATCH', `/works/${w2.id}`, { measureId: null })
  check('tirar a medida com total: recusado', refused(r, 400, /medida/), detail(r))
  r = await api('PATCH', `/works/${w2.id}`, { measureId: null, total: null })
  check('tirar medida e total juntos', r.status === 200 && r.body.measureId === null && r.body.total === null, detail(r))
  r = await api('PATCH', `/works/${w2.id}`, { measureId: mR.id, total: 20 })
  check('medida e total de volta', r.status === 200, detail(r))
  r = await api('PATCH', `/works/${w2.id}`, { defaultTagId: Z.id })
  check('trocar a tag sem trocar a medida: recusado', refused(r, 400, /mais próxima/), detail(r))
  r = await api('PATCH', `/works/${w2.id}`, { defaultTagId: Z.id, measureId: mZ.id })
  check('trocar a tag e a medida juntas', r.status === 200 && r.body.defaultTagId === Z.id, detail(r))
  r = await api('PATCH', `/works/${w2.id}`, {})
  check('PATCH vazio: 400', r.status === 400, detail(r))
  r = await api('PATCH', `/works/${GHOST}`, { status: 'pausado' })
  check('PATCH inexistente: 404', refused(r, 404, /Obra/), detail(r))
  r = await api('PATCH', '/works/abc', { status: 'pausado' })
  check('PATCH id inválido: 404', r.status === 404, detail(r))

  // Já na obra, continuam mesmo arquivadas
  const held = (await post(`${P} presa`, { defaultTagId: Free.id, defaultTaskId: idle.id })).body
  await must('PATCH', `/tags/${Free.id}`, { active: false })
  await must('PATCH', `/tasks/${idle.id}`, { active: false })
  r = await api('PATCH', `/works/${held.id}`, { status: 'pausado' })
  check('tag e tarefa arquivadas na obra: editar segue', r.status === 200, detail(r))
  check('arquivadas marcadas na resposta, sem bloquear', r.body?.defaultTagActive === false && r.body?.defaultTaskActive === false, JSON.stringify(r.body))
  await must('PATCH', `/tags/${Free.id}`, { active: true })
  await must('PATCH', `/tasks/${idle.id}`, { active: true })
  // Medida arquivada: fica se já era; nova, não
  await must('PATCH', `/measures/${mZ.id}`, { active: false })
  r = await api('PATCH', `/works/${w2.id}`, { status: 'em_andamento' })
  check('medida arquivada já na obra: editar segue', r.status === 200, detail(r))
  r = await api('POST', '/works', { title: `${P} nova`, defaultTagId: Z.id, defaultTaskId: task.id, measureId: mZ.id })
  check('medida arquivada nova: recusada', refused(r, 400, /arquivada/), detail(r))
  await must('PATCH', `/measures/${mZ.id}`, { active: true })

  // Apagar e traduções
  const used = (await post(`${P} usada`)).body
  const { rows: [exec] } = await pool.query(
    `INSERT INTO task_executions (task_id, task_title_at_time, task_frequency_at_time, work_id)
     VALUES ($1, 't', 'none', $2) RETURNING id`, [task.id, used.id])
  r = await api('DELETE', `/works/${used.id}`)
  check('apagar obra com registro: 409', refused(r, 409, /mude o status/), detail(r))
  await pool.query('UPDATE task_executions SET work_id = NULL WHERE id = $1', [exec.id])
  r = await api('DELETE', `/works/${used.id}`)
  check('apagar obra sem registro: 204', r.status === 204, detail(r))
  r = await api('DELETE', `/works/${used.id}`)
  check('apagar de novo: 404', refused(r, 404, /Obra/), detail(r))
  r = await api('DELETE', '/works/abc')
  check('apagar id inválido: 404', r.status === 404, detail(r))
  await pool.query('DELETE FROM task_executions WHERE id = $1', [exec.id])

  r = await api('DELETE', `/tags/${B.id}`)
  check('apagar tag padrão de obra: 409 com o motivo', refused(r, 409, /padrão de uma obra/), detail(r))
  r = await api('DELETE', `/measures/${mZ.id}`)
  check('apagar medida usada por obra: 409 com o motivo', refused(r, 409, /obra/), detail(r))
  // Usadas por registro E por obra: qual FK recusa primeiro muda depois de
  // pg_dump/restore, e as duas têm que virar 409
  const both = await tag(`${P} dupla`)
  const mBoth = await must('POST', '/measures', { tagId: both.id, name: 'dupla', singular: 'dupla', allowsDecimal: false, kinds: [] })
  const shared = await must('POST', '/works', { title: `${P} dupla`, defaultTagId: both.id, defaultTaskId: task.id, measureId: mBoth.id })
  const rec = await must('POST', '/executions', { taskId: task.id, description: 'o2a', completedAt: new Date().toISOString(), rootTagId: both.id, tagIds: [], measureValues: [{ kindId: null, quantity: 3 }] })
  r = await api('DELETE', `/tags/${both.id}`)
  check('tag usada por registro e por obra: 409', r.status === 409, detail(r))
  r = await api('DELETE', `/measures/${mBoth.id}`)
  check('medida usada por registro e por obra: 409', r.status === 409, detail(r))
  await pool.query('DELETE FROM execution_measure_values WHERE task_execution_id = $1', [rec.id])
  await pool.query('DELETE FROM execution_measures WHERE task_execution_id = $1', [rec.id])
  await pool.query('DELETE FROM time_entries WHERE task_execution_id = $1', [rec.id])
  await pool.query('DELETE FROM task_executions WHERE id = $1', [rec.id])
  await pool.query('DELETE FROM works WHERE id = $1', [shared.id])
  check('a medida continua, com os tipos intactos', (await pool.query('SELECT 1 FROM measures WHERE id = $1', [mZ.id])).rowCount === 1)
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await waitForApi()
  await pool.query(`DELETE FROM works WHERE title LIKE '${P}%'`)
  await pool.query(`DELETE FROM measures WHERE tag_id IN (SELECT id FROM tags WHERE name LIKE '${P}%')`)
  await pool.query(`DELETE FROM tags WHERE name LIKE '${P}%' AND level = 3`)
  await pool.query(`DELETE FROM tags WHERE name LIKE '${P}%' AND level = 2`)
  await pool.query(`DELETE FROM tags WHERE name LIKE '${P}%'`)
  await pool.query(`DELETE FROM task_executions WHERE task_id IN (SELECT id FROM tasks WHERE title LIKE '${P}%')`)
  await pool.query(`DELETE FROM tasks WHERE title LIKE '${P}%'`)
  const left = await pool.query(
    `SELECT abs((SELECT count(*) FROM works)::int - $1) + (SELECT count(*) FROM tags WHERE name LIKE '${P}%')::int +
            (SELECT count(*) FROM tasks WHERE title LIKE '${P}%')::int AS n`, [worksBefore])
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
