// Lápis do registro e da sessão: horário que a pessoa não editou volta ao
// servidor exato (o campo de data não tem segundos; reler o texto os zerava).
// Registro: salvar só a descrição mantém o "Quando" e a estimativa; trocar o
// "Quando" de verdade move a estimativa junto (controle). Sessão: editar só o
// fim mantém o início, e só o início mantém o fim. Horário de verão: num fuso
// com a hora repetida (America/New_York, 02/11/2025), o "Quando" na 2ª 01:30
// volta igual (relido, cairia na 1ª, uma hora antes). Compara o texto do banco
// (microssegundos), e os dados nascem pela API, em milissegundos. Dados
// próprios (prefixo teste-lapis), apagados no fim; pausa a sessão do seed e
// devolve. Uso (raiz do repo):
//   node --env-file=backend/.env tests/telas/lapis-segundos.mjs
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'
import { deleteExecutions, pauseRunning, resumeRunning } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-lapis'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(method, path, body) {
  const res = await apiFetch(API + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const text = await res.text()
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}
// Um instante de `hoursAgo` horas atrás com segundos e milissegundos que o campo não mostra
const odd = (hoursAgo, s, ms) => { const d = new Date(Date.now() - hoursAgo * 3600e3); d.setSeconds(s, ms); return d.toISOString() }
const pad = (n) => String(n).padStart(2, '0')
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const row = async (id) => (await pool.query('SELECT completed_at::text AS q FROM task_executions WHERE id = $1', [id])).rows[0].q
const sessions = async (id) => (await pool.query('SELECT started_at::text AS s, ended_at::text AS e, estimated FROM time_entries WHERE task_execution_id = $1 ORDER BY started_at', [id])).rows

