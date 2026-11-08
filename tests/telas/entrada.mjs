// Tela de entrada (commit B da hospedagem). Chrome SEM o cookie das baterias:
// 1. sem sessão: a página inteira é a entrada (foco na senha, usuário invisível
//    pro gerenciador de senhas); senha errada; o 401 do /login não é "sessão
//    vencida"; a senha certa abre o app;
// 2. "Acordando o servidor…" só depois de 3 s (o /session segurado na página);
//    servidor fora do ar, Tentar de novo;
// 3. sessão vencida no meio do uso (cookie apagado de verdade): diálogo por cima,
//    resto inert (Tab e Shift+Tab não saem dele), Escape não fecha, o texto e o
//    rascunho ficam, o foco volta pro botão tocado; dois 401 juntos = um diálogo;
// 4. o texto do 401 no Pausar e no Finalizar;
// 5. o 429 do login: "Tente de novo em N s" e o botão volta sozinho;
// 6. Sair: cookie e rascunhos apagados, a entrada de volta.
// Dados próprios (prefixo teste-entrada), apagados no fim; a sessão rodando do
// seed é pausada e devolvida. Uso (raiz do repo):
//   node --env-file=backend/.env tests/telas/entrada.mjs
import pg from 'pg'
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch } from '../sessao.mjs'
import { deleteExecutions, pauseRunning, resumeRunning } from '../limpeza.mjs'

