// S5: seleções no Registrar, no painel do cronômetro (rodando e pausado) e no
// lápis (Histórico e cartão da Lista, o lugar mais estreito), janela real com a
// barra de rolagem, 320 a 1280: seed (Desenho › Inktober) e pior caso
// injetado (múltipla de 30 opções de 30 letras sem espaço, seleção única e nome
// no limite). No painel, o caminho é só escolhido na tela: nada é gravado. A
// sessão rodando do seed vai com o início 25 min atrás na resposta da API (o
// seed a ancora no reseed; com 2h, o painel ganharia o aviso e o "Durou" aberto).
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME, out } from '../config.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? ` (${detail})` : ''}`)
}
const WIDTHS = [320, 360, 375, 414, 640, 768, 1280]
const RUNNING_TASK = '5eed0000-0000-4000-8000-000000000002'
const PAUSED_TASK = '5eed0000-0000-4000-8000-000000000004'
const EDIT = 'form[id^="editar-"]'
const [selections, tags, tasks] = await Promise.all(['selections', 'tags', 'tasks'].map(async (p) => (await fetch(`${API}/${p}`)).json()))
const desenho = tags.find((t) => t.name === 'Desenho' && t.parentId === null)
const task = tasks.find((t) => t.title === 'Desenhar')
const option = (i) => ({ id: crypto.randomUUID(), name: `${'x'.repeat(28)}${String(i).padStart(2, '0')}`, position: i + 1, active: true })
const long = (multiple) => ({ id: crypto.randomUUID(), tagId: desenho.id, name: `${multiple ? 'y' : 'z'}`.repeat(30), multiple, active: true,
  options: Array.from({ length: 30 }, (_, i) => option(i)) })
const worst = [...selections, long(true), long(false)]
// Um registro do seed em Desenho, da tarefa Desenhar
const executions = await (await fetch(`${API}/executions`)).json()
const record = executions.find((e) => e.taskId === task.id && e.rootTagId === desenho.id && e.completedAt && e.description)
const entries = await (await fetch(`${API}/time-entries`)).json()
const running = entries.find((e) => e.endedAt === null && e.taskExecutionId.startsWith('5eed'))

