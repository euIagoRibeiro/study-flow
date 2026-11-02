// S5b: seleções no painel do cronômetro. Abre no gravado e sugere só o que
// falta; "Nenhuma" do Registrar respeitada; escolha só na tela até o Finalizar;
// Finalizar sempre com a lista; Desfazer com a lista de antes; o 1º exercício
// que troca o caminho; arquivadas do registro; e os dois limites conhecidos
// (erro visível, nada perdido em silêncio). No fim, conta os toques de um fluxo
// de cronômetro no seed.
// Árvore, seleções, tarefa e registros próprios (prefixo teste-s5p), apagados no
// finally. Pausa a sessão rodando do seed e devolve no fim.
import puppeteer from 'puppeteer-core'
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
import { createDiagnostico } from '../diagnostico.mjs'
import { deleteExecutions } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) throw new Error('rodar com --env-file=../backend/.env (npm run telas)')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const results = []
const diag = createDiagnostico()
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
  if (!ok) diag.print(name)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const P = 'teste-s5p'
const EXERCISE = 'Agachamento livre'

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString()
const tag = (name, parentId = null) => api('POST', '/tags', { name, parentId })
const sel = async (tagId, name, options, multiple = false) => {
  const s = await api('POST', '/selections', { tagId, name, multiple, options })
  return { ...s, o: Object.fromEntries(s.options.map((x) => [x.name, x.id])) }
}

const paused = (await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL RETURNING id')).rows.map((r) => r.id)
const made = { tags: [], selections: [], task: null, past: [] }
const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })

async function clearOthers(taskId, keep = []) {
  await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL AND task_execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)', [taskId])
  const ids = (await pool.query('SELECT id FROM task_executions WHERE task_id = $1 AND NOT (id = ANY($2::uuid[]))', [taskId, keep])).rows.map((r) => r.id)
  await deleteExecutions(pool, ids)
}

