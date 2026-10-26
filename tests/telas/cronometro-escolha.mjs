// B2 (2026-10-26): o caminho e a descrição escolhidos no PAINEL do
// cronômetro sobrevivem a sair e voltar (e a recarregar), só na tela (sessão
// do navegador), até o 1º exercício (o caminho) / o Finalizar (a descrição).
// Nada vai pro servidor antes disso (o motivo da A3e: toque acidental não
// grava lixo). Antes, sair e voltar perdia a escolha. Tarefa de teste
// própria, apagada no finally com tudo o que criou.
import puppeteer from 'puppeteer-core'
import pg from 'pg'
import { APP, CHROME } from '../config.mjs'

if (!process.env.DATABASE_URL) throw new Error('rodar com --env-file=../backend/.env (npm run telas)')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const TITLE = 'Teste B2 escolha no painel'
const KEY = (id) => `studyflow:cronometro:${id}`

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
const saved = async () => (await pool.query(
  `SELECT e.id, r.name AS raiz, e.description, e.completed_at IS NOT NULL AS finalizado,
          (SELECT string_agg(t.name, ',' ORDER BY t.level) FROM task_execution_tags et JOIN tags t ON t.id = et.tag_id WHERE et.task_execution_id = e.id) AS subtags,
          (SELECT count(*)::int FROM execution_exercises x WHERE x.task_execution_id = e.id) AS exercicios
   FROM task_executions e LEFT JOIN tags r ON r.id = e.root_tag_id
   WHERE e.task_id = $1 ORDER BY e.created_at DESC`, [taskId])).rows

