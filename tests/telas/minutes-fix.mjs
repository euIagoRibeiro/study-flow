// Conserto da Duração estimada: "4,5" nunca vira 45 (navegador em inglês
// era o caso que corrompia). Registrar e editar. Apaga o que cria.
import puppeteer from 'puppeteer-core'

import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const FINANCAS = '5eed0000-0000-4000-8000-000000000005'
const LABEL = 'Duração estimada (min, opcional)'
const ERROR = 'Duração: minutos inteiros, de 1 a 1440'
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
const get = async (p) => { await waitForApi(); return (await fetch(API + p)).json() }
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  for (const lang of ['en-US', 'pt-BR']) {
    const browser = await puppeteer.launch({
      executablePath: CHROME,
      args: [`--lang=${lang}`],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 375, height: 900 })
    for (const [typed, expected] of [['4,5', 'erro'], ['4.5', 'erro'], ['0', 'erro'], ['1441', 'erro'], ['abc', 'erro'], ['45', 45]]) {
      await waitForApi()
      await page.goto(`${APP}/executar?tarefa=${FINANCAS}`, { waitUntil: 'networkidle0' })
      const desc = `teste minutos ${lang} ${typed}`
      // Digita de verdade (teclado), como a pessoa faria
      const focus = (label) => page.evaluate((l) => [...document.querySelectorAll('label')]
        .find((x) => x.querySelector('span')?.textContent.trim() === l).querySelector('input').focus(), label)
      await focus('O que foi feito (opcional)')
      await page.keyboard.type(desc)
      await focus(LABEL)
      await page.keyboard.type(typed)
      await page.evaluate(() => [...document.querySelectorAll('form button')].find((b) => b.textContent.trim() === 'Registrar').click())
      await pause(1200)
      const saved = (await get('/executions')).find((e) => e.description === desc)
      if (expected === 'erro') {
        const shown = await page.evaluate(() => document.body.innerText)
        check(`${lang} "${typed}": recusado na tela, nada gravado`, !saved && shown.includes(ERROR))
      } else {
        const est = saved && (await get('/time-entries')).find((t) => t.taskExecutionId === saved.id && t.estimated)
        check(`${lang} "${typed}": gravado como ${expected} min`,
          est && new Date(est.endedAt) - new Date(est.startedAt) === expected * 60_000)
      }
    }
    await browser.close()
  }
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await waitForApi()
  await pool.query(`DELETE FROM time_entries WHERE task_execution_id IN
                      (SELECT id FROM task_executions WHERE description LIKE 'teste minutos%')`)
  await pool.query(`DELETE FROM task_executions WHERE description LIKE 'teste minutos%'`)
  const left = (await get('/executions')).filter((e) => e.description?.startsWith('teste minutos'))
  check('dados de teste apagados', left.length === 0, `${left.length} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
