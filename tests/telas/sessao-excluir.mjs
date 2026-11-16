// Excluir sessão na tela (Histórico e cartão da Lista): botão de 44px em cada sessão de cronômetro
// (a estimada não tem), confirmação nativa com o horário e a duração como a linha mostra, recusar
// não envia nada, aceitar manda um DELETE só e a lista, a contagem e o total mudam sem recarregar,
// o "Quando" não muda e o foco vai pro botão "N sessões" do cartão. A única sessão do registro não
// abre a confirmação: mostra "Esta é a única sessão do registro." e não envia nada. Erro do servidor
// (409), erro 500 e rede caída mostram a mensagem, deixam a lista como estava e o botão volta.
// Durante o pedido o botão fica desligado (um toque duplo manda um pedido só).
//
// Dados próprios (prefixo teste-sessao-t), de hoje, apagados no fim; o DELETE é de verdade nos
// dados de teste (o seed não é tocado). Uso (raiz): node --env-file=backend/.env tests/telas/sessao-excluir.mjs
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'
import { deleteExecutions } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-sessao-t'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(method, path, body) {
  const res = await apiFetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const min = (m) => new Date(Date.now() + m * 60_000).toISOString()
const SOLE = 'Esta é a única sessão do registro.'
const GENERIC = 'Não foi possível excluir a sessão. Tente de novo.'
const need = (cond, msg) => { if (!cond) throw new Error(msg) }

