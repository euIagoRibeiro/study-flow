// O3b: seção "Obras" na tela de tags. Seed lido da API (contagens e linhas);
// o resto com dados próprios, prefixo "teste-o3", criados pela API e apagados no
// fim (obras pela diferença de contagem, limpeza.mjs). Toques: "teste-o3 mangá"
// em Leitura › Mangá (nunca título das anotações). Uso (raiz do repo):
//   node --env-file=backend/.env tests/telas/o3-obras.mjs
import pg from 'pg'
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME } from '../config.mjs'
import { deleteExecutions, deleteNewWorks, worksSnapshot } from '../limpeza.mjs'
const { Pool } = pg
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-o3'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const call = async (method, path, body) => {
  const res = await fetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const must = async (...args) => {
  const r = await call(...args)
  if (r.status >= 300) throw new Error(`${args[0]} ${args[1]}: ${r.status} ${JSON.stringify(r.body)}`)
  return r.body
}
const works = () => must('GET', '/works')
const minutes = (s) => { const m = Math.round(s / 60), h = Math.floor(m / 60); return h > 0 ? `${h}h${String(m % 60).padStart(2, '0')}` : `${m}min` }
const STATUS_ORDER = ['em_andamento', 'pausado', 'concluido', 'abandonado']
const FILTER = { em_andamento: 'Em andamento', pausado: 'Pausadas', concluido: 'Concluídas', abandonado: 'Abandonadas' }

