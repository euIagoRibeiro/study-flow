// Bateria do S2b (escolhas de seleção no registro). Uso (raiz do repo):
//   node --env-file=backend/.env <este arquivo>
// Cria a própria árvore (prefixo teste-s2b), seleções, tarefa e registros pela
// API; apaga tudo no finally (pg), esperando a API antes de cada pedido.
import pg from 'pg'
import { API } from '../config.mjs'
const { Pool } = pg
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-s2b'
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
const sel = async (tagId, name, options, multiple = false) => {
  const r = await api('POST', '/selections', { tagId, name, multiple, options })
  if (r.status !== 201) throw new Error(`seleção ${name}: ${detail(r)}`)
  const s = r.body
  s.o = Object.fromEntries(s.options.map((o) => [o.name, o.id]))
  return s
}
// O que a resposta diz, numa forma comparável: "nome:opção,opção|…"
const names = new Map()
const shape = (selections) => (selections ?? [])
  .map((g) => `${names.get(g.selectionId)}:${g.optionIds.map((id) => names.get(id)).join(',')}`)
  .sort().join('|')
// A resposta bate com o esperado (a ordem do texto não importa)
const same = (got, expected) => got === expected.split('|').sort().join('|')
// O que o banco tem, com as cópias
const stored = async (executionId) => (await pool.query(
  `SELECT s.name, o.name AS option, es.selection_multiple, es.selection_global, es.tag_id, es.root_tag_id,
          s.multiple, s.tag_id AS s_tag, e.root_tag_id AS e_root
   FROM execution_selections es JOIN selections s ON s.id = es.selection_id
   JOIN selection_options o ON o.id = es.option_id JOIN task_executions e ON e.id = es.task_execution_id
   WHERE es.task_execution_id = $1`, [executionId])).rows

