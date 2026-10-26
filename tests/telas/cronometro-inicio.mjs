// B1 (2026-10-26): "Iniciar cronômetro" leva o que foi preenchido no
// formulário de baixo: caminho (com fase) e descrição. Antes, criava o
// registro vazio e descartava tudo em silêncio (com Exercícios › Academia
// escolhida embaixo, o painel abria só com o contexto e sem Treino). Sem
// mexer no formulário, igual a antes. "Quando", estimativa e medida não vão
// (decidido: são do registro manual). Tarefa de teste própria, apagada no
// finally com tudo o que criou.
import puppeteer from 'puppeteer-core'
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'

if (!process.env.DATABASE_URL) throw new Error('rodar com --env-file=../backend/.env (npm run telas)')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const TITLE = 'Teste B1 iniciar cronômetro'

// O seed tem uma sessão rodando, e o índice "uma rodando no app" recusaria o
// Iniciar: pausa ela aqui e devolve no finally (ended_at de volta a NULL)
const paused = (await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL RETURNING id')).rows.map((r) => r.id)
await pool.query('DELETE FROM tasks WHERE title = $1 AND id NOT IN (SELECT task_id FROM task_executions)', [TITLE])
const taskId = (await pool.query("INSERT INTO tasks (title, frequency) VALUES ($1, 'none') RETURNING id", [TITLE])).rows[0].id

async function clearExecutions() {
  const ids = (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [taskId])).rows.map((r) => r.id)
  for (const id of ids) {
    await pool.query('DELETE FROM exercise_sets WHERE execution_exercise_id IN (SELECT id FROM execution_exercises WHERE task_execution_id = $1)', [id])
    for (const t of ['execution_exercises', 'execution_workouts', 'execution_measure_values', 'execution_measures', 'task_execution_tags', 'time_entries']) await pool.query(`DELETE FROM ${t} WHERE task_execution_id = $1`, [id])
    await pool.query('DELETE FROM task_executions WHERE id = $1', [id])
  }
}
// O registro aberto da tarefa, como o banco o tem
const saved = async () => (await pool.query(
  `SELECT r.name AS raiz, e.phase, e.description,
          (SELECT string_agg(t.name, ',' ORDER BY t.level) FROM task_execution_tags et JOIN tags t ON t.id = et.tag_id WHERE et.task_execution_id = e.id) AS subtags,
          (SELECT count(*)::int FROM time_entries te WHERE te.task_execution_id = e.id AND te.ended_at IS NULL) AS rodando
   FROM task_executions e LEFT JOIN tags r ON r.id = e.root_tag_id
   WHERE e.task_id = $1 AND e.completed_at IS NULL`, [taskId])).rows

