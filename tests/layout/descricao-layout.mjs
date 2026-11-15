// Descrição com quebra de linha: o campo (Registrar, lápis no Histórico e lápis no cartão da
// Lista) em três estados (vazio, uma palavra de 100 letras sem espaço, 60 linhas coladas) e
// a exibição no Histórico e no cartão da Lista (linhas, recuos e a mesma palavra de 100
// letras), em 320, 360, 375 e 1280, janela real (barra de rolagem visível). Sem rolagem
// lateral, nada além da borda, o campo na largura dos outros campos do formulário, altura
// entre 2 e 12 linhas, sem rolagem lateral dentro do campo, folga do anel de foco. Só lê: digita
// no campo, nunca salva (nenhum pedido de escrita depois dos dados de teste).
// Dados próprios (prefixo teste-descricao-l), apagados no fim.
// Uso (raiz do repo): node --env-file=backend/.env tests/layout/descricao-layout.mjs
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'
import { deleteExecutions } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-descricao-l'
const LABEL = 'O que foi feito (opcional)'
const LONG_WORD = 'W'.repeat(100)
const FIRST = `${P} início`
const DESCRIPTION = `${FIRST}\n${LONG_WORD}\n\n    recuo de quatro espaços\nfim`
const WIDTHS = [320, 360, 375, 1280]
const STATES = {
  vazio: '',
  palavra: LONG_WORD,
  linhas: Array.from({ length: 60 }, (_, i) => `linha ${i + 1}`).join('\n'),
}
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  if (!ok) console.log(`FALHOU ${name} (${detail})`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(method, path, body) {
  const res = await apiFetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}

const task = await api('POST', '/tasks', { title: `${P} tarefa` })
const record = await api('POST', '/executions', { taskId: task.id, description: DESCRIPTION, completedAt: new Date(Date.now() - 3600e3).toISOString() })
const browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
const writes = []
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  page.on('request', (req) => {
    if (!['GET', 'OPTIONS'].includes(req.method())) writes.push(`${req.method()} ${req.url()}`)
  })
  const clean = async (path) => {
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => sessionStorage.clear())
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
  }
  const pencil = async () => {
    const done = await page.evaluate((first) => {
      const a = [...document.querySelectorAll('article')].find((x) => x.textContent.includes(first))
      const b = a?.querySelector('button[aria-label^="Editar registro"]')
      b?.click()
      return Boolean(b)
    }, FIRST)
    if (!done) throw new Error('lápis do registro de teste não achado')
    await page.waitForFunction((l) => [...document.querySelectorAll('article form label span')].some((s) => s.textContent.trim() === l), {}, LABEL)
  }
  const openMenuHistory = async () => {
    await clean('/')
    await page.evaluate((t) => document.querySelector(`button[aria-label="Mais ações de ${t}"]`).click(), task.title)
    await pause(150)
    await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Ver histórico').click())
    await pause(300)
  }
  const places = {
    registrar: () => clean(`/executar?tarefa=${task.id}`),
    historico: async () => { await clean('/historico'); await pencil() },
    lista: async () => { await openMenuHistory(); await pencil() },
  }
  const showPlaces = {
    historico: () => clean('/historico'),
    lista: openMenuHistory,
  }
  // Os números de página, comuns às duas medições
  const pageNumbers = () => page.evaluate(() => {
    const doc = document.documentElement
    const vw = doc.clientWidth
    const style = (x) => getComputedStyle(x).overflowX
    const all = [...document.querySelectorAll('body *')]
    const scrollers = all.filter((x) => ['auto', 'scroll'].includes(style(x)))
    const inside = (x) => scrollers.some((s) => s !== x && s.contains(x))
    return { page: doc.scrollWidth - doc.clientWidth, past: all.filter((x) => !inside(x) && x.getBoundingClientRect().right > vw + 0.5).length }
  })
  let fieldCases = 0
  let showCases = 0
  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 900 })
    for (const [place, enter] of Object.entries(places)) {
      for (const [state, text] of Object.entries(STATES)) {
        await enter()
        const handle = await page.evaluateHandle((l) => [...document.querySelectorAll('main label')]
          .find((x) => x.querySelector('span')?.textContent.trim() === l)?.querySelector('textarea') ?? null, LABEL)
        const area = handle.asElement()
        const tag = `${place} ${width}px ${state}`
        if (!area) { check(`${tag}: textarea achado`, false, 'sem textarea'); continue }
        await area.evaluate((el, t) => {
          el.scrollIntoView({ block: 'center' })
          el.focus()
          el.select()
          document.execCommand('delete')
          if (t) document.execCommand('insertText', false, t)
        }, text)
        await pause(150)
        const nums = await pageNumbers()
        const m = await area.evaluate((el) => {
          const doc = document.documentElement
          const vw = doc.clientWidth
          const style = (x) => getComputedStyle(x).overflowX
          const cs = getComputedStyle(el)
          const lh = parseFloat(cs.lineHeight)
          const extra = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
          const r = el.getBoundingClientRect()
          const form = el.closest('form')
          const fr = form.getBoundingClientRect()
          const pad = parseFloat(getComputedStyle(form).paddingRight) || 0
          const other = [...form.querySelectorAll('input[type="datetime-local"]')][0]?.getBoundingClientRect()
          let ring = Math.min(r.left, vw - r.right)
          for (let p = el.parentElement; p; p = p.parentElement) {
            if (p !== doc && p !== document.body && ['auto', 'scroll', 'hidden', 'clip'].includes(style(p))) {
              const c = p.getBoundingClientRect()
              ring = Math.min(ring, r.left - c.left, c.right - r.right)
            }
          }
          return {
            height: r.height, min: 2 * lh + extra, max: 12 * lh + extra, out: r.right - (fr.right - pad),
            sameLeft: other ? Math.abs(r.left - other.left) : 0, sameWidth: other ? Math.abs(r.width - other.width) : 0,
            sideScroll: el.scrollWidth - el.clientWidth, ring: Math.round(ring * 10) / 10,
          }
        })
        fieldCases++
        check(`${tag}: sem rolagem lateral`, nums.page <= 0, `+${nums.page}px`)
        check(`${tag}: nada passa da borda`, nums.past === 0, `${nums.past}`)
        check(`${tag}: campo na largura e na margem dos outros campos`, m.out <= 0.5 && m.sameLeft <= 0.5 && m.sameWidth <= 0.5, `${m.out}px fora, ${m.sameLeft}px de recuo, ${m.sameWidth}px de largura`)
        check(`${tag}: altura entre 2 e 12 linhas`, m.height >= m.min - 0.6 && m.height <= m.max + 0.6, `${m.height}px (${m.min} a ${m.max})`)
        check(`${tag}: sem rolagem lateral dentro do campo`, m.sideScroll <= 0, `+${m.sideScroll}px`)
        check(`${tag}: folga do anel de foco ≥ 4px`, m.ring >= 4, `${m.ring}px`)
        if (state === 'vazio') check(`${tag}: vazio na altura mínima (2 linhas)`, Math.abs(m.height - m.min) <= 0.6, `${m.height}px`)
        if (state === 'linhas') check(`${tag}: 60 linhas travam no máximo (12 linhas)`, Math.abs(m.height - m.max) <= 0.6, `${m.height}px`)
      }
    }
    for (const [place, enter] of Object.entries(showPlaces)) {
      await enter()
      const nums = await pageNumbers()
      const m = await page.evaluate((first) => {
        const art = [...document.querySelectorAll('article')].find((a) => a.textContent.includes(first))
        const p = [...(art?.querySelectorAll('p') ?? [])].find((x) => x.textContent.includes(first))
        if (!p) return null
        const cs = getComputedStyle(p)
        const ar = art.getBoundingClientRect()
        const apad = parseFloat(getComputedStyle(art).paddingRight) || 0
        const r = p.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(p)
        const textRight = Math.max(...[...range.getClientRects()].map((x) => x.right))
        return { lines: Math.round(r.height / parseFloat(cs.lineHeight)), out: Math.max(r.right, textRight) - (ar.right - apad), ws: cs.whiteSpace }
      }, FIRST)
      showCases++
      const tag = `exibir ${place} ${width}px`
      check(`${tag}: cartão do registro achado`, m !== null, 'sem cartão')
      if (!m) continue
      check(`${tag}: sem rolagem lateral`, nums.page <= 0, `+${nums.page}px`)
      check(`${tag}: nada passa da borda`, nums.past === 0, `${nums.past}`)
      check(`${tag}: texto (com a palavra de 100 letras) dentro do cartão`, m.out <= 0.5, `${m.out}px fora`)
      check(`${tag}: pre-wrap, com no mínimo 5 linhas (1 + a palavra + vazia + recuo + fim)`, m.ws === 'pre-wrap' && m.lines >= 5, `${m.ws}, ${m.lines} linhas`)
    }
  }
  check(`campos medidos: ${fieldCases} de ${WIDTHS.length * 9}`, fieldCases === WIDTHS.length * 9, `${fieldCases}`)
  check(`exibições medidas: ${showCases} de ${WIDTHS.length * 2}`, showCases === WIDTHS.length * 2, `${showCases}`)
  check('nenhum pedido de escrita na medição', writes.length === 0, writes.join(', '))
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser.close()
  await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [task.id])).rows.map((r) => r.id))
  await pool.query('DELETE FROM tasks WHERE id = $1', [task.id])
  const left = await pool.query(`SELECT (SELECT count(*) FROM tasks WHERE title LIKE $1)::int + (SELECT count(*) FROM task_executions WHERE id = $2)::int AS n`, [`${P}%`, record.id])
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
}
const ok = results.filter(Boolean).length
console.log(`\n${ok} de ${results.length}`)
process.exitCode = ok === results.length ? 0 : 1
