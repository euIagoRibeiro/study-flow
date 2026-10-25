// A3e1: treino ao vivo no registro aberto. Cria os PRÓPRIOS registros
// abertos (Exercício físico, sem sessão rodando: não esbarra no "Rodando" do
// seed) e apaga tudo no finally, direto no banco (não há DELETE de registro).
// Rodar: node --env-file=backend/.env a3e1.mjs (da raiz do repo)
import puppeteer from 'puppeteer-core'

if (!process.env.DATABASE_URL) throw new Error('rodar com --env-file=backend/.env')
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const TASK = '5eed0000-0000-4000-8000-000000000006' // Exercício físico
const LANG = process.argv[2] ?? 'pt-BR'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitForApi() {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${API}/tags`)).ok) return } catch {}
    await pause(250)
  }
  throw new Error('API fora do ar')
}
async function api(method, path, body) {
  await waitForApi()
  const res = await fetch(`${API}${path}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const serverExec = async (id) => (await api('GET', '/executions')).body.find((e) => e.id === id)
const sets = (w) => (w ?? []).map((x) => `${x.exerciseId.slice(-2)}:` + x.sets.map((s) => `${s.reps}x${s.weightKg ?? 'c'}`).join(','))

const created = []
const browser = await puppeteer.launch({
  executablePath: CHROME,
  ignoreDefaultArgs: ['--hide-scrollbars'],
  args: [`--lang=${LANG}`],
})
const catalogBefore = (await api('GET', '/exercises')).body
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  page.on('dialog', (d) => d.accept())
  await page.setViewport({ width: 390, height: 900 })

  // ---- dados de apoio
  const tags = (await api('GET', '/tags')).body
  const byName = (n, parent) => tags.find((t) => t.name === n && (parent === undefined || tags.find((p) => p.id === t.parentId)?.name === parent))
  const EXERC = byName('Exercícios'), ACAD = byName('Academia', 'Exercícios'), CASA = byName('Casa', 'Exercícios'), CORRIDA = byName('Corrida', 'Exercícios')
  const exercises = (await api('GET', '/exercises')).body
  const ex = (n) => exercises.find((x) => x.name === n)
  const TRI = ex('Puxada alta com triângulo'), SUPINO = ex('Supino reto com barra')

  // Recentes esperados em Academia: dos registros com treino cuja marcadora é
  // Academia, do mais recente pro mais antigo, só ativos; depois o resto
  const all = (await api('GET', '/executions')).body
  const marker = (e) => [e.rootTagId, ...e.tagIds].map((id) => tags.find((t) => t.id === id)).filter((t) => t?.tracksWorkout).sort((a, b) => b.level - a.level)[0]
  const recentIds = []
  for (const e of all.filter((e) => e.workout && e.completedAt && marker(e)?.id === ACAD.id).sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1))) {
    for (const item of e.workout) if (!recentIds.includes(item.exerciseId)) recentIds.push(item.exerciseId)
  }
  const recent = recentIds.map((id) => exercises.find((x) => x.id === id)).filter((x) => x.active).map((x) => x.name)
  const rest = exercises.filter((x) => x.active && !recent.includes(x.name)).map((x) => x.name).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))

  // ---- registro aberto de teste (sem sessão)
  const open = await api('POST', '/executions', { taskId: TASK, completedAt: null })
  if (open.status !== 201) throw new Error(`POST aberto: ${open.status} ${JSON.stringify(open.body)}`)
  const ID = open.body.id
  created.push(ID)

  // ---- helpers de tela
  const load = async () => {
    await waitForApi()
    await page.goto(`${APP}/executar?tarefa=${TASK}`, { waitUntil: 'networkidle0' })
  }
  const choose = async (label, option) => {
    const ok = await page.evaluate((label, option) => {
      const span = [...document.querySelectorAll('label > span')].find((s) => s.textContent === label)
      const select = span?.parentElement.querySelector('select')
      const opt = select && [...select.options].find((o) => o.textContent.trim() === option)
      if (!opt) return false
      select.setAttribute('data-t', 'x')
      return opt.value
    }, label, option)
    if (ok === false) throw new Error(`campo ${label} / ${option} não achado`)
    await page.select('select[data-t="x"]', ok)
    await page.evaluate(() => document.querySelector('select[data-t="x"]')?.removeAttribute('data-t'))
    await pause(200)
  }
  const section = () => page.evaluate(() => {
    const s = document.querySelector('section[aria-label="Treino"]')
    if (!s) return null
    const items = [...s.querySelectorAll('ol[aria-label="Exercícios do treino"] > li')].map((li) => ({
      name: li.getAttribute('aria-label'),
      current: !!li.querySelector('ol[aria-label^="Séries"]'),
      sets: [...li.querySelectorAll('ol[aria-label^="Séries"] > li')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
      text: li.textContent.replace(/\s+/g, ' ').trim(),
    }))
    return { status: s.querySelector('[role="status"]')?.textContent.trim() ?? '', items, text: s.textContent }
  })
  const clickIn = (scope, text) => page.evaluate((scope, text) => {
    const root = scope ? document.querySelector(scope) : document
    const b = [...(root?.querySelectorAll('button') ?? [])].find((x) => x.textContent.replace(/\s+/g, ' ').trim() === text)
    if (!b) return false
    b.click(); return true
  }, scope, text)
  const current = 'section[aria-label="Treino"] ol[aria-label="Exercícios do treino"] > li:has(ol[aria-label^="Séries"])'
  const fill = async (scope, label, value) => {
    const handle = await page.evaluateHandle((scope, label) => {
      const root = document.querySelector(scope)
      const span = [...(root?.querySelectorAll('label span') ?? [])].find((s) => s.textContent.trim() === label)
      return span?.closest('label').querySelector('input') ?? null
    }, scope, label)
    const el = handle.asElement()
    if (!el) throw new Error(`campo ${label} não achado em ${scope}`)
    // Centro da tela antes do clique: perto da borda, o topo fixo (107px no
    // desktop) cobre o campo e o clique triplo não seleciona o texto
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await el.click({ clickCount: 3 })
    await page.keyboard.press('Backspace')
    if (value) await el.type(value)
    return el
  }
  const settle = async () => {
    for (let i = 0; i < 40; i++) {
      const s = await section()
      if (s && !/Salvando/.test(s.status)) return s
      await pause(150)
    }
    return section()
  }
  const finishButton = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Finalizar')
    return b ? { disabled: b.disabled, form: b.getAttribute('form') } : null
  })
  const addExercise = async (filter, name) => {
    if (!(await clickIn('section[aria-label="Treino"]', 'Exercício'))) throw new Error('botão + Exercício não achado')
    await pause(150)
    if (filter) await fill('section[aria-label="Treino"]', 'Buscar exercício', filter)
    await pause(150)
    if (!(await clickIn('[aria-label="Escolher exercício"]', name))) throw new Error(`opção ${name} não achada`)
    await pause(200)
  }

  // Contador de pedidos de gravação do registro de teste (o preflight não conta)
  let puts = [], hold = null, fail = false
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.method() === 'PUT' && req.url().startsWith(`${API}/executions/${ID}`)) {
      puts.push({ url: req.url(), body: JSON.parse(req.postData() ?? '{}') })
      if (fail) {
        fail = false
        return req.respond({ status: 500, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"falha simulada"}' })
      }
      if (hold) { const ms = hold; hold = null; return setTimeout(() => req.continue(), ms) }
    }
    req.continue()
  })

  await load()
  let s = await section()
  check('caminho Exercícios (sem treino): sem seção Treino', s === null, JSON.stringify(s?.status))
  await choose('Em Exercícios', 'Academia')
  s = await section()
  check('Academia: seção Treino aparece', s !== null)
  check('escolher Academia não grava nada (caminho vai com o 1º exercício)', puts.length === 0 && (await serverExec(ID)).rootTagId === null, `${puts.length}`)

  // Escolha: recentes do contexto, depois o resto; arquivado e os da sessão fora
  await clickIn('section[aria-label="Treino"]', 'Exercício')
  await pause(200)
  const options = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Escolher exercício"] button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()))
  check('escolha: recentes em Academia primeiro, depois os outros em ordem alfabética, sem arquivado',
    JSON.stringify(options) === JSON.stringify([...recent, ...rest]), `${JSON.stringify(options)} x ${JSON.stringify([...recent, ...rest])}`)
  await fill('section[aria-label="Treino"]', 'Buscar exercício', 'TRIANGULO')
  await pause(150)
  const filtered = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Escolher exercício"] button')].map((b) => b.textContent.trim()))
  check('filtro sem maiúscula nem acento: "TRIANGULO" acha só o triângulo (e o Criar, por último: nome não é igual)', filtered.length === 2 && filtered[0] === TRI.name && filtered[1] === 'Criar "TRIANGULO"', JSON.stringify(filtered))
  await clickIn('[aria-label="Escolher exercício"]', TRI.name)
  await pause(200)
  s = await section()
  check('exercício escolhido vira o atual, sem séries; nada gravado (exercício sem série não vai)',
    s.items.length === 1 && s.items[0].name === TRI.name && s.items[0].current && s.items[0].sets.length === 0 && puts.length === 0, JSON.stringify(s.items))

  // 1ª série com Enter no campo de kg: grava (caminho + treino), não finaliza
  await fill(current, 'Reps', '12')
  const kg = await fill(current, 'Kg', '25')
  await kg.press('Enter')
  s = await settle()
  let srv = await serverExec(ID)
  check('Enter adiciona a série e NÃO finaliza', srv.completedAt === null && s.items[0].sets.length === 1, `${srv.completedAt} ${JSON.stringify(s.items[0].sets)}`)
  check('1ª série: um pedido, o PUT do registro com caminho + treino + descrição gravada',
    puts.length === 1 && !puts[0].url.endsWith('/workout') && puts[0].body.rootTagId === EXERC.id && puts[0].body.tagIds?.[0] === ACAD.id &&
      puts[0].body.completedAt === null && puts[0].body.description === null && Array.isArray(puts[0].body.workout),
    JSON.stringify(puts))
  check('servidor: caminho Academia + treino 12x25', srv.tagIds.includes(ACAD.id) && sets(srv.workout).join() === `${TRI.id.slice(-2)}:12x25`, JSON.stringify(sets(srv.workout)))
  check('status "Salvo"', s.status === 'Salvo', s.status)
  const empty = await page.evaluate((sel) => [...document.querySelector(sel).querySelectorAll('input')].every((i) => i.value === ''), current)
  check('campos esvaziam depois de adicionar', empty)
  check('série exibida "12 × 25 kg"', /12 × 25 kg/.test(s.items[0].sets[0]), s.items[0].sets[0])

  // + série igual; decimal; peso do corpo; erros de campo
  puts = []
  await clickIn(current, '+ série igual')
  s = await settle()
  check('"+ série igual": PUT /workout (caminho já gravado), 2 séries iguais',
    puts.length === 1 && puts[0].url.endsWith('/workout') && sets((await serverExec(ID)).workout).join() === `${TRI.id.slice(-2)}:12x25,12x25`, JSON.stringify(puts.map((p) => p.url)))
  await fill(current, 'Reps', '8')
  await fill(current, 'Kg', LANG === 'pt-BR' ? '22,5' : '22.5')
  await clickIn(current, 'Adicionar série')
  await settle()
  await fill(current, 'Reps', '10')
  await clickIn(current, 'Adicionar série')
  s = await settle()
  srv = await serverExec(ID)
  check(`decimal (${LANG}) e peso do corpo`, sets(srv.workout).join() === `${TRI.id.slice(-2)}:12x25,12x25,8x22.5,10xc`, sets(srv.workout).join())
  check('exibição "8 × 22,5 kg" e "10 × peso do corpo"', /8 × 22,5 kg/.test(s.items[0].sets[2]) && /10 × peso do corpo/.test(s.items[0].sets[3]), JSON.stringify(s.items[0].sets))
  puts = []
  await fill(current, 'Reps', '0')
  await clickIn(current, 'Adicionar série')
  await pause(200)
  let msg = await page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', current)
  check('reps 0: mensagem na tela, nada enviado', /Reps/.test(msg) && /inteiro/.test(msg) && puts.length === 0, msg.slice(0, 120))
  await fill(current, 'Reps', '8')
  await fill(current, 'Kg', '20,555')
  await clickIn(current, 'Adicionar série')
  await pause(200)
  msg = await page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', current)
  check('kg com 3 casas: mensagem, nada enviado', /Kg/.test(msg) && /2 casas/.test(msg) && puts.length === 0, msg.slice(0, 120))
  await fill(current, 'Kg', '')
  await fill(current, 'Reps', '')

  // Corrida: 1ª gravação presa; 3 toques acumulam e saem num envio só
  puts = []
  hold = 1500
  await clickIn(current, '+ série igual')
  await pause(100)
  s = await section()
  const lockedWhileSaving = await finishButton()
  check('gravação a caminho: "Salvando…" e Finalizar travado', /Salvando/.test(s.status) && lockedWhileSaving?.disabled === true, `${s.status} ${JSON.stringify(lockedWhileSaving)}`)
  await clickIn(current, '+ série igual')
  await pause(50)
  await clickIn(current, '+ série igual')
  await pause(50)
  await clickIn(current, '+ série igual')
  await pause(2500)
  s = await settle()
  srv = await serverExec(ID)
  check('3 toques durante a gravação presa: exatamente 2 pedidos (o preso + um com o estado mais novo)',
    puts.length === 2 && puts[1].body.workout[0].sets.length === 8, `${puts.length} pedidos; séries no 2º: ${puts[1]?.body.workout[0].sets.length}`)
  check('servidor termina com as 8 séries, em ordem', srv.workout[0].sets.length === 8 && sets(srv.workout).join().endsWith('10xc,10xc,10xc,10xc,10xc'), sets(srv.workout).join())

  // Falha: "Não salvo", Finalizar travado, Tentar de novo grava
  puts = []
  fail = true
  await page.evaluate((sel) => {
    const items = [...document.querySelector(sel).querySelectorAll('ol[aria-label^="Séries"] > li button')]
    items[items.length - 1].click()
  }, current)
  await pause(150)
  await clickIn(current, 'Apagar')
  s = await settle()
  const lockedOnError = await finishButton()
  check('falha (500): "Não salvo" + Tentar de novo, Finalizar travado, a tela mantém a mudança',
    /Não salvo/.test(s.status) && /Tentar de novo/.test(s.text) && lockedOnError?.disabled === true && s.items[0].sets.length === 7,
    `${s.status} ${JSON.stringify(lockedOnError)} ${s.items[0].sets.length}`)
  await clickIn('section[aria-label="Treino"]', 'Tentar de novo')
  s = await settle()
  srv = await serverExec(ID)
  check('Tentar de novo: grava (7 séries), "Salvo", Finalizar liberado',
    srv.workout[0].sets.length === 7 && s.status === 'Salvo' && (await finishButton())?.disabled === false, `${srv.workout[0].sets.length} ${s.status}`)

  // Corrigir série tocando nela
  await page.evaluate((sel) => document.querySelector(sel).querySelector('ol[aria-label^="Séries"] > li button').click(), current)
  await pause(150)
  await fill(`${current} ol[aria-label^="Séries"] > li:first-child`, 'Reps', '11')
  await fill(`${current} ol[aria-label^="Séries"] > li:first-child`, 'Kg', '27,5')
  await clickIn(`${current} ol[aria-label^="Séries"] > li:first-child`, 'Salvar')
  await settle()
  srv = await serverExec(ID)
  check('corrigir a 1ª série: 11 × 27,5', srv.workout[0].sets[0].reps === 11 && srv.workout[0].sets[0].weightKg === 27.5, JSON.stringify(srv.workout[0].sets[0]))

  // 2º exercício: o 1º vira resumo; ordem no servidor
  await addExercise('supino', SUPINO.name)
  s = await section()
  check('2º exercício vira o atual; o 1º fica resumido "… · 7 séries"',
    s.items.length === 2 && !s.items[0].current && s.items[1].current && /7 séries/.test(s.items[0].text), JSON.stringify(s.items.map((x) => [x.name, x.current, x.text.slice(0, 60)])))
  const optionsNow = await page.evaluate(async () => {
    const b = [...document.querySelectorAll('section[aria-label="Treino"] button')].find((x) => x.textContent.trim() === 'Exercício')
    b.click()
    await new Promise((r) => setTimeout(r, 150))
    const list = [...document.querySelectorAll('[aria-label="Escolher exercício"] button')].map((x) => x.textContent.trim())
    b.click()
    return list
  })
  check('os que já estão na sessão saem da escolha', !optionsNow.includes(TRI.name) && !optionsNow.includes(SUPINO.name) && optionsNow.length > 0, JSON.stringify(optionsNow))
  await fill(current, 'Reps', '10')
  await fill(current, 'Kg', '40')
  await clickIn(current, 'Adicionar série')
  await settle()
  srv = await serverExec(ID)
  check('servidor: triângulo e supino, nessa ordem', srv.workout.map((x) => x.exerciseId).join() === `${TRI.id},${SUPINO.id}`, JSON.stringify(srv.workout.map((x) => x.exerciseId)))

  // Recarregar: nada se perde
  await load()
  s = await section()
  check('recarregar a página: o treino continua (2 exercícios, 7 + 1 séries)',
    s && s.items.length === 2 && /7 séries/.test(s.items.find((x) => x.name === TRI.name)?.text ?? '') && s.items.find((x) => x.name === SUPINO.name)?.sets.length === 1,
    JSON.stringify(s?.items.map((x) => x.text.slice(0, 50))))

  // Academia → Casa: grava na hora, mantém o treino com Casa como marcadora
  puts = []
  await choose('Em Exercícios', 'Casa')
  s = await settle()
  srv = await serverExec(ID)
  check('Academia → Casa: grava na hora (PUT do registro com o treino) e mantém o treino',
    puts.length === 1 && !puts[0].url.endsWith('/workout') && srv.tagIds.includes(CASA.id) && srv.workout?.length === 2, `${puts.length} ${srv.tagIds} ${srv.workout?.length}`)

  // Casa → Corrida: aviso, nada gravado, voltar desfaz
  puts = []
  await choose('Em Exercícios', 'Corrida')
  s = await section()
  let warn = await page.evaluate(() => document.body.textContent.includes('vai remover o treino'))
  srv = await serverExec(ID)
  check('Casa → Corrida: seção some, aviso "vai remover o treino", nada gravado',
    s === null && warn && puts.length === 0 && srv.tagIds.includes(CASA.id) && srv.workout?.length === 2, `${s === null} ${warn} ${puts.length}`)
  check('aviso diz o tamanho: "2 exercícios, 8 séries"', await page.evaluate(() => document.body.textContent.includes('2 exercícios, 8 séries')))
  await choose('Em Exercícios', 'Casa')
  warn = await page.evaluate(() => document.body.textContent.includes('vai remover o treino'))
  s = await section()
  check('de volta a Casa: aviso some, seção volta, nada gravado', !warn && s?.items.length === 2 && puts.length === 0, `${warn} ${puts.length}`)

  // Tirar exercício com séries (confirmação aceita)
  await page.evaluate((n) => document.querySelector(`button[aria-label="Mais ações do exercício ${n}"]`).click(), SUPINO.name)
  await pause(100)
  await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.includes('Tirar do treino')).click())
  await settle()
  srv = await serverExec(ID)
  check('tirar o supino (com série): sai do servidor', srv.workout.length === 1 && srv.workout[0].exerciseId === TRI.id, JSON.stringify(srv.workout.map((x) => x.exerciseId)))

  // Finalizar com Corrida remove o treino; Desfazer devolve
  await choose('Em Exercícios', 'Corrida')
  const fb = await finishButton()
  check('Finalizar fora do <form> da seção: ligado por form=', !!fb?.form, JSON.stringify(fb))
  await clickIn(null, 'Finalizar')
  await pause(800)
  srv = await serverExec(ID)
  check('Finalizar com Corrida: concluído, treino removido', srv.completedAt !== null && srv.workout === null, `${srv.completedAt} ${JSON.stringify(srv.workout)}`)
  puts = []
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Desfazer')).click())
  await pause(1000)
  srv = await serverExec(ID)
  check('Desfazer: reaberto em Casa, com o treino de antes (7 séries)',
    srv.completedAt === null && srv.tagIds.includes(CASA.id) && srv.workout?.[0]?.sets.length === 7, `${srv.completedAt} ${srv.tagIds} ${JSON.stringify(sets(srv.workout))}`)
  check('Desfazer manda o treino no pedido', puts.some((p) => Array.isArray(p.body.workout)), JSON.stringify(puts.map((p) => Object.keys(p.body))))
  s = await section()
  check('Desfazer: a seção volta com o exercício', s?.items.length === 1, JSON.stringify(s?.items))

  // Finalizar em Casa: mantém o treino
  await clickIn(null, 'Finalizar')
  await pause(800)
  srv = await serverExec(ID)
  check('Finalizar em Casa: concluído com o treino', srv.completedAt !== null && srv.workout?.[0]?.sets.length === 7, `${srv.completedAt} ${JSON.stringify(sets(srv.workout))}`)

  // Caso raro: registro aberto COM medida (como depois de um Desfazer),
  // caminho vai pra Academia (gravado, a medida sai no servidor) e volta pra
  // Corrida: o Finalizar tem que mandar a medida explícita
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
  const measures = (await api('GET', '/measures')).body
  const km = measures.find((m) => m.tagId === CORRIDA.id)
  const open2 = await api('POST', '/executions', { taskId: TASK, completedAt: null, rootTagId: EXERC.id, tagIds: [CORRIDA.id], measureValues: [{ kindId: null, quantity: 5.2 }] })
  if (open2.status !== 201) throw new Error(`POST aberto com medida: ${open2.status} ${JSON.stringify(open2.body)}`)
  created.push(open2.body.id)
  const ID2 = open2.body.id
  check('apoio: registro aberto com 5,2 km', open2.body.measure?.measureId === km?.id)
  await load()
  await choose('Em Exercícios', 'Academia')
  await addExercise('', TRI.name)
  await fill(current, 'Reps', '5')
  await clickIn(current, 'Adicionar série')
  await settle()
  const mid = await serverExec(ID2)
  await choose('Em Exercícios', 'Corrida')
  await clickIn(null, 'Finalizar')
  await pause(800)
  srv = await serverExec(ID2)
  check('(apoio) a gravação do caminho tirou a medida no servidor', mid.measure === null, JSON.stringify(mid.measure))
  check('caso raro: Finalizar de volta em Corrida manda a medida (5,2 km) e tira o treino',
    srv.completedAt !== null && srv.measure?.values?.[0]?.quantity === 5.2 && srv.workout === null, JSON.stringify([srv.measure, srv.workout]))
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser.close()
  await waitForApi()
  for (const id of created) {
    await pool.query('DELETE FROM exercise_sets WHERE execution_exercise_id IN (SELECT id FROM execution_exercises WHERE task_execution_id = $1)', [id])
    for (const t of ['execution_exercises', 'execution_workouts', 'execution_measure_values', 'execution_measures', 'task_execution_tags', 'time_entries']) {
      await pool.query(`DELETE FROM ${t} WHERE task_execution_id = $1`, [id])
    }
    await pool.query('DELETE FROM task_executions WHERE id = $1', [id])
  }
  for (const x of catalogBefore) await pool.query('UPDATE exercises SET name = $2, active = $3 WHERE id = $1', [x.id, x.name, x.active])
  await pool.query('DELETE FROM exercises WHERE NOT (id = ANY($1::uuid[]))', [catalogBefore.map((x) => x.id)])
  const left = (await pool.query('SELECT count(*)::int AS n FROM task_executions WHERE id = ANY($1::uuid[])', [created])).rows[0].n
  const openLeft = (await api('GET', '/executions')).body.filter((e) => e.taskId === TASK && e.completedAt === null).length
  const nowCat = (await api('GET', '/exercises')).body
  const same = JSON.stringify(nowCat.map((x) => [x.id, x.name, x.active]).sort()) === JSON.stringify(catalogBefore.map((x) => [x.id, x.name, x.active]).sort())
  check('limpeza: registros de teste apagados, nenhum aberto em Exercício físico, catálogo igual ao do começo', left === 0 && openLeft === 0 && same, `${left} ${openLeft} ${same}`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
