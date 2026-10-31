// A3d: marcar treino na tela de tags + seção "Exercícios". Cria a própria
// árvore (teste-a3d › sub › neto), um exercício pra apagar e uma marcadora
// com 1 registro (Exercícios › teste-casa); usa Treino e o catálogo do seed só
// pra ler e pra mudanças que desfaz no finally.
import puppeteer from 'puppeteer-core'

import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
const { Pool } = pg
// A limpeza usa o banco direto: sem a URL, a bateria sujaria o banco e não limparia
if (!process.env.DATABASE_URL) throw new Error('rodar com --env-file=backend/.env')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const REMADA = '5eed0000-0000-4000-b000-000000000007'
const TASK = '5eed0000-0000-4000-8000-000000000006'
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
async function api(method, path, body) {
  await waitForApi()
  const res = await fetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  return text ? JSON.parse(text) : null
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const tagById = async (id) => (await api('GET', '/tags')).find((t) => t.id === id)
const exerciseById = async (id) => (await api('GET', '/exercises')).find((x) => x.id === id)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  ignoreDefaultArgs: ['--hide-scrollbars'],
})
const ids = {}
// Foto do catálogo do seed: a limpeza devolve TODOS ao estado inicial (um
// clique errado já renomeou e arquivou outro exercício numa rodada)
const catalog = (await api('GET', '/exercises')).filter((x) => x.id.startsWith('5eed'))
try {
  ids.root = (await api('POST', '/tags', { name: 'teste-a3d' })).id
  ids.sub = (await api('POST', '/tags', { name: 'sub', parentId: ids.root })).id
  ids.neto = (await api('POST', '/tags', { name: 'neto', parentId: ids.sub })).id
  ids.ex = (await api('POST', '/exercises', { name: 'teste-a3d apagar' })).id
  const exerc = (await api('GET', '/tags')).find((t) => t.name === 'Exercícios')
  ids.casa = (await api('POST', '/tags', { name: 'teste-casa', parentId: exerc.id })).id
  await api('PATCH', `/tags/${ids.casa}`, { tracksWorkout: true })
  const usado = await api('POST', '/exercises', { name: 'teste-a3d usado' })
  const reg = await api('POST', '/executions', { taskId: TASK, description: 'teste-a3d', completedAt: new Date().toISOString(), rootTagId: exerc.id, tagIds: [ids.casa] })
  ids.reg = reg.id
  await api('PUT', `/executions/${reg.id}`, { description: reg.description, completedAt: reg.completedAt, workout: [{ exerciseId: usado.id, sets: [{ reps: 5, weightKg: null }] }] })

  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  page.on('dialog', (d) => d.accept())
  await page.setViewport({ width: 375, height: 900 })
  const load = async () => {
    await waitForApi()
    await page.goto(`${APP}/tags`, { waitUntil: 'networkidle0' })
    for (const name of ['teste-a3d', 'sub', 'Exercícios', 'Treino']) {
      await page.evaluate((n) => {
        const b = document.querySelector(`button[aria-label="Subtags de ${n}"]`)
        if (b && b.getAttribute('aria-expanded') !== 'true') b.click()
      }, name)
      await pause(150)
    }
  }
  // Abre o menu ⋯ pelo rótulo; clica no item (se habilitado) e devolve os itens
  const menu = async (label, item) => {
    await page.evaluate((l) => document.querySelector(`button[aria-haspopup="menu"][aria-label="${l}"]`).click(), label)
    await page.waitForSelector('[role="menu"]')
    const items = await page.evaluate((i) => {
      const all = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')]
      const found = i ? all.find((b) => b.textContent.trim().startsWith(i)) : undefined
      if (found && found.getAttribute('aria-disabled') !== 'true') found.click()
      return all.map((b) => ({ text: b.textContent.trim(), disabled: b.getAttribute('aria-disabled') === 'true' }))
    }, item)
    await page.keyboard.press('Escape')
    await pause(400)
    return items
  }
  const tagMenu = (path, item) => menu(`Mais ações de ${path}`, item)
  const exMenu = (name, item) => menu(`Mais ações do exercício ${name}`, item)
  const find = (items, start) => items.find((i) => i.text.startsWith(start))
  // Chips da linha da tag (a linha = o div com o menu da tag)
  const chips = (path) => page.evaluate((p) => {
    const btn = document.querySelector(`button[aria-label="Mais ações de ${p}"]`)
    const row = btn?.closest('li')?.firstElementChild
    return row ? [...row.querySelectorAll('span.rounded-full')].map((s) => s.textContent.trim()) : null
  }, path)
  const section = () => page.evaluate(() => {
    const s = document.querySelector('section[aria-label="Exercícios"]')
    if (!s) return null
    const rows = [...s.querySelectorAll('li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim())
    const toggle = s.querySelector('button[aria-expanded]:not([aria-haspopup])')
    return { rows, toggle: toggle ? { text: toggle.textContent.trim(), open: toggle.getAttribute('aria-expanded') } : null }
  })

  // --- Marcar treino
  await load()
  let items = await tagMenu('teste-a3d', '')
  const usar = find(items, 'Usar treino')
  check('raiz: "Usar treino" habilitado, com o aviso das subtags', usar && !usar.disabled && usar.text.includes('Vale também para as subtags'), JSON.stringify(usar))
  await tagMenu('teste-a3d', 'Usar treino')
  await pause(500)
  check('marcar pela tela grava na API', (await tagById(ids.root)).tracksWorkout === true)
  check('chip "Treino" na raiz marcada', (await chips('teste-a3d'))?.includes('Treino'), JSON.stringify(await chips('teste-a3d')))
  check('sem chip nas subtags (herdam)', !(await chips('teste-a3d › sub'))?.includes('Treino') && !(await chips('teste-a3d › sub › neto'))?.includes('Treino'))
  items = await tagMenu('teste-a3d › sub', '')
  let it = find(items, 'Usar treino')
  check('subtag de tag marcada: travado "Já usa treino por teste-a3d"', it?.disabled && it.text.includes('Já usa treino por teste-a3d'), JSON.stringify(it))
  it = find(await tagMenu('teste-a3d › sub › neto', ''), 'Usar treino')
  check('neto também travado', it?.disabled === true, JSON.stringify(it))
  it = find(await tagMenu('teste-a3d', ''), 'Parar de usar treino')
  check('"Parar de usar treino" liberado sem registros', it && !it.disabled, JSON.stringify(it))
  await tagMenu('teste-a3d', 'Parar de usar treino')
  await pause(500)
  check('desmarcar pela tela grava na API e tira o chip', (await tagById(ids.root)).tracksWorkout === false && !(await chips('teste-a3d'))?.includes('Treino'))
  await tagMenu('teste-a3d › sub', 'Usar treino')
  await pause(500)
  check('marcar em nível 2 (sub)', (await tagById(ids.sub)).tracksWorkout === true && (await chips('teste-a3d › sub'))?.includes('Treino'))
  it = find(await tagMenu('teste-a3d › sub › neto', ''), 'Usar treino')
  check('neto travado "por sub"', it?.disabled && it.text.includes('Já usa treino por sub'), JSON.stringify(it))
  it = find(await tagMenu('teste-a3d', ''), 'Usar treino')
  check('raiz acima de subtag marcada continua liberada', it && !it.disabled, JSON.stringify(it))

  // --- Treino (seed) e a marcadora de teste
  it = find(await tagMenu('Exercícios › Treino', ''), 'Parar de usar treino')
  check('Treino: "Parar" travado "Em uso em 4 registros com treino"', it?.disabled && it.text.includes('4 registros com treino'), JSON.stringify(it))
  it = find(await tagMenu('Exercícios › teste-casa', ''), 'Parar de usar treino')
  check('teste-casa: travado "1 registro com treino"', it?.disabled && it.text.includes('1 registro com treino'), JSON.stringify(it))
  it = find(await tagMenu('Exercícios › Treino › Perna', ''), 'Usar treino')
  check('grupo muscular herda: travado "Já usa treino por Treino", sem chip', it?.disabled && it.text.includes('Já usa treino por Treino') && !(await chips('Exercícios › Treino › Perna'))?.includes('Treino'), JSON.stringify(it))
  check('chip "Treino" em Treino e teste-casa, não em Corrida nem Exercícios',
    (await chips('Exercícios › Treino'))?.includes('Treino') && (await chips('Exercícios › teste-casa'))?.includes('Treino') &&
    !(await chips('Exercícios › Corrida'))?.includes('Treino') && !(await chips('Exercícios'))?.includes('Treino'))

  // --- Seção Exercícios
  let s = await section()
  const expected = ['Agachamento livre 1 registro', 'Puxada alta com barra 3 registros', 'Puxada alta com triângulo 1 registro',
    'Remada baixa 0 registros', 'Rosca martelo unilateral com halteres 1 registro', 'Supino reto com barra 1 registro', 'teste-a3d apagar 0 registros', 'teste-a3d usado 1 registro']
  check('seção existe, ativos em ordem do português, com contagem', JSON.stringify(s?.rows) === JSON.stringify(expected), JSON.stringify(s?.rows))
  check('arquivados recolhidos: "1 arquivado", fechado', s?.toggle?.text.startsWith('1 arquivado') && s.toggle.open === 'false', JSON.stringify(s?.toggle))
  await page.evaluate(() => document.querySelector('section[aria-label="Exercícios"] button[aria-expanded]:not([aria-haspopup])').click())
  await pause(200)
  s = await section()
  check('abrir arquivados mostra Rosca direta com "Arquivado"', s?.rows.some((r) => r.startsWith('Rosca direta com barra') && r.includes('Arquivado')), JSON.stringify(s?.rows))

  // Renomear (e nome repetido)
  await exMenu('Remada baixa', 'Renomear')
  await page.waitForSelector('section[aria-label="Exercícios"] form')
  const typeName = async (v) => {
    await page.evaluate(() => { const i = document.querySelector('section[aria-label="Exercícios"] form input'); i.focus(); i.select() })
    await page.keyboard.press('Backspace')
    await page.keyboard.type(v)
    await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Exercícios"] form button')].find((b) => b.textContent.trim() === 'Salvar').click())
    await pause(600)
  }
  const maxLen = await page.evaluate(() => document.querySelector('section[aria-label="Exercícios"] form input').maxLength)
  check('campo de renomear aceita 60 caracteres', maxLen === 60, String(maxLen))
  await typeName('Puxada alta com barra')
  const err = await page.evaluate(() => document.querySelector('section[aria-label="Exercícios"] form')?.innerText ?? '')
  check('nome repetido: mensagem do servidor no formulário', err.includes('Já existe um exercício com esse nome'), err.replace(/\s+/g, ' '))
  await typeName('Remada baixa com triângulo')
  check('renomear grava', (await exerciseById(REMADA)).name === 'Remada baixa com triângulo')

  // Arquivar e reativar
  await exMenu('Remada baixa com triângulo', 'Arquivar')
  await pause(500)
  s = await section()
  check('arquivar: sai dos ativos, "2 arquivados"', (await exerciseById(REMADA)).active === false && s.toggle?.text.startsWith('2 arquivados'), JSON.stringify(s?.toggle))
  await exMenu('Remada baixa com triângulo', 'Reativar')
  await pause(500)
  check('reativar', (await exerciseById(REMADA)).active === true)

  // Apagar
  it = find(await exMenu('Puxada alta com barra', ''), 'Apagar')
  check('apagar usado: travado "Em uso em 3 registros"', it?.disabled && it.text.includes('Em uso em 3 registros'), JSON.stringify(it))
  await exMenu('teste-a3d apagar', 'Apagar')
  await pause(600)
  check('apagar nunca usado pela tela', !(await exerciseById(ids.ex)))
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser.close()
  await waitForApi()
  for (const x of catalog) await pool.query('UPDATE exercises SET name = $2, active = $3 WHERE id = $1', [x.id, x.name, x.active])
  if (ids.reg) {
    await pool.query('DELETE FROM exercise_sets WHERE execution_exercise_id IN (SELECT id FROM execution_exercises WHERE task_execution_id = $1)', [ids.reg])
    for (const t of ['execution_exercises', 'execution_workouts', 'task_execution_tags']) await pool.query(`DELETE FROM ${t} WHERE task_execution_id = $1`, [ids.reg])
    await pool.query('DELETE FROM task_executions WHERE id = $1', [ids.reg])
  }
  await pool.query("DELETE FROM exercises WHERE name LIKE 'teste-a3d%'")
  for (const id of [ids.casa, ids.neto, ids.sub, ids.root]) if (id) await pool.query('DELETE FROM tags WHERE id = $1', [id])
  const left = await pool.query("SELECT (SELECT count(*) FROM tags WHERE name IN ('teste-a3d', 'teste-casa'))::int + (SELECT count(*) FROM exercises WHERE name LIKE 'teste-a3d%')::int AS n")
  const remada = await exerciseById(REMADA)
  const now = (await api('GET', '/exercises')).filter((x) => x.id.startsWith('5eed'))
  const same = JSON.stringify(now.map((x) => [x.id, x.name, x.active]).sort()) === JSON.stringify(catalog.map((x) => [x.id, x.name, x.active]).sort())
  const marks = (await api('GET', '/tags')).filter((t) => t.tracksWorkout).map((t) => t.name).sort().join(',')
  check('limpeza: árvore e exercício de teste apagados, catálogo do seed igual ao do começo, só Treino marcada',
    left.rows[0].n === 0 && same && remada?.name === 'Remada baixa' && marks === 'Treino', `${left.rows[0].n} ${remada?.name} ${marks}`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
