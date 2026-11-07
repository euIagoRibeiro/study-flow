// ATENÇÃO: ferramenta MANUAL, fora do `npm run tudo`. Cria um banco TEMPORÁRIO
// (cópia do local), põe nele triggers com pg_sleep e sobe um backend na 3334
// apontado pra ele. O banco de verdade não é tocado; o temporário é apagado no fim.
//
// Prova janela de deadlock que uma intercalação por fora não alcança: o UPDATE da
// raiz trava o registro forte e só depois confere as FKs. O trigger, com nome que
// ordena antes dos RI_ConstraintTrigger, segura cada escrita do registro nesse
// intervalo, e o DELETE da obra chega em três momentos do pedido.
//
// Uso (em tests/): node --env-file=../backend/.env ferramentas/sonda-janela.mjs [trecho do nome...]
// Sem argumento, todos os cenários. Sai com 1 se houver deadlock ou resposta 5xx.
// Roda o código do backend como está no disco.
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { setTimeout as later } from 'node:timers/promises'
import pg from 'pg'
import { TESTS } from '../config.mjs'
import { apiFetch } from '../sessao.mjs'

const CONTAINER = 'study-flow-postgres-1'
const TEMP = 'studyflow_sonda'
const API = 'http://localhost:3334'
if (!process.env.DATABASE_URL) throw new Error('rodar com --env-file=../backend/.env')
const original = new URL(process.env.DATABASE_URL)
if (original.pathname !== '/studyflow') throw new Error(`banco inesperado: ${original.pathname}`)
const url = new URL(original)
url.pathname = `/${TEMP}`
const filters = process.argv.slice(2)
// Momentos do DELETE, em ms depois do pedido: cada escrita do registro dorme 1,5s
const DELAYS = [300, 1900, 3500]

