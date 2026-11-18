// Painel, medidas (MA1): GET /dashboard/medidas. Abril e maio de 2025 (o seed nunca cai lá), dados
// próprios inseridos no banco e apagados no fim; as contas à mão são as de tests/banco/medidas-cases.sql.
// Regras: data = completed_at do REGISTRO em [de, ate), aberto fora; a medida é a gravada no registro;
// medidas e tipos agrupam por nome normalizado; nome mostrado = o do registro mais recente (empate:
// id maior); kinds só existe se algum valor do grupo tem tipo, e os sem tipo são uma linha.
// Uso (raiz do repo): node --env-file=backend/.env tests/api/medidas-painel-test.mjs
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
async function get(params) {
  const res = await apiFetch(`${API}/dashboard/medidas?${new URLSearchParams(params)}`)
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { /* resposta que não é JSON */ }
  return { status: res.status, body }
}
const window = (a, b) => get({ de: local(a).toISOString(), ate: local(b).toISOString(), fuso: FUSO })
// "Nome=total/registros{tipo=qtd/registros;...}", a ordem da rota
const txt = (items) => items.map((m) => `${m.name}=${m.total}/${m.executions}{${m.kinds.map((k) => `${k.name ?? '(sem tipo)'}=${k.quantity}/${k.executions}`).join(';')}}`).join(' ')
const show = async (a, b) => { const r = await window(a, b); return r.status === 200 ? txt(r.body.items) : `status ${r.status}` }
async function patch(path, body) {
  const res = await apiFetch(API + path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return res.status
}

async function cleanup() {
  const ex = `task_execution_id::text LIKE '00000000-0000-4000-a0e5-%'`
  await pool.query(`DELETE FROM execution_measure_values WHERE ${ex}`)
  await pool.query(`DELETE FROM execution_measures WHERE ${ex}`)
  await pool.query(`DELETE FROM task_execution_tags WHERE ${ex}`)
  await pool.query(`DELETE FROM task_executions WHERE id::text LIKE '00000000-0000-4000-a0e5-%'`)
  await pool.query(`DELETE FROM measure_kinds WHERE id::text LIKE '00000000-0000-4000-a0e4-%'`)
  await pool.query(`DELETE FROM measures WHERE id::text LIKE '00000000-0000-4000-a0e3-%'`)
  await pool.query(`DELETE FROM tags WHERE id::text LIKE '00000000-0000-4000-a0e2-%' AND level = 2`)
  await pool.query(`DELETE FROM tags WHERE id::text LIKE '00000000-0000-4000-a0e2-%'`)
  await pool.query(`DELETE FROM tasks WHERE id = $1`, [u('a0e6', 1)])
}

try {
  await cleanup()
  // R1, R2, R3 (raízes), S (nível 2 sob R1). M1 em R1 "Questões" (Acertos, Erros); M2 em R2 "QUESTÕES "
  // (mesmo nome, outra grafia; acertos, ERROS); M3 em S "Exercícios" (Leitura); M4 em R3 "Km" (decimal)
  await pool.query(`INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
    ($1, 'MA R1', 1, NULL, NULL), ($2, 'MA R2', 1, NULL, NULL), ($3, 'MA R3', 1, NULL, NULL)`, [u('a0e2', 1), u('a0e2', 2), u('a0e2', 3)])
  await pool.query(`INSERT INTO tags (id, name, level, parent_id, root_id) VALUES ($1, 'MA R4', 1, NULL, NULL), ($2, 'MA R5', 1, NULL, NULL)`, [u('a0e2', 4), u('a0e2', 5)])
  await pool.query(`INSERT INTO tags (id, name, level, parent_id, root_id) VALUES ($1, 'MA S', 2, $2, $2)`, [u('a0e2', 11), u('a0e2', 1)])
  await pool.query(`INSERT INTO measures (id, tag_id, name, singular, allows_decimal) VALUES
    ($1, $5, 'Questões', 'questão', false), ($2, $6, 'QUESTÕES ', 'questão', false),
    ($3, $7, 'Exercícios', 'exercício', false), ($4, $8, 'Km', 'km', true)`,
  [u('a0e3', 1), u('a0e3', 2), u('a0e3', 3), u('a0e3', 4), u('a0e2', 1), u('a0e2', 2), u('a0e2', 11), u('a0e2', 3)])
  await pool.query(`INSERT INTO measure_kinds (id, measure_id, name) VALUES
    ($1, $6, 'Acertos'), ($2, $6, 'Erros'), ($3, $7, 'acertos'), ($4, $7, 'ERROS'), ($5, $8, 'Leitura')`,
  [u('a0e4', 1), u('a0e4', 2), u('a0e4', 3), u('a0e4', 4), u('a0e4', 5), u('a0e3', 1), u('a0e3', 2), u('a0e3', 3)])
  // Julho: M5 em R4 "Peso" (tipos Alfa, Beta) e M6 em R5 "PESO" (alfa, beta): mesmo nome, outra grafia
  await pool.query(`INSERT INTO measures (id, tag_id, name, singular) VALUES ($1, $3, 'Peso', 'peso'), ($2, $4, 'PESO', 'peso')`,
    [u('a0e3', 5), u('a0e3', 6), u('a0e2', 4), u('a0e2', 5)])
  await pool.query(`INSERT INTO measure_kinds (id, measure_id, name) VALUES ($1, $5, 'Alfa'), ($2, $5, 'Beta'), ($3, $6, 'alfa'), ($4, $6, 'beta')`,
    [u('a0e4', 6), u('a0e4', 7), u('a0e4', 8), u('a0e4', 9), u('a0e3', 5), u('a0e3', 6)])
  await pool.query(`INSERT INTO tasks (id, title) VALUES ($1, 'MA tarefa')`, [u('a0e6', 1)])
  const reg = async (n, raiz, when, m, decl, inS = false) => {
    await pool.query(
      `INSERT INTO task_executions (id, task_id, task_title_at_time, task_frequency_at_time, completed_at, root_tag_id)
       VALUES ($1, $2, 'MA tarefa', 'none', $3, $4)`, [u('a0e5', n), u('a0e6', 1), when && local(when), u('a0e2', raiz)])
    if (inS) await pool.query('INSERT INTO task_execution_tags VALUES ($1, $2, $3, $4)', [u('a0e5', n), u('a0e2', 11), u('a0e2', 1), u('a0e2', 1)])
    await pool.query('INSERT INTO execution_measures (task_execution_id, measure_id, tag_id, root_tag_id) VALUES ($1, $2, $3, $4)',
      [u('a0e5', n), u('a0e3', m), u('a0e2', decl), u('a0e2', raiz)])
  }
  const val = (n, m, k, q) => pool.query(
    'INSERT INTO execution_measure_values (task_execution_id, measure_id, kind_id, quantity) VALUES ($1, $2, $3, $4)',
    [u('a0e5', n), u('a0e3', m), k === 0 ? null : u('a0e4', k), q])
  await reg(1, 1, '2025-04-02 12:00', 1, 1); await val(1, 1, 1, 100); await val(1, 1, 2, 20)
  await reg(2, 2, '2025-04-03 12:00', 2, 2); await val(2, 2, 3, 50); await val(2, 2, 4, 10)
  await reg(7, 1, '2025-04-03 12:00', 1, 1); await val(7, 1, 1, 5) // mesmo instante do 2, id maior
  await reg(4, 1, '2025-04-05 12:00', 3, 11, true); await val(4, 3, 5, 7); await val(4, 3, 0, 3)
  await reg(5, 3, '2025-04-06 12:00', 4, 3); await val(5, 4, 0, 5.5)
  await reg(6, 3, '2025-04-07 12:00', 4, 3); await val(6, 4, 0, 2.25)
  await reg(11, 3, '2025-04-01 00:00', 4, 3); await val(11, 4, 0, 1) // exatamente em "de"
  await reg(9, 1, null, 1, 1); await val(9, 1, 1, 999) // aberto
  await reg(10, 1, '2025-05-01 00:00', 1, 1); await val(10, 1, 1, 888) // exatamente em "ate" de abril
  await reg(8, 1, '2025-05-10 12:00', 1, 1, true); await val(8, 1, 1, 4) // mesma tag S do 4, medida antiga da raiz

  // Empate no mesmo instante, inserido na ordem OPOSTA à do 2 e 7 de abril (o de id maior primeiro):
  // o nome vem do id maior (o 13) venha a linha na ordem que vier. Beta 9 > Alfa 1 + 2 = 3 na ordem
  // por quantidade (a alfabética daria Alfa antes)
  await reg(13, 4, '2025-07-10 12:00', 5, 4); await val(13, 5, 6, 1); await val(13, 5, 7, 9)
  await reg(12, 5, '2025-07-10 12:00', 6, 5); await val(12, 6, 8, 2); await val(12, 6, 0, 20) // sem tipo maior que os tipos: ainda por último

  const APRIL = 'Questões=185/3{Acertos=155/3;ERROS=30/2} Exercícios=10/1{Leitura=7/1;(sem tipo)=3/1} Km=8.75/3{}'
  check('abril: três blocos, ordem pelo total, nome pelo mais recente (empate: id maior), soma por tipo',
    (await show('2025-04-01 00:00', '2025-05-01 00:00')) === APRIL, await show('2025-04-01 00:00', '2025-05-01 00:00'))
  const raw = (await window('2025-04-01 00:00', '2025-05-01 00:00')).body
  check('o contrato: key, name, singular, total, executions, kinds (key e name nulos no sem tipo)',
    raw?.items?.[0]?.key === 'questões' && raw.items[0].singular === 'questão' && typeof raw.items[0].total === 'number' &&
      raw.items[1].kinds.at(-1).key === null && raw.items[1].kinds.at(-1).name === null && Object.keys(raw.items[0]).sort().join() === 'executions,key,kinds,name,singular,total',
    JSON.stringify(raw?.items?.[0]))
  check('Km, só sem tipo: kinds vazio (sem tabela, só o total)', raw?.items?.[2]?.kinds?.length === 0, JSON.stringify(raw?.items?.[2]))
  check('Exercícios: a soma das linhas (7 + 3) fecha com o total (10)',
    raw?.items?.[1]?.kinds?.reduce((s, k) => s + k.quantity, 0) === raw?.items?.[1]?.total)
  check('decimal: 5,5 + 2,25 + 1 = 8,75, número (não texto)', raw?.items?.[2]?.total === 8.75, JSON.stringify(raw?.items?.[2]?.total))
  check('maio: só Questões (o do instante "ate" de abril entra; a mesma tag S com a medida antiga)',
    (await show('2025-05-01 00:00', '2025-06-01 00:00')) === 'Questões=892/2{Acertos=892/2}')
  check('janela só do registro novo da tag S: só Exercícios',
    (await show('2025-04-05 00:00', '2025-04-06 00:00')) === 'Exercícios=10/1{Leitura=7/1;(sem tipo)=3/1}')
  check('os dois registros da MESMA tag S, medidas diferentes, em janela larga: dois blocos, sem somar',
    (await show('2025-04-01 00:00', '2025-06-01 00:00')) === 'Questões=1077/5{Acertos=1047/5;ERROS=30/2} Exercícios=10/1{Leitura=7/1;(sem tipo)=3/1} Km=8.75/3{}')
  check('empate no mesmo instante (id maior inserido primeiro): nome e tipo do id maior; tipos por quantidade, não por nome',
    (await show('2025-07-01 00:00', '2025-08-01 00:00')) === 'Peso=32/2{Beta=9/1;Alfa=3/2;(sem tipo)=20/1}', await show('2025-07-01 00:00', '2025-08-01 00:00'))
  check('"de" inclusivo: o registro exatamente em "de" entra', (await show('2025-04-01 00:00', '2025-04-01 00:01')) === 'Km=1/1{}')
  check('"ate" exclusivo: janela que acaba no instante do registro não o inclui', (await show('2025-04-30 00:00', '2025-05-01 00:00')) === '')
  check('janela que começa no instante do registro o inclui', (await show('2025-05-01 00:00', '2025-05-02 00:00')) === 'Questões=888/1{Acertos=888/1}')
  check('registro aberto nunca entra (999)', !JSON.stringify((await window('2025-01-01 00:00', '2026-01-01 00:00')).body).includes('999'))
  check('janela sem registros: lista vazia', (await window('2024-01-01 00:00', '2024-02-01 00:00')).body?.items?.length === 0)

  // comportamento atual (pode mudar com aviso ou alias futuro): o nome é lido da medida de hoje
  const renamed = await patch(`/measures/${u('a0e3', 3)}`, { name: 'questões' })
  check('comportamento atual (pode mudar com aviso ou alias futuro): renomear a medida reagrupa o passado (Exercícios passa a somar em Questões)',
    renamed === 200 && (await show('2025-04-01 00:00', '2025-05-01 00:00')) === 'questões=195/4{Acertos=155/3;ERROS=30/2;Leitura=7/1;(sem tipo)=3/1} Km=8.75/3{}',
    await show('2025-04-01 00:00', '2025-05-01 00:00'))
  await patch(`/measures/${u('a0e3', 3)}`, { name: 'Exercícios' })
  const kindRenamed = await patch(`/measure-kinds/${u('a0e4', 5)}`, { name: 'Escrita' })
  check('comportamento atual (pode mudar com aviso ou alias futuro): renomear um tipo muda o rótulo do passado',
    kindRenamed === 200 && (await show('2025-04-05 00:00', '2025-04-06 00:00')) === 'Exercícios=10/1{Escrita=7/1;(sem tipo)=3/1}',
    await show('2025-04-05 00:00', '2025-04-06 00:00'))
  await patch(`/measure-kinds/${u('a0e4', 5)}`, { name: 'Leitura' })
  check('as quantidades não mudam ao renomear (só o rótulo)', (await show('2025-04-01 00:00', '2025-05-01 00:00')) === APRIL)

  // validações do período (as do readPeriod)
  const iso = (a) => local(a).toISOString()
  const bad = async (params) => (await get(params)).status
  check('sem período: 400', (await bad({})) === 400)
  check('de depois de ate: 400', (await bad({ de: iso('2025-05-01 00:00'), ate: iso('2025-04-01 00:00'), fuso: FUSO })) === 400)
  check('fuso desconhecido: 400', (await bad({ de: iso('2025-04-01 00:00'), ate: iso('2025-05-01 00:00'), fuso: 'Marte/Olimpo' })) === 400)
  check('sem fuso: 400', (await bad({ de: iso('2025-04-01 00:00'), ate: iso('2025-05-01 00:00') })) === 400)
  check('mais de 1 ano: 400', (await bad({ de: iso('2023-01-01 00:00'), ate: iso('2025-01-01 00:00'), fuso: FUSO })) === 400)
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false, String(err.stack).split(String.fromCharCode(10)).slice(0, 3).join(' | '))
} finally {
  await cleanup()
  const left = await pool.query(`SELECT (SELECT count(*) FROM measures WHERE id::text LIKE '00000000-0000-4000-a0e3-%')::int + (SELECT count(*) FROM tags WHERE id::text LIKE '00000000-0000-4000-a0e2-%')::int + (SELECT count(*) FROM task_executions WHERE id::text LIKE '00000000-0000-4000-a0e5-%')::int AS n`)
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
