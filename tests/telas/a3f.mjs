// A3f: treino no Histórico (exibição) e na edição do registro; trava do
// exercício sem série (edição e Finalizar). Registros próprios + 1403 do seed
// (devolvido inteiro); catálogo fotografado. Rodar da raiz:
// node --env-file=backend/.env a3f.mjs
import puppeteer from 'puppeteer-core'

if (!process.env.DATABASE_URL) throw new Error('rodar com --env-file=backend/.env')
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const TASK = '5eed0000-0000-4000-8000-000000000006'
const E1403 = '5eed0000-0000-4000-8000-000000001403'
const DESC = 'a3f teste'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const serverExec = async (id) => (await api('GET', '/executions')).body.find((e) => e.id === id)
const sets = (w) => (w ?? []).map((x) => `${x.exerciseId.slice(-2)}:` + x.sets.map((s) => `${s.reps}x${s.weightKg ?? 'c'}`).join(','))

const catalogBefore = (await api('GET', '/exercises')).body
const original1403 = await serverExec(E1403)
const created = []
const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  const tags = (await api('GET', '/tags')).body
  const EXERC = tags.find((t) => t.name === 'Exercícios' && !t.parentId)
  const sub = (n) => tags.find((t) => t.name === n && t.parentId === EXERC.id)
  const ACAD = sub('Academia'), CASA = sub('Casa')
  const ex = (n) => catalogBefore.find((x) => x.name === n)
  const TRI = ex('Puxada alta com triângulo'), AGACH = ex('Agachamento livre'), SUPINO = ex('Supino reto com barra'), ROSCA = ex('Rosca direta com barra')

  // Registro de teste, concluído: misto (com peso + peso do corpo) e todo no corpo
  const r = await api('POST', '/executions', { taskId: TASK, description: DESC, completedAt: new Date(Date.now() - 3600e3).toISOString(), rootTagId: EXERC.id, tagIds: [ACAD.id] })
  const R = r.body.id
  created.push(R)
  await api('PUT', `/executions/${R}`, { description: DESC, completedAt: r.body.completedAt, workout: [
    { exerciseId: TRI.id, sets: [{ reps: 10, weightKg: 20 }, { reps: 10, weightKg: null }] },
    { exerciseId: AGACH.id, sets: [{ reps: 15, weightKg: null }, { reps: 12, weightKg: null }] },
  ] })

  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  page.on('dialog', (d) => d.accept())
  await page.setViewport({ width: 390, height: 900 })
  let puts = []
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.method() === 'PUT' && req.url().includes('/executions/')) puts.push({ url: req.url(), body: JSON.parse(req.postData() ?? '{}') })
    req.continue()
  })

  // ---- helpers: cartão pelo texto da descrição
  const cardSel = (desc) => page.evaluate((desc) => {
    document.querySelectorAll('[data-t]').forEach((x) => x.removeAttribute('data-t'))
    const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll('p')].some((p) => p.textContent.trim() === desc))
    a?.setAttribute('data-t', 'card')
    return !!a
  }, desc)
  const C = '[data-t="card"]'
  const S = `${C} section[aria-label="Treino"]`
  const click = (scope, text, starts = false) => page.evaluate((s, t, starts) => {
    const b = [...(document.querySelector(s)?.querySelectorAll('button') ?? [])].find((x) => {
      const v = x.textContent.replace(/\s+/g, ' ').trim()
      return starts ? v.startsWith(t) : v === t
    })
    if (!b) return false
    b.click(); return true
  }, scope, text, starts)
  const workoutList = () => page.evaluate((C) => [...(document.querySelector(C)?.querySelectorAll('ul[aria-label="Treino"] > li') ?? [])].map((li) => [...li.children].map((c) => c.textContent.trim())), C)
  const openEdit = async () => { await page.evaluate((C) => document.querySelector(`${C} button[aria-label^="Editar registro"]`).click(), C); await pause(200) }
  const save = async () => {
    const ok = await page.evaluate((C) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Salvar' && x.form && document.querySelector(C).contains(x.form))
      if (!b) return false
      b.click(); return true
    }, C)
    if (!ok) throw new Error('Salvar do registro não achado')
    await pause(700)
  }
  const choose = async (label, option) => {
    const v = await page.evaluate((C, label, option) => {
      const span = [...document.querySelector(C).querySelectorAll('label > span')].find((s) => s.textContent === label)
      const select = span.parentElement.querySelector('select')
      select.setAttribute('data-s', 'x')
      return [...select.options].find((o) => o.textContent.trim() === option).value
    }, C, label, option)
    await page.select('select[data-s="x"]', v)
    await page.evaluate(() => document.querySelector('select[data-s="x"]').removeAttribute('data-s'))
    await pause(200)
  }
  const current = `${S} ol[aria-label="Exercícios do treino"] > li:has(ol[aria-label^="Séries"])`
  const fill = async (scope, label, value) => {
    const h = await page.evaluateHandle((scope, label) => [...(document.querySelector(scope)?.querySelectorAll('label span') ?? [])].find((s) => s.textContent.trim() === label)?.closest('label').querySelector('input') ?? null, scope, label)
    const el = h.asElement()
    if (!el) throw new Error(`campo ${label} não achado`)
    await el.click({ clickCount: 3 })
    await page.keyboard.press('Backspace')
    if (value) await el.type(value)
    return el
  }
  const pick = async (filter, name) => {
    await click(S, 'Exercício')
    await pause(100)
    if (filter) await fill(S, 'Buscar exercício', filter)
    await pause(100)
    if (!(await click(`${S} [aria-label="Escolher exercício"]`, name))) throw new Error(`opção ${name}`)
    await pause(150)
  }
  const cardText = () => page.evaluate((C) => document.querySelector(C)?.textContent.replace(/\s+/g, ' ') ?? '', C)

  // ===== Exibição
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  const toggles = await page.evaluate(() => [...document.querySelectorAll('article button[aria-expanded]')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter((t) => /exercícios?$/.test(t)))
  check('cartões com treino: botão "N exercícios" (seed: 3, 1, 2, 2, mais o de teste 2)', JSON.stringify(toggles) === JSON.stringify(['2 exercícios', '3 exercícios', '1 exercício', '2 exercícios', '2 exercícios']), JSON.stringify(toggles))
  await cardSel('Costas e bíceps')
  check('fechado por padrão: sem lista', (await workoutList()).length === 0)
  // 1401 é o primeiro "Costas e bíceps" (mais recente)
  await click(C, '3 exercícios')
  await pause(150)
  let list = await workoutList()
  check('1401 aberto: nome e séries em duas linhas, kg uma vez no fim', JSON.stringify(list) === JSON.stringify([
    ['Puxada alta com barra', '12 × 25, 8 × 35, 8 × 50 kg'],
    ['Puxada alta com triângulo', '8 × 40, 8 × 40, 8 × 40 kg'],
    ['Rosca martelo unilateral com halteres', '8 × 8, 8 × 8, 8 × 8 kg'],
  ]), JSON.stringify(list))
  await cardSel('Agachamento com máxima amplitude, até a falha')
  await click(C, '1 exercício')
  await pause(150)
  list = await workoutList()
  check('1402: "15 reps, peso do corpo"', JSON.stringify(list) === JSON.stringify([['Agachamento livre', '15 reps, peso do corpo']]), JSON.stringify(list))
  await cardSel(DESC)
  await click(C, '2 exercícios')
  await pause(150)
  list = await workoutList()
  check('misto: cada série completa; todo no corpo: "15, 12 reps, peso do corpo"', JSON.stringify(list) === JSON.stringify([
    ['Puxada alta com triângulo', '10 × 20 kg, 10 × peso do corpo'], ['Agachamento livre', '15, 12 reps, peso do corpo']]), JSON.stringify(list))
  // Arquivado (1403) aparece normal
  const t1403 = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('article')].filter((a) => [...a.querySelectorAll('p')].some((p) => p.textContent.trim() === 'Costas e bíceps'))
    const a = cards[cards.length - 1]
    ;[...a.querySelectorAll('button')].find((b) => b.textContent.trim() === '2 exercícios').click()
    return new Promise((r) => setTimeout(() => r([...a.querySelectorAll('ul[aria-label="Treino"] > li')].map((li) => li.textContent.trim())), 150))
  })
  check('1403: exercício arquivado aparece com o nome normal', t1403.some((x) => x.startsWith('Rosca direta com barra10 × 20')), JSON.stringify(t1403))
  // Renomear é dinâmico
  await api('PATCH', `/exercises/${TRI.id}`, { name: 'Puxada triângulo renomeada' })
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await cardSel(DESC)
  await click(C, '2 exercícios')
  await pause(150)
  list = await workoutList()
  check('renomear no catálogo: o Histórico mostra o nome novo', list[0]?.[0] === 'Puxada triângulo renomeada', JSON.stringify(list))
  await api('PATCH', `/exercises/${TRI.id}`, { name: TRI.name })

  // ===== Edição
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await cardSel(DESC)
  await openEdit()
  let sec = await page.evaluate((S) => { const s = document.querySelector(S); return s && { status: !!s.querySelector('[role="status"]'), items: [...s.querySelectorAll('ol[aria-label="Exercícios do treino"] > li')].map((li) => li.getAttribute('aria-label')) } }, S)
  check('edição: seção Treino com os 2 exercícios, sem linha de "Salvo"', sec && sec.items.length === 2 && !sec.status, JSON.stringify(sec))
  puts = []
  await fill(C, 'O que foi feito (opcional)', `${DESC} 2`)
  await save()
  check('mexer só na descrição: PUT sem workout', puts.length === 1 && !('workout' in puts[0].body), JSON.stringify(puts.map((p) => Object.keys(p.body))))
  await cardSel(`${DESC} 2`)
  await openEdit()
  // Enter no campo de reps não salva o registro
  puts = []
  await fill(current, 'Reps', '10')
  const k = await fill(current, 'Kg', '')
  await k.press('Enter')
  await pause(400)
  const stillOpen = await page.evaluate((S) => !!document.querySelector(S), S)
  check('Enter no campo da série: adiciona a série, não salva o registro', puts.length === 0 && stillOpen, `${puts.length} ${stillOpen}`)
  await save()
  let srv = await serverExec(R)
  check('série nova + Salvar: treino inteiro enviado e gravado', puts.length === 1 && Array.isArray(puts[0].body.workout) && sets(srv.workout).join() === `${TRI.id.slice(-2)}:10x20,10xc,${AGACH.id.slice(-2)}:15xc,12xc,10xc`, sets(srv.workout).join())

  // Academia → Casa sem mexer no treino: mantém
  await cardSel(`${DESC} 2`)
  await openEdit()
  puts = []
  await choose('Em Exercícios', 'Casa')
  await save()
  srv = await serverExec(R)
  check('Academia → Casa sem mexer no treino: o treino vai junto e fica', srv.tagIds.includes(CASA.id) && srv.workout?.length === 2 && Array.isArray(puts[0]?.body.workout), `${srv.tagIds} ${sets(srv.workout)}`)

  // Corrida: aviso, voltar desfaz, salvar remove
  await cardSel(`${DESC} 2`)
  await openEdit()
  await choose('Em Exercícios', 'Corrida')
  let t = await cardText()
  check('Corrida: seção some, aviso "Salvar com esse caminho vai remover o treino (2 exercícios, 5 séries)."',
    !(await page.evaluate((S) => !!document.querySelector(S), S)) && t.includes('Salvar com esse caminho vai remover o treino (2 exercícios, 5 séries).'), t.slice(-250))
  await choose('Em Exercícios', 'Casa')
  t = await cardText()
  check('de volta a Casa: aviso some, seção volta', !t.includes('vai remover o treino') && (await page.evaluate((S) => !!document.querySelector(S), S)))
  await choose('Em Exercícios', 'Corrida')
  await save()
  srv = await serverExec(R)
  check('Salvar com Corrida: treino removido', srv.workout === null && srv.tagIds.length === 1, JSON.stringify(srv.workout))

  // Registro sem treino ganha treino pelo lápis
  await cardSel(`${DESC} 2`)
  await openEdit()
  await choose('Em Exercícios', 'Academia')
  sec = await page.evaluate((S) => document.querySelector(S)?.querySelectorAll('ol[aria-label="Exercícios do treino"] > li').length ?? -1, S)
  check('registro sem treino, caminho com treino: seção vazia, com "+ Exercício"', sec === 0)
  await pick('triang', TRI.name)
  await fill(current, 'Reps', '9')
  await fill(current, 'Kg', '35')
  await click(current, 'Adicionar série')
  // Exercício sem série: trava com motivo
  await pick('supino', SUPINO.name)
  puts = []
  await save()
  t = await cardText()
  check('exercício sem série: Salvar travado com o motivo, nada enviado', puts.length === 0 && t.includes(`${SUPINO.name} está sem séries: adicione uma ou tire do treino.`), `${puts.length} ${t.slice(-200)}`)
  await page.evaluate((n) => document.querySelector(`button[aria-label="Mais ações do exercício ${n}"]`).click(), SUPINO.name)
  await pause(100)
  await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.includes('Tirar do treino')).click())
  await pause(100)
  // Criar na hora dentro da edição
  await click(S, 'Exercício')
  await fill(S, 'Buscar exercício', 'a3f novo exercício')
  await click(`${S} [aria-label="Escolher exercício"]`, 'Criar "a3f novo exercício"')
  await pause(100)
  await click(S, 'Criar')
  await pause(500)
  await fill(current, 'Reps', '5')
  await click(current, 'Adicionar série')
  await save()
  srv = await serverExec(R)
  const novo = (await api('GET', '/exercises')).body.find((x) => x.name === 'a3f novo exercício')
  check('ganhou treino (triângulo 9 × 35 + exercício criado na edição)', srv.tagIds.includes(ACAD.id) && sets(srv.workout).join() === `${TRI.id.slice(-2)}:9x35,${novo?.id.slice(-2)}:5xc`, sets(srv.workout).join())

  // Arquivado do registro (1403): mantido, com "(arquivado)", aceita série
  await page.evaluate(() => {
    document.querySelectorAll('[data-t]').forEach((x) => x.removeAttribute('data-t'))
    const cards = [...document.querySelectorAll('article')].filter((a) => [...a.querySelectorAll('p')].some((p) => p.textContent.trim() === 'Costas e bíceps'))
    cards[cards.length - 1].setAttribute('data-t', 'card')
  })
  await openEdit()
  const names = await page.evaluate((S) => [...document.querySelector(S).querySelectorAll('ol[aria-label="Exercícios do treino"] > li')].map((li) => li.textContent.replace(/\s+/g, ' ')), S)
  check('1403 na edição: "Rosca direta com barra (arquivado)"', names.some((n) => n.includes('Rosca direta com barra (arquivado)')), JSON.stringify(names))
  await click(current, '+ série igual')
  await save()
  srv = await serverExec(E1403)
  check('arquivado mantido ao salvar, com a série nova', srv.workout?.[1]?.exerciseId === ROSCA.id && srv.workout[1].sets.length === 4, sets(srv.workout).join())

  // ===== Finalizar (A3e) com exercício sem série: trava com motivo
  const o = await api('POST', '/executions', { taskId: TASK, completedAt: null, rootTagId: EXERC.id, tagIds: [ACAD.id] })
  created.push(o.body.id)
  await page.goto(`${APP}/executar?tarefa=${TASK}`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.querySelector('section[aria-label="Treino"]').closest('div').parentElement.setAttribute('data-t', 'card'))
  await pick('supino', SUPINO.name)
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Finalizar').click())
  await pause(500)
  t = await page.evaluate(() => document.body.textContent)
  srv = await serverExec(o.body.id)
  check('Finalizar com exercício sem série: travado com o motivo, continua aberto', srv.completedAt === null && t.includes(`${SUPINO.name} está sem séries: adicione uma ou tire do treino.`), `${srv.completedAt}`)
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser.close()
  for (const id of created) {
    await pool.query('DELETE FROM exercise_sets WHERE execution_exercise_id IN (SELECT id FROM execution_exercises WHERE task_execution_id = $1)', [id])
    for (const t of ['execution_exercises', 'execution_workouts', 'execution_measure_values', 'execution_measures', 'task_execution_tags', 'time_entries']) await pool.query(`DELETE FROM ${t} WHERE task_execution_id = $1`, [id])
    await pool.query('DELETE FROM task_executions WHERE id = $1', [id])
  }
  for (const x of catalogBefore) await pool.query('UPDATE exercises SET name = $2, active = $3 WHERE id = $1', [x.id, x.name, x.active])
  await api('PUT', `/executions/${E1403}/workout`, { workout: original1403.workout })
  await pool.query('DELETE FROM exercises WHERE NOT (id = ANY($1::uuid[]))', [catalogBefore.map((x) => x.id)])
  const now1403 = await serverExec(E1403)
  const nowCat = (await api('GET', '/exercises')).body
  const same = JSON.stringify(nowCat.map((x) => [x.id, x.name, x.active]).sort()) === JSON.stringify(catalogBefore.map((x) => [x.id, x.name, x.active]).sort())
  const left = (await pool.query('SELECT count(*)::int AS n FROM task_executions WHERE id = ANY($1::uuid[])', [created])).rows[0].n
  check('limpeza: registros de teste apagados, 1403 igual ao original, catálogo igual', left === 0 && same && JSON.stringify(now1403.workout) === JSON.stringify(original1403.workout) && now1403.description === original1403.description, `${left} ${same}`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
