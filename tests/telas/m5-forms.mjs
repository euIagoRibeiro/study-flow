// M5: medidas nos formulários (Registrar, Finalizar, editar) e no Histórico.
// pt-BR e en-US (o en-US corrompia "5,5" em campo numérico). Mira pelo
// conteúdo; desfaz tudo no finally e confere que o seed voltou.
import puppeteer from 'puppeteer-core'

import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const id = (n) => `5eed0000-0000-4000-8000-${String(n).padStart(12, '0')}`
const VESTIBULAR_TASK = id(9)
const FISICO_TASK = id(6)
const LIVRO_TASK = id(4)
const LIVRO_OPEN = id(401)
const E902 = id(902)
const E1106 = id(1106)
const E601 = id(601)
const M_VEST = '5eed0000-0000-4000-a000-000000000003'
const M_CODIGO = '5eed0000-0000-4000-a000-000000000001'
const M_LING = '5eed0000-0000-4000-a000-000000000002'
const M_CORRIDA = '5eed0000-0000-4000-a000-000000000005'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? ` (${detail})` : ''}`)
}
async function waitForApi() {
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(`${API}/tasks`)).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('API não respondeu')
}
const get = async (p) => { await waitForApi(); return (await fetch(API + p)).json() }
const send = async (method, p, body) => {
  await waitForApi()
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`)
  return r.json()
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const exec = async (eid) => (await get('/executions')).find((e) => e.id === eid)
const byDesc = async (d) => (await get('/executions')).find((e) => e.description === d)
// Valores como texto comparável: "leitura=2,refatoração=3" (nome do tipo)
let kindNames = new Map()
const vals = (e) => e?.measure
  ? `${e.measure.measureId.slice(-1)}:` + e.measure.values
    .map((v) => `${v.kindId ? kindNames.get(v.kindId) : '-'}=${v.quantity}`).sort().join(',')
  : 'sem medida'

const S = '[data-form="f"]'
async function markForm(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-form]').forEach((x) => x.removeAttribute('data-form'))
    ;[...document.querySelectorAll('form')].find((f) =>
      [...f.querySelectorAll('label span')].some((x) => x.textContent.trim() === 'Contexto')).setAttribute('data-form', 'f')
  })
}
// Os campos de medida do formulário: título, tipos e teclado
async function measureFields(page) {
  return page.evaluate((s) => {
    const form = document.querySelector(s)
    const known = ['O que foi feito (opcional)', 'Duração estimada (min, opcional)']
    const legend = form.querySelector('fieldset legend')
    if (legend) {
      const inputs = [...form.querySelectorAll('fieldset input')]
      return {
        title: legend.textContent.trim(),
        kinds: [...form.querySelectorAll('fieldset label span')].map((x) => x.textContent.trim()),
        inputMode: inputs[0]?.inputMode,
      }
    }
    const lab = [...form.querySelectorAll('label')].find((l) => {
      const t = l.querySelector('span')?.textContent.trim() ?? ''
      return t.endsWith('(opcional)') && !known.includes(t)
    })
    return lab ? { title: lab.querySelector('span').textContent.trim(), kinds: [], inputMode: lab.querySelector('input').inputMode } : null
  }, S)
}
const describe = (m) => (m ? `${m.title} [${m.kinds.join(', ')}] ${m.inputMode}` : 'nenhum')
async function value(page, label) {
  return page.evaluate((s, l) => {
    const lab = [...document.querySelector(s).querySelectorAll('label')]
      .find((x) => x.querySelector('span')?.textContent.trim() === l)
    return lab?.querySelector('input')?.value
  }, S, label)
}
async function choose(page, label, optionText) {
  const v = await page.evaluate((s, l, o) => {
    const lab = [...document.querySelector(s).querySelectorAll('label')]
      .find((x) => x.querySelector('span')?.textContent.trim() === l && x.querySelector('select'))
    const sel = lab.querySelector('select')
    document.querySelectorAll('[data-pick]').forEach((x) => x.removeAttribute('data-pick'))
    sel.setAttribute('data-pick', '1')
    return [...sel.options].find((x) => x.text === o).value
  }, S, label, optionText)
  await page.select('[data-pick="1"]', v)
}
async function path(page, ...steps) {
  const labels = ['Contexto']
  for (let i = 0; i < steps.length; i++) {
    await choose(page, labels[i], steps[i])
    labels.push(`Em ${steps.slice(0, i + 1).join(' › ')}`)
  }
}
async function type(page, label, text) {
  await page.evaluate((s, l) => {
    const input = [...document.querySelector(s).querySelectorAll('label')]
      .find((x) => x.querySelector('span')?.textContent.trim() === l).querySelector('input')
    input.focus()
    input.select()
  }, S, label)
  await page.keyboard.press('Backspace')
  if (text) await page.keyboard.type(text)
}
const click = (page, text) => page.evaluate((s, t) =>
  [...document.querySelectorAll('button')].filter((b) => b.form === document.querySelector(s) || document.querySelector(s).contains(b)).find((b) => b.textContent.trim() === t).click(), S, text)
