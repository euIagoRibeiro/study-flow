// O4b: obra e link no painel do cronômetro, no Finalizar e no Desfazer. O painel
// começa na obra e no link do registro (o campo do link aberto, sem foco, quando
// há link); escolher a obra faz o mesmo que no Registrar (preenche o caminho,
// mesma obra mantém a quantidade, caminho padrão arquivado não preenche, "Nenhuma
// obra" mantém) e reposiciona o treino gravado; marcas, linha da tarefa padrão e
// nota da medida. Finalizar manda workId/linkUrl só se mudaram em relação ao
// registro (null limpa); o Desfazer é simétrico (só os que o Finalizar mudou, com
// o valor de antes). Link inválido barra com a frase da tela; recusas do servidor
// pelo mapeamento do Registrar, no Finalizar e no Desfazer; no Desfazer, a obra de
// antes apagada na janela tem aviso próprio e outro 400 vem como o servidor disse. Memória do painel: sair e voltar mantém;
// servidor mudado ganha; memória de antes do O4b e obra que sumiu. Toques. Dados
// próprios (prefixo teste-o4b), apagados no fim; obras pela diferença de contagem.
// Pausa a sessão do seed e devolve a linha exata. Uso (raiz do repo):
//   node --env-file=backend/.env tests/telas/o4b-painel.mjs
import pg from 'pg'
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME } from '../config.mjs'
import { deleteExecutions, deleteNewWorks, pauseRunning, resumeRunning, worksSnapshot } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-o4b'
const MEMORY = (id) => `studyflow:cronometro:${id}`
const CORS = { 'Access-Control-Allow-Origin': '*' }
const LINK_ERROR = 'Link: um endereço que começa com http:// ou https://.'
const L1 = 'https://exemplo.com/um'
const L2 = 'https://exemplo.com/dois'
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
const has = (o, k) => o !== undefined && Object.prototype.hasOwnProperty.call(o, k)

