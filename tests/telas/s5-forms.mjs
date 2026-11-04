// S5a: seleções no Registrar e no Iniciar cronômetro. Campos por caminho
// (herança soma, global sempre), rótulos ligados, ordem da constante, sugestão
// (nunca por cima do que foi tocado, resposta velha descartada, falha sem
// travar), "Nenhuma", trocar e voltar o caminho, rascunho só com o tocado, e o
// Iniciar. No fim, conta os toques de dois casos típicos no seed.
// Árvore, seleções, tarefa e registros próprios (prefixo teste-s5), apagados no
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
const check = async (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
  if (!ok) diag.print(name)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const P = 'teste-s5'
const KEY = (id) => `studyflow:rascunho:registrar:${id}`
const CORS = { 'Access-Control-Allow-Origin': '*' }

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
const made = { tags: [], selections: [], measure: null, task: null, past: [] }
const seedExtras = []
const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })

async function clearExecutions(taskId, keep = []) {
  const ids = (await pool.query('SELECT id FROM task_executions WHERE task_id = $1 AND NOT (id = ANY($2))', [taskId, keep])).rows.map((r) => r.id)
  await deleteExecutions(pool, ids)
}

try {
  const R = await tag(`${P} raiz`)
  const A = await tag(`${P} a`, R.id)
  const A1 = await tag(`${P} a1`, A.id)
  const B = await tag(`${P} b`, R.id)
  made.tags.push(A1.id, A.id, B.id, R.id)
  await api('PATCH', `/tags/${R.id}`, { tracksPhase: true })
  made.measure = (await api('POST', '/measures', { tagId: R.id, name: 'testes', singular: 'teste', allowsDecimal: false, kinds: [] })).id
  const Sr = await sel(R.id, 'S raiz', ['r1', 'r2'])
  const Ma = await sel(A.id, 'S multipla', ['m1', 'm2', 'm3', 'm4'], true)
  const Sz = await sel(A1.id, 'S neto', ['z1'])
  const Sb = await sel(B.id, 'S irma', ['b1', 'b2'])
  const Sx = await sel(R.id, 'S arquivada', ['x1'])
  made.selections.push(Sr.id, Ma.id, Sz.id, Sb.id, Sx.id)
  await api('PATCH', `/selections/${Sx.id}`, { active: false })
  await api('PATCH', `/selection-options/${Ma.o.m4}`, { active: false })
  const natureza = (await api('GET', '/selections')).find((s) => s.tagId === null && s.name === 'Natureza')
  const nat = Object.fromEntries(natureza.options.map((o) => [o.name, o.id]))

  const task = await api('POST', '/tasks', { title: `${P} tarefa` })
  made.task = task.id
  const past = (hours, rootTagId, tagIds, selectionOptionIds) => api('POST', '/executions', {
    taskId: task.id, description: 'passado', completedAt: hoursAgo(hours), rootTagId, tagIds, selectionOptionIds,
  })
  made.past.push((await past(3, R.id, [A.id], [Sr.o.r2, Ma.o.m1, Ma.o.m3, nat.estudo])).id)
  made.past.push((await past(2, R.id, [B.id], [Sr.o.r1, Sb.o.b2])).id)
  made.past.push((await past(1, R.id, [], [Sr.o.r1])).id)

  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await diag.watch(page)
  await page.setViewport({ width: 390, height: 900 })

  // Sugestão sob controle: `hold` segura a resposta de quem tem esse tagId;
  // `fail` responde 500
  const control = { hold: new Map(), fail: false, seen: [] }
  await page.setRequestInterception(true)
  page.on('request', async (req) => {
    if (!req.url().includes('/selections/sugestao')) return req.continue()
    if (req.method() !== 'GET') return req.continue()
    const url = new URL(req.url())
    control.seen.push(url.search)
    if (control.fail) return req.respond({ status: 500, contentType: 'application/json', headers: CORS, body: '{"error":"x"}' })
    const gate = control.hold.get(url.searchParams.get('tagId'))
    if (gate) await gate.promise
    req.continue().catch(() => {})
  })
  const gate = (tagId) => {
    let release
    const promise = new Promise((r) => { release = r })
    control.hold.set(tagId, { promise })
    return () => { control.hold.delete(tagId); release() }
  }

  const url = `${APP}/executar?tarefa=${task.id}`
  const go = async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('main form')
    await pause(300)
  }
  const fresh = async () => {
    await page.evaluate(() => sessionStorage.clear()).catch(() => {})
    await go()
  }
  // Rótulo → valor de todo campo do formulário, na ordem da tela
  const ui = () => page.evaluate(() => {
    const out = []
    for (const el of document.querySelector('main form').querySelectorAll('label, fieldset')) {
      const select = el.querySelector?.('select')
      if (el.tagName === 'LABEL' && select) out.push([el.querySelector('span').textContent, select.selectedOptions[0].textContent])
      if (el.tagName === 'LABEL' && el.closest('fieldset')) continue
      if (el.tagName === 'LABEL' && !select && el.querySelector('input')) out.push([el.querySelector('span').textContent, '(campo)'])
      if (el.tagName === 'FIELDSET') out.push([el.querySelector('legend').textContent, [...el.querySelectorAll('input:checked')].map((i) => i.closest('label').textContent).join(',')])
    }
    return out
  })
  const value = async (name) => (await ui()).find(([n]) => n === name)?.[1]
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
  const toggle = async (text) => {
    await page.evaluate((text) => [...document.querySelectorAll('main form fieldset label')].find((l) => l.textContent === text).querySelector('input').click(), text)
    await pause(150)
  }
  const pickA = async () => { await setField('Contexto', R.name); await setField(`Em ${R.name}`, A.name) }
  const clickText = (text) => page.evaluate((text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text).click(), text)
  const draft = () => page.evaluate((k) => sessionStorage.getItem(k), KEY(task.id))
  const newest = async () => {
    const row = (await pool.query('SELECT id, completed_at FROM task_executions WHERE task_id = $1 AND NOT (id = ANY($2)) ORDER BY created_at DESC LIMIT 1', [task.id, made.past])).rows[0]
    if (!row) return null
    const chosen = (await pool.query('SELECT option_id FROM execution_selections WHERE task_execution_id = $1', [row.id])).rows.map((r) => r.option_id)
    return { ...row, chosen }
  }
  const same = (a, b) => [...a].sort().join() === [...b].sort().join()

  // Campos por caminho
  await fresh()
  await setField('Contexto', 'Sem tag')
  control.seen.length = 0
  let v = await ui()
  await check('sem caminho: a global aparece', v.some(([n]) => n === 'Natureza'), JSON.stringify(v))
  await check('sem caminho: nenhuma de tag', !v.some(([n]) => n.startsWith('S ')), JSON.stringify(v))
  await check('sem caminho: nenhum pedido de sugestão', control.seen.length === 0, control.seen.join())
  await check('sem caminho: Natureza sem sugestão', (await value('Natureza')) === 'Nenhuma')
  await setField('Natureza', 'lazer')
  await pause(200)
  await check('sem caminho: mexer na global não pede sugestão', control.seen.length === 0, control.seen.join())
  await fresh()

  await setField('Contexto', R.name)
  v = await ui()
  await check('raiz: a seleção dela, sugerida do mesmo caminho', (await value('S raiz')) === 'r1', JSON.stringify(v))
  await check('arquivada não aparece', !v.some(([n]) => n === 'S arquivada'))
  await check('irmã não aparece na raiz', !v.some(([n]) => n === 'S irma' || n === 'S multipla'))

  await setField(`Em ${R.name}`, A.name)
  await check('subtag: mesma folha ganha da raiz', (await value('S raiz')) === 'r2', await value('S raiz'))
  await check('múltipla sugerida inteira', (await value('S multipla')) === 'm1,m3', await value('S multipla'))
  await check('global sugerida com caminho', (await value('Natureza')) === 'estudo', await value('Natureza'))
  await check('opção arquivada não é oferecida', await page.evaluate(() => ![...document.querySelectorAll('main form fieldset label')].some((l) => l.textContent === 'm4')))

  await setField(`Em ${R.name} › ${A.name}`, A1.name)
  v = await ui()
  await check('neto: a herança soma as três', ['S raiz', 'S multipla', 'S neto'].every((n) => v.some(([x]) => x === n)), JSON.stringify(v))
  await check('caminho novo cai pra raiz', (await value('S multipla')) === 'm1,m3', await value('S multipla'))

  // Ordem: obra → tags → fase → caminho (raiz → folha) → gerais → medida → link (O4a)
  await setField('Fase', 'Protótipo')
  const names = (await ui()).map(([n]) => n)
  const order = ['Obra', 'Contexto', `Em ${R.name}`, `Em ${R.name} › ${A.name}`, 'Fase', 'S raiz', 'S multipla', 'S neto', 'Natureza', 'Testes (opcional)', 'Link (opcional)']
  await check('ordem da constante', order.every((n, i) => names.indexOf(n) > (i ? names.indexOf(order[i - 1]) : -1)), names.join(' | '))

  // Acessibilidade
  const a11y = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('[data-selection-block]')]
    const selects = blocks.flatMap((b) => [...b.querySelectorAll('select')])
    const fieldsets = blocks.flatMap((b) => [...b.querySelectorAll('fieldset')])
    return {
      blocks: blocks.length,
      selects: selects.length,
      labelled: selects.filter((s) => s.labels.length === 1 && s.labels[0].textContent.trim() !== '').length,
      fieldsets: fieldsets.length,
      legends: fieldsets.filter((f) => f.firstElementChild?.tagName === 'LEGEND' && f.firstElementChild.textContent.trim() !== '').length,
      boxes: fieldsets.flatMap((f) => [...f.querySelectorAll('input[type=checkbox]')]).filter((i) => i.labels.length !== 1).length,
    }
  })
  await check('dois blocos com o atributo de dados', a11y.blocks === 2, JSON.stringify(a11y))
  await check('todo select com label ligado', a11y.selects >= 3 && a11y.labelled === a11y.selects, JSON.stringify(a11y))
  await check('múltipla com fieldset e legend', a11y.fieldsets === 1 && a11y.legends === 1, JSON.stringify(a11y))
  await check('toda caixa com label ligado', a11y.boxes === 0, JSON.stringify(a11y))

  // Múltipla acumula; Registrar grava só o que vale
  await fresh()
  await pickA()
  await toggle('m2')
  await toggle('m1')
  await check('múltipla acumula e desmarca', (await value('S multipla')) === 'm2,m3', await value('S multipla'))
  await setField('Natureza', 'pesquisa')
  await clickText('Registrar')
  await page.waitForFunction(() => location.pathname === '/')
  let rec = await newest()
  await check('Registrar grava as escolhas da tela', rec && same(rec.chosen, [Sr.o.r2, Ma.o.m2, Ma.o.m3, nat.pesquisa]), JSON.stringify(rec))
  await clearExecutions(task.id, made.past)

  // Trocar e voltar o caminho
  await fresh()
  await pickA()
  await toggle('m2')
  await setField(`Em ${R.name}`, B.name)
  v = await ui()
  await check('fora do caminho sai da tela', !v.some(([n]) => n === 'S multipla') && v.some(([n]) => n === 'S irma'), JSON.stringify(v))
  await setField(`Em ${R.name}`, A.name)
  await check('voltar o caminho devolve a escolha', (await value('S multipla')) === 'm1,m2,m3', await value('S multipla'))
  await setField(`Em ${R.name}`, B.name)
  await clickText('Registrar')
  await page.waitForFunction(() => location.pathname === '/')
  rec = await newest()
  await check('fora do caminho não é enviada', rec && !rec.chosen.includes(Ma.o.m2) && rec.chosen.includes(Sb.o.b2), JSON.stringify(rec))
  await clearExecutions(task.id, made.past)

  // "Nenhuma" é escolha: a sugestão que vem depois não volta por cima
  await fresh()
  await setField('Contexto', R.name)
  await setField('S raiz', 'Nenhuma')
  await setField(`Em ${R.name}`, A.name)
  await check('"Nenhuma" fica ao trocar o caminho', (await value('S raiz')) === 'Nenhuma', await value('S raiz'))
  await check('o resto continua sugerido', (await value('S multipla')) === 'm1,m3', await value('S multipla'))

  // Toque antes da resposta
  await fresh()
  await setField('Contexto', R.name)
  let release = gate(A.id)
  await setField(`Em ${R.name}`, A.name)
  await setField('S raiz', 'r1')
  await toggle('m2')
  release()
  await pause(400)
  await check('sugestão tardia não sobrescreve o tocado', (await value('S raiz')) === 'r1', await value('S raiz'))
  await check('sugestão tardia preenche só o intocado', (await value('Natureza')) === 'estudo', await value('Natureza'))

  // Resposta velha de caminho antigo
  await fresh()
  await setField('Contexto', R.name)
  release = gate(A.id)
  await setField(`Em ${R.name}`, A.name)
  await setField(`Em ${R.name}`, B.name)
  await check('caminho novo: sugestão dele', (await value('S raiz')) === 'r1', await value('S raiz'))
  release()
  await pause(400)
  await check('resposta velha descartada', (await value('S raiz')) === 'r1' && (await value('S irma')) === 'b2', `${await value('S raiz')} / ${await value('S irma')}`)

  // Falha da sugestão
  control.fail = true
  await fresh()
  await pickA()
  await check('falha: campos sem sugestão', (await value('S raiz')) === 'Nenhuma', await value('S raiz'))
  await check('falha: sem mensagem de erro na tela', await page.evaluate(() => !document.querySelector('main [role="alert"]')))
  await setField('S raiz', 'r2')
  await clickText('Registrar')
  await page.waitForFunction(() => location.pathname === '/')
  control.fail = false
  rec = await newest()
  await check('falha: Registrar funciona', rec && same(rec.chosen, [Sr.o.r2]), JSON.stringify(rec))
  await clearExecutions(task.id, made.past)

  // Rascunho
  await fresh()
  await setField('Contexto', R.name)
  await page.evaluate((k) => sessionStorage.removeItem(k), KEY(task.id))
  await pause(200)
  await page.evaluate(() => sessionStorage.clear())
  await go()
  await check('sem mexer: sem rascunho', (await draft()) === null, await draft())
  await pickA()
  await check('sugestão fora do rascunho', JSON.stringify(JSON.parse(await draft()).choices) === '{}', await draft())
  await toggle('m2')
  await setField('S raiz', 'Nenhuma')
  const saved = JSON.parse(await draft())
  await check('rascunho guarda só o tocado', Object.keys(saved.choices).length === 2 && same(saved.choices[Ma.id], [Ma.o.m1, Ma.o.m3, Ma.o.m2]) && saved.choices[Sr.id].length === 0, JSON.stringify(saved.choices))
  await go()
  await check('rascunho volta com o aviso', await page.evaluate(() => document.body.textContent.includes('Rascunho recuperado')))
  await check('rascunho: múltipla de volta', (await value('S multipla')) === 'm1,m2,m3', await value('S multipla'))
  await check('rascunho: "Nenhuma" de volta', (await value('S raiz')) === 'Nenhuma', await value('S raiz'))
  await check('rascunho: intocado segue sugerido', (await value('Natureza')) === 'estudo', await value('Natureza'))
  await clickText('descartar')
  await pause(300)
  await check('descartar limpa', (await draft()) === null && (await value('S multipla')) === undefined, await draft())

  // Rascunho com opção que saiu: ignorada, a sugestão volta
  await pickA()
  await toggle('m2')
  const stale = JSON.parse(await draft())
  stale.choices[Ma.id] = [Ma.o.m4]
  stale.choices[Sb.id] = ['00000000-0000-4000-8000-000000000000']
  await page.evaluate((k, d) => sessionStorage.setItem(k, d), KEY(task.id), JSON.stringify(stale))
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('main form')
  await pause(300)
  await check('rascunho com opção arquivada: ignorada', (await value('S multipla')) === 'm1,m3', await value('S multipla'))
  await page.evaluate(() => sessionStorage.clear())

  // Iniciar
  await fresh()
  await clickText('Iniciar cronômetro')
  await page.waitForFunction(() => !document.querySelector('main form button[type=submit]')?.textContent.includes('Registrar'))
  await pause(300)
  rec = await newest()
  await check('Iniciar sem mexer: sem escolhas', rec && rec.chosen.length === 0, JSON.stringify(rec))
  await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL')
  await clearExecutions(task.id, made.past)

  await fresh()
  await pickA()
  await toggle('m2')
  await clickText('Iniciar cronômetro')
  await page.waitForFunction(() => !document.querySelector('main form button[type=submit]')?.textContent.includes('Registrar'))
  await pause(300)
  rec = await newest()
  await check('Iniciar leva tocadas e sugeridas', rec && same(rec.chosen, [Sr.o.r2, Ma.o.m1, Ma.o.m3, Ma.o.m2, nat.estudo]), JSON.stringify(rec))
  await check('Iniciar apaga o rascunho', (await draft()) === null, await draft())
  await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL')
  await clearExecutions(task.id, made.past)

  // A sugestão chega depois do último evento dos campos: o Iniciar leva ela
  await fresh()
  await setField('Contexto', R.name)
  release = gate(A.id)
  await setField(`Em ${R.name}`, A.name)
  release()
  await pause(400)
  await clickText('Iniciar cronômetro')
  await page.waitForFunction(() => !document.querySelector('main form button[type=submit]')?.textContent.includes('Registrar'))
  await pause(300)
  rec = await newest()
  await check('Iniciar recebe a sugestão que chegou depois', rec && same(rec.chosen, [Sr.o.r2, Ma.o.m1, Ma.o.m3, nat.estudo]), JSON.stringify(rec))
  await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL')
  await clearExecutions(task.id, made.past)
  await page.close()

  // Toques no seed, em aparelho emulado: toque de verdade + a escolha do
  // <select> (a lista nativa é do sistema: conta o `change`)
  const seedTask = (await pool.query("SELECT id FROM tasks WHERE title = 'Desenhar'")).rows[0].id
  const touchPage = await browser.newPage()
  await touchPage.setViewport({ width: 375, height: 800, hasTouch: true, isMobile: true })
  await touchPage.evaluateOnNewDocument(() => {
    window.__taps = { pointer: 0, change: 0 }
    addEventListener('pointerdown', () => { window.__taps.pointer++ }, true)
    addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') window.__taps.change++ }, true)
  })
  const count = async (scenario) => {
    const before = new Set((await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [seedTask])).rows.map((r) => r.id))
    await touchPage.goto(`${APP}/executar?tarefa=${seedTask}`, { waitUntil: 'networkidle0' })
    await touchPage.evaluate(() => sessionStorage.clear())
    await touchPage.goto(`${APP}/executar?tarefa=${seedTask}`, { waitUntil: 'networkidle0' })
    await touchPage.waitForSelector('main form')
    await touchPage.evaluate(() => { window.__taps = { pointer: 0, change: 0 } })
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
    const shown = await scenario(choose)
    const handle = await touchPage.evaluateHandle(() => [...document.querySelectorAll('main form button')].find((b) => b.textContent.trim() === 'Registrar'))
    await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    const taps = await touchPage.evaluate(() => window.__taps)
    await handle.tap()
    await touchPage.waitForFunction(() => location.pathname === '/')
    await pause(200)
    const row = (await pool.query('SELECT id FROM task_executions WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1', [seedTask])).rows[0]
    const chosen = (await pool.query(
      `SELECT string_agg(s.name || '=' || o.name, ', ' ORDER BY s.name) AS c FROM execution_selections x
       JOIN selection_options o ON o.id = x.option_id JOIN selections s ON s.id = x.selection_id WHERE x.task_execution_id = $1`, [row.id])).rows[0].c
    if (before.has(row.id)) throw new Error('registro do toque não criado')
    seedExtras.push(row.id)
    await clearExecutions(seedTask, [...before])
    return { total: taps.pointer + taps.change + 1, pointer: taps.pointer + 1, change: taps.change, chosen, shown }
  }
  const inktober = async (choose) => {
    await choose(`Em Desenho`, 'Inktober')
    return touchPage.evaluate(() => [...document.querySelectorAll('[data-selection-block] select')].map((s) => `${s.labels[0].textContent.replace(/(digital|tradicional|estudo|pesquisa|prática|criação|lazer|Nenhuma)/g, '').trim() || '?'}:${s.selectedOptions[0].textContent}`))
  }
  const same1 = await count(inktober)
  const new1 = await count(async (choose) => {
    await inktober(choose)
    await choose('Meio', 'tradicional')
    await choose('Natureza', 'estudo')
  })
  console.log(`TOQUES mesma escolha: medido ${same1.total} (toques ${same1.pointer}, listas ${same1.change}), previsto 3; gravou: ${same1.chosen}`)
  console.log(`TOQUES escolha nova: medido ${new1.total} (toques ${new1.pointer}, listas ${new1.change}), previsto 7; gravou: ${new1.chosen}`)
  await check('toques: mesma escolha grava pela sugestão', /Meio=digital/.test(same1.chosen ?? ''), same1.chosen)
  await check('toques: escolha nova grava o escolhido', /Meio=tradicional/.test(new1.chosen ?? '') && /Natureza=estudo/.test(new1.chosen ?? ''), new1.chosen)
} catch (err) {
  await check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser.close().catch(() => {})
  if (made.task) {
    await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL AND task_execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)', [made.task])
    await clearExecutions(made.task)
    await pool.query('DELETE FROM tasks WHERE id = $1', [made.task])
  }
  await pool.query('DELETE FROM selection_options WHERE selection_id = ANY($1)', [made.selections])
  await pool.query('DELETE FROM selections WHERE id = ANY($1)', [made.selections])
  await pool.query('DELETE FROM measure_kinds WHERE measure_id = $1', [made.measure])
  await pool.query('DELETE FROM measures WHERE id = $1', [made.measure])
  for (const id of made.tags) await pool.query('DELETE FROM tags WHERE id = $1', [id])
  if (paused.length) await pool.query('UPDATE time_entries SET ended_at = NULL WHERE id = ANY($1)', [paused])
  const left = await pool.query(
    `SELECT (SELECT count(*) FROM tags WHERE name LIKE '${P}%')::int + (SELECT count(*) FROM tasks WHERE title LIKE '${P}%')::int +
            (SELECT count(*) FROM selections WHERE id::text NOT LIKE '5eed%')::int AS n`)
  await check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