// O índice "uma sessão rodando" recusaria a dos casos: pausa a do seed e devolve a linha exata
const seedSession = await pauseRunning(pool)
let taskId = null
let browser
try {
  taskId = (await api('POST', '/tasks', { title: `${P} tarefa` })).id
  const rec = (description, extra) => api('POST', '/executions', { taskId, description, ...extra })
  // R1: "Quando" com segundos + estimativa de 20 min
  const r1 = await rec(`${P} r1`, { completedAt: odd(3, 37, 123), estimatedMinutes: 20 })
  // R2 e R3: sessão de cronômetro com segundos nas duas pontas (Finalizar fecha no "Quando")
  const timed = async (description, hoursAgo) => {
    const r = await rec(description, { completedAt: null })
    await api('POST', '/time-entries', { taskExecutionId: r.id, startedAt: odd(hoursAgo, 12, 456) })
    await api('PUT', `/executions/${r.id}`, { description, completedAt: odd(hoursAgo - 0.5, 48, 789) })
    return r
  }
  const r2 = await timed(`${P} r2`, 5)
  const r3 = await timed(`${P} r3`, 7)
  // R4: a 2ª 01:30 de 02/11/2025 em Nova York (EST, UTC-5) = 06:30Z
  const r4 = await rec(`${P} r4`, { completedAt: '2025-11-02T06:30:12.345Z', estimatedMinutes: 10 })

  browser = await launch({ executablePath: CHROME })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 390, height: 900 })
  const article = `(d) => [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === d))`
  const history = async (p = page) => {
    await p.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
    await p.evaluate(() => sessionStorage.clear())
    await p.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  }
  const setInput = (p, scope, label, value) => p.evaluate((scope, label, value) => {
    const root = document.querySelector(scope)
    const input = [...root.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent.trim() === label).querySelector('input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, scope, label, value)
  // Lápis do registro: abre, muda o campo e salva
  const editRecord = async (p, description, label, value) => {
    await p.evaluate(`(${article})(${JSON.stringify(description)}).querySelector('button[aria-label^="Editar registro"]').click()`)
    await p.waitForSelector('form[id^="editar-"]')
    await pause(200)
    await setInput(p, 'form[id^="editar-"]', label, value)
    await pause(150)
    await p.evaluate(() => document.querySelector('button[form^="editar-"]').click())
    await p.waitForFunction(() => !document.querySelector('form[id^="editar-"]'))
    await p.waitForNetworkIdle()
  }
  // Lápis da sessão: abre a lista de sessões do cartão, o lápis, muda o campo e salva
  const editSession = async (description, label, value) => {
    await page.evaluate(`[...(${article})(${JSON.stringify(description)}).querySelectorAll('button')].find((b) => /sess(ão|ões)/.test(b.textContent)).click()`)
    await pause(200)
    await page.evaluate(`(${article})(${JSON.stringify(description)}).querySelector('button[aria-label^="Editar sessão"]').click()`)
    await pause(200)
    await page.evaluate(`(() => { const a = (${article})(${JSON.stringify(description)}); const input = [...a.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent === ${JSON.stringify(label)}).querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); [...a.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Salvar').click() })()`)
    await pause(300)
    await page.waitForNetworkIdle()
  }

  // ---------- 1. registro: só a descrição; "Quando" e estimativa iguais
  let before = { q: await row(r1.id), s: await sessions(r1.id) }
  await history()
  await editRecord(page, `${P} r1`, 'O que foi feito (opcional)', `${P} r1 editado`)
  let after = { q: await row(r1.id), s: await sessions(r1.id) }
  check('registro, só a descrição: o "Quando" igual no banco (com os segundos)', after.q === before.q, `${before.q} → ${after.q}`)
  check('registro, só a descrição: a estimativa igual (início e fim)', JSON.stringify(after.s) === JSON.stringify(before.s), `${JSON.stringify(before.s)} → ${JSON.stringify(after.s)}`)

  // ---------- 2. controle: trocar o "Quando" de verdade move a estimativa junto
  const moved = new Date(Date.now() - 2 * 3600e3)
  await editRecord(page, `${P} r1 editado`, 'Quando', local(moved))
  after = { q: await row(r1.id), s: await sessions(r1.id) }
  const q = new Date(after.q.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'))
  const est = after.s.find((x) => x.estimated)
  const dur = est ? (new Date(est.e.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')) - new Date(est.s.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'))) / 60000 : null
  check('controle: o "Quando" trocado vale o minuto escolhido', local(q) === local(moved) && q.getSeconds() === 0, after.q)
  check('controle: a estimativa vai junto, com os mesmos 20 min', est && est.e === after.q && dur === 20, JSON.stringify({ est, dur }))

  // ---------- 2b. rascunho: o "Quando" trocado, guardado ao sair e salvo depois, vale
  const r5 = await rec(`${P} r5`, { completedAt: odd(4, 21, 654) })
  const moved5 = new Date(Date.now() - 3 * 3600e3)
  await history()
  await page.evaluate(`(${article})(${JSON.stringify(`${P} r5`)}).querySelector('button[aria-label^="Editar registro"]').click()`)
  await page.waitForSelector('form[id^="editar-"]')
  await pause(200)
  await setInput(page, 'form[id^="editar-"]', 'Quando', local(moved5))
  await pause(400)
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await page.evaluate(`(${article})(${JSON.stringify(`${P} r5`)}).querySelector('button[aria-label^="Editar registro"]').click()`)
  await page.waitForSelector('form[id^="editar-"]')
  await pause(300)
  await page.evaluate(() => document.querySelector('button[form^="editar-"]').click())
  await page.waitForFunction(() => !document.querySelector('form[id^="editar-"]'))
  await page.waitForNetworkIdle()
  const q5 = new Date((await row(r5.id)).replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'))
  check('rascunho com o "Quando" trocado: o trocado vale ao salvar', local(q5) === local(moved5), `${local(q5)} x ${local(moved5)}`)

  // ---------- 3. sessão: só o fim; o início igual
  before = await sessions(r2.id)
  const newEnd = new Date(new Date(before[0].e.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).getTime() - 5 * 60e3)
  await history()
  await editSession(`${P} r2`, 'Fim', local(newEnd))
  after = await sessions(r2.id)
  check('sessão, só o fim: o início igual no banco (com os segundos)', after[0].s === before[0].s, `${before[0].s} → ${after[0].s}`)
  check('sessão, só o fim: o fim é o minuto escolhido', after[0].e !== before[0].e && after[0].e.includes(`${pad(newEnd.getUTCHours())}:${pad(newEnd.getUTCMinutes())}:00`), `${before[0].e} → ${after[0].e}`)

  // ---------- 4. sessão: só o início; o fim igual
  before = await sessions(r3.id)
  const newStart = new Date(new Date(before[0].s.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).getTime() + 5 * 60e3)
  await history()
  await editSession(`${P} r3`, 'Início', local(newStart))
  after = await sessions(r3.id)
  check('sessão, só o início: o fim igual no banco (com os segundos)', after[0].e === before[0].e, `${before[0].e} → ${after[0].e}`)
  check('sessão, só o início: o início mudou', after[0].s !== before[0].s, `${before[0].s} → ${after[0].s}`)

  // ---------- 5. horário de verão: a 2ª 01:30 de Nova York, só a descrição
  const ny = await browser.newPage()
  ny.setDefaultTimeout(10000)
  await ny.setViewport({ width: 390, height: 900 })
  await ny.emulateTimezone('America/New_York')
  before = { q: await row(r4.id), s: await sessions(r4.id) }
  await history(ny)
  await editRecord(ny, `${P} r4`, 'O que foi feito (opcional)', `${P} r4 editado`)
  after = { q: await row(r4.id), s: await sessions(r4.id) }
  check('horário de verão (2ª 01:30 em Nova York): o "Quando" igual', after.q === before.q, `${before.q} → ${after.q}`)
  check('horário de verão: a estimativa igual', JSON.stringify(after.s) === JSON.stringify(before.s), `${JSON.stringify(before.s)} → ${JSON.stringify(after.s)}`)
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser?.close().catch(() => {})
  if (taskId) {
    await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [taskId])).rows.map((r) => r.id))
    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId])
  }
  await resumeRunning(pool, seedSession)
  const left = await pool.query(`SELECT count(*)::int AS n FROM tasks WHERE title LIKE '${P}%'`)
  const running = await pool.query('SELECT count(*)::int AS n FROM time_entries WHERE ended_at IS NULL')
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  check('sessão do seed devolvida', running.rows[0].n === seedSession.length, `${running.rows[0].n} x ${seedSession.length}`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
