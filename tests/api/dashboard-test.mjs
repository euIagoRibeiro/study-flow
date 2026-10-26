// D2: as 4 rotas de tempo do Dashboard (D5a: por=mes; D7a: tempo-por-tags). Dados próprios em março de 2025 (os
// do D-0, sem a sessão rodando: o índice "uma rodando no app" não deixa
// outra com a do seed aberta), inseridos no banco e apagados no finally.
// A rodando é testada com a do seed; e uma janela do seed (semanas 7–12,
// só o bloco D1 tem Vestibular lá) confere a rota contra a conta do seed.
import pg from 'pg'
import { API } from '../config.mjs'
const { Pool } = pg

if (!process.env.DATABASE_URL) throw new Error('rodar com --env-file=../backend/.env (npm run api)')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const FUSO = 'America/Sao_Paulo'
const A = '00000000-0000-4000-a0d0-00000000000a', B = '00000000-0000-4000-a0d0-00000000000b'
const A1 = '00000000-0000-4000-a0d0-0000000000a1', A2 = '00000000-0000-4000-a0d0-0000000000a2'
const B1 = '00000000-0000-4000-a0d0-0000000000b1', A11 = '00000000-0000-4000-a0d0-000000000a11'
const B2 = '00000000-0000-4000-a0d0-0000000000b2' // arquivada (D7a)
const TASK = '00000000-0000-4000-a0d0-000000000001'
const VESTIBULAR = '5eed0000-0000-4000-9000-000000000100'
const MATEMATICA = '5eed0000-0000-4000-9000-000000000110', FISICA = '5eed0000-0000-4000-9000-000000000120'
const MATEMATICA_RAIZ = '5eed0000-0000-4000-9000-000000000200'
const id = (n) => `00000000-0000-4000-a0d1-${String(n).padStart(12, '0')}`
// Hora local de Brasília (-03, sem horário de verão desde 2019) → instante
const local = (t) => new Date(`${t.replace(' ', 'T')}:00-03:00`).toISOString()

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
async function get(route, params) {
  const res = await fetch(`${API}/dashboard/${route}?${new URLSearchParams(params)}`)
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { /* rota inexistente: HTML do Express */ }
  return { status: res.status, body }
}
const min = (s) => Math.round(s / 60)
// "tag=min" ordenado, pra comparar com a conta à mão
const list = (items, key, name = (v) => v) => items.map((x) => `${x[key] === null ? 'sem' : name(x[key])}=${min(x.seconds)}`).sort().join(' ')
const short = (v) => v.slice(-2)

async function cleanup() {
  await pool.query(`DELETE FROM time_entries WHERE task_execution_id::text LIKE '00000000-0000-4000-a0d1-%'`)
  await pool.query(`DELETE FROM task_execution_tags WHERE task_execution_id::text LIKE '00000000-0000-4000-a0d1-%'`)
  await pool.query(`DELETE FROM task_executions WHERE id::text LIKE '00000000-0000-4000-a0d1-%'`)
  await pool.query(`DELETE FROM tags WHERE id::text LIKE '00000000-0000-4000-a0d0-%' AND level = 3`)
  await pool.query(`DELETE FROM tags WHERE id::text LIKE '00000000-0000-4000-a0d0-%' AND level = 2`)
  await pool.query(`DELETE FROM tags WHERE id::text LIKE '00000000-0000-4000-a0d0-%'`)
  await pool.query(`DELETE FROM tasks WHERE id = $1`, [TASK])
}

