// Excluir sessão: DELETE /time-entries/:id. Devolve as sessões que sobraram do registro; recusa
// com 404 (id inválido ou inexistente), 400 (estimada: a duração se ajusta no registro), 409
// (rodando; única sessão do registro). O "Quando" do registro NÃO muda; o Painel lê na hora. A
// concorrência é provada com travas seguradas por esta bateria e conferidas em pg_stat_activity:
// duas exclusões ao mesmo tempo (só uma passa), exclusão contra um Pausar e contra um Finalizar em
// andamento (esperam, depois decidem), e o Retomar (POST) ESPERA a exclusão em andamento (FOR NO KEY
// UPDATE no registro conflita com o FOR SHARE do Retomar; ver sessao-corrida-test). Dados próprios (prefixo teste-sessao), em março de
// 2025 (o seed nunca cai lá), apagados no fim; pausa a sessão do seed e devolve a linha exata.
// Uso (raiz do repo): node --env-file=backend/.env tests/api/sessao-excluir-test.mjs
import pg from 'pg'
import { API } from '../config.mjs'
import { apiFetch, sessionCookie } from '../sessao.mjs'
import { deleteExecutions, pauseRunning, resumeRunning } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-sessao'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(method, path, body) {
  const res = await apiFetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
  return { status: res.status, body: parsed }
}
const detail = (r) => `status ${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}`
const SOLE = 'Esta é a única sessão do registro.'
const RUNNING = 'Sessão rodando: pause antes de excluir.'
const ESTIMATED = 'Sessão estimada: ajuste a duração no registro'
const GHOST = '00000000-0000-4000-8000-000000000000'

