// Duração estimada com segundos (Registrar e lápis do registro): "90" = 90 min,
// "a:b" = min:s, "h:mm:ss"; de 1 s a 24 h. Embaixo do campo, o que foi
// entendido ("= 1 min 22 s"), e a dica com o campo vazio. Teclado de texto
// (sem inputmode numérico, sem step). O lápis abre "20" (minuto inteiro) ou
// "1:22", e sem mexer não manda a estimativa. O "Durou" do Finalizar continua
// em minutos inteiros. Navegador em pt-BR e en-US. Duração conferida no banco.
// Dados próprios (prefixo teste-estimativa-t), apagados no fim; pausa a sessão
// do seed e devolve. Uso (raiz do repo):
//   node --env-file=backend/.env tests/telas/estimativa-segundos.mjs
import puppeteer from 'puppeteer-core'
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
import { deleteExecutions, pauseRunning, resumeRunning } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-estimativa-t'
const LABEL = 'Duração estimada (opcional)'
const ERROR = 'Duração: minutos (90), min:s (1:22) ou h:mm:ss (1:07:10), até 24 horas'
const HINT = 'Minutos, ou min:s'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitForApi() {
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(`${API}/tasks`)).ok) return } catch {}
    await pause(1000)
  }
  throw new Error('API não respondeu em 30s')
}
async function api(method, path, body) {
  await waitForApi()
  const res = await fetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}
// A estimada do registro no banco, em segundos (com fração), e se termina no "Quando"
async function estimateOf(id) {
  const r = await pool.query(
    `SELECT extract(epoch FROM te.ended_at - te.started_at)::float8 AS seconds, te.ended_at = e.completed_at AS anchored
     FROM time_entries te JOIN task_executions e ON e.id = te.task_execution_id
     WHERE te.task_execution_id = $1 AND te.estimated`, [id])
  return r.rows
}
const byDescription = async (d) => (await pool.query('SELECT id, completed_at FROM task_executions WHERE description = $1', [d])).rows