let browser
try {
  if (!running) throw new Error('sessão rodando do seed não achada')
  browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  let body = null
  let runningStart = null
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const reply = (data) => req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: data })
    if (body && req.method() === 'GET' && req.url() === `${API}/selections`) reply(body)
    else if (runningStart && req.method() === 'GET' && req.url() === `${API}/time-entries`) {
      reply(JSON.stringify(entries.map((e) => (e.id === running.id ? { ...e, startedAt: runningStart } : e))))
    } else req.continue()
  })
  const open = async (taskId) => {
    runningStart = new Date(Date.now() - 25 * 60e3).toISOString()
    await page.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => sessionStorage.clear())
    await page.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'networkidle0' })
    for (const [label, text] of [['Contexto', 'Desenho'], ['Em Desenho', 'Inktober']]) {
      await page.evaluate((label, text) => {
        const found = [...document.querySelectorAll('main form label')].find((l) => l.querySelector('span')?.textContent === label)
        const select = found.querySelector('select')
        select.value = [...select.options].find((o) => o.textContent === text).value
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }, label, text)
      await page.waitForNetworkIdle()
    }
  }
  const article = (description) => `[...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === ${JSON.stringify(description)}))`
  const pencil = async () => {
    await page.evaluate(`${article(record.description)}.querySelector('button[aria-label^="Editar registro"]').click()`)
    await page.waitForSelector(EDIT)
    await page.waitForNetworkIdle()
  }
  const inHistory = async () => {
    await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
    await pencil()
  }
  const inList = async () => {
    await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
    await page.evaluate((title) => document.querySelector(`button[aria-label="Mais ações de ${title}"]`).click(), task.title)
    await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Ver histórico').click())
    await new Promise((r) => setTimeout(r, 200))
    await pencil()
  }
  const forms = [
    ['Registrar', () => open(task.id), 'registrar'],
    ['rodando', () => open(RUNNING_TASK), 'painel-rodando'],
    ['pausado', () => open(PAUSED_TASK), 'painel-pausado'],
    ['lápis no Histórico', inHistory, 'lapis-historico'],
    ['lápis na Lista', inList, 'lapis-lista'],
  ]
  for (const [state, data] of [['seed', null], ['30 opções', JSON.stringify(worst)]]) for (const [where, enter, file] of forms) {
    body = data
    for (const width of WIDTHS) {
      await page.setViewport({ width, height: 800 })
      await enter()
      const m = await page.evaluate((EDIT) => {
        const useful = document.documentElement.clientWidth
        const form = document.querySelector(EDIT) ?? document.querySelector('main form')
        const box = form.getBoundingClientRect()
        const blocks = [...document.querySelectorAll('[data-selection-block]')]
        const texts = blocks.flatMap((b) => [...b.querySelectorAll('span, legend')])
        const rects = (el) => {
          const range = document.createRange()
          range.selectNodeContents(el)
          return [...range.getClientRects()]
        }
        const rows = blocks.flatMap((b) => [...b.querySelectorAll('fieldset label')])
        const fields = blocks.flatMap((b) => [...b.querySelectorAll('select, fieldset')])
        const controls = blocks.flatMap((b) => [...b.querySelectorAll('select, input')])
        return {
          longWarning: document.querySelector('main [data-long-warning]') !== null,
          blocks: blocks.length,
          scroll: document.documentElement.scrollWidth - useful,
          textOut: Math.max(0, ...texts.flatMap(rects).map((r) => Math.max(r.right - box.right, box.left - r.left))),
          fieldOut: Math.max(0, ...fields.map((f) => f.getBoundingClientRect().right - box.right)),
          rows: rows.length,
          lowest: rows.length ? Math.min(...rows.map((r) => r.getBoundingClientRect().height)) : 44,
          margin: Math.min(...controls.map((c) => {
            const r = c.getBoundingClientRect()
            return Math.min(r.left, useful - r.right)
          })),
          overlap: rows.some((r, i) => i > 0 && r.getBoundingClientRect().top < rows[i - 1].getBoundingClientRect().bottom - 0.5),
        }
      }, EDIT)
      const tag = `${where}, ${state} ${width}px`
      check(`${tag}: dois blocos`, m.blocks === 2, `${m.blocks}`)
      if (where === 'rodando') check(`${tag}: sem aviso de sessão longa (o mesmo estado a qualquer hora)`, !m.longWarning)
      check(`${tag}: sem rolagem lateral`, m.scroll <= 0, `${m.scroll}px`)
      check(`${tag}: texto dentro do formulário`, m.textOut <= 0.5, `${m.textOut}px`)
      check(`${tag}: campos dentro do formulário`, m.fieldOut <= 0.5, `${m.fieldOut}px`)
      check(`${tag}: folga do foco ≥ 4px`, m.margin >= 4, `${m.margin}px`)
      if (state !== 'seed') {
        check(`${tag}: 30 opções visíveis`, m.rows === 30, `${m.rows}`)
        check(`${tag}: linha da caixa ≥ 44px`, m.lowest >= 44, `${m.lowest}px`)
        check(`${tag}: linhas sem sobrepor`, !m.overlap)
      }
      if (width === 320) {
        const name = `s5-${file}${state === 'seed' ? '' : '-30-opcoes'}-320.png`
        await page.screenshot({ path: out(name), fullPage: false })
        await page.evaluate(() => document.querySelector('[data-selection-block]').scrollIntoView({ block: 'start' }))
        await page.screenshot({ path: out(name.replace('.png', '-campos.png')) })
      }
    }
  }
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser?.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length && ok > 0 ? 0 : 1
}
