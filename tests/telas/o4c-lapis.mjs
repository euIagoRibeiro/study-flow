// O4c: obra e link no lápis (Histórico e cartão da Lista). Começa na obra e no
// link do registro (o campo do link aberto, sem foco, quando há link); Salvar
// manda workId/linkUrl só se mudaram em relação ao registro (null limpa).
// Escolher a obra NÃO mexe no caminho (nem na medida digitada, nem nas
// seleções): no lápis é correção. Obra de "Outras" marcada e mantida; marcas,
// linha da tarefa padrão e nota da medida. Obra gravada fora da lista carregada:
// o lápis busca as obras (só nesse caso), com "Carregando a obra…" no lugar de
// "Nenhuma obra", e o Salvar não manda nada. Link inválido barra; 400 pela frase
// do Registrar. Rascunho com obra e link, obra que sumiu, rascunho de antes do
// O4c. Toques. Dados próprios (prefixo teste-o4c), apagados no fim; obras pela
// diferença de contagem. Uso (raiz do repo):
//   node --env-file=backend/.env tests/telas/o4c-lapis.mjs
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'
import { deleteExecutions, deleteNewWorks, worksSnapshot } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-o4c'
const KEY = (id) => `studyflow:rascunho:editar:${id}`
const CORS = { 'Access-Control-Allow-Origin': '*' }
const LINK_ERROR = 'Link: um endereço que começa com http:// ou https://.'
const L1 = 'https://exemplo.com/um'
const L2 = 'https://exemplo.com/dois'
const FORM = 'form[id^="editar-"]'
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
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString()
const tag = (name, parentId = null) => api('POST', '/tags', { name, parentId })
const measureOn = (tagId, name, singular) => api('POST', '/measures', { tagId, name, singular, allowsDecimal: false, kinds: [] })
const has = (o, k) => o !== undefined && Object.prototype.hasOwnProperty.call(o, k)