const worksBefore = await worksSnapshot(pool)
// A API não devolve updated_at: lido do banco, pega um PATCH com os mesmos valores
const seedStamps = async () => JSON.stringify((await pool.query(`SELECT id, updated_at::text FROM works WHERE id::text LIKE '5eed%' ORDER BY id`)).rows)
const seedBefore = JSON.stringify((await works()).filter((w) => w.id.startsWith('5eed'))) + (await seedStamps())
const tagIds = []
const taskIds = []
let browser
try {
  // ---------- página e auxiliares
  browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 375, height: 900 })
  page.on('dialog', (d) => d.accept())
  const patches = []
  let worksGets = 0
  let inject = null // { status, error }: responde o próximo POST /works
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const url = req.url()
    if (req.method() === 'PATCH' && url.startsWith(`${API}/works/`)) patches.push(JSON.parse(req.postData()))
    if (req.method() === 'GET' && url === `${API}/works`) worksGets++
    if (inject && req.method() === 'POST' && url === `${API}/works`) {
      const { status, error } = inject
      inject = null
      return req.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error }) })
    }
    req.continue()
  })
  const settle = async () => { await page.waitForNetworkIdle({ idleTime: 250 }).catch(() => {}); await pause(150) }
  const open = async () => { await page.goto(`${APP}/tags`, { waitUntil: 'networkidle0' }); await settle() }
  const S = 'section[aria-label="Obras"]'
  const rows = () => page.evaluate((S) => [...document.querySelectorAll(`${S} ul > li`)].map((li) => ({
    title: li.querySelector('span')?.textContent ?? '', text: li.innerText.replace(/\s+/g, ' ').trim(),
  })), S)
  const row = async (title) => (await rows()).find((r) => r.title === title)
  const chips = () => page.evaluate(() => [...document.querySelectorAll('[aria-label="Filtrar obras por status"] button')].map((b) => ({
    label: b.childNodes[0].textContent.trim(), count: Number(b.querySelector('span')?.textContent), pressed: b.getAttribute('aria-pressed') === 'true',
  })))
  const pressed = async () => (await chips()).find((c) => c.pressed)?.label
  const clickChip = async (label) => {
    await page.evaluate((l) => [...document.querySelectorAll('[aria-label="Filtrar obras por status"] button')].find((b) => b.childNodes[0].textContent.trim() === l).click(), label)
    await pause(200)
  }
  const menu = async (label) => {
    await page.evaluate((l) => document.querySelector(`button[aria-label="${l}"]`).click(), label)
    await pause(150)
    return page.evaluate((l) => [...document.querySelectorAll(`[role="menu"][aria-label="${l}"] [role="menuitem"]`)].map((b) => ({
      label: b.innerText.split(/\n/)[0].trim(),
      text: b.innerText.replace(/\s+/g, ' ').trim(), disabled: b.getAttribute('aria-disabled') === 'true',
    })), label)
  }
  const pick = async (label, item) => {
    await menu(label)
    await page.evaluate((l, item) => [...document.querySelectorAll(`[role="menu"][aria-label="${l}"] [role="menuitem"]`)].find((b) => b.innerText.trim().startsWith(item)).click(), label, item)
    await settle()
  }
  const closeMenus = () => page.keyboard.press('Escape')
  const workForm = `${S} form`
  // Campo pelo começo do rótulo; sem ele, a bateria para dizendo qual (e não com
  // um erro do navegador ao escrever em nada)
  const field = async (label) => {
    const h = await page.evaluateHandle((F, label) => [...document.querySelectorAll(`${F} label`)].find((l) => l.querySelector('span')?.textContent.trim().startsWith(label))?.querySelector('input, select') ?? null, workForm, label)
    if ((await h.evaluate((el) => el === null))) throw new Error(`campo ${label} não existe`)
    return h
  }
  const hasField = (label) => page.evaluate((F, label) => [...document.querySelectorAll(`${F} label`)].some((l) => l.querySelector('span')?.textContent.trim().startsWith(label)), workForm, label)
  const type = async (label, value) => {
    const h = await field(label)
    await h.evaluate((el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
    await pause(60)
  }
  const choose = async (label, text) => {
    const h = await field(label)
    await h.evaluate((el, t) => {
      const option = [...el.options].find((o) => o.textContent === t)
      if (!option) throw new Error(`opção ${t} não existe`)
      el.value = option.value
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, text)
    await pause(80)
  }
  const valueOf = async (label) => (await field(label)).evaluate((el) => el.tagName === 'SELECT' ? el.selectedOptions[0]?.textContent : el.value)
  const optionsOf = async (label) => (await field(label)).evaluate((el) => [...el.options].map((o) => o.textContent))
  const formButton = async (text) => { await page.evaluate((F, t) => [...document.querySelectorAll(`${F} button`)].find((b) => b.textContent.trim() === t).click(), workForm, text); await settle() }
  const formError = () => page.evaluate((F) => document.querySelector(`${F} [role="alert"]`)?.textContent.trim() ?? '', workForm)
  const newWork = async () => {
    await page.evaluate((S) => [...document.querySelectorAll(`${S} button`)].find((b) => b.textContent.includes('Nova obra')).click(), S)
    await pause(150)
  }
  const formOpen = () => page.evaluate((F) => document.querySelector(F) !== null, workForm)

  // ---------- 1. seed
  await open()
  const seed = await works()
  const heads = await page.evaluate(() => [...document.querySelectorAll('h3')].map((h) => h.textContent.trim()).join())
  check('seção entre Seleções gerais e Exercícios', heads === 'Seleções gerais,Obras,Exercícios', heads)
  check('a seção tem data-works-block', await page.evaluate((S) => document.querySelector(S)?.hasAttribute('data-works-block'), S))
  const expectedChips = [...STATUS_ORDER.map((s) => `${FILTER[s]} ${seed.filter((w) => w.status === s).length}`), `Todas ${seed.length}`].join(', ')
  const seenChips = (await chips()).map((c) => `${c.label} ${c.count}`).join(', ')
  check('filtro: os 4 status e Todas, contagens da API', seenChips === expectedChips, `${seenChips} × ${expectedChips}`)
  check('filtro começa em "Em andamento"', (await pressed()) === 'Em andamento', await pressed())
  const byTitle = (a, b) => a.title.localeCompare(b.title, 'pt-BR', { numeric: true })
  const inProgress = seed.filter((w) => w.status === 'em_andamento').sort(byTitle).map((w) => w.title).join()
  check('só as em andamento, em ordem de título', (await rows()).map((r) => r.title).join() === inProgress, (await rows()).map((r) => r.title).join())
  const soul = await row('Soul Eater')
  check('Soul Eater: caminho, "6 de 113 capítulos · 2 registros", status', /Leitura › Mangá/.test(soul?.text) && soul.text.includes('6 de 113 capítulos · 2 registros') && soul.text.includes('Em andamento'), soul?.text)
  const ink = seed.find((w) => w.title === 'Inktober')
  const inkRow = await row('Inktober')
  check(`Inktober sem medida: "2 registros · ${minutes(ink.seconds)}"`, inkRow?.text.includes(`2 registros · ${minutes(ink.seconds)}`), inkRow?.text)
  await clickChip('Todas')
  const all = [...seed].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || byTitle(a, b)).map((w) => w.title).join()
  check('Todas: status na ordem, depois título', (await rows()).map((r) => r.title).join() === all, (await rows()).map((r) => r.title).join())
  await clickChip('Concluídas')
  const docker = await row('Curso de Docker')
  check('concluída com tarefa arquivada: chip e "Tarefa arquivada."', docker?.text.includes('Concluída') && docker.text.includes('Tarefa arquivada.'), docker?.text)
  await clickChip('Em andamento')
  let items = await menu('Mais ações da obra Soul Eater')
  const del = items.find((i) => i.label === 'Apagar')
  check('Apagar travado com registro: "Tem 2 registros. Mude o status em vez de apagar."', del?.disabled && del.text.includes('Tem 2 registros. Mude o status em vez de apagar.'), JSON.stringify(del))
  check('menu: Editar, os 3 outros status e Apagar', items.map((i) => i.label).join() === 'Editar,Pausar,Concluir,Abandonar,Apagar', items.map((i) => i.label).join())
  await closeMenus()

  // ---------- dados próprios
  const R = await must('POST', '/tags', { name: `${P} raiz` })
  const Sub = await must('POST', '/tags', { name: `${P} sub`, parentId: R.id })
  const Sub2 = await must('POST', '/tags', { name: `${P} sub2`, parentId: R.id })
  const Sub3 = await must('POST', '/tags', { name: `${P} sub3`, parentId: R.id })
  const F = await must('POST', '/tags', { name: `${P} livre` })
  tagIds.push(Sub.id, Sub2.id, Sub3.id, R.id, F.id)
  const T = await must('POST', '/tasks', { title: `${P} tarefa` })
  const T2 = await must('POST', '/tasks', { title: `${P} arquivável` })
  taskIds.push(T.id, T2.id)
  const mR = await must('POST', '/measures', { tagId: R.id, name: 'páginas', singular: 'página', allowsDecimal: false, kinds: [] })
  const mS = await must('POST', '/measures', { tagId: Sub.id, name: 'questões', singular: 'questão', allowsDecimal: false, kinds: [] })
  const mk = (title, extra) => must('POST', '/works', { title: `${P} ${title}`, defaultTaskId: T.id, ...extra })
  const wA = await mk('com total', { defaultTagId: R.id, measureId: mR.id, total: 10 })
  const wB = await mk('singular', { defaultTagId: R.id, measureId: mR.id })
  const wFree = await mk('livre obra', { defaultTagId: F.id })
  const wS = await mk('em sub', { defaultTagId: Sub.id, measureId: mS.id })
  const wM = await mk('medida mudou', { defaultTagId: Sub2.id, measureId: mR.id })
  const wT2 = await must('POST', '/works', { title: `${P} tarefa arq`, defaultTagId: Sub2.id, defaultTaskId: T2.id })
  const wClear = await mk('limpar', { defaultTagId: R.id, measureId: mR.id, total: 20, url: 'https://exemplo.com/a' })
  const wTotal = await mk('so total', { defaultTagId: R.id, measureId: mR.id, total: 30 })
  // Vão ficar com a medida antiga: a sub2 e a sub3 ganham medida própria depois
  const wOld = await mk('antiga', { defaultTagId: Sub2.id, measureId: mR.id, total: 40 })
  const wNew = await mk('vai nova', { defaultTagId: Sub2.id, measureId: mR.id, total: 25 })
  const wNone = await mk('vai nenhuma', { defaultTagId: Sub2.id, measureId: mR.id, total: 30 })
  await mk('recuo', { defaultTagId: Sub3.id, measureId: mR.id, total: 15 })
  const record = (workId, quantity) => must('POST', '/executions', { taskId: T.id, description: P, completedAt: new Date().toISOString(), rootTagId: R.id, tagIds: [], workId, measureValues: [{ kindId: null, quantity }] })
  await record(wA.id, 1)
  await record(wB.id, 1)
  await must('PATCH', `/tasks/${T2.id}`, { active: false })
  const mS2 = await must('POST', '/measures', { tagId: Sub2.id, name: 'capítulos', singular: 'capítulo', allowsDecimal: false, kinds: [] })
  // sub3: a mais próxima é arquivada; o servidor diz "trocada", a tela não acha
  // uma medida ativa diferente e cai pro texto sem nomes
  const mS3 = await must('POST', '/measures', { tagId: Sub3.id, name: 'arquivada', singular: 'arquivada', allowsDecimal: false, kinds: [] })
  await must('PATCH', `/measures/${mS3.id}`, { active: false })

  await open()
  check('com total: "1 de 10 páginas · 1 registro"', (await row(`${P} com total`))?.text.includes('1 de 10 páginas · 1 registro'), (await row(`${P} com total`))?.text)
  check('sem total, 1: singular "1 página · 1 registro"', (await row(`${P} singular`))?.text.includes('1 página · 1 registro'), (await row(`${P} singular`))?.text)
  check('measureMismatch "trocada": "Soma «páginas»; a medida deste caminho é «capítulos»."', (await row(`${P} medida mudou`))?.text.includes('Soma «páginas»; a medida deste caminho é «capítulos».'), (await row(`${P} medida mudou`))?.text)
  check('measureMismatch "sem medida" (escolha): sem marca de medida', !/Soma «|medida desta obra|medida deste caminho/.test((await row(`${P} tarefa arq`))?.text ?? 'x'), (await row(`${P} tarefa arq`))?.text)
  check('a conta da tela diverge (mais próxima arquivada): "A medida desta obra não é a do caminho."', (await row(`${P} recuo`))?.text.includes('A medida desta obra não é a do caminho.'), (await row(`${P} recuo`))?.text)
  check('tarefa arquivada: "Tarefa arquivada."', (await row(`${P} tarefa arq`))?.text.includes('Tarefa arquivada.'), (await row(`${P} tarefa arq`))?.text)
  check('measureMismatch nulo (em dia): sem marca', !/Soma «|medida desta obra|arquivad/.test((await row(`${P} com total`))?.text ?? 'x'))
  items = await menu(`Mais ações da obra ${P} com total`)
  check('Apagar travado com 1 registro (singular)', items.find((i) => i.label === 'Apagar')?.text.includes('Tem 1 registro. Mude o status'), JSON.stringify(items.find((i) => i.label === 'Apagar')))
  await closeMenus()
  items = await menu(`Mais ações de ${P} livre`)
  const tagDel = items.find((i) => i.label === 'Apagar')
  check('Apagar tag padrão de obra travado: "É o caminho padrão de 1 obra."', tagDel?.disabled && tagDel.text.includes('É o caminho padrão de 1 obra.'), JSON.stringify(tagDel))
  await closeMenus()
  await page.evaluate((n) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === n).click(), `${P} raiz`)
  await pause(200)
  await pick(`Mais ações de ${P} raiz › ${P} sub`, 'Editar medida')
  const measureText = await page.evaluate(() => document.querySelector('form[aria-label]')?.closest('li')?.innerText ?? document.body.innerText)
  const measureDelete = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Apagar medida'))
  check('Apagar medida de obra travado: "É a medida de 1 obra" e sem o botão', measureText.includes('É a medida de 1 obra') && !measureDelete, `${measureDelete} ${measureText.slice(0, 160)}`)
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Fechar' || b.textContent.trim() === 'Cancelar')?.click())
  await pause(150)

  // ---------- 1b. salvar sem mexer não manda pedido nenhum (seed, medida antiga,
  // tarefa arquivada, caminho arquivado)
  await must('PATCH', `/tags/${F.id}`, { active: false })
  try {
    await open()
    await clickChip('Todas')
    patches.length = 0
    const untouched = [...seed.map((w) => w.title), `${P} antiga`, `${P} tarefa arq`, `${P} livre obra`]
    const sent = []
    for (const title of untouched) {
      await clickChip('Todas') // um pedido indevido muda o filtro: a próxima obra continua à vista
      await pick(`Mais ações da obra ${title}`, 'Editar')
      await formButton('Salvar')
      if ((await formOpen()) || patches.length > 0) sent.push(`${title}: ${patches.length ? JSON.stringify(patches.at(-1)) : 'formulário aberto'}`)
      patches.length = 0
    }
    check(`salvar sem mexer não manda pedido (${untouched.length} obras: seed, antiga, tarefa e caminho arquivados)`, sent.length === 0, sent.join(' | '))
  } finally {
    await must('PATCH', `/tags/${F.id}`, { active: true })
  }
  check('a tag arquivada pro teste voltou ao estado de antes', (await must('GET', '/tags')).find((t) => t.id === F.id)?.active === true)

  // ---------- 1c. medida antiga no formulário
  await open()
  await pick(`Mais ações da obra ${P} antiga`, 'Editar')
  check('antiga: opções na ordem, a antiga escolhida', (await optionsOf('Medida')).join(' | ') === 'páginas (medida antiga) | capítulos | Nenhuma' && (await valueOf('Medida')) === 'páginas (medida antiga)', (await optionsOf('Medida')).join(' | '))
  const phraseOf = () => page.evaluate((F) => [...document.querySelectorAll(`${F} p`)].map((p) => p.textContent.trim()).find((t) => t.includes('medida')) ?? '', workForm)
  check('antiga: a frase com os dois nomes', (await phraseOf()) === 'Esta obra soma «páginas», e a medida deste caminho é «capítulos». Escolha qual somar.', await phraseOf())
  check('antiga: o total gravado aparece', (await valueOf('Total')) === '40', await valueOf('Total'))
  await choose('Medida', 'capítulos')
  check('trocar pra nova esvazia o total', (await valueOf('Total')) === '', await valueOf('Total'))
  await choose('Medida', 'páginas (medida antiga)')
  check('voltar pra antiga devolve o total gravado', (await valueOf('Total')) === '40', await valueOf('Total'))
  await choose('Medida', 'Nenhuma')
  check('Nenhuma: o Total some', !(await hasField('Total')))
  await choose('Medida', 'páginas (medida antiga)')
  patches.length = 0
  await choose('Status', 'Pausada')
  await formButton('Salvar')
  const keptOld = (await works()).find((w) => w.id === wOld.id)
  check('antiga, só o status: manda exatamente {status}', JSON.stringify(patches.at(-1)) === '{"status":"pausado"}', JSON.stringify(patches.at(-1)))
  check('antiga, só o status: medida e total gravados mantidos', keptOld.status === 'pausado' && keptOld.measureId === mR.id && keptOld.total === 40, JSON.stringify(keptOld))
  await clickChip('Todas')
  patches.length = 0
  await pick(`Mais ações da obra ${P} vai nova`, 'Editar')
  await choose('Medida', 'capítulos')
  await formButton('Salvar')
  check('Nova: manda {measureId: <nova>, total: null}', JSON.stringify(patches.at(-1)) === JSON.stringify({ measureId: mS2.id, total: null }), JSON.stringify(patches.at(-1)))
  await open()
  const toNew = (await works()).find((w) => w.id === wNew.id)
  check('Nova, depois de recarregar: medida nova, total vazio, em dia', toNew.measureId === mS2.id && toNew.total === null && toNew.measureCurrent === true, JSON.stringify(toNew))
  await must('PATCH', `/works/${wNew.id}`, { measureId: null }) // solta a medida da sub2 (a seção 4 a apaga)
  await open()
  patches.length = 0
  await pick(`Mais ações da obra ${P} vai nenhuma`, 'Editar')
  await choose('Medida', 'Nenhuma')
  await formButton('Salvar')
  check('Nenhuma: manda {measureId: null, total: null}', JSON.stringify(patches.at(-1)) === '{"measureId":null,"total":null}', JSON.stringify(patches.at(-1)))
  await open()
  const toNone = (await works()).find((w) => w.id === wNone.id)
  check('Nenhuma, depois de recarregar: medida e total vazios', toNone.measureId === null && toNone.total === null, JSON.stringify(toNone))
  await pick(`Mais ações da obra ${P} tarefa arq`, 'Editar')
  check('sem medida (escolha): opções "capítulos | Nenhuma", Nenhuma escolhida, sem frase', (await optionsOf('Medida')).join(' | ') === 'capítulos | Nenhuma' && (await valueOf('Medida')) === 'Nenhuma' && (await phraseOf()) === '', `${(await optionsOf('Medida')).join(' | ')} / ${await valueOf('Medida')} / ${await phraseOf()}`)
  await formButton('Cancelar')
  await pick(`Mais ações da obra ${P} recuo`, 'Editar')
  check('recuo no formulário: frase sem nomes, só a antiga e Nenhuma', (await phraseOf()) === 'A medida desta obra não é a do caminho.' && (await optionsOf('Medida')).join(' | ') === 'páginas (medida antiga) | Nenhuma', `${await phraseOf()} / ${(await optionsOf('Medida')).join(' | ')}`)
  await formButton('Cancelar')
  await open()

  // ---------- 2. recarga: marca nova sem remontar o formulário aberto
  await newWork()
  await type('Título', `${P} digitado`)
  await page.evaluate((F) => { document.querySelector(F).dataset.marca = 'mesmo' }, workForm)
  const getsBefore = worksGets
  await pick(`Mais ações de ${P} livre`, 'Arquivar')
  await settle()
  check('arquivar tag recarrega as obras', worksGets > getsBefore, `${getsBefore} → ${worksGets}`)
  check('marca "Caminho arquivado." sem recarregar a página', (await row(`${P} livre obra`))?.text.includes('Caminho arquivado.'), (await row(`${P} livre obra`))?.text)
  const kept = await page.evaluate((F) => ({ same: document.querySelector(F)?.dataset.marca === 'mesmo', title: document.querySelector(`${F} input`)?.value }), workForm)
  check('recarga não remonta o formulário: o título digitado sobrevive', kept.same && kept.title === `${P} digitado`, JSON.stringify(kept))
  await page.evaluate(() => { const box = [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Mostrar arquivadas'))?.querySelector('input'); if (box && !box.checked) box.click() })
  await pause(150)
  await pick(`Mais ações de ${P} livre`, 'Reativar')
  await settle()
  check('reativar tira a marca', !(await row(`${P} livre obra`))?.text.includes('Caminho arquivado.'), (await row(`${P} livre obra`))?.text)
  check('o formulário continua aberto e com o título', (await formOpen()) && (await valueOf('Título')) === `${P} digitado`)

  // ---------- 3. erros no formulário
  await type('Título', '')
  await formButton('Criar')
  check('título vazio: "Escreva um título."', (await formError()) === 'Escreva um título.', await formError())
  await type('Título', `${P} erros`)
  await choose('Contexto', `${P} livre`)
  check('caminho sem medida: sem campo de medida nem de total', !(await hasField('Medida')) && !(await hasField('Total')))
  const taskOptions = await optionsOf('Tarefa')
  check('tarefa arquivada não é oferecida numa obra nova', taskOptions.includes(`${P} tarefa`) && !taskOptions.some((o) => o.startsWith(`${P} arquivável`)), taskOptions.filter((o) => o.startsWith(P)).join())
  await choose('Tarefa', `${P} tarefa`)
  await type('Link', 'ftp://exemplo.com')
  await formButton('Criar')
  check('link inválido: frase do campo', (await formError()) === 'Link: um endereço que começa com http:// ou https://.', await formError())
  await type('Link', '')
  await choose('Contexto', `${P} raiz`)
  check('caminho com medida: a medida mais próxima vem escolhida e o total aparece', (await hasField('Medida')) && (await valueOf('Medida')) === 'páginas' && (await hasField('Total')), String(await hasField('Total')))
  await type('Total', '0')
  await formButton('Criar')
  check('total zero: "Total: número inteiro maior que zero."', (await formError()) === 'Total: número inteiro maior que zero.', await formError())
  await type('Total', '')
  // Mensagens reais da API, respondidas no lugar do POST da tela
  const real = {
    title: (await call('POST', '/works', { title: '  ', defaultTagId: F.id, defaultTaskId: T.id })).body.error,
    url: (await call('POST', '/works', { title: `${P} x`, defaultTagId: F.id, defaultTaskId: T.id, url: 'ftp://x' })).body.error,
    total: (await call('POST', '/works', { title: `${P} x`, defaultTagId: R.id, defaultTaskId: T.id, measureId: mR.id, total: 0 })).body.error,
  }
  for (const [key, expected] of [['title', 'Escreva um título.'], ['url', 'Link: um endereço que começa com http:// ou https://.'], ['total', 'Total: número maior que zero.']]) {
    inject = { status: 400, error: real[key] }
    await formButton('Criar')
    check(`erro da API "${real[key]}" vira "${expected}"`, (await formError()) === expected, await formError())
  }
  await must('POST', '/works', { title: `${P} repetida`, defaultTagId: R.id, defaultTaskId: T.id })
  await type('Título', `${P} repetida`)
  await choose('Medida', 'Nenhuma')
  await formButton('Criar')
  check('409 da API aparece no formulário', (await formError()) === 'Já existe uma obra com esse título nesse caminho', await formError())

  // ---------- 4. medida acompanha o caminho; total só com a mesma medida
  await choose('Contexto', `${P} raiz`)
  check('escolher o caminho preenche a medida mais próxima', (await valueOf('Medida')) === 'páginas', await valueOf('Medida'))
  await type('Total', '50')
  await choose(`Em ${P} raiz`, `${P} sub2`)
  check('subtag que ganhou medida própria (capítulos): a medida troca', (await valueOf('Medida')) === 'capítulos', await valueOf('Medida'))
  check('medida mudou: o total antigo some', (await valueOf('Total')) === '', await valueOf('Total'))
  // Sem a medida da sub2, ela volta a herdar páginas (o caso "mesma medida")
  await must('DELETE', `/measures/${mS2.id}`)
  await formButton('Cancelar')
  await open()
  await newWork()
  await type('Título', `${P} mesma`)
  await choose('Contexto', `${P} raiz`)
  await type('Total', '50')
  await choose(`Em ${P} raiz`, `${P} sub2`)
  check('mesma medida (herdada): o total fica', (await valueOf('Medida')) === 'páginas' && (await valueOf('Total')) === '50', `${await valueOf('Medida')} ${await valueOf('Total')}`)
  await choose(`Em ${P} raiz`, `${P} sub`)
  check('subtag com medida própria: medida nova e total vazio', (await valueOf('Medida')) === 'questões' && (await valueOf('Total')) === '', `${await valueOf('Medida')} ${await valueOf('Total')}`)
  await formButton('Cancelar')

  // ---------- 5. criar e editar: o filtro acompanha o status
  await newWork()
  await type('Título', `${P} pausada`)
  await choose('Contexto', `${P} livre`)
  await choose('Tarefa', `${P} tarefa`)
  await choose('Status', 'Pausada')
  await formButton('Criar')
  check('criada pausada: o filtro vai pra "Pausadas" e ela aparece', (await pressed()) === 'Pausadas' && Boolean(await row(`${P} pausada`)), `${await pressed()}`)
  await pick(`Mais ações da obra ${P} pausada`, 'Editar')
  await choose('Status', 'Concluída')
  await formButton('Salvar')
  check('editada pra concluída: o filtro vai pra "Concluídas"', (await pressed()) === 'Concluídas' && Boolean(await row(`${P} pausada`)), `${await pressed()}`)
  await pick(`Mais ações da obra ${P} pausada`, 'Retomar')
  const resumed = (await works()).find((w) => w.title === `${P} pausada`)
  check('atalho "Retomar": status gravado e o filtro vai pra "Em andamento"', resumed?.status === 'em_andamento' && (await pressed()) === 'Em andamento' && Boolean(await row(`${P} pausada`)), `${resumed?.status} ${await pressed()}`)

  // ---------- 6. editar apagando link, total e medida: grava null
  patches.length = 0
  await pick(`Mais ações da obra ${P} limpar`, 'Editar')
  await type('Link', '')
  await choose('Medida', 'Nenhuma')
  check('medida "Nenhuma": o total some do formulário', !(await hasField('Total')))
  await formButton('Salvar')
  const sentClear = patches.at(-1) ?? {}
  check('o PATCH manda null em link, medida e total', sentClear.url === null && sentClear.measureId === null && sentClear.total === null, JSON.stringify(sentClear))
  await open()
  const cleared = (await works()).find((w) => w.id === wClear.id)
  check('depois de recarregar: link, medida e total vazios', cleared.url === null && cleared.measureId === null && cleared.total === null, JSON.stringify(cleared))
  check('linha sem medida', (await row(`${P} limpar`))?.text.includes('0 registros'), (await row(`${P} limpar`))?.text)
  await pick(`Mais ações da obra ${P} so total`, 'Editar')
  await type('Total', '')
  await formButton('Salvar')
  const onlyTotal = (await works()).find((w) => w.id === wTotal.id)
  check('apagar só o total: total null, medida mantida', onlyTotal.total === null && onlyTotal.measureId === mR.id && patches.at(-1)?.total === null, JSON.stringify(patches.at(-1)))

  // ---------- 7. sem rascunho
  await newWork()
  await type('Título', `${P} rascunho`)
  const storage = () => page.evaluate(() => JSON.stringify([Object.keys(sessionStorage).sort(), Object.keys(localStorage).filter((k) => k !== 'studyflow:tags-abertas').sort()]))
  const kept1 = await storage()
  await open()
  check('sem rascunho: recarregar fecha o formulário, nada guardado', !(await formOpen()) && (await storage()) === kept1, `${await formOpen()} ${kept1} → ${await storage()}`)

  // ---------- 8. entrar na tela recarrega (registro feito noutra tela)
  await page.evaluate(() => document.querySelector('header a[href="/"], a[href="/"]').click())
  await page.waitForFunction(() => location.pathname === '/')
  await record(wB.id, 2)
  await page.evaluate(() => document.querySelector('a[href="/tags"]').click())
  await page.waitForFunction(() => location.pathname === '/tags')
  await settle()
  check('voltar pra tela de tags (sem recarregar a página) mostra o registro novo', (await row(`${P} singular`))?.text.includes('3 páginas · 2 registros'), (await row(`${P} singular`))?.text)

  // ---------- 9. toques: "teste-o3 mangá" em Leitura › Mangá
  const touch = await browser.newPage()
  await touch.setViewport({ width: 375, height: 800, hasTouch: true, isMobile: true })
  touch.on('dialog', (d) => d.accept())
  await touch.evaluateOnNewDocument(() => {
    window.__taps = { pointer: 0, change: 0 }
    addEventListener('pointerdown', () => { window.__taps.pointer++ }, true)
    addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') window.__taps.change++ }, true)
  })
  await touch.goto(`${APP}/tags`, { waitUntil: 'networkidle0' })
  await pause(300)
  await touch.evaluate(() => { window.__taps = { pointer: 0, change: 0 } })
  const tapEl = async (fn, arg) => {
    const h = await touch.evaluateHandle(fn, arg)
    await h.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await h.tap()
    await pause(150)
    return h
  }
  const tField = (label) => tapEl((label) => [...document.querySelectorAll('section[aria-label="Obras"] form label')].find((l) => l.querySelector('span')?.textContent.trim().startsWith(label)).querySelector('input, select'), label)
  const tChoose = async (label, text) => {
    const h = await tField(label)
    await touch.keyboard.press('Escape').catch(() => {})
    await h.evaluate((el, t) => { el.value = [...el.options].find((o) => o.textContent === t).value; el.dispatchEvent(new Event('change', { bubbles: true })) }, text)
    await pause(250)
  }
  await tapEl(() => [...document.querySelectorAll('section[aria-label="Obras"] button')].find((b) => b.textContent.includes('Nova obra')))
  await tField('Título')
  await touch.keyboard.type(`${P} mangá`)
  await tChoose('Contexto', 'Leitura')
  await tChoose('Em Leitura', 'Mangá')
  const autoMeasure = await touch.evaluate(() => [...document.querySelectorAll('section[aria-label="Obras"] form label')].find((l) => l.textContent.startsWith('Medida'))?.querySelector('select')?.selectedOptions[0]?.textContent)
  await tChoose('Tarefa', 'Ler')
  await tField('Total')
  await touch.keyboard.type('113')
  const taps = await touch.evaluate(() => window.__taps)
  await tapEl(() => [...document.querySelectorAll('section[aria-label="Obras"] form button')].find((b) => b.textContent.trim() === 'Criar'))
  await touch.waitForNetworkIdle({ idleTime: 300 })
  const total = taps.pointer + taps.change + 1
  console.log(`TOQUES cadastrar "${P} mangá": medido ${total} (toques ${taps.pointer + 1}, listas ${taps.change}), previsto 10`)
  const manga = (await works()).find((w) => w.title === `${P} mangá`)
  const seedIds = Object.fromEntries((await must('GET', '/tasks')).map((t) => [t.title, t.id]))
  check('toques: medida preenchida sozinha (capítulos)', autoMeasure === 'capítulos', autoMeasure)
  check('toques: gravou Leitura › Mangá, Ler, capítulos, 113, em andamento',
    manga && manga.defaultTagId === '5eed0000-0000-4000-9000-000000000910' && manga.defaultTaskId === seedIds.Ler && manga.measureId === '5eed0000-0000-4000-a000-000000000008' && manga.total === 113 && manga.status === 'em_andamento', JSON.stringify(manga))
  const mangaRow = await touch.evaluate((t) => [...document.querySelectorAll('section[aria-label="Obras"] ul > li')].find((li) => li.querySelector('span')?.textContent === t)?.innerText.replace(/\s+/g, ' '), `${P} mangá`)
  check('toques: aparece "0 de 113 capítulos · 0 registros"', mangaRow?.includes('0 de 113 capítulos · 0 registros'), mangaRow)
  check('toques: 10, como previsto', total === 10, String(total))
  await touch.close()
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser?.close()
  if (taskIds.length) {
    const ids = (await pool.query('SELECT id FROM task_executions WHERE task_id = ANY($1::uuid[])', [taskIds])).rows.map((r) => r.id)
    await deleteExecutions(pool, ids)
  }
  const delta = await deleteNewWorks(pool, worksBefore)
  await pool.query('DELETE FROM measures WHERE tag_id = ANY($1::uuid[])', [tagIds])
  for (const id of tagIds) await pool.query('DELETE FROM tags WHERE id = $1', [id])
  if (taskIds.length) await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [taskIds])
  const left = await pool.query(`SELECT (SELECT count(*) FROM tags WHERE name LIKE '${P}%')::int + (SELECT count(*) FROM tasks WHERE title LIKE '${P}%')::int AS n`)
  check('obras: diferença de contagem 0 depois da limpeza', delta === 0, String(delta))
  check('tags e tarefas de teste apagadas', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  const seedAfter = JSON.stringify((await (await fetch(`${API}/works`)).json()).filter((w) => w.id.startsWith('5eed'))) + (await seedStamps())
  check('obras do seed iguais às de antes', seedAfter === seedBefore)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