const seedSession = await pauseRunning(pool)
let taskId = null
let browser
try {
  taskId = (await api('POST', '/tasks', { title: `${P} tarefa` })).id
  browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })

  for (const lang of ['pt-BR', 'en-US']) {
    const page = await browser.newPage()
    page.setDefaultTimeout(10000)
    await page.setExtraHTTPHeaders({ 'Accept-Language': lang })
    await page.evaluateOnNewDocument((l) => {
      Object.defineProperty(navigator, 'language', { get: () => l })
      Object.defineProperty(navigator, 'languages', { get: () => [l] })
    }, lang)
    await page.setViewport({ width: 375, height: 900 })
    const posts = []
    const puts = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/executions$/.test(req.url())) posts.push(JSON.parse(req.postData()))
      if (req.method() === 'PUT' && /\/executions\/[0-9a-f-]+$/.test(req.url())) puts.push(JSON.parse(req.postData()))
    })
    // O campo da estimativa dentro de um escopo: atributos, valor e a linha de baixo
    const field = (s) => page.evaluate((sel, l) => {
      const lab = [...document.querySelector(sel).querySelectorAll('label')].find((x) => x.querySelector('span')?.textContent.trim() === l)
      if (!lab) return null
      const input = lab.querySelector('input')
      const note = lab.querySelector('[data-estimate-note]')
      return {
        type: input.type, inputMode: input.getAttribute('inputmode'), step: input.getAttribute('step'),
        autoCapitalize: input.getAttribute('autocapitalize'), autoCorrect: input.getAttribute('autocorrect'),
        spellCheck: input.getAttribute('spellcheck'), autoComplete: input.getAttribute('autocomplete'),
        describedBy: input.getAttribute('aria-describedby') === note?.id && !!note?.id,
        live: note?.getAttribute('aria-live'), value: input.value, note: note?.textContent ?? null,
        noteBelow: !!note && note.getBoundingClientRect().top >= input.getBoundingClientRect().bottom,
      }
    }, s, LABEL)
    // Digita de verdade (teclado), apagando o que havia
    const typeIn = async (s, label, text) => {
      const handle = await page.evaluateHandle((sel, l) => [...document.querySelector(sel).querySelectorAll('label')]
        .find((x) => x.querySelector('span')?.textContent.trim() === l).querySelector('input'), s, label)
      await handle.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.focus(); el.select() })
      await page.keyboard.press('Backspace')
      if (text) await handle.type(text)
      await pause(80)
    }
    const clickIn = (s, text) => page.evaluate((sel, t) => {
      const f = document.querySelector(sel)
      ;[...document.querySelectorAll('button')].filter((b) => f.contains(b) || b.form === f).find((b) => b.textContent.trim().startsWith(t)).click()
    }, s, text)
    const goRegister = async () => {
      await waitForApi()
      await page.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'networkidle0' })
      await page.evaluate(() => sessionStorage.clear())
      await page.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'networkidle0' })
      await page.evaluate(() => [...document.querySelectorAll('form')].find((f) =>
        [...f.querySelectorAll('label span')].some((x) => x.textContent.trim() === 'Quando')).setAttribute('data-form', 'r'))
      return '[data-form="r"]'
    }
    const register = async (form, description, text) => {
      await typeIn(form, 'O que foi feito (opcional)', description)
      await typeIn(form, LABEL, text)
      posts.length = 0
      await clickIn(form, 'Registrar')
      await page.waitForFunction(() => location.pathname === '/', { timeout: 5000 })
      await pause(300)
      return (await byDescription(description))[0]
    }

    // ---------- 1. o campo: teclado de texto, sem step, sem correção; dica com o campo vazio
    let form = await goRegister()
    let f = await field(form)
    check(`${lang} Registrar: rótulo "${LABEL}"`, f !== null, 'campo não achado pelo rótulo')
    check(`${lang} teclado de texto: type=text, sem inputmode, sem step`, f?.type === 'text' && f.inputMode === null && f.step === null, JSON.stringify(f))
    check(`${lang} sem correção: autocapitalize none, autocorrect off, spellcheck false, autocomplete off`,
      f?.autoCapitalize === 'none' && f.autoCorrect === 'off' && f.spellCheck === 'false' && f.autoComplete === 'off', JSON.stringify(f))
    check(`${lang} vazio: a dica "${HINT}" embaixo do campo, ligada por aria-describedby`, f?.note === HINT && f.noteBelow && f.describedBy && f.live === 'polite', JSON.stringify(f))

    // ---------- 2. o que foi entendido, a cada digitação
    const echo = [
      ['45', '= 45 min'], ['90', '= 1 h 30 min'], ['1:22', '= 1 min 22 s'], ['0:30', '= 30 s'],
      ['67:10', '= 1 h 7 min 10 s'], ['1:07:10', '= 1 h 7 min 10 s'], ['24:00:00', '= 24 h'], ['1440', '= 24 h'],
      [' 1:22 ', '= 1 min 22 s'],
    ]
    const wrong = []
    for (const [text, expected] of echo) {
      await typeIn(form, LABEL, text)
      const got = (await field(form)).note
      if (got !== expected) wrong.push(`${text} → ${got}`)
    }
    check(`${lang} eco: ${echo.length} formas lidas certo ("45" = 45 min, "1:22" = 1 min 22 s, h:mm:ss)`, wrong.length === 0, wrong.join('; '))
    const invalid = ['1:5', '1:60', '1:2:3', '4,5', '4.5', '0', '0:00', '24:00:01', '1441', 'abc', ':30', '1:']
    const echoed = []
    for (const text of invalid) {
      await typeIn(form, LABEL, text)
      const got = (await field(form)).note
      if (got !== '') echoed.push(`${text} → ${got}`)
    }
    check(`${lang} inválido: sem eco (${invalid.length} formas)`, echoed.length === 0, echoed.join('; '))

    // ---------- 3. inválido barra na tela, sem pedido
    for (const text of ['1:5', '24:00:01', '4,5']) {
      form = await goRegister()
      await typeIn(form, 'O que foi feito (opcional)', `${P} ${lang} inválido`)
      await typeIn(form, LABEL, text)
      posts.length = 0
      await clickIn(form, 'Registrar')
      await pause(600)
      const shown = await page.evaluate(() => document.body.innerText)
      check(`${lang} "${text}": recusado com a frase, nada gravado`, shown.includes(ERROR) && posts.length === 0 && (await byDescription(`${P} ${lang} inválido`)).length === 0, `${posts.length} pedidos`)
    }

    // ---------- 4. gravar: 1:22 = 82 s, 1:07:10 = 4030 s, 45 = 2700 s; terminando no "Quando"
    for (const [text, seconds] of [['1:22', 82], ['1:07:10', 4030], ['45', 2700]]) {
      form = await goRegister()
      const rec = await register(form, `${P} ${lang} ${text}`, text)
      const est = rec ? await estimateOf(rec.id) : []
      check(`${lang} Registrar "${text}": manda estimatedSeconds ${seconds}, banco com ${seconds} s exatos`,
        posts.length === 1 && posts[0].estimatedSeconds === seconds && posts[0].estimatedMinutes === undefined &&
        est.length === 1 && est[0].seconds === seconds && est[0].anchored, `${JSON.stringify(posts)} ${JSON.stringify(est)}`)
    }

    // ---------- 5. rascunho com "30" (o texto de sempre) volta e vale 30 min
    form = await goRegister()
    await typeIn(form, 'O que foi feito (opcional)', `${P} ${lang} rascunho`)
    await typeIn(form, LABEL, '30')
    await pause(400)
    await page.reload({ waitUntil: 'networkidle0' })
    await page.evaluate(() => [...document.querySelectorAll('form')].find((f) =>
      [...f.querySelectorAll('label span')].some((x) => x.textContent.trim() === 'Quando')).setAttribute('data-form', 'r'))
    f = await field(form)
    check(`${lang} rascunho com "30" volta com o eco "= 30 min"`, f?.value === '30' && f.note === '= 30 min', JSON.stringify(f))
    posts.length = 0
    await clickIn(form, 'Registrar')
    await page.waitForFunction(() => location.pathname === '/', { timeout: 5000 })
    await pause(300)
    let rec = (await byDescription(`${P} ${lang} rascunho`))[0]
    check(`${lang} o rascunho registra 1800 s`, rec && (await estimateOf(rec.id))[0]?.seconds === 1800, JSON.stringify(posts))
    await page.close()
  }

  // ---------- 6. lápis do registro (pt-BR): abre "1:22" / "20" / "1:07:10"; sem mexer não manda
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 375, height: 900 })
  const puts = []
  page.on('request', (req) => {
    if (req.method() === 'PUT' && /\/executions\/[0-9a-f-]+$/.test(req.url())) puts.push(JSON.parse(req.postData()))
  })
  const quando = new Date(Date.now() - 3 * 3600_000)
  quando.setSeconds(12, 345)
  const made = {}
  for (const [key, body] of [['82', { estimatedSeconds: 82 }], ['20min', { estimatedMinutes: 20 }], ['4030', { estimatedSeconds: 4030 }]]) {
    made[key] = await api('POST', '/executions', { taskId, description: `${P} lápis ${key}`, completedAt: quando.toISOString(), ...body })
  }
  const openPencil = async (description) => {
    await waitForApi()
    await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => sessionStorage.clear())
    await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
    await page.evaluate((d) => {
      const a = [...document.querySelectorAll('article')].find((x) => x.textContent.includes(d))
      a.setAttribute('data-card', '1')
      a.scrollIntoView({ block: 'center' })
      a.querySelector('button[aria-label^="Editar registro"]').click()
    }, description)
    await page.waitForSelector('[data-card="1"] form')
    return '[data-card="1"] form'
  }
  const editField = (s) => page.evaluate((sel, l) => {
    const lab = [...document.querySelector(sel).querySelectorAll('label')].find((x) => x.querySelector('span')?.textContent.trim() === l)
    return lab ? { value: lab.querySelector('input').value, note: lab.querySelector('[data-estimate-note]')?.textContent ?? null } : null
  }, s, LABEL)
  const save = async (s) => {
    puts.length = 0
    await page.evaluate((sel) => {
      const f = document.querySelector(sel)
      ;[...document.querySelectorAll('button')].filter((b) => f.contains(b) || b.form === f).find((b) => b.textContent.trim() === 'Salvar').click()
    }, s)
    await page.waitForFunction(() => !document.querySelector('[data-card="1"] form'), { timeout: 5000 }).catch(() => {})
    await pause(400)
  }
  const typeEdit = async (s, label, text) => {
    const handle = await page.evaluateHandle((sel, l) => [...document.querySelector(sel).querySelectorAll('label')]
      .find((x) => x.querySelector('span')?.textContent.trim() === l).querySelector('input'), s, label)
    await handle.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.focus(); el.select() })
    await page.keyboard.press('Backspace')
    if (text) await handle.type(text)
    await pause(80)
  }

  let s = await openPencil(`${P} lápis 82`)
  let e = await editField(s)
  check('lápis: 82 s abre "1:22", com o eco "= 1 min 22 s"', e?.value === '1:22' && e.note === '= 1 min 22 s', JSON.stringify(e))
  await typeEdit(s, 'O que foi feito (opcional)', `${P} lápis 82 editado`)
  await save(s)
  let est = await estimateOf(made['82'].id)
  check('lápis, só a descrição: não manda a estimativa, e ela fica com 82 s',
    puts.length === 1 && !('estimatedSeconds' in puts[0]) && !('estimatedMinutes' in puts[0]) && est[0]?.seconds === 82 && est[0].anchored,
    `${JSON.stringify(puts)} ${JSON.stringify(est)}`)

  s = await openPencil(`${P} lápis 20min`)
  e = await editField(s)
  check('lápis: 20 min abre "20" (minuto inteiro), eco "= 20 min"', e?.value === '20' && e.note === '= 20 min', JSON.stringify(e))
  await typeEdit(s, LABEL, '2:05')
  await save(s)
  est = await estimateOf(made['20min'].id)
  check('lápis: trocar pra "2:05" manda 125 s e grava 125 s', puts.length === 1 && puts[0].estimatedSeconds === 125 && est[0]?.seconds === 125, `${JSON.stringify(puts)} ${JSON.stringify(est)}`)

  s = await openPencil(`${P} lápis 4030`)
  e = await editField(s)
  check('lápis: 4030 s abre "1:07:10"', e?.value === '1:07:10' && e.note === '= 1 h 7 min 10 s', JSON.stringify(e))
  await typeEdit(s, LABEL, '1:60')
  puts.length = 0
  await page.evaluate((sel) => {
    const f = document.querySelector(sel)
    ;[...document.querySelectorAll('button')].filter((b) => f.contains(b) || b.form === f).find((b) => b.textContent.trim() === 'Salvar').click()
  }, s)
  await pause(600)
  const shown = await page.evaluate((sel) => document.querySelector(sel).closest('article').innerText, s)
  est = await estimateOf(made['4030'].id)
  check('lápis: "1:60" barra com a frase, sem pedido, estimativa intacta', shown.includes(ERROR) && puts.length === 0 && est[0]?.seconds === 4030, `${puts.length}`)
  await typeEdit(s, LABEL, '')
  await save(s)
  check('lápis: campo vazio remove a estimativa', puts.length === 1 && puts[0].estimatedSeconds === null && (await estimateOf(made['4030'].id)).length === 0, JSON.stringify(puts))

  // ---------- 7. o "Durou" do Finalizar continua em minutos inteiros (sem mutação, regressão)
  const open = await api('POST', '/executions', { taskId, description: `${P} durou`, completedAt: null })
  await api('POST', '/time-entries', { taskExecutionId: open.id, startedAt: new Date(Date.now() - 30 * 60_000).toISOString() })
  await page.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Finalizar'))
  await page.evaluate(() => document.querySelector('main form [data-duration-field] button').click())
  await pause(150)
  const durou = await page.$('main form [data-duration-field] input')
  const durouMode = await durou.evaluate((el) => el.getAttribute('inputmode'))
  await durou.type('1:22')
  puts.length = 0
  await page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Finalizar').click())
  await pause(500)
  const durouError = await page.evaluate(() => document.querySelector('main [role="alert"]')?.textContent.trim() ?? '')
  const still = (await pool.query('SELECT completed_at FROM task_executions WHERE id = $1', [open.id])).rows[0]
  check('"Durou" segue em minutos: "1:22" barra com a frase de sempre, sem pedido, teclado numérico',
    durouError === 'Durou: minutos inteiros, de 1 a 1440.' && puts.length === 0 && still.completed_at === null && durouMode === 'numeric',
    `${durouError} ${puts.length} ${durouMode}`)
  await pool.query('UPDATE time_entries SET ended_at = now() WHERE task_execution_id = $1 AND ended_at IS NULL', [open.id])
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  if (browser) await browser.close()
  await waitForApi()
  if (taskId) {
    await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL AND task_execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)', [taskId])
    await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [taskId])).rows.map((r) => r.id))
    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId])
  }
  await resumeRunning(pool, seedSession)
  const left = await pool.query(`SELECT (SELECT count(*) FROM tasks WHERE title LIKE $1)::int + (SELECT count(*) FROM task_executions WHERE description LIKE $1)::int AS n`, [`${P}%`])
  const running = await pool.query('SELECT count(*)::int AS n FROM time_entries WHERE ended_at IS NULL')
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  check('sessão do seed devolvida', running.rows[0].n === seedSession.length, `${running.rows[0].n} x ${seedSession.length}`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
