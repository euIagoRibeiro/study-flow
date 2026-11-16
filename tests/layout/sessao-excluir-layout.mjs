// Excluir sessão, em 320 a 1280 (janela real, com a barra de rolagem): a linha da sessão no
// Histórico e no cartão da Lista (o lugar mais estreito) com o lápis e o botão de excluir. Estados:
// "curta" (três sessões de minutos) e "longa" (uma sessão de 1000 horas, o texto mais largo, e a
// mensagem de erro do servidor, longa, aparecendo na linha). Mede: sem rolagem lateral, texto e
// botões dentro do cartão, cada botão ≥ 44px, texto e botões sem se sobrepor, e a folga do anel de
// foco do botão de excluir (≥ 4px) contra a janela e contra todo ancestral com overflow.
// Os dados de teste são do banco (prefixo teste-sessao-l), apagados no fim; o único DELETE é o
// da mensagem de erro, respondido por esta bateria (409), então nada é apagado de verdade.
// Uso (raiz do repo): node --env-file=backend/.env tests/layout/sessao-excluir-layout.mjs
import pg from 'pg'
import { API, APP, CHROME, out } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'
import { deleteExecutions } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-sessao-l'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  if (!ok) console.log(`FALHOU ${name}${detail ? ` (${detail})` : ''}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const WIDTHS = [320, 360, 375, 414, 640, 768, 1280]
async function api(method, path, body) {
  const res = await apiFetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const min = (m) => new Date(Date.now() + m * 60_000).toISOString()
const LONG_ERROR = `Sessão rodando: pause antes de excluir. ${'palavra '.repeat(14)}${'x'.repeat(60)}`

const executions = []
let taskId = null
let browser
try {
  const task = (await api('POST', '/tasks', { title: `${P} tarefa` })).body
  taskId = task.id
  const record = async (description, completedAt) => {
    const r = (await api('POST', '/executions', { taskId, description, completedAt })).body
    executions.push(r.id)
    return r.id
  }
  const add = (id, from, to) => pool.query('INSERT INTO time_entries (task_execution_id, started_at, ended_at) VALUES ($1, $2, $3)', [id, from, to])
  const shortId = await record(`${P} curta`, min(-30))
  await add(shortId, min(-200), min(-190))
  await add(shortId, min(-150), min(-120))
  await add(shortId, min(-100), min(-95))
  const longId = await record(`${P} longa`, min(-20))
  await add(longId, min(-60 * 1000 - 100), min(-100)) // 1000 horas: "1000:00:00"
  await add(longId, min(-90), min(-85))
  await add(longId, min(-80), min(-70))

  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  page.on('dialog', (d) => d.accept())
  let failDelete = false
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.method() === 'DELETE') {
      if (failDelete) return req.respond({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: LONG_ERROR }) })
      return req.abort() // nunca apaga de verdade
    }
    return req.continue()
  })
  const clean = async (path) => {
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => sessionStorage.clear())
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
  }
  const CARD = (d) => `[...document.querySelectorAll('article')].find((a) => [...a.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === ${JSON.stringify(d)}))`
  const openSessions = async (d) => {
    await page.evaluate(`(() => { const t = [...${CARD(d)}.querySelectorAll('button[aria-expanded]')].find((b) => /sess(ão|ões)/.test(b.textContent)); if (t.getAttribute('aria-expanded') !== 'true') t.click() })()`)
    await pause(200)
  }
  const places = {
    historico: () => clean('/historico'),
    lista: async () => {
      await clean('/')
      await page.evaluate((t) => document.querySelector(`button[aria-label="Mais ações de ${t}"]`).click(), task.title)
      await pause(150)
      await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Ver histórico').click())
      await pause(400)
    },
  }
  const measure = (d) => page.evaluate(`(() => {
    const doc = document.documentElement
    const vw = doc.clientWidth
    const card = ${CARD(d)}
    const cr = card.getBoundingClientRect()
    const pad = parseFloat(getComputedStyle(card).paddingRight) || 0
    const inner = cr.right - pad
    const scrollers = [...document.querySelectorAll('body *')].filter((x) => ['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(x).overflowX) && x !== doc && x !== document.body)
    const ring = (el) => {
      const r = el.getBoundingClientRect()
      let m = Math.min(r.left, vw - r.right)
      for (const p of scrollers) if (p.contains(el) && p !== el) { const c = p.getBoundingClientRect(); m = Math.min(m, r.left - c.left, c.right - r.right) }
      return Math.round(m * 10) / 10
    }
    const rects = (el) => { const range = document.createRange(); range.selectNodeContents(el); return [...range.getClientRects()] }
    const hit = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5
    const lis = [...card.querySelectorAll('li')].filter((li) => /\\d{2}:\\d{2}–\\d{2}:\\d{2}/.test(li.textContent))
    const rows = lis.map((li) => {
      const text = li.querySelector('span')
      const tr = rects(text)
      const buttons = [...li.querySelectorAll('button')].map((b) => b.getBoundingClientRect())
      const del = li.querySelector('button[aria-label^="Excluir sessão"]')
      const alert = li.querySelector('[role="alert"]')
      const ar = alert ? rects(alert) : []
      return {
        hasDelete: Boolean(del),
        textOut: Math.max(0, ...tr.map((r) => r.right - inner)),
        buttonsOut: Math.max(0, ...buttons.map((r) => r.right - cr.right)),
        small: Math.min(99, ...buttons.map((r) => Math.min(r.width, r.height))),
        textHitsButton: tr.some((t) => buttons.some((b) => hit(t, b))),
        buttonsHit: buttons.some((a, i) => buttons.some((b, j) => i < j && hit(a, b))),
        alertOut: Math.max(0, ...ar.map((r) => r.right - inner)),
        hasAlert: Boolean(alert),
        ring: del ? (del.focus(), ring(del)) : 99,
      }
    })
    return { scroll: doc.scrollWidth - vw, cardOut: Math.max(0, cr.right - vw), rows }
  })()`)

  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 800 })
    for (const [place, enter] of Object.entries(places)) {
      for (const [state, desc] of [['curta', `${P} curta`], ['longa', `${P} longa`]]) {
        await enter()
        await openSessions(desc)
        if (state === 'longa') {
          failDelete = true
          await page.evaluate(`${CARD(desc)}.querySelector('button[aria-label^="Excluir sessão"]')?.click()`)
          await pause(400)
          failDelete = false
        }
        const tag = `${place}, ${state}, ${width}px`
        const m = await measure(desc)
        check(`${tag}: três linhas de sessão`, m.rows.length === 3, `${m.rows.length}`)
        check(`${tag}: cada linha tem o botão de excluir`, m.rows.length === 3 && m.rows.every((r) => r.hasDelete), JSON.stringify(m.rows.map((r) => r.hasDelete)))
        if (m.rows.length !== 3 || !m.rows.every((r) => r.hasDelete)) continue
        check(`${tag}: sem rolagem lateral`, m.scroll <= 0, `${m.scroll}px`)
        check(`${tag}: cartão dentro da janela`, m.cardOut <= 0.5, `${m.cardOut}px`)
        check(`${tag}: texto das sessões dentro do cartão`, m.rows.every((r) => r.textOut <= 0.5), JSON.stringify(m.rows.map((r) => r.textOut)))
        check(`${tag}: botões dentro do cartão`, m.rows.every((r) => r.buttonsOut <= 0.5), JSON.stringify(m.rows.map((r) => r.buttonsOut)))
        check(`${tag}: cada botão ≥ 44px`, m.rows.every((r) => r.small >= 44), JSON.stringify(m.rows.map((r) => r.small)))
        check(`${tag}: texto e botões não se sobrepõem`, m.rows.every((r) => !r.textHitsButton && !r.buttonsHit))
        check(`${tag}: folga do foco do botão de excluir ≥ 4px`, m.rows.every((r) => r.ring >= 4), JSON.stringify(m.rows.map((r) => r.ring)))
        if (state === 'longa') {
          check(`${tag}: a mensagem de erro (longa) aparece na linha`, m.rows[0].hasAlert)
          check(`${tag}: a mensagem de erro quebra dentro do cartão`, m.rows[0].alertOut <= 0.5, `${m.rows[0].alertOut}px`)
        }
        if (width === 320 && place === 'lista') await page.screenshot({ path: out(`sessao-excluir-${state}-320.png`) })
      }
    }
  }
  check('o DELETE nunca foi liberado (só o 409 da bateria)', true)
  check(`checagens feitas: ${results.length}, esperado ao menos 281`, results.length >= 281, String(results.length))
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false, String(err.stack).split(String.fromCharCode(10)).slice(0, 3).join(' | '))
} finally {
  await browser?.close()
  await deleteExecutions(pool, executions)
  if (taskId) await pool.query('DELETE FROM tasks WHERE id = $1', [taskId])
  const left = await pool.query(`SELECT (SELECT count(*) FROM tasks WHERE title LIKE $1)::int + (SELECT count(*) FROM task_executions WHERE description LIKE $1)::int AS n`, [`${P}%`])
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
