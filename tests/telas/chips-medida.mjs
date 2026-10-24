// Ordem dos valores de medida: alfabética pelo nome do tipo, na API (ORDER BY
// determinístico) e no Histórico (compareNames, a mesma regra do formulário,
// sem depender da collation do banco). Registro próprio em Programar
// (contexto Código: refatoração / leitura / questões), apagado no finally.
import puppeteer from 'puppeteer-core'
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
const { Pool } = pg

if (!process.env.DATABASE_URL) throw new Error('rodar com --env-file=../backend/.env (npm run telas)')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const PROGRAMAR = '5eed0000-0000-4000-8000-000000000012'
const CODIGO = '5eed0000-0000-4000-9000-000000000400'
const DESC = 'chips-medida teste'
const ALPHA = ['1 leitura', '2 questões', '3 refatoração']

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
let ID = null
try {
  const measure = (await api('GET', '/measures')).body.find((m) => m.tagId === CODIGO)
  const kind = (n) => measure.kinds.find((k) => k.name === n).id
  const created = await api('POST', '/executions', {
    taskId: PROGRAMAR, description: DESC, completedAt: new Date(Date.now() - 600e3).toISOString(),
    rootTagId: CODIGO, tagIds: [],
    measureValues: [{ kindId: kind('refatoração'), quantity: 3 }, { kindId: kind('questões'), quantity: 2 }, { kindId: kind('leitura'), quantity: 1 }],
  })
  if (created.status !== 201) throw new Error(`POST: ${created.status} ${JSON.stringify(created.body)}`)
  ID = created.body.id
  // Gravados na ordem NÃO alfabética, com horários diferentes: a ordem antiga
  // (created_at, id) devolveria refatoração, questões, leitura
  for (const [i, n] of ['refatoração', 'questões', 'leitura'].entries()) {
    await pool.query(`UPDATE execution_measure_values SET created_at = now() - make_interval(mins => $3)
      WHERE task_execution_id = $1 AND kind_id = $2`, [ID, kind(n), 10 - i])
  }
  const names = (values) => values.map((v) => `${v.quantity} ${measure.kinds.find((k) => k.id === v.kindId).name}`)

  const listed = (await api('GET', '/executions')).body.find((e) => e.id === ID)
  check('API: valores em ordem alfabética do tipo (leitura, questões, refatoração)', JSON.stringify(names(listed.measure.values)) === JSON.stringify(ALPHA), JSON.stringify(names(listed.measure.values)))

  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const chips = () => page.evaluate((desc) => {
    const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === desc))
    return a ? [...a.querySelectorAll('span')].map((s) => s.textContent.trim()).filter((t) => /^\d+ (leitura|questões|refatoração)$/.test(t)) : null
  }, DESC)
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  let shown = await chips()
  check('Histórico: chips em ordem alfabética', JSON.stringify(shown) === JSON.stringify(ALPHA), JSON.stringify(shown))

  // A tela não depende da ordem da API (collation de outro banco, por
  // exemplo): com a resposta em outra ordem, os chips continuam alfabéticos
  await page.setRequestInterception(true)
  page.on('request', async (req) => {
    if (req.method() === 'GET' && req.url() === `${API}/executions`) {
      const res = await fetch(req.url())
      const list = await res.json()
      // Nem alfabética nem o contrário dela (inverter a ordem antiga daria a
      // alfabética por coincidência)
      const order = ['questões', 'refatoração', 'leitura'].map(kind)
      for (const e of list) if (e.id === ID) e.measure.values.sort((x, y) => order.indexOf(x.kindId) - order.indexOf(y.kindId))
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(list) })
    }
    req.continue()
  })
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  shown = await chips()
  check('Histórico com a API em outra ordem (questões, refatoração, leitura): chips continuam alfabéticos', JSON.stringify(shown) === JSON.stringify(ALPHA), JSON.stringify(shown))
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser.close()
  if (ID) {
    for (const t of ['execution_measure_values', 'execution_measures', 'task_execution_tags', 'time_entries']) await pool.query(`DELETE FROM ${t} WHERE task_execution_id = $1`, [ID])
    await pool.query('DELETE FROM task_executions WHERE id = $1', [ID])
  }
  const left = (await pool.query('SELECT count(*)::int AS n FROM task_executions WHERE description = $1', [DESC])).rows[0].n
  check('limpeza: registro de teste apagado', left === 0, String(left))
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
