// N2 (2026-10-26): o que abre dentro de um cartão fecha no FIM também.
// "Fechar histórico" no fim do histórico aberto no cartão da Lista (antes, só
// no ⋯, lá em cima); "Cancelar" ao lado do "Salvar" no lápis do registro e no
// da sessão (antes, só o próprio lápis, lá em cima). Fechar devolve o foco a
// quem abriu (o ⋯, o lápis), que rola a tela até ele. Cancelar não grava
// nada. Só lê: nada é gravado (o Cancelar é conferido na API).
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME } from '../config.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const TASK = 'Exercício físico'
const DESC = 'Costas e bíceps' // registro do seed (1401), com treino e sessão

const executionByDesc = async () => (await (await fetch(`${API}/executions`)).json()).find((e) => e.description === DESC)
const before = await executionByDesc()
// Depois de achar, sempre pelo ID: se algo gravar, a descrição muda e a busca
// pela descrição não acharia nada (a 1ª versão da checagem deixava passar)
const current = async () => (await (await fetch(`${API}/executions`)).json()).find((e) => e.id === before.id)
if (!before) throw new Error(`o seed não tem o registro "${DESC}" (reseed?)`)

const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 390, height: 800 })
  // O foco: quem é, e se está à vista
  const focused = () => page.evaluate(() => {
    const el = document.activeElement
    const r = el?.getBoundingClientRect()
    return { label: el?.getAttribute('aria-label') ?? el?.textContent.trim() ?? null, visible: !!r && r.top >= 0 && r.bottom <= innerHeight }
  })
  // O cartão do registro "Costas e bíceps" (o mais interno com a descrição)
  const mark = () => page.evaluate((d) => {
    document.querySelectorAll('[data-t]').forEach((x) => x.removeAttribute('data-t'))
    const own = [...document.querySelectorAll('article')].filter((a) => [...a.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === d))
    own[0]?.setAttribute('data-t', 'reg')
    return own.length
  }, DESC)
  const clickIn = (scope, text) => page.evaluate((s, t) => {
    const b = [...document.querySelector(s).querySelectorAll('button')].find((x) => x.textContent.replace(/\s+/g, ' ').trim() === t)
    b.scrollIntoView({ block: 'center' }); b.click()
  }, scope, text)
  const openMenuItem = async (cardTitle, item) => {
    await page.evaluate((t) => document.querySelector(`button[aria-label="Mais ações de ${t}"]`).click(), cardTitle)
    await pause(100)
    await page.evaluate((i) => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === i).click(), item)
    await pause(250)
  }
  // O cartão da tarefa na Lista
  const taskCard = (t) => `article:has(button[aria-label="Mais ações de ${t}"])`

  // ---- 1. Lista: histórico aberto no cartão tem "Fechar histórico" no fim
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
  await openMenuItem(TASK, 'Ver histórico')
  const end = await page.evaluate((sel) => {
    const card = document.querySelector(sel)
    const buttons = [...card.querySelectorAll('button')]
    const last = buttons.at(-1)
    return { last: last?.textContent.trim(), records: card.querySelectorAll('article').length }
  }, taskCard(TASK))
  check('histórico aberto no cartão: "Fechar histórico" é o último botão do cartão (no fim)', end.last === 'Fechar histórico' && end.records > 0, JSON.stringify(end))
  await clickIn(taskCard(TASK), 'Fechar histórico')
  await pause(250)
  const closed = await page.evaluate((sel) => document.querySelector(sel).querySelectorAll('article').length, taskCard(TASK))
  let f = await focused()
  check('"Fechar histórico" fecha o histórico', closed === 0, String(closed))
  check('o foco volta pro ⋯ do cartão, à vista na tela', f.label === `Mais ações de ${TASK}` && f.visible, JSON.stringify(f))

  // ---- 2. Histórico: lápis do registro com "Cancelar" ao lado do "Salvar"
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await mark()
  await page.evaluate(() => document.querySelector('[data-t="reg"] button[aria-label^="Editar registro"]').click())
  await pause(250)
  const pair = await page.evaluate(() => {
    const card = document.querySelector('[data-t="reg"]')
    const find = (t) => [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === t)?.getBoundingClientRect()
    const s = find('Salvar'), c = find('Cancelar')
    return s && c ? { sameRow: Math.abs(s.top - c.top) < 1, cancelLeft: c.right <= s.left } : null
  })
  check('lápis do registro (Histórico): "Cancelar" na mesma linha, à esquerda do "Salvar"', pair?.sameRow && pair.cancelLeft, JSON.stringify(pair))
  await page.evaluate(() => {
    const input = [...document.querySelectorAll('[data-t="reg"] label')].find((l) => l.textContent.includes('O que foi feito')).querySelector('input')
    input.setAttribute('data-desc', '1')
  })
  await page.click('input[data-desc="1"]', { clickCount: 3 })
  await page.type('input[data-desc="1"]', 'NÃO PODE GRAVAR')
  await clickIn('[data-t="reg"]', 'Cancelar')
  // espera o bastante pra um pedido de gravar (se houvesse) chegar à API
  await pause(1000)
  const formGone = await page.evaluate(() => !document.querySelector('[data-t="reg"] form'))
  f = await focused()
  check('Cancelar fecha a edição', formGone)
  const now = await current()
  check('Cancelar não grava nada (a descrição na API é a de antes)', now?.description === DESC, now?.description)
  check('o foco volta pro lápis do registro, à vista', /^Editar registro/.test(f.label ?? '') && f.visible, JSON.stringify(f))

  // ---- 3. Lápis da sessão com "Cancelar" ao lado do "Salvar"
  await clickIn('[data-t="reg"]', '1 sessão')
  await pause(150)
  await page.evaluate(() => document.querySelector('[data-t="reg"] button[aria-label^="Editar sessão"]').click())
  await pause(250)
  const pair2 = await page.evaluate(() => {
    const card = document.querySelector('[data-t="reg"]')
    const find = (t) => [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === t)?.getBoundingClientRect()
    const s = find('Salvar'), c = find('Cancelar')
    return s && c ? { sameRow: Math.abs(s.top - c.top) < 1, cancelLeft: c.right <= s.left } : null
  })
  check('lápis da sessão: "Cancelar" na mesma linha, à esquerda do "Salvar"', pair2?.sameRow && pair2.cancelLeft, JSON.stringify(pair2))
  await clickIn('[data-t="reg"]', 'Cancelar')
  await pause(250)
  f = await focused()
  check('Cancelar da sessão fecha e devolve o foco ao lápis da sessão', await page.evaluate(() => !document.querySelector('[data-t="reg"] input[type="datetime-local"]')) && /^Editar sessão/.test(f.label ?? ''), JSON.stringify(f))

  // ---- 4. O mesmo lápis dentro do cartão da Lista (cartões aninhados)
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
  await openMenuItem(TASK, 'Ver histórico')
  await mark()
  await page.evaluate(() => document.querySelector('[data-t="reg"] button[aria-label^="Editar registro"]').click())
  await pause(250)
  await clickIn('[data-t="reg"]', 'Cancelar')
  await pause(250)
  f = await focused()
  check('no cartão da Lista: Cancelar fecha a edição e devolve o foco ao lápis', await page.evaluate(() => !document.querySelector('[data-t="reg"] form')) && /^Editar registro/.test(f.label ?? ''), JSON.stringify(f))
  check('nada mudou no registro (API)', JSON.stringify(await current()) === JSON.stringify(before))
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