try {
  await cleanup() // rodada anterior interrompida
  // ---- dados (os do D-0, sem a rodando)
  await pool.query(`INSERT INTO tags (id, name, level, parent_id, root_id, tracks_phase) VALUES
    ($1, 'D2 contexto A', 1, NULL, NULL, true), ($2, 'D2 contexto B', 1, NULL, NULL, false)`, [A, B])
  await pool.query(`INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
    ($1, 'A1', 2, $4, $4), ($2, 'A2', 2, $4, $4), ($3, 'B1', 2, $5, $5)`, [A1, A2, B1, A, B])
  await pool.query(`INSERT INTO tags (id, name, level, parent_id, root_id) VALUES ($1, 'A11', 3, $2, $3)`, [A11, A1, A])
  await pool.query(`INSERT INTO tasks (id, title) VALUES ($1, 'D2 tarefa')`, [TASK])
  const reg = (n, root, phase, links = []) => pool.query(
    `INSERT INTO task_executions (id, task_id, task_title_at_time, task_frequency_at_time, completed_at, root_tag_id, phase)
     VALUES ($1, $2, 'D2 tarefa', 'none', $3, $4, $5)`, [id(n), TASK, local('2025-04-02 12:00'), root, phase])
    .then(() => Promise.all(links.map(([tag, parent]) => pool.query('INSERT INTO task_execution_tags VALUES ($1, $2, $3, $4)', [id(n), tag, parent, root]))))
  const sess = (n, ini, fim, est = false) => pool.query(
    'INSERT INTO time_entries (task_execution_id, started_at, ended_at, estimated) VALUES ($1, $2, $3, $4)', [id(n), local(ini), local(fim), est])
  await reg(1, A, 'requisitos', [[A1, A], [A11, A1]]); await sess(1, '2025-03-24 22:00', '2025-03-24 23:30')
  await reg(2, A, 'prototipo', [[A1, A]]); await sess(2, '2025-03-25 23:00', '2025-03-26 01:00')
  await reg(3, A, null); await sess(3, '2025-03-26 10:00', '2025-03-26 11:00')
  await reg(4, B, null, [[B1, B]]); await sess(4, '2025-03-26 10:30', '2025-03-26 11:30')
  await reg(5, null, null); await sess(5, '2025-03-27 19:15', '2025-03-27 20:00', true)
  await reg(6, A, 'requisitos', [[A2, A]]); await sess(6, '2025-03-23 23:00', '2025-03-24 01:00')
  await reg(7, B, null); await sess(7, '2025-03-30 23:30', '2025-03-31 00:30')
  await reg(8, B, null); await sess(8, '2025-03-31 23:00', '2025-04-01 01:00')
  await reg(10, B, null); await sess(10, '2025-03-03 19:00', '2025-03-03 20:00')
  await reg(11, B, null); await sess(11, '2025-02-28 23:00', '2025-03-01 01:00')
  // D7a, numa semana de 2023 que nada mais confere: registro SÓ com a ligação
  // de nível 3, sem o pai (o banco aceita; a rota não pode depender do
  // fechamento), e uma tag arquivada usada
  await pool.query(`INSERT INTO tags (id, name, level, parent_id, root_id, active) VALUES ($1, 'B2 arquivada', 2, $2, $2, false)`, [B2, B])
  await reg(12, A, null, [[A11, A1]]); await sess(12, '2023-06-12 10:00', '2023-06-12 10:10')
  await reg(13, B, null, [[B2, B]]); await sess(13, '2023-06-13 10:00', '2023-06-13 10:20')

  const semana = { de: local('2025-03-24 00:00'), ate: local('2025-03-31 00:00'), fuso: FUSO }
  const marco = { de: local('2025-03-01 00:00'), ate: local('2025-04-01 00:00'), fuso: FUSO }

  // ---- validação
  const bad = async (name, route, params, text) => {
    const r = await get(route, params)
    check(name, r.status === 400 && (!text || r.body?.error?.includes(text)), `${r.status} ${JSON.stringify(r.body)}`)
  }
  await bad('sem fuso: 400', 'tempo-por-contexto', { de: semana.de, ate: semana.ate }, 'fuso')
  await bad('fuso que não existe: 400 "Fuso desconhecido"', 'tempo-por-contexto', { ...semana, fuso: 'Marte/Olimpo' }, 'Fuso desconhecido')
  await bad('de sem fuso/offset: 400', 'tempo-por-contexto', { ...semana, de: '2025-03-24T00:00:00' }, 'de')
  await bad('de depois do até: 400', 'tempo-por-contexto', { ...semana, de: semana.ate, ate: semana.de }, 'antes')
  await bad('intervalo de mais de 1 ano: 400', 'tempo-por-contexto', { ...semana, de: local('2024-01-01 00:00') }, '1 ano')
  await bad('subtag sem contexto: 400', 'tempo-por-subtag', semana, 'contexto')
  await bad('subtag com contexto que é subtag (nível 2): 400', 'tempo-por-subtag', { ...semana, contexto: A1 }, 'contexto')
  await bad('fase em contexto sem fases: 400', 'tempo-por-fase', { ...semana, contexto: B }, 'fases')
  await bad('período sem "por": 400', 'tempo-por-periodo', semana, 'por')
  await bad('período com "por=ano": 400 (dia, semana ou mês)', 'tempo-por-periodo', { ...semana, por: 'ano' }, 'por')
  await bad('tags ausente: 400', 'tempo-por-tags', semana, 'tags')
  await bad('tags vazio: 400', 'tempo-por-tags', { ...semana, tags: '' }, 'tags')
  await bad('tags com algo que não é uuid: 400', 'tempo-por-tags', { ...semana, tags: `${A},xyz` }, 'tags')
  await bad('tags repetida: 400', 'tempo-por-tags', { ...semana, tags: `${A},${A1},${A}` }, 'repet')
  await bad('6 tags: 400 (no máximo 5)', 'tempo-por-tags', { ...semana, tags: [A, B, A1, A2, B1, A11].join(',') }, '5')
  const nt = await get('tempo-por-tags', { ...semana, tags: `${A},00000000-0000-4000-a0d0-0000000000ff` })
  check('tags com uma que não existe: 404', nt.status === 404, `${nt.status} ${JSON.stringify(nt.body)}`)
  const nf = await get('tempo-por-subtag', { ...semana, contexto: '00000000-0000-4000-a0d0-0000000000ff' })
  check('contexto que não existe: 404', nf.status === 404, `${nf.status}`)

  // ---- semana 24–30/03 (a conta do D-0 sem a rodando: 705 − 240 = 465)
  let r = await get('tempo-por-contexto', semana)
  check('contexto: 200, total 465 min', r.status === 200 && min(r.body.totalSeconds) === 465, `${r.status} ${JSON.stringify(r.body)}`)
  check('contexto: A 330, B 90, (sem tag) 45', list(r.body.items ?? [], 'tagId', short) === '0a=330 0b=90 sem=45', list(r.body.items ?? [], 'tagId', short))
  check('contexto: itens fecham com o total', r.body.items?.reduce((s, x) => s + x.seconds, 0) === r.body.totalSeconds)
  check('contexto: sobreposição no período (3 e 4 na quarta)', r.body.overlap === true)
  check('contexto: nenhuma rodando no período', Array.isArray(r.body.running) && r.body.running.length === 0, JSON.stringify(r.body.running))
  r = await get('tempo-por-subtag', { ...semana, contexto: A })
  check('subtag de A: A1 210 (registro com A1 e A11 conta UMA vez), A2 60, (sem subtag) 60', list(r.body.items ?? [], 'tagId', short) === 'a1=210 a2=60 sem=60', list(r.body.items ?? [], 'tagId', short))
  r = await get('tempo-por-fase', { ...semana, contexto: A })
  check('fase de A: requisitos 150, protótipo 120, (sem fase) 60', list(r.body.items ?? [], 'phase') === 'prototipo=120 requisitos=150 sem=60', list(r.body.items ?? [], 'phase'))
  r = await get('tempo-por-periodo', { ...semana, por: 'dia' })
  const days = (r.body.items ?? []).map((x) => `${x.start.slice(8)}=${min(x.seconds)}`).join(' ')
  check('período por dia, no fuso: 24=150 (a das 22h na segunda) 25=60 26=180 (meia-noite dividida) 27=45 28=0 29=0 30=30', days === '24=150 25=60 26=180 27=45 28=0 29=0 30=30', days)
  r = await get('tempo-por-periodo', { ...semana, por: 'dia', fuso: 'UTC' })
  const utc = (r.body.items ?? []).find((x) => x.start === '2025-03-24')
  check('o fuso muda as faixas: em UTC, a segunda tem só 60 (a das 22h vira terça)', r.status === 200 && min(utc?.seconds ?? -1) === 60, JSON.stringify(r.body.items?.slice(0, 2)))
  r = await get('tempo-por-contexto', { ...semana, ate: local('2025-03-26 12:00') })
  check('"até" no meio da semana ("como estava"): A 330, B 60', list(r.body.items ?? [], 'tagId', short) === '0a=330 0b=60', list(r.body.items ?? [], 'tagId', short))
  r = await get('tempo-por-periodo', { ...marco, por: 'semana' })
  const weeks = (r.body.items ?? []).map((x) => `${x.start.slice(8)}/${x.start.slice(5, 7)}=${min(x.seconds)}`).join(' ')
  check('março por semana (segunda): 24/02=60 03/03=60 10/03=0 17/03=60 24/03=465 31/03=90', weeks === '24/02=60 03/03=60 10/03=0 17/03=60 24/03=465 31/03=90', weeks)
  r = await get('tempo-por-contexto', marco)
  check('março: total 735 (bordas do mês recortadas)', min(r.body.totalSeconds ?? -1) === 735, JSON.stringify(r.body.totalSeconds))

  // ---- tempo por tags (D7a): a conta da semana (sem a rodando)
  // A: 1 (A1+A11) 90, 2 (A1) 120, 3 60, 6 (A2) 60 dentro = 330; A1 = 210;
  // A11 = 90; A2 = 60; B = 90 (4 B1 60 + 7 30 dentro); B1 = 60
  const tagsOf = (body) => (body?.items ?? []).map((x) => `${short(x.tagId)}=${min(x.seconds)}`).join(' ')
  r = await get('tempo-por-tags', { ...semana, tags: `${A11},${B1}` })
  check('tags de raízes diferentes (as "duas Álgebras"): A11 90, B1 60, na ordem pedida', r.status === 200 && tagsOf(r.body) === '11=90 b1=60', `${r.status} ${JSON.stringify(r.body)}`)
  check('tags de raízes diferentes: união 150 = soma', min(r.body?.unionSeconds ?? -1) === 150, JSON.stringify(r.body?.unionSeconds))
  r = await get('tempo-por-tags', { ...semana, tags: `${B1},${A}` })
  check('ordem dos itens = ordem pedida (B1 antes de A)', tagsOf(r.body) === 'b1=60 0a=330', tagsOf(r.body))
  r = await get('tempo-por-tags', { ...semana, tags: `${A},${A1}` })
  check('aninhadas (A e A1): cada uma certa, A 330 e A1 210 (o registro com A1 e A11 conta UMA vez)', tagsOf(r.body) === '0a=330 a1=210', tagsOf(r.body))
  check('aninhadas: união 330, não 540', min(r.body?.unionSeconds ?? -1) === 330, JSON.stringify(r.body?.unionSeconds))
  r = await get('tempo-por-tags', { ...semana, tags: `${A},${B}` })
  const ctx = await get('tempo-por-contexto', semana)
  check('contexto escolhido = a regra exata por contexto (A 330, B 90)', tagsOf(r.body) === '0a=330 0b=90' &&
    ctx.body.items.find((x) => x.tagId === A)?.seconds === r.body.items[0].seconds, tagsOf(r.body))
  r = await get('tempo-por-tags', { ...semana, ate: local('2025-03-25 12:00'), tags: `${A},${A1}` })
  check('"até" ter 12:00: A 150 (1 e o pedaço da 6), A1 90', tagsOf(r.body) === '0a=150 a1=90', tagsOf(r.body))
  const junho23 = { de: local('2023-06-12 00:00'), ate: local('2023-06-19 00:00'), fuso: FUSO }
  r = await get('tempo-por-tags', { ...junho23, tags: `${A1},${A11}` })
  check('registro SÓ com o nível 3 (sem o pai gravado): conta no pai, A1 10 e A11 10', tagsOf(r.body) === 'a1=10 11=10', tagsOf(r.body))
  r = await get('tempo-por-tags', { ...junho23, tags: `${B2},${A2}` })
  check('tag arquivada aceita (B2 20); escolhida sem tempo aparece com 0 (A2)', r.status === 200 && tagsOf(r.body) === 'b2=20 a2=0', `${r.status} ${tagsOf(r.body)}`)
  check('união de B2 e A2 = 20', min(r.body?.unionSeconds ?? -1) === 20, JSON.stringify(r.body?.unionSeconds))

  // ---- ano por mês (D5a): faixas de 1 mês no fuso. A 11 (28/02 23:00 → 01/03
  // 01:00) divide entre fevereiro e março; a 8 (31/03 23:00 → 01/04 01:00),
  // entre março e abril. Março = 735 (a conta do mês acima)
  const ano = { de: local('2025-01-01 00:00'), ate: local('2026-01-01 00:00'), fuso: FUSO, por: 'mes' }
  r = await get('tempo-por-periodo', ano)
  const months = (r.body?.items ?? []).map((x) => `${x.start.slice(5, 7)}=${min(x.seconds)}`).join(' ')
  check('ano por mês: 12 faixas, 01=0 02=60 03=735 04=60, o resto 0', r.status === 200 &&
    months === '01=0 02=60 03=735 04=60 05=0 06=0 07=0 08=0 09=0 10=0 11=0 12=0', `${r.status} ${months} ${JSON.stringify(r.body)}`)
  check('ano por mês: cada faixa começa no dia 1', (r.body?.items ?? []).length === 12 && r.body.items.every((x) => x.start.endsWith('-01')), JSON.stringify(r.body?.items?.map((x) => x.start)))
  const yearTotal = await get('tempo-por-contexto', ano)
  check('ano: soma das faixas = total do contexto (855)', min(yearTotal.body?.totalSeconds ?? -1) === 855 &&
    (r.body?.items ?? []).reduce((s, x) => s + x.seconds, 0) === yearTotal.body.totalSeconds, `${yearTotal.body?.totalSeconds}`)
  r = await get('tempo-por-periodo', { ...ano, fuso: 'UTC' })
  const utcMonths = Object.fromEntries((r.body?.items ?? []).map((x) => [x.start.slice(5, 7), min(x.seconds)]))
  check('ano por mês em UTC: a 11 cai toda em março (02=0) e a 8 toda em abril (04=120)', r.status === 200 && utcMonths['02'] === 0 && utcMonths['04'] === 120, JSON.stringify(utcMonths))
  r = await get('tempo-por-periodo', { de: local('2024-01-01 00:00'), ate: local('2025-01-01 00:00'), fuso: FUSO, por: 'mes' })
  check('ano bissexto (366 dias) aceito: 12 faixas vazias, 0', r.status === 200 && r.body.items.length === 12 && r.body.items.every((x) => x.seconds === 0), `${r.status} ${JSON.stringify(r.body)}`)

  // ---- a rodando do seed: "até" depois dela conta até agora; antes, até o "até"
  const running = (await (await fetch(`${API}/time-entries`)).json()).find((e) => e.endedAt === null)
  if (!running) throw new Error('o seed não tem sessão rodando (reseed?)')
  const started = new Date(running.startedAt)
  r = await get('tempo-por-contexto', { de: new Date(started - 3600e3).toISOString(), ate: new Date(Date.now() + 3600e3).toISOString(), fuso: FUSO })
  const run = r.body.running?.find((x) => x.timeEntryId === running.id)
  const sinceStart = (Date.now() - started) / 1000
  check('rodando: aparece na lista, com a tarefa e o tempo até agora', run && run.taskTitle === 'Revisar inglês' && Math.abs(run.seconds - sinceStart) < 5 && run.startedAt === running.startedAt, JSON.stringify(run))
  r = await get('tempo-por-contexto', { de: new Date(started - 3600e3).toISOString(), ate: new Date(started.getTime() + 600e3).toISOString(), fuso: FUSO })
  const ran = r.body.running?.find((x) => x.timeEntryId === running.id)
  check('rodando com "até" 10 min depois do início: conta 10 min ("como estava")', ran?.seconds === 600, JSON.stringify(ran))

  // ---- janela do seed: semanas 7–12 antes da atual (só o bloco D1 tem Vestibular lá)
  const now = new Date()
  const mondayLocal = new Date(now.toLocaleString('en-US', { timeZone: FUSO }))
  mondayLocal.setHours(0, 0, 0, 0)
  mondayLocal.setDate(mondayLocal.getDate() - ((mondayLocal.getDay() + 6) % 7))
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const minus = (weeks) => { const d = new Date(mondayLocal); d.setDate(d.getDate() - 7 * weeks); return local(`${ymd(d)} 00:00`) }
  r = await get('tempo-por-subtag', { de: minus(12), ate: minus(6), fuso: FUSO, contexto: VESTIBULAR })
  const vest = list(r.body.items ?? [], 'tagId', (t) => (t === MATEMATICA ? 'Matemática' : t === FISICA ? 'Física' : t))
  check('seed, semanas 7–12: Vestibular por subtag = Física 300, Matemática 540 (conta do D1)', vest === 'Física=300 Matemática=540', vest)
  // D7a contra as rotas que já existem, na mesma janela do seed
  const janela = { de: minus(12), ate: minus(6), fuso: FUSO }
  const porTags = await get('tempo-por-tags', { ...janela, tags: `${MATEMATICA},${MATEMATICA_RAIZ},${VESTIBULAR}` })
  const porSubtag = r.body.items.find((x) => x.tagId === MATEMATICA)?.seconds
  const porContexto = (await get('tempo-por-contexto', janela)).body.items
  const ctxOf = (id) => porContexto.find((x) => x.tagId === id)?.seconds ?? 0
  check('seed: Vestibular › Matemática por tags = por subtag (540 min)', porTags.body?.items?.[0]?.seconds === porSubtag && min(porSubtag) === 540, JSON.stringify(porTags.body))
  check('seed: Matemática (raiz) e Vestibular por tags = por contexto', porTags.body?.items?.[1]?.seconds === ctxOf(MATEMATICA_RAIZ) && porTags.body?.items?.[2]?.seconds === ctxOf(VESTIBULAR), JSON.stringify(porTags.body?.items))
  check('seed: união (Vestibular contém Vestibular › Matemática) = Vestibular + Matemática raiz', porTags.body?.unionSeconds === ctxOf(VESTIBULAR) + ctxOf(MATEMATICA_RAIZ), `${porTags.body?.unionSeconds}`)
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await cleanup()
  const left = (await pool.query(`SELECT (SELECT count(*) FROM task_executions WHERE id::text LIKE '00000000-0000-4000-a0d1-%')
    + (SELECT count(*) FROM tags WHERE id::text LIKE '00000000-0000-4000-a0d0-%') AS n`)).rows[0].n
  check('limpeza: dados do teste apagados', Number(left) === 0, String(left))
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
