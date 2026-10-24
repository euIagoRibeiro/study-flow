// A1d: duração estimada e "Quando" na tela (Registrar, editar, Histórico).
// Mira pelo conteúdo. Restaura o 1301 e apaga os registros de teste no
// finally, esperando a API antes de cada pedido.
import puppeteer from 'puppeteer-core'

import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const FINANCAS = '5eed0000-0000-4000-8000-000000000005'
const E1301 = '5eed0000-0000-4000-8000-000000001301'
const MIN = 60_000
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
  throw new Error('API não respondeu em 30s')
}
async function get(path) {
  await waitForApi()
  return (await fetch(API + path)).json()
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const byDescription = async (text) => (await get('/executions')).find((e) => e.description === text)
const estimateOf = async (id) => (await get('/time-entries')).find((t) => t.taskExecutionId === id && t.estimated)
const localValue = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

// Campo pelo rótulo, dentro de um escopo; valor setado como o React espera
async function fill(page, scope, label, value) {
  await page.evaluate((s, l, v) => {
    const lab = [...document.querySelector(s).querySelectorAll('label')]
      .find((x) => x.querySelector('span')?.textContent.trim() === l)
    const input = lab.querySelector('input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, scope, label, value)
}
const readField = (page, scope, label) => page.evaluate((s, l) =>
  [...document.querySelector(s).querySelectorAll('label')]
    .find((x) => x.querySelector('span')?.textContent.trim() === l)?.querySelector('input')?.value, scope, label)
const clickText = (page, scope, text) => page.evaluate((s, t) =>
  [...document.querySelectorAll('button')].filter((b) => document.querySelector(s).contains(b) || (b.form && b.form === document.querySelector(s))).find((b) => b.textContent.trim().startsWith(t)).click(), scope, text)
// Cartão do Histórico pela descrição: marca com data-card e devolve o seletor
async function card(page, description) {
  await page.evaluate((d) => {
    document.querySelectorAll('[data-card]').forEach((x) => x.removeAttribute('data-card'))
    const a = [...document.querySelectorAll('article')].find((x) => x.textContent.includes(d))
    a.setAttribute('data-card', '1')
    a.scrollIntoView({ block: 'center' })
  }, description)
  return '[data-card="1"]'
}
const LABEL = 'Duração estimada (min, opcional)'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  ignoreDefaultArgs: ['--hide-scrollbars'],
})
const original1301 = (await get('/executions')).find((e) => e.id === E1301)
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 375, height: 900 })
  const goRegister = async () => {
    await waitForApi()
    await page.goto(`${APP}/executar?tarefa=${FINANCAS}`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => [...document.querySelectorAll('form')].find((f) =>
      [...f.querySelectorAll('label span')].some((x) => x.textContent.trim() === 'Quando')).setAttribute('data-form', 'r'))
    return '[data-form="r"]'
  }

  // 1. Quando sem mexer + 45 min: grava a hora do CLIQUE
  let form = await goRegister()
  await fill(page, form, 'O que foi feito (opcional)', 'teste a1d agora')
  await fill(page, form, LABEL, '45')
  await pause(1500) // o clique acontece depois da abertura
  const click = Date.now()
  await clickText(page, form, 'Registrar')
  await page.waitForFunction(() => location.pathname === '/', { timeout: 5000 })
  let ex = await byDescription('teste a1d agora')
  const at = new Date(ex?.completedAt).getTime()
  check('Quando sem mexer = hora do clique (não da abertura)',
    Math.abs(at - click) < 5000 && new Date(at).getSeconds() + new Date(at).getMilliseconds() > 0,
    ex?.completedAt)
  let est = ex && (await estimateOf(ex.id))
  check('45 min estimados, terminando no Quando',
    est && new Date(est.endedAt).getTime() === at && new Date(est.endedAt) - new Date(est.startedAt) === 45 * MIN)

  // 2. Quando ontem 22:30 + 30 min
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 1); ontem.setHours(22, 30, 0, 0)
  form = await goRegister()
  await fill(page, form, 'O que foi feito (opcional)', 'teste a1d ontem')
  await fill(page, form, 'Quando', localValue(ontem))
  await fill(page, form, LABEL, '30')
  await clickText(page, form, 'Registrar')
  await page.waitForFunction(() => location.pathname === '/', { timeout: 5000 })
  ex = await byDescription('teste a1d ontem')
  check('Quando escolhido (ontem 22:30) gravado', ex && new Date(ex.completedAt).getTime() === ontem.getTime(), ex?.completedAt)

  // 3. Sem duração: como antes
  form = await goRegister()
  await fill(page, form, 'O que foi feito (opcional)', 'teste a1d sem')
  await clickText(page, form, 'Registrar')
  await page.waitForFunction(() => location.pathname === '/', { timeout: 5000 })
  ex = await byDescription('teste a1d sem')
  check('sem duração: registro sem sessão', ex && (await get('/time-entries')).every((t) => t.taskExecutionId !== ex.id))

  // Histórico: cartões de teste
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  let c = await card(page, 'teste a1d agora')
  check('cartão todo estimado diz "estimado" no cabeçalho',
    await page.evaluate((s) => document.querySelector(s).querySelector('div').textContent.includes('estimado'), c))
  c = await card(page, 'teste a1d ontem')
  check('registro de ontem 22:30 está no grupo "Ontem"',
    await page.evaluate((s) => /ontem/i.test(document.querySelector(s).closest('section').getAttribute('aria-label')), c))

  // 4. Editar o 1301: começa em 90; mudar o Quando move a estimativa
  c = await card(page, 'Gameplay em inglês (listening)')
  await page.evaluate((s) => document.querySelector(s).querySelector('button[aria-label^="Editar registro"]').click(), c)
  await page.waitForSelector(`${c} form`)
  check('editar: campo começa em 90', (await readField(page, `${c} form`, LABEL)) === '90')
  const quando1301 = new Date(original1301.completedAt)
  const novo = new Date(quando1301.getTime() - 60 * MIN)
  await fill(page, `${c} form`, 'Quando', localValue(novo))
  await clickText(page, `${c} form`, 'Salvar')
  await pause(1500)
  est = await estimateOf(E1301)
  check('mudar o Quando leva a estimativa junto (90 min)',
    est && new Date(est.endedAt).getTime() === novo.getTime() && new Date(est.endedAt) - new Date(est.startedAt) === 90 * MIN)

  // Lista de sessões atualizada SEM recarregar (o App usa as sessões da resposta)
  c = await card(page, 'Gameplay em inglês (listening)')
  await page.evaluate((s) => [...document.querySelector(s).querySelectorAll('button')]
    .find((b) => /sess(ão|ões)/.test(b.textContent)).click(), c)
  const row = await page.evaluate((s) => {
    const li = document.querySelector(s).querySelector('ul.border-dashed li')
    return { text: li.textContent.trim(), pencil: !!li.querySelector('button') }
  }, c)
  const hhmm = (d) => d.toTimeString().slice(0, 5)
  check('sessão na tela já movida, marcada "estimada" e sem lápis',
    row.text.includes(`${hhmm(new Date(novo.getTime() - 90 * MIN))}–${hhmm(novo)}`) &&
    row.text.includes('estimada') && !row.pencil, row.text)

  // 5. Trocar pra 60
  await page.evaluate((s) => document.querySelector(s).querySelector('button[aria-label^="Editar registro"]').click(), c)
  await page.waitForSelector(`${c} form`)
  await fill(page, `${c} form`, LABEL, '60')
  await clickText(page, `${c} form`, 'Salvar')
  await pause(1500)
  est = await estimateOf(E1301)
  check('trocar pra 60 min', est && new Date(est.endedAt) - new Date(est.startedAt) === 60 * MIN)

  // 6. Apagar o campo remove a estimativa
  c = await card(page, 'Gameplay em inglês (listening)')
  await page.evaluate((s) => document.querySelector(s).querySelector('button[aria-label^="Editar registro"]').click(), c)
  await page.waitForSelector(`${c} form`)
  await fill(page, `${c} form`, LABEL, '')
  await clickText(page, `${c} form`, 'Salvar')
  await pause(1500)
  check('campo vazio remove a estimativa', (await estimateOf(E1301)) === undefined)

  // 7. 1303 misto: cronômetro com lápis, estimada sem
  c = await card(page, 'Window functions')
  const head = await page.evaluate((s) => document.querySelector(s).querySelector('div').textContent, c)
  await page.evaluate((s) => [...document.querySelector(s).querySelectorAll('button')]
    .find((b) => /sess(ão|ões)/.test(b.textContent)).click(), c)
  const rows = await page.evaluate((s) => [...document.querySelector(s).querySelectorAll('ul.border-dashed > li')]
    .map((li) => ({ est: li.textContent.includes('estimada'), pencil: !!li.querySelector('button') })), c)
  check('misto: cabeçalho sem "estimado"; cronômetro com lápis, estimada sem',
    !head.includes('estimado') && rows.length === 2 &&
    rows.some((r) => r.est && !r.pencil) && rows.some((r) => !r.est && r.pencil), JSON.stringify(rows))
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await waitForApi()
  await fetch(`${API}/executions/${E1301}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: original1301.description, completedAt: original1301.completedAt, estimatedMinutes: 90 }),
  })
  await pool.query(`DELETE FROM time_entries WHERE task_execution_id IN
                      (SELECT id FROM task_executions WHERE description LIKE 'teste a1d%')`)
  await pool.query(`DELETE FROM task_executions WHERE description LIKE 'teste a1d%'`)
  const back = await estimateOf(E1301)
  const e1301 = (await get('/executions')).find((e) => e.id === E1301)
  const left = (await get('/executions')).filter((e) => e.description?.startsWith('teste a1d'))
  check('limpeza: 1301 de volta (Quando e 90 min), testes apagados',
    e1301.completedAt === original1301.completedAt && back &&
    new Date(back.endedAt) - new Date(back.startedAt) === 90 * MIN && left.length === 0)
  await pool.end()
  await browser.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