let taskId = null
try {
  // Árvore: V › VM › VMA, V › VF; C
  const V = await tag(`${P} vest`)
  const VM = await tag('mat', V.id)
  const VMA = await tag('alg', VM.id)
  const VF = await tag('fis', V.id)
  const C = await tag(`${P} code`)
  taskId = (await api('POST', '/tasks', { title: `${P} tarefa` })).body.id
  const G = await sel(null, `${P} natureza`, ['estudo', 'lazer'])
  const sV = await sel(V.id, 'local', ['casa', 'rua', 'velha'])
  const hV = await sel(V.id, 'habilidade', ['x', 'y', 'z'], true)
  const sVM = await sel(VM.id, 'material', ['livro', 'apostila'])
  const sVMA = await sel(VMA.id, 'nível', ['fácil', 'difícil'])
  const sVF = await sel(VF.id, 'lab', ['sim', 'não'])
  const sC = await sel(C.id, 'ferramenta', ['vim', 'ide'])
  const arqS = await sel(V.id, 'antiga', ['p', 'q'])
  for (const s of [G, sV, hV, sVM, sVMA, sVF, sC, arqS]) {
    names.set(s.id, s.name)
    for (const o of s.options) names.set(o.id, o.name)
  }
  const completedAt = new Date().toISOString()
  const post = (rootTagId, leaf, selectionOptionIds) => api('POST', '/executions', {
    taskId, description: 's2b', completedAt, rootTagId, tagIds: leaf ? [leaf] : [], selectionOptionIds,
  })
  const put = (e, body) => api('PUT', `/executions/${e}`, { description: 's2b', completedAt, ...body })
  const count = async () => (await pool.query('SELECT count(*)::int AS n FROM task_executions WHERE task_id = $1', [taskId])).rows[0].n

  // --- Criar
  let r = await post(V.id, VMA.id, [hV.o.y, sV.o.casa, hV.o.x, sVM.o.livro, sVMA.o['fácil'], G.o.estudo])
  const e1 = r.body?.id
  check('POST com seleções de todos os níveis do caminho + global: 201',
    r.status === 201 && same(shape(r.body.selections), `${P} natureza:estudo|habilidade:x,y|local:casa|material:livro|nível:fácil`),
    `${detail(r)} ${shape(r.body?.selections)}`)
  const rows = await stored(e1)
  check('banco: cópias certas (múltipla, global, declarante, raiz)', rows.length === 6 && rows.every((x) =>
    x.selection_multiple === x.multiple && x.selection_global === (x.s_tag === null) && x.tag_id === x.s_tag &&
    x.root_tag_id === (x.s_tag === null ? null : x.e_root)), JSON.stringify(rows.map((x) => x.option)))
  r = await api('GET', '/executions')
  const got = r.body.find((e) => e.id === e1)
  check('GET devolve as escolhas agrupadas, opções na ordem de cadastro (x antes de y)', shape(got?.selections) === shape(
    [{ selectionId: hV.id, optionIds: [hV.o.x, hV.o.y] }, { selectionId: sV.id, optionIds: [sV.o.casa] },
      { selectionId: sVM.id, optionIds: [sVM.o.livro] }, { selectionId: sVMA.id, optionIds: [sVMA.o['fácil']] },
      { selectionId: G.id, optionIds: [G.o.estudo] }]) &&
    got.selections.find((g) => g.selectionId === hV.id).optionIds.join() === [hV.o.x, hV.o.y].join())
  check('GET: registro sem escolha tem selections = []', r.body.every((e) => Array.isArray(e.selections)) &&
    r.body.some((e) => e.selections.length === 0))
  r = await post(null, null, [G.o.lazer])
  const e2 = r.body?.id
  check('POST sem tag, só a global: 201', r.status === 201 && same(shape(r.body.selections), `${P} natureza:lazer`), detail(r))

  let before = await count()
  r = await post(null, null, [sV.o.casa])
  check('POST sem tag com seleção de tag: 400, pela API (nome na mensagem)', r.status === 400 && /"local".*caminho/.test(r.body?.error ?? ''), detail(r))
  r = await post(V.id, VMA.id, [sVF.o.sim])
  check('seleção de um ramo irmão (fora do caminho): 400, pela API', r.status === 400 && /"lab".*caminho/.test(r.body?.error ?? ''), detail(r))
  r = await post(V.id, null, [sC.o.vim])
  check('seleção de outra raiz: 400, pela API', r.status === 400 && /"ferramenta".*caminho/.test(r.body?.error ?? ''), detail(r))
  r = await post(V.id, null, [sV.o.casa, sV.o.rua])
  check('duas opções numa escolha única: 400, pela API', r.status === 400 && /única/.test(r.body?.error ?? ''), detail(r))
  r = await post(V.id, null, [sV.o.casa, sV.o.casa])
  check('a mesma opção duas vezes: 400', r.status === 400, detail(r))
  r = await post(V.id, null, ['00000000-0000-4000-8000-000000000000'])
  check('opção inexistente: 400', r.status === 400, detail(r))
  r = await post(V.id, null, ['nao-e-uuid'])
  check('id inválido: 400', r.status === 400, detail(r))
  check('nenhum dos recusados criou registro', (await count()) === before, `${await count()} × ${before}`)

  // --- Arquivadas: mantida se já estava, recusada se nova
  r = await post(V.id, null, [sV.o.velha, arqS.o.p])
  const e3 = r.body?.id
  check('registro com as que vão ser arquivadas: 201', r.status === 201, detail(r))
  await api('PATCH', `/selection-options/${sV.o.velha}`, { active: false })
  await api('PATCH', `/selections/${arqS.id}`, { active: false })
  before = await count()
  r = await post(V.id, null, [sV.o.velha])
  check('opção arquivada nova: 400', r.status === 400 && /arquivad/.test(r.body?.error ?? ''), detail(r))
  r = await post(V.id, null, [arqS.o.q])
  check('seleção arquivada nova: 400', r.status === 400 && /arquivad/.test(r.body?.error ?? ''), detail(r))
  check('nenhum criado', (await count()) === before)
  r = await put(e3, { selectionOptionIds: [sV.o.velha, arqS.o.p, G.o.estudo] })
  check('PUT mantendo as arquivadas que já estavam: 200', r.status === 200 &&
    same(shape(r.body.selections), `${P} natureza:estudo|antiga:p|local:velha`), detail(r))
  r = await put(e3, { selectionOptionIds: [arqS.o.q] })
  check('outra opção numa seleção arquivada que o registro tinha: 400', r.status === 400, detail(r))
  r = await put(e3, { selectionOptionIds: [G.o.estudo] })
  r = await put(e3, { selectionOptionIds: [sV.o.velha] })
  check('arquivada que SAIU do registro não volta: 400', r.status === 400, detail(r))

  // --- PUT: ausente mantém, [] limpa, lista substitui
  r = await put(e1, {})
  check('PUT sem selectionOptionIds mantém', r.status === 200 && r.body.selections.length === 5, detail(r))
  r = await put(e1, { selectionOptionIds: [hV.o.z, G.o.lazer] })
  check('lista substitui tudo', r.status === 200 && same(shape(r.body.selections), `${P} natureza:lazer|habilidade:z`), detail(r))
  r = await put(e1, { selectionOptionIds: [] })
  check('[] limpa tudo', r.status === 200 && r.body.selections.length === 0 && (await stored(e1)).length === 0, detail(r))
  r = await put(e2, { selectionOptionIds: [G.o.estudo, G.o.lazer] })
  check('PUT com duas na global única: 400, e ficou a de antes', r.status === 400 &&
    (await stored(e2)).map((x) => x.option).join() === 'lazer', detail(r))

  // --- Troca de caminho, sem mandar as escolhas
  const full = [hV.o.x, sV.o.casa, sVM.o.livro, sVMA.o['fácil'], G.o.estudo]
  await put(e1, { rootTagId: V.id, tagIds: [VMA.id], selectionOptionIds: full })
  r = await put(e1, { rootTagId: V.id, tagIds: [VM.id] })
  check('subtag sobe (Álgebra → Matemática): sai só a do nível 3', r.status === 200 &&
    same(shape(r.body.selections), `${P} natureza:estudo|habilidade:x|local:casa|material:livro`), `${detail(r)} ${shape(r.body?.selections)}`)
  r = await put(e1, { rootTagId: V.id, tagIds: [VF.id] })
  check('subtag troca de ramo (Matemática → Física): sai a da Matemática, ficam raiz e global', r.status === 200 &&
    same(shape(r.body.selections), `${P} natureza:estudo|habilidade:x|local:casa`), `${detail(r)} ${shape(r.body?.selections)}`)
  r = await put(e1, { rootTagId: C.id, tagIds: [] })
  check('raiz troca (Vestibular → Código): saem todas as não globais, a global FICA', r.status === 200 &&
    same(shape(r.body.selections), `${P} natureza:estudo`), `${detail(r)} ${shape(r.body?.selections)}`)
  r = await put(e1, { rootTagId: null, tagIds: [] })
  check('tirar as tags: a global fica', r.status === 200 && same(shape(r.body.selections), `${P} natureza:estudo`), detail(r))
  r = await put(e1, { rootTagId: V.id, tagIds: [] })
  check('sem raiz → Vestibular, sem mandar escolhas: a global continua', r.status === 200 &&
    same(shape(r.body.selections), `${P} natureza:estudo`), detail(r))

  // --- Troca de caminho com as escolhas no mesmo pedido
  r = await put(e1, { rootTagId: V.id, tagIds: [VMA.id], selectionOptionIds: full })
  check('caminho + escolhas do caminho novo num pedido: 200', r.status === 200 && r.body.selections.length === 5, detail(r))
  r = await put(e1, { rootTagId: C.id, tagIds: [], selectionOptionIds: [sC.o.ide, G.o.lazer] })
  check('troca de raiz com as escolhas da raiz nova: 200, só elas',
    r.status === 200 && same(shape(r.body.selections), `${P} natureza:lazer|ferramenta:ide`), detail(r))
  r = await put(e1, { rootTagId: V.id, tagIds: [VF.id], selectionOptionIds: [sVM.o.livro] })
  check('caminho novo com escolha que não vale nele: 400', r.status === 400 && /"material".*caminho/.test(r.body?.error ?? ''), detail(r))
  const after = (await api('GET', '/executions')).body.find((e) => e.id === e1)
  check('...e nada mudou (caminho e escolhas de antes)', after.rootTagId === C.id &&
    same(shape(after.selections), `${P} natureza:lazer|ferramenta:ide`), shape(after.selections))

  // --- Finalizar/desfazer não mexem (não mandam tags nem escolhas)
  r = await api('PUT', `/executions/${e1}`, { description: 'só a descrição', completedAt })
  check('editar só a descrição mantém escolhas e caminho', r.status === 200 && r.body.selections.length === 2, detail(r))
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
