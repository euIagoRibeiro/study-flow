// O4a: campos Obra e Link no Registrar e no Iniciar. Lista nativa (em
// andamento primeiro, as outras num grupo com o status), a obra preenche o
// caminho (mesmo mexido; o mesmo caminho não apaga a quantidade; caminho
// padrão arquivado não preenche), "Nenhuma obra" mantém o caminho, marcas,
// linha da tarefa padrão (a tarefa da página não muda), nota da medida, link
// recolhido ("+ Link" abre e foca; aberto fica aberto; volta fechado depois de
// registrar; rascunho com link volta aberto, sem foco; aberto e vazio volta
// fechado), link (vazio não vai, inválido barra, frases do servidor),
// corpo do POST do Registrar e do Iniciar, rascunho (a obra não refaz o
// caminho; obra que sumiu é ignorada), status mudado na tela de tags reagrupa
// sem recarregar, e os toques. Dados próprios (prefixo teste-o4), apagados no
// fim; obras pela diferença de contagem (limpeza.mjs). Pausa a sessão do seed
// e devolve a linha exata. Uso (raiz do repo):
//   node --env-file=backend/.env tests/telas/o4a-registrar.mjs
import pg from 'pg'
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME } from '../config.mjs'
import { deleteExecutions, deleteNewWorks, pauseRunning, resumeRunning, worksSnapshot } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-o4'
const KEY = (id) => `studyflow:rascunho:registrar:${id}`
const CORS = { 'Access-Control-Allow-Origin': '*' }
const LINK_ERROR = 'Link: um endereço que começa com http:// ou https://.'
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
const tag = (name, parentId = null) => api('POST', '/tags', { name, parentId })
const measureOn = (tagId, name, singular) => api('POST', '/measures', { tagId, name, singular, allowsDecimal: false, kinds: [] })