const seedSession = await pauseRunning(pool)
const executions = []
const taskIds = []
try {
  const newTask = async () => { const id = (await api('POST', '/tasks', { title: `${P} tarefa ${taskIds.length}` })).body.id; taskIds.push(id); return id }
  const taskId = await newTask()
  // Um registro aberto por tarefa (índice do banco): cada registro aberto usa a sua
  const record = async (completedAt) => {
    const r = await api('POST', '/executions', { taskId: completedAt === null ? await newTask() : taskId, description: P, completedAt })
    executions.push(r.body.id)
    return r.body.id
  }
  const add = async (executionId, from, to, estimated = false) =>
    (await pool.query('INSERT INTO time_entries (task_execution_id, started_at, ended_at, estimated) VALUES ($1, $2, $3, $4) RETURNING id', [executionId, from, to, estimated])).rows[0].id
  const sessions = async (id) => (await pool.query('SELECT id, started_at, ended_at, estimated FROM time_entries WHERE task_execution_id = $1 ORDER BY started_at, id', [id])).rows
  const completed = async (id) => (await pool.query('SELECT completed_at::text AS c FROM task_executions WHERE id = $1', [id])).rows[0].c
  const del = (id) => api('DELETE', `/time-entries/${id}`)
  const day = (hh, mm = 0, ss = 0) => `2025-03-10T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.000Z`
  const periodQuery = (path, de, ate) => api('GET', `/dashboard/${path}&de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}&fuso=America%2FSao_Paulo`)

  // ---------- excluir uma de várias (a minúscula do caso real), com sobreposição
  const r1 = await record(day(15))
  const s1 = await add(r1, day(13), day(13, 0, 7)) // 7s
  const s2 = await add(r1, day(13, 10), day(13, 30)) // 20 min
  const s3 = await add(r1, day(13, 20), day(13, 40)) // 20 min, em paralelo com a s2
  const whenBefore = await completed(r1)
  const win = ['2025-03-10T00:00:00-03:00', '2025-03-11T00:00:00-03:00']
  const before = await periodQuery('tempo-por-contexto?x=1', ...win)
  check('antes: o Painel soma as três (7s + 1200s + 1200s)', before.body?.totalSeconds === 2407, detail(before))
  let r = await del(s1)
  check('excluir a de 7s: 200', r.status === 200, detail(r))
  check('a resposta traz o registro e as sessões que sobraram, em ordem', r.body?.taskExecutionId === r1 && r.body?.timeEntries?.map((e) => e.id).join() === [s2, s3].join(), detail(r))
  check('a sessão saiu do banco e as outras ficaram iguais', (await sessions(r1)).map((x) => x.id).join() === [s2, s3].join())
  check('o "Quando" do registro não muda', (await completed(r1)) === whenBefore, `${whenBefore} → ${await completed(r1)}`)
  const after = await periodQuery('tempo-por-contexto?x=1', ...win)
  check('o Painel perde exatamente os 7s (2407 → 2400), sem cache', after.body?.totalSeconds === 2400, detail(after))
  check('o Painel segue marcando "em paralelo" (a s2 e a s3 ainda se sobrepõem)', after.body?.overlap === true)
  r = await del(s1)
  check('excluir de novo a mesma: 404 "Sessão não encontrada"', r.status === 404 && r.body?.error === 'Sessão não encontrada', detail(r))
  r = await del(s3)
  check('excluir a em paralelo (sobra uma só): 200, a sobreposição some', r.status === 200 && r.body?.timeEntries?.length === 1, detail(r))
  const overlapGone = await periodQuery('tempo-por-contexto?x=1', ...win)
  check('o Painel: 1200s e sem "em paralelo"', overlapGone.body?.totalSeconds === 1200 && overlapGone.body?.overlap === false, detail(overlapGone))

  // ---------- única sessão do registro (concluído)
  r = await del(s2)
  check('a única sessão do registro concluído: 409 com a frase da tela', r.status === 409 && r.body?.error === SOLE, detail(r))
  check('a única continua no banco', (await sessions(r1)).length === 1)

  // ---------- 404
  r = await del(GHOST)
  check('uuid que não existe: 404 "Sessão não encontrada"', r.status === 404 && r.body?.error === 'Sessão não encontrada', detail(r))
  r = await del('nao-e-uuid')
  check('id que não é uuid: 404 "Sessão não encontrada"', r.status === 404 && r.body?.error === 'Sessão não encontrada', detail(r))

  // ---------- estimada
  const r3 = (await api('POST', '/executions', { taskId, description: P, completedAt: day(18), estimatedSeconds: 1200 })).body
  executions.push(r3.id)
  const estimated = r3.timeEntries.find((e) => e.estimated)
  const timed = await add(r3.id, day(19), day(19, 5))
  r = await del(estimated.id)
  check('estimada: 400 "ajuste a duração no registro"', r.status === 400 && r.body?.error === ESTIMATED, detail(r))
  check('a estimada continua no banco', (await sessions(r3.id)).some((x) => x.estimated))
  r = await del(timed)
  check('a de cronômetro do mesmo registro: 200, a estimada fica', r.status === 200 && r.body?.timeEntries?.length === 1 && r.body.timeEntries[0].estimated === true, detail(r))
  r = await del(estimated.id)
  check('registro só com a estimada: a estimada continua 400 (não 409)', r.status === 400 && r.body?.error === ESTIMATED, detail(r))
  const r3b = await record(day(21))
  const lone = await add(r3b, day(20), day(20, 3))
  const withEstimate = await api('PUT', `/executions/${r3b}`, { description: P, completedAt: day(21), estimatedSeconds: 600 })
  check('(preparo) registro com uma de cronômetro e uma estimada', withEstimate.status === 200 && (await sessions(r3b)).length === 2, detail(withEstimate))
  r = await del(lone)
  check('a de cronômetro desse registro sai (a estimada é outra sessão, não a única)', r.status === 200, detail(r))

  // ---------- registro aberto: rodando e única
  const r5 = await record(null)
  const closedA = await add(r5, day(8), day(8, 10))
  const run = (await api('POST', '/time-entries', { taskExecutionId: r5, startedAt: new Date(Date.now() - 600_000).toISOString() })).body
  r = await del(run.id)
  check('sessão rodando: 409 "pause antes de excluir"', r.status === 409 && r.body?.error === RUNNING, detail(r))
  check('a rodando continua rodando', (await sessions(r5)).some((x) => x.ended_at === null))
  r = await del(closedA)
  check('a fechada de um registro aberto (sobra a rodando): 200', r.status === 200 && r.body?.timeEntries?.length === 1 && r.body.timeEntries[0].endedAt === null, detail(r))
  r = await del(run.id)
  check('a única, rodando: 409 de rodando (a mensagem de rodando vem antes)', r.status === 409 && r.body?.error === RUNNING, detail(r))
  await pool.query('UPDATE time_entries SET ended_at = now() WHERE id = $1', [run.id])
  r = await del(run.id)
  check('pausada e única no registro aberto: 409 "única sessão"', r.status === 409 && r.body?.error === SOLE, detail(r))

  // ---------- cruza a meia-noite (fuso de São Paulo): as duas metades saem juntas
  const r2 = await record('2025-03-12T05:00:00.000Z')
  const cross = await add(r2, '2025-03-12T02:30:00.000Z', '2025-03-12T03:30:00.000Z') // 23:30 a 00:30 em SP
  await add(r2, '2025-03-12T10:00:00.000Z', '2025-03-12T10:10:00.000Z') // 07:00 a 07:10 em SP, dia 12
  const byDay = async () => (await periodQuery('tempo-por-periodo?por=dia', '2025-03-11T00:00:00-03:00', '2025-03-13T00:00:00-03:00')).body?.items?.map((i) => i.seconds).join()
  check('antes: dia 11 = 1800s, dia 12 = 1800s + 600s', (await byDay()) === '1800,2400', await byDay())
  r = await del(cross)
  check('excluir a que cruza a meia-noite: 200', r.status === 200, detail(r))
  check('depois: as duas metades saíram (dia 11 = 0, dia 12 = 600s)', (await byDay()) === '0,600', await byDay())

  // ---------- concorrência
  const lockClient = await pool.connect()
  const waiting = async () => (await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`)).rows[0].n
  const waitFor = async (n) => { for (let i = 0; i < 40; i++) { if ((await waiting()) >= n) return true; await pause(100) } return false }
  try {
    // C1: duas exclusões ao mesmo tempo num registro de duas sessões: só uma passa
    const r7 = await record(day(23))
    const a = await add(r7, day(22), day(22, 10))
    const b = await add(r7, day(22, 20), day(22, 30))
    await lockClient.query('BEGIN')
    await lockClient.query('SELECT id FROM task_executions WHERE id = $1 FOR NO KEY UPDATE', [r7])
    const both = Promise.all([del(a), del(b)])
    check('C1: as duas exclusões esperam a trava do registro', await waitFor(2), `${await waiting()} esperando`)
    await lockClient.query('COMMIT')
    const outcome = (await both).map((x) => x.status).sort()
    check('C1: exatamente uma passa (200) e a outra vê a única (409)', outcome.join() === '200,409', outcome.join())
    check('C1: sobrou uma sessão, nunca zero', (await sessions(r7)).length === 1, `${(await sessions(r7)).length}`)

    // C2: excluir a sessão enquanto um Pausar (UPDATE dela) ainda não terminou
    const r8 = await record(null)
    await add(r8, day(9), day(9, 5))
    const live = await add(r8, new Date(Date.now() - 900_000).toISOString(), null)
    await lockClient.query('BEGIN')
    await lockClient.query('UPDATE time_entries SET ended_at = now() WHERE id = $1', [live])
    const racing = del(live)
    check('C2: o DELETE espera o Pausar em andamento', await waitFor(1), `${await waiting()} esperando`)
    await lockClient.query('COMMIT')
    r = await racing
    check('C2: depois do Pausar a sessão está fechada: 200 (não 409 de rodando)', r.status === 200, detail(r))
    check('C2: a excluída saiu e a outra ficou', (await sessions(r8)).length === 1 && !(await sessions(r8)).some((x) => x.id === live))

    // C3: excluir enquanto o Finalizar (UPDATE do registro) ainda não terminou
    const r9 = await record(day(23, 30))
    const c = await add(r9, day(23), day(23, 10))
    await add(r9, day(23, 15), day(23, 25))
    await lockClient.query('BEGIN')
    await lockClient.query('UPDATE task_executions SET description = description WHERE id = $1', [r9])
    const behind = del(c)
    check('C3: o DELETE espera o Finalizar em andamento', await waitFor(1), `${await waiting()} esperando`)
    await lockClient.query('COMMIT')
    r = await behind
    check('C3: depois dele, 200', r.status === 200, detail(r))

    // C4: o Retomar (POST da sessão) ESPERA a exclusão da rota em andamento: ela trava o registro em
    // FOR NO KEY UPDATE, que conflita com o FOR SHARE do Retomar (a espera é o que impede o Retomar de
    // criar sessão num registro que um Finalizar está fechando). A exclusão é segurada de verdade: esta
    // bateria trava a linha da sessão, a rota pega a trava do registro e espera ali
    const r10 = await record(null)
    const held = await add(r10, day(6), day(6, 5))
    await add(r10, day(6, 10), day(6, 15))
    await lockClient.query('BEGIN')
    await lockClient.query('SELECT id FROM time_entries WHERE id = $1 FOR UPDATE', [held])
    const slow = del(held)
    check('C4: a exclusão fica esperando a linha da sessão (já com o registro travado)', await waitFor(1), `${await waiting()} esperando`)
    const resume = api('POST', '/time-entries', { taskExecutionId: r10, startedAt: new Date(Date.now() - 60_000).toISOString() })
    check('C4: o Retomar espera a exclusão em andamento (duas esperando)', await waitFor(2), `${await waiting()} esperando`)
    const early = await Promise.race([resume, pause(1000).then(() => 'esperando')])
    check('C4: depois de 1 s o Retomar continua sem resposta', early === 'esperando', early === 'esperando' ? '' : detail(early))
    await lockClient.query('ROLLBACK')
    const finished = await slow
    const resumed = await resume
    check('C4: solta a linha, a exclusão termina (200) e o Retomar cria a sessão (201)', finished.status === 200 && resumed.status === 201, `${detail(finished)} | ${detail(resumed)}`)
    check('C4: ficaram a outra sessão e a nova, rodando', (await sessions(r10)).length === 2 && (await sessions(r10)).filter((x) => x.ended_at === null).length === 1)
  } finally {
    await lockClient.query('ROLLBACK').catch(() => {})
    lockClient.release()
  }

  // ---------- sem sessão e sem o cabeçalho
  const cookie = await sessionCookie()
  const url = `${API}/time-entries/${GHOST}`
  const noCookie = await fetch(url, { method: 'DELETE', headers: { 'X-StudyFlow': '1' } })
  check('sem cookie de sessão: 401', noCookie.status === 401, `${noCookie.status}`)
  const noHeader = await fetch(url, { method: 'DELETE', headers: { Cookie: `sf_session=${cookie}` } })
  check('sem o cabeçalho X-StudyFlow: 403', noHeader.status === 403, `${noHeader.status}`)
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false, String(err.stack).split(String.fromCharCode(10)).slice(0, 3).join(' | '))
} finally {
  await deleteExecutions(pool, executions)
  if (taskIds.length) await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [taskIds])
  await resumeRunning(pool, seedSession)
  const left = await pool.query(`SELECT (SELECT count(*) FROM tasks WHERE title LIKE $1)::int + (SELECT count(*) FROM task_executions WHERE description = $2)::int AS n`, [`${P}%`, P])
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  const running = await pool.query('SELECT count(*)::int AS n FROM time_entries WHERE ended_at IS NULL')
  check('a sessão rodando do seed voltou (uma rodando)', running.rows[0].n === seedSession.length, `${running.rows[0].n}`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