try {
  const R = await tag(`${P} raiz`)
  const A = await tag(`${P} a`, R.id)
  const M = await tag(`${P} treino`, R.id)
  made.tags.push(A.id, M.id, R.id)
  await api('PATCH', `/tags/${M.id}`, { tracksWorkout: true })
  const Sr = await sel(R.id, 'S raiz', ['r1', 'r2'])
  const Sa = await sel(A.id, 'S a', ['a1', 'a2', 'a3'])
  const Ma = await sel(A.id, 'S multipla', ['m1', 'm2', 'm3'], true)
  made.selections.push(Sr.id, Sa.id, Ma.id)
  const task = await api('POST', '/tasks', { title: `${P} tarefa` })
  made.task = task.id
  const natureza = (await api('GET', '/selections')).find((s) => s.tagId === null && s.name === 'Natureza')
  const nat = Object.fromEntries(natureza.options.map((o) => [o.name, o.id]))

  const post = (body) => api('POST', '/executions', { taskId: task.id, description: 'corrida', ...body })
  made.past.push((await post({ description: 'passado', completedAt: hoursAgo(2), rootTagId: R.id, tagIds: [A.id], selectionOptionIds: [Sr.o.r2, Sa.o.a2, Ma.o.m1, nat.estudo] })).id)
  const open = (selectionOptionIds, tagIds = [A.id]) => post({ completedAt: null, rootTagId: R.id, tagIds, selectionOptionIds })

  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await diag.watch(page)
  await page.setViewport({ width: 390, height: 1000 })
  const puts = []
  page.on('request', (req) => {
    if (req.method() === 'PUT' && req.url().includes('/executions/')) puts.push({ url: req.url(), body: JSON.parse(req.postData() ?? '{}') })
  })

  const url = `${APP}/executar?tarefa=${task.id}`
  const go = async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => ['Finalizar', 'Registrar'].includes(b.textContent.trim())))
    await pause(350)
  }
  const fresh = async () => {
    puts.length = 0
    await page.evaluate(() => sessionStorage.clear()).catch(() => {})
    await go()
  }
  const ui = () => page.evaluate(() => {
    const out = []
    for (const el of document.querySelector('main form').querySelectorAll('label, fieldset')) {
      const select = el.querySelector?.('select')
      if (el.tagName === 'LABEL' && select) out.push([el.querySelector('span').textContent, select.selectedOptions[0].textContent])
      if (el.tagName === 'FIELDSET') out.push([el.querySelector('legend').textContent, [...el.querySelectorAll('input:checked')].map((i) => i.closest('label').textContent).join(',')])
    }
    return out
  })
  const value = async (name) => (await ui()).find(([n]) => n === name)?.[1]
  const options = (name) => page.evaluate((name) => {
    const l = [...document.querySelectorAll('main form label')].find((x) => x.querySelector('span')?.textContent === name && x.querySelector('select'))
    return l ? [...l.querySelector('select').options].map((o) => o.textContent) : null
  }, name)
  const setField = async (label, text) => {
    const done = await page.evaluate((label, text) => {
      const l = [...document.querySelectorAll('main form label')].find((x) => x.querySelector('span')?.textContent === label && x.querySelector('select'))
      if (!l) return false
      const s = l.querySelector('select')
      s.value = [...s.options].find((o) => o.textContent === text).value
      s.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }, label, text)
    if (!done) throw new Error(`campo ${label} não achado`)
    await pause(250)
  }
  const clickText = (text, scope = 'body') => page.evaluate((text, scope) => {
    const b = [...document.querySelector(scope).querySelectorAll('button')].find((x) => x.textContent.trim().replace(/^\+\s*/, '') === text)
    if (!b) return false
    b.click()
    return true
  }, text, scope)
  const clickUndo = () => page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith('Desfazer')).click())
  const finish = async () => {
    if (!(await clickText('Finalizar'))) throw new Error('Finalizar não achado')
    await pause(500)
  }
  const server = async (id) => {
    const row = (await pool.query('SELECT completed_at, root_tag_id FROM task_executions WHERE id = $1', [id])).rows[0]
    const chosen = (await pool.query('SELECT option_id FROM execution_selections WHERE task_execution_id = $1', [id])).rows.map((r) => r.option_id)
    return { ...row, chosen }
  }
  const same = (a, b) => [...a].sort().join() === [...b].sort().join()
  const addSet = async () => {
    const section = 'section[aria-label="Treino"]'
    if (!(await clickText('Exercício', section))) throw new Error('+ Exercício não achado')
    await pause(250)
    if (!(await clickText(EXERCISE, '[aria-label="Escolher exercício"]'))) throw new Error('exercício não achado')
    await pause(250)
    const reps = await page.evaluateHandle((section) => [...document.querySelector(section).querySelectorAll('label span')].find((s) => s.textContent.trim() === 'Reps').closest('label').querySelector('input'), section)
    await reps.evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await reps.click()
    await reps.type('10')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => /Salvo/.test(document.querySelector('section[aria-label="Treino"]').textContent))
    await pause(300)
  }

  // Abre no gravado, sugere só o que falta
  let id = (await open([Sr.o.r1])).id
  await fresh()
  await check('gravado na tela', (await value('S raiz')) === 'r1', await value('S raiz'))
  await check('sugestão não passa por cima do gravado', (await value('S raiz')) !== 'r2')
  await check('o que falta vem sugerido', (await value('S a')) === 'a2' && (await value('S multipla')) === 'm1' && (await value('Natureza')) === 'estudo', JSON.stringify(await ui()))
  const names = (await page.evaluate(() => [...document.querySelector('main form').querySelectorAll('label > span, fieldset > legend, label > div > span')].map((x) => x.textContent))).filter(Boolean)
  const order = ['Contexto', `Em ${R.name}`, 'S raiz', 'S a', 'S multipla', 'Natureza']
  await check('painel na ordem da constante', order.every((n, i) => names.indexOf(n) >= 0 && names.indexOf(n) > (i ? names.indexOf(order[i - 1]) : -1)), names.join(' | '))

  // Só na tela até o Finalizar
  await setField('S a', 'a3')
  await setField('S raiz', 'r2')
  await check('tocar não grava nada', puts.length === 0 && same((await server(id)).chosen, [Sr.o.r1]), JSON.stringify(puts))
  await go()
  await check('recarregar mantém o tocado', (await value('S a')) === 'a3' && (await value('S raiz')) === 'r2', JSON.stringify(await ui()))
  await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' })
  await pause(300)
  await go()
  await check('sair e voltar mantém o tocado', (await value('S a')) === 'a3', await value('S a'))
  await check('sair e voltar sem gravar', puts.length === 0 && same((await server(id)).chosen, [Sr.o.r1]))

  // Finalizar: a lista inteira da tela, com as sugestões
  await finish()
  let s = await server(id)
  await check('Finalizar grava tocadas e sugeridas', s.completed_at && same(s.chosen, [Sr.o.r2, Sa.o.a3, Ma.o.m1, nat.estudo]), JSON.stringify(s))
  await check('Finalizar apaga a memória', await page.evaluate((id) => !Object.keys(sessionStorage).some((k) => k.includes(id)), id))

  // Desfazer: a lista de antes
  await clickUndo()
  await pause(600)
  s = await server(id)
  await check('Desfazer volta a lista de antes', !s.completed_at && same(s.chosen, [Sr.o.r1]), JSON.stringify(s))
  await clearOthers(task.id, made.past)

  // Lista vazia: "Nenhuma" no Finalizar limpa; Desfazer de registro sem escolha
  id = (await open([Sr.o.r1])).id
  await fresh()
  for (const [n, v] of [['S raiz', 'Nenhuma'], ['S a', 'Nenhuma'], ['Natureza', 'Nenhuma']]) await setField(n, v)
  await page.evaluate(() => [...document.querySelectorAll('main form fieldset input:checked')].forEach((i) => i.click()))
  await pause(200)
  await finish()
  s = await server(id)
  await check('Finalizar com "Nenhuma" manda [] e limpa', s.completed_at && s.chosen.length === 0 && Array.isArray(puts.at(-1)?.body.selectionOptionIds) && puts.at(-1).body.selectionOptionIds.length === 0, JSON.stringify([s, puts.at(-1)?.body]))
  await clearOthers(task.id, made.past)

  id = (await open([])).id
  await fresh()
  await finish()
  s = await server(id)
  await check('sugestão aceita sem tocar é gravada', s.chosen.length === 4, JSON.stringify(s))
  await clickUndo()
  await pause(600)
  s = await server(id)
  await check('Desfazer manda [] e limpa o que o Finalizar gravou', !s.completed_at && s.chosen.length === 0, JSON.stringify(s))
  await clearOthers(task.id, made.past)

  // "Nenhuma" do Registrar respeitada pelo painel
  await fresh()
  await setField('Contexto', R.name)
  await setField(`Em ${R.name}`, A.name)
  await setField('S a', 'Nenhuma')
  await clickText('Iniciar cronômetro')
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Finalizar'))
  await pause(500)
  await check('"Nenhuma" do Registrar respeitada no painel', (await value('S a')) === 'Nenhuma', await value('S a'))
  await check('a outra segue gravada', (await value('S raiz')) === 'r2', await value('S raiz'))
  await go()
  await check('"Nenhuma" sobrevive a recarregar', (await value('S a')) === 'Nenhuma', await value('S a'))
  await clearOthers(task.id, made.past)

  // Armadilha do treino: o 1º exercício troca o caminho, o servidor tira a
  // seleção de A; voltar o caminho traz ela de volta na tela, e o Finalizar manda
  id = (await open([Sr.o.r1, Sa.o.a1])).id
  await fresh()
  await setField(`Em ${R.name}`, M.name)
  await setField('S raiz', 'r2')
  await addSet()
  s = await server(id)
  await check('1º exercício tira do servidor a seleção fora do caminho', same(s.chosen, [Sr.o.r1]), JSON.stringify(s))
  await check('1º exercício não grava a escolha tocada', !s.chosen.includes(Sr.o.r2) && !('selectionOptionIds' in (puts.at(-1)?.body ?? {})), JSON.stringify(puts.at(-1)?.body))
  await setField(`Em ${R.name}`, A.name)
  await check('voltar o caminho traz a escolha gravada na abertura', (await value('S a')) === 'a1', await value('S a'))
  await finish()
  s = await server(id)
  await check('Finalizar manda a lista com o caminho mudado no treino', s.completed_at && s.chosen.includes(Sa.o.a1) && s.chosen.includes(Sr.o.r2), JSON.stringify(s))
  await clearOthers(task.id, made.past)

  // Arquivadas do registro
  id = (await open([Sr.o.r1, Sa.o.a1])).id
  await api('PATCH', `/selection-options/${Sa.o.a1}`, { active: false })
  await fresh()
  await check('opção arquivada do registro aparece marcada', (await value('S a')) === 'a1 (arquivada)', await value('S a'))
  await finish()
  s = await server(id)
  await check('arquivada do registro mantida ao Finalizar', s.completed_at && s.chosen.includes(Sa.o.a1), JSON.stringify(s))
  await clearOthers(task.id, made.past)
  id = (await open([Sr.o.r1])).id
  await fresh()
  await check('arquivada não é oferecida a quem não a tem', !(await options('S a')).some((o) => o.startsWith('a1')), JSON.stringify(await options('S a')))
  await clearOthers(task.id, made.past)
  await api('PATCH', `/selection-options/${Sa.o.a1}`, { active: true })

  // Limite 1: tirar a arquivada no Finalizar e Desfazer. O servidor recusa:
  // erro visível, registro continua como o Finalizar deixou
  id = (await open([Sr.o.r1, Sa.o.a1])).id
  await api('PATCH', `/selection-options/${Sa.o.a1}`, { active: false })
  await fresh()
  await setField('S a', 'Nenhuma')
  await finish()
  s = await server(id)
  await check('limite 1: Finalizar tira a arquivada', s.completed_at && !s.chosen.includes(Sa.o.a1), JSON.stringify(s))
  await clickUndo()
  await pause(700)
  const after = await server(id)
  await check('limite 1: Desfazer recusado com aviso visível', await page.evaluate(() => document.body.textContent.includes('Não foi possível desfazer')))
  await check('limite 1: registro inteiro, nada pela metade', after.completed_at && same(after.chosen, s.chosen), JSON.stringify(after))
  await clearOthers(task.id, made.past)
  await api('PATCH', `/selection-options/${Sa.o.a1}`, { active: true })

  // Limite 2: a gravação do caminho tira a arquivada e o caminho volta. O
  // Finalizar é recusado: erro no formulário, registro aberto, dá pra corrigir
  id = (await open([Sr.o.r1, Sa.o.a1])).id
  await api('PATCH', `/selection-options/${Sa.o.a1}`, { active: false })
  await fresh()
  await setField(`Em ${R.name}`, M.name)
  await addSet()
  await setField(`Em ${R.name}`, A.name)
  await check('limite 2: arquivada volta à tela', (await value('S a')) === 'a1 (arquivada)', await value('S a'))
  await finish()
  s = await server(id)
  const shown = await page.evaluate(() => [...document.querySelectorAll('main [role="alert"], main p')].map((x) => x.textContent).find((t) => /arquivad/i.test(t) && !/Finalizar com esse/.test(t)))
  await check('limite 2: Finalizar recusado com o motivo na tela', !s.completed_at && Boolean(shown), `${shown} ${JSON.stringify(s)}`)
  await setField('S a', 'a2')
  await finish()
  s = await server(id)
  await check('limite 2: corrigido, finaliza', s.completed_at && s.chosen.includes(Sa.o.a2), JSON.stringify(s))
  await clearOthers(task.id, made.past)
  await api('PATCH', `/selection-options/${Sa.o.a1}`, { active: true })

  // Seleção arquivada que o registro tem
  id = (await open([Sa.o.a2])).id
  await api('PATCH', `/selections/${Sa.id}`, { active: false })
  await fresh()
  await check('seleção arquivada do registro continua na tela', (await value('S a')) === 'a2', await value('S a'))
  await finish()
  s = await server(id)
  await check('seleção arquivada do registro mantida', s.completed_at && s.chosen.includes(Sa.o.a2), JSON.stringify(s))
  await api('PATCH', `/selections/${Sa.id}`, { active: true })
  await clearOthers(task.id, made.past)

  // Registro antigo com 2 temas, sem mexer nas tags: não manda tags nem lista
  id = (await open([Sr.o.r1], [A.id, M.id])).id
  await fresh()
  await finish()
  const body = puts.at(-1)?.body ?? {}
  await check('2 temas: não manda tags nem lista', puts.length === 1 && !('tagIds' in body) && !('selectionOptionIds' in body), JSON.stringify(body))
  s = await server(id)
  await check('2 temas: escolhas intactas', s.completed_at && same(s.chosen, [Sr.o.r1]), JSON.stringify(s))
  await clearOthers(task.id, made.past)
  await page.close()

  // Toques no seed: aparelho emulado, toque de verdade + `change` do <select>
  const seedTask = (await pool.query("SELECT id FROM tasks WHERE title = 'Desenhar'")).rows[0].id
  const touchPage = await browser.newPage()
  await touchPage.setViewport({ width: 375, height: 800, hasTouch: true, isMobile: true })
  await touchPage.evaluateOnNewDocument(() => {
    window.__taps = { pointer: 0, change: 0 }
    addEventListener('pointerdown', () => { window.__taps.pointer++ }, true)
    addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') window.__taps.change++ }, true)
  })
  const button = (text) => touchPage.evaluateHandle((text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text), text)
  const tapButton = async (text) => {
    const h = await button(text)
    await h.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await h.tap()
    await pause(500)
  }
  const choose = async (label, text) => {
    const handle = await touchPage.evaluateHandle((label) => [...document.querySelectorAll('main form label')].find((x) => x.querySelector('span')?.textContent === label).querySelector('select'), label)
    await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await handle.tap()
    await pause(150)
    await touchPage.keyboard.press('Escape').catch(() => {})
    await handle.evaluate((el, text) => {
      el.value = [...el.options].find((o) => o.textContent === text).value
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, text)
    await pause(350)
  }
  const count = async (inPanel) => {
    const before = (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [seedTask])).rows.map((r) => r.id)
    await touchPage.goto(`${APP}/executar?tarefa=${seedTask}`, { waitUntil: 'networkidle0' })
    await touchPage.evaluate(() => sessionStorage.clear())
    await touchPage.goto(`${APP}/executar?tarefa=${seedTask}`, { waitUntil: 'networkidle0' })
    await touchPage.waitForSelector('main form')
    await touchPage.evaluate(() => { window.__taps = { pointer: 0, change: 0 } })
    await choose('Em Desenho', 'Inktober')
    await tapButton('Iniciar cronômetro')
    await touchPage.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Finalizar'))
    await pause(400)
    await inPanel()
    const h = await button('Finalizar')
    await h.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    const taps = await touchPage.evaluate(() => window.__taps)
    await h.tap()
    await pause(700)
    const row = (await pool.query('SELECT id, completed_at FROM task_executions WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1', [seedTask])).rows[0]
    const chosen = (await pool.query(
      `SELECT string_agg(s.name || '=' || o.name, ', ' ORDER BY s.name) AS c FROM execution_selections x
       JOIN selection_options o ON o.id = x.option_id JOIN selections s ON s.id = x.selection_id WHERE x.task_execution_id = $1`, [row.id])).rows[0].c
    await clearOthers(seedTask, before)
    return { total: taps.pointer + taps.change + 1, pointer: taps.pointer + 1, change: taps.change, chosen, done: Boolean(row.completed_at) }
  }
  const same1 = await count(async () => {})
  const changed = await count(() => choose('Meio', 'tradicional'))
  console.log(`TOQUES mesma escolha: medido ${same1.total} (toques ${same1.pointer}, listas ${same1.change}), previsto 4; gravou: ${same1.chosen}`)
  console.log(`TOQUES trocando o Meio no painel: medido ${changed.total} (toques ${changed.pointer}, listas ${changed.change}), previsto 6; gravou: ${changed.chosen}`)
  await check('toques: mesma escolha finaliza pela sugestão', same1.done && /Meio=digital/.test(same1.chosen ?? ''), JSON.stringify(same1))
  await check('toques: troca no painel grava a nova', changed.done && /Meio=tradicional/.test(changed.chosen ?? ''), JSON.stringify(changed))
} catch (err) {
  await check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser.close().catch(() => {})
  if (made.task) {
    await clearOthers(made.task)
    await pool.query('DELETE FROM tasks WHERE id = $1', [made.task])
  }
  await pool.query('DELETE FROM selection_options WHERE selection_id = ANY($1::uuid[])', [made.selections])
  await pool.query('DELETE FROM selections WHERE id = ANY($1::uuid[])', [made.selections])
  for (const id of made.tags) await pool.query('DELETE FROM tags WHERE id = $1', [id])
  if (paused.length) await pool.query('UPDATE time_entries SET ended_at = NULL WHERE id = ANY($1::uuid[])', [paused])
  const left = await pool.query(
    `SELECT (SELECT count(*) FROM tags WHERE name LIKE '${P}%')::int + (SELECT count(*) FROM tasks WHERE title LIKE '${P}%')::int +
            (SELECT count(*) FROM selections WHERE id::text NOT LIKE '5eed%')::int AS n`)
  await check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
