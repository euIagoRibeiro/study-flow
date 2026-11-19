// Painel, medidas por contexto (MA2a): GET /dashboard/medidas-por-contexto. A mesma regra da MA1 com o grupo
// = a raiz do registro. Abril e maio de 2025 (o seed nunca cai lá), dados próprios inseridos no banco e
// apagados no fim; as contas à mão são as de tests/banco/medidas-contexto-cases.sql. Confere também que a soma
// dos contextos fecha com o período inteiro da rota da MA1.
// Uso (raiz do repo): node --env-file=backend/.env tests/api/medidas-contexto-test.mjs
import pg from 'pg'
import { API } from '../config.mjs'
import { apiFetch } from '../sessao.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a base e a limpeza usam o banco)')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const FUSO = 'America/Sao_Paulo'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const u = (p, n) => `00000000-0000-4000-${p}-${String(n).padStart(12, '0')}`
const local = (t) => new Date(`${t.replace(' ', 'T')}:00-03:00`)
async function get(route, params) {
  const res = await apiFetch(`${API}/dashboard/${route}?${new URLSearchParams(params)}`)
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { /* resposta que não é JSON */ }
  return { status: res.status, body }
}
const win = (route, a, b) => get(route, { de: local(a).toISOString(), ate: local(b).toISOString(), fuso: FUSO })
// "Rn:{Nome=total/registros{tipo=qtd/registros;...};...}" na ordem da rota
const kindsTxt = (m) => m.kinds.map((k) => `${k.name ?? '(sem tipo)'}=${k.quantity}/${k.executions}`).join(';')
const txt = (items) => items.map((i) => `R${i.tagId.slice(-1)}:{${i.measures.map((m) => `${m.name}=${m.total}/${m.executions}{${kindsTxt(m)}}`).join(';')}}`).join(' ')
const show = async (a, b) => { const r = await win('medidas-por-contexto', a, b); return r.status === 200 ? txt(r.body.items) : `status ${r.status}` }

async function cleanup() {
  const ex = `task_execution_id::text LIKE '00000000-0000-4000-a0c5-%'`
  await pool.query(`DELETE FROM execution_measure_values WHERE ${ex}`)
  await pool.query(`DELETE FROM execution_measures WHERE ${ex}`)
  await pool.query(`DELETE FROM task_execution_tags WHERE ${ex}`)
  await pool.query(`DELETE FROM task_executions WHERE id::text LIKE '00000000-0000-4000-a0c5-%'`)
  await pool.query(`DELETE FROM measure_kinds WHERE id::text LIKE '00000000-0000-4000-a0c4-%'`)
  await pool.query(`DELETE FROM measures WHERE id::text LIKE '00000000-0000-4000-a0c3-%'`)
  await pool.query(`DELETE FROM tags WHERE id::text LIKE '00000000-0000-4000-a0c2-%' AND level = 2`)
  await pool.query(`DELETE FROM tags WHERE id::text LIKE '00000000-0000-4000-a0c2-%'`)
  await pool.query(`DELETE FROM tasks WHERE id = $1`, [u('a0c6', 1)])
}

