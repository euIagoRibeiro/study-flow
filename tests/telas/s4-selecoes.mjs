// S4: seleções na tela de tags. Leitura (S4a): linhas, seção geral, arquivadas,
// aviso no formulário "Nova tag" e a trava de apagar. O seed é lido da API; o
// que ele não tem (arquivada, subtag) entra injetado na resposta de /selections.
// S4b: criar e editar, com tudo o que cria prefixado "s4b" e apagado no fim
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? ` (${detail})` : ''}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const get = async (p) => (await apiFetch(API + p)).json()
const send = async (method, p, body) => {
  const r = await apiFetch(API + p, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`)
  return r.status === 204 ? null : r.json()
}

const lines = (page) => page.evaluate(() =>
  [...document.querySelectorAll('main p, p')].map((p) => p.textContent.trim()).filter((t) => t.startsWith('Seleção:')))
const general = (page) => page.evaluate(() =>
  [...document.querySelectorAll('section[aria-label="Seleções gerais"] li')].map((li) => li.textContent.trim()))
const hasText = (page, text) => page.evaluate((t) => document.body.innerText.includes(t), text)
const clickButton = (page, text) => page.evaluate((t) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t).click(), text)
const menuCount = (page) => page.evaluate(() => document.querySelectorAll('[aria-label^="Mais ações de "]').length)

let browser
let testTag
let subTag
let leafTag
let archivedTag
let dialogs = 0
let acceptDialogs = false
let deny = null
const writes = []
const bodies = []
const before = JSON.stringify((await get('/selections')).map((s) => [s.id, s.name, s.multiple, s.active, s.options.length]).sort())
try {
  const tags = await get('/tags')
  const selections = await get('/selections')
  const activeRoots = tags.filter((t) => !t.parentId && t.active)
  testTag = await send('POST', '/tags', { name: 's4 teste' })
  const ingles = tags.find((t) => t.name === 'Inglês')

  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 375, height: 900 })
  page.on('dialog', (d) => {
    dialogs += 1
    return acceptDialogs ? d.accept() : d.dismiss()
  })
  let extra = []
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const preflight = req.method() === 'OPTIONS'
    if (!preflight && req.method() !== 'GET' && req.url().startsWith(API)) {
      writes.push(`${req.method()} ${req.url().slice(API.length)}`)
      if (req.postData()) bodies.push(req.postData())
    }
    if (deny && req.url() === deny.url && req.method() === 'DELETE') {
      req.respond({ status: 409, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: deny.error }) })
    } else if (req.method() === 'GET' && req.url() === `${API}/selections` && extra.length > 0) {
      req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify([...selections, ...extra]) })
    } else req.continue()
  })
  const open = () => page.goto(`${APP}/tags`, { waitUntil: 'networkidle0' })

  // --- seed
  await open()
  const seen = await lines(page)
  const expected = selections.filter((s) => s.tagId !== null && s.active).length
  check('uma linha por seleção de tag ativa', expected > 0 && seen.length === expected, `${seen.length} de ${expected}`)
  check('única: nome e opções em ordem', seen.includes('Seleção: Meio (digital, tradicional)'), seen.join(' | '))
  check('múltipla marcada com "várias"', seen.includes('Seleção: Habilidade (escuta, leitura, escrita, fala, pensamento) · várias'))
  check('opção arquivada fora da linha', seen.includes('Seleção: Instrumento (guitarra)'))
  check('seção geral com a Natureza', (await general(page)).join() === 'Natureza (estudo, pesquisa, prática, criação, lazer)', (await general(page)).join())
  const order = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('h3')].map((h) => h.textContent.trim())
    const tree = document.querySelector('ul.gap-2\\.5')
    const section = document.querySelector('section[aria-label="Seleções gerais"]')
    return { heads, afterTree: Boolean(tree.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING) }
  })
  check('seção entre a árvore e Exercícios (Obras no meio, O3b)', order.afterTree && order.heads.join() === 'Seleções gerais,Obras,Exercícios', order.heads.join())
  check('controle negativo: um ⋯ por contexto, nenhum a mais', (await menuCount(page)) === activeRoots.length + 1,
    `${await menuCount(page)} de ${activeRoots.length + 1}`)

  // --- aviso: só no formulário de nova tag
  const notice = `Você já tem ${activeRoots.length + 1} contextos. Antes de criar outro: se é um assunto, pode ser subtag de um deles; se é como, onde ou com o quê, pode ser seleção.`
  check('aviso fora da tela sem o formulário', !(await hasText(page, 'contextos.')))
  await clickButton(page, 'Nova tag')
  await pause(200)
  check('aviso no formulário "Nova tag"', await hasText(page, notice))
  await clickButton(page, 'Cancelar')
  await pause(200)
  check('Cancelar leva o aviso junto', !(await hasText(page, 'contextos.')))
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Subtags de Idiomas').click())
  await pause(200)
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Mais ações de Idiomas"]')][0].click())
  await pause(200)
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Nova subtag').click())
  await pause(200)
  check('sem aviso na nova subtag', !(await hasText(page, 'contextos.')))
  await clickButton(page, 'Cancelar')

  // --- injetado: arquivadas, subtag, trava de apagar
  const option = (name, active = true, position = 1) => ({ id: crypto.randomUUID(), name, position, active })
  extra = [
    { id: crypto.randomUUID(), tagId: testTag.id, name: 'Só arquivada', multiple: true, active: false, options: [option('x')] },
    { id: crypto.randomUUID(), tagId: ingles.id, name: 'Na subtag', multiple: false, active: true, options: [option('a'), option('b', true, 2)] },
    { id: crypto.randomUUID(), tagId: null, name: 'Geral arquivada', multiple: false, active: false, options: [option('z', false)] },
  ]
  await open()
  check('arquivada escondida na árvore', !(await lines(page)).some((l) => l.includes('Só arquivada')))
  check('arquivada escondida na seção geral', !(await general(page)).some((l) => l.includes('Geral arquivada')))
  check('subtag mostra a própria seleção', (await lines(page)).includes('Seleção: Na subtag (a, b)'), (await lines(page)).join(' | '))
  await page.evaluate(() => [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Mostrar arquivadas')).querySelector('input').click())
  await pause(200)
  check('com "Mostrar arquivadas", a da árvore aparece', (await lines(page)).includes('Seleção: Só arquivada (x) · várias · arquivada'))
  check('com "Mostrar arquivadas", a geral aparece, sem opção arquivada', (await general(page)).includes('Geral arquivada · arquivada'), (await general(page)).join(' | '))
  await page.evaluate(() => [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Mostrar arquivadas')).querySelector('input').click())
  await pause(200)
  await page.evaluate(() => document.querySelector('[aria-label="Mais ações de s4 teste"]').click())
  await pause(200)
  const del = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith('Apagar'))
    return { text: b.textContent.trim(), disabled: b.getAttribute('aria-disabled') === 'true' }
  })
  check('Apagar travado por seleção, mesmo arquivada e escondida', del.disabled && del.text.includes('Declara uma seleção: apague a seleção antes.'), JSON.stringify(del))
  extra = []

  // --- S4b: criar e editar
  subTag = await send('POST', '/tags', { name: 's4 sub', parentId: testTag.id })
  leafTag = await send('POST', '/tags', { name: 's4 neto', parentId: subTag.id })
  const waitFor = (fn, arg) => page.waitForFunction(fn, { timeout: 5000 }, arg)
  const clickLabel = async (label) => {
    await page.evaluate((l) => document.querySelector(`[aria-label="${l}"]`).click(), label)
    await pause(150)
  }
  const clickItem = async (text) => {
    await page.evaluate((t) => [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.trim().startsWith(t)).click(), text)
    await pause(150)
  }
  const item = (text) => page.evaluate((t) => {
    const b = [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim().startsWith(t))
    return b ? { text: b.textContent.trim(), disabled: b.getAttribute('aria-disabled') === 'true' } : null
  }, text)
  const closeMenu = async () => { await page.keyboard.press('Escape'); await pause(100) }
  const form = (label) => `form[aria-label="${label}"]`
  const type = async (selector, text) => {
    await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), selector)
    await page.click(selector, { clickCount: 3 })
    await page.keyboard.press('Backspace')
    await page.keyboard.type(text)
  }
  const nameField = (f) => `${f} label:first-of-type input[type="text"]`
  const value = (selector) => page.$eval(selector, (el) => el.value)
  const submit = async (f, text) => {
    await page.evaluate((s, t) => [...document.querySelector(s).querySelectorAll('button')].find((b) => b.textContent.trim() === t).click(), f, text)
    await pause(350)
  }
  const inFieldset = (f, text) => page.evaluate((s, t) => Boolean(document.querySelector(`${s} fieldset`)?.textContent.includes(t)), f, text)
  const outsideFieldset = (f, text) => page.evaluate((s, t) => {
    const copy = document.querySelector(s).cloneNode(true)
    copy.querySelector('fieldset')?.remove()
    return copy.textContent.includes(t)
  }, f, text)
  const bySelectionName = async (name) => (await get('/selections')).find((s) => s.name === name)
  const openAll = async () => {
    await open()
    await page.waitForSelector('[aria-label="Subtags de s4 teste"]')
    // A tela lembra o que estava aberto: clicar de novo fecharia
    for (const label of ['Subtags de s4 teste', 'Subtags de s4 sub']) {
      await page.evaluate((l) => {
        const button = document.querySelector(`[aria-label="${l}"]`)
        if (button.getAttribute('aria-expanded') === 'false') button.click()
      }, label)
      await pause(150)
    }
  }
  const newAt = async (menu, label, name, options) => {
    await clickLabel(menu)
    await clickItem('Nova seleção')
    await page.waitForSelector(form(label))
    await type(nameField(form(label)), name)
    for (const [i, option] of options.entries()) {
      if (i > 0) await submit(form(label), 'Opção')
      await type(`${form(label)} input[aria-label="Opção ${i + 1}"]`, option)
    }
    await submit(form(label), 'Criar')
    await page.waitForFunction((s) => !document.querySelector(s), { timeout: 5000 }, form(label))
  }
  const openEdit = async (name) => {
    await clickLabel(`Mais ações da seleção ${name}`)
    await clickItem('Editar')
    await page.waitForSelector(form(`Seleção ${name}`))
    return form(`Seleção ${name}`)
  }

  await openAll()
  await newAt('Mais ações de s4 teste', 'Nova seleção em s4 teste', 's4b raiz', ['um', 'dois'])
  await newAt('Mais ações de s4 teste › s4 sub', 'Nova seleção em s4 sub', 's4b sub', ['tres'])
  await newAt('Mais ações de s4 teste › s4 sub › s4 neto', 'Nova seleção em s4 neto', 's4b neto', ['quatro'])
  let list = await get('/selections')
  const named = (n) => list.find((s) => s.name === n)
  check('criar na raiz, com as opções em ordem', named('s4b raiz')?.tagId === testTag.id && named('s4b raiz').options.map((o) => o.name).join() === 'um,dois')
  check('criar na subtag', named('s4b sub')?.tagId === subTag.id)
  check('criar no neto', named('s4b neto')?.tagId === leafTag.id)
  check('a linha nova aparece sem recarregar', (await lines(page)).includes('Seleção: s4b neto (quatro)'), (await lines(page)).join(' | '))

  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Nova seleção geral').click())
  await page.waitForSelector(form('Nova seleção geral'))
  const generalForm = form('Nova seleção geral')
  check('nota da global', (await hasText(page, 'Vale em todos os registros, com ou sem tag. Também valem aqui: Natureza (geral).')))
  await submit(generalForm, 'Criar')
  check('sem nome: recusa na tela', await outsideFieldset(generalForm, 'Escreva o nome da seleção.'))
  await type(nameField(generalForm), 's4b geral')
  await submit(generalForm, 'Criar')
  check('sem opção: recusa na tela', await outsideFieldset(generalForm, 'Escreva pelo menos uma opção.'))
  const opt1 = `${generalForm} input[aria-label="Opção 1"]`
  await type(opt1, ' Azul')
  await page.keyboard.press('Enter')
  await pause(150)
  check('Enter na opção acrescenta outra, sem enviar', (await page.$(`${generalForm} input[aria-label="Opção 2"]`)) !== null)
  const focused = await page.evaluate(() => document.activeElement.getAttribute('aria-label'))
  check('o foco vai pro campo novo', focused === 'Opção 2', focused)
  await page.keyboard.type('azul ')
  writes.length = 0
  await submit(generalForm, 'Criar')
  check('repetida (maiúscula e espaço): diz qual', await outsideFieldset(generalForm, 'Opção repetida: azul.'))
  check('sem nome, sem opção e repetida: nenhum pedido', writes.length === 0, writes.join())
  check('a seleção nasce só no Criar', !(await bySelectionName('s4b geral')))
  check('maxLength do nome = API', (await page.$eval(nameField(generalForm), (e) => e.maxLength)) === 30)
  check('maxLength da opção = API', (await page.$eval(opt1, (e) => e.maxLength)) === 30)
  for (let i = 2; i < 30; i++) await page.evaluate((s) => [...document.querySelector(s).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Opção').click(), generalForm)
  await pause(150)
  check('com 30 campos, "+ Opção" some e diz o limite', !(await page.evaluate((s) => [...document.querySelector(s).querySelectorAll('button')].some((b) => b.textContent.trim() === 'Opção'), generalForm)) &&
    await inFieldset(generalForm, '30 opções, o limite.') &&
    (await page.$$(`${generalForm} input[aria-label^="Opção "]`)).length === 30)
  await page.focus(`${generalForm} input[aria-label="Opção 30"]`)
  await page.keyboard.press('Enter')
  await pause(150)
  check('Enter no 30º não passa do teto', (await page.$$(`${generalForm} input[aria-label^="Opção "]`)).length === 30)
  await type(`${generalForm} input[aria-label="Opção 2"]`, 'verde')
  writes.length = 0
  await submit(generalForm, 'Criar')
  await waitFor((s) => !document.querySelector(s), generalForm)
  check('criar sai num POST só', writes.join() === 'POST /selections', writes.join())
  check('geral criada, em branco descartadas', (await bySelectionName('s4b geral'))?.options.map((o) => o.name).join() === 'Azul,verde')

  // --- notas
  const sub = await openEdit('s4b sub')
  check('nota soma ancestrais e geral, sem ela mesma',
    await page.$eval(sub, (f) => f.querySelector('p').textContent) === 'Vale para s4 sub e as subtags. Soma com: s4b raiz (s4 teste). Também valem aqui: Natureza (geral), s4b geral (geral).',
    await page.$eval(sub, (f) => f.querySelector('p').textContent))
  await submit(sub, 'Fechar')
  const leaf = await openEdit('s4b neto')
  check('no neto, sem "subtags"', (await page.$eval(leaf, (f) => f.querySelector('p').textContent)).startsWith('Vale para s4 neto. Soma com: s4b raiz (s4 teste), s4b sub (s4 sub).'))
  await submit(leaf, 'Fechar')

  // --- editar: o nome digitado sobrevive a cada ação de opção
  const root = await openEdit('s4b raiz')
  check('legenda do bloco do Salvar', await outsideFieldset(root, 'Grava ao tocar em Salvar'))
  check('legenda do bloco imediato', await inFieldset(root, 'Cada mudança grava na hora'))
  check('sem mudança, nada de "Não salvo"', !(await outsideFieldset(root, 'Não salvo')))
  await type(nameField(root), 's4b digitado')
  check('"Não salvo" com nome mudado', await outsideFieldset(root, 'Não salvo'))
  const keeps = async (step) => {
    const v = await value(nameField(root))
    const flag = await outsideFieldset(root, 'Não salvo')
    check(`${step}: o nome digitado continua`, v === 's4b digitado' && flag, v)
  }
  await type(`${root} input[aria-label="Opção nova"]`, 'tres')
  await page.keyboard.press('Enter')
  await waitFor((s) => document.querySelector(`${s} input[aria-label="Opção nova"]`).value === '', root)
  await keeps('adicionar')
  await clickLabel('Mais ações da opção tres')
  await clickItem('Renomear')
  await type(`${root} input[aria-label="Novo nome de tres"]`, 'trinta')
  await page.keyboard.press('Enter')
  await waitFor((s) => !document.querySelector(`${s} input[aria-label="Novo nome de tres"]`), root)
  await keeps('renomear')
  await clickLabel('Mais ações da opção trinta')
  await clickItem('Arquivar')
  await waitFor((s) => document.querySelector(`${s} fieldset`).textContent.includes('Arquivada'), root)
  await keeps('arquivar')
  await clickLabel('Mais ações da opção trinta')
  await clickItem('Reativar')
  await waitFor((s) => !document.querySelector(`${s} fieldset`).textContent.includes('Arquivada'), root)
  await keeps('reativar')
  await clickLabel('Mais ações da opção trinta')
  await clickItem('Apagar')
  await waitFor((s) => !document.querySelector(`${s} fieldset`).textContent.includes('trinta'), root)
  await keeps('apagar')
  check('as ações de opção gravaram na hora, o nome não',
    (await bySelectionName('s4b raiz'))?.options.map((o) => o.name).join() === 'um,dois')

  // Salvar manda só o que mudou
  writes.length = 0
  bodies.length = 0
  await submit(root, 'Fechar')
  check('Fechar com "Não salvo": sem pedido e sem caixa', writes.length === 0 && dialogs === 0, writes.join())
  const reopened = await openEdit('s4b raiz')
  check('Fechar descarta o digitado', (await value(nameField(reopened))) === 's4b raiz')
  writes.length = 0
  await submit(reopened, 'Salvar')
  check('Salvar sem mudança: fecha sem pedido', writes.length === 0 && !(await page.$(reopened)), writes.join())
  const named2 = await openEdit('s4b raiz')
  await page.evaluate((s) => document.querySelector(`${s} input[type="checkbox"]`).click(), named2)
  await pause(100)
  check('"Não salvo" também com "várias"', await outsideFieldset(named2, 'Não salvo'))
  bodies.length = 0
  await submit(named2, 'Salvar')
  await waitFor((s) => !document.querySelector(s), named2)
  check('Salvar manda só o que mudou', bodies.join() === '{"multiple":true}', bodies.join())
  check('gravou a múltipla', (await bySelectionName('s4b raiz'))?.multiple === true)
  const named3 = await openEdit('s4b raiz')
  await type(nameField(named3), 's4b renomeada')
  bodies.length = 0
  await submit(named3, 'Salvar')
  await waitFor((s) => !document.querySelector(s), named3)
  check('nome sozinho no PATCH', bodies.join() === '{"name":"s4b renomeada"}', bodies.join())

  // --- 409 reais: nada muda
  const conflict = await openEdit('s4b neto')
  await type(nameField(conflict), 's4b renomeada')
  await submit(conflict, 'Salvar')
  check('nome repetido no caminho: mensagem do servidor com o caminho',
    await outsideFieldset(conflict, 'Já existe a seleção "s4b renomeada" em s4 teste, no mesmo caminho'))
  check('o digitado continua depois do erro', (await value(nameField(conflict))) === 's4b renomeada')
  check('nada gravado', Boolean(await bySelectionName('s4b neto')))
  await submit(conflict, 'Fechar')

  const skill = await openEdit('Habilidade').catch(async () => {
    await clickLabel('Subtags de Idiomas').catch(() => {})
    return openEdit('Habilidade')
  })
  await page.evaluate((s) => document.querySelector(`${s} input[type="checkbox"]`).click(), skill)
  await pause(100)
  await submit(skill, 'Salvar')
  const doubled = (await get('/executions')).filter((e) => e.selections.some((c) => c.selectionId === selections.find((s) => s.name === 'Habilidade').id && c.optionIds.length > 1)).length
  check('múltipla → única: mensagem com a contagem',
    doubled > 0 && await outsideFieldset(skill, `${doubled} ${doubled === 1 ? 'registro tem' : 'registros têm'} mais de uma opção nesta seleção`),
    `${doubled}: ${await page.$eval(skill, (f) => f.querySelector('[role="alert"]')?.textContent)}`)
  check('Habilidade continua múltipla', (await bySelectionName('Habilidade')).multiple === true)
  await submit(skill, 'Fechar')

  const rep = await openEdit('s4b neto')
  await type(nameField(rep), 's4b fica')
  await type(`${rep} input[aria-label="Opção nova"]`, 'QUATRO')
  await page.keyboard.press('Enter')
  await waitFor((s) => document.querySelector(`${s} fieldset`).textContent.includes('Opção repetida'), rep)
  check('opção repetida: erro no bloco das opções, não no do Salvar', await inFieldset(rep, 'Opção repetida nesta seleção') && !(await outsideFieldset(rep, 'Opção repetida nesta seleção')))
  check('o erro da opção não apaga o que foi digitado', (await value(nameField(rep))) === 's4b fica' && (await value(`${rep} input[aria-label="Opção nova"]`)) === 'QUATRO')
  await type(`${rep} input[aria-label="Opção nova"]`, 'outra')
  await page.keyboard.press('Enter')
  await waitFor((s) => document.querySelector(`${s} input[aria-label="Opção nova"]`).value === '', rep)

  // --- trava da última opção ativa
  await clickLabel('Mais ações da opção outra')
  await clickItem('Arquivar')
  await waitFor((s) => document.querySelector(`${s} fieldset`).textContent.includes('Arquivada'), rep)
  await clickLabel('Mais ações da opção quatro')
  const lastArchive = await item('Arquivar')
  const lastDelete = await item('Apagar')
  const LAST = 'A seleção precisa de pelo menos uma opção ativa. Para parar de usá-la, arquive a seleção.'
  check('última ativa: Arquivar travado com o motivo', lastArchive?.disabled && lastArchive.text.includes(LAST), JSON.stringify(lastArchive))
  check('última ativa: Apagar travado com o motivo', lastDelete?.disabled && lastDelete.text.includes(LAST), JSON.stringify(lastDelete))
  await closeMenu()
  await clickLabel('Mais ações da opção outra')
  check('apagar a ARQUIVADA continua livre', (await item('Apagar'))?.disabled === false)
  await closeMenu()
  await submit(rep, 'Fechar')

  // --- teto de 30 ATIVAS
  const fullSel = await send('POST', '/selections', { tagId: testTag.id, name: 's4b teto', options: Array.from({ length: 30 }, (_, i) => `o${i + 1}`) })
  await send('PATCH', `/selection-options/${fullSel.options[29].id}`, { active: false })
  await send('POST', '/selection-options', { selectionId: fullSel.id, name: 'o31' })
  await openAll()
  const cap = await openEdit('s4b teto')
  check('com 30 ativas, sem campo de opção nova e com o limite', !(await page.$(`${cap} input[aria-label="Opção nova"]`)) &&
    await inFieldset(cap, 'Esta seleção já tem 30 opções ativas, o limite. Arquive ou apague uma antes de incluir outra.'))
  await clickLabel('Mais ações da opção o30')
  const capped = await item('Reativar')
  check('com 30 ativas, Reativar travado com o motivo', capped?.disabled && capped.text.includes('30 opções ativas'), JSON.stringify(capped))
  await closeMenu()
  await clickLabel('Mais ações da opção o31')
  await clickItem('Arquivar')
  await waitFor((s) => Boolean(document.querySelector(`${s} input[aria-label="Opção nova"]`)), cap)
  check('arquivar uma libera o campo', true)
  await clickLabel('Mais ações da opção o30')
  check('com 29 ativas, Reativar liberado', (await item('Reativar'))?.disabled === false)
  await closeMenu()
  await submit(cap, 'Fechar')

  // --- usada, travas e menu
  const nature = selections.find((s) => s.name === 'Natureza')
  const execs = await get('/executions')
  const natureUses = execs.filter((e) => e.selections.some((c) => c.selectionId === nature.id)).length
  await clickLabel('Mais ações da seleção Natureza')
  const natureDelete = await item('Apagar')
  check('seleção usada: Apagar travado com a contagem', natureDelete?.disabled && natureDelete.text.includes(`Em uso em ${natureUses} registros. Arquive em vez de apagar.`), JSON.stringify(natureDelete))
  await closeMenu()
  const edit = await openEdit('Natureza')
  const study = nature.options.find((o) => o.name === 'estudo')
  const studyUses = execs.filter((e) => e.selections.some((c) => c.optionIds.includes(study.id))).length
  await clickLabel('Mais ações da opção estudo')
  const studyDelete = await item('Apagar')
  check('opção usada: Apagar travado com a contagem', studyDelete?.disabled && studyDelete.text.includes(`Em uso em ${studyUses} ${studyUses === 1 ? 'registro' : 'registros'}.`), JSON.stringify(studyDelete))
  await closeMenu()
  await submit(edit, 'Fechar')

  await clickLabel('Mais ações da seleção s4b sub')
  await clickItem('Arquivar')
  await waitFor(() => ![...document.querySelectorAll('p')].some((p) => p.textContent.startsWith('Seleção: s4b sub')))
  check('Arquivar pelo menu grava', (await bySelectionName('s4b sub')).active === false)
  await page.evaluate(() => [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Mostrar arquivadas')).querySelector('input').click())
  await pause(200)
  await clickLabel('Mais ações da seleção s4b sub')
  await clickItem('Reativar')
  await waitFor(() => [...document.querySelectorAll('p')].some((p) => p.textContent === 'Seleção: s4b sub (tres)'))
  check('Reativar pelo menu grava', (await bySelectionName('s4b sub')).active === true)
  await page.evaluate(() => [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Mostrar arquivadas')).querySelector('input').click())
  await pause(200)

  archivedTag = await send('POST', '/tags', { name: 's4 arquivada' })
  await send('PATCH', `/tags/${archivedTag.id}`, { active: false })
  extra = [{ id: crypto.randomUUID(), tagId: archivedTag.id, name: 's4b presa', multiple: false, active: false, options: [option('p')] }]
  await openAll()
  await page.evaluate(() => [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Mostrar arquivadas')).querySelector('input').click())
  await pause(200)
  await clickLabel('Mais ações da seleção s4b presa')
  const stuck = await item('Reativar')
  check('tag arquivada: Reativar a seleção travado com o motivo', stuck?.disabled && stuck.text.includes(`Reative ${archivedTag.name} primeiro.`), JSON.stringify(stuck))
  await closeMenu()
  extra = []

  // --- 409 de rede: a tela achava que não estava em uso
  await openAll()
  const raizId = (await bySelectionName('s4b renomeada')).id
  deny = { url: `${API}/selections/${raizId}`, error: 'Esta seleção está em uso em registros: arquive em vez de apagar' }
  acceptDialogs = true
  await clickLabel('Mais ações da seleção s4b renomeada')
  await clickItem('Apagar')
  const opened = form('Seleção s4b renomeada')
  await page.waitForSelector(opened)
  check('Apagar recusado abre o formulário com a mensagem', await outsideFieldset(opened, 'Esta seleção está em uso em registros'))
  check('a seleção continua na API', Boolean(await bySelectionName('s4b renomeada')))
  const victim = (await bySelectionName('s4b renomeada')).options[0]
  deny = { url: `${API}/selection-options/${victim.id}`, error: 'Esta opção está em uso em registros: arquive em vez de apagar' }
  await clickLabel(`Mais ações da opção ${victim.name}`)
  await clickItem('Apagar')
  await waitFor((s) => document.querySelector(`${s} fieldset`).textContent.includes('Esta opção está em uso'), opened)
  check('Apagar opção recusado: erro no bloco das opções', await inFieldset(opened, 'Esta opção está em uso em registros'))
  deny = null
  await submit(opened, 'Fechar')

  // --- Apagar de verdade, pelo menu
  await clickLabel('Mais ações da seleção s4b renomeada')
  await clickItem('Apagar')
  await waitFor(() => ![...document.querySelectorAll('p')].some((p) => p.textContent.startsWith('Seleção: s4b renomeada')))
  // 2 confirmações: a do Apagar recusado pela rede e esta
  check('Apagar sem uso, com confirmação, grava', dialogs === 2 && !(await bySelectionName('s4b renomeada')), `${dialogs}`)
  const openIds = new Set(await page.evaluate(() => JSON.parse(localStorage.getItem('studyflow:tags-abertas'))))
  const expectedMenus = (await get('/tags')).filter((t) => t.active && (!t.parentId || openIds.has(t.parentId))).length
  check('controle negativo: ⋯ de tag não conta as de seleção', (await menuCount(page)) === expectedMenus, `${await menuCount(page)} de ${expectedMenus}`)
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser?.close().catch(() => {})
  for (const s of await get('/selections')) {
    if (s.name.startsWith('s4b')) await send('DELETE', `/selections/${s.id}`).catch((err) => console.log(err.message))
  }
  for (const tag of [leafTag, subTag, testTag, archivedTag]) {
    if (tag) await send('DELETE', `/tags/${tag.id}`).catch((err) => console.log(err.message))
  }
  const after = await get('/selections')
  check('limpeza: tags e seleções de teste apagadas',
    testTag && !(await get('/tags')).some((t) => t.name.startsWith('s4 ')) && !after.some((s) => s.name.startsWith('s4b')))
  check('limpeza: seleções do seed intactas', JSON.stringify(after.map((s) => [s.id, s.name, s.multiple, s.active, s.options.length]).sort()) === before, `${after.length}`)
}
console.log(`\n${results.filter(Boolean).length} de ${results.length}`)
process.exitCode = results.every(Boolean) ? 0 : 1