if (!process.env.DATABASE_URL || !process.env.TEST_PASSWORD) {
  console.error('DATABASE_URL ou TEST_PASSWORD ausente: rode com --env-file=backend/.env')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-entrada'
const ENDED = 'Sua sessão terminou. Entre e toque de novo.'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(method, path, body) {
  const res = await apiFetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}

let taskId = null
let paused = null
let browser
try {
  taskId = (await api('POST', '/tasks', { title: `${P} tarefa` })).id
  browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 390, height: 860 })
  const cdp = await page.createCDPSession()
  const dropCookie = () => cdp.send('Network.deleteCookies', { name: 'sf_session', domain: new URL(APP).hostname })
  const hasCookie = async () => (await cdp.send('Network.getCookies', { urls: [APP] })).cookies.some((c) => c.name === 'sf_session')
  const dialogs = () => page.$$eval('[role="dialog"]', (d) => d.length)
  const activeInfo = () => page.evaluate(() => {
    const a = document.activeElement
    return { type: a?.getAttribute('type') ?? '', name: a?.getAttribute('name') ?? '', text: a?.textContent?.trim() ?? '', inDialog: !!a?.closest('[role="dialog"]'), isBody: a === document.body, inInert: !!a?.closest('[inert]') }
  })
  const bodyText = () => page.evaluate(() => document.body.textContent.replace(/\s+/g, ' '))
  const appOpen = () => page.evaluate(() => !!document.querySelector('nav a[href="/executar"]'))
  // Rotas falsas (só as que a bateria escolhe), por padrão de método + caminho
  let fake = null
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const hit = fake?.(req)
    if (hit === 'abort') return void req.abort()
    if (hit?.delay) return void setTimeout(() => req.continue(), hit.delay)
    if (hit) return void req.respond(hit)
    req.continue()
  })
  const typePassword = async (value) => {
    const sel = '[role="dialog"] input[type="password"], main input[type="password"]'
    await page.$eval(sel, (i) => i.select())
    await page.type(sel, value)
    await page.keyboard.press('Enter')
  }
  const waitFor = (fn, ms = 5000, ...args) => page.waitForFunction(fn, { timeout: ms }, ...args)

  // ===== 1. sem sessão
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
  check('sem sessão: a entrada é a página inteira, sem o app e sem diálogo', !(await appOpen()) && (await dialogs()) === 0 && (await page.$('main input[type="password"]')) !== null)
  let act = await activeInfo()
  check('foco na senha ao abrir', act.type === 'password', JSON.stringify(act))
  const user = await page.$eval('input[autocomplete="username"]', (i) => ({ value: i.value, tab: i.tabIndex, form: !!i.form && i.form === document.querySelector('input[type="password"]').form })).catch(() => null)
  check('usuário invisível no mesmo formulário: autocomplete="username", valor fixo, fora do Tab', user?.value === 'studyflow' && user.tab === -1 && user.form, JSON.stringify(user))
  const pw = await page.$eval('input[type="password"]', (i) => i.autocomplete)
  check('senha com autocomplete="current-password"', pw === 'current-password', pw)
  await typePassword(`${P}-errada`)
  await waitFor(() => document.querySelector('[role="alert"]')).catch(() => {})
  const wrongText = await page.evaluate(() => document.querySelector('[role="alert"]')?.textContent.trim())
  check('senha errada: "Senha incorreta." (o motivo do servidor), continua na entrada, sem o texto de sessão vencida', wrongText === 'Senha incorreta.' && !(await appOpen()) && !(await bodyText()).includes(ENDED) && (await dialogs()) === 0, wrongText)
  await typePassword(process.env.TEST_PASSWORD)
  await waitFor(() => !!document.querySelector('nav a[href="/executar"]'), 8000)
  check('senha certa: o app abre e o cookie fica', (await appOpen()) && (await hasCookie()))

  // ===== 2. servidor lento e fora do ar
  fake = (req) => (req.url().endsWith('/api/session') ? { delay: 4500 } : null)
  const slowAt = Date.now()
  await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' })
  await pause(1500)
  const early = (await bodyText()).includes('Acordando o servidor')
  await waitFor(() => document.body.textContent.includes('Acordando o servidor'), 4000).catch(() => {})
  const lateMs = Date.now() - slowAt
  check('servidor lento: nada antes de 3 s, "Acordando o servidor…" depois', !early && (await bodyText()).includes('Acordando o servidor…') && lateMs >= 2900, `cedo=${early} ${lateMs} ms`)
  await waitFor(() => !!document.querySelector('nav a[href="/executar"]'), 8000)
  check('servidor lento: o app abre quando a resposta chega', await appOpen())
  fake = (req) => (req.url().endsWith('/api/session') ? 'abort' : null)
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
  check('servidor fora do ar: "Não foi possível falar com o servidor." com Tentar de novo', (await bodyText()).includes('Não foi possível falar com o servidor.'))
  fake = null
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Tentar de novo').click())
  await waitFor(() => !!document.querySelector('nav a[href="/executar"]'), 8000)
  check('Tentar de novo: o app abre', await appOpen())

  // ===== 3. sessão vencida no meio do uso
  await page.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'networkidle0' })
  const desc = await page.evaluateHandle(() => [...document.querySelectorAll('label span')].find((s) => s.textContent.trim() === 'O que foi feito (opcional)')?.closest('label').querySelector('textarea, input'))
  await desc.asElement().type(`${P} registro`)
  await pause(400)
  const draftKey = `studyflow:rascunho:registrar:${taskId}`
  const draftBefore = await page.evaluate((k) => sessionStorage.getItem(k) !== null, draftKey)
  await dropCookie()
  let posts = 0
  page.on('request', (req) => { if (req.method() === 'POST' && req.url().endsWith('/api/executions')) posts++ })
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Registrar')
    b.focus()
    b.click()
  })
  await waitFor(() => !!document.querySelector('[role="dialog"]')).catch(() => {})
  check('401 ao registrar: um diálogo por cima do app, o resto inert', (await dialogs()) === 1 && (await page.evaluate(() => !!document.querySelector('[inert] nav a[href="/executar"]') && !document.querySelector('[role="dialog"]').closest('[inert]'))))
  act = await activeInfo()
  check('diálogo: foco na senha', act.type === 'password' && act.inDialog, JSON.stringify(act))
  const visits = []
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); visits.push(await activeInfo()) }
  for (let i = 0; i < 8; i++) { await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift'); visits.push(await activeInfo()) }
  check('Tab e Shift+Tab ficam no diálogo (nada do app recebe foco)', visits.every((v) => v.inDialog || v.isBody) && visits.some((v) => v.inDialog) && !visits.some((v) => v.inInert), JSON.stringify(visits.filter((v) => !v.inDialog).slice(0, 3)))
  await page.keyboard.press('Escape')
  await pause(200)
  check('Escape não fecha o diálogo', (await dialogs()) === 1)
  const kept = await page.evaluate(() => [...document.querySelectorAll('label span')].find((s) => s.textContent.trim() === 'O que foi feito (opcional)')?.closest('label').querySelector('textarea, input').value)
  check('o texto digitado continua no formulário atrás do diálogo', kept === `${P} registro`, kept)
  await typePassword(process.env.TEST_PASSWORD)
  await waitFor(() => !document.querySelector('[role="dialog"]'), 8000)
  await pause(150)
  act = await activeInfo()
  check('entrar fecha o diálogo, tira o inert e o foco volta pro botão tocado', !(await page.$('[inert]')) && act.text === 'Registrar', JSON.stringify(act))
  const draftAfter = await page.evaluate((k) => sessionStorage.getItem(k) !== null, draftKey)
  check('o 401 mantém o rascunho da sessão do navegador', draftBefore && draftAfter, `${draftBefore} ${draftAfter}`)
  check('nada foi reenviado sozinho (1 POST, o recusado)', posts === 1 && (await pool.query('SELECT count(*)::int AS n FROM task_executions WHERE task_id = $1', [taskId])).rows[0].n === 0, String(posts))

  // Dois 401 juntos (o Painel pede vários de uma vez): um diálogo só
  await dropCookie()
  let dash = 0
  page.on('request', (req) => { if (req.url().includes('/api/dashboard/')) dash++ })
  await page.evaluate(() => document.querySelector('nav a[href="/painel"]').click())
  await waitFor(() => !!document.querySelector('[role="dialog"]'))
  await pause(800)
  check('vários 401 juntos: um diálogo só', dash >= 2 && (await dialogs()) === 1, `${dash} pedidos, ${await dialogs()} diálogos`)
  await typePassword(process.env.TEST_PASSWORD)
  await waitFor(() => !document.querySelector('[role="dialog"]'), 8000)

  // ===== 4. Pausar e Finalizar com 401
  paused = await pauseRunning(pool)
  const open = await api('POST', '/executions', { taskId, completedAt: null })
  await api('POST', '/time-entries', { taskExecutionId: open.id, startedAt: new Date(Date.now() - 60e3).toISOString() })
  await page.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'networkidle0' })
  await dropCookie()
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Pausar').click())
  await waitFor(() => !!document.querySelector('[role="dialog"]'))
  await pause(300)
  check(`Pausar com 401: "${ENDED}"`, (await page.evaluate(() => [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent.trim()))).some((t) => t.startsWith(ENDED)), (await bodyText()).slice(0, 200))
  await typePassword(process.env.TEST_PASSWORD)
  await waitFor(() => !document.querySelector('[role="dialog"]'), 8000)
  await dropCookie()
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Finalizar').click())
  await waitFor(() => !!document.querySelector('[role="dialog"]'))
  await pause(300)
  const finishErr = await page.evaluate(() => [...document.querySelectorAll('[inert] [role="alert"]')].map((a) => a.textContent.trim()))
  check(`Finalizar com 401: "${ENDED}" no formulário`, finishErr.includes(ENDED), JSON.stringify(finishErr))
  await typePassword(process.env.TEST_PASSWORD)
  await waitFor(() => !document.querySelector('[role="dialog"]'), 8000)
  const still = (await pool.query('SELECT completed_at FROM task_executions WHERE id = $1', [open.id])).rows[0]
  check('Pausar e Finalizar recusados: o registro continua aberto, a sessão rodando', still?.completed_at === null && (await pool.query('SELECT count(*)::int AS n FROM time_entries WHERE task_execution_id = $1 AND ended_at IS NULL', [open.id])).rows[0].n === 1)

  // ===== 5. o 429 do login
  await dropCookie()
  fake = (req) => (req.method() === 'POST' && req.url().endsWith('/api/login') ? { status: 429, contentType: 'application/json', headers: { 'Retry-After': '3' }, body: '{"error":"Muitos pedidos. Espere um pouco."}' } : null)
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
  await typePassword('qualquer')
  await waitFor(() => document.body.textContent.includes('Tente de novo em'))
  const during = await page.evaluate(() => ({ text: document.querySelector('[role="status"]')?.textContent.trim(), disabled: document.querySelector('button[type="submit"]').disabled }))
  check('429 do login: "Muitos pedidos. Tente de novo em 3 s." e o botão desligado', during.text === 'Muitos pedidos. Tente de novo em 3 s.' && during.disabled, JSON.stringify(during))
  fake = null
  await pause(1300)
  const counting = await page.evaluate(() => document.querySelector('[role="status"]')?.textContent.trim())
  await waitFor(() => !document.querySelector('button[type="submit"]').disabled, 4000).catch(() => {})
  const after = await page.evaluate(() => ({ text: document.body.textContent.includes('Tente de novo em'), disabled: document.querySelector('button[type="submit"]').disabled }))
  check('429 do login: a contagem desce e o botão volta sozinho', /em [12] s\.$/.test(counting ?? '') && !after.text && !after.disabled, `${counting} ${JSON.stringify(after)}`)
  check('429 do login não abre o diálogo de sessão vencida', (await dialogs()) === 0)
  await typePassword(process.env.TEST_PASSWORD)
  await waitFor(() => !!document.querySelector('nav a[href="/executar"]'), 8000)

  // ===== 6. Sair
  await page.evaluate(() => sessionStorage.setItem('studyflow:rascunho:registrar:x', '{}'))
  await page.goto(`${APP}/tags`, { waitUntil: 'networkidle0' })
  const last = await page.evaluate(() => { const b = [...document.querySelectorAll('main button')]; return b[b.length - 1]?.textContent.trim() })
  check('Sair é o último botão da tela de tags', last === 'Sair', last)
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Sair').click())
  await waitFor(() => !!document.querySelector('main input[type="password"]') && !document.querySelector('nav a[href="/executar"]'), 8000)
  const keys = await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('studyflow:')))
  check('Sair: a entrada de volta, cookie apagado, rascunhos apagados', !(await hasCookie()) && keys.length === 0 && (await dialogs()) === 0, `${await hasCookie()} ${JSON.stringify(keys)}`)
  const res = await page.evaluate(async () => (await fetch('/api/tags', { headers: { 'X-StudyFlow': '1' } })).status)
  check('Sair: a página não tem mais sessão (401)', res === 401, String(res))
} catch (err) {
  check('rodou sem erro', false, err.stack ?? String(err))
} finally {
  await browser?.close()
  if (taskId) {
    await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [taskId])).rows.map((r) => r.id))
    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId])
  }
  if (paused) await resumeRunning(pool, paused)
  const left = (await pool.query(`SELECT (SELECT count(*) FROM tasks WHERE title LIKE $1)::int + (SELECT count(*) FROM task_executions WHERE description LIKE $1)::int AS n`, [`${P}%`])).rows[0].n
  const running = (await pool.query('SELECT count(*)::int AS n FROM time_entries WHERE ended_at IS NULL')).rows[0].n
  check('limpeza: tarefa e registros de teste apagados, a sessão do seed rodando', left === 0 && running === (paused?.length ?? 1), `${left} ${running}`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