const worksBefore = await worksSnapshot(pool)
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
  const wOld = await work('antiga', { defaultTagId: A.id, measureId: pages.id })
  const chapters = await measureOn(A.id, 'capítulos', 'capítulo')
  made.measures.unshift(chapters.id)
  const wA = await work('em a', { defaultTagId: A.id, measureId: chapters.id })
  const wB = await work('em b', { defaultTagId: B.id, measureId: pages.id })
  const wArq = await work('caminho arq', { defaultTagId: X.id, measureId: pages.id })
  const wOther = await work('de outra tarefa', { defaultTagId: F.id, defaultTaskId: T2.id })
  const wPaused = await work('pausada', { defaultTagId: F.id, status: 'pausado' })
  const wHidden = await work('fora da lista', { defaultTagId: F.id })
  const wGone = await work('vai sumir', { defaultTagId: F.id })
  await api('PATCH', `/tags/${X.id}`, { active: false })
  const natureza = (await api('GET', '/selections')).find((s) => s.tagId === null && s.name === 'Natureza')
  const estudo = natureza.options.find((o) => o.name === 'estudo').id

  let n = 0
  const record = async (body) => {
    n += 1
    const description = `${P} reg ${n}`
    const { id } = await api('POST', '/executions', { taskId: T.id, description, completedAt: hoursAgo(n + 2), ...body })
    return { id, description }
  }
  const r1 = await record({ rootTagId: R.id, tagIds: [A.id], workId: wA.id, linkUrl: L1, measureValues: [{ kindId: null, quantity: 3 }], selectionOptionIds: [estudo] })
  const rP = await record({ rootTagId: F.id, tagIds: [], workId: wPaused.id })
  const rH = await record({ rootTagId: F.id, tagIds: [], workId: wHidden.id })
  const rGone = await record({ rootTagId: F.id, tagIds: [] })
  const rD = await record({ rootTagId: R.id, tagIds: [A.id], workId: wA.id, linkUrl: L1 })
  const rL = await record({ rootTagId: F.id, tagIds: [] })
  const rT = await record({ rootTagId: F.id, tagIds: [] })
  const row = async (id) => (await pool.query('SELECT work_id, link_url, root_tag_id, description FROM task_executions WHERE id = $1', [id])).rows[0]
  const tagsOf = async (id) => (await pool.query('SELECT tag_id FROM task_execution_tags WHERE task_execution_id = $1 ORDER BY 1', [id])).rows.map((r) => r.tag_id)
  const quantityOf = async (id) => (await pool.query('SELECT quantity::float8 AS q FROM execution_measure_values WHERE task_execution_id = $1', [id])).rows.map((r) => r.q)
  const choicesOf = async (id) => (await pool.query('SELECT option_id FROM execution_selections WHERE task_execution_id = $1', [id])).rows.map((r) => r.option_id)

  // ---------- página
  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 390, height: 1000 })
  const puts = [] // corpos dos PUT /executions/:id
  let inject = null // { status, error }: responde o próximo PUT do registro
  let hide = null // { id, reveal, always }: tira uma obra do GET /works
  let worksGets = 0
  await page.setRequestInterception(true)
  page.on('request', async (req) => {
    if (req.method() === 'PUT' && /\/executions\/[0-9a-f-]+$/.test(req.url())) {
      puts.push(JSON.parse(req.postData()))
      if (inject) {
        const { status, error } = inject
        inject = null
        return req.respond({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify({ error }) })
      }
    }
    if (req.method() === 'GET' && new URL(req.url()).pathname.endsWith('/works')) {
      worksGets++
      if (hide && (hide.always || !hide.reveal)) {
        const list = (await api('GET', '/works')).filter((w) => w.id !== hide.id)
        return req.respond({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(list) })
      }
      // A recarga do lápis demora: dá pra ver o "Carregando a obra…"
      if (hide?.reveal) await pause(1500)
    }
    req.continue().catch(() => {})
  })

  const historico = async () => {
    await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('article')
    await pause(300)
  }
  const pencil = async (description) => {
    const done = await page.evaluate((description) => {
      const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === description))
      const b = a?.querySelector('button[aria-label^="Editar registro"]')
      b?.scrollIntoView({ block: 'center' })
      b?.click()
      return Boolean(b)
    }, description)
    if (!done) throw new Error(`lápis de ${description} não achado`)
    await page.waitForSelector(FORM)
    await pause(250)
  }
  const fresh = async (description) => {
    puts.length = 0
    await page.goto(`${APP}/historico`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.evaluate(() => sessionStorage.clear())
    await historico()
    await pencil(description)
  }
  const ui = () => page.evaluate((FORM) => {
    const out = []
    for (const el of document.querySelector(FORM).querySelectorAll('label, fieldset')) {
      if (el.tagName === 'LABEL' && el.closest('fieldset')) continue
      const select = el.querySelector?.('select')
      if (el.tagName === 'LABEL' && select) out.push([el.querySelector('span').textContent, select.selectedOptions[0]?.textContent ?? ''])
      else if (el.tagName === 'LABEL' && el.querySelector('input')) out.push([el.querySelector('span').textContent, el.querySelector('input').value])
      if (el.tagName === 'FIELDSET') out.push([el.querySelector('legend').textContent, ''])
    }
    return out
  }, FORM)
  const value = async (name) => (await ui()).find(([x]) => x === name)?.[1]
  const pathNow = async () => (await ui()).filter(([x]) => x === 'Contexto' || x.startsWith('Em ')).map(([, v]) => v).filter((v) => v !== 'Nenhuma').join(' › ')
  const workOptions = () => page.evaluate((FORM) => {
    const s = [...document.querySelectorAll(`${FORM} label`)].find((l) => l.querySelector('span')?.textContent === 'Obra')?.querySelector('select')
    return s ? { groups: [...s.querySelectorAll('optgroup')].map((g) => [g.label, [...g.querySelectorAll('option')].map((o) => o.textContent)]), first: s.options[0]?.textContent ?? null, selected: s.selectedOptions[0]?.textContent ?? null } : null
  }, FORM)
  const setField = async (label, text) => {
    const done = await page.evaluate((FORM, label, text) => {
      const l = [...document.querySelectorAll(`${FORM} label`)].find((x) => x.querySelector('span')?.textContent === label && x.querySelector('select'))
      if (!l) return 'campo'
      const s = l.querySelector('select')
      const o = [...s.options].find((x) => x.textContent === text)
      if (!o) return 'opção'
      s.value = o.value
      s.dispatchEvent(new Event('change', { bubbles: true }))
      return 'ok'
    }, FORM, label, text)
    if (done !== 'ok') throw new Error(`${done} não existe: ${label} = ${text}`)
    await pause(250)
  }
  const typeIn = async (label, text) => {
    const handle = await page.evaluateHandle((FORM, label) => [...document.querySelectorAll(`${FORM} label`)].find((x) => x.querySelector('span')?.textContent === label)?.querySelector('input') ?? null, FORM, label)
    if (!(await handle.evaluate((el) => el !== null))) throw new Error(`campo ${label} não existe`)
    await handle.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.select() })
    await page.keyboard.press('Backspace')
    if (text) await handle.type(text)
    await pause(150)
  }
  const linkState = () => page.evaluate((FORM) => {
    const block = document.querySelector(`${FORM} [data-link-field]`)
    const input = block?.querySelector('input') ?? null
    return { button: block?.querySelector('button')?.textContent.trim() ?? null, input: input !== null, focused: input !== null && document.activeElement === input, value: input?.value ?? null }
  }, FORM)
  const typeLink = async (text) => {
    if (!(await linkState()).input) {
      await page.evaluate((FORM) => document.querySelector(`${FORM} [data-link-field] button`).click(), FORM)
      await pause(150)
    }
    await typeIn('Link (opcional)', text)
  }
  const marks = () => page.evaluate((FORM) => [...document.querySelectorAll(`${FORM} [data-work-field] p`)].map((p) => p.textContent), FORM)
  const note = () => page.evaluate((FORM) => document.querySelector(`${FORM} p[data-work-field]`)?.textContent ?? null, FORM)
  const formError = () => page.evaluate((FORM) => document.querySelector(FORM)?.closest('article')?.querySelector('[role="alert"]')?.textContent.trim() ?? '', FORM)
  const clickSave = () => page.evaluate(() => document.querySelector('button[form^="editar-"]').click())
  const save = async () => {
    await clickSave()
    await page.waitForFunction((FORM) => !document.querySelector(FORM), {}, FORM)
    await pause(300)
  }
  const cancel = async () => {
    await page.evaluate((FORM) => [...document.querySelector(FORM).closest('article').querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancelar').click(), FORM)
    await pause(200)
  }
  const notice = () => page.evaluate(() => document.body.textContent.includes('Rascunho recuperado'))

  // ---------- 1. ordem; começa no registro; Salvar sem mexer não manda obra nem link
  await fresh(r1.description)
  const names = (await ui()).map(([x]) => x)
  check('lápis: Obra logo antes de Contexto', names[names.indexOf('Contexto') - 1] === 'Obra', names.join(' | '))
  check('lápis: Link depois de todos os outros campos', await page.evaluate((FORM) => {
    const form = document.querySelector(FORM)
    const link = form.querySelector('[data-link-field]')
    const others = [...form.querySelectorAll('label, fieldset')].filter((x) => !x.closest('[data-link-field]'))
    return link !== null && others.length > 0 && others.every((x) => x.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING)
  }, FORM), names.join(' | '))
  check('começa na obra do registro', (await value('Obra')) === wA.title, await value('Obra'))
  const l0 = await linkState()
  check('link gravado: campo aberto, com o link, sem foco', l0.input && l0.value === L1 && !l0.focused, JSON.stringify(l0))
  check('mesma tarefa: sem a linha da tarefa padrão', (await marks()).length === 0, JSON.stringify(await marks()))
  await save()
  check('Salvar sem mexer: corpo sem workId e sem linkUrl', puts.length === 1 && !has(puts[0], 'workId') && !has(puts[0], 'linkUrl'), JSON.stringify(puts))
  let r = await row(r1.id)
  check('Salvar sem mexer: obra e link iguais', r.work_id === wA.id && r.link_url === L1, JSON.stringify(r))

  // ---------- 2. escolher outra obra: o caminho, a medida digitada e as seleções ficam
  await fresh(r1.description)
  await setField('Obra', wB.title)
  check('obra no lápis: o caminho não muda', (await pathNow()) === `${R.name} › ${A.name}`, await pathNow())
  check('obra no lápis: a medida digitada fica', (await value('Capítulos (opcional)')) === '3', await value('Capítulos (opcional)'))
  check('nota da medida: a obra soma outra', (await note()) === 'Esta obra soma «páginas»: o que for registrado em «capítulos» não entra no progresso dela.', await note())
  await save()
  check('Salvar: manda só workId (sem linkUrl)', puts.length === 1 && puts[0].workId === wB.id && !has(puts[0], 'linkUrl'), JSON.stringify(puts))
  check('Salvar: caminho do pedido é o do registro', puts[0]?.rootTagId === R.id && JSON.stringify(puts[0]?.tagIds) === JSON.stringify([A.id]), JSON.stringify(puts[0]))
  r = await row(r1.id)
  check('banco: obra nova, mesmo caminho, mesma medida e seleções', r.work_id === wB.id && r.root_tag_id === R.id &&
    JSON.stringify(await tagsOf(r1.id)) === JSON.stringify([A.id]) && JSON.stringify(await quantityOf(r1.id)) === '[3]' &&
    JSON.stringify(await choicesOf(r1.id)) === JSON.stringify([estudo]), JSON.stringify(r))

  // ---------- 3. "Nenhuma obra" e link apagado: null; só o link
  await fresh(r1.description)
  await setField('Obra', 'Nenhuma obra')
  await typeIn('Link (opcional)', '')
  await save()
  check('"Nenhuma obra" e link apagado: workId e linkUrl null', puts.length === 1 && puts[0].workId === null && puts[0].linkUrl === null, JSON.stringify(puts))
  r = await row(r1.id)
  check('banco: sem obra e sem link, caminho igual', r.work_id === null && r.link_url === null && r.root_tag_id === R.id, JSON.stringify(r))
  await fresh(r1.description)
  const l1 = await linkState()
  check('sem link gravado: "+ Link" fechado', !l1.input && l1.button === '+ Link', JSON.stringify(l1))
  await typeLink(L2)
  await save()
  check('só o link mudou: manda só o linkUrl', puts.length === 1 && puts[0].linkUrl === L2 && !has(puts[0], 'workId'), JSON.stringify(puts))
  check('banco: link novo, sem obra', (await row(r1.id)).link_url === L2 && (await row(r1.id)).work_id === null)

  // ---------- 4. obra de "Outras": marcada e mantida
  await fresh(rP.description)
  const opts = await workOptions()
  check('obra pausada: marcada, com o status no nome', opts.selected === `${wPaused.title} (pausada)`, JSON.stringify(opts))
  check('obra pausada: no grupo "Outras"', opts.groups.some(([g, list]) => g === 'Outras' && list.includes(`${wPaused.title} (pausada)`)), JSON.stringify(opts.groups))
  await save()
  check('obra pausada: Salvar sem mexer não manda workId, e ela fica', puts.length === 1 && !has(puts[0], 'workId') && (await row(rP.id)).work_id === wPaused.id, JSON.stringify(puts))

  // ---------- 5. marcas e linha da tarefa padrão (sem gravar)
  await fresh(r1.description)
  await setField('Obra', wArq.title)
  check('marca: caminho arquivado', (await marks()).includes('Caminho arquivado.'), JSON.stringify(await marks()))
  check('caminho padrão arquivado: o caminho do registro fica', (await pathNow()) === `${R.name} › ${A.name}`, await pathNow())
  await setField('Obra', wOld.title)
  check('marca: medida trocada', (await marks()).includes('Soma «páginas»; a medida deste caminho é «capítulos».'), JSON.stringify(await marks()))
  await setField('Obra', wOther.title)
  check('linha da tarefa padrão (é a do registro, não a da obra)', (await marks()).includes(`A tarefa padrão desta obra é «${T2.title}».`), JSON.stringify(await marks()))
  check('obra sem medida: sem nota da medida', (await note()) === null, await note())
  await cancel()

  // ---------- 6. link inválido; recusas do servidor
  await fresh(r1.description)
  await typeIn('O que foi feito (opcional)', 'texto do lápis')
  await typeLink('ftp://exemplo.com/x')
  puts.length = 0
  await clickSave()
  await pause(400)
  check('link inválido: barra com a frase da tela', (await formError()) === LINK_ERROR && puts.length === 0, `${await formError()} ${puts.length}`)
  check('link inválido: o resto do formulário fica', (await value('O que foi feito (opcional)')) === 'texto do lápis' && (await value('Link (opcional)')) === 'ftp://exemplo.com/x', JSON.stringify(await ui()))
  await typeLink(L1)
  inject = { status: 400, error: 'linkUrl pode ter no máximo 2000 caracteres' }
  await clickSave()
  await pause(500)
  check('400 do link grande: frase do Registrar', (await formError()) === 'Link: no máximo 2000 caracteres.', await formError())
  inject = { status: 400, error: 'Motivo teste-o4c do servidor.' }
  await clickSave()
  await pause(500)
  check('outro 400: o motivo do servidor, como veio', (await formError()) === 'Motivo teste-o4c do servidor.', await formError())
  await cancel()
  await fresh(rGone.description)
  await setField('Obra', wGone.title)
  await typeIn('O que foi feito (opcional)', 'texto antes da recusa')
  await api('DELETE', `/works/${wGone.id}`)
  await clickSave()
  await pause(600)
  check('obra apagada antes do Salvar: "Esta obra não existe mais. Escolha outra."', (await formError()) === 'Esta obra não existe mais. Escolha outra.', await formError())
  r = await row(rGone.id)
  check('recusado: formulário aberto com o que estava, banco intacto', (await value('O que foi feito (opcional)')) === 'texto antes da recusa' && r.work_id === null && r.description === rGone.description, JSON.stringify(r))
  await cancel()

  // ---------- 7. obra gravada fora da lista carregada: busca só nesse caso
  await page.evaluate(() => sessionStorage.clear())
  await historico()
  let gets = worksGets
  await pencil(rD.description)
  await pause(1000)
  check('obra na lista: o lápis não busca as obras', worksGets === gets, `${worksGets - gets} buscas`)
  await cancel()
  hide = { id: wHidden.id, reveal: false, always: false }
  await historico()
  hide.reveal = true
  gets = worksGets
  puts.length = 0
  await pencil(rH.description)
  const loading = await workOptions()
  check('fora da lista: "Carregando a obra…" no lugar de "Nenhuma obra"', loading.selected === 'Carregando a obra…', JSON.stringify(loading))
  await page.waitForFunction((FORM, title) => [...document.querySelectorAll(`${FORM} select`)].some((s) => s.selectedOptions[0]?.textContent === title), { timeout: 6000 }, FORM, wHidden.title).catch(() => {})
  check('fora da lista: depois da busca, a obra do registro', (await value('Obra')) === wHidden.title && worksGets > gets, `${await value('Obra')} ${worksGets - gets}`)
  await save()
  check('fora da lista: Salvar sem mexer não manda workId', puts.length === 1 && !has(puts[0], 'workId') && (await row(rH.id)).work_id === wHidden.id, JSON.stringify(puts))
  hide = { id: wHidden.id, reveal: false, always: true }
  await historico()
  puts.length = 0
  await pencil(rH.description)
  await pause(1500)
  check('busca sem a obra: "Obra deste registro (não carregou)"', (await value('Obra')) === 'Obra deste registro (não carregou)', await value('Obra'))
  await save()
  check('busca sem a obra: Salvar não manda workId, e ela fica', puts.length === 1 && !has(puts[0], 'workId') && (await row(rH.id)).work_id === wHidden.id, JSON.stringify(puts))
  hide = null

  // ---------- 8. rascunho
  await fresh(rD.description)
  await setField('Obra', wB.title)
  await typeIn('Link (opcional)', L2)
  await pause(300)
  await historico()
  await pencil(rD.description)
  const l2 = await linkState()
  check('rascunho: obra e link voltam, com o aviso', (await notice()) && (await value('Obra')) === wB.title && l2.value === L2, JSON.stringify({ obra: await value('Obra'), l2 }))
  check('rascunho: link aberto sem foco', l2.input && !l2.focused, JSON.stringify(l2))
  const stored = JSON.parse(await page.evaluate((k) => sessionStorage.getItem(k), KEY(rD.id)))
  const reopenWith = async (draft) => {
    await page.evaluate((k, v) => sessionStorage.setItem(k, v), KEY(rD.id), JSON.stringify(draft))
    await historico()
    await pencil(rD.description)
  }
  await reopenWith({ ...stored, workId: '00000000-0000-4000-8000-0000000000c4' })
  check('rascunho com obra que sumiu: a do registro', (await value('Obra')) === wA.title && (await notice()), await value('Obra'))
  const { workId: _w, link: _l, ...old } = stored
  await reopenWith({ ...old, description: 'rascunho de antes do O4c' })
  check('rascunho de antes do O4c: vale, com a obra e o link do registro', (await value('O que foi feito (opcional)')) === 'rascunho de antes do O4c' && (await value('Obra')) === wA.title && (await linkState()).value === L1, JSON.stringify(await ui()))
  await reopenWith({ ...stored, workId: null })
  check('rascunho com "Nenhuma obra": volta sem obra', (await value('Obra')) === 'Nenhuma obra', await value('Obra'))
  puts.length = 0
  await save()
  check('Salvar do rascunho: workId null e o link do rascunho', puts.length === 1 && puts[0].workId === null && puts[0].linkUrl === L2, JSON.stringify(puts))

  // ---------- 9. cartão da Lista
  puts.length = 0
  await page.evaluate(() => sessionStorage.clear())
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
  await page.waitForSelector(`button[aria-label="Mais ações de ${T.title}"]`)
  await pause(300)
  await page.evaluate((title) => document.querySelector(`button[aria-label="Mais ações de ${title}"]`).click(), T.title)
  await pause(150)
  await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Ver histórico').click())
  await pause(300)
  await pencil(rL.description)
  check('Lista: campo Obra no lápis, sem obra', (await value('Obra')) === 'Nenhuma obra', await value('Obra'))
  await setField('Obra', wA.title)
  await save()
  check('Lista: grava a obra, caminho igual', puts.length === 1 && puts[0].workId === wA.id && (await row(rL.id)).work_id === wA.id && (await row(rL.id)).root_tag_id === F.id, JSON.stringify(puts))
  await page.close()

  // ---------- 10. toques: pôr a obra num registro, no Histórico e no cartão da Lista
  const touch = await browser.newPage()
  await touch.setViewport({ width: 375, height: 800, hasTouch: true, isMobile: true })
  await touch.evaluateOnNewDocument(() => {
    window.__taps = { pointer: 0, change: 0 }
    addEventListener('pointerdown', () => { window.__taps.pointer++ }, true)
    addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') window.__taps.change++ }, true)
  })
  const tapEl = async (handle) => {
    await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await handle.tap()
    await pause(300)
  }
  const putWork = async (title) => {
    await tapEl(await touch.evaluateHandle((d) => [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === d)).querySelector('button[aria-label^="Editar registro"]'), rT.description))
    const select = await touch.evaluateHandle((FORM) => [...document.querySelectorAll(`${FORM} label`)].find((l) => l.querySelector('span')?.textContent === 'Obra').querySelector('select'), FORM)
    await tapEl(select)
    await touch.keyboard.press('Escape').catch(() => {})
    await select.evaluate((el, title) => {
      el.value = [...el.options].find((o) => o.textContent === title).value
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, title)
    await pause(200)
    const button = await touch.evaluateHandle(() => document.querySelector('button[form^="editar-"]'))
    await button.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    const taps = await touch.evaluate(() => window.__taps)
    await button.tap()
    await pause(700)
    return taps.pointer + taps.change + 1
  }
  const zero = () => touch.evaluate(() => { window.__taps = { pointer: 0, change: 0 } })
  await touch.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await zero()
  const inHistory = await putWork(wA.title)
  const afterHistory = (await row(rT.id)).work_id
  await touch.goto(`${APP}/`, { waitUntil: 'networkidle0' })
  await zero()
  await tapEl(await touch.evaluateHandle((t) => document.querySelector(`button[aria-label="Mais ações de ${t}"]`), T.title))
  await tapEl(await touch.evaluateHandle(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Ver histórico')))
  const inList = await putWork(wB.title)
  console.log(`TOQUES Histórico: medido ${inHistory}, previsto 4; cartão da Lista: medido ${inList}, previsto 6`)
  check('toques: Histórico = 4, cartão da Lista = 6, e gravaram', inHistory === 4 && inList === 6 && afterHistory === wA.id && (await row(rT.id)).work_id === wB.id, `${inHistory} ${inList}`)
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser?.close().catch(() => {})
  if (made.tasks.length) {
    await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = ANY($1::uuid[])', [made.tasks])).rows.map((r) => r.id))
  }
  const delta = await deleteNewWorks(pool, worksBefore)
  await pool.query('DELETE FROM measures WHERE id = ANY($1::uuid[])', [made.measures])
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