const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 390, height: 900 })
  const url = `${APP}/executar?tarefa=${taskId}`
  const fields = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('label')].filter((l) => l.querySelector('select, input[type="text"]')).map((l) => {
    const el = l.querySelector('select, input[type="text"]')
    return [l.querySelector('span')?.textContent.trim(), el.tagName === 'SELECT' ? el.selectedOptions[0]?.textContent.trim() : el.value]
  })))
  const treino = () => page.evaluate(() => !!document.querySelector('section[aria-label="Treino"]'))
  const storage = (id) => page.evaluate((k) => sessionStorage.getItem(k), KEY(id))
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
  const clickText = async (text, scope = 'body') => {
    const ok = await page.evaluate((t, s) => {
      const b = [...document.querySelector(s).querySelectorAll('button')].find((x) => x.textContent.replace(/\s+/g, ' ').trim() === t)
      b?.click(); return !!b
    }, text, scope)
    if (!ok) throw new Error(`botão "${text}" não achado`)
    await pause(400)
  }
  // Sai pela navegação do app (Lista) e volta pela URL da tarefa
  const leaveAndBack = async () => {
    await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Principal"] a')].find((a) => a.textContent.trim() === 'Lista').click())
    await pause(400)
    await page.goto(url, { waitUntil: 'networkidle0' })
    await pause(200)
  }

  // ---- 1. escolhe no painel, sai e volta
  await page.goto(url, { waitUntil: 'networkidle0' })
  await clickText('Iniciar cronômetro')
  await pause(400)
  const id = (await saved())[0]?.id
  await choose('Contexto', 'Exercícios')
  await choose('Em Exercícios', 'Academia')
  await type('O que foi feito (opcional)', 'Peito e tríceps')
  check('escolha no painel: Treino aparece', await treino())
  check('na tela: a escolha guardada na sessão do navegador', JSON.parse((await storage(id)) ?? 'null')?.description === 'Peito e tríceps', String(await storage(id)))
  let db = await saved()
  check('servidor: nada gravado antes do 1º exercício (sem tag, sem descrição)', db.length === 1 && db[0].raiz === null && db[0].description === null, JSON.stringify(db))
  await leaveAndBack()
  let f = await fields()
  check('saiu e voltou: Exercícios › Academia e a descrição continuam', f['Contexto'] === 'Exercícios' && f['Em Exercícios'] === 'Academia' && f['O que foi feito (opcional)'] === 'Peito e tríceps', JSON.stringify(f))
  check('saiu e voltou: a seção Treino continua', await treino())
  await page.reload({ waitUntil: 'networkidle0' })
  await pause(200)
  f = await fields()
  check('recarregou a página: continua', f['Em Exercícios'] === 'Academia' && f['O que foi feito (opcional)'] === 'Peito e tríceps' && (await treino()), JSON.stringify(f))
  db = await saved()
  check('servidor: ainda nada gravado', db[0].raiz === null && db[0].description === null, JSON.stringify(db))

  // ---- 2. o 1º exercício grava o caminho (como antes); a descrição segue só na tela
  await clickText('Exercício', 'section[aria-label="Treino"]')
  await clickText('Puxada alta com triângulo', '[aria-label="Escolher exercício"]')
  await type('Reps', '10')
  await type('Kg', '30')
  await clickText('Adicionar série', 'section[aria-label="Treino"]')
  await pause(800)
  db = await saved()
  check('1º exercício: o caminho grava junto (Exercícios › Academia), a descrição não', db[0].raiz === 'Exercícios' && db[0].subtags === 'Academia' && db[0].exercicios === 1 && db[0].description === null, JSON.stringify(db))
  await leaveAndBack()
  f = await fields()
  check('depois do 1º exercício, sair e voltar: caminho do servidor, descrição da tela', f['Em Exercícios'] === 'Academia' && f['O que foi feito (opcional)'] === 'Peito e tríceps', JSON.stringify(f))

  // ---- 3. Finalizar grava a descrição e apaga a memória
  await clickText('Finalizar')
  await pause(800)
  db = await saved()
  check('Finalizar: descrição gravada', db[0].finalizado && db[0].description === 'Peito e tríceps', JSON.stringify(db))
  check('Finalizar: a chave da sessão do navegador sumiu', (await storage(id)) === null, String(await storage(id)))

  // ---- 4. um registro novo não herda nada
  await page.goto(url, { waitUntil: 'networkidle0' })
  await clickText('Iniciar cronômetro')
  await pause(400)
  const id2 = (await saved()).find((r) => !r.finalizado)?.id
  f = await fields()
  // (a tarefa agora tem um registro com Exercícios: a pré-seleção de sempre,
  // T5b, abre no CONTEXTO do último; a Academia e a descrição seriam herança)
  check('registro novo da mesma tarefa: só a pré-seleção do contexto, sem a Academia nem a descrição', id2 && id2 !== id && f['Contexto'] === 'Exercícios' && f['Em Exercícios'] === 'Nenhuma' && f['O que foi feito (opcional)'] === '', JSON.stringify(f))

  // ---- 5. memória inválida é ignorada (tag que não existe; base diferente do servidor)
  await page.evaluate((k) => sessionStorage.setItem(k, JSON.stringify({ base: '', path: ['00000000-0000-4000-a0d0-0000000000ff'], phase: null, descriptionBase: null, description: 'x' })), KEY(id2))
  await page.reload({ waitUntil: 'networkidle0' })
  await pause(200)
  f = await fields()
  check('memória com tag que não existe: caminho ignorado (pré-seleção de sempre), a descrição ainda vale', f['Contexto'] === 'Exercícios' && f['Em Exercícios'] === 'Nenhuma' && f['O que foi feito (opcional)'] === 'x', JSON.stringify(f))
  await page.evaluate((k) => sessionStorage.setItem(k, 'não é json'), KEY(id2))
  await page.reload({ waitUntil: 'networkidle0' })
  await pause(200)
  f = await fields()
  check('memória ilegível: tela como sem memória, sem quebrar', f['Contexto'] === 'Exercícios' && f['Em Exercícios'] === 'Nenhuma' && f['O que foi feito (opcional)'] === '', JSON.stringify(f))

  // ---- 6. memória com tag ARQUIVADA: ignorada. O campo esconderia a
  // arquivada de qualquer jeito (não é do registro); o efeito real seria o
  // Finalizar mandar a Natação e o servidor recusar. Então: finalizar dá certo
  const nat = (await pool.query("SELECT t.id, t.parent_id FROM tags t JOIN tags p ON p.id = t.parent_id WHERE t.name = 'Natação' AND p.name = 'Exercícios' AND NOT t.active")).rows[0]
  if (!nat) throw new Error('o seed não tem Exercícios › Natação arquivada')
  await page.evaluate((k, path) => sessionStorage.setItem(k, JSON.stringify({ base: '', path, phase: null, descriptionBase: null, description: '' })), KEY(id2), [nat.parent_id, nat.id])
  await page.reload({ waitUntil: 'networkidle0' })
  await pause(200)
  await clickText('Finalizar')
  await pause(800)
  const last = (await saved()).find((r) => r.id === id2)
  check('memória com tag arquivada (Natação): ignorada, o Finalizar grava só a pré-seleção (Exercícios)', last?.finalizado && last.raiz === 'Exercícios' && last.subtags === null, JSON.stringify(last))
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
