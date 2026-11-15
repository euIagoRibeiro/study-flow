// Descrição com quebra de linha ("O que foi feito"): campo textarea (Registrar, lápis do
// Histórico e painel do cronômetro) que cresce com o texto, de 2 a 12 linhas, e rola por
// dentro depois disso; o Enter põe uma linha nova e NUNCA envia o formulário. Só se apara as
// pontas (quebras do meio e recuos ficam); só espaços e quebras vira null. Rascunho e memória
// do painel guardam as quebras. O Histórico e o cartão da Lista mostram as quebras.
// Dados próprios (prefixo teste-descricao-t), apagados no fim; pausa a sessão do seed e devolve.
// Uso (raiz do repo): node --env-file=backend/.env tests/telas/descricao-quebra.mjs
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'
import { deleteExecutions, pauseRunning, resumeRunning } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-descricao-t'
const LABEL = 'O que foi feito (opcional)'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitForApi() {
  for (let i = 0; i < 30; i++) {
    try { if ((await apiFetch(`${API}/tasks`)).ok) return } catch {}
    await pause(1000)
  }
  throw new Error('API não respondeu em 30s')
}
async function api(method, path, body) {
  await waitForApi()
  const res = await apiFetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}
const recordsOf = async (taskId) => (await api('GET', '/executions')).filter((e) => e.taskId === taskId)
const byId = async (id) => (await api('GET', '/executions')).find((e) => e.id === id)

