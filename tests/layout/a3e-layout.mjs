// A3e: layout da seção Treino aberta, 5 estados × 7 larguras, janela real
// (barra de rolagem visível, largura útil). Registro aberto próprio, apagado
// no finally. Rodar da raiz: node --env-file=backend/.env a3e-layout.mjs
import puppeteer from 'puppeteer-core'

if (!process.env.DATABASE_URL) throw new Error('rodar com --env-file=backend/.env')
import pg from 'pg'
import { API, APP, CHROME, OUT } from '../config.mjs'
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const TASK = '5eed0000-0000-4000-8000-000000000006'

let ok = 0, bad = 0
const check = (cond, msg) => { cond ? ok++ : bad++; if (!cond) console.log('FALHA', msg) }
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
let ID = null
try {
  const tags = (await api('GET', '/tags')).body
  const exercises = (await api('GET', '/exercises')).body
  const EXERC = tags.find((t) => t.name === 'Exercícios' && !t.parentId)
  const ACAD = tags.find((t) => t.name === 'Academia' && t.parentId === EXERC.id)
  const TRI = exercises.find((x) => x.name === 'Puxada alta com triângulo')
  const LONG = exercises.find((x) => x.name === 'Rosca martelo unilateral com halteres')
  const open = await api('POST', '/executions', { taskId: TASK, completedAt: null, rootTagId: EXERC.id, tagIds: [ACAD.id] })
  ID = open.body.id
  const w = await api('PUT', `/executions/${ID}/workout`, { workout: [
    { exerciseId: TRI.id, sets: [{ reps: 12, weightKg: 25 }, { reps: 8, weightKg: 1234.5 }, { reps: 8, weightKg: 40 }] },
    { exerciseId: LONG.id, sets: [{ reps: 8, weightKg: 8 }, { reps: 15, weightKg: null }] },
  ] })
  if (w.status !== 200) throw new Error(`treino de apoio: ${w.status}`)

  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  let fail = false
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (fail && req.method() === 'PUT' && req.url().includes(ID)) {
      return req.respond({ status: 500, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"x"}' })
    }
    req.continue()
  })
  const click = (scope, text, starts = false) => page.evaluate((scope, text, starts) => {
    const b = [...document.querySelector(scope).querySelectorAll('button')].find((x) => (starts ? x.textContent.trim().startsWith(text) : x.textContent.trim() === text))
    b.click()
  }, scope, text, starts)
  const S = 'section[aria-label="Treino"]'
  const states = {
    atual: async () => {},
    'editar-serie': async () => { await page.evaluate((S) => document.querySelector(`${S} ol[aria-label^="Séries"] button`).click(), S) },
    escolha: async () => { await click(S, 'Exercício') },
    erro: async () => { fail = true; await click(S, '+ série igual'); await pause(500); fail = false },
    resumo: async () => { await click(S, TRI.name, true) },
    criar: async () => { await click(S, 'Exercício'); await typeSearch() },
    confirmar: async () => { await click(S, 'Exercício'); await typeSearch(); await click('[aria-label="Escolher exercício"]', 'Criar', true) },
  }
  // Nome no teto (60), sem espaço pra quebrar: o pior caso de largura
  const LONGNAME = 'Desenvolvimento-arnold-sentado-com-halteres-e-banco-inclinad'
  const typeSearch = async () => {
    const input = await page.evaluateHandle((S) => [...document.querySelector(S).querySelectorAll('label span')].find((x) => x.textContent.trim() === 'Buscar exercício').closest('label').querySelector('input'), S)
    await input.asElement().type(LONGNAME)
  }

  for (const width of [320, 360, 375, 414, 768, 1024, 1280]) {
    for (const [name, enter] of Object.entries(states)) {
      await page.setViewport({ width, height: 900 })
      await page.goto(`${APP}/executar?tarefa=${TASK}`, { waitUntil: 'networkidle0' })
      await enter()
      await pause(250)
      const tag = `${width}px ${name}`
      const r = await page.evaluate((S) => {
        const de = document.documentElement
        const s = document.querySelector(S)
        if (!s) return null
        const out = [...s.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > de.clientWidth + 0.5).map((el) => el.tagName + ':' + el.textContent.slice(0, 20))
        // Folga do anel de foco (outline 2 + offset 2 = 4px) até o que corta
        const gaps = [...s.querySelectorAll('button, input')].map((el) => {
          const r = el.getBoundingClientRect()
          let a = el.parentElement, min = de.clientWidth - r.right
          min = Math.min(min, r.left)
          while (a && a !== document.body) {
            const st = getComputedStyle(a)
            if (st.overflowX !== 'visible' || st.overflowY !== 'visible') {
              const b = a.getBoundingClientRect()
              min = Math.min(min, r.left - b.left, b.right - r.right, r.top - b.top, b.bottom - r.bottom)
            }
            a = a.parentElement
          }
          return min
        })
        // Nome do exercício (resumo e atual) não encosta no ⋯
        const touching = [...s.querySelectorAll('ol[aria-label="Exercícios do treino"] > li')].filter((li) => {
          const menu = li.querySelector('button[aria-haspopup]').getBoundingClientRect()
          const name = (li.querySelector('h4') ?? li.querySelector('button span')).getBoundingClientRect()
          return name.right > menu.left - 2
        }).length
        const inputs = [...s.querySelectorAll('input')].map((i) => i.getBoundingClientRect().width)
        return { scroll: de.scrollWidth, util: de.clientWidth, out, minGap: Math.min(...gaps), n: gaps.length, touching, inputs, text: s.textContent }
      }, S)
      if (!r) { check(false, `${tag}: seção não achada`); continue }
      check(r.scroll <= r.util, `${tag}: rolagem lateral ${r.scroll} > ${r.util}`)
      check(r.out.length === 0, `${tag}: fora da tela ${r.out.slice(0, 3)}`)
      check(r.minGap >= 4, `${tag}: anel de foco com folga ${r.minGap}`)
      check(r.touching === 0, `${tag}: nome encostando no ⋯ (${r.touching})`)
      check(r.inputs.every((x) => x >= 100), `${tag}: campo estreito ${r.inputs}`)
      const expected = { atual: /15 × peso do corpo/, 'editar-serie': /Cancelar/, escolha: /Buscar exercício/, erro: /Tentar de novo/, resumo: /2 séries/, criar: /Criar "Desenvolvimento/, confirmar: /Criar o exercício "Desenvolvimento/ }[name]
      check(expected.test(r.text), `${tag}: estado não montado (${expected})`)
      if (width === 320 || (width === 1280 && name === 'atual')) {
        await page.evaluate((S) => document.querySelector(S).scrollIntoView({ block: 'start' }), S)
        await page.screenshot({ path: `${OUT}/a3e-${name}-${width}.png` })
      }
    }
  }
  // Aviso (seção escondida) em 320
  await page.setViewport({ width: 320, height: 900 })
  await page.goto(`${APP}/executar?tarefa=${TASK}`, { waitUntil: 'networkidle0' })
  const sel = await page.evaluate(() => {
    const span = [...document.querySelectorAll('label > span')].find((s) => s.textContent === 'Em Exercícios')
    const select = span.parentElement.querySelector('select')
    select.setAttribute('data-t', 'x')
    return [...select.options].find((o) => o.textContent.trim() === 'Corrida').value
  })
  await page.select('select[data-t="x"]', sel)
  await pause(250)
  const warn = await page.evaluate(() => {
    const de = document.documentElement
    const p = [...document.querySelectorAll('p')].find((x) => x.textContent.includes('vai remover o treino'))
    return p && { right: p.getBoundingClientRect().right, util: de.clientWidth, scroll: de.scrollWidth }
  })
  check(warn && warn.right <= warn.util && warn.scroll <= warn.util, `aviso 320: ${JSON.stringify(warn)}`)
  await page.evaluate(() => [...document.querySelectorAll('p')].find((x) => x.textContent.includes('vai remover o treino')).scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: `${OUT}/a3e-aviso-320.png` })
} catch (err) {
  check(false, `erro: ${err.message}`)
} finally {
  await browser.close()
  if (ID) {
    await pool.query('DELETE FROM exercise_sets WHERE execution_exercise_id IN (SELECT id FROM execution_exercises WHERE task_execution_id = $1)', [ID])
    for (const t of ['execution_exercises', 'execution_workouts', 'execution_measure_values', 'execution_measures', 'task_execution_tags', 'time_entries']) await pool.query(`DELETE FROM ${t} WHERE task_execution_id = $1`, [ID])
    await pool.query('DELETE FROM task_executions WHERE id = $1', [ID])
    const left = (await pool.query('SELECT count(*)::int AS n FROM task_executions WHERE id = $1', [ID])).rows[0].n
    check(left === 0, 'limpeza do registro de teste')
  }
  await pool.end()
  console.log(`${ok} de ${ok + bad}`)
  process.exitCode = bad === 0 && ok > 0 ? 0 : 1
}