const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 1024 ** 3 })
const psql = (db, sql) => {
  const r = docker('exec', CONTAINER, 'psql', '-U', 'studyflow', '-d', db, '-qc', sql)
  if (r.status !== 0) throw new Error(r.stderr)
}
const call = async (method, path, body) => {
  const res = await apiFetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const must = async (...args) => {
  const r = await call(...args)
  if (r.status >= 300) throw new Error(`${args[1]}: ${r.status} ${JSON.stringify(r.body)}`)
  return r.body
}
if (await call('GET', '/works').catch(() => null)) throw new Error('a porta 3334 já está em uso')

let backend = null
let failed = false
try {
  const dump = docker('exec', CONTAINER, 'pg_dump', '-U', 'studyflow', '-d', 'studyflow')
  if (dump.status !== 0 || !dump.stdout.includes('dump complete')) throw new Error('dump incompleto')
  psql('postgres', `DROP DATABASE IF EXISTS ${TEMP}`)
  psql('postgres', `CREATE DATABASE ${TEMP}`)
  const restore = spawnSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'studyflow', '-d', TEMP, '-q', '-v', 'ON_ERROR_STOP=1'],
    { input: dump.stdout, encoding: 'utf8', maxBuffer: 1024 ** 3 })
  if (restore.status !== 0) throw new Error(restore.stderr)

  const db = new pg.Client({ connectionString: url.href })
  await db.connect()
  await db.query(`CREATE FUNCTION sonda() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(1.5); RETURN NULL; END $$ LANGUAGE plpgsql`)
  await db.query(`CREATE TRIGGER "A_sonda" AFTER UPDATE ON task_executions FOR EACH ROW EXECUTE FUNCTION sonda()`)
  await db.query(`CREATE TRIGGER "A_sonda" AFTER INSERT ON execution_workouts FOR EACH ROW EXECUTE FUNCTION sonda()`)
  await db.end()

  backend = spawn(process.execPath, ['--env-file=.env', 'src/index.js'], {
    cwd: join(TESTS, '..', 'backend'),
    env: { ...process.env, DATABASE_URL: url.href, PORT: '3334' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 50 && !(await call('GET', '/works').catch(() => null)); i++) await later(200)

  const [exercise] = await must('GET', '/exercises')
  let count = 0
  // Tudo novo a cada rodada: o registro, ligado à obra A, nas raízes R1 e R2
  const fixture = async (open) => {
    const stamp = `${Date.now()}-${++count}`
    const task = await must('POST', '/tasks', { title: `sonda ${stamp}` })
    const R1 = await must('POST', '/tags', { name: `sonda 1 ${stamp}` })
    const R2 = await must('POST', '/tags', { name: `sonda 2 ${stamp}` })
    await must('PATCH', `/tags/${R1.id}`, { tracksPhase: true, tracksWorkout: true })
    const A = await must('POST', '/works', { title: `sonda a ${stamp}`, defaultTagId: R1.id, defaultTaskId: task.id })
    const B = await must('POST', '/works', { title: `sonda b ${stamp}`, defaultTagId: R1.id, defaultTaskId: task.id })
    const completedAt = new Date().toISOString()
    const record = await must('POST', '/executions', { taskId: task.id, description: 'sonda', completedAt: open ? null : completedAt, rootTagId: R1.id, tagIds: [], workId: A.id })
    const put = (changes) => call('PUT', `/executions/${record.id}`, { description: 'sonda', completedAt, ...changes })
    return { R2, A, B, completedAt, record, put }
  }
  const raiz = (f) => ({ rootTagId: f.R2.id, tagIds: [] })
  const scenarios = [
    ['raiz, com workId', false, (f) => f.put({ ...raiz(f), workId: f.A.id })],
    ['raiz, sem workId', false, (f) => f.put(raiz(f))],
    ['raiz, sem tag', false, (f) => f.put({ rootTagId: null, tagIds: [] })],
    ['raiz, workId null', false, (f) => f.put({ ...raiz(f), workId: null })],
    ['raiz, troca de obra, apaga a nova', false, (f) => f.put({ ...raiz(f), workId: f.B.id }), 'B'],
    ['raiz, troca de obra, apaga a antiga', false, (f) => f.put({ ...raiz(f), workId: f.B.id })],
    ['finalizar, sem tags', true, (f) => f.put({})],
    ['finalizar, trocando a raiz', true, (f) => f.put(raiz(f))],
    ['reabrir, sem tags', false, (f) => f.put({ completedAt: null })],
    ['reabrir, trocando a raiz', false, (f) => f.put({ completedAt: null, ...raiz(f) })],
    ['só a fase', false, (f) => f.put({ phase: 'prototipo' })],
    ['/workout', true, (f) => call('PUT', `/executions/${f.record.id}/workout`, { workout: [{ exerciseId: exercise.id, sets: [{ reps: 8, weightKg: null }] }] })],
  ].filter(([name]) => filters.length === 0 || filters.some((text) => name.includes(text)))
  if (scenarios.length === 0) throw new Error('nenhum cenário com esse filtro')

  for (const [name, open, action, target = 'A'] of scenarios) {
    for (const delay of DELAYS) {
      const f = await fixture(open)
      const since = new Date().toISOString()
      const write = action(f)
      await later(delay)
      const del = call('DELETE', `/works/${f[target].id}`)
      const [w, d] = await Promise.all([write, del])
      await later(300)
      const log = docker('logs', '--since', since, CONTAINER)
      const lines = `${log.stdout}${log.stderr}`.split('\n').filter((l) => /deadlock detected|Process \d+/.test(l))
      const bad = lines.length > 0 || w.status >= 500 || d.status >= 500
      console.log(`${bad ? 'DEADLOCK' : 'ok      '} ${name.padEnd(36)} DELETE em ${String(delay).padStart(4)}ms: escrita ${w.status}, DELETE ${d.status}`)
      if (lines.length) console.log(lines.map((l) => `    ${l.trim().slice(0, 150)}`).join('\n'))
      if (bad) failed = true
    }
  }
} catch (err) {
  console.error(`sonda falhou: ${err.message}`)
  failed = true
} finally {
  backend?.kill()
  await later(500)
  psql('postgres', `DROP DATABASE IF EXISTS ${TEMP}`)
  const left = docker('exec', CONTAINER, 'psql', '-U', 'studyflow', '-d', 'postgres', '-tAc', `SELECT count(*) FROM pg_database WHERE datname = '${TEMP}'`)
  console.log(`banco temporário apagado: ${left.stdout.trim() === '0' ? 'sim' : 'NÃO'}`)
  process.exitCode = failed ? 1 : 0
}
