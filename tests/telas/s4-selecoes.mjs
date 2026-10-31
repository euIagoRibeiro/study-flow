// S4: seleções na tela de tags. Leitura (S4a): linhas, seção geral, arquivadas,
// aviso no formulário "Nova tag" e a trava de apagar. O seed é lido da API; o
// que ele não tem (arquivada, subtag) entra injetado na resposta de /selections
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME } from '../config.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? ` (${detail})` : ''}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const get = async (p) => (await fetch(API + p)).json()
const send = async (method, p, body) => {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
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
try {
  const tags = await get('/tags')
  const selections = await get('/selections')
  const activeRoots = tags.filter((t) => !t.parentId && t.active)
  testTag = await send('POST', '/tags', { name: 's4 teste' })
  const ingles = tags.find((t) => t.name === 'Inglês')

  browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 375, height: 900 })
  page.on('dialog', (d) => d.dismiss())
  let extra = []
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.method() === 'GET' && req.url() === `${API}/selections` && extra.length > 0) {
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
  check('seção entre a árvore e Exercícios', order.afterTree && order.heads.join() === 'Seleções gerais,Exercícios', order.heads.join())
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
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser?.close().catch(() => {})
  if (testTag) await send('DELETE', `/tags/${testTag.id}`).catch((err) => console.log(err.message))
  check('limpeza: tag de teste apagada', testTag && !(await get('/tags')).some((t) => t.id === testTag.id))
}
console.log(`\n${results.filter(Boolean).length} de ${results.length}`)
process.exitCode = results.every(Boolean) ? 0 : 1
