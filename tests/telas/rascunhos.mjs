// N3 (2026-10-26): rascunho dos formulários só na tela (sessão do
// navegador). "gerenciar tags" (ou qualquer saída) e voltar não perde o que
// foi digitado. Registrar: volta preenchido, com "Rascunho recuperado ·
// descartar"; o "Quando" só fica se foi mexido; vale também pro "Iniciar
// cronômetro" (B1). Lápis: a edição NÃO reabre sozinha; o rascunho espera o
// mesmo lápis (com o aviso); Cancelar e Salvar apagam. Painel do cronômetro:
// os valores da medida também sobrevivem (sem aviso: tela contínua). Nada vai
// pro servidor antes de registrar/salvar/finalizar. Tarefa de teste própria;
// o 1401 do seed é restaurado no banco (o "Salvar apaga" grava de verdade).
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
const TITLE = 'Teste N3 rascunhos'
const REG = '5eed0000-0000-4000-8000-000000001401' // "Costas e bíceps", com treino
const KEY_REG = (taskId) => `studyflow:rascunho:registrar:${taskId}`
const KEY_EDIT = (id) => `studyflow:rascunho:editar:${id}`

const paused = (await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL RETURNING id')).rows.map((r) => r.id)
await pool.query('DELETE FROM tasks WHERE title = $1 AND id NOT IN (SELECT task_id FROM task_executions)', [TITLE])
const taskId = (await pool.query("INSERT INTO tasks (title, frequency) VALUES ($1, 'none') RETURNING id", [TITLE])).rows[0].id
// O 1401 como está, pra restaurar no fim
const original = (await pool.query('SELECT description, completed_at FROM task_executions WHERE id = $1', [REG])).rows[0]
const originalSets = (await pool.query('SELECT count(*)::int AS n FROM exercise_sets s JOIN execution_exercises x ON x.id = s.execution_exercise_id WHERE x.task_execution_id = $1', [REG])).rows[0].n

async function clearExecutions() {
  const ids = (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [taskId])).rows.map((r) => r.id)
  for (const id of ids) {
    await pool.query('DELETE FROM exercise_sets WHERE execution_exercise_id IN (SELECT id FROM execution_exercises WHERE task_execution_id = $1)', [id])
    for (const t of ['execution_exercises', 'execution_workouts', 'execution_measure_values', 'execution_measures', 'task_execution_tags', 'time_entries']) await pool.query(`DELETE FROM ${t} WHERE task_execution_id = $1`, [id])
    await pool.query('DELETE FROM task_executions WHERE id = $1', [id])
  }
}
const regs = async () => (await pool.query(
  `SELECT e.id, e.description, e.completed_at IS NULL AS aberta, r.name AS raiz,
          (SELECT string_agg(t.name, ',' ORDER BY t.level) FROM task_execution_tags et JOIN tags t ON t.id = et.tag_id WHERE et.task_execution_id = e.id) AS subtags,
          (SELECT string_agg(v.quantity::text, ',') FROM execution_measure_values v WHERE v.task_execution_id = e.id) AS medida
   FROM task_executions e LEFT JOIN tags r ON r.id = e.root_tag_id WHERE e.task_id = $1 ORDER BY e.created_at`, [taskId])).rows
const reg1401 = async () => (await pool.query(
  `SELECT e.description, (SELECT count(*)::int FROM exercise_sets s JOIN execution_exercises x ON x.id = s.execution_exercise_id WHERE x.task_execution_id = e.id) AS series
   FROM task_executions e WHERE e.id = $1`, [REG])).rows[0]