const executions = []
let taskId = null
let browser
try {
  const task = (await api('POST', '/tasks', { title: `${P} tarefa` })).body
  taskId = task.id
  const record = async (description, completedAt, extra = {}) => {
    const r = (await api('POST', '/executions', { taskId, description, completedAt, ...extra })).body
    executions.push(r.id)
    return r
  }
  const add = async (executionId, from, to) =>
    (await pool.query('INSERT INTO time_entries (task_execution_id, started_at, ended_at) VALUES ($1, $2, $3) RETURNING id', [executionId, from, to])).rows[0].id
  // A: quatro sessões (a primeira, de 7s, é a "do engano")
  const A = await record(`${P} A`, min(-30))
  const s1 = await add(A.id, min(-260), new Date(Date.parse(min(-260)) + 7000).toISOString())
  const s2 = await add(A.id, min(-240), min(-220))
  const s3 = await add(A.id, min(-200), min(-170))
  const s4 = await add(A.id, min(-150), min(-120))
  // B: uma sessão só
  const B = await record(`${P} B`, min(-20))
  await add(B.id, min(-25), min(-24))
  // C: uma estimada e uma de cronômetro
  const C = await record(`${P} C`, min(-10), { estimatedSeconds: 600 })
  await add(C.id, min(-420), min(-410))
  const whenA = (await pool.query('SELECT completed_at::text AS c FROM task_executions WHERE id = $1', [A.id])).rows[0].c
  const dbSessions = async (id) => (await pool.query('SELECT id FROM time_entries WHERE task_execution_id = $1 ORDER BY started_at', [id])).rows.map((r) => r.id)

  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 375, height: 900 })
  const dialogs = []
  let answer = 'accept'
  page.on('dialog', async (d) => { dialogs.push(d.message()); if (answer === 'accept') await d.accept(); else await d.dismiss() })
  const deletes = []
  let inject = null // { status, body } ou 'abort'
  let delay = 0
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.method() === 'DELETE') deletes.push(new URL(req.url()).pathname)
    if (req.method() === 'DELETE' && inject) {
      if (inject === 'abort') return req.abort()
      return req.respond({ status: inject.status, contentType: 'application/json', body: JSON.stringify(inject.body) })
    }
    if (req.method() === 'DELETE' && delay) return void setTimeout(() => req.continue(), delay)
    return req.continue()
  })
  const clean = async (path) => {
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => sessionStorage.clear())
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
  }
  const CARD = (d) => `[...document.querySelectorAll('article')].find((a) => [...a.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === ${JSON.stringify(d)}))`
  const openSessions = async (d) => {
    await page.evaluate(`(() => { const t = [...${CARD(d)}.querySelectorAll('button[aria-expanded]')].find((b) => /sess(ão|ões)/.test(b.textContent)); if (t.getAttribute('aria-expanded') !== 'true') t.click() })()`)
    await pause(150)
  }
  const rows = (d) => page.evaluate(`(() => [...${CARD(d)}.querySelectorAll('li')].filter((li) => /\\d{2}:\\d{2}–\\d{2}:\\d{2}/.test(li.textContent)).map((li) => {
    const text = li.querySelector('span')?.textContent.trim() ?? ''
    const del = li.querySelector('button[aria-label^="Excluir sessão"]')
    const r = del?.getBoundingClientRect()
    return { text, hasDelete: Boolean(del), label: del?.getAttribute('aria-label') ?? '', w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0, disabled: Boolean(del?.disabled || del?.getAttribute('aria-disabled') === 'true'), alert: li.querySelector('[role="alert"]')?.textContent.trim() ?? '' }
  }))()`)
  const info = (d) => page.evaluate(`(() => { const a = ${CARD(d)}; const t = [...a.querySelectorAll('button[aria-expanded]')].find((b) => /sess(ão|ões)/.test(b.textContent)); return { toggle: t?.textContent.trim() ?? '', focused: document.activeElement === t, expanded: t?.getAttribute('aria-expanded'), text: a.textContent } })()`)
  const press = (d, index) => page.evaluate(`(() => { const lis = [...${CARD(d)}.querySelectorAll('li')].filter((li) => /\\d{2}:\\d{2}–\\d{2}:\\d{2}/.test(li.textContent)); lis[${index}].querySelector('button[aria-label^="Excluir sessão"]').click() })()`)
  const timeOf = (row) => row.text.split('·')[0].trim().split('–')[0]
  const durationOf = (row) => row.text.split('·')[1].trim().split(' ')[0]
  const expectedMessage = (row) => `Excluir a sessão das ${timeOf(row)} (${durationOf(row)})? Não dá pra desfazer.`

  // --- Histórico: os botões
  await clean('/historico')
  await openSessions(`${P} A`)
  let a = await rows(`${P} A`)
  need(a.length === 4, `registro A com ${a.length} linhas de sessão (esperava 4)`)
  check('cada sessão de cronômetro tem o botão "Excluir sessão das HH:MM"', a.every((r) => r.hasDelete && r.label === `Excluir sessão das ${timeOf(r)}`), JSON.stringify(a.map((r) => r.label)))
  check('o botão tem alvo de 44px', a.every((r) => r.w >= 44 && r.h >= 44), JSON.stringify(a.map((r) => `${r.w}x${r.h}`)))
  await openSessions(`${P} C`)
  const c = await rows(`${P} C`)
  check('a sessão estimada não tem botão e a de cronômetro do mesmo registro tem', c.length === 2 && c.filter((r) => r.text.includes('estimada')).every((r) => !r.hasDelete) && c.filter((r) => !r.text.includes('estimada')).every((r) => r.hasDelete), JSON.stringify(c.map((r) => [r.text, r.hasDelete])))

  // --- a única sessão: mensagem, sem confirmação, sem pedido
  await openSessions(`${P} B`)
  const b0 = await rows(`${P} B`)
  check('registro de uma sessão só: a linha tem o botão', b0.length === 1 && b0[0].hasDelete)
  dialogs.length = 0; deletes.length = 0
  await press(`${P} B`, 0)
  await pause(250)
  const b1 = await rows(`${P} B`)
  check('a única: não abre a confirmação, não envia pedido, mostra a frase e a sessão continua', dialogs.length === 0 && deletes.length === 0 && b1.length === 1 && b1[0].alert === SOLE, JSON.stringify({ dialogs, deletes, alert: b1[0]?.alert }))

  // --- recusar a confirmação não envia nada
  answer = 'dismiss'
  dialogs.length = 0; deletes.length = 0
  await press(`${P} A`, 0)
  await pause(250)
  check('a confirmação diz o horário e a duração como a linha mostra', dialogs.length === 1 && dialogs[0] === expectedMessage(a[0]), JSON.stringify(dialogs))
  check('recusar a confirmação: nenhum pedido e a lista igual', deletes.length === 0 && (await rows(`${P} A`)).length === 4, `${deletes.length} pedido(s)`)
  answer = 'accept'

  // --- erro do servidor, 500 e rede: a mensagem aparece, a lista fica, o botão volta
  for (const [name, spec, expected] of [
    ['409 do servidor', { status: 409, body: { error: 'Sessão rodando: pause antes de excluir.' } }, 'Sessão rodando: pause antes de excluir.'],
    ['500', { status: 500, body: { error: 'Erro interno' } }, GENERIC],
    ['rede caída', 'abort', GENERIC],
  ]) {
    inject = spec
    deletes.length = 0
    await press(`${P} A`, 1)
    await pause(400)
    const r = await rows(`${P} A`)
    check(`${name}: a mensagem aparece, a lista fica com 4 e o botão volta`, r.length === 4 && r[1].alert === expected && !r[1].disabled, JSON.stringify({ alert: r[1]?.alert, n: r.length, disabled: r[1]?.disabled }))
  }
  inject = null
  check('nada foi apagado nos erros', (await dbSessions(A.id)).length === 4)

  // --- excluir de verdade a de 7s
  deletes.length = 0; dialogs.length = 0
  await press(`${P} A`, 0)
  await pause(700)
  check('aceitar: um DELETE só, na sessão certa', deletes.length === 1 && deletes[0].endsWith(`/time-entries/${s1}`), JSON.stringify(deletes))
  a = await rows(`${P} A`)
  const i1 = await info(`${P} A`)
  check('a lista fica com 3 sessões (sem recarregar a página) e a contagem muda', a.length === 3 && i1.toggle.startsWith('3 sessões'), `${a.length} / ${i1.toggle}`)
  check('o total do cartão perde os 7 segundos (01:20:07 → 01:20:00)', i1.text.includes('01:20:00') && !i1.text.includes('01:20:07'), i1.text.slice(0, 200))
  check('o foco vai pro botão "N sessões" do cartão, aberto', i1.focused && i1.expanded === 'true', JSON.stringify({ f: i1.focused, e: i1.expanded }))
  check('no banco: a sessão saiu e o "Quando" do registro é o mesmo', !(await dbSessions(A.id)).includes(s1) && (await pool.query('SELECT completed_at::text AS c FROM task_executions WHERE id = $1', [A.id])).rows[0].c === whenA)

  // --- durante o pedido o botão fica desligado, e o toque duplo manda um pedido só
  delay = 800
  deletes.length = 0
  await press(`${P} A`, 0)
  await pause(200)
  const busy = (await rows(`${P} A`))[0]
  await page.evaluate(`(() => { const lis = [...${CARD(`${P} A`)}.querySelectorAll('li')].filter((li) => /\\d{2}:\\d{2}–\\d{2}:\\d{2}/.test(li.textContent)); lis[0].querySelector('button[aria-label^="Excluir sessão"]').click() })()`)
  await pause(1200)
  delay = 0
  check('durante o pedido o botão está desligado', busy.disabled, JSON.stringify(busy))
  check('toque duplo: um pedido só', deletes.length === 1, `${deletes.length}`)
  check('a segunda (S2) saiu: 2 sessões', (await rows(`${P} A`)).length === 2 && !(await dbSessions(A.id)).includes(s2))

  // --- cartão da Lista
  await clean('/')
  await page.evaluate((t) => document.querySelector(`button[aria-label="Mais ações de ${t}"]`).click(), task.title)
  await pause(150)
  await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Ver histórico').click())
  await pause(400)
  await openSessions(`${P} A`)
  const l0 = await rows(`${P} A`)
  check('Lista: o cartão mostra as 2 sessões que sobraram, com botão', l0.length === 2 && l0.every((r) => r.hasDelete && r.w >= 44 && r.h >= 44), JSON.stringify(l0.map((r) => r.label)))
  deletes.length = 0; dialogs.length = 0
  await press(`${P} A`, 0)
  await pause(700)
  const l1 = await rows(`${P} A`)
  const li = await info(`${P} A`)
  check('Lista: a confirmação, o DELETE na sessão certa e a lista com 1', dialogs.length === 1 && dialogs[0] === expectedMessage(l0[0]) && deletes.length === 1 && deletes[0].endsWith(`/time-entries/${s3}`) && l1.length === 1, JSON.stringify({ dialogs, deletes, n: l1.length }))
  check('Lista: contagem "1 sessão" e o foco no botão do cartão', li.toggle.startsWith('1 sessão') && li.focused, JSON.stringify({ t: li.toggle, f: li.focused }))
  deletes.length = 0; dialogs.length = 0
  await press(`${P} A`, 0)
  await pause(250)
  const l2 = await rows(`${P} A`)
  check('Lista: agora é a única do registro: frase, sem confirmação e sem pedido', dialogs.length === 0 && deletes.length === 0 && l2.length === 1 && l2[0].alert === SOLE, JSON.stringify({ alert: l2[0]?.alert, deletes }))
  check('no banco só ficou a quarta sessão', (await dbSessions(A.id)).join() === s4)
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false, String(err.stack).split(String.fromCharCode(10)).slice(0, 3).join(' | '))
} finally {
  await browser?.close()
  await deleteExecutions(pool, executions)
  if (taskId) await pool.query('DELETE FROM tasks WHERE id = $1', [taskId])
  const left = await pool.query(`SELECT (SELECT count(*) FROM tasks WHERE title LIKE $1)::int + (SELECT count(*) FROM task_executions WHERE description LIKE $1)::int AS n`, [`${P}%`])
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
