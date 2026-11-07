// S6: chips das escolhas no cartão do registro, no Histórico e no cartão da
// Lista. Um por seleção, com o nome; múltipla com todas as opções; global sem
// tag; ordem dos formulários; arquivadas marcadas; renomear dinâmico; o que a
// tela não conhece fica de fora, nunca um chip vazio.
// Árvore, seleções, tarefa e registros próprios (prefixo teste-s6), apagados no
// finally. Confere que as escolhas do seed não mudaram, par a par.
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'
import { createDiagnostico } from '../diagnostico.mjs'
import { deleteExecutions } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) throw new Error('rodar com --env-file=../backend/.env (npm run telas)')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const results = []
const diag = createDiagnostico()
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
  if (!ok) diag.print(name)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const P = 'teste-s6'

async function api(method, path, body) {
  const res = await apiFetch(API + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString()
const tag = (name, parentId = null) => api('POST', '/tags', { name, parentId })
const sel = async (tagId, name, options, multiple = false) => {
  const s = await api('POST', '/selections', { tagId, name, multiple, options })
  return { ...s, o: Object.fromEntries(s.options.map((x) => [x.name, x.id])) }
}
const seedPairs = async () => (await pool.query(
  "SELECT task_execution_id || ' ' || option_id AS p FROM execution_selections WHERE task_execution_id::text LIKE '5eed%' ORDER BY 1")).rows.map((r) => r.p).join('\n')

const pairsBefore = await seedPairs()
const made = { tags: [], selections: [], task: null }
const browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })

