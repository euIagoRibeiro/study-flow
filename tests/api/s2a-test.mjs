// Bateria do S2a (cadastro das seleções). Uso (raiz do repo):
//   node --env-file=backend/.env <este arquivo>
// Cria a própria árvore (prefixo teste-s2a), seleções, tarefa e registros; as
// escolhas entram direto no banco (a escrita pela API é o S2b). Apaga tudo no
// finally (pg), esperando a API antes de cada pedido.
import pg from 'pg'
import { API } from '../config.mjs'
const { Pool } = pg
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-s2a'
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
const sel = (tagId, name, options = ['a', 'b'], multiple = false) =>
  api('POST', '/selections', { tagId, name, multiple, options })
const allSelections = async () => (await api('GET', '/selections')).body
const copies = async (selectionId) =>
  (await pool.query('SELECT selection_multiple FROM execution_selections WHERE selection_id = $1', [selectionId]))
    .rows.map((row) => row.selection_multiple)

try {
  // Árvore: V › VM › VMA, V › VF; C; D (declara, nunca usada); U (usada); X arquivada
  const V = await tag(`${P} vest`)
  const VM = await tag('mat', V.id)
  const VMA = await tag('alg', VM.id)
  const VF = await tag('fis', V.id)
  const C = await tag(`${P} code`)
  const D = await tag(`${P} del`)
  const U = await tag(`${P} usada`)
  const X = await tag(`${P} arq`)
  await api('PATCH', `/tags/${X.id}`, { active: false })
  const taskId = (await api('POST', '/tasks', { title: `${P} tarefa` })).body.id
  const record = async (rootTagId, tagIds = []) =>
    (await api('POST', '/executions', { taskId, completedAt: new Date().toISOString(), rootTagId, tagIds })).body.id
  // Escolha gravada direto, com as cópias que a API do S2b vai preencher
  const choose = (executionId, s, optionId) => pool.query(
    `INSERT INTO execution_selections
       (task_execution_id, selection_id, option_id, selection_multiple, selection_global, tag_id, root_tag_id)
     SELECT $1, s.id, $3, s.multiple, s.is_global, s.tag_id,
            CASE WHEN s.tag_id IS NULL THEN NULL ELSE e.root_tag_id END
     FROM selections s, task_executions e WHERE s.id = $2 AND e.id = $1`,
    [executionId, s.id, optionId])

  // --- Criar
  let r = await sel(null, `${P} natureza`, ['estudo', 'pesquisa', 'prática'])
  const G = r.body
  check('criar global com 3 opções: 201, tagId null, opções na ordem de cadastro',
    r.status === 201 && G?.tagId === null && G.multiple === false &&
    G.options?.map((o) => `${o.position}:${o.name}`).join(',') === '1:estudo,2:pesquisa,3:prática', detail(r))
  r = await sel(V.id, 'habilidade', ['escuta', 'fala'], true)
  const H = r.body
  check('criar múltipla na raiz: 201', r.status === 201 && H?.multiple === true && H.tagId === V.id, detail(r))
  r = await sel(X.id, 'qualquer')
  check('tag arquivada não recebe seleção nova: 400', r.status === 400, detail(r))
  r = await sel('00000000-0000-4000-8000-000000000000', 'qualquer')
  check('tag inexistente: 400', r.status === 400, detail(r))
  r = await api('POST', '/selections', { name: `${P} sem tag`, options: ['a'] })
  check('tagId ausente (global só com null explícito): 400', r.status === 400, detail(r))
  r = await sel(C.id, '   ')
  check('nome em branco: 400', r.status === 400, detail(r))
  r = await sel(C.id, 'x'.repeat(31))
  check('nome com 31 caracteres: 400', r.status === 400, detail(r))
  r = await sel(C.id, 'vazia', [])
  check('sem opções: 400', r.status === 400, detail(r))
  r = await sel(C.id, 'repetidas', ['digital', ' Digital '])
  check('opções repetidas (maiúscula/espaço): 409, nada criado', r.status === 409 &&
    !(await allSelections()).some((s) => s.tagId === C.id), detail(r))

  // --- Nome único ao longo do caminho
  r = await sel(VM.id, 'HABILIDADE ')
  check('mesmo nome num DESCENDENTE (Vestibular › Matemática): 409', r.status === 409, detail(r))
  check('a mensagem diz onde está a outra', /habilidade/i.test(r.body?.error ?? '') && /vest/.test(r.body?.error ?? ''), r.body?.error)
  r = await sel(VMA.id, 'ferramenta')
  const fVMA = r.body
  check('declarar no nível 3: 201', r.status === 201, detail(r))
  r = await sel(V.id, 'Ferramenta')
  check('mesmo nome num ANCESTRAL: 409, com o caminho completo da outra',
    r.status === 409 && (r.body?.error ?? '').includes(`em ${P} vest › mat › alg`), detail(r))
  r = await sel(VF.id, 'ferramenta')
  check('mesmo nome num ramo irmão (Vestibular › Física): 201', r.status === 201, detail(r))
  r = await sel(C.id, 'ferramenta')
  check('mesmo nome em outra raiz: 201', r.status === 201, detail(r))
  r = await sel(VM.id, `${P} NATUREZA`)
  check('nome de uma GLOBAL numa tag: 409', r.status === 409, detail(r))
  r = await sel(null, 'Ferramenta')
  check('global com nome de uma seleção de tag: 409', r.status === 409, detail(r))
  r = await sel(VMA.id, 'ferramenta')
  check('mesmo nome na mesma tag: 409', r.status === 409, detail(r))
  const arch = (await sel(VF.id, 'arquivada')).body
  await api('PATCH', `/selections/${arch.id}`, { active: false })
  r = await sel(V.id, 'arquivada')
  check('a ARQUIVADA conta (ancestral de uma arquivada): 409', r.status === 409, detail(r))
  r = await api('PATCH', `/selections/${arch.id}`, { active: true })
  check('reativar: 200 (nunca dá conflito)', r.status === 200 && r.body?.active === true, detail(r))

  // --- Renomear
  r = await api('PATCH', `/selections/${fVMA.id}`, { name: 'habilidade' })
  check('renomear pro nome de um ancestral: 409', r.status === 409, detail(r))
  r = await api('PATCH', `/selections/${fVMA.id}`, { name: 'Ferramenta ' })
  check('renomear pra ela mesma com outra maiúscula: 200', r.status === 200 && r.body?.name === 'Ferramenta', detail(r))
  // Independente dos casos acima: global própria, seleção numa raiz sem subtags
  await sel(null, `${P} outra global`)
  const cS = (await allSelections()).find((s) => s.tagId === C.id)
  r = await api('PATCH', `/selections/${cS.id}`, { name: `${P} OUTRA global` })
  check('renomear pro nome de uma global: 409', r.status === 409 && /global/.test(r.body?.error ?? ''), detail(r))
  r = await api('PATCH', `/selections/${H.id}`, { tagId: C.id })
  check('tagId no PATCH: ignorado, a seleção fica onde estava', (await allSelections()).find((s) => s.id === H.id)?.tagId === V.id, detail(r))
  r = await api('PATCH', `/selections/${H.id}`, {})
  check('PATCH vazio: 400', r.status === 400, detail(r))
  r = await api('PATCH', '/selections/00000000-0000-4000-8000-000000000000', { name: 'x' })
  check('PATCH inexistente: 404', r.status === 404, detail(r))
  r = await api('PATCH', '/selections/nao-e-uuid', { name: 'x' })
  check('PATCH id inválido: 404', r.status === 404, detail(r))

  // --- Opções
  r = await api('POST', '/selection-options', { selectionId: G.id, name: 'criação' })
  check('opção nova: 201 na posição 4', r.status === 201 && r.body?.position === 4, detail(r))
  const created = r.body
  r = await api('POST', '/selection-options', { selectionId: G.id, name: ' ESTUDO' })
  check('opção repetida: 409', r.status === 409, detail(r))
  r = await api('POST', '/selection-options', { selectionId: '00000000-0000-4000-8000-000000000000', name: 'x' })
  check('opção em seleção inexistente: 400', r.status === 400, detail(r))
  r = await api('DELETE', `/selection-options/${created.id}`)
  check('apagar opção nunca usada: 204', r.status === 204, detail(r))
  r = await api('POST', '/selection-options', { selectionId: G.id, name: 'lazer' })
  check('depois de apagar a última, a próxima ocupa a maior + 1 (4)', r.status === 201 && r.body?.position === 4, detail(r))
  r = await api('PATCH', `/selection-options/${r.body.id}`, { name: 'Pesquisa' })
  check('renomear opção pra uma existente: 409', r.status === 409, detail(r))
  r = await api('PATCH', `/selection-options/${G.options[2].id}`, { name: 'prática livre', active: false })
  check('renomear e arquivar opção: 200', r.status === 200 && r.body?.name === 'prática livre' && r.body.active === false, detail(r))
  r = await api('GET', '/selections')
  const g = r.body.find((s) => s.id === G.id)
  check('GET /selections: opções em position, com a arquivada',
    g?.options.map((o) => o.name).join(',') === 'estudo,pesquisa,prática livre,lazer', g?.options.map((o) => o.name).join(','))

  // --- Única ↔ múltipla, com registros
  const e1 = await record(V.id)
  const e2 = await record(V.id)
  await choose(e1, H, H.options[0].id)
  await choose(e1, H, H.options[1].id)
  await choose(e2, H, H.options[0].id)
  r = await api('PATCH', `/selections/${H.id}`, { multiple: false })
  check('múltipla → única com um registro de duas opções: 409', r.status === 409, detail(r))
  check('o 409 diz quantos registros', /\b1 registro\b/.test(r.body?.error ?? ''), r.body?.error)
  check('nada mudou: continua múltipla, cópias true',
    (await allSelections()).find((s) => s.id === H.id)?.multiple === true && (await copies(H.id)).every(Boolean))
  await pool.query('DELETE FROM execution_selections WHERE task_execution_id = $1 AND option_id = $2', [e1, H.options[1].id])
  r = await api('PATCH', `/selections/${H.id}`, { multiple: false })
  check('múltipla → única com uma opção por registro: 200, cópias false',
    r.status === 200 && r.body?.multiple === false && (await copies(H.id)).every((m) => m === false), detail(r))
  r = await api('PATCH', `/selections/${H.id}`, { multiple: true })
  check('única → múltipla usada: 200, cópias true',
    r.status === 200 && r.body?.multiple === true && (await copies(H.id)).every(Boolean), detail(r))
  // A rede de segurança sozinha (índice), com dois registros de duas opções
  await choose(e1, H, H.options[1].id)
  await choose(e2, H, H.options[1].id)
  r = await api('PATCH', `/selections/${H.id}`, { multiple: false, name: 'habilidades' })
  check('dois registros: "2 registros", e nem o nome muda junto', r.status === 409 && /\b2 registros\b/.test(r.body?.error ?? '') &&
    (await allSelections()).find((s) => s.id === H.id)?.name === 'habilidade', detail(r))

  // --- Apagar
  r = await api('DELETE', `/selection-options/${H.options[0].id}`)
  check('apagar opção usada: 409', r.status === 409, detail(r))
  r = await api('DELETE', `/selections/${H.id}`)
  check('apagar seleção usada: 409, opções intactas', r.status === 409 &&
    (await allSelections()).find((s) => s.id === H.id)?.options.length === 2, detail(r))
  const unused = (await sel(C.id, 'nunca usada', ['x', 'y', 'z'])).body
  r = await api('DELETE', `/selections/${unused.id}`)
  check('apagar seleção nunca usada, com as opções: 204', r.status === 204 &&
    !(await allSelections()).some((s) => s.id === unused.id), detail(r))
  r = await api('DELETE', `/selections/${unused.id}`)
  check('apagar de novo: 404', r.status === 404, detail(r))
  await sel(D.id, 'declarada')
  r = await api('DELETE', `/tags/${D.id}`)
  check('apagar tag que declara seleção: 409 (não 500)', r.status === 409 && /sele/i.test(r.body?.error ?? ''), detail(r))
  const sU = (await sel(U.id, 'local')).body
  const eU = await record(U.id)
  await choose(eU, sU, sU.options[0].id)
  r = await api('DELETE', `/tags/${U.id}`)
  check('apagar tag usada com escolha: 409 (não 500)', r.status === 409, detail(r))
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
  await pool.query(`DELETE FROM task_execution_tags WHERE task_execution_id IN (${execs})`)
  await pool.query(`DELETE FROM task_executions WHERE task_id IN (SELECT id FROM tasks WHERE title LIKE '${P}%')`)
  await pool.query(`DELETE FROM tasks WHERE title LIKE '${P}%'`)
  await pool.query(`DELETE FROM tags WHERE level = 3 AND root_id IN (${roots})`)
  await pool.query(`DELETE FROM tags WHERE level = 2 AND root_id IN (${roots})`)
  await pool.query(`DELETE FROM tags WHERE parent_id IS NULL AND name LIKE '${P}%'`)
  const left = await pool.query(
    `SELECT (SELECT count(*) FROM tags WHERE name LIKE '${P}%')::int + (SELECT count(*) FROM tasks WHERE title LIKE '${P}%')::int +
            (SELECT count(*) FROM selections WHERE id::text NOT LIKE '5eed%')::int AS n`)
  check('dados de teste apagados (nenhuma seleção fora do seed)', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
