// S5c: seleções no lápis, no Histórico e no cartão da Lista. Começa no gravado,
// sem sugestão; a lista só vai se mexeu numa seleção; caminho trocado sem toque
// não manda o campo e o servidor tira o que saiu; arquivadas do registro; aviso
// na hora; rascunho por registro, só com o tocado; registro de 2 temas. No fim,
// conta os toques de editar uma escolha.
// Árvore, seleções, tarefa e registros próprios (prefixo teste-s5l), apagados no
// finally. Confere que as escolhas do seed não mudaram, par a par.
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'
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
const P = 'teste-s5l'
const KEY = (id) => `studyflow:rascunho:editar:${id}`

async function api(method, path, body) {
  const res = await apiFetch(API + path, {
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
const seedPairs = async () => (await pool.query(
  "SELECT task_execution_id || ' ' || option_id AS p FROM execution_selections WHERE task_execution_id::text LIKE '5eed%' ORDER BY 1")).rows.map((r) => r.p).join('\n')

const pairsBefore = await seedPairs()
const made = { tags: [], selections: [], task: null, ids: [] }
const browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })

try {
  const R = await tag(`${P} raiz`)
  const A = await tag(`${P} a`, R.id)
  const B = await tag(`${P} b`, R.id)
  made.tags.push(A.id, B.id, R.id)
  await api('POST', '/measures', { tagId: R.id, name: 'testes', singular: 'teste', allowsDecimal: false, kinds: [] })
  const Sr = await sel(R.id, 'S raiz', ['r1', 'r2'])
  const Sa = await sel(A.id, 'S a', ['a1', 'a2', 'a3'])
  const Ma = await sel(A.id, 'S multipla', ['m1', 'm2', 'm3'], true)
  const Sb = await sel(B.id, 'S irma', ['b1', 'b2'])
  made.selections.push(Sr.id, Sa.id, Ma.id, Sb.id)
  const task = await api('POST', '/tasks', { title: `${P} tarefa` })
  made.task = task.id
  const natureza = (await api('GET', '/selections')).find((s) => s.tagId === null && s.name === 'Natureza')
  const nat = Object.fromEntries(natureza.options.map((o) => [o.name, o.id]))

  let n = 0
  const record = async (selectionOptionIds, tagIds = [A.id]) => {
    n += 1
    const description = `${P} reg ${n}`
    const { id } = await api('POST', '/executions', { taskId: task.id, description, completedAt: hoursAgo(n + 3), rootTagId: R.id, tagIds, selectionOptionIds })
    made.ids.push(id)
    return { id, description }
  }
  // O mais recente de todos: é dele que uma sugestão viria
  const { id: latest } = await api('POST', '/executions', { taskId: task.id, description: `${P} recente`, completedAt: hoursAgo(1), rootTagId: R.id, tagIds: [A.id], selectionOptionIds: [Sr.o.r2, Sa.o.a2, Ma.o.m2, nat.lazer] })
  made.ids.push(latest)

  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await diag.watch(page)
  await page.setViewport({ width: 390, height: 1000 })
  const puts = []
  const suggestions = []
  page.on('request', (req) => {
    if (req.url().includes('/selections/sugestao')) suggestions.push(req.url())
    if (req.method() === 'PUT' && req.url().includes('/executions/')) puts.push(JSON.parse(req.postData() ?? '{}'))
  })

  const FORM = 'form[id^="editar-"]'
  const historico = async () => {
    await page.goto(`${APP}/historico`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('article')
    await pause(300)
  }
  const pencil = async (description) => {
    const done = await page.evaluate((description) => {
      const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === description))
      const b = a?.querySelector('button[aria-label^="Editar registro"]')
      b?.click()
      return Boolean(b)
    }, description)
    if (!done) throw new Error(`lápis de ${description} não achado`)
    await page.waitForSelector(FORM)
    await pause(250)
  }
  const fresh = async (description) => {
    puts.length = 0
    suggestions.length = 0
    await page.goto(`${APP}/historico`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.evaluate(() => sessionStorage.clear())
    await historico()
    await pencil(description)
  }
  const ui = () => page.evaluate((FORM) => {
    const out = []
    for (const el of document.querySelector(FORM).querySelectorAll('label, fieldset')) {
      const select = el.querySelector?.('select')
      if (el.tagName === 'LABEL' && select) out.push([el.querySelector('span').textContent, select.selectedOptions[0].textContent])
      if (el.tagName === 'FIELDSET') out.push([el.querySelector('legend').textContent, [...el.querySelectorAll('input:checked')].map((i) => i.closest('label').textContent).join(',')])
    }
    return out
  }, FORM)
  const value = async (name) => (await ui()).find(([x]) => x === name)?.[1]
  const options = (name) => page.evaluate((FORM, name) => {
    const l = [...document.querySelectorAll(`${FORM} label`)].find((x) => x.querySelector('span')?.textContent === name && x.querySelector('select'))
    return l ? [...l.querySelector('select').options].map((o) => o.textContent) : null
  }, FORM, name)
  const setField = async (label, text) => {
    const done = await page.evaluate((FORM, label, text) => {
      const l = [...document.querySelectorAll(`${FORM} label`)].find((x) => x.querySelector('span')?.textContent === label && x.querySelector('select'))
      if (!l) return false
      const s = l.querySelector('select')
      s.value = [...s.options].find((o) => o.textContent === text).value
      s.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }, FORM, label, text)
    if (!done) throw new Error(`campo ${label} não achado`)
    await pause(200)
  }
  const toggle = async (text) => {
    await page.evaluate((FORM, text) => [...document.querySelectorAll(`${FORM} fieldset label`)].find((l) => l.textContent === text).querySelector('input').click(), FORM, text)
    await pause(150)
  }
  const warning = () => page.evaluate((FORM) => document.querySelector(FORM).textContent.match(/Salvar com esse caminho vai remover: [^.]*\./)?.[0] ?? null, FORM)
  const save = async () => {
    await page.evaluate(() => document.querySelector('button[form^="editar-"]').click())
    await page.waitForFunction((FORM) => !document.querySelector(FORM), {}, FORM)
    await pause(200)
  }
  const cancel = async () => {
    await page.evaluate((FORM) => {
      const box = document.querySelector(FORM).closest('article')
      ;[...box.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancelar').click()
    }, FORM)
    await pause(200)
  }
  const chosen = async (id) => (await pool.query('SELECT option_id FROM execution_selections WHERE task_execution_id = $1', [id])).rows.map((r) => r.option_id)
  const same = (a, b) => [...a].sort().join() === [...b].sort().join()
  const draft = (id) => page.evaluate((k) => sessionStorage.getItem(k), KEY(id))
  const notice = () => page.evaluate(() => document.body.textContent.includes('Rascunho recuperado'))

  // Abre no gravado, sem sugestão
  let r = await record([Sr.o.r1, Sa.o.a1])
  await fresh(r.description)
  await check('abre no gravado', (await value('S raiz')) === 'r1' && (await value('S a')) === 'a1', JSON.stringify(await ui()))
  await check('sem sugestão: o que não está gravado fica vazio', (await value('S multipla')) === '' && (await value('Natureza')) === 'Nenhuma', JSON.stringify(await ui()))
  await setField(`Em ${R.name}`, B.name)
  await setField(`Em ${R.name}`, A.name)
  await check('sem pedido de sugestão, nem trocando o caminho', suggestions.length === 0, suggestions.join())
  const names = await page.evaluate((FORM) => [...document.querySelector(FORM).querySelectorAll('label > span, fieldset > legend, label > div > span')].map((x) => x.textContent), FORM)
  const order = ['Contexto', `Em ${R.name}`, 'S a', 'S multipla', 'Natureza', 'Testes (opcional)']
  await check('lápis na ordem da constante', order.every((x, i) => names.indexOf(x) >= 0 && names.indexOf(x) > (i ? names.indexOf(order[i - 1]) : -1)), names.join(' | '))

  // Sem mexer, o campo não vai
  await save()
  await check('sem mexer: o PUT não leva o campo', puts.length === 1 && !('selectionOptionIds' in puts[0]), JSON.stringify(puts))
  await check('sem mexer: escolhas iguais', same(await chosen(r.id), [Sr.o.r1, Sa.o.a1]))

  // Mexer: a lista inteira do que está na tela
  await fresh(r.description)
  await setField('S raiz', 'r2')
  await toggle('m2')
  await save()
  await check('mexeu: o PUT leva a lista', same(puts.at(-1)?.selectionOptionIds ?? [], [Sr.o.r2, Sa.o.a1, Ma.o.m2]), JSON.stringify(puts.at(-1)))
  await check('mexeu: banco com a escolha nova', same(await chosen(r.id), [Sr.o.r2, Sa.o.a1, Ma.o.m2]))

  // "Nenhuma" limpa o gravado
  await fresh(r.description)
  await setField('S raiz', 'Nenhuma')
  await setField('S a', 'Nenhuma')
  await toggle('m2')
  await save()
  await check('"Nenhuma" manda [] e limpa', Array.isArray(puts.at(-1)?.selectionOptionIds) && puts.at(-1).selectionOptionIds.length === 0, JSON.stringify(puts.at(-1)))
  await check('"Nenhuma": banco sem escolhas', (await chosen(r.id)).length === 0)

  // Caminho trocado sem toque: nada de campo, o servidor tira o que saiu
  r = await record([Sr.o.r1, Sa.o.a1, nat.estudo])
  await fresh(r.description)
  await setField(`Em ${R.name}`, B.name)
  let w = await warning()
  await check('aviso na hora, com o que sai', w?.includes('S a (a1)'), w)
  await check('aviso não cita a global nem o que fica', !w?.includes('Natureza') && !w?.includes('S raiz'), w)
  await setField(`Em ${R.name}`, A.name)
  await check('voltar o caminho tira o aviso', (await warning()) === null, await warning())
  await check('voltar o caminho devolve a escolha', (await value('S a')) === 'a1', await value('S a'))
  await setField(`Em ${R.name}`, B.name)
  await save()
  await check('caminho trocado sem toque: o PUT não leva o campo', puts.length === 1 && !('selectionOptionIds' in puts[0]) && puts[0].tagIds?.includes(B.id), JSON.stringify(puts))
  await check('caminho trocado sem toque: o banco perde só a que saiu', same(await chosen(r.id), [Sr.o.r1, nat.estudo]), JSON.stringify(await chosen(r.id)))

  // Limpou de propósito: o aviso não cita
  r = await record([Sr.o.r1, Sa.o.a1])
  await fresh(r.description)
  await setField('S a', 'Nenhuma')
  await setField(`Em ${R.name}`, B.name)
  await check('seleção limpa de propósito não entra no aviso', (await warning()) === null, await warning())
  await cancel()

  // Arquivadas do registro
  r = await record([Sr.o.r1, Sa.o.a1])
  const other = await record([Sr.o.r1])
  await api('PATCH', `/selection-options/${Sa.o.a1}`, { active: false })
  await fresh(r.description)
  await check('opção arquivada do registro com "(arquivada)"', (await value('S a')) === 'a1 (arquivada)', await value('S a'))
  await setField('S raiz', 'r2')
  await save()
  await check('arquivada mantida ao salvar outra mudança', same(await chosen(r.id), [Sr.o.r2, Sa.o.a1]), JSON.stringify(await chosen(r.id)))
  await fresh(other.description)
  await check('arquivada não é oferecida a quem não a tem', !(await options('S a')).some((o) => o.startsWith('a1')), JSON.stringify(await options('S a')))
  // Rascunho com a arquivada, num registro que não a tem: ignorada
  await setField('S a', 'a2')
  const stale = JSON.parse(await draft(other.id))
  stale.choices[Sa.id] = [Sa.o.a1]
  await page.evaluate((k, d) => sessionStorage.setItem(k, d), KEY(other.id), JSON.stringify(stale))
  await historico()
  await pencil(other.description)
  await check('rascunho com opção arquivada: fora da tela', (await value('S a')) === 'Nenhuma', await value('S a'))
  puts.length = 0
  await save()
  await check('rascunho com opção arquivada: ignorada, nada a mandar', puts.length === 1 && !('selectionOptionIds' in puts[0]), JSON.stringify(puts))
  await api('PATCH', `/selection-options/${Sa.o.a1}`, { active: true })

  r = await record([Sa.o.a2])
  await api('PATCH', `/selections/${Sa.id}`, { active: false })
  await fresh(r.description)
  await check('seleção arquivada do registro continua na tela', (await value('S a')) === 'a2', await value('S a'))
  await cancel()
  await api('PATCH', `/selections/${Sa.id}`, { active: true })

  // Rascunho do lápis: por registro, só com o tocado
  const a = await record([Sr.o.r1, Sa.o.a1])
  const b = await record([Sr.o.r2, Sa.o.a3])
  await fresh(a.description)
  await check('sem mexer: sem rascunho', (await draft(a.id)) === null, await draft(a.id))
  await setField('S raiz', 'r2')
  let saved = JSON.parse(await draft(a.id))
  await check('rascunho guarda só o tocado', Object.keys(saved.choices).join() === Sr.id && same(saved.choices[Sr.id], [Sr.o.r2]), JSON.stringify(saved.choices))
  await setField('S raiz', 'r1')
  await check('voltar ao gravado apaga o rascunho', (await draft(a.id)) === null, await draft(a.id))
  await setField('S raiz', 'Nenhuma')
  await toggle('m1')
  await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' })
  await pause(200)
  await historico()
  await pencil(b.description)
  await check('rascunho de um registro não aparece em outro', !(await notice()) && (await value('S raiz')) === 'r2' && (await value('S a')) === 'a3' && (await value('S multipla')) === '', JSON.stringify(await ui()))
  await cancel()
  await pencil(a.description)
  await check('rascunho volta com o aviso', await notice())
  await check('rascunho: "Nenhuma" e múltipla de volta', (await value('S raiz')) === 'Nenhuma' && (await value('S multipla')) === 'm1', JSON.stringify(await ui()))
  await check('rascunho: o resto segue o gravado', (await value('S a')) === 'a1', await value('S a'))
  await cancel()
  await check('Cancelar apaga o rascunho', (await draft(a.id)) === null, await draft(a.id))
  await pencil(a.description)
  await setField('S raiz', 'r2')
  await save()
  await check('Salvar apaga o rascunho', (await draft(a.id)) === null, await draft(a.id))
  await check('Salvar grava o tocado', same(await chosen(a.id), [Sr.o.r2, Sa.o.a1]))

  // Registro com 2 temas: a lista leva as escolhas que a tela não mostra
  r = await record([Sr.o.r1, Sa.o.a1, Sb.o.b1], [A.id, B.id])
  await fresh(r.description)
  await check('2 temas: a do tema escondido não aparece', !(await ui()).some(([x]) => x === 'S a' || x === 'S irma'), JSON.stringify(await ui()))
  await check('2 temas: sem aviso de remoção', (await warning()) === null, await warning())
  await setField('S raiz', 'r2')
  await save()
  await check('2 temas: escolhas escondidas preservadas', same(await chosen(r.id), [Sr.o.r2, Sa.o.a1, Sb.o.b1]), JSON.stringify(await chosen(r.id)))

  // Cartão da Lista
  r = await record([Sr.o.r1, Sa.o.a1])
  puts.length = 0
  await page.evaluate(() => sessionStorage.clear())
  await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`button[aria-label="Mais ações de ${task.title}"]`)
  await pause(300)
  await page.evaluate((title) => document.querySelector(`button[aria-label="Mais ações de ${title}"]`).click(), task.title)
  await pause(150)
  await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Ver histórico').click())
  await pause(300)
  await pencil(r.description)
  await check('Lista: abre no gravado', (await value('S a')) === 'a1', await value('S a'))
  await setField('S a', 'a2')
  await save()
  await check('Lista: grava a escolha', same(await chosen(r.id), [Sr.o.r1, Sa.o.a2]), JSON.stringify(await chosen(r.id)))
  await page.close()

  // Toques: aparelho emulado, editar o Meio de um registro do seed
  const seed = (await pool.query(`
    SELECT e.id, e.description, e.task_id, x.option_id FROM task_executions e
    JOIN execution_selections x ON x.task_execution_id = e.id
    JOIN selections s ON s.id = x.selection_id AND s.name = 'Meio'
    WHERE e.id::text LIKE '5eed%' AND e.description IS NOT NULL
    ORDER BY e.completed_at DESC LIMIT 1`)).rows[0]
  const original = (await pool.query('SELECT description, completed_at FROM task_executions WHERE id = $1', [seed.id])).rows[0]
  const taskTitle = (await pool.query('SELECT title FROM tasks WHERE id = $1', [seed.task_id])).rows[0].title
  const touch = await browser.newPage()
  await touch.setViewport({ width: 375, height: 800, hasTouch: true, isMobile: true })
  await touch.evaluateOnNewDocument(() => {
    window.__taps = { pointer: 0, change: 0 }
    addEventListener('pointerdown', () => { window.__taps.pointer++ }, true)
    addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') window.__taps.change++ }, true)
  })
  const tapEl = async (handle) => {
    await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await handle.tap()
    await pause(300)
  }
  const editMeio = async (next) => {
    const pencilHandle = await touch.evaluateHandle((d) => [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === d)).querySelector('button[aria-label^="Editar registro"]'), seed.description)
    await tapEl(pencilHandle)
    const select = await touch.evaluateHandle((FORM) => [...document.querySelectorAll(`${FORM} label`)].find((l) => l.querySelector('span')?.textContent === 'Meio').querySelector('select'), FORM)
    await tapEl(select)
    await touch.keyboard.press('Escape').catch(() => {})
    await select.evaluate((el, next) => {
      el.value = [...el.options].find((o) => o.textContent === next).value
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, next)
    await pause(200)
    const button = await touch.evaluateHandle(() => document.querySelector('button[form^="editar-"]'))
    await button.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    const taps = await touch.evaluate(() => window.__taps)
    await button.tap()
    await pause(600)
    return { total: taps.pointer + taps.change + 1, pointer: taps.pointer + 1, change: taps.change }
  }
  const zero = () => touch.evaluate(() => { window.__taps = { pointer: 0, change: 0 } })
  await touch.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await zero()
  const inHistory = await editMeio('tradicional')
  const afterHistory = (await pool.query("SELECT o.name FROM execution_selections x JOIN selection_options o ON o.id = x.option_id JOIN selections s ON s.id = x.selection_id WHERE x.task_execution_id = $1 AND s.name = 'Meio'", [seed.id])).rows[0]?.name
  await touch.goto(`${APP}/`, { waitUntil: 'networkidle0' })
  await zero()
  await tapEl(await touch.evaluateHandle((t) => document.querySelector(`button[aria-label="Mais ações de ${t}"]`), taskTitle))
  await tapEl(await touch.evaluateHandle(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Ver histórico')))
  const inList = await editMeio('digital')
  console.log(`TOQUES Histórico: medido ${inHistory.total} (toques ${inHistory.pointer}, listas ${inHistory.change}), previsto 4; gravou ${afterHistory}`)
  console.log(`TOQUES cartão da Lista: medido ${inList.total} (toques ${inList.pointer}, listas ${inList.change}), previsto 6`)
  await check('toques: a edição gravou', afterHistory === 'tradicional', afterHistory)
  // Devolve o registro do seed como estava
  await pool.query('DELETE FROM execution_selections WHERE task_execution_id = $1 AND selection_id = (SELECT id FROM selections WHERE name = $2 AND id::text LIKE $3)', [seed.id, 'Meio', '5eed%'])
  await pool.query(
    `INSERT INTO execution_selections (task_execution_id, option_id, selection_id, selection_multiple, selection_global, tag_id, root_tag_id)
     SELECT e.id, o.id, s.id, s.multiple, s.is_global, s.tag_id, e.root_tag_id
     FROM task_executions e, selection_options o JOIN selections s ON s.id = o.selection_id
     WHERE e.id = $1 AND o.id = $2`, [seed.id, seed.option_id])
  await pool.query('UPDATE task_executions SET description = $2, completed_at = $3 WHERE id = $1', [seed.id, original.description, original.completed_at])
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser.close().catch(() => {})
  if (made.task) {
    const ids = (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [made.task])).rows.map((r) => r.id)
    await deleteExecutions(pool, ids)
    await pool.query('DELETE FROM tasks WHERE id = $1', [made.task])
  }
  await pool.query('DELETE FROM selection_options WHERE selection_id = ANY($1::uuid[])', [made.selections])
  await pool.query('DELETE FROM selections WHERE id = ANY($1::uuid[])', [made.selections])
  await pool.query('DELETE FROM measures WHERE tag_id = ANY($1::uuid[])', [made.tags])
  for (const id of made.tags) await pool.query('DELETE FROM tags WHERE id = $1', [id])
  const left = await pool.query(
    `SELECT (SELECT count(*) FROM tags WHERE name LIKE '${P}%')::int + (SELECT count(*) FROM tasks WHERE title LIKE '${P}%')::int +
            (SELECT count(*) FROM selections WHERE id::text NOT LIKE '5eed%')::int AS n`)
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  check('escolhas do seed iguais, par a par', (await seedPairs()) === pairsBefore)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