const warning = (page) => page.evaluate((s) =>
  document.querySelector(s).querySelector('p[role="status"]')?.textContent.trim() ?? '', S)
const note = (page) => page.evaluate((s) =>
  [...document.querySelector(s).querySelectorAll('p')].map((p) => p.textContent.trim())
    .find((t) => t.startsWith('Registrado com a medida anterior')) ?? '', S)
const bodyHas = (page, text) => page.evaluate((t) => document.body.innerText.includes(t), text)
async function chips(page, desc) {
  return page.evaluate((d) => {
    const a = [...document.querySelectorAll('article')].find((x) => x.textContent.includes(d))
    return a ? [...a.querySelectorAll('span.rounded-full, span[class*="rounded"]')].map((x) => x.textContent.trim()) : null
  }, desc)
}
async function openEdit(page, desc) {
  await waitForApi()
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await page.evaluate((d) => {
    document.querySelectorAll('[data-card]').forEach((x) => x.removeAttribute('data-card'))
    const a = [...document.querySelectorAll('article')].find((x) => x.textContent.includes(d))
    a.setAttribute('data-card', '1')
    a.querySelector('button[aria-label^="Editar registro"]').click()
  }, desc)
  await page.waitForSelector('[data-card="1"] form')
  await markForm(page)
}

// Estado original dos registros que a bateria mexe
const before = await get('/executions')
const original = Object.fromEntries([E902, E1106, E601, LIVRO_OPEN].map((x) => [x, before.find((e) => e.id === x)]))
const measures = await get('/measures')
kindNames = new Map(measures.flatMap((m) => m.kinds.map((k) => [k.id, k.name])))
const kindId = (measureId, name) => measures.find((m) => m.id === measureId).kinds.find((k) => k.name === name).id
const tags = await get('/tags')
const LINGUAGENS = tags.find((t) => t.name === 'Linguagens' && t.parentId === null).id
const leafOf = (e) => e.tagIds.filter((t) => !tags.some((x) => x.parentId === t && e.tagIds.includes(x.id)))
const restore = (e) => send('PUT', `/executions/${e.id}`, {
  description: e.description, completedAt: e.completedAt, rootTagId: e.rootTagId,
  tagIds: leafOf(e), phase: e.phase, measureValues: e.measure?.values ?? [],
})
const startedAt = new Date().toISOString()
let browser

