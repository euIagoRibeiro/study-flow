// Bateria do S2c (sugestão das seleções). Uso (raiz do repo):
//   node --env-file=backend/.env <este arquivo>
// Cria a própria árvore (prefixo teste-s2c), seleções, tarefa e registros
// concluídos em horários conhecidos; apaga tudo no finally (pg).
import pg from 'pg'
import { API } from '../config.mjs'
const { Pool } = pg
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-s2c'
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
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = { error: text.slice(0, 80) } }
  return { status: res.status, body: parsed }
}
const detail = (r) => `status ${r.status}${r.body?.error ? `: ${r.body.error}` : ''}`
const tag = async (name, parentId = null) => (await api('POST', '/tags', { name, parentId })).body
const names = new Map()
const sel = async (tagId, name, options, multiple = false) => {
  const r = await api('POST', '/selections', { tagId, name, multiple, options })
  if (r.status !== 201) throw new Error(`seleção ${name}: ${detail(r)}`)
  const s = r.body
  s.o = Object.fromEntries(s.options.map((o) => [o.name, o.id]))
  names.set(s.id, s.name)
  for (const o of s.options) names.set(o.id, o.name)
  return s
}
// "seleção:opção,opção@origem|…", ordenado
const shape = (items) => (items ?? [])
  .map((i) => `${names.get(i.selectionId)}:${i.optionIds.map((id) => names.get(id)).join(',')}@${i.from}`)
  .sort().join('|')
const same = (got, expected) => got === expected.split('|').filter(Boolean).sort().join('|')
const suggest = (rootTagId, tagId) => api('GET', `/selections/sugestao?${new URLSearchParams(
  Object.fromEntries(Object.entries({ rootTagId, tagId }).filter(([, v]) => v)))}`)