const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 390, height: 900 })
  const url = `${APP}/executar?tarefa=${taskId}`
  const go = async (u) => { await page.goto(u, { waitUntil: 'networkidle0' }); await pause(200) }
  // Campos visíveis (dentro de `scope`): rótulo → valor
  const fields = (scope = 'main') => page.evaluate((s) => Object.fromEntries([...document.querySelector(s).querySelectorAll('label')].filter((l) => l.querySelector('select, input')).map((l) => {
    const el = l.querySelector('select, input')
    return [l.querySelector('span')?.textContent.trim(), el.tagName === 'SELECT' ? el.selectedOptions[0]?.textContent.trim() : el.value]
  })), scope)
  const notice = (scope = 'main') => page.evaluate((s) => document.querySelector(s)?.textContent.includes('Rascunho recuperado') ?? false, scope)
  const storage = (k) => page.evaluate((key) => sessionStorage.getItem(key), k)
  const choose = async (label, option, scope = 'main') => {
    const value = await page.evaluate((label, option, s) => {
      const l = [...document.querySelector(s).querySelectorAll('label')].find((x) => x.querySelector('span')?.textContent.trim() === label && x.querySelector('select'))
      if (!l) return null
      l.querySelector('select').setAttribute('data-pick', '1')
      return [...l.querySelector('select').options].find((o) => o.textContent.trim() === option)?.value ?? null
    }, label, option, scope)
    if (value === null) throw new Error(`campo "${label}" / opção "${option}" não achados`)
    await page.select('select[data-pick="1"]', value)
    await page.evaluate(() => document.querySelector('select[data-pick]')?.removeAttribute('data-pick'))
    await pause(150)
  }
  const type = async (label, text, scope = 'main', replace = false) => {
    await page.evaluate((label, s) => {
      const input = [...document.querySelector(s).querySelectorAll('label')].find((x) => x.querySelector('span')?.textContent.trim() === label).querySelector('input')
      input.setAttribute('data-type', '1')
      input.scrollIntoView({ block: 'center' })
    }, label, scope)
    if (replace) await page.click('input[data-type="1"]', { clickCount: 3 })
    await page.type('input[data-type="1"]', text)
    await page.evaluate(() => document.querySelector('input[data-type]')?.removeAttribute('data-type'))
    await pause(150)
  }
  const clickText = async (text, scope = 'main') => {
    const ok = await page.evaluate((t, s) => {
      const b = [...document.querySelector(s).querySelectorAll('button, a')].find((x) => x.textContent.replace(/\s+/g, ' ').trim() === t)
      b?.scrollIntoView({ block: 'center' }); b?.click(); return !!b
    }, text, scope)
    if (!ok) throw new Error(`"${text}" não achado`)
    await pause(400)
  }
  // Vai às tags pelo "gerenciar tags" do formulário e volta pelo "← Voltar"
  const viaTags = async (scope = 'main') => {
    await clickText('gerenciar tags', scope)
    if (!(await page.evaluate(() => location.pathname)).startsWith('/tags')) throw new Error('não abriu as tags')
    await clickText('← Voltar')
    await pause(300)
  }

  // ======== A. Registrar
  await go(url)
  await type('O que foi feito (opcional)', 'Rascunho A')
  await type('Duração estimada (min, opcional)', '30')
  await choose('Contexto', 'Exercícios')
  await choose('Em Exercícios', 'Corrida')
  await type('Km (opcional)', '5,5')
  let saved = JSON.parse((await storage(KEY_REG(taskId))) ?? 'null')
  check('Registrar: o rascunho fica na sessão do navegador, com o "Quando" fora (não mexido)', saved?.description === 'Rascunho A' && saved.when === null, JSON.stringify(saved))
  await viaTags()
  let f = await fields()
  check('Registrar: "gerenciar tags" e "← Voltar" — tudo de volta (descrição, duração, Exercícios › Corrida, 5,5 km)',
    f['O que foi feito (opcional)'] === 'Rascunho A' && f['Duração estimada (min, opcional)'] === '30' && f['Contexto'] === 'Exercícios' && f['Em Exercícios'] === 'Corrida' && f['Km (opcional)'] === '5,5', JSON.stringify(f))
  check('Registrar: com o aviso "Rascunho recuperado"', await notice())
  check('Registrar: nada gravado no servidor', (await regs()).length === 0, JSON.stringify(await regs()))
  await page.reload({ waitUntil: 'networkidle0' }); await pause(200)
  check('Registrar: recarregar a página também mantém', (await fields())['O que foi feito (opcional)'] === 'Rascunho A' && (await notice()))
  await clickText('descartar')
  f = await fields()
  check('"descartar": formulário intocado, sem aviso, rascunho apagado', f['O que foi feito (opcional)'] === '' && f['Duração estimada (min, opcional)'] === '' && f['Contexto'] === 'Sem tag' && !(await notice()) && (await storage(KEY_REG(taskId))) === null, JSON.stringify(f))
  await go(`${APP}/`)
  await go(url)
  check('formulário intocado: sair e voltar não mostra aviso', !(await notice()))
  // Registrar apaga o rascunho
  await type('O que foi feito (opcional)', 'Rascunho B')
  await choose('Contexto', 'Exercícios')
  await clickText('Registrar')
  await pause(500)
  check('Registrar grava (descrição do rascunho) e apaga o rascunho', (await regs()).some((r) => r.description === 'Rascunho B') && (await storage(KEY_REG(taskId))) === null, JSON.stringify(await regs()))
  await clearExecutions()

  // ---- B1 com rascunho recuperado: o "Iniciar" leva o que voltou
  await go(url)
  await type('O que foi feito (opcional)', 'Treino recuperado')
  await choose('Contexto', 'Exercícios')
  await choose('Em Exercícios', 'Academia')
  await viaTags()
  await clickText('Iniciar cronômetro')
  await pause(500)
  let db = await regs()
  f = await fields()
  check('rascunho recuperado + "Iniciar cronômetro": o registro nasce com Academia e a descrição (B1)', db.length === 1 && db[0].aberta && db[0].subtags === 'Academia' && db[0].description === 'Treino recuperado' && f['Em Exercícios'] === 'Academia', JSON.stringify({ db, f }))
  // o conteúdo foi pro registro: não pode voltar como "Rascunho recuperado"
  // depois de finalizar (achado na rodada completa do N3)
  check('Iniciar com sucesso apaga o rascunho do Registrar', (await storage(KEY_REG(taskId))) === null, String(await storage(KEY_REG(taskId))))

  // ======== C. Painel do cronômetro: valores da medida sobrevivem
  await choose('Em Exercícios', 'Corrida')
  await type('Km (opcional)', '3,2')
  await go(`${APP}/`)
  await go(url)
  f = await fields()
  check('painel: sair e voltar mantém Corrida e os 3,2 km (sem aviso: tela contínua)', f['Em Exercícios'] === 'Corrida' && f['Km (opcional)'] === '3,2' && !(await notice()), JSON.stringify(f))
  await clickText('Finalizar')
  await pause(600)
  db = await regs()
  check('Finalizar grava os 3,2 km', db.length === 1 && !db[0].aberta && db[0].subtags === 'Corrida' && db[0].medida === '3.20', JSON.stringify(db))
  await clearExecutions()

  // ======== B. Lápis (Histórico, 1401)
  const mark = () => page.evaluate((d) => {
    document.querySelectorAll('[data-t]').forEach((x) => x.removeAttribute('data-t'))
    const own = [...document.querySelectorAll('article')].filter((a) => [...a.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === d))
    own[0]?.setAttribute('data-t', 'reg')
    return own.length
  }, original.description)
  const pencil = () => page.evaluate(() => document.querySelector('[data-t="reg"] button[aria-label^="Editar registro"]').click()).then(() => pause(300))
  const editOpen = () => page.evaluate(() => !!document.querySelector('[data-t="reg"] form'))
  await go(`${APP}/historico`)
  await mark()
  await pencil()
  await type('O que foi feito (opcional)', ' (rascunho)', '[data-t="reg"]')
  await type('Reps', '9', '[data-t="reg"]')
  await type('Kg', '9', '[data-t="reg"]')
  await clickText('Adicionar série', '[data-t="reg"]')
  check('lápis: o rascunho fica na sessão do navegador (com o treino)', JSON.parse((await storage(KEY_EDIT(REG))) ?? 'null')?.workout?.flatMap((x) => x.sets).length === originalSets + 1, await storage(KEY_EDIT(REG)))
  await viaTags('[data-t="reg"]')
  await mark()
  check('lápis: ao voltar, a edição NÃO reabre sozinha', !(await editOpen()))
  await pencil()
  f = await fields('[data-t="reg"]')
  const sets = await page.evaluate(() => document.querySelector('[data-t="reg"]').textContent.match(/9 × 9 kg/g)?.length ?? 0)
  check('lápis: tocar no mesmo lápis traz o rascunho (descrição + a série nova) e o aviso', f['O que foi feito (opcional)'] === `${original.description} (rascunho)` && sets === 1 && (await notice('[data-t="reg"]')), JSON.stringify({ f, sets }))
  check('lápis: nada gravado no servidor', JSON.stringify(await reg1401()) === JSON.stringify({ description: original.description, series: originalSets }), JSON.stringify(await reg1401()))
  await clickText('Cancelar', '[data-t="reg"]')
  check('Cancelar apaga o rascunho', (await storage(KEY_EDIT(REG))) === null)
  await pencil()
  f = await fields('[data-t="reg"]')
  check('reabrir depois do Cancelar: o registro como está, sem aviso', f['O que foi feito (opcional)'] === original.description && !(await notice('[data-t="reg"]')), JSON.stringify(f))
  // Rascunho com lixo: ignorado (antes do Salvar: depois dele, o 1401 muda de
  // descrição e o cartão seria achado no 1403, que tem a mesma)
  await page.evaluate((k) => sessionStorage.setItem(k, JSON.stringify({ description: 1, path: 'x' })), KEY_EDIT(REG))
  await page.reload({ waitUntil: 'networkidle0' }); await pause(200)
  await mark()
  await pencil()
  check('rascunho com lixo: ignorado (sem aviso, o registro como está)', !(await notice('[data-t="reg"]')) && (await fields('[data-t="reg"]'))['O que foi feito (opcional)'] === original.description)
  // Salvar apaga o rascunho (grava de verdade: o 1401 é restaurado no finally)
  await type('O que foi feito (opcional)', ' salvo', '[data-t="reg"]')
  await clickText('Salvar', '[data-t="reg"]')
  await pause(600)
  check('Salvar grava e apaga o rascunho', (await reg1401()).description === `${original.description} salvo` && (await storage(KEY_EDIT(REG))) === null, JSON.stringify(await reg1401()))
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser.close()
  await clearExecutions()
  await pool.query('DELETE FROM tasks WHERE id = $1', [taskId])
  await pool.query('UPDATE task_executions SET description = $2, completed_at = $3 WHERE id = $1', [REG, original.description, original.completed_at])
  await pool.query('UPDATE time_entries SET ended_at = NULL WHERE id = ANY ($1::uuid[])', [paused])
  const back = await reg1401()
  check('limpeza: tarefa de teste apagada, 1401 restaurado, sessão do seed rodando de novo',
    back.description === original.description && back.series === originalSets &&
    (await pool.query('SELECT count(*)::int AS n FROM tasks WHERE title = $1', [TITLE])).rows[0].n === 0 &&
    (await pool.query('SELECT count(*)::int AS n FROM time_entries WHERE ended_at IS NULL AND id = ANY ($1::uuid[])', [paused])).rows[0].n === paused.length,
    JSON.stringify(back))
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
