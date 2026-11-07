// Mesma origem: o site chama a API por /api (o proxy do Vite tira o prefixo),
// como na hospedagem, e a API não manda cabeçalho de CORS. Abre as telas e
// grava cada pedido: nenhum sai da origem do site; um fetch da página direto
// ao backend é rejeitado (TypeError, sem CORS); as escritas passam pelo proxy
// e funcionam (registrar e editar pela tela; apagar uma tag pela tela, com o
// X-StudyFlow que a API exige no DELETE). Dados próprios (prefixo
// teste-origem), apagados no fim. Uso (raiz do repo):
//   node --env-file=backend/.env tests/telas/mesma-origem.mjs
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'
import { deleteExecutions } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
// O backend por trás do proxy, pra tentar o pedido direto (o mesmo padrão do vite.config.ts)
const BACKEND = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3333'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-origem'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(method, path, body) {
  const res = await apiFetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}

let taskId = null
let browser
try {
  check(`o endereço da API das baterias é o do site (${API})`, API.startsWith(`${new URL(APP).origin}/`), API)
  // O proxy tira o prefixo: /api/tags chega ao backend como /tags
  const probe = await apiFetch(`${API}/tags`)
  const probeBody = probe.ok ? await probe.json().catch(() => null) : null
  check('o proxy tira o prefixo: /api/tags devolve a lista de tags', Array.isArray(probeBody) && probeBody.length > 0, `status ${probe.status}`)
  taskId = (await api('POST', '/tasks', { title: `${P} tarefa` })).id

  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 375, height: 900 })
  const origin = new URL(APP).origin
  const seen = []
  page.on('request', (req) => seen.push({ method: req.method(), url: req.url(), headers: req.headers() }))
  const apiResponses = []
  page.on('response', (res) => {
    if (res.url().startsWith(`${origin}/api/`)) apiResponses.push({ url: res.url(), status: res.status(), headers: res.headers() })
  })

  // ---------- 1. as telas: nenhum pedido sai da origem; a API vem por /api
  for (const path of ['/', '/executar', '/historico', '/painel', '/tags']) {
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
  }
  const outside = seen.filter((r) => !r.url.startsWith('data:') && new URL(r.url).origin !== origin)
  check('5 telas: nenhum pedido sai da origem do site', outside.length === 0, outside.map((r) => r.url).slice(0, 5).join(' '))
  const viaProxy = seen.filter((r) => new URL(r.url).pathname.startsWith('/api/'))
  check('as telas buscam a API por /api', viaProxy.length >= 5, `${viaProxy.length} pedidos`)
  const tags = apiResponses.find((r) => new URL(r.url).pathname === '/api/tags')
  check('/api/tags responde 200 sem cabeçalho de CORS', tags?.status === 200 && !Object.keys(tags.headers).some((h) => h.startsWith('access-control-')), JSON.stringify(tags?.headers ?? null))

  // ---------- 2. a página chamando o backend direto: rejeitado (sem CORS)
  const direct = await page.evaluate(async (url) => {
    try {
      await fetch(`${url}/tags`)
      return 'resolveu'
    } catch (err) {
      return err instanceof TypeError ? 'TypeError' : `outro: ${err}`
    }
  }, BACKEND)
  check('fetch da página direto ao backend: rejeita com TypeError', direct === 'TypeError', direct)

  // ---------- 3. escritas pela tela passam pelo proxy e gravam
  seen.length = 0
  await page.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => sessionStorage.clear())
  await page.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'networkidle0' })
  const typeIn = async (label, text) => {
    const handle = await page.evaluateHandle((l) => [...document.querySelectorAll('main label')]
      .find((x) => x.querySelector('span')?.textContent.trim() === l).querySelector('input'), label)
    await handle.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.focus(); el.select() })
    await page.keyboard.press('Backspace')
    await handle.type(text)
  }
  await typeIn('O que foi feito (opcional)', `${P} registro`)
  await page.evaluate(() => [...document.querySelectorAll('main form button')].find((b) => b.textContent.trim() === 'Registrar').click())
  await page.waitForFunction(() => location.pathname === '/', { timeout: 5000 })
  await pause(300)
  const post = seen.find((r) => r.method === 'POST' && new URL(r.url).pathname === '/api/executions')
  const saved = (await pool.query('SELECT id FROM task_executions WHERE description = $1', [`${P} registro`])).rows[0]
  check('Registrar: POST por /api/executions, gravado no banco', !!post && new URL(post.url).origin === origin && !!saved, JSON.stringify(post ?? null))

  seen.length = 0
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await page.evaluate((d) => {
    const a = [...document.querySelectorAll('article')].find((x) => x.textContent.includes(d))
    a.setAttribute('data-card', '1')
    a.scrollIntoView({ block: 'center' })
    a.querySelector('button[aria-label^="Editar registro"]').click()
  }, `${P} registro`)
  await page.waitForSelector('[data-card="1"] form')
  const field = await page.evaluateHandle(() => [...document.querySelectorAll('[data-card="1"] form label')]
    .find((x) => x.querySelector('span')?.textContent.trim() === 'O que foi feito (opcional)').querySelector('input'))
  await field.evaluate((el) => { el.focus(); el.select() })
  await page.keyboard.press('Backspace')
  await field.type(`${P} editado`)
  await page.evaluate(() => {
    const f = document.querySelector('[data-card="1"] form')
    ;[...document.querySelectorAll('button')].filter((b) => f.contains(b) || b.form === f).find((b) => b.textContent.trim() === 'Salvar').click()
  })
  await pause(1200)
  const put = seen.find((r) => r.method === 'PUT' && new URL(r.url).pathname === `/api/executions/${saved?.id}`)
  const edited = (await pool.query('SELECT description FROM task_executions WHERE id = $1', [saved?.id])).rows[0]
  check('lápis: PUT por /api/executions/:id, gravado no banco', !!put && edited?.description === `${P} editado`, `${JSON.stringify(put ?? null)} ${edited?.description}`)

  // ---------- 4. DELETE pelo cliente de verdade: apagar uma tag pela tela
  const tag = await api('POST', '/tags', { name: `${P} tag` })
  seen.length = 0
  page.on('dialog', (d) => d.accept())
  await page.goto(`${APP}/tags`, { waitUntil: 'networkidle0' })
  await page.evaluate((n) => document.querySelector(`button[aria-label="Mais ações de ${n}"]`).click(), `${P} tag`)
  await page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((b) => b.textContent.trim() === 'Apagar').click())
  await pause(1200)
  const del = seen.find((r) => r.method === 'DELETE' && new URL(r.url).pathname === `/api/tags/${tag.id}`)
  const gone = (await pool.query('SELECT count(*)::int AS n FROM tags WHERE id = $1', [tag.id])).rows[0].n === 0
  check('apagar tag pela tela: DELETE por /api com X-StudyFlow, apagada no banco', !!del && del.headers['x-studyflow'] === '1' && gone, `${JSON.stringify(del?.headers ?? null)} apagada=${gone}`)
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  if (browser) await browser.close()
  if (taskId) {
    await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [taskId])).rows.map((r) => r.id))
    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId])
  }
  await pool.query('DELETE FROM tags WHERE name LIKE $1 AND parent_id IS NULL', [`${P}%`])
  const left = await pool.query(`SELECT (SELECT count(*) FROM tasks WHERE title LIKE $1)::int + (SELECT count(*) FROM task_executions WHERE description LIKE $1)::int + (SELECT count(*) FROM tags WHERE name LIKE $1)::int AS n`, [`${P}%`])
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
