// Prints das telas pra comparar antes × depois, em tests/out/<rótulo>/.
// Uso: node ferramentas/shots.mjs antes|depois (passo a passo no README)
// Relógio congelado (out/clock.txt): o cronômetro rodando do seed não muda
// entre as rodadas. Apagar o clock.txt pra começar uma comparação nova
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { APP, CHROME, OUT as here } from '../config.mjs'

const label = process.argv[2]
const clockFile = join(here, 'clock.txt')
if (!existsSync(clockFile)) writeFileSync(clockFile, String(Date.now()))
const frozen = Number(readFileSync(clockFile, 'utf8'))
const out = join(here, label)
mkdirSync(out, { recursive: true })

const pages = [
  ['lista', '/'],
  ['historico', '/historico'],
  ['tags', '/tags'],
  ['executar-vestibular', '/executar?tarefa=5eed0000-0000-4000-8000-000000000009'],
  ['executar-aib', '/executar?tarefa=5eed0000-0000-4000-8000-000000000011'],
  ['timer-rodando', '/executar?tarefa=5eed0000-0000-4000-8000-000000000002'],
  ['timer-pausado', '/executar?tarefa=5eed0000-0000-4000-8000-000000000004'],
  ['executar-exfis', '/executar?tarefa=5eed0000-0000-4000-8000-000000000006'],
]
const browser = await puppeteer.launch({
  executablePath: CHROME,
  ignoreDefaultArgs: ['--hide-scrollbars'],
})
const page = await browser.newPage()
await page.evaluateOnNewDocument((t) => {
  const Real = Date
  class Frozen extends Real {
    constructor(...a) { super(...(a.length ? a : [t])) }
    static now() { return t }
  }
  globalThis.Date = Frozen
}, frozen)
// Formulário de edição aberto num registro SEM treino ("Desenho da fase de
// trabalho", Programar): no Histórico e no cartão da Lista
const openEditOn = (desc) => page.evaluate((desc) => {
  const a = [...document.querySelectorAll('article')].filter((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === desc))[0]
  a.querySelector('button[aria-label^="Editar registro"]').click()
}, desc)
for (const width of [320, 375, 768, 1280]) {
  await page.setViewport({ width, height: 800 })
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await openEditOn('Desenho da fase de trabalho')
  await new Promise((r) => setTimeout(r, 300))
  await page.screenshot({ path: join(out, `editar-historico-${width}.png`), fullPage: true })
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.querySelector('button[aria-label="Mais ações de Programar"]').click())
  await new Promise((r) => setTimeout(r, 100))
  await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Ver histórico').click())
  await new Promise((r) => setTimeout(r, 200))
  await openEditOn('Desenho da fase de trabalho')
  await new Promise((r) => setTimeout(r, 300))
  await page.screenshot({ path: join(out, `editar-lista-${width}.png`), fullPage: true })
}
for (const [name, path] of pages) {
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewport({ width, height: 800 })
    await page.goto(APP + path, { waitUntil: 'networkidle0' })
    await page.screenshot({ path: join(out, `${name}-${width}.png`), fullPage: true })
  }
}
await browser.close()
console.log(`prints em ${label}/`)