const seedSession = await pauseRunning(pool)
const taskIds = []
let browser
try {
  const mkTask = async (name) => {
    const t = await api('POST', '/tasks', { title: `${P} ${name}` })
    taskIds.push(t.id)
    return t.id
  }
  const taskA = await mkTask('registrar')
  const taskB = await mkTask('painel')
  const taskC = await mkTask('só espaços')
  const taskD = await mkTask('lápis')
  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 375, height: 900 })
  const writes = []
  page.on('request', (req) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) writes.push(`${req.method()} ${new URL(req.url()).pathname}`)
  })

  // ---- auxiliares de tela
  const mark = (selector, attr) => page.evaluate((s, a) => document.querySelector(s)?.setAttribute(a, '1'), selector, attr)
  const clearStorage = async (url) => {
    await waitForApi()
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.evaluate(() => sessionStorage.clear())
    await page.goto(url, { waitUntil: 'networkidle0' })
  }
  const registrarUrl = (taskId) => `${APP}/executar?tarefa=${taskId}`
  const markRegistrar = () => page.evaluate(() => [...document.querySelectorAll('form')].find((f) =>
    [...f.querySelectorAll('label span')].some((x) => x.textContent.trim() === 'Quando')).setAttribute('data-form', 'r'))
  // O campo da descrição dentro de um escopo (null se não existe), com o que dá pra ler dele
  const fieldHandle = (scope) => page.evaluateHandle((sel, l) => {
    const root = document.querySelector(sel)
    const lab = [...root.querySelectorAll('label')].find((x) => x.querySelector('span')?.textContent.trim() === l)
    return lab?.querySelector('textarea, input') ?? null
  }, scope, LABEL)
  const info = async (scope) => {
    const h = (await fieldHandle(scope)).asElement()
    if (!h) return null
    return h.evaluate((el) => {
      const cs = getComputedStyle(el)
      return {
        tag: el.tagName, type: el.type, rows: el.rows, value: el.value, height: el.getBoundingClientRect().height,
        lineHeight: parseFloat(cs.lineHeight), extra: parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth),
        scrolls: el.scrollHeight > el.clientHeight + 1, fieldSizing: cs.fieldSizing,
      }
    })
  }
  // Digita de verdade, com Enter entre as linhas; apaga o que havia
  const typeLines = async (scope, lines, { replace = true } = {}) => {
    const h = (await fieldHandle(scope)).asElement()
    await h.evaluate((el, r) => { el.scrollIntoView({ block: 'center' }); el.focus(); if (r) el.select() }, replace)
    if (replace) await page.keyboard.press('Backspace')
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        await page.keyboard.press('Enter')
        if (i === 1) await pause(500)
        if (i === 1 && !(await page.$(scope))) throw new Error('o Enter enviou ou fechou o formulário')
      }
      if (lines[i]) await page.keyboard.type(lines[i])
    }
    await pause(120)
  }
  const click = (scope, text) => page.evaluate((sel, t) => {
    const f = document.querySelector(sel)
    ;[...document.querySelectorAll('button')].filter((b) => f.contains(b) || b.form === f).find((b) => b.textContent.trim().startsWith(t)).click()
  }, scope, text)

  // ---------- 1. Registrar: o campo
  await clearStorage(registrarUrl(taskA))
  await markRegistrar()
  const F = '[data-form="r"]'
  const labelIsInput = await page.evaluate((sel, l) => {
    const lab = [...document.querySelector(sel).querySelectorAll('label')].find((x) => x.querySelector('span')?.textContent.trim() === l)
    return Boolean(lab?.querySelector('input[type="text"]'))
  }, F, LABEL)
  let f = await info(F)
  check('Registrar: o campo da descrição é um textarea de 2 linhas, não input[type=text]', f?.tag === 'TEXTAREA' && f.rows === 2 && !labelIsInput, JSON.stringify(f))
  check('navegador com field-sizing (a altura que cresce só se mede com ele)', f?.fieldSizing === 'content', `${f?.fieldSizing}`)
  const minH = 2 * f.lineHeight + f.extra
  const maxH = 12 * f.lineHeight + f.extra
  check(`vazio: altura mínima de 2 linhas (${minH}px)`, Math.abs(f.height - minH) <= 0.6, `${f.height}px`)
  check('mínimo ≈ 66px (44px de antes + ~22px)', Math.abs(f.height - 66) <= 1, `${f.height}px`)
  await typeLines(F, ['a', 'b', 'c', 'd', 'e'])
  f = await info(F)
  check('5 linhas: o campo cresceu junto (5 linhas)', Math.abs(f.height - (5 * f.lineHeight + f.extra)) <= 0.6 && !f.scrolls, `${f.height}px`)
  const formH12 = await (async () => {
    await typeLines(F, Array.from({ length: 12 }, (_, i) => `linha ${i + 1}`))
    return page.evaluate((s) => document.querySelector(s).getBoundingClientRect().height, F)
  })()
  f = await info(F)
  check(`12 linhas: o máximo (${maxH}px) sem rolagem por dentro`, Math.abs(f.height - maxH) <= 0.6 && !f.scrolls, `${f.height}px`)
  await typeLines(F, Array.from({ length: 60 }, (_, i) => `linha ${i + 1}`))
  f = await info(F)
  const formH60 = await page.evaluate((s) => document.querySelector(s).getBoundingClientRect().height, F)
  check('60 linhas coladas: trava no máximo e rola por dentro', Math.abs(f.height - maxH) <= 0.6 && f.scrolls, `${f.height}px, rola ${f.scrolls}`)
  check('o formulário não cresce além das 12 linhas', Math.abs(formH60 - formH12) <= 0.6, `${formH12}px → ${formH60}px`)
  const noPageScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('sem rolagem lateral com o texto grande', noPageScroll <= 0, `+${noPageScroll}px`)
  // Navegador sem field-sizing: 2 linhas (rows) com rolagem interna, o layout não quebra
  const fixed = await (await fieldHandle(F)).asElement().evaluate((el) => {
    el.style.fieldSizing = 'fixed'
    const r = { height: el.getBoundingClientRect().height, scrolls: el.scrollHeight > el.clientHeight + 1, width: el.getBoundingClientRect().width, form: el.closest('form').getBoundingClientRect().width }
    el.style.fieldSizing = ''
    return r
  })
  check('sem field-sizing: 2 linhas com rolagem interna, na largura do formulário', Math.abs(fixed.height - minH) <= 0.6 && fixed.scrolls && fixed.width <= fixed.form, JSON.stringify(fixed))

  // ---------- 2. Enter: linha nova, nunca envia
  await clearStorage(registrarUrl(taskA))
  await markRegistrar()
  writes.length = 0
  await typeLines(F, ['primeira'])
  await page.keyboard.press('Enter')
  await pause(700)
  const stayed = new URL(page.url()).pathname === '/executar' && writes.length === 0
  check('Enter no campo: nada enviado, continua no Registrar', stayed && (await recordsOf(taskA)).length === 0, `${writes.join(', ')} ${page.url()}`)
  if (!stayed) throw new Error('o Enter enviou o formulário do Registrar')
  await page.keyboard.type('segunda')
  f = await info(F)
  check('Enter no campo: linha nova no texto (primeira, quebra, segunda)', f.value === 'primeira\nsegunda', JSON.stringify(f.value))

  // ---------- 3. Registrar grava só aparado nas pontas
  const raw = ['   ', '  primeira linha  ', '', '    terceira   com   espaços ', '   ']
  await typeLines(F, raw)
  await click(F, 'Registrar')
  await page.waitForFunction(() => location.pathname === '/', { timeout: 5000 })
  await pause(400)
  let made = await recordsOf(taskA)
  check('Registrar: aparou só as pontas; quebras e recuos do meio ficam',
    made.length === 1 && made[0].description === 'primeira linha  \n\n    terceira   com   espaços', JSON.stringify(made[0]?.description))

  // ---------- 4. só espaços e quebras vira null
  await clearStorage(registrarUrl(taskA))
  await markRegistrar()
  await typeLines(F, ['   ', ' ', '  '])
  await click(F, 'Registrar')
  await page.waitForFunction(() => location.pathname === '/', { timeout: 5000 })
  await pause(400)
  made = (await recordsOf(taskA)).filter((e) => e.description === null)
  check('só espaços e quebras: descrição null', made.length === 1, `${made.length} registros sem descrição`)

  // ---------- 5. \r\n colado vira \n
  await clearStorage(registrarUrl(taskA))
  await markRegistrar()
  const h = (await fieldHandle(F)).asElement()
  await h.evaluate((el) => { el.focus(); document.execCommand('insertText', false, 'colado A\r\ncolado B\rcolado C') })
  f = await info(F)
  check('colado com \\r\\n e \\r: o texto do campo só tem \\n', f.value === 'colado A\ncolado B\ncolado C', JSON.stringify(f.value))
  await click(F, 'Registrar')
  await page.waitForFunction(() => location.pathname === '/', { timeout: 5000 })
  await pause(400)
  made = (await recordsOf(taskA)).filter((e) => (e.description ?? '').startsWith('colado A'))
  check('colado com \\r\\n: gravado só com \\n', made.length === 1 && made[0].description === 'colado A\ncolado B\ncolado C', JSON.stringify(made[0]?.description))

  // ---------- 6. rascunho do Registrar guarda as quebras
  await clearStorage(registrarUrl(taskA))
  await markRegistrar()
  await typeLines(F, ['rascunho um', '', '  recuo dois'])
  await pause(500)
  await page.reload({ waitUntil: 'networkidle0' })
  await markRegistrar()
  f = await info(F)
  const notice = await page.evaluate(() => document.body.innerText.includes('Rascunho recuperado'))
  check('rascunho: volta com as quebras e os recuos, com o aviso', f?.value === 'rascunho um\n\n  recuo dois' && notice, JSON.stringify(f?.value))

  // ---------- 7. Histórico e cartão da Lista mostram as quebras
  const MULTI = `${P} exibir\nsegunda linha\n\n    quarta com recuo`
  const shown = await api('POST', '/executions', { taskId: taskD, description: MULTI, completedAt: new Date(Date.now() - 3600e3).toISOString() })
  const measureCard = (desc) => page.evaluate((d) => {
    const first = d.split('\n')[0]
    const art = [...document.querySelectorAll('article')].find((a) => a.textContent.includes(first))
    const p = [...(art?.querySelectorAll('p') ?? [])].find((x) => x.textContent.includes(first))
    if (!p) return null
    const cs = getComputedStyle(p)
    const lh = parseFloat(cs.lineHeight)
    return { ws: cs.whiteSpace, ow: cs.overflowWrap, text: p.textContent, lines: Math.round(p.getBoundingClientRect().height / lh), inner: p.innerText }
  }, desc)
  await clearStorage(`${APP}/historico`)
  let card = await measureCard(MULTI)
  check('Histórico: texto igual ao gravado, com pre-wrap e break-word', card?.text === MULTI && card.ws === 'pre-wrap' && card.ow === 'break-word', JSON.stringify(card))
  check('Histórico: as 4 linhas aparecem (a vazia e o recuo também)', card?.lines === 4, `${card?.lines} linhas`)
  await clearStorage(`${APP}/`)
  const taskTitleD = `${P} lápis`
  await page.evaluate((t) => document.querySelector(`button[aria-label="Mais ações de ${t}"]`).click(), taskTitleD)
  await pause(200)
  await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Ver histórico').click())
  await pause(400)
  card = await measureCard(MULTI)
  check('cartão da Lista: o mesmo componente, com pre-wrap e as 4 linhas', card?.ws === 'pre-wrap' && card.lines === 4 && card.text === MULTI, JSON.stringify(card))

  // ---------- 8. lápis do Histórico
  const openPencil = async () => {
    await clearStorage(`${APP}/historico`)
    await page.evaluate((d) => {
      const first = d.split('\n')[0]
      const a = [...document.querySelectorAll('article')].find((x) => x.textContent.includes(first))
      a.setAttribute('data-card', '1')
      a.scrollIntoView({ block: 'center' })
      a.querySelector('button[aria-label^="Editar registro"]').click()
    }, MULTI)
    await page.waitForSelector('[data-card="1"] form')
    return '[data-card="1"] form'
  }
  let s = await openPencil()
  f = await info(s)
  check('lápis: textarea que abre com as quebras do registro', f?.tag === 'TEXTAREA' && f.value === MULTI, JSON.stringify(f))
  writes.length = 0
  await (await fieldHandle(s)).asElement().evaluate((el) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length) })
  await page.keyboard.press('Enter')
  await page.keyboard.type('quinta linha  ')
  await pause(400)
  check('lápis: Enter não envia, o formulário continua aberto', writes.length === 0 && Boolean(await page.$('[data-card="1"] form')), writes.join(', '))
  await pause(200)
  // rascunho do lápis: recarregar e abrir de novo traz as quebras
  await page.reload({ waitUntil: 'networkidle0' })
  await page.evaluate((d) => {
    const a = [...document.querySelectorAll('article')].find((x) => x.textContent.includes(d.split('\n')[0]))
    a.setAttribute('data-card', '1')
    a.querySelector('button[aria-label^="Editar registro"]').click()
  }, MULTI)
  await page.waitForSelector('[data-card="1"] form')
  f = await info(s)
  check('lápis: o rascunho guarda as quebras (recarregar e reabrir)', f?.value === `${MULTI}\nquinta linha  `, JSON.stringify(f?.value))
  await click(s, 'Salvar')
  await page.waitForFunction(() => !document.querySelector('[data-card="1"] form'), { timeout: 5000 }).catch(() => {})
  await pause(500)
  const saved = await byId(shown.id)
  check('lápis: Salvar grava as 5 linhas, aparadas na ponta', saved?.description === `${MULTI}\nquinta linha`, JSON.stringify(saved?.description))
  card = await measureCard(MULTI)
  check('lápis: o cartão mostra as 5 linhas', card?.lines === 5, `${card?.lines}`)

  // ---------- 9. Iniciar cronômetro leva a descrição; painel; memória; Finalizar
  await clearStorage(registrarUrl(taskB))
  await markRegistrar()
  await typeLines(F, ['  painel um  ', '', 'painel três  '])
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Iniciar cronômetro').click())
  await page.waitForSelector('button[form^="finalizar-"]')
  await pause(600)
  let open = (await recordsOf(taskB))[0]
  check('Iniciar: o registro aberto leva a descrição, aparada, com as quebras', open?.description === 'painel um  \n\npainel três', JSON.stringify(open?.description))
  const PS = 'form[id^="finalizar-"]'
  f = await info(PS)
  check('painel: textarea com o texto do registro', f?.tag === 'TEXTAREA' && f.rows === 2 && f.value === 'painel um  \n\npainel três', JSON.stringify(f))
  writes.length = 0
  await (await fieldHandle(PS)).asElement().evaluate((el) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length) })
  await page.keyboard.press('Enter')
  await page.keyboard.type('painel quatro')
  await pause(500)
  check('painel: Enter não finaliza nem grava', writes.length === 0 && (await recordsOf(taskB))[0].completedAt === null, writes.join(', '))
  await page.reload({ waitUntil: 'networkidle0' })
  f = await info(PS)
  check('painel: a memória da tela guarda as quebras (recarregar)', f?.value === 'painel um  \n\npainel três\npainel quatro', JSON.stringify(f?.value))
  await page.evaluate(() => document.querySelector('button[form^="finalizar-"]').click())
  await pause(1500)
  open = await byId(open.id)
  check('Finalizar grava as 4 linhas (aparado)', open?.completedAt !== null && open.description === 'painel um  \n\npainel três\npainel quatro', JSON.stringify(open?.description))

  // ---------- 10. Iniciar com só espaços e quebras: null
  await clearStorage(registrarUrl(taskC))
  await markRegistrar()
  await typeLines(F, ['  ', '   '])
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Iniciar cronômetro').click())
  await page.waitForSelector('button[form^="finalizar-"]')
  await pause(600)
  const blank = (await recordsOf(taskC))[0]
  check('Iniciar com só espaços e quebras: descrição null', blank && blank.description === null, JSON.stringify(blank?.description))
  await page.close()
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  if (browser) await browser.close()
  await waitForApi()
  for (const taskId of taskIds) {
    await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL AND task_execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)', [taskId])
    await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [taskId])).rows.map((r) => r.id))
    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId])
  }
  await resumeRunning(pool, seedSession)
  const left = await pool.query(`SELECT (SELECT count(*) FROM tasks WHERE title LIKE $1)::int AS n`, [`${P}%`])
  const stray = await pool.query(`SELECT count(*)::int AS n FROM task_executions WHERE description LIKE $1 OR description LIKE 'colado%' OR description LIKE 'painel%' OR description LIKE 'rascunho um%'`, [`${P}%`])
  const running = await pool.query('SELECT count(*)::int AS n FROM time_entries WHERE ended_at IS NULL')
  check('dados de teste apagados', left.rows[0].n === 0 && stray.rows[0].n === 0, `${left.rows[0].n} tarefas, ${stray.rows[0].n} registros sobrando`)
  check('sessão do seed devolvida', running.rows[0].n === seedSession.length, `${running.rows[0].n} x ${seedSession.length}`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