const worksBefore = await worksSnapshot(pool)
const seedSession = await pauseRunning(pool)
const made = { tags: [], measures: [], tasks: [] }
let browser
try {
  // ---------- dados: R (páginas) › A (capítulos depois), B, X (arquivada); F sem medida
  const R = await tag(`${P} raiz`)
  const A = await tag(`${P} a`, R.id)
  const B = await tag(`${P} b`, R.id)
  const X = await tag(`${P} arq`, R.id)
  const F = await tag(`${P} livre`)
  made.tags.push(A.id, B.id, X.id, R.id, F.id)
  const T = await api('POST', '/tasks', { title: `${P} tarefa` })
  const T2 = await api('POST', '/tasks', { title: `${P} outra` })
  made.tasks.push(T.id, T2.id)
  const pages = await measureOn(R.id, 'páginas', 'página')
  made.measures.push(pages.id)
  const work = (title, extra) => api('POST', '/works', { title: `${P} ${title}`, defaultTaskId: T.id, ...extra })
  // A antiga soma "páginas" em A enquanto ela é a mais próxima; depois A ganha "capítulos"
  const wOld = await work('antiga', { defaultTagId: A.id, measureId: pages.id })
  const chapters = await measureOn(A.id, 'capítulos', 'capítulo')
  made.measures.unshift(chapters.id)
  const wA = await work('em a', { defaultTagId: A.id, measureId: chapters.id })
  const wB = await work('em b', { defaultTagId: B.id, measureId: pages.id })
  const wF = await work('livre', { defaultTagId: F.id })
  const wNone = await work('sem medida', { defaultTagId: B.id })
  const wArq = await work('caminho arq', { defaultTagId: X.id, measureId: pages.id })
  const wP = await work('pausada', { defaultTagId: B.id, status: 'pausado' })
  const wC = await work('concluída', { defaultTagId: F.id, status: 'concluido' })
  const wOther = await work('de outra tarefa', { defaultTagId: F.id, defaultTaskId: T2.id })
  await api('PATCH', `/tags/${X.id}`, { active: false })

  // ---------- página
  browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 390, height: 900 })
  const posts = []
  let inject = null // { status, error }: responde o próximo POST /executions
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url() === `${API}/executions`) {
      posts.push(JSON.parse(req.postData()))
      if (inject) {
        const { status, error } = inject
        inject = null
        return req.respond({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify({ error }) })
      }
    }
    req.continue().catch(() => {})
  })
  const url = `${APP}/executar?tarefa=${T.id}`
  const go = async () => {
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.waitForSelector('main form')
    await pause(200)
  }
  const fresh = async () => {
    await page.evaluate(() => sessionStorage.clear()).catch(() => {})
    await go()
  }
  // Rótulo → valor de cada campo do Registrar, na ordem da tela
  const ui = () => page.evaluate(() => {
    const out = []
    for (const el of document.querySelector('main form').querySelectorAll('label, fieldset')) {
      const select = el.querySelector?.('select')
      if (el.tagName === 'LABEL' && el.closest('fieldset')) continue
      if (el.tagName === 'LABEL' && select) out.push([el.querySelector('span').textContent, select.selectedOptions[0]?.textContent ?? ''])
      else if (el.tagName === 'LABEL' && el.querySelector('input')) out.push([el.querySelector('span').textContent, el.querySelector('input').value])
      if (el.tagName === 'FIELDSET') out.push([el.querySelector('legend').textContent, ''])
    }
    return out
  })
  const value = async (name) => (await ui()).find(([n]) => n === name)?.[1]
  const pathNow = async () => (await ui()).filter(([n]) => n === 'Contexto' || n.startsWith('Em ')).map(([, v]) => v).filter((v) => v !== 'Nenhuma').join(' › ')
  const setField = async (label, text) => {
    const done = await page.evaluate((label, text) => {
      const l = [...document.querySelectorAll('main form label')].find((x) => x.querySelector('span')?.textContent === label && x.querySelector('select'))
      if (!l) return 'campo'
      const s = l.querySelector('select')
      const o = [...s.options].find((x) => x.textContent === text)
      if (!o) return 'opção'
      s.value = o.value
      s.dispatchEvent(new Event('change', { bubbles: true }))
      return 'ok'
    }, label, text)
    if (done !== 'ok') throw new Error(`${done} não existe: ${label} = ${text}`)
    await pause(250)
  }
  const typeIn = async (label, text) => {
    const handle = await page.evaluateHandle((label) => [...document.querySelectorAll('main form label')].find((x) => x.querySelector('span')?.textContent === label)?.querySelector('input') ?? null, label)
    if (!(await handle.evaluate((el) => el !== null))) throw new Error(`campo ${label} não existe`)
    await handle.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.select() })
    await page.keyboard.press('Backspace')
    if (text) await handle.type(text)
    await pause(150)
  }
  // Link recolhido: o botão "+ Link" ou o campo, e quem tem o foco
  const linkState = () => page.evaluate(() => {
    const block = document.querySelector('main form [data-link-field]')
    const input = block?.querySelector('input') ?? null
    return { button: block?.querySelector('button')?.textContent.trim() ?? null, input: input !== null, focused: input !== null && document.activeElement === input, value: input?.value ?? null }
  })
  const openLink = async () => {
    const done = await page.evaluate(() => {
      const b = document.querySelector('main form [data-link-field] button')
      if (!b) return false
      b.scrollIntoView({ block: 'center' })
      b.click()
      return true
    })
    if (!done) throw new Error('botão "+ Link" não existe')
    await pause(150)
  }
  const typeLink = async (text) => {
    if (!(await linkState()).input) await openLink()
    await typeIn('Link (opcional)', text)
  }
  const notes = () => page.evaluate(() => [...document.querySelectorAll('main form [data-work-field] p, main form p[data-work-field]')].map((p) => p.textContent))
  const formError = () => page.evaluate(() => document.querySelector('main form [role="alert"]')?.textContent.trim() ?? '')
  const submit = () => page.evaluate(() => [...document.querySelectorAll('main form button')].find((b) => b.textContent.trim() === 'Registrar').click())
  const draft = () => page.evaluate((k) => sessionStorage.getItem(k), KEY(T.id))
  const allWorks = await api('GET', '/works')
  const titleOf = (w) => w.title
  const byTitle = (a, b) => a.title.localeCompare(b.title, 'pt-BR', { numeric: true })
  const ORDER = ['em_andamento', 'pausado', 'concluido', 'abandonado']
  const LABEL = { pausado: 'pausada', concluido: 'concluída', abandonado: 'abandonada' }
  const expectGroups = (works) => ({
    'Em andamento': works.filter((w) => w.status === 'em_andamento').sort(byTitle).map(titleOf),
    Outras: works.filter((w) => w.status !== 'em_andamento').sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || byTitle(a, b)).map((w) => `${w.title} (${LABEL[w.status]})`),
  })
  const groups = () => page.evaluate(() => {
    const s = [...document.querySelectorAll('main form label')].find((x) => x.querySelector('span')?.textContent === 'Obra')?.querySelector('select')
    if (!s) return null
    return { first: s.options[0]?.textContent, groups: Object.fromEntries([...s.querySelectorAll('optgroup')].map((g) => [g.label, [...g.querySelectorAll('option')].map((o) => o.textContent)])) }
  })

  // ---------- 1. o campo, a ordem e as opções
  await fresh()
  const names = (await ui()).map(([n]) => n)
  check('ordem: Obra logo antes de Contexto, Link no fim (logo antes do Registrar)', names[names.indexOf('Contexto') - 1] === 'Obra' &&
    (await page.evaluate(() => document.querySelector('main form [data-link-field]')?.nextElementSibling?.textContent.trim() === 'Registrar')), names.join(' | '))
  const g = await groups()
  check('opções: "Nenhuma obra" primeiro, escolhida', g?.first === 'Nenhuma obra' && (await value('Obra')) === 'Nenhuma obra', JSON.stringify(g))
  check('grupos: "Em andamento" por título, "Outras" na ordem do filtro com o status', JSON.stringify(g?.groups) === JSON.stringify(expectGroups(allWorks)), `${JSON.stringify(g?.groups)} x ${JSON.stringify(expectGroups(allWorks))}`)
  const closed = await linkState()
  check('Link começa fechado: só o botão "+ Link"', closed.button === '+ Link' && !closed.input, JSON.stringify(closed))
  await openLink()
  const opened = await linkState()
  check('"+ Link" abre o campo e leva o foco pra ele', opened.input && opened.focused && opened.button === null, JSON.stringify(opened))
  check('link vazio e com teclado de URL', await page.evaluate(() => {
    const i = document.querySelector('main form [data-link-field] input')
    return i?.value === '' && i.inputMode === 'url' && i.type === 'text' && i.getAttribute('autocapitalize') === 'none' && i.spellcheck === false && i.maxLength === 2000
  }))
  await typeIn('Link (opcional)', '')
  await page.evaluate(() => document.activeElement?.blur())
  check('aberto, fica aberto (mesmo vazio)', (await linkState()).input)

  // ---------- 2. escolher a obra preenche o caminho
  await setField('Obra', wA.title)
  check('obra preenche o caminho padrão', (await pathNow()) === `${R.name} › ${A.name}`, await pathNow())
  check('medida do caminho (capítulos)', (await ui()).some(([n]) => n === 'Capítulos (opcional)'), JSON.stringify(await ui()))
  check('obra em dia: sem marca nem nota', (await notes()).length === 0, JSON.stringify(await notes()))
  await typeIn('Capítulos (opcional)', '5')
  await setField('Obra', 'Nenhuma obra')
  check('"Nenhuma obra" mantém o caminho', (await pathNow()) === `${R.name} › ${A.name}`, await pathNow())
  await setField('Obra', wA.title)
  check('obra do mesmo caminho não apaga a quantidade digitada', (await value('Capítulos (opcional)')) === '5', await value('Capítulos (opcional)'))
  // o toque mais novo ganha: caminho mexido, outra obra sobrescreve
  await setField('Contexto', F.name)
  await setField('Obra', wB.title)
  check('obra sobrescreve o caminho mexido', (await pathNow()) === `${R.name} › ${B.name}`, await pathNow())
  await setField('Contexto', F.name)
  check('caminho livre depois de escolher: a obra fica', (await pathNow()) === F.name && (await value('Obra')) === wB.title, `${await pathNow()} ${await value('Obra')}`)
  check('nota: caminho sem medida', JSON.stringify(await notes()) === JSON.stringify(['Este caminho não mede «páginas»: este registro não entra no progresso da obra.']), JSON.stringify(await notes()))
  await setField('Obra', wArq.title)
  check('caminho padrão arquivado não preenche o caminho', (await pathNow()) === F.name, await pathNow())
  check('caminho arquivado: marca da tela de tags', (await notes()).includes('Caminho arquivado.'), JSON.stringify(await notes()))

  // ---------- 3. medida antiga e obra sem medida
  await setField('Obra', wOld.title)
  check('antiga: preenche o caminho', (await pathNow()) === `${R.name} › ${A.name}`, await pathNow())
  check('antiga: marca e nota da medida', JSON.stringify(await notes()) === JSON.stringify([
    'Soma «páginas»; a medida deste caminho é «capítulos».',
    'Esta obra soma «páginas»: o que for registrado em «capítulos» não entra no progresso dela.',
  ]), JSON.stringify(await notes()))
  await setField('Obra', wNone.title)
  check('sem medida: preenche e não tem marca nem nota', (await pathNow()) === `${R.name} › ${B.name}` && (await notes()).length === 0, `${await pathNow()} ${JSON.stringify(await notes())}`)
  await setField('Obra', wF.title)
  check('obra sem medida em caminho sem medida: sem nota', (await pathNow()) === F.name && (await notes()).length === 0, JSON.stringify(await notes()))
  await setField('Obra', wOther.title)
  check('tarefa padrão diferente da página: a linha neutra, e a tarefa não muda', JSON.stringify(await notes()) === JSON.stringify([`A tarefa padrão desta obra é «${T2.title}».`]) && (await page.evaluate(() => location.search)).includes(T.id), JSON.stringify(await notes()))

  // ---------- 4. link e corpo do Registrar
  await fresh()
  await setField('Obra', wB.title)
  await typeLink('ftp://exemplo.com/x')
  posts.length = 0
  await submit()
  await pause(400)
  check('link inválido: mensagem e nenhum pedido', (await formError()) === LINK_ERROR && posts.length === 0, `${await formError()} / ${posts.length}`)
  inject = { status: 400, error: 'linkUrl pode ter no máximo 2000 caracteres' }
  await typeLink('https://exemplo.com/a')
  await submit()
  await pause(500)
  check('400 do servidor sobre o link: frase da tela', (await formError()) === 'Link: no máximo 2000 caracteres.', await formError())
  inject = { status: 400, error: 'Obra não encontrada' }
  await submit()
  await pause(500)
  check('400 "Obra não encontrada": frase da tela', (await formError()) === 'Esta obra não existe mais. Escolha outra.', await formError())
  posts.length = 0
  await submit()
  await page.waitForFunction(() => location.pathname === '/')
  await pause(300)
  const sent = posts.at(-1)
  check('Registrar manda workId e linkUrl', sent?.workId === wB.id && sent?.linkUrl === 'https://exemplo.com/a', JSON.stringify(sent))
  const row = (await pool.query('SELECT work_id, link_url FROM task_executions WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1', [T.id])).rows[0]
  check('gravado: obra e link', row?.work_id === wB.id && row?.link_url === 'https://exemplo.com/a', JSON.stringify(row))
  check('Registrar apaga o rascunho', (await draft()) === null, await draft())
  // Voltar à tarefa sem recarregar a página: o formulário novo começa fechado
  await page.evaluate(() => history.back())
  await page.waitForSelector('main form [data-link-field]')
  await pause(200)
  check('depois de registrar, o Link volta fechado', (await linkState()).button === '+ Link', JSON.stringify(await linkState()))
  // Sem obra e sem link: nada no corpo
  await fresh()
  posts.length = 0
  await submit()
  await page.waitForFunction(() => location.pathname === '/')
  await pause(300)
  check('sem obra e sem link: nenhum dos dois no corpo', posts.length === 1 && !('workId' in posts[0]) && !('linkUrl' in posts[0]), JSON.stringify(posts))
  // Aberto e vazio: também nada
  await fresh()
  await openLink()
  posts.length = 0
  await submit()
  await page.waitForFunction(() => location.pathname === '/')
  await pause(300)
  check('Link aberto e vazio: nenhum link no corpo', posts.length === 1 && !('linkUrl' in posts[0]), JSON.stringify(posts))

  // ---------- 5. Iniciar
  const clickStart = () => page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Iniciar cronômetro').click())
  const stopOpen = async () => {
    await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL AND task_execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)', [T.id])
    await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = $1 AND completed_at IS NULL', [T.id])).rows.map((r) => r.id))
  }
  await fresh()
  await setField('Obra', wA.title)
  await typeLink('https://exemplo.com/b')
  posts.length = 0
  await clickStart()
  await page.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Finalizar'))
  await pause(300)
  check('Iniciar leva obra, link e o caminho dela', posts.at(-1)?.workId === wA.id && posts.at(-1)?.linkUrl === 'https://exemplo.com/b' && posts.at(-1)?.rootTagId === R.id && posts.at(-1)?.tagIds?.join() === A.id, JSON.stringify(posts.at(-1)))
  const open = (await pool.query('SELECT work_id, link_url FROM task_executions WHERE task_id = $1 AND completed_at IS NULL', [T.id])).rows[0]
  check('registro aberto com obra e link', open?.work_id === wA.id && open?.link_url === 'https://exemplo.com/b', JSON.stringify(open))
  // Finalizar pela tela; o aviso de desfazer expira e volta à Lista. De volta à tarefa: fechado
  await page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Finalizar').click())
  await page.waitForFunction(() => location.pathname === '/', { timeout: 15000 })
  await page.evaluate(() => history.back())
  await page.waitForSelector('main form [data-link-field]')
  await pause(200)
  check('depois de Iniciar e Finalizar, o Link volta fechado', (await linkState()).button === '+ Link', JSON.stringify(await linkState()))
  await fresh()
  posts.length = 0
  await clickStart()
  await page.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Finalizar'))
  await pause(300)
  check('Iniciar sem mexer: corpo igual a antes (sem obra nem link)', posts.length === 1 && !('workId' in posts[0]) && !('linkUrl' in posts[0]) && !('rootTagId' in posts[0]), JSON.stringify(posts))
  await stopOpen()

  // ---------- 6. rascunho
  await fresh()
  await setField('Obra', wA.title)
  await setField(`Em ${R.name}`, B.name) // caminho mexido depois da obra
  await typeLink('https://exemplo.com/c')
  await go()
  check('rascunho volta com a obra e o link', (await value('Obra')) === wA.title && (await value('Link (opcional)')) === 'https://exemplo.com/c', `${await value('Obra')} ${await value('Link (opcional)')}`)
  const back = await linkState()
  check('rascunho com link: o campo volta aberto, sem pegar o foco', back.input && !back.focused, JSON.stringify(back))
  check('rascunho NÃO reaplica a obra sobre o caminho mexido', (await pathNow()) === `${R.name} › ${B.name}`, await pathNow())
  await page.evaluate((k, d) => sessionStorage.setItem(k, d), KEY(T.id), JSON.stringify({ ...JSON.parse(await draft()), workId: '00000000-0000-4000-8000-000000000000' }))
  await go()
  posts.length = 0
  check('rascunho com obra que sumiu: "Nenhuma obra"', (await value('Obra')) === 'Nenhuma obra', await value('Obra'))
  await submit()
  // Com a obra no pedido, o servidor recusa e a tela fica: espera os dois desfechos
  await page.waitForFunction(() => location.pathname === '/' || document.querySelector('main form [role="alert"]'))
  await pause(300)
  check('obra que sumiu não vai no pedido (corpo sem workId)', posts.length === 1 && !('workId' in posts[0]), JSON.stringify(posts))
  check('obra que sumiu: o registro grava', (await page.evaluate(() => location.pathname)) === '/', await page.evaluate(() => location.pathname))
  // Aberto e vazio não é rascunho: volta fechado (a obra escolhida faz existir o rascunho)
  await fresh()
  await setField('Obra', wA.title)
  await openLink()
  await go()
  const empty = await linkState()
  check('rascunho com o Link aberto e vazio: volta fechado', (await value('Obra')) === wA.title && empty.button === '+ Link' && !empty.input, JSON.stringify(empty))

  // ---------- 7. status mudado na tela de tags reagrupa sem recarregar
  await fresh()
  await page.evaluate(() => { window.__semRecarga = true })
  await page.evaluate(() => document.querySelector('a[href="/tags"]').click())
  await page.waitForSelector('section[aria-label="Obras"]')
  await pause(300)
  await page.evaluate((l) => document.querySelector(`button[aria-label="${l}"]`).click(), `Mais ações da obra ${wB.title}`)
  await pause(150)
  await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Pausar').click())
  await pause(600)
  await page.evaluate(() => history.back())
  await page.waitForSelector('main form')
  await pause(300)
  const after = await groups()
  const nowWorks = allWorks.map((w) => (w.id === wB.id ? { ...w, status: 'pausado' } : w))
  check('status mudado na tela de tags: obra vai pra "Outras", sem recarregar a página', (await page.evaluate(() => window.__semRecarga === true)) && JSON.stringify(after?.groups) === JSON.stringify(expectGroups(nowWorks)), JSON.stringify(after?.groups))

  // ---------- 8. toques (aparelho emulado; a escolha numa lista conta como o `change`)
  await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = $1', [T.id])).rows.map((r) => r.id))
  const touch = await browser.newPage()
  await touch.setViewport({ width: 375, height: 800, hasTouch: true, isMobile: true })
  await touch.evaluateOnNewDocument(() => {
    window.__taps = { pointer: 0, change: 0 }
    addEventListener('pointerdown', () => { window.__taps.pointer++ }, true)
    addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') window.__taps.change++ }, true)
  })
  const count = async (button, done) => {
    await touch.goto(url, { waitUntil: 'networkidle0' })
    await touch.evaluate(() => sessionStorage.clear())
    await touch.goto(url, { waitUntil: 'networkidle0' })
    await touch.waitForSelector('main form')
    await touch.evaluate(() => { window.__taps = { pointer: 0, change: 0 } })
    const select = await touch.evaluateHandle(() => [...document.querySelectorAll('main form label')].find((x) => x.querySelector('span')?.textContent === 'Obra').querySelector('select'))
    await select.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await select.tap()
    await pause(150)
    await touch.keyboard.press('Escape').catch(() => {})
    await select.evaluate((el, id) => { el.value = id; el.dispatchEvent(new Event('change', { bubbles: true })) }, wA.id)
    await pause(350)
    const btn = await touch.evaluateHandle((t) => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === t), button)
    await btn.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    const taps = await touch.evaluate(() => window.__taps)
    await btn.tap()
    await touch.waitForFunction(done)
    await pause(300)
    return taps.pointer + taps.change + 1
  }
  const reg = await count('Registrar', () => location.pathname === '/')
  const regRow = (await pool.query('SELECT work_id, root_tag_id FROM task_executions WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1', [T.id])).rows[0]
  const start = await count('Iniciar cronômetro', () => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Finalizar'))
  const startRow = (await pool.query('SELECT work_id FROM task_executions WHERE task_id = $1 AND completed_at IS NULL', [T.id])).rows[0]
  await stopOpen()
  console.log(`TOQUES na página da tarefa (+2 pra chegar nela: Executar e a tarefa): Registrar ${reg}, Iniciar ${start}; previsto 3 e 3`)
  check('toques: Registrar com obra grava a obra e o caminho dela', regRow?.work_id === wA.id && regRow?.root_tag_id === R.id, JSON.stringify(regRow))
  check('toques: Iniciar com obra grava a obra', startRow?.work_id === wA.id, JSON.stringify(startRow))
  check('toques: 3 e 3, como previsto', reg === 3 && start === 3, `${reg} ${start}`)
  await touch.close()
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser?.close().catch(() => {})
  if (made.tasks.length) {
    await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL AND task_execution_id IN (SELECT id FROM task_executions WHERE task_id = ANY($1::uuid[]))', [made.tasks])
    await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = ANY($1::uuid[])', [made.tasks])).rows.map((r) => r.id))
  }
  const delta = await deleteNewWorks(pool, worksBefore)
  await pool.query('DELETE FROM measures WHERE id = ANY($1::uuid[])', [made.measures])
  for (const id of made.tags) await pool.query('DELETE FROM tags WHERE id = $1', [id])
  if (made.tasks.length) await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [made.tasks])
  await resumeRunning(pool, seedSession)
  const left = await pool.query(`SELECT (SELECT count(*) FROM tags WHERE name LIKE '${P}%')::int + (SELECT count(*) FROM tasks WHERE title LIKE '${P}%')::int AS n`)
  const running = await pool.query('SELECT count(*)::int AS n FROM time_entries WHERE ended_at IS NULL')
  check('obras: diferença de contagem 0 depois da limpeza', delta === 0, String(delta))
  check('tags e tarefas de teste apagadas', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  check('sessão do seed devolvida (uma rodando)', running.rows[0].n === seedSession.length, `${running.rows[0].n} x ${seedSession.length}`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
