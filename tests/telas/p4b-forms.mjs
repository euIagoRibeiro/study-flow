// P4b: campo de fase nos 3 formulários (Registrar, Finalizar, editar).
// Mira pelo rótulo/conteúdo. Desfaz tudo no finally (API + pg), esperando a
// API antes de cada pedido (o backend em dev reinicia sozinho às vezes).
import puppeteer from 'puppeteer-core'

import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const ids = {
  aibTask: '5eed0000-0000-4000-8000-000000000011',
  bookTask: '5eed0000-0000-4000-8000-000000000004',
  bookOpen: '5eed0000-0000-4000-8000-000000000401', // aberta, pausada, sem tag
  codigo: '5eed0000-0000-4000-9000-000000000400',
  studyflow: '5eed0000-0000-4000-9000-000000000430',
  aib: '5eed0000-0000-4000-9000-000000000411',
  exec1106: '5eed0000-0000-4000-8000-000000001106',
}
const results = []
function check(name, ok, detail = '') {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? ` (${detail})` : ''}`)
}

async function waitForApi() {
  for (let i = 0; i < 30; i++) {
    try {
      if ((await fetch(`${API}/tasks`)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('API não respondeu em 30s')
}
async function api(method, path, body) {
  await waitForApi()
  const res = await fetch(API + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}
const execution = async (id) => (await api('GET', '/executions')).find((e) => e.id === id)

// Campos pelo rótulo, dentro de um escopo (o formulário aberto)
async function fields(page, scope) {
  return page.evaluate((s) => {
    const root = document.querySelector(s)
    return [...root.querySelectorAll('label')]
      .filter((l) => l.querySelector('select'))
      .map((l) => {
        const sel = l.querySelector('select')
        return { label: l.querySelector('span').textContent.trim(), value: sel.options[sel.selectedIndex].text }
      })
  }, scope)
}
async function choose(page, scope, label, optionText) {
  const value = await page.evaluate((s, l, o) => {
    const root = document.querySelector(s)
    const lab = [...root.querySelectorAll('label')].find(
      (x) => x.querySelector('span')?.textContent.trim() === l && x.querySelector('select'))
    const sel = lab.querySelector('select')
    document.querySelectorAll('[data-pick]').forEach((x) => x.removeAttribute('data-pick'))
    sel.setAttribute('data-pick', '1')
    return [...sel.options].find((opt) => opt.text === o).value
  }, scope, label, optionText)
  await page.select('[data-pick="1"]', value)
}
const phaseOf = async (page, scope) =>
  (await fields(page, scope)).find((f) => f.label === 'Fase')?.value ?? '(sem campo)'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  ignoreDefaultArgs: ['--hide-scrollbars'],
})
const original1106 = await execution(ids.exec1106)
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 375, height: 900 })

  // --- Registrar (tarefa "Projeto ai-boundaries")
  await waitForApi()
  await page.goto(`${APP}/executar?tarefa=${ids.aibTask}`, { waitUntil: 'networkidle0' })
  const form = '[data-form="exec"]'
const markForm = () => page.evaluate(() => [...document.querySelectorAll('form')].find((f) => [...f.querySelectorAll('label span')].some((x) => x.textContent.trim() === 'Contexto')).setAttribute('data-form', 'exec'))
await markForm()
  check('só o contexto Código: sem campo de fase', (await phaseOf(page, form)) === '(sem campo)')
  await choose(page, form, 'Em Código', 'Pessoal')
  check('Código › Pessoal (projeto = Pessoal, nunca registrado com fase): campo com "Sem fase"',
    (await phaseOf(page, form)) === 'Sem fase', await phaseOf(page, form))
  await choose(page, form, 'Em Código › Pessoal', 'ai-boundaries')
  check('ai-boundaries: pré-seleciona Validação (pelo caminho, não Protótipo pela tarefa)',
    (await phaseOf(page, form)) === 'Validação', await phaseOf(page, form))
  await choose(page, form, 'Em Código', 'Empresa')
  await choose(page, form, 'Em Código › Empresa', 'equipamentos-medicos')
  check('equipamentos-medicos: Implementação (pula o registro sem fase)',
    (await phaseOf(page, form)) === 'Implementação', await phaseOf(page, form))
  await choose(page, form, 'Em Código', 'StudyFlow')
  check('StudyFlow (projeto no nível 2): Requisitos', (await phaseOf(page, form)) === 'Requisitos')
  await choose(page, form, 'Em Código', 'Nenhuma')
  check('voltar pra só o contexto: campo some', (await phaseOf(page, form)) === '(sem campo)')
  await choose(page, form, 'Contexto', 'Vestibular')
  await choose(page, form, 'Em Vestibular', 'Matemática')
  check('Vestibular (sem fases): sem campo', (await phaseOf(page, form)) === '(sem campo)')

  await choose(page, form, 'Contexto', 'Código')
  await choose(page, form, 'Em Código', 'Pessoal')
  await choose(page, form, 'Em Código › Pessoal', 'ai-boundaries')
  await choose(page, form, 'Fase', 'Protótipo')
  await page.type(`${form} input[type="text"]`, 'teste p4b registrar')
  await page.evaluate(() =>
    [...document.querySelectorAll('[data-form="exec"] button')].find((b) => b.textContent.trim() === 'Registrar').click())
  await new Promise((r) => setTimeout(r, 1500))
  const created = (await api('GET', '/executions')).find((e) => e.description === 'teste p4b registrar')
  check('Registrar grava a fase escolhida', created?.phase === 'prototipo' &&
    created.rootTagId === ids.codigo && created.tagIds.includes(ids.aib), JSON.stringify(created?.phase))

  // --- Finalizar + Desfazer (o caso do Desfazer com a mesma raiz)
  await api('PUT', `/executions/${ids.bookOpen}`, {
    description: null, completedAt: null, rootTagId: ids.codigo, tagIds: [ids.studyflow], phase: 'requisitos',
  })
  await page.goto(`${APP}/executar?tarefa=${ids.bookTask}`, { waitUntil: 'networkidle0' })
  await markForm()
  check('Finalizar: começa na fase que o registro tem', (await phaseOf(page, form)) === 'Requisitos')
  await choose(page, form, 'Fase', 'Validação')
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.form === document.querySelector('[data-form="exec"]') && b.textContent.trim() === 'Finalizar').click())
  await new Promise((r) => setTimeout(r, 1500))
  let book = await execution(ids.bookOpen)
  check('Finalizar grava a fase nova', book.completedAt !== null && book.phase === 'validacao', book.phase)
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Desfazer')).click())
  await new Promise((r) => setTimeout(r, 1500))
  book = await execution(ids.bookOpen)
  check('Desfazer volta a fase de antes (mesma raiz)', book.completedAt === null &&
    book.phase === 'requisitos' && book.rootTagId === ids.codigo, `${book.phase}, ${book.completedAt}`)

  // --- Editar no Histórico (registro 1106, protótipo, ai-boundaries)
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('article')].find((a) => a.textContent.includes('Novo protótipo'))
    card.setAttribute('data-card', '1106')
    card.querySelector('button[aria-label^="Editar registro"]').click()
  })
  await page.waitForSelector('[data-card="1106"] form')
  const edit = '[data-card="1106"] form'
  check('editar: começa na fase do registro', (await phaseOf(page, edit)) === 'Protótipo')
  await choose(page, edit, 'Em Código', 'Empresa')
  check('editar: outro projeto → "Sem fase"', (await phaseOf(page, edit)) === 'Sem fase', await phaseOf(page, edit))
  await choose(page, edit, 'Em Código', 'Pessoal')
  await choose(page, edit, 'Em Código › Pessoal', 'ai-boundaries')
  check('editar: de volta ao projeto do registro → fase dele', (await phaseOf(page, edit)) === 'Protótipo')
  await choose(page, edit, 'Fase', 'Validação')
  await page.evaluate((s) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Salvar' && (document.querySelector(s).contains(b) || b.form === document.querySelector(s))).click(), edit)
  await new Promise((r) => setTimeout(r, 1500))
  check('editar: Salvar grava a fase', (await execution(ids.exec1106)).phase === 'validacao')
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await waitForApi()
  await api('PUT', `/executions/${ids.bookOpen}`, {
    description: null, completedAt: null, rootTagId: null, tagIds: [], phase: null,
  })
  await api('PUT', `/executions/${ids.exec1106}`, {
    description: original1106.description, completedAt: original1106.completedAt, phase: original1106.phase,
  })
  await pool.query(
    `DELETE FROM task_execution_tags WHERE task_execution_id IN
       (SELECT id FROM task_executions WHERE description = 'teste p4b registrar')`)
  await pool.query(`DELETE FROM task_executions WHERE description = 'teste p4b registrar'`)
  const book = await execution(ids.bookOpen)
  const e1106 = await execution(ids.exec1106)
  const left = (await api('GET', '/executions')).filter((e) => e.description === 'teste p4b registrar')
  check('limpeza: livro aberto sem tag, 1106 igual ao original, registro de teste apagado',
    book.completedAt === null && book.rootTagId === null && book.phase === null &&
    JSON.stringify(e1106) === JSON.stringify(original1106) && left.length === 0)
  await pool.end()
  await browser.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
