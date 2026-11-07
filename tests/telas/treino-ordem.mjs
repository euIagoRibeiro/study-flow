// Ordem das séries quando o exercício volta na sessão (decidido em 2026-11-06:
// a UNIQUE (registro, exercício) fica, e o bloco repetido se junta ao mesmo
// exercício). Treino ao vivo: A com uma série, B com uma, A de novo (tocando no
// resumo) com outra. Esperado: dois exercícios, A antes de B, as séries de A
// na ordem em que foram feitas, no servidor, no banco (position) e na tela.
// Registro aberto próprio, sem sessão (prefixo teste-ordem), apagado no fim.
// Uso (raiz do repo): node --env-file=backend/.env tests/telas/treino-ordem.mjs
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'
import { deleteExecutions } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-ordem'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitForApi() {
  for (let i = 0; i < 40; i++) {
    try { if ((await apiFetch(`${API}/tags`)).ok) return } catch {}
    await pause(250)
  }
  throw new Error('API fora do ar')
}
async function api(method, path, body) {
  await waitForApi()
  const res = await apiFetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}

let taskId = null
let browser
try {
  taskId = (await api('POST', '/tasks', { title: `${P} tarefa` })).id
  const exercises = await api('GET', '/exercises')
  const A = exercises.find((x) => x.name === 'Puxada alta com triângulo')
  const B = exercises.find((x) => x.name === 'Supino reto com barra')
  if (!A?.active || !B?.active) throw new Error('exercícios do seed não achados')
  const open = await api('POST', '/executions', { taskId, description: `${P} reg`, completedAt: null })

  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 390, height: 900 })
  await page.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => sessionStorage.clear())
  await page.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'networkidle0' })

  const choose = async (label, option) => {
    const value = await page.evaluate((l, o) => {
      const span = [...document.querySelectorAll('main label > span')].find((s) => s.textContent === l)
      const select = span?.parentElement.querySelector('select')
      const opt = select && [...select.options].find((x) => x.textContent.trim() === o)
      if (!opt) return null
      select.setAttribute('data-t', 'x')
      return opt.value
    }, label, option)
    if (value === null) throw new Error(`campo ${label} / ${option} não achado`)
    await page.select('select[data-t="x"]', value)
    await page.evaluate(() => document.querySelector('select[data-t="x"]')?.removeAttribute('data-t'))
    await pause(200)
  }
  const section = 'section[aria-label="Treino"]'
  const current = `${section} ol[aria-label="Exercícios do treino"] > li:has(ol[aria-label^="Séries"])`
  const clickIn = (scope, text) => page.evaluate((s, t) => {
    const b = [...(document.querySelector(s)?.querySelectorAll('button') ?? [])].find((x) => x.textContent.replace(/\s+/g, ' ').trim() === t)
    if (!b) return false
    b.click()
    return true
  }, scope, text)
  const fill = async (scope, label, value) => {
    const handle = await page.evaluateHandle((s, l) => [...(document.querySelector(s)?.querySelectorAll('label span') ?? [])]
      .find((x) => x.textContent.trim() === l)?.closest('label').querySelector('input') ?? null, scope, label)
    const el = handle.asElement()
    if (!el) throw new Error(`campo ${label} não achado`)
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await el.click({ clickCount: 3 })
    await page.keyboard.press('Backspace')
    await el.type(value)
  }
  // O "Salvo" da gravação anterior continua na tela até a próxima começar
  const settle = async () => {
    await pause(400)
    for (let i = 0; i < 40; i++) {
      const status = await page.evaluate((s) => document.querySelector(`${s} [role="status"]`)?.textContent.trim() ?? '', section)
      if (status === 'Salvo') return
      await pause(150)
    }
    throw new Error('gravação não terminou')
  }
  const addExercise = async (name) => {
    if (!(await clickIn(section, 'Exercício'))) throw new Error('botão Exercício não achado')
    await pause(150)
    if (!(await clickIn('[aria-label="Escolher exercício"]', name))) throw new Error(`opção ${name} não achada`)
    await pause(200)
  }
  const addSet = async (reps, kg) => {
    await fill(current, 'Reps', reps)
    await fill(current, 'Kg', kg)
    if (!(await clickIn(current, 'Adicionar série'))) throw new Error('Adicionar série não achado')
    await settle()
  }

  await choose('Contexto', 'Exercícios')
  await choose('Em Exercícios', 'Treino')
  await addExercise(A.name)
  await addSet('12', '25')
  await addExercise(B.name)
  await addSet('10', '40')
  // A de novo: tocar no resumo reabre o mesmo exercício
  const reopened = await page.evaluate((s, n) => {
    const li = [...document.querySelectorAll(`${s} ol[aria-label="Exercícios do treino"] > li`)].find((x) => x.getAttribute('aria-label') === n)
    const b = li?.querySelector('button')
    if (!b) return false
    b.click()
    return true
  }, section, A.name)
  await pause(200)
  check('A volta pelo resumo (tocar abre o mesmo exercício)', reopened)
  await addSet('8', '30')

  const srv = (await api('GET', '/executions')).find((e) => e.id === open.id)
  const shape = (srv?.workout ?? []).map((w) => `${w.exerciseId === A.id ? 'A' : w.exerciseId === B.id ? 'B' : '?'}:${w.sets.map((x) => `${x.reps}x${x.weightKg}`).join(',')}`)
  check('servidor: dois exercícios, A antes de B, A com 12x25 e depois 8x30', JSON.stringify(shape) === JSON.stringify(['A:12x25,8x30', 'B:10x40']), JSON.stringify(shape))
  const db = await pool.query(
    `SELECT ee.exercise_id, ee.position AS ep, s.position AS sp, s.reps
     FROM execution_exercises ee JOIN exercise_sets s ON s.execution_exercise_id = ee.id
     WHERE ee.task_execution_id = $1 ORDER BY ee.position, s.position`, [open.id])
  const rows = db.rows.map((r) => `${r.exercise_id === A.id ? 'A' : 'B'}${r.ep}.${r.sp}=${r.reps}`)
  check('banco: posições A1.1=12, A1.2=8, B2.1=10 (um exercício A só)', JSON.stringify(rows) === JSON.stringify(['A1.1=12', 'A1.2=8', 'B2.1=10']), JSON.stringify(rows))
  const shown = await page.evaluate((s) => [...document.querySelectorAll(`${s} ol[aria-label="Exercícios do treino"] > li`)].map((li) => ({
    name: li.getAttribute('aria-label'),
    sets: [...li.querySelectorAll('ol[aria-label^="Séries"] > li')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
  })), section)
  check('tela: A primeiro, aberto, com 12 × 25 e depois 8 × 30', shown.length === 2 && shown[0].name === A.name && shown[1].name === B.name &&
    shown[0].sets.length === 2 && /12 × 25 kg/.test(shown[0].sets[0]) && /8 × 30 kg/.test(shown[0].sets[1]), JSON.stringify(shown))
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  if (browser) await browser.close()
  await waitForApi()
  if (taskId) {
    await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [taskId])).rows.map((r) => r.id))
    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId])
  }
  const left = await pool.query(`SELECT (SELECT count(*) FROM tasks WHERE title LIKE $1)::int + (SELECT count(*) FROM task_executions WHERE description LIKE $1)::int AS n`, [`${P}%`])
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