const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 390, height: 900 })
  let refuse = false
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (refuse && req.method() === 'POST' && req.url() === `${API}/executions`) {
      return req.respond({ status: 400, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"A tag Teste está arquivada"}' })
    }
    req.continue()
  })
  const url = `${APP}/executar?tarefa=${taskId}`
  const fields = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('label')].filter((l) => l.querySelector('select, input[type="text"]')).map((l) => {
    const el = l.querySelector('select, input[type="text"]')
    return [l.querySelector('span')?.textContent.trim(), el.tagName === 'SELECT' ? el.selectedOptions[0]?.textContent.trim() : el.value]
  })))
  const panel = () => page.evaluate(() => ({
    open: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Finalizar'),
    treino: !!document.querySelector('section[aria-label="Treino"]'),
    text: document.body.textContent.replace(/\s+/g, ' '),
  }))
  const choose = async (label, option) => {
    const value = await page.evaluate((label, option) => {
      const l = [...document.querySelectorAll('label')].find((x) => x.querySelector('span')?.textContent.trim() === label && x.querySelector('select'))
      if (!l) return null
      l.querySelector('select').setAttribute('data-pick', '1')
      return [...l.querySelector('select').options].find((o) => o.textContent.trim() === option)?.value ?? null
    }, label, option)
    if (value === null) throw new Error(`campo "${label}" / opção "${option}" não achados`)
    await page.select('select[data-pick="1"]', value)
    await page.evaluate(() => document.querySelector('select[data-pick]')?.removeAttribute('data-pick'))
    await pause(150)
  }
  const type = async (label, text) => {
    await page.evaluate((label) => [...document.querySelectorAll('label')].find((x) => x.querySelector('span')?.textContent.trim() === label).querySelector('input').setAttribute('data-type', '1'), label)
    await page.evaluate(() => document.querySelector('input[data-type]').scrollIntoView({ block: 'center' }))
    await page.type('input[data-type="1"]', text)
    await page.evaluate(() => document.querySelector('input[data-type]')?.removeAttribute('data-type'))
  }
  const start = async () => {
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Iniciar cronômetro').click())
    await pause(800)
  }

  // ---- 1. caminho com treino + descrição
  await page.goto(url, { waitUntil: 'networkidle0' })
  await type('O que foi feito (opcional)', 'Costas e bíceps hoje')
  await choose('Contexto', 'Exercícios')
  await choose('Em Exercícios', 'Academia')
  await start()
  let p = await panel(), f = await fields(), db = await saved()
  check('Exercícios › Academia embaixo → painel aberto já com Contexto e "Em Exercícios" escolhidos', p.open && f['Contexto'] === 'Exercícios' && f['Em Exercícios'] === 'Academia', JSON.stringify(f))
  check('a seção Treino aparece na hora (Academia marca treino)', p.treino, p.text.slice(0, 120))
  check('a descrição veio pro painel', f['O que foi feito (opcional)'] === 'Costas e bíceps hoje', JSON.stringify(f))
  check('banco: registro aberto com Exercícios › Academia, a descrição e a sessão rodando', db.length === 1 && db[0].raiz === 'Exercícios' && db[0].subtags === 'Academia' && db[0].description === 'Costas e bíceps hoje' && db[0].rodando === 1, JSON.stringify(db))
  await clearExecutions()

  // ---- 2. caminho com fase
  await page.goto(url, { waitUntil: 'networkidle0' })
  await choose('Contexto', 'Código')
  await choose('Em Código', 'Pessoal')
  await choose('Em Código › Pessoal', 'ai-boundaries')
  await choose('Fase', 'Protótipo')
  await start()
  f = await fields(); db = await saved()
  check('caminho com fase: o painel abre com Código › Pessoal › ai-boundaries e a fase Protótipo', f['Em Código › Pessoal'] === 'ai-boundaries' && f['Fase'] === 'Protótipo', JSON.stringify(f))
  check('banco: a fase gravou junto (prototipo), sem descrição', db.length === 1 && db[0].phase === 'prototipo' && db[0].subtags === 'Pessoal,ai-boundaries' && db[0].description === null, JSON.stringify(db))
  await clearExecutions()

  // ---- 3. sem mexer no formulário: igual a antes (registro vazio)
  await page.goto(url, { waitUntil: 'networkidle0' })
  await start()
  p = await panel(); f = await fields(); db = await saved()
  check('sem mexer embaixo: painel como antes ("Sem tag"), registro sem tag nem descrição', p.open && f['Contexto'] === 'Sem tag' && db.length === 1 && db[0].raiz === null && db[0].description === null, JSON.stringify({ f, db }))
  await clearExecutions()

  // ---- 4. "Quando" e estimativa não vão (são do registro manual)
  await page.goto(url, { waitUntil: 'networkidle0' })
  await type('Duração estimada (min, opcional)', '30')
  await choose('Contexto', 'Exercícios')
  await start()
  db = await saved()
  const est = (await pool.query('SELECT count(*)::int AS n FROM time_entries t JOIN task_executions e ON e.id = t.task_execution_id WHERE e.task_id = $1 AND t.estimated', [taskId])).rows[0].n
  check('estimativa digitada embaixo não vira sessão estimada; o caminho vai', db.length === 1 && db[0].raiz === 'Exercícios' && est === 0 && db[0].rodando === 1, JSON.stringify({ db, est }))
  await clearExecutions()

  // ---- 5. servidor recusa: a mensagem dele aparece, nada fica aberto
  refuse = true
  await page.goto(url, { waitUntil: 'networkidle0' })
  await choose('Contexto', 'Exercícios')
  await start()
  refuse = false
  p = await panel(); db = await saved()
  check('recusa do servidor (400): mostra a mensagem dele, painel não abre', !p.open && p.text.includes('A tag Teste está arquivada') && db.length === 0, p.text.slice(0, 200))
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
