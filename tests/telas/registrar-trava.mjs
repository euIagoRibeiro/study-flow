// Commit 2d: uma ação por vez no Registrar e no Iniciar. (1) Enter duplo, clique duplo e envio duplo no mesmo instante
// no "Registrar" (do pé e do aviso do Iniciar): UM pedido, UM registro; o botão fica aria-disabled (sem disabled) e o foco
// fica nele. (2) O "Iniciar cronômetro" também (aria-disabled durante a partida, foco mantido). (3) Registrar em voo barra
// o "Iniciar mesmo assim" e o contrário (senão sairiam um registro e um cronômetro). (4) Se o 1º envio falha, o 2º
// funciona; validação inválida não prende a trava. (5) Com o aviso aberto, a falha do Registrar fecha o aviso e leva o
// foco à mensagem de erro (role="alert"), dentro da tela, também na 2ª falha com a mesma mensagem. Tarefa de teste
// própria, apagada no finally com tudo o que criou. Uso (pela raiz de tests/): npm run telas -- registrar-trava.mjs
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
import { launch } from '../sessao.mjs'
import { deleteExecutions } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) throw new Error('rodar com --env-file=../backend/.env (npm run telas)')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const TITLE = 'Teste 2d registrar trava'

// A sessão rodando do seed barraria o Iniciar: pausada aqui e devolvida no finally
const paused = (await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL RETURNING id')).rows.map((r) => r.id)
await pool.query('DELETE FROM tasks WHERE title = $1 AND id NOT IN (SELECT task_id FROM task_executions)', [TITLE])
const taskId = (await pool.query("INSERT INTO tasks (title, frequency) VALUES ($1, 'none') RETURNING id", [TITLE])).rows[0].id

async function clearExecutions() {
  const ids = (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [taskId])).rows.map((r) => r.id)
  await deleteExecutions(pool, ids)
}
// Registros da tarefa como o banco os tem: concluídos, abertos e sessões
const rows = async () => (await pool.query(
  `SELECT count(*) FILTER (WHERE e.completed_at IS NOT NULL)::int AS concluidos,
          count(*) FILTER (WHERE e.completed_at IS NULL)::int AS abertos,
          (SELECT count(*)::int FROM time_entries te JOIN task_executions x ON x.id = te.task_execution_id WHERE x.task_id = $1 AND te.ended_at IS NULL) AS rodando
   FROM task_executions e WHERE e.task_id = $1`, [taskId])).rows[0]

const browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 390, height: 900 })
  // hold: segura o POST /executions por N ms; fail: 'none' | '500' (erro genérico) | '400' (recusa com motivo)
  let hold = 0
  let fail = 'none'
  const posts = { exec: 0, entry: 0 }
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const post = req.method() === 'POST'
    if (post && req.url() === `${API}/executions`) {
      posts.exec++
      if (fail !== 'none') {
        const status = fail === '500' ? 500 : 400
        const body = fail === '500' ? '{"error":"falha"}' : '{"error":"A tag Teste está arquivada"}'
        return req.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body })
      }
      if (hold > 0) return setTimeout(() => req.continue(), hold)
    }
    if (post && req.url() === `${API}/time-entries`) posts.entry++
    req.continue()
  })
  const url = `${APP}/executar?tarefa=${taskId}`
  const fresh = async () => {
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.evaluate(() => sessionStorage.clear())
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.waitForSelector('main form[id^="registrar-"]')
    posts.exec = 0
    posts.entry = 0
  }
  const setValue = (labelStart, value) => page.evaluate((l, v) => {
    const el = [...document.querySelectorAll('label')].find((x) => x.querySelector('span')?.textContent.trim().startsWith(l)).querySelector('input, textarea')
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, labelStart, value)
  // Estado de um botão: aria-disabled, disabled, foco
  const btn = (finder) => page.evaluate((src) => {
    const find = new Function(`return (${src})`)()
    const b = find()
    return b ? { aria: b.getAttribute('aria-disabled'), disabledAttr: b.hasAttribute('disabled'), focused: document.activeElement === b, text: b.textContent.trim() } : null
  }, finder.toString())
  const footer = () => [...document.querySelectorAll('main form[id^="registrar-"] button[type="submit"]')].find((b) => b.textContent.trim() === 'Registrar')
  const warnRegistrar = () => [...document.querySelectorAll('[role="alert"] button[type="submit"]')].find((b) => b.textContent.trim() === 'Registrar')
  const startBtn = () => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Iniciar cronômetro')
  const anyway = () => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Iniciar mesmo assim')
  const home = () => page.evaluate(() => location.pathname === '/')
  const panelOpen = () => page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Finalizar'))
  const errorState = () => page.evaluate(() => {
    const e = [...document.querySelectorAll('main form [role="alert"]')].find((x) => x.textContent.trim() !== '')
    if (!e) return null
    const r = e.getBoundingClientRect()
    return { text: e.textContent.trim(), focused: document.activeElement === e, inView: r.top >= 0 && r.bottom <= window.innerHeight }
  })
  const warningOpen = () => page.evaluate(() => [...document.querySelectorAll('h3')].some((h) => h.textContent.trim() === 'Isto não vai para o cronômetro'))
  const openWarning = async () => {
    await setValue('Duração estimada', '30')
    await pause(100)
    await page.evaluate((src) => new Function(`return (${src})`)()().click(), startBtn.toString())
    await page.waitForFunction(() => [...document.querySelectorAll('h3')].some((h) => h.textContent.trim() === 'Isto não vai para o cronômetro'))
  }

  // ---- 1. envio duplo no MESMO instante (dois submits síncronos): UM pedido, UM registro
  await fresh()
  hold = 1200
  await page.evaluate((src) => { const b = new Function(`return (${src})`)()(); b.focus(); const f = b.form; f.requestSubmit(); f.requestSubmit() }, footer.toString())
  await pause(300)
  let s = await btn(footer)
  check('em voo: o Registrar do pé fica aria-disabled="true", sem disabled, e mantém o foco', s?.aria === 'true' && s.disabledAttr === false && s.focused === true, JSON.stringify(s))
  await page.waitForFunction(() => location.pathname === '/', { timeout: 8000 }).catch(() => {})
  hold = 0
  let r = await rows()
  check('dois envios no mesmo instante: UM pedido e UM registro concluído', posts.exec === 1 && r.concluidos === 1 && await home(), `${posts.exec} ${JSON.stringify(r)}`)
  await clearExecutions()

  // ---- 2. clique duplo no botão
  await fresh()
  hold = 1200
  await page.evaluate((src) => { const b = new Function(`return (${src})`)()(); b.click(); b.click() }, footer.toString())
  await page.waitForFunction(() => location.pathname === '/', { timeout: 8000 }).catch(() => {})
  hold = 0
  r = await rows()
  check('clique duplo no Registrar: UM pedido e UM registro', posts.exec === 1 && r.concluidos === 1, `${posts.exec} ${JSON.stringify(r)}`)
  await clearExecutions()

  // ---- 3. Enter duplo no campo (o Enter com o botão aria-disabled ainda envia o formulário: quem barra é a ref)
  await fresh()
  hold = 1500
  await page.evaluate(() => [...document.querySelectorAll('label')].find((x) => x.querySelector('span')?.textContent.trim().startsWith('Duração estimada')).querySelector('input').focus())
  await page.keyboard.type('10')
  await page.keyboard.press('Enter')
  await pause(250)
  await page.keyboard.press('Enter')
  await pause(250)
  await page.keyboard.press('Enter')
  s = await btn(footer)
  check('Enter repetido em voo: o botão está aria-disabled e o foco continua no campo (não se perde)', s?.aria === 'true' && s.disabledAttr === false, JSON.stringify(s))
  await page.waitForFunction(() => location.pathname === '/', { timeout: 8000 }).catch(() => {})
  hold = 0
  r = await rows()
  check('Enter duplo/triplo: UM pedido e UM registro', posts.exec === 1 && r.concluidos === 1, `${posts.exec} ${JSON.stringify(r)}`)
  await clearExecutions()

  // ---- 4. o 1º envio falha: erro, botão liberado, foco mantido, e o 2º envio funciona
  await fresh()
  fail = '500'
  await page.evaluate((src) => new Function(`return (${src})`)()().focus(), footer.toString())
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => [...document.querySelectorAll('main form [role="alert"]')].some((x) => x.textContent.includes('Não foi possível registrar')))
  s = await btn(footer)
  check('envio com 500: mensagem na tela, botão liberado (sem aria-disabled) e foco ainda no botão', s?.aria === null && s.disabledAttr === false && s.focused === true, JSON.stringify(s))
  r = await rows()
  check('envio com 500: nada gravado', r.concluidos === 0 && posts.exec === 1, `${posts.exec} ${JSON.stringify(r)}`)
  fail = 'none'
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => location.pathname === '/', { timeout: 8000 }).catch(() => {})
  r = await rows()
  check('2º envio depois da falha funciona: 2 pedidos no total e UM registro', posts.exec === 2 && r.concluidos === 1, `${posts.exec} ${JSON.stringify(r)}`)
  await clearExecutions()

  // ---- 5. validação inválida não prende a trava
  await fresh()
  await setValue('Duração estimada', 'abc')
  await page.evaluate((src) => new Function(`return (${src})`)()().click(), footer.toString())
  await pause(300)
  let e = await errorState()
  check('duração inválida: erro na tela e nenhum pedido', e !== null && posts.exec === 0, JSON.stringify(e))
  await setValue('Duração estimada', '15')
  await page.evaluate((src) => new Function(`return (${src})`)()().click(), footer.toString())
  await page.waitForFunction(() => location.pathname === '/', { timeout: 8000 }).catch(() => {})
  r = await rows()
  check('depois da validação inválida, corrigir e enviar funciona: UM registro', posts.exec === 1 && r.concluidos === 1, `${posts.exec} ${JSON.stringify(r)}`)
  await clearExecutions()

  // ---- 6. Iniciar cronômetro: aria-disabled na partida, foco mantido, UM pedido
  await fresh()
  hold = 1200
  await page.evaluate((src) => { const b = new Function(`return (${src})`)()(); b.focus(); b.click(); b.click() }, startBtn.toString())
  await pause(300)
  s = await btn(startBtn)
  check('em voo: o "Iniciar cronômetro" fica aria-disabled="true", sem disabled, e mantém o foco', s?.aria === 'true' && s.disabledAttr === false && s.focused === true, JSON.stringify(s))
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Finalizar'), { timeout: 8000 }).catch(() => {})
  hold = 0
  r = await rows()
  check('dois toques no Iniciar: UM pedido de registro, UM aberto com a sessão rodando', posts.exec === 1 && r.abertos === 1 && r.rodando === 1 && (await panelOpen()), `${posts.exec} ${JSON.stringify(r)}`)
  await clearExecutions()

  // ---- 7. o Iniciar falha (400 com motivo): botão liberado e o 2º toque inicia
  await fresh()
  fail = '400'
  await page.evaluate((src) => { const b = new Function(`return (${src})`)()(); b.focus(); b.click() }, startBtn.toString())
  await pause(700)
  s = await btn(startBtn)
  check('Iniciar recusado: botão liberado (sem aria-disabled) e foco nele', s?.aria === null && s.disabledAttr === false && s.focused === true, JSON.stringify(s))
  fail = 'none'
  await page.evaluate((src) => new Function(`return (${src})`)()().click(), startBtn.toString())
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Finalizar'), { timeout: 8000 }).catch(() => {})
  r = await rows()
  check('2º toque depois da recusa inicia: 1 aberto com a sessão rodando', r.abertos === 1 && r.rodando === 1 && (await panelOpen()), JSON.stringify(r))
  await clearExecutions()

  // ---- 8. o "Registrar" do aviso: envio duplo = UM registro; aria-disabled e foco no botão do aviso
  await fresh()
  await openWarning()
  hold = 1200
  await page.evaluate((src) => { const b = new Function(`return (${src})`)()(); b.focus(); b.click(); b.click() }, warnRegistrar.toString())
  await pause(300)
  s = await btn(warnRegistrar)
  check('em voo: o "Registrar" do aviso fica aria-disabled="true", sem disabled, e mantém o foco', s?.aria === 'true' && s.disabledAttr === false && s.focused === true, JSON.stringify(s))
  await page.waitForFunction(() => location.pathname === '/', { timeout: 8000 }).catch(() => {})
  hold = 0
  r = await rows()
  check('dois toques no Registrar do aviso: UM pedido e UM registro concluído', posts.exec === 1 && r.concluidos === 1 && r.abertos === 0, `${posts.exec} ${JSON.stringify(r)}`)
  await clearExecutions()

  // ---- 9. bloqueio cruzado: Registrar do aviso em voo barra o "Iniciar mesmo assim"
  await fresh()
  await openWarning()
  hold = 1200
  await page.evaluate((a, b) => { new Function(`return (${a})`)()().click(); new Function(`return (${b})`)()().click() }, warnRegistrar.toString(), anyway.toString())
  const sibling = await btn(anyway)
  check('com o Registrar do aviso em voo, o "Iniciar mesmo assim" também fica aria-disabled', sibling?.aria === 'true' && sibling.disabledAttr === false, JSON.stringify(sibling))
  await page.waitForFunction(() => location.pathname === '/', { timeout: 8000 }).catch(() => {})
  await pause(400)
  hold = 0
  r = await rows()
  check('Registrar e depois "Iniciar mesmo assim" no mesmo instante: só o registro (1 pedido, 1 concluído, nenhum aberto nem sessão)', posts.exec === 1 && posts.entry === 0 && r.concluidos === 1 && r.abertos === 0 && r.rodando === 0, `${posts.exec} ${posts.entry} ${JSON.stringify(r)}`)
  await clearExecutions()

  // ---- 10. o contrário: "Iniciar mesmo assim" em voo barra o Registrar
  await fresh()
  await openWarning()
  hold = 1200
  await page.evaluate((a, b) => { new Function(`return (${b})`)()().click(); new Function(`return (${a})`)()().click() }, warnRegistrar.toString(), anyway.toString())
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Finalizar'), { timeout: 8000 }).catch(() => {})
  await pause(400)
  hold = 0
  r = await rows()
  check('"Iniciar mesmo assim" e depois Registrar no mesmo instante: só o cronômetro (1 pedido, 1 aberto rodando, nenhum concluído)', posts.exec === 1 && r.abertos === 1 && r.rodando === 1 && r.concluidos === 0, `${posts.exec} ${JSON.stringify(r)}`)
  await clearExecutions()

  // ---- 11. Iniciar comum em voo barra o Registrar do pé (e a ordem inversa)
  await fresh()
  hold = 1200
  await page.evaluate((a, b) => { new Function(`return (${a})`)()().click(); new Function(`return (${b})`)()().form.requestSubmit() }, startBtn.toString(), footer.toString())
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Finalizar'), { timeout: 8000 }).catch(() => {})
  await pause(400)
  hold = 0
  r = await rows()
  check('Iniciar e depois Registrar do pé no mesmo instante: só o cronômetro', posts.exec === 1 && r.abertos === 1 && r.rodando === 1 && r.concluidos === 0, `${posts.exec} ${JSON.stringify(r)}`)
  await clearExecutions()

  // ---- 12. falha do Registrar com o aviso aberto: o aviso fecha e o foco vai à mensagem, dentro da tela
  await fresh()
  await openWarning()
  fail = '500'
  await page.evaluate((src) => new Function(`return (${src})`)()().click(), warnRegistrar.toString())
  await page.waitForFunction(() => [...document.querySelectorAll('main form [role="alert"]')].some((x) => x.textContent.includes('Não foi possível registrar')))
  await pause(200)
  e = await errorState()
  check('falha com o aviso aberto: o aviso fecha', !(await warningOpen()), 'o aviso continua aberto')
  check('falha com o aviso aberto: o foco está na mensagem de erro e ela está dentro da tela', e?.focused === true && e.inView === true && e.text.includes('Não foi possível registrar'), JSON.stringify(e))
  check('falha com o aviso aberto: o botão Iniciar volta, liberado', (await btn(startBtn))?.aria === null, JSON.stringify(await btn(startBtn)))
  r = await rows()
  check('falha com o aviso aberto: nada gravado', r.concluidos === 0 && r.abertos === 0, JSON.stringify(r))

  // ---- 13. 2ª falha com a MESMA mensagem: o foco volta à mensagem
  await page.evaluate((src) => new Function(`return (${src})`)()().click(), startBtn.toString())
  await page.waitForFunction(() => [...document.querySelectorAll('h3')].some((h) => h.textContent.trim() === 'Isto não vai para o cronômetro'))
  await pause(150)
  await page.evaluate((src) => new Function(`return (${src})`)()().click(), warnRegistrar.toString())
  await pause(500)
  e = await errorState()
  await page.evaluate((src) => new Function(`return (${src})`)()().click(), startBtn.toString())
  await page.waitForFunction(() => [...document.querySelectorAll('h3')].some((h) => h.textContent.trim() === 'Isto não vai para o cronômetro'))
  const reopened = await btn(warnRegistrar)
  check('depois da falha, o Registrar do aviso reaberto está liberado (sem aria-disabled)', reopened?.aria === null, JSON.stringify(reopened))
  await page.evaluate((src) => new Function(`return (${src})`)()().click(), warnRegistrar.toString())
  await pause(500)
  e = await errorState()
  check('2ª falha com a mesma mensagem: o foco volta à mensagem de erro', e?.focused === true && e.inView === true && !(await warningOpen()), JSON.stringify(e))

  // ---- 14. depois da falha, o Registrar do pé grava UM registro
  fail = 'none'
  await page.evaluate((src) => new Function(`return (${src})`)()().click(), footer.toString())
  await page.waitForFunction(() => location.pathname === '/', { timeout: 8000 }).catch(() => {})
  r = await rows()
  check('depois das falhas, o Registrar do pé grava UM registro', r.concluidos === 1 && r.abertos === 0, JSON.stringify(r))
  await clearExecutions()
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser.close()
  await clearExecutions()
  await pool.query('DELETE FROM tasks WHERE id = $1', [taskId])
  await pool.query('UPDATE time_entries SET ended_at = NULL WHERE id = ANY ($1::uuid[])', [paused])
  const back = (await pool.query('SELECT count(*)::int AS n FROM time_entries WHERE ended_at IS NULL AND id = ANY ($1::uuid[])', [paused])).rows[0].n
  check(`sessão rodando do seed devolvida (${paused.length})`, back === paused.length, `${back} de ${paused.length}`)
  const left = (await pool.query('SELECT (SELECT count(*) FROM tasks WHERE title = $1) + (SELECT count(*) FROM task_executions WHERE task_id = $2) AS n', [TITLE, taskId])).rows[0].n
  check('limpeza: tarefa e registros de teste apagados', Number(left) === 0, String(left))
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