const worksBefore = await worksSnapshot(pool)
const seedSession = await pauseRunning(pool)
const made = { tags: [], measures: [], tasks: [] }
let browser
try {
  // ---------- dados: R (páginas) › A (capítulos depois), B, X (arquivada); F sem medida;
  // W1 e W2 com treino
  const R = await tag(`${P} raiz`)
  const A = await tag(`${P} a`, R.id)
  const B = await tag(`${P} b`, R.id)
  const X = await tag(`${P} arq`, R.id)
  const F = await tag(`${P} livre`)
  const W1 = await tag(`${P} treino 1`)
  const W2 = await tag(`${P} treino 2`)
  made.tags.push(A.id, B.id, X.id, R.id, F.id, W1.id, W2.id)
  await api('PATCH', `/tags/${W1.id}`, { tracksWorkout: true })
  await api('PATCH', `/tags/${W2.id}`, { tracksWorkout: true })
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
  const wT2 = await work('treino 2', { defaultTagId: W2.id })
  const wGone = await work('vai sumir', { defaultTagId: F.id })
  await api('PATCH', `/tags/${X.id}`, { active: false })
  const exercise = (await api('GET', '/exercises')).find((e) => e.active)

  // Registro aberto de teste, criado pela API (o Iniciar já tem bateria própria)
  const openRecord = async (extra = {}) => (await api('POST', '/executions', { taskId: T.id, description: null, completedAt: null, ...extra })).id
  const stopOpen = async () => {
    await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL AND task_execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)', [T.id])
    await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = $1 AND completed_at IS NULL', [T.id])).rows.map((r) => r.id))
  }
  const rowOf = async (id) => (await pool.query('SELECT work_id, link_url, completed_at, root_tag_id, description FROM task_executions WHERE id = $1', [id])).rows[0]

  // ---------- página
  browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 390, height: 900 })
  const puts = [] // corpos dos PUT /executions/:id (sem o /workout)
  let inject = null // { status, error }: responde o próximo PUT do registro
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.method() === 'PUT' && /\/executions\/[0-9a-f-]+$/.test(req.url())) {
      puts.push(JSON.parse(req.postData()))
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
    await page.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Finalizar'))
    await pause(200)
  }
  const fresh = async () => {
    await page.evaluate(() => sessionStorage.clear()).catch(() => {})
    await go()
  }
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
  const linkState = () => page.evaluate(() => {
    const block = document.querySelector('main form [data-link-field]')
    const input = block?.querySelector('input') ?? null
    return { button: block?.querySelector('button')?.textContent.trim() ?? null, input: input !== null, focused: input !== null && document.activeElement === input, value: input?.value ?? null }
  })
  const typeLink = async (text) => {
    if (!(await linkState()).input) {
      await page.evaluate(() => document.querySelector('main form [data-link-field] button').click())
      await pause(150)
    }
    await typeIn('Link (opcional)', text)
  }
  const notes = () => page.evaluate(() => [...document.querySelectorAll('main form [data-work-field] p, main form p[data-work-field]')].map((p) => p.textContent))
  const formError = () => page.evaluate(() => document.querySelector('main [role="alert"]')?.textContent.trim() ?? '')
  const finish = () => page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Finalizar').click())
  const finished = async () => {
    await finish()
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith('Desfazer')))
    await pause(200)
  }
  const undone = async () => {
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Desfazer')).click())
    await pause(150)
    await page.waitForFunction(() => !document.body.textContent.includes('Desfazendo') &&
      ([...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Finalizar') || document.body.textContent.includes('Não foi possível desfazer')))
    await pause(400)
  }
  const bodyText = () => page.evaluate(() => document.body.textContent)

  // ---------- 1. começa no registro; Finalizar e Desfazer sem mexer não mandam obra nem link
  let id = await openRecord({ rootTagId: R.id, tagIds: [A.id], workId: wA.id, linkUrl: L1 })
  await fresh()
  const names = (await ui()).map(([n]) => n)
  check('painel: Obra logo antes de Contexto', names[names.indexOf('Contexto') - 1] === 'Obra', names.join(' | '))
  check('painel: Link no fim do formulário', await page.evaluate(() => document.querySelector('main form').lastElementChild?.matches('[data-link-field]')), names.join(' | '))
  check('painel começa na obra do registro', (await value('Obra')) === wA.title, await value('Obra'))
  const start = await linkState()
  check('registro com link: o campo abre sozinho, com o link, sem foco', start.input && !start.focused && start.value === L1, JSON.stringify(start))
  check('obra do registro não mexe no caminho', (await pathNow()) === `${R.name} › ${A.name}`, await pathNow())
  puts.length = 0
  await finished()
  check('Finalizar sem mexer: corpo sem workId e sem linkUrl', puts.length === 1 && !has(puts[0], 'workId') && !has(puts[0], 'linkUrl'), JSON.stringify(puts))
  let row = await rowOf(id)
  check('Finalizar sem mexer: obra e link ficam', row.completed_at !== null && row.work_id === wA.id && row.link_url === L1, JSON.stringify(row))
  puts.length = 0
  await undone()
  check('Desfazer sem o Finalizar ter mudado: corpo sem workId e sem linkUrl', puts.length === 1 && !has(puts[0], 'workId') && !has(puts[0], 'linkUrl'), JSON.stringify(puts))
  row = await rowOf(id)
  check('Desfazer: registro aberto com a mesma obra e link', row.completed_at === null && row.work_id === wA.id && row.link_url === L1, JSON.stringify(row))

  // ---------- 2. "Nenhuma obra" e link apagado: null; Desfazer volta os de antes
  await setField('Obra', 'Nenhuma obra')
  check('"Nenhuma obra" mantém o caminho', (await pathNow()) === `${R.name} › ${A.name}`, await pathNow())
  await typeIn('Link (opcional)', '')
  puts.length = 0
  await finished()
  check('Finalizar: "Nenhuma obra" e link apagado vão como null', puts.length === 1 && puts[0].workId === null && puts[0].linkUrl === null, JSON.stringify(puts))
  row = await rowOf(id)
  check('gravado: sem obra e sem link', row.work_id === null && row.link_url === null, JSON.stringify(row))
  puts.length = 0
  await undone()
  check('Desfazer manda a obra e o link de antes', puts.length === 1 && puts[0].workId === wA.id && puts[0].linkUrl === L1, JSON.stringify(puts))
  row = await rowOf(id)
  check('Desfazer: obra e link de volta, registro aberto', row.completed_at === null && row.work_id === wA.id && row.link_url === L1, JSON.stringify(row))
  // só o link mudou: o Desfazer manda só o link
  await typeIn('Link (opcional)', L2)
  puts.length = 0
  await finished()
  check('só o link mudou: Finalizar manda só o linkUrl', puts.length === 1 && !has(puts[0], 'workId') && puts[0].linkUrl === L2, JSON.stringify(puts))
  puts.length = 0
  await undone()
  check('só o link mudou: Desfazer manda só o linkUrl de antes', puts.length === 1 && !has(puts[0], 'workId') && puts[0].linkUrl === L1, JSON.stringify(puts))
  await stopOpen()

  // ---------- 3. registro sem obra: escolher no painel
  id = await openRecord()
  await fresh()
  check('sem obra: "Nenhuma obra" e o "+ Link" fechado', (await value('Obra')) === 'Nenhuma obra' && (await linkState()).button === '+ Link', `${await value('Obra')} ${JSON.stringify(await linkState())}`)
  await setField('Obra', wA.title)
  check('obra no painel preenche o caminho', (await pathNow()) === `${R.name} › ${A.name}`, await pathNow())
  check('medida do caminho (capítulos), obra em dia sem nota', (await ui()).some(([n]) => n === 'Capítulos (opcional)') && (await notes()).length === 0, JSON.stringify(await notes()))
  await typeIn('Capítulos (opcional)', '5')
  await setField('Obra', 'Nenhuma obra')
  await setField('Obra', wA.title)
  check('obra do mesmo caminho não apaga a quantidade', (await value('Capítulos (opcional)')) === '5', await value('Capítulos (opcional)'))
  await setField('Contexto', F.name)
  await setField('Obra', wArq.title)
  check('caminho padrão arquivado não preenche', (await pathNow()) === F.name, await pathNow())
  check('marca do caminho arquivado', (await notes()).includes('Caminho arquivado.'), JSON.stringify(await notes()))
  await setField('Obra', wOld.title)
  check('medida antiga: marca e nota da medida no painel', JSON.stringify(await notes()) === JSON.stringify([
    'Soma «páginas»; a medida deste caminho é «capítulos».',
    'Esta obra soma «páginas»: o que for registrado em «capítulos» não entra no progresso dela.',
  ]), JSON.stringify(await notes()))
  await setField('Obra', wOther.title)
  check('tarefa padrão diferente da do registro: a linha', JSON.stringify(await notes()) === JSON.stringify([`A tarefa padrão desta obra é «${T2.title}».`]), JSON.stringify(await notes()))
  await setField('Obra', wB.title)
  check('obra da tarefa do registro: sem a linha', !(await notes()).some((n) => n.startsWith('A tarefa padrão')), JSON.stringify(await notes()))
  await typeLink(L2)
  puts.length = 0
  await finished()
  check('Finalizar manda a obra escolhida, o link e o caminho dela', puts.length === 1 && puts[0].workId === wB.id && puts[0].linkUrl === L2 && puts[0].rootTagId === R.id && puts[0].tagIds?.join() === B.id, JSON.stringify(puts))
  row = await rowOf(id)
  check('gravado: obra, link e caminho', row.work_id === wB.id && row.link_url === L2 && row.root_tag_id === R.id, JSON.stringify(row))
  puts.length = 0
  await undone()
  check('Desfazer de registro sem obra: workId e linkUrl null', puts.length === 1 && puts[0].workId === null && puts[0].linkUrl === null, JSON.stringify(puts))
  row = await rowOf(id)
  check('Desfazer: sem obra e sem link de novo', row.completed_at === null && row.work_id === null && row.link_url === null, JSON.stringify(row))

  // ---------- 4. link inválido e recusas do servidor no Finalizar
  await fresh()
  await typeIn('O que foi feito (opcional)', 'texto do painel')
  await setField('Obra', wB.title)
  await typeLink('ftp://exemplo.com/x')
  puts.length = 0
  await finish()
  await pause(400)
  check('link inválido: frase da tela e nenhum pedido', (await formError()) === LINK_ERROR && puts.length === 0, `${await formError()} / ${puts.length}`)
  check('link inválido: o resto do formulário fica', (await value('O que foi feito (opcional)')) === 'texto do painel' && (await value('Obra')) === wB.title && (await value('Link (opcional)')) === 'ftp://exemplo.com/x' && (await pathNow()) === `${R.name} › ${B.name}`, JSON.stringify(await ui()))
  await typeLink(L2)
  inject = { status: 400, error: 'linkUrl pode ter no máximo 2000 caracteres' }
  await finish()
  await pause(500)
  check('Finalizar: 400 do link grande com a frase do Registrar', (await formError()) === 'Link: no máximo 2000 caracteres.', await formError())
  inject = { status: 400, error: 'Obra não encontrada' }
  await finish()
  await pause(500)
  check('Finalizar: 400 "Obra não encontrada" com a frase do Registrar', (await formError()) === 'Esta obra não existe mais. Escolha outra.', await formError())
  row = await rowOf(id)
  check('recusado: registro aberto, formulário com o que estava', row.completed_at === null && (await value('Obra')) === wB.title && (await value('O que foi feito (opcional)')) === 'texto do painel', JSON.stringify(row))
  await stopOpen()

  // ---------- 5. Desfazer recusado: obra de antes apagada na janela, e link pelo mapeamento
  id = await openRecord({ workId: wGone.id })
  await fresh()
  await setField('Obra', wB.title)
  await finished()
  await api('DELETE', `/works/${wGone.id}`)
  await undone()
  check('Desfazer com a obra de antes apagada: aviso próprio', (await bodyText()).includes('Não foi possível desfazer: a obra de antes não existe mais. A execução continua finalizada.'), (await bodyText()).slice(0, 300))
  check('Desfazer com a obra de antes apagada: sem a frase do Registrar', !(await bodyText()).includes('Escolha outra'), (await bodyText()).slice(0, 300))
  row = await rowOf(id)
  check('Desfazer recusado: registro finalizado com a obra do Finalizar', row.completed_at !== null && row.work_id === wB.id, JSON.stringify(row))
  id = await openRecord()
  await fresh()
  await typeLink(L1)
  await finished()
  inject = { status: 400, error: 'linkUrl pode ter no máximo 2000 caracteres' }
  await undone()
  check('Desfazer: 400 do link com a frase do Registrar', (await bodyText()).includes('Não foi possível desfazer: Link: no máximo 2000 caracteres. A execução continua finalizada.'), (await bodyText()).slice(0, 300))
  // outro 400 qualquer: o motivo do servidor, como veio
  id = await openRecord()
  await fresh()
  await typeLink(L1)
  await finished()
  inject = { status: 400, error: 'Motivo teste-o4b do servidor.' }
  await undone()
  check('Desfazer: outro 400 com o motivo do servidor', (await bodyText()).includes('Não foi possível desfazer: Motivo teste-o4b do servidor. A execução continua finalizada.'), (await bodyText()).slice(0, 300))

  // ---------- 6. memória do painel
  id = await openRecord({ rootTagId: R.id, tagIds: [A.id], workId: wA.id, linkUrl: L1 })
  await fresh()
  await setField('Obra', wB.title)
  await typeIn('Link (opcional)', L2)
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
  await go()
  const back = await linkState()
  check('sair e voltar: obra e link do painel ficam', (await value('Obra')) === wB.title && back.value === L2 && !back.focused, `${await value('Obra')} ${JSON.stringify(back)}`)
  puts.length = 0
  await finished()
  check('Finalizar depois de voltar: compara com o registro, não com a tela de volta', puts.length === 1 && puts[0].workId === wB.id && puts[0].linkUrl === L2, JSON.stringify(puts))
  puts.length = 0
  await undone()
  check('Desfazer depois de voltar: a obra e o link do registro', puts.length === 1 && puts[0].workId === wA.id && puts[0].linkUrl === L1, JSON.stringify(puts))
  // Servidor mudou depois da escolha: vale o servidor
  await setField('Obra', wB.title)
  await typeIn('Link (opcional)', L2)
  await api('PUT', `/executions/${id}`, { description: null, completedAt: null, workId: wOld.id, linkUrl: 'https://exemplo.com/outro' })
  await go()
  check('servidor mudou depois da escolha: obra e link do servidor', (await value('Obra')) === wOld.title && (await value('Link (opcional)')) === 'https://exemplo.com/outro', `${await value('Obra')} ${await value('Link (opcional)')}`)
  // Memória de antes do O4b (sem os campos novos): continua valendo, obra e link do servidor
  await page.evaluate((k, v) => sessionStorage.setItem(k, v), MEMORY(id), JSON.stringify({ base: `${R.id}/${A.id}`, path: [R.id, A.id], phase: null, descriptionBase: null, description: 'da memória antiga', measureTexts: {} }))
  await go()
  check('memória de antes do O4b: descrição vale, obra e link do servidor', (await value('O que foi feito (opcional)')) === 'da memória antiga' && (await value('Obra')) === wOld.title && (await value('Link (opcional)')) === 'https://exemplo.com/outro', JSON.stringify(await ui()))
  // Obra lembrada que sumiu: a do servidor
  await page.evaluate((k, v) => sessionStorage.setItem(k, v), MEMORY(id), JSON.stringify({ base: `${R.id}/${A.id}`, path: [R.id, A.id], phase: null, descriptionBase: null, description: '', measureTexts: {}, workBase: wOld.id, workId: '00000000-0000-4000-8000-000000000000', linkBase: 'https://exemplo.com/outro', link: L2 }))
  await go()
  check('obra lembrada que sumiu: a do servidor (o link lembrado vale)', (await value('Obra')) === wOld.title && (await value('Link (opcional)')) === L2, `${await value('Obra')} ${await value('Link (opcional)')}`)
  await stopOpen()

  // ---------- 7. obra com treino gravado: reposiciona o treino (grava o caminho novo com ele)
  id = await openRecord({ rootTagId: W1.id, tagIds: [] })
  await api('PUT', `/executions/${id}/workout`, { workout: [{ exerciseId: exercise.id, sets: [{ reps: 8, weightKg: null }] }] })
  await fresh()
  puts.length = 0
  await setField('Obra', wT2.title)
  await page.waitForFunction(() => document.body.textContent.includes('Salvo'), { timeout: 5000 }).catch(() => {})
  await pause(600)
  row = await rowOf(id)
  const ex = (await pool.query('SELECT count(*)::int AS n FROM execution_exercises WHERE task_execution_id = $1', [id])).rows[0].n
  check('obra com outro caminho de treino: o treino vai junto pro caminho novo', puts.some((b) => b.rootTagId === W2.id && b.workout?.length === 1) && row.root_tag_id === W2.id && ex === 1, `${JSON.stringify(puts)} ${JSON.stringify(row)} ${ex}`)
  check('reposicionar o treino não grava a obra (vai no Finalizar)', row.work_id === null && puts.every((b) => !has(b, 'workId')), JSON.stringify(row))
  await stopOpen()

  // ---------- 8. toques (aparelho emulado): pôr a obra numa sessão iniciada sem obra
  id = await openRecord()
  const touch = await browser.newPage()
  await touch.setViewport({ width: 375, height: 800, hasTouch: true, isMobile: true })
  await touch.evaluateOnNewDocument(() => {
    window.__taps = { pointer: 0, change: 0 }
    addEventListener('pointerdown', () => { window.__taps.pointer++ }, true)
    addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') window.__taps.change++ }, true)
  })
  await touch.goto(url, { waitUntil: 'networkidle0' })
  await touch.evaluate(() => sessionStorage.clear())
  await touch.goto(url, { waitUntil: 'networkidle0' })
  await touch.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Finalizar'))
  await touch.evaluate(() => { window.__taps = { pointer: 0, change: 0 } })
  const select = await touch.evaluateHandle(() => [...document.querySelectorAll('main form label')].find((x) => x.querySelector('span')?.textContent === 'Obra').querySelector('select'))
  await select.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await select.tap()
  await pause(150)
  await touch.keyboard.press('Escape').catch(() => {})
  await select.evaluate((el, w) => { el.value = w; el.dispatchEvent(new Event('change', { bubbles: true })) }, wA.id)
  await pause(350)
  const btn = await touch.evaluateHandle(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Finalizar'))
  await btn.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const taps = await touch.evaluate(() => window.__taps)
  await btn.tap()
  await touch.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith('Desfazer')))
  await pause(300)
  const total = taps.pointer + taps.change + 1
  row = await rowOf(id)
  console.log(`TOQUES no painel (sessão iniciada sem obra): ${total}; previsto 3`)
  check('toques: a obra posta no painel é gravada no Finalizar', row.completed_at !== null && row.work_id === wA.id && row.root_tag_id === R.id, JSON.stringify(row))
  check('toques: 3, como previsto', total === 3, String(total))
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
