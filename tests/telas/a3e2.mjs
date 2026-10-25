// A3e2: criar exercício na hora, no treino ao vivo. Registro aberto próprio
// (Exercício físico) e catálogo fotografado; tudo devolvido no finally.
// Rodar da raiz: node --env-file=backend/.env a3e2.mjs
import puppeteer from 'puppeteer-core'

if (!process.env.DATABASE_URL) throw new Error('rodar com --env-file=backend/.env')
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const TASK = '5eed0000-0000-4000-8000-000000000006'
const NEW = 'Remada curvada com barra'

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

const catalogBefore = (await api('GET', '/exercises')).body
const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
let ID = null
try {
  const tags = (await api('GET', '/tags')).body
  const EXERC = tags.find((t) => t.name === 'Exercícios' && !t.parentId)
  const ACAD = tags.find((t) => t.name === 'Academia' && t.parentId === EXERC.id)
  const ex = (n) => catalogBefore.find((x) => x.name === n)
  const TRI = ex('Puxada alta com triângulo'), AGACH = ex('Agachamento livre'), ROSCA = ex('Rosca direta com barra')
  const open = await api('POST', '/executions', { taskId: TASK, completedAt: null, rootTagId: EXERC.id, tagIds: [ACAD.id] })
  ID = open.body.id
  await api('PUT', `/executions/${ID}/workout`, { workout: [{ exerciseId: TRI.id, sets: [{ reps: 8, weightKg: 40 }] }] })

  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  page.on('dialog', (d) => d.accept())
  await page.setViewport({ width: 390, height: 900 })
  let posts = 0, inject = null
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url() === `${API}/exercises`) {
      posts++
      if (inject) {
        const r = inject; inject = null
        return req.respond({ status: r.status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(r.body) })
      }
    }
    req.continue()
  })

  const S = 'section[aria-label="Treino"]'
  const P = '[aria-label="Escolher exercício"]'
  const buttons = (scope) => page.evaluate((s) => [...(document.querySelector(s)?.querySelectorAll('button') ?? [])].map((b) => b.textContent.replace(/\s+/g, ' ').trim()), scope)
  const click = (scope, text) => page.evaluate((s, t) => {
    const b = [...(document.querySelector(s)?.querySelectorAll('button') ?? [])].find((x) => x.textContent.replace(/\s+/g, ' ').trim() === t)
    if (!b) return false
    b.click(); return true
  }, scope, text)
  const text = (scope) => page.evaluate((s) => document.querySelector(s)?.textContent.replace(/\s+/g, ' ') ?? '', scope)
  const currentName = () => page.evaluate((s) => document.querySelector(`${s} ol[aria-label="Exercícios do treino"] > li:has(ol[aria-label^="Séries"])`)?.getAttribute('aria-label'), S)
  const search = async (value) => {
    const isOpen = await page.evaluate((s) => [...document.querySelector(s).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Exercício').getAttribute('aria-expanded'), S)
    if (isOpen !== 'true') await click(S, 'Exercício')
    await pause(100)
    const input = await page.evaluateHandle((s) => [...document.querySelector(s).querySelectorAll('label span')].find((x) => x.textContent.trim() === 'Buscar exercício')?.closest('label').querySelector('input'), S)
    // Centro da tela antes do clique: perto da borda, o topo fixo (107px no
    // desktop) cobre o campo e o clique triplo não seleciona o texto
    await input.asElement().evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await input.asElement().click({ clickCount: 3 })
    await page.keyboard.press('Backspace')
    await input.asElement().type(value)
    await pause(150)
    return input.asElement()
  }

  await page.goto(`${APP}/executar?tarefa=${TASK}`, { waitUntil: 'networkidle0' })

  // Nome novo: opção Criar; Voltar não cria
  await search(NEW)
  let b = await buttons(P)
  check('nome novo: só a opção Criar "…"', b.length === 1 && b[0] === `Criar "${NEW}"`, JSON.stringify(b))
  await click(P, `Criar "${NEW}"`)
  await pause(100)
  let t = await text(S)
  check('confirmação no lugar, com a lembrança do equipamento', t.includes(`Criar o exercício "${NEW}"?`) && t.includes('O equipamento faz parte do nome'), t.slice(-200))
  await click(S, 'Voltar')
  await pause(100)
  b = await buttons(P)
  check('Voltar: volta à lista com o filtro, nada criado', b[0] === `Criar "${NEW}"` && posts === 0, `${JSON.stringify(b)} ${posts}`)
  await click(P, `Criar "${NEW}"`)
  await pause(100)
  await click(S, 'Criar')
  await pause(600)
  const createdEx = (await api('GET', '/exercises')).body.find((x) => x.name === NEW)
  check('Criar: exercício no catálogo, ativo', createdEx?.active === true, JSON.stringify(createdEx))
  check('vira o exercício atual da sessão', (await currentName()) === NEW, await currentName())
  check('a escolha fecha', (await page.evaluate((s) => document.querySelector(s), P)) === null)

  // Série no novo: vai pro servidor
  const inputs = await page.$$(`${S} li:has(ol[aria-label^="Séries"]) form input`)
  await inputs[0].type('10')
  await inputs[1].type('30')
  await inputs[1].press('Enter')
  await pause(800)
  let srv = await serverExec(ID)
  check('série no exercício criado: gravada', srv.workout?.[1]?.exerciseId === createdEx?.id && srv.workout[1].sets[0].reps === 10, JSON.stringify(srv.workout))

  // Nome igual (maiúscula/espaço): sem Criar, o existente aparece
  await search('  agachamento LIVRE ')
  b = await buttons(P)
  check('nome igual com outra caixa/espaço: sem Criar, mostra o existente', b.length === 1 && b[0] === AGACH.name, JSON.stringify(b))
  // Arquivado: mensagem, sem Criar
  await search('rosca direta com barra')
  b = await buttons(P)
  t = await text(P)
  check('nome de exercício arquivado: sem Criar, "… está arquivado. Reative na tela de tags."', b.length === 0 && t.includes(`${ROSCA.name} está arquivado. Reative na tela de tags.`), `${JSON.stringify(b)} ${t}`)
  // Já na sessão: mensagem, sem Criar
  await search('puxada alta com triângulo')
  b = await buttons(P)
  t = await text(P)
  check('nome já na sessão: sem Criar, "Já está no treino."', b.length === 0 && t.includes('Já está no treino.'), `${JSON.stringify(b)} ${t}`)
  // Teto de 60
  const long = await search('x'.repeat(70))
  const len = await long.evaluate((i) => i.value.length)
  check('busca aceita no máximo 60 caracteres (o teto do nome)', len === 60, String(len))

  // 409 (catálogo desatualizado): ativo → usa o existente
  const before = posts
  inject = { status: 409, body: { error: 'Já existe um exercício com esse nome', exercise: AGACH } }
  await search('Nome qualquer 409')
  await click(P, 'Criar "Nome qualquer 409"')
  await pause(100)
  await click(S, 'Criar')
  await pause(500)
  check('409 com existente ativo: ele vira o atual', posts === before + 1 && (await currentName()) === AGACH.name, `${posts - before} ${await currentName()}`)
  // 409 arquivado: mensagem, nada entra
  inject = { status: 409, body: { error: 'Já existe um exercício com esse nome', exercise: ROSCA } }
  await search('Nome qualquer arq')
  await click(P, 'Criar "Nome qualquer arq"')
  await pause(100)
  await click(S, 'Criar')
  await pause(500)
  t = await text(S)
  check('409 com existente arquivado: mensagem, não entra na sessão', t.includes(`${ROSCA.name} está arquivado. Reative na tela de tags.`) && !(await page.evaluate((s, n) => !!document.querySelector(`${s} li[aria-label="${n}"]`), S, ROSCA.name)), t.slice(-200))
  // 409 já na sessão
  await click(S, 'Voltar')
  inject = { status: 409, body: { error: 'Já existe um exercício com esse nome', exercise: TRI } }
  await search('Nome qualquer sessao')
  await click(P, 'Criar "Nome qualquer sessao"')
  await pause(100)
  await click(S, 'Criar')
  await pause(500)
  t = await text(S)
  check('409 com existente já na sessão: "Já está no treino."', t.includes('Já está no treino.'), t.slice(-200))
  // Falha
  await click(S, 'Voltar')
  inject = { status: 500, body: { error: 'x' } }
  await search('Nome qualquer 500')
  await click(P, 'Criar "Nome qualquer 500"')
  await pause(100)
  await click(S, 'Criar')
  await pause(500)
  t = await text(S)
  check('falha: mensagem, confirmação continua aberta', t.includes('Não foi possível criar o exercício') && t.includes('Criar o exercício "Nome qualquer 500"?'), t.slice(-200))

  // O catálogo do App já tem o novo: tela de tags sem recarregar
  await page.evaluate(() => document.querySelector('a[href="/tags"]').click())
  await pause(500)
  const inCatalog = await page.evaluate((n) => [...document.querySelectorAll('section[aria-label="Exercícios"] li')].some((li) => li.textContent.includes(n)), NEW)
  check('o exercício criado aparece no catálogo da tela de tags, sem recarregar', inCatalog)
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser.close()
  if (ID) {
    await pool.query('DELETE FROM exercise_sets WHERE execution_exercise_id IN (SELECT id FROM execution_exercises WHERE task_execution_id = $1)', [ID])
    for (const t of ['execution_exercises', 'execution_workouts', 'execution_measure_values', 'execution_measures', 'task_execution_tags', 'time_entries']) await pool.query(`DELETE FROM ${t} WHERE task_execution_id = $1`, [ID])
    await pool.query('DELETE FROM task_executions WHERE id = $1', [ID])
  }
  for (const x of catalogBefore) await pool.query('UPDATE exercises SET name = $2, active = $3 WHERE id = $1', [x.id, x.name, x.active])
  await pool.query('DELETE FROM exercises WHERE NOT (id = ANY($1::uuid[]))', [catalogBefore.map((x) => x.id)])
  const now = (await api('GET', '/exercises')).body
  const same = JSON.stringify(now.map((x) => [x.id, x.name, x.active]).sort()) === JSON.stringify(catalogBefore.map((x) => [x.id, x.name, x.active]).sort())
  const openLeft = (await api('GET', '/executions')).body.filter((e) => e.taskId === TASK && e.completedAt === null).length
  check('limpeza: catálogo igual ao do começo, nenhum registro aberto de teste', same && openLeft === 0, `${same} ${openLeft}`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