let taskId = null
try {
  // Árvore: V › VM › VMA, V › VF; C
  const V = await tag(`${P} vest`)
  const VM = await tag('mat', V.id)
  const VMA = await tag('alg', VM.id)
  const VF = await tag('fis', V.id)
  const C = await tag(`${P} code`)
  taskId = (await api('POST', '/tasks', { title: `${P} tarefa` })).body.id
  const G = await sel(null, `${P} natureza`, ['estudo', 'pesquisa', 'lazer'])
  const L = await sel(V.id, 'local', ['casa', 'rua', 'biblioteca'])
  const H = await sel(V.id, 'habilidade', ['x', 'y', 'z'], true)
  const M = await sel(VM.id, 'material', ['livro', 'apostila'])
  const F = await sel(VF.id, 'lab', ['sim', 'não'])
  const A = await sel(V.id, 'antiga', ['p'])
  const K = await sel(C.id, 'ferramenta', ['vim'])

  // Registros concluídos "há N horas" (maior = mais antigo)
  const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString()
  const rec = async (h, rootTagId, leaf, ids, completed = true) => {
    const r = await api('POST', '/executions', {
      taskId, description: 's2c', completedAt: completed ? ago(h) : null,
      rootTagId, tagIds: leaf ? [leaf] : [], selectionOptionIds: ids,
    })
    if (r.status !== 201) throw new Error(`registro ${h}h: ${detail(r)}`)
    return r.body.id
  }
  await rec(90, V.id, null, [L.o.casa, G.o.lazer, A.o.p]) //  só a raiz
  await rec(80, V.id, VM.id, [M.o.apostila, L.o.biblioteca]) // Matemática
  await rec(70, V.id, VMA.id, [M.o.livro, L.o.casa, H.o.z, G.o.estudo]) // Álgebra, mais antigo
  await rec(60, V.id, VMA.id, [L.o.rua, H.o.x, H.o.y]) // Álgebra, sem material e sem natureza
  await rec(50, V.id, VF.id, [F.o.sim, G.o.pesquisa]) // Física
  await rec(5, C.id, null, [K.o.vim, G.o.lazer]) // outra raiz, a mais recente de todas
  await rec(0, V.id, VMA.id, [L.o.biblioteca, M.o.apostila, G.o.lazer], false) // ABERTO: não conta

  // --- Validação
  let r = await suggest(null, null)
  check('sem caminho: nenhuma sugestão (items vazio), 200', r.status === 200 && Array.isArray(r.body?.items) && r.body.items.length === 0, detail(r))
  r = await suggest(null, VM.id)
  check('tagId sem rootTagId: 400', r.status === 400, detail(r))
  r = await suggest(VM.id, null)
  check('rootTagId de nível 2: 400', r.status === 400, detail(r))
  r = await suggest(C.id, VM.id)
  check('tagId de outra raiz: 400', r.status === 400, detail(r))
  r = await suggest('00000000-0000-4000-8000-000000000000', null)
  check('raiz inexistente: 404 da API (não do Express)', r.status === 404 && /tag/i.test(r.body?.error ?? ''), detail(r))
  r = await suggest(V.id, '00000000-0000-4000-8000-000000000000')
  check('tagId inexistente: 404 da API (não do Express)', r.status === 404 && /tag/i.test(r.body?.error ?? ''), detail(r))
  r = await api('GET', '/selections/sugestao?rootTagId=nao-e-uuid')
  check('id inválido: 400', r.status === 400, detail(r))

  // --- Mesma folha, por seleção (o aberto e a outra raiz nunca contam)
  r = await suggest(V.id, VMA.id)
  check('Álgebra: cada seleção pelo último registro de Álgebra QUE A ESCOLHEU; múltipla inteira',
    r.status === 200 && same(shape(r.body.items),
      'local:rua@path|habilidade:x,y@path|material:livro@path|antiga:p@root|' + `${P} natureza:estudo@path`),
    `${detail(r)} ${shape(r.body?.items)}`)
  r = await suggest(V.id, VM.id)
  check('Matemática (nível 2): só registros que param em Matemática, não os de Álgebra',
    same(shape(r.body?.items), 'material:apostila@path|local:biblioteca@path|habilidade:x,y@root|antiga:p@root|' +
      `${P} natureza:pesquisa@root`), shape(r.body?.items))
  r = await suggest(V.id, null)
  check('só a raiz: registros sem subtag; a "antiga" ainda ativa entra',
    same(shape(r.body?.items), 'local:casa@path|antiga:p@path|habilidade:x,y@root|' + `${P} natureza:lazer@path`),
    shape(r.body?.items))
  r = await suggest(V.id, VF.id)
  check('Física: lab e natureza do caminho; local e habilidade caem pra raiz (o mais recente da raiz)',
    same(shape(r.body?.items), 'lab:sim@path|antiga:p@root|' + `${P} natureza:pesquisa@path|local:rua@root|habilidade:x,y@root`),
    shape(r.body?.items))
  r = await suggest(C.id, null)
  check('outra raiz: só o que é dela', same(shape(r.body?.items), `ferramenta:vim@path|${P} natureza:lazer@path`), shape(r.body?.items))
  check('seleção que não vale no caminho (lab em Álgebra) nunca aparece',
    !(await suggest(V.id, VMA.id)).body.items.some((i) => i.selectionId === F.id))

  // --- Só ativas
  await api('PATCH', `/selection-options/${H.o.y}`, { active: false })
  r = await suggest(V.id, VMA.id)
  check('opção arquivada sai da sugestão; as ativas do mesmo registro ficam',
    shape(r.body?.items).includes('habilidade:x@path'), shape(r.body?.items))
  await api('PATCH', `/selection-options/${L.o.rua}`, { active: false })
  r = await suggest(V.id, VMA.id)
  check('registro cuja escolha ficou toda arquivada é pulado (vale o anterior: casa)',
    shape(r.body?.items).includes('local:casa@path'), shape(r.body?.items))
  await api('PATCH', `/selections/${A.id}`, { active: false })
  r = await suggest(V.id, null)
  check('seleção arquivada não é sugerida', !r.body?.items.some((i) => i.selectionId === A.id), shape(r.body?.items))
  r = await suggest(V.id, VMA.id)
  check('ordem das opções = a de cadastro', r.body.items.every((i) => {
    const s = [G, L, H, M, F, A, K].find((x) => x.id === i.selectionId)
    const pos = i.optionIds.map((id) => s.options.find((o) => o.id === id).position)
    return pos.every((p, k) => k === 0 || pos[k - 1] < p)
  }))
} catch (err) {
  check('rodou sem erro', false, err.stack?.split('\n').slice(0, 2).join(' '))
} finally {
  await waitForApi()
  const execs = `SELECT id FROM task_executions WHERE task_id IN (SELECT id FROM tasks WHERE title LIKE '${P}%')`
  const roots = `SELECT id FROM tags WHERE parent_id IS NULL AND name LIKE '${P}%'`
  const tags = `SELECT id FROM tags WHERE id IN (${roots}) OR root_id IN (${roots})`
  const sels = `SELECT id FROM selections WHERE tag_id IN (${tags}) OR (tag_id IS NULL AND name ILIKE '${P}%')`
  await pool.query(`DELETE FROM execution_selections WHERE task_execution_id IN (${execs}) OR selection_id IN (${sels})`)
  await pool.query(`DELETE FROM selection_options WHERE selection_id IN (${sels})`)
  await pool.query(`DELETE FROM selections WHERE id IN (${sels})`)
  await pool.query(`DELETE FROM time_entries WHERE task_execution_id IN (${execs})`)
  await pool.query(`DELETE FROM task_execution_tags WHERE task_execution_id IN (${execs})`)
  await pool.query(`DELETE FROM task_executions WHERE task_id IN (SELECT id FROM tasks WHERE title LIKE '${P}%')`)
  await pool.query(`DELETE FROM tasks WHERE title LIKE '${P}%'`)
  await pool.query(`DELETE FROM tags WHERE level = 3 AND root_id IN (${roots})`)
  await pool.query(`DELETE FROM tags WHERE level = 2 AND root_id IN (${roots})`)
  await pool.query(`DELETE FROM tags WHERE parent_id IS NULL AND name LIKE '${P}%'`)
  const left = await pool.query(
    `SELECT (SELECT count(*) FROM tags WHERE name LIKE '${P}%')::int + (SELECT count(*) FROM tasks WHERE title LIKE '${P}%')::int +
            (SELECT count(*) FROM selections WHERE id::text NOT LIKE '5eed%')::int +
            (SELECT count(*) FROM execution_selections)::int AS n`)
  check('dados de teste apagados (nenhuma seleção nem escolha fora do seed)', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