try {
  for (const lang of ['pt-BR', 'en-US']) {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      args: [`--lang=${lang}`],
    })
    const page = await browser.newPage()
    page.setDefaultTimeout(10000)
    await page.setViewport({ width: 375, height: 900 })
    const puts = []
    page.on('request', (r) => { if (r.method() === 'PUT' && r.url().includes('/executions/')) puts.push(JSON.parse(r.postData())) })
    const open = async (task) => {
      await waitForApi()
      await page.goto(`${APP}/executar?tarefa=${task}`, { waitUntil: 'networkidle0' })
      await markForm(page)
    }

    if (lang === 'pt-BR') {
      // --- Histórico: um chip por valor (antes de mexer em qualquer coisa)
      await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
      const c1106 = await chips(page, 'Novo protótipo')
      check('Histórico: "3 refatoração" e "2 leitura" em chips separados',
        c1106.includes('3 refatoração') && c1106.includes('2 leitura'), JSON.stringify(c1106))
      check('Histórico: "12 exercícios"', (await chips(page, 'Exercícios de frações')).includes('12 exercícios'))
      check('Histórico: "5,2 km"', (await chips(page, 'Corrida de 5 km')).includes('5,2 km'))

      // --- Campos certos por caminho
      await open(VESTIBULAR_TASK)
      const cases = [
        [['Código', 'Pessoal', 'ai-boundaries'], 'Exercícios (opcional) [leitura, questões, refatoração] numeric', 'neto herda de Código, 3 tipos'],
        [['Vestibular', 'Matemática'], 'Exercícios (opcional) [] numeric', 'Matemática substitui (exercícios, não questões)'],
        [['Vestibular', 'Física'], 'Questões (opcional) [] numeric', 'Física herda questões'],
        [['Vestibular'], 'Questões (opcional) [] numeric', 'a própria raiz'],
        [['Exercícios', 'Corrida'], 'Km (opcional) [] decimal', 'Corrida aceita decimal'],
        [['Linguagens'], 'Exercícios (opcional) [escrita, escuta, fala, leitura] numeric', 'Linguagens, 4 tipos'],
        [['Exercícios'], 'nenhum', 'caminho sem medida (Exercícios)'],
        [['Sem tag'], 'nenhum', 'sem tag'],
      ]
      for (const [steps, expected, name] of cases) {
        await path(page, ...steps)
        const got = describe(await measureFields(page))
        check(`campos: ${name}`, got === expected, got)
      }
      await path(page, 'Vestibular', 'Matemática')
      await type(page, 'Exercícios (opcional)', '3')
      await path(page, 'Vestibular', 'Física')
      await path(page, 'Vestibular', 'Matemática')
      check('trocar o caminho limpa o que foi digitado', (await value(page, 'Exercícios (opcional)')) === '')
      check('Registrar: sem aviso (nada gravado)', (await warning(page)) === '')

      // --- Medida arquivada: o caminho fica sem campos; o registro que já usa mantém
      await send('PATCH', `/measures/${M_CORRIDA}`, { active: false })
      await open(FISICO_TASK)
      await path(page, 'Exercícios', 'Corrida')
      check('Corrida com medida arquivada: sem campos (não volta pro ancestral)', (await measureFields(page)) === null)
      await openEdit(page, 'Corrida de 5 km')
      check('editar o 601 com a medida arquivada: Km com 5,2', describe(await measureFields(page)) === 'Km (opcional) [] decimal' &&
        (await value(page, 'Km (opcional)')) === '5,2', `${describe(await measureFields(page))} ${await value(page, 'Km (opcional)')}`)
      await send('PATCH', `/measures/${M_CORRIDA}`, { active: true })

      // --- Tipo arquivado: some do registro novo; aparece no que já tem
      const LEITURA = kindId(M_CODIGO, 'leitura')
      await send('PATCH', `/measure-kinds/${LEITURA}`, { active: false })
      await open(VESTIBULAR_TASK)
      await path(page, 'Código')
      check('tipo arquivado fora do registro novo', describe(await measureFields(page)) === 'Exercícios (opcional) [questões, refatoração] numeric')
      await openEdit(page, 'Novo protótipo')
      const kept = await measureFields(page)
      check('editar o 1106: "leitura (arquivado)" com 2', kept.kinds.includes('leitura (arquivado)') &&
        (await value(page, 'leitura (arquivado)')) === '2', describe(kept))
      await send('PATCH', `/measure-kinds/${LEITURA}`, { active: true })

      // --- Gravar com tipos, e o singular no Histórico
      await open(VESTIBULAR_TASK)
      await path(page, 'Linguagens')
      await type(page, 'O que foi feito (opcional)', 'teste m5 tipos')
      await type(page, 'escuta', '2')
      await type(page, 'leitura', '1')
      await click(page, 'Registrar')
      await pause(1200)
      check('Registrar com tipos: escuta 2 e leitura 1, só os preenchidos', vals(await byDesc('teste m5 tipos')) === '2:escuta=2,leitura=1', vals(await byDesc('teste m5 tipos')))
      await open(VESTIBULAR_TASK)
      await path(page, 'Vestibular', 'Matemática')
      await type(page, 'O que foi feito (opcional)', 'teste m5 singular')
      await type(page, 'Exercícios (opcional)', '1')
      await click(page, 'Registrar')
      await pause(1200)
      check('Registrar em Matemática grava a medida da Matemática', vals(await byDesc('teste m5 singular')) === '4:-=1')
      await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
      check('Histórico: "1 exercício" no singular', (await chips(page, 'teste m5 singular')).includes('1 exercício'), JSON.stringify(await chips(page, 'teste m5 singular')))
      check('Histórico: tipos em chips separados', JSON.stringify((await chips(page, 'teste m5 tipos')).filter((t) => /^\d/.test(t)).sort()) === '["1 leitura","2 escuta"]')
      await open(VESTIBULAR_TASK)
      await path(page, 'Vestibular', 'Matemática')
      await type(page, 'O que foi feito (opcional)', 'teste m5 inteiro')
      await type(page, 'Exercícios (opcional)', '2,5')
      await click(page, 'Registrar')
      await pause(800)
      check('decimal numa medida inteira: erro na tela, nada gravado',
        !(await byDesc('teste m5 inteiro')) && (await bodyHas(page, 'número inteiro maior que zero')))
    }

    // --- Decimal nos dois idiomas
    for (const [typed, expected] of [['5,5', 5.5], ['5.5', 5.5]]) {
      await open(FISICO_TASK)
      await path(page, 'Exercícios', 'Corrida')
      const desc = `teste m5 ${lang} ${typed}`
      await type(page, 'O que foi feito (opcional)', desc)
      await type(page, 'Km (opcional)', typed)
      await click(page, 'Registrar')
      await pause(1200)
      check(`${lang} "${typed}" km → ${expected}`, vals(await byDesc(desc)) === `5:-=${expected}`, vals(await byDesc(desc)))
    }
    await open(FISICO_TASK)
    await path(page, 'Exercícios', 'Corrida')
    await type(page, 'O que foi feito (opcional)', `teste m5 ${lang} ambiguo`)
    await type(page, 'Km (opcional)', '1.234,5')
    await click(page, 'Registrar')
    await pause(800)
    check(`${lang} "1.234,5": erro na tela, nada gravado`,
      !(await byDesc(`teste m5 ${lang} ambiguo`)) && (await bodyHas(page, 'até 2 casas')))

    if (lang === 'pt-BR') {
      // --- Editar: começa nos valores; salvar sem mexer não manda medida
      await openEdit(page, 'Novo protótipo')
      check('editar o 1106: começa em refatoração 3, leitura 2, questões vazio',
        (await value(page, 'refatoração')) === '3' && (await value(page, 'leitura')) === '2' && (await value(page, 'questões')) === '')
      puts.length = 0
      await click(page, 'Salvar')
      await pause(1200)
      check('salvar sem mexer: o pedido não leva measureValues', puts.length === 1 && !('measureValues' in puts[0]), JSON.stringify(Object.keys(puts[0] ?? {})))
      check('salvar sem mexer: medida igual', vals(await exec(E1106)) === vals(original[E1106]))

      // --- O aviso: aparece na troca, some ao voltar, e salvar remove
      await openEdit(page, 'Novo protótipo')
      await path(page, 'Linguagens')
      const w = await warning(page)
      check('trocar o caminho: aviso com os valores que vão sumir',
        w.startsWith('Mudar o caminho vai remover a medida registrada') && w.includes('3 refatoração') && w.includes('2 leitura'), w)
      await path(page, 'Código')
      check('voltar pra medida do registro: aviso some e os valores voltam',
        (await warning(page)) === '' && (await value(page, 'refatoração')) === '3', await warning(page))
      await path(page, 'Exercícios')
      check('caminho sem medida também avisa', (await warning(page)).startsWith('Mudar o caminho'))
      await path(page, 'Linguagens')
      await click(page, 'Salvar')
      await pause(1200)
      check('salvar no caminho novo remove a medida', vals(await exec(E1106)) === 'sem medida', vals(await exec(E1106)))
      check('Histórico: o 1106 ficou sem chip de medida', !(await chips(page, 'Novo protótipo')).some((t) => /^\d/.test(t)))
      await restore(original[E1106])

      // --- Registro com medida anterior (902 gravado com questões do Vestibular)
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('DELETE FROM execution_measure_values WHERE task_execution_id = $1', [E902])
        await client.query('UPDATE execution_measures SET measure_id = $2, tag_id = (SELECT tag_id FROM measures WHERE id = $2) WHERE task_execution_id = $1', [E902, M_VEST])
        await client.query('INSERT INTO execution_measure_values (task_execution_id, measure_id, kind_id, quantity) VALUES ($1, $2, NULL, 7)', [E902, M_VEST])
        await client.query('COMMIT')
      } finally { client.release() }
      await openEdit(page, 'Exercícios de frações')
      check('Histórico: o valor antigo continua no chip ("7 questões")', (await chips(page, 'Exercícios de frações')).includes('7 questões'))
      check('medida anterior: nota só leitura', (await note(page)) === 'Registrado com a medida anterior: 7 questões.', await note(page))
      check('medida anterior: campo da atual (Exercícios) vazio e sem aviso',
        (await value(page, 'Exercícios (opcional)')) === '' && (await warning(page)) === '')
      puts.length = 0
      await click(page, 'Salvar')
      await pause(1200)
      check('salvar sem preencher: não manda medida, a anterior fica', !('measureValues' in (puts[0] ?? {})) && vals(await exec(E902)) === '3:-=7', vals(await exec(E902)))
      await openEdit(page, 'Exercícios de frações')
      await type(page, 'Exercícios (opcional)', '5')
      const w2 = await warning(page)
      check('preencher a atual: aviso de que a anterior sai', w2 === 'Preencher a medida atual vai remover a anterior: 7 questões.', w2)
      await click(page, 'Salvar')
      await pause(1200)
      check('salvar: a medida atual substitui (5 exercícios)', vals(await exec(E902)) === '4:-=5', vals(await exec(E902)))
      await restore(original[E902])

      // --- Finalizar com medida + Desfazer volta a de antes
      await send('PUT', `/executions/${LIVRO_OPEN}`, { description: null, completedAt: null, rootTagId: LINGUAGENS, tagIds: [], phase: null,
        measureValues: [{ kindId: kindId(M_LING, 'leitura'), quantity: 4 }] })
      await open(LIVRO_TASK)
      check('Finalizar: começa no valor que o registro tem (leitura 4)', (await value(page, 'leitura')) === '4')
      await type(page, 'leitura', '7')
      await click(page, 'Finalizar')
      await pause(1500)
      let livro = await exec(LIVRO_OPEN)
      check('Finalizar grava leitura 7', livro.completedAt !== null && vals(livro) === '2:leitura=7', vals(livro))
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Desfazer')).click())
      await pause(1500)
      livro = await exec(LIVRO_OPEN)
      check('Desfazer volta a leitura 4', livro.completedAt === null && vals(livro) === '2:leitura=4', vals(livro))
    }
    await browser.close()
  }
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser?.close().catch(() => {})
  await waitForApi()
  await send('PATCH', `/measures/${M_CORRIDA}`, { active: true }).catch(() => {})
  await send('PATCH', `/measure-kinds/${kindId(M_CODIGO, 'leitura')}`, { active: true }).catch(() => {})
  for (const e of Object.values(original)) await restore(e).catch((err) => console.log('restaurar', e.id, err.message))
  const test = `SELECT id FROM task_executions WHERE description LIKE 'teste m5%'`
  await pool.query(`DELETE FROM execution_measure_values WHERE task_execution_id IN (${test})`)
  await pool.query(`DELETE FROM execution_measures WHERE task_execution_id IN (${test})`)
  await pool.query(`DELETE FROM task_execution_tags WHERE task_execution_id IN (${test})`)
  await pool.query(`DELETE FROM time_entries WHERE task_execution_id IN (${test})`)
  await pool.query(`DELETE FROM task_executions WHERE description LIKE 'teste m5%'`)
  const extra = await pool.query('SELECT count(*)::int n FROM time_entries WHERE task_execution_id = $1 AND created_at >= $2', [LIVRO_OPEN, startedAt])
  const after = await get('/executions')
  const same = (e) => {
    const a = after.find((x) => x.id === e.id)
    const pick = (x) => JSON.stringify([x.description, x.completedAt, x.rootTagId, [...x.tagIds].sort(), x.phase, vals(x)])
    return pick(a) === pick(e)
  }
  const ms = await get('/measures')
  check('limpeza: 902, 1106, 601 e o livro como eram; medidas e tipos ativos; testes apagados',
    Object.values(original).every(same) && ms.every((m) => m.active && m.kinds.every((k) => k.active)) &&
    !after.some((e) => e.description?.startsWith('teste m5')) && extra.rows[0].n === 0,
    Object.values(original).filter((e) => !same(e)).map((e) => e.id.slice(-4)).join(',') + ` sessões novas ${extra.rows[0].n}`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