try {
  const R = await tag(`${P} raiz`)
  const A = await tag(`${P} a`, R.id)
  const A1 = await tag(`${P} a1`, A.id)
  made.tags.push(A1.id, A.id, R.id)
  const Sneto = await sel(A1.id, 'B neto', ['n1'])
  const Sa = await sel(A.id, 'C meio', ['c1', 'c2'])
  const Sr = await sel(R.id, 'D raiz', ['d1', 'd2'])
  const Ma = await sel(R.id, 'E varias', ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'], true)
  const Sx = await sel(R.id, 'F arquivada', ['f1'])
  const Sv = await sel(R.id, 'G vai sumir', ['g1'])
  made.selections.push(Sneto.id, Sa.id, Sr.id, Ma.id, Sx.id, Sv.id)
  const task = await api('POST', '/tasks', { title: `${P} tarefa` })
  made.task = task.id
  const natureza = (await api('GET', '/selections')).find((s) => s.tagId === null && s.name === 'Natureza')
  const nat = Object.fromEntries(natureza.options.map((o) => [o.name, o.id]))

  let n = 0
  const record = async (selectionOptionIds, rootTagId = R.id, tagIds = []) => {
    n += 1
    const description = `${P} reg ${n}`
    await api('POST', '/executions', { taskId: task.id, description, completedAt: hoursAgo(n), rootTagId, tagIds, selectionOptionIds })
    return description
  }
  const full = await record([nat.estudo, Sneto.o.n1, Sa.o.c2, Sr.o.d1], R.id, [A1.id])
  const many = await record([Ma.o.e4, Ma.o.e1, Ma.o.e6, Ma.o.e2, Ma.o.e5, Ma.o.e3])
  const noTag = await record([nat.lazer], null)
  const none = await record([], R.id)
  const arch = await record([Sr.o.d2, Sx.o.f1])
  const gone = await record([Sr.o.d1, Sv.o.g1])
  const gonePart = await record([Ma.o.e1, Ma.o.e2])
  await api('PATCH', `/selection-options/${Sr.o.d2}`, { active: false })
  await api('PATCH', `/selections/${Sx.id}`, { active: false })
  await api('PATCH', `/selections/${Sa.id}`, { name: 'C renomeada' })
  await api('PATCH', `/selection-options/${Sa.o.c2}`, { name: 'c2 novo' })

  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await diag.watch(page)
  await page.setViewport({ width: 390, height: 1000 })

  // Lista da tela desatualizada: tira uma seleção inteira e uma opção da resposta
  let stale = false
  await page.setRequestInterception(true)
  page.on('request', async (req) => {
    if (stale && req.method() === 'GET' && req.url() === `${API}/selections`) {
      const list = await api('GET', '/selections')
      const body = list.filter((s) => s.id !== Sv.id).map((s) => (s.id === Ma.id ? { ...s, options: s.options.filter((o) => o.id !== Ma.o.e2) } : s))
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) })
    }
    req.continue()
  })

  const chips = (description) => page.evaluate((description) => {
    const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === description))
    if (!a) return null
    const list = a.querySelector('ul[aria-label="Seleções"]')
    return list ? [...list.querySelectorAll(':scope > li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()) : []
  }, description)
  const scenario = async (where) => {
    check(`${where}: um chip por seleção, na ordem dos formulários`,
      JSON.stringify(await chips(full)) === JSON.stringify(['D raiz: d1', 'C renomeada: c2 novo', 'B neto: n1', 'Natureza: estudo']), JSON.stringify(await chips(full)))
    check(`${where}: múltipla com todas as opções, na ordem de cadastro`,
      JSON.stringify(await chips(many)) === JSON.stringify(['E varias: e1, e2, e3, e4, e5, e6']), JSON.stringify(await chips(many)))
    check(`${where}: sem escolha, sem lista`, JSON.stringify(await chips(none)) === '[]', JSON.stringify(await chips(none)))
    check(`${where}: opção arquivada marcada`, (await chips(arch))?.includes('D raiz: d2 (arquivada)'), JSON.stringify(await chips(arch)))
    check(`${where}: seleção arquivada marcada`, (await chips(arch))?.includes('F arquivada (arquivada): f1'), JSON.stringify(await chips(arch)))
  }

  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('article')
  await scenario('Histórico')
  check('global aparece em registro sem tag', JSON.stringify(await chips(noTag)) === JSON.stringify(['Natureza: lazer']), JSON.stringify(await chips(noTag)))
  const a11y = await page.evaluate(() => {
    const lists = [...document.querySelectorAll('[data-selection-chips]')]
    return { lists: lists.length, labelled: lists.filter((l) => l.tagName === 'UL' && l.getAttribute('aria-label') === 'Seleções').length, buttons: lists.flatMap((l) => [...l.querySelectorAll('button, a, input')]).length }
  })
  check('toda lista com o atributo de dados e o rótulo', a11y.lists >= 5 && a11y.labelled === a11y.lists, JSON.stringify(a11y))
  check('chip não é tocável', a11y.buttons === 0, JSON.stringify(a11y))

  await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
  await page.evaluate((title) => document.querySelector(`button[aria-label="Mais ações de ${title}"]`).click(), task.title)
  await pause(150)
  await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Ver histórico').click())
  await page.waitForSelector('article')
  await pause(300)
  await scenario('Cartão da Lista')

  stale = true
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('article')
  check('seleção desconhecida: fica de fora, o resto aparece', JSON.stringify(await chips(gone)) === JSON.stringify(['D raiz: d1']), JSON.stringify(await chips(gone)))
  check('opção desconhecida: fica de fora, a outra aparece', JSON.stringify(await chips(gonePart)) === JSON.stringify(['E varias: e1']), JSON.stringify(await chips(gonePart)))
  const onlyUnknown = await page.evaluate(() => [...document.querySelectorAll('[data-selection-chips] li')].filter((li) => /:\s*$/.test(li.textContent)).length)
  check('nenhum chip vazio na tela', onlyUnknown === 0, `${onlyUnknown}`)
  stale = false
  await page.close()

  // Todas as opções da seleção desconhecidas: chip nenhum, e sem lista vazia
  const empty = await browser.newPage()
  await empty.setRequestInterception(true)
  const allGone = await api('GET', '/selections')
  empty.on('request', (req) => {
    if (req.method() === 'GET' && req.url() === `${API}/selections`) {
      const body = allGone.map((s) => (s.id === Ma.id ? { ...s, options: [] } : s))
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) })
    }
    req.continue()
  })
  await empty.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await empty.waitForSelector('article')
  const result = await empty.evaluate((description) => {
    const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === description))
    return { found: Boolean(a), list: a?.querySelector('ul[aria-label="Seleções"]')?.textContent ?? null }
  }, many)
  check('todas as opções desconhecidas: sem "E varias:" vazio e sem lista', result.found && result.list === null, JSON.stringify(result))
  await empty.close()
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser.close().catch(() => {})
  if (made.task) {
    const ids = (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [made.task])).rows.map((r) => r.id)
    await deleteExecutions(pool, ids)
    await pool.query('DELETE FROM tasks WHERE id = $1', [made.task])
  }
  await pool.query('DELETE FROM selection_options WHERE selection_id = ANY($1::uuid[])', [made.selections])
  await pool.query('DELETE FROM selections WHERE id = ANY($1::uuid[])', [made.selections])
  for (const id of made.tags) await pool.query('DELETE FROM tags WHERE id = $1', [id])
  const left = await pool.query(
    `SELECT (SELECT count(*) FROM tags WHERE name LIKE '${P}%')::int + (SELECT count(*) FROM tasks WHERE title LIKE '${P}%')::int +
            (SELECT count(*) FROM selections WHERE id::text NOT LIKE '5eed%')::int AS n`)
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  check('escolhas do seed iguais, par a par', (await seedPairs()) === pairsBefore)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
