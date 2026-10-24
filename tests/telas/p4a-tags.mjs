// P4a: ligar/desligar fases na tela de tags. Mira pelo rótulo, nunca pela
// posição. Exercícios volta a tracksPhase=false no finally.
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME } from '../config.mjs'

const EXERCICIOS = '5eed0000-0000-4000-9000-000000000300'
const CODIGO = '5eed0000-0000-4000-9000-000000000400'
const results = []
function check(name, ok, detail = '') {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? ` (${detail})` : ''}`)
}
// O backend em dev reinicia sozinho às vezes: esperar antes de cada pedido,
// inclusive na limpeza (senão o finally falha e deixa o dado mudado)
async function waitForApi() {
  for (let i = 0; i < 30; i++) {
    try {
      if ((await fetch(`${API}/tasks`)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('API não respondeu em 30s')
}
const tagFromApi = async (id) => {
  await waitForApi()
  return (await (await fetch(`${API}/tags`)).json()).find((t) => t.id === id)
}

// Abre o menu ⋯ pelo aria-label e devolve os itens (texto + desabilitado)
async function openMenu(page, label) {
  await page.evaluate((l) => {
    document.querySelector(`button[aria-haspopup="menu"][aria-label="${l}"]`).click()
  }, label)
  await page.waitForSelector(`[role="menu"][aria-label="${label}"]`)
  return page.evaluate((l) =>
    [...document.querySelectorAll(`[role="menu"][aria-label="${l}"] [role="menuitem"]`)].map((b) => ({
      text: b.textContent.trim(),
      disabled: b.getAttribute('aria-disabled') === 'true',
    })), label)
}
async function pick(page, label, item) {
  await page.evaluate((l, i) => {
    const b = [...document.querySelectorAll(`[role="menu"][aria-label="${l}"] [role="menuitem"]`)]
      .find((el) => el.textContent.trim().startsWith(i))
    b.click()
  }, label, item)
}
const rowHasChip = (page, name, chip) =>
  page.evaluate((n, c) => {
    const btn = document.querySelector(`button[aria-label="Mais ações de ${n}"]`)
    const row = btn.closest('div.flex')
    return [...row.querySelectorAll('span')].some((s) => s.textContent.trim() === c)
  }, name, chip)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  ignoreDefaultArgs: ['--hide-scrollbars'],
})
try {
  await waitForApi()
  const page = await browser.newPage()
  await page.setViewport({ width: 375, height: 800 })
  await page.goto(`${APP}/tags`, { waitUntil: 'networkidle0' })

  check('Código mostra o chip "Fases"', await rowHasChip(page, 'Código', 'Fases'))
  check('Exercícios não mostra o chip', !(await rowHasChip(page, 'Exercícios', 'Fases')))

  let items = await openMenu(page, 'Mais ações de Exercícios')
  check('contexto sem fases: "Usar fases de trabalho" no menu',
    items.some((i) => i.text === 'Usar fases de trabalho' && !i.disabled), items.map((i) => i.text).join(', '))
  await pick(page, 'Mais ações de Exercícios', 'Usar fases de trabalho')
  await page.waitForFunction(() => {
    const btn = document.querySelector('button[aria-label="Mais ações de Exercícios"]')
    return [...btn.closest('div.flex').querySelectorAll('span')].some((s) => s.textContent.trim() === 'Fases')
  }, { timeout: 5000 })
  check('ligar: chip aparece e a API grava', (await tagFromApi(EXERCICIOS)).tracksPhase === true)

  items = await openMenu(page, 'Mais ações de Exercícios')
  check('ligado e sem registro com fase: "Parar" habilitado',
    items.some((i) => i.text === 'Parar de usar fases' && !i.disabled))
  await pick(page, 'Mais ações de Exercícios', 'Parar de usar fases')
  await page.waitForFunction(() => {
    const btn = document.querySelector('button[aria-label="Mais ações de Exercícios"]')
    return ![...btn.closest('div.flex').querySelectorAll('span')].some((s) => s.textContent.trim() === 'Fases')
  }, { timeout: 5000 })
  check('desligar: chip some e a API grava', (await tagFromApi(EXERCICIOS)).tracksPhase === false)

  items = await openMenu(page, 'Mais ações de Código')
  const stop = items.find((i) => i.text.startsWith('Parar de usar fases'))
  check('Código com registros com fase: "Parar" travado com o motivo',
    stop?.disabled === true && stop.text.includes('Em uso em 10 registros com fase.'), stop?.text)
  await page.keyboard.press('Escape')
  await page.click('body')

  // Subtag: sem ação de fase. Abre Código pra o menu de Pessoal existir
  await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Subtags de Código"]')
    if (b.getAttribute('aria-expanded') !== 'true') b.click()
  })
  await page.waitForSelector('button[aria-label="Mais ações de Código › Pessoal"]')
  items = await openMenu(page, 'Mais ações de Código › Pessoal')
  check('subtag: nenhuma ação de fase', !items.some((i) => /fase/i.test(i.text)), items.map((i) => i.text).join(', '))
  check('Código continua ligado', (await tagFromApi(CODIGO)).tracksPhase === true)
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await waitForApi()
  await fetch(`${API}/tags/${EXERCICIOS}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tracksPhase: false }),
  })
  check('Exercícios terminou sem fases', (await tagFromApi(EXERCICIOS)).tracksPhase === false)
  await browser.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
