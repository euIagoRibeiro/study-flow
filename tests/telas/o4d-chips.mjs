// O4d: obra e link do registro no Histórico e no cartão da Lista. Chip "Obra:
// <título de hoje>", sem o status, numa lista própria antes das tags (as
// seleções depois); só mostra (nada tocável). Link: só o domínio, sem "www.",
// nova aba com noopener e noreferrer, nome acessível; nada é buscado de fora.
// Registro sem obra e sem link: nada novo; endereço que não é http/https (só na
// resposta da API) não vira link. Obra fora da lista carregada: sem
// chip e sem lista vazia. Dados próprios (prefixo teste-o4d), apagados no fim;
// obras pela diferença de contagem. Uso (raiz do repo):
//   node --env-file=backend/.env tests/telas/o4d-chips.mjs
import pg from 'pg'
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME } from '../config.mjs'
import { deleteExecutions, deleteNewWorks, worksSnapshot } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-o4d'
const CORS = { 'Access-Control-Allow-Origin': '*' }
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(method, path, body) {
  const res = await fetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString()

const worksBefore = await worksSnapshot(pool)
const made = { tags: [], tasks: [] }
let browser
try {
  const R = await api('POST', '/tags', { name: `${P} raiz`, parentId: null })
  made.tags.push(R.id)
  const T = await api('POST', '/tasks', { title: `${P} tarefa` })
  made.tasks.push(T.id)
  const work = (title, extra = {}) => api('POST', '/works', { title: `${P} ${title}`, defaultTagId: R.id, defaultTaskId: T.id, ...extra })
  const wA = await work('em andamento')
  const wP = await work('pausada', { status: 'pausado' })
  const wR = await work('nome antigo')
  const wX = await work('fora da lista')
  const natureza = (await api('GET', '/selections')).find((s) => s.tagId === null && s.name === 'Natureza')
  const estudo = natureza.options.find((o) => o.name === 'estudo').id
  let n = 0
  const record = async (body) => {
    n += 1
    const description = `${P} reg ${n}`
    await api('POST', '/executions', { taskId: T.id, description, completedAt: hoursAgo(n + 1), ...body })
    return description
  }
  const LINK_W = 'https://www.exemplo.com/video?t=42'
  const LINK_L = 'http://exemplo.org/a/b'
  const LINK_IDN = 'https://ação.exemplo/x'
  const rW = await record({ rootTagId: R.id, tagIds: [], workId: wA.id, linkUrl: LINK_W, selectionOptionIds: [estudo] })
  const rP = await record({ workId: wP.id })
  const rL = await record({ linkUrl: LINK_L })
  const rN = await record({})
  const rR = await record({ workId: wR.id })
  const rX = await record({ workId: wX.id })
  const rI = await record({ linkUrl: LINK_IDN })
  // Só na resposta da API (o banco recusa): a tela confere o protocolo de novo
  const rJ = await record({})
  const rF = await record({})
  const renamed = `${P} nome de hoje`
  await api('PATCH', `/works/${wR.id}`, { title: renamed })

  browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 390, height: 1000 })
  const outside = []
  const allowed = [new URL(APP).host, new URL(API).host]
  await page.setRequestInterception(true)
  page.on('request', async (req) => {
    const url = new URL(req.url())
    if (!url.protocol.startsWith('data') && !allowed.includes(url.host)) {
      outside.push(req.url())
      return req.abort()
    }
    if (req.method() === 'GET' && url.pathname.endsWith('/executions')) {
      const list = (await api('GET', '/executions')).map((e) => (e.description === rJ ? { ...e, linkUrl: 'javascript:alert(1)' } : e.description === rF ? { ...e, linkUrl: 'ftp://exemplo.net/x' } : e))
      return req.respond({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(list) })
    }
    if (req.method() === 'GET' && url.pathname.endsWith('/works')) {
      const list = (await api('GET', '/works')).filter((w) => w.id !== wX.id)
      return req.respond({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(list) })
    }
    req.continue().catch(() => {})
  })

  const card = (description) => page.evaluate((description) => {
    const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === description))
    if (!a) return null
    const lists = [...a.querySelectorAll(':scope > ul')].map((ul) => ul.getAttribute('aria-label'))
    const workList = a.querySelector('[data-work-chips]')
    const link = a.querySelector('a[data-record-link]')
    return {
      lists,
      work: workList ? [...workList.querySelectorAll(':scope > li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()) : null,
      workLabel: workList?.getAttribute('aria-label') ?? null,
      workTouchable: workList ? workList.querySelectorAll('a, button, input').length : 0,
      obraInSelections: [...a.querySelectorAll('[data-selection-chips] li')].some((li) => li.textContent.startsWith('Obra:')),
      link: link && {
        href: link.getAttribute('href'),
        target: link.getAttribute('target'),
        rel: (link.getAttribute('rel') ?? '').split(/\s+/),
        text: link.firstChild?.textContent ?? '',
        label: link.getAttribute('aria-label'),
      },
      anyLink: a.querySelectorAll('a').length,
    }
  }, description)

  const scenario = async (where) => {
    const w = await card(rW)
    check(`${where}: chip "Obra: <título>", sem o status`, JSON.stringify(w?.work) === JSON.stringify([`Obra: ${wA.title}`]), JSON.stringify(w))
    check(`${where}: lista da obra antes das tags, seleções depois`, JSON.stringify(w?.lists) === JSON.stringify(['Obra', 'Tags', 'Seleções']), JSON.stringify(w?.lists))
    check(`${where}: chip não é tocável e fica fora das seleções`, w?.workTouchable === 0 && !w?.obraInSelections, JSON.stringify(w))
    check(`${where}: link mostra o domínio sem "www."`, w?.link?.text === 'exemplo.com', JSON.stringify(w?.link))
    check(`${where}: link com o endereço exato, nova aba, noopener e noreferrer`, w?.link?.href === LINK_W && w.link.target === '_blank' && w.link.rel.includes('noopener') && w.link.rel.includes('noreferrer'), JSON.stringify(w?.link))
    check(`${where}: nome acessível do link`, w?.link?.label === 'Abrir link do registro em exemplo.com (nova aba)', w?.link?.label)
    const p = await card(rP)
    check(`${where}: obra pausada: só o título`, JSON.stringify(p?.work) === JSON.stringify([`Obra: ${wP.title}`]), JSON.stringify(p?.work))
    const l = await card(rL)
    check(`${where}: só link: sem lista da obra, link com o domínio`, l?.work === null && l?.link?.text === 'exemplo.org' && l.link.href === LINK_L, JSON.stringify(l))
    const none = await card(rN)
    check(`${where}: sem obra e sem link: nada novo`, none !== null && none.work === null && none.link === null && none.anyLink === 0, JSON.stringify(none))
    const r = await card(rR)
    check(`${where}: obra renomeada: o título de hoje`, JSON.stringify(r?.work) === JSON.stringify([`Obra: ${renamed}`]), JSON.stringify(r?.work))
    const x = await card(rX)
    check(`${where}: obra fora da lista: sem chip e sem lista vazia`, x !== null && x.work === null && !x.lists.includes('Obra'), JSON.stringify(x))
    const i = await card(rI)
    const j = await card(rJ)
    check(`${where}: endereço que não é http/https não vira link`, j !== null && j.link === null && j.anyLink === 0, JSON.stringify(j))
    const f = await card(rF)
    check(`${where}: outro protocolo, mesmo com domínio, não vira link`, f !== null && f.link === null && f.anyLink === 0, JSON.stringify(f))
    check(`${where}: domínio com acento na forma xn--`, /^xn--/.test(i?.link?.text ?? ''), JSON.stringify(i?.link))
  }

  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('article')
  await pause(300)
  await scenario('Histórico')
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
  await page.evaluate((title) => document.querySelector(`button[aria-label="Mais ações de ${title}"]`).click(), T.title)
  await pause(150)
  await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Ver histórico').click())
  await pause(300)
  await scenario('cartão da Lista')
  check('nenhuma requisição para fora da página e da API', outside.length === 0, outside.join(' | '))
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser?.close().catch(() => {})
  if (made.tasks.length) {
    await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = ANY($1::uuid[])', [made.tasks])).rows.map((r) => r.id))
  }
  const delta = await deleteNewWorks(pool, worksBefore)
  for (const id of made.tags) await pool.query('DELETE FROM tags WHERE id = $1', [id])
  if (made.tasks.length) await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [made.tasks])
  const left = await pool.query(`SELECT (SELECT count(*) FROM tags WHERE name LIKE '${P}%')::int + (SELECT count(*) FROM tasks WHERE title LIKE '${P}%')::int AS n`)
  check('obras: diferença de contagem 0 depois da limpeza', delta === 0, String(delta))
  check('tags e tarefas de teste apagadas', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