try {
  await cleanup()
  await pool.query(`INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
    ($1, 'MC R1', 1, NULL, NULL), ($2, 'MC R2', 1, NULL, NULL), ($3, 'MC R3', 1, NULL, NULL), ($4, 'MC R4', 1, NULL, NULL)`,
  [u('a0c2', 1), u('a0c2', 2), u('a0c2', 3), u('a0c2', 4)])
  await pool.query(`INSERT INTO tags (id, name, level, parent_id, root_id) VALUES ($1, 'MC S', 2, $2, $2)`, [u('a0c2', 11), u('a0c2', 1)])
  await pool.query(`INSERT INTO measures (id, tag_id, name, singular, allows_decimal) VALUES
    ($1, $5, 'Questões', 'questão', false), ($2, $6, 'QUESTÕES ', 'questão', false),
    ($3, $7, 'Exercícios', 'exercício', false), ($4, $8, 'Km', 'km', true)`,
  [u('a0c3', 1), u('a0c3', 2), u('a0c3', 3), u('a0c3', 4), u('a0c2', 1), u('a0c2', 2), u('a0c2', 11), u('a0c2', 3)])
  await pool.query(`INSERT INTO measure_kinds (id, measure_id, name) VALUES
    ($1, $6, 'Acertos'), ($2, $6, 'Erros'), ($3, $7, 'acertos'), ($4, $7, 'ERROS'), ($5, $8, 'Leitura')`,
  [u('a0c4', 1), u('a0c4', 2), u('a0c4', 3), u('a0c4', 4), u('a0c4', 5), u('a0c3', 1), u('a0c3', 2), u('a0c3', 3)])
  await pool.query(`INSERT INTO tasks (id, title) VALUES ($1, 'MC tarefa')`, [u('a0c6', 1)])
  const reg = async (n, raiz, when, m, decl, inS = false) => {
    await pool.query(
      `INSERT INTO task_executions (id, task_id, task_title_at_time, task_frequency_at_time, completed_at, root_tag_id)
       VALUES ($1, $2, 'MC tarefa', 'none', $3, $4)`, [u('a0c5', n), u('a0c6', 1), when && local(when), u('a0c2', raiz)])
    if (inS) await pool.query('INSERT INTO task_execution_tags VALUES ($1, $2, $3, $4)', [u('a0c5', n), u('a0c2', 11), u('a0c2', 1), u('a0c2', 1)])
    if (m) {
      await pool.query('INSERT INTO execution_measures (task_execution_id, measure_id, tag_id, root_tag_id) VALUES ($1, $2, $3, $4)',
        [u('a0c5', n), u('a0c3', m), u('a0c2', decl), u('a0c2', raiz)])
    }
  }
  const val = (n, m, k, q) => pool.query(
    'INSERT INTO execution_measure_values (task_execution_id, measure_id, kind_id, quantity) VALUES ($1, $2, $3, $4)',
    [u('a0c5', n), u('a0c3', m), k === 0 ? null : u('a0c4', k), q])
  await reg(1, 1, '2025-04-02 12:00', 1, 1); await val(1, 1, 1, 100); await val(1, 1, 2, 20)
  await reg(2, 2, '2025-04-03 12:00', 2, 2); await val(2, 2, 3, 50); await val(2, 2, 4, 10)
  await reg(7, 1, '2025-04-03 12:00', 1, 1); await val(7, 1, 1, 5)
  await reg(4, 1, '2025-04-05 12:00', 3, 11, true); await val(4, 3, 5, 7); await val(4, 3, 0, 3)
  await reg(5, 3, '2025-04-06 12:00', 4, 3); await val(5, 4, 0, 5.5)
  await reg(6, 3, '2025-04-07 12:00', 4, 3); await val(6, 4, 0, 2.25)
  await reg(11, 3, '2025-04-01 00:00', 4, 3); await val(11, 4, 0, 1)
  await reg(9, 1, null, 1, 1); await val(9, 1, 1, 999)
  await reg(10, 1, '2025-05-01 00:00', 1, 1); await val(10, 1, 1, 888)
  await reg(8, 1, '2025-05-10 12:00', 1, 1, true); await val(8, 1, 1, 4)
  await reg(13, 2, '2025-06-10 12:00', 2, 2); await val(13, 2, 3, 1); await val(13, 2, 4, 9); await val(13, 2, 0, 20) // junho: ERROS 9 > acertos 1; sem tipo 20, ainda por último
  await reg(12, 4, '2025-04-08 12:00', 0, 0) // R4: registro sem nenhum valor de medida

  const APRIL = 'R1:{Questões=125/2{Acertos=105/2;Erros=20/1};Exercícios=10/1{Leitura=7/1;(sem tipo)=3/1}} R2:{QUESTÕES=60/1{acertos=50/1;ERROS=10/1}} R3:{Km=8.75/3{}}'
  check('abril: um item por contexto, cada um com as suas medidas e tipos, sem somar entre contextos',
    (await show('2025-04-01 00:00', '2025-05-01 00:00')) === APRIL, await show('2025-04-01 00:00', '2025-05-01 00:00'))
  const raw = (await win('medidas-por-contexto', '2025-04-01 00:00', '2025-05-01 00:00')).body
  check('o contrato: items [{ tagId, measures [{ key, name, singular, total, executions, kinds }] }], tagId uuid',
    Object.keys(raw?.items?.[0] ?? {}).sort().join() === 'measures,tagId' && /^[0-9a-f-]{36}$/.test(raw.items[0].tagId) &&
      Object.keys(raw.items[0].measures[0]).sort().join() === 'executions,key,kinds,name,singular,total' && raw.items.length === 3,
    JSON.stringify(raw?.items?.[0]))
  check('as duas "Questões" de raízes diferentes são dois itens (R1 125 e R2 60), com o nome de cada um (trim)',
    raw?.items?.[0]?.measures?.[0]?.name === 'Questões' && raw.items[1].measures[0].name === 'QUESTÕES' && raw.items[1].measures[0].key === 'questões')
  check('o mesmo contexto tem duas medidas lado a lado (a da raiz e a que a subtag substitui), por total',
    raw?.items?.[0]?.measures?.map((m) => m.name).join() === 'Questões,Exercícios' && raw.items[0].measures.map((m) => m.total).join() === '125,10')
  check('R3 (Km, só sem tipo): kinds vazio; decimal 8,75 como número', raw?.items?.[2]?.measures?.[0]?.kinds?.length === 0 && raw.items[2].measures[0].total === 8.75)
  check('R4, registro sem valor de medida: não aparece', !raw?.items?.some((i) => i.tagId === u('a0c2', 4)))
  check('os itens saem na ordem do id do contexto (determinístico)', raw?.items?.map((i) => i.tagId).join() === [u('a0c2', 1), u('a0c2', 2), u('a0c2', 3)].join())

  // a soma dos contextos fecha com o período inteiro (a rota da MA1, que une as raízes pelo nome)
  const whole = (await win('medidas', '2025-04-01 00:00', '2025-05-01 00:00')).body
  const sums = {}
  for (const item of raw?.items ?? []) for (const m of item.measures) sums[m.key] = (sums[m.key] ?? 0) + m.total
  check('a soma por medida dos contextos = a do período inteiro (MA1): questões 185, exercícios 10, km 8,75',
    whole?.items?.every((m) => sums[m.key] === m.total) && Object.keys(sums).length === whole?.items?.length, JSON.stringify([sums, whole?.items?.map((m) => [m.key, m.total])]))

  check('maio: só R1 (o do instante "ate" de abril entra; pela subtag S com a medida antiga da raiz, na mesma Questões)',
    (await show('2025-05-01 00:00', '2025-06-01 00:00')) === 'R1:{Questões=892/2{Acertos=892/2}}')
  check('a ordem dos itens é a do id do contexto, não a do total (03/04: R1 tem 5, R2 tem 60, e R1 vem antes)',
    (await show('2025-04-03 00:00', '2025-04-04 00:00')) === 'R1:{Questões=5/1{Acertos=5/1}} R2:{QUESTÕES=60/1{acertos=50/1;ERROS=10/1}}')
  check('tipos por quantidade, não por nome, e o sem tipo por último mesmo sendo o maior (junho)',
    (await show('2025-06-01 00:00', '2025-07-01 00:00')) === 'R2:{QUESTÕES=30/1{ERROS=9/1;acertos=1/1;(sem tipo)=20/1}}', await show('2025-06-01 00:00', '2025-07-01 00:00'))
  check('janela só do registro da subtag: só Exercícios, em R1', (await show('2025-04-05 00:00', '2025-04-06 00:00')) === 'R1:{Exercícios=10/1{Leitura=7/1;(sem tipo)=3/1}}')
  check('janela larga: R1 tem Questões (antiga) e Exercícios (nova) sem se somar',
    (await show('2025-04-01 00:00', '2025-06-01 00:00')) === 'R1:{Questões=1017/4{Acertos=997/4;Erros=20/1};Exercícios=10/1{Leitura=7/1;(sem tipo)=3/1}} R2:{QUESTÕES=60/1{acertos=50/1;ERROS=10/1}} R3:{Km=8.75/3{}}')
  check('"de" inclusivo: o registro exatamente em "de" entra', (await show('2025-04-01 00:00', '2025-04-01 00:01')) === 'R3:{Km=1/1{}}')
  check('"ate" exclusivo: janela que acaba no instante do registro não o inclui', (await show('2025-04-30 00:00', '2025-05-01 00:00')) === '')
  check('janela que começa no instante do registro o inclui', (await show('2025-05-01 00:00', '2025-05-02 00:00')) === 'R1:{Questões=888/1{Acertos=888/1}}')
  check('registro aberto nunca entra (999)', !JSON.stringify((await win('medidas-por-contexto', '2025-01-01 00:00', '2026-01-01 00:00')).body).includes('999'))
  check('janela sem registros: lista vazia', (await win('medidas-por-contexto', '2024-01-01 00:00', '2024-02-01 00:00')).body?.items?.length === 0)

  // validações do período (as do readPeriod)
  const iso = (a) => local(a).toISOString()
  const bad = async (params) => (await get('medidas-por-contexto', params)).status
  check('sem período: 400', (await bad({})) === 400)
  check('de depois de ate: 400', (await bad({ de: iso('2025-05-01 00:00'), ate: iso('2025-04-01 00:00'), fuso: FUSO })) === 400)
  check('fuso desconhecido: 400', (await bad({ de: iso('2025-04-01 00:00'), ate: iso('2025-05-01 00:00'), fuso: 'Marte/Olimpo' })) === 400)
  check('sem fuso: 400', (await bad({ de: iso('2025-04-01 00:00'), ate: iso('2025-05-01 00:00') })) === 400)
  check('mais de 1 ano: 400', (await bad({ de: iso('2023-01-01 00:00'), ate: iso('2025-01-01 00:00'), fuso: FUSO })) === 400)
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false, String(err.stack).split(String.fromCharCode(10)).slice(0, 3).join(' | '))
} finally {
  await cleanup()
  const left = await pool.query(`SELECT (SELECT count(*) FROM measures WHERE id::text LIKE '00000000-0000-4000-a0c3-%')::int + (SELECT count(*) FROM tags WHERE id::text LIKE '00000000-0000-4000-a0c2-%')::int + (SELECT count(*) FROM task_executions WHERE id::text LIKE '00000000-0000-4000-a0c5-%')::int + (SELECT count(*) FROM tasks WHERE id = '${u('a0c6', 1)}')::int AS n`)
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
