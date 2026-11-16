// Menu das seleções múltiplas, em 320 a 1280 (janela real, com a barra de rolagem): no Registrar,
// no lápis do Histórico e no lápis do cartão da Lista (o lugar mais estreito). Quatro estados:
// fechado vazio, fechado com 1 escolhida de nome de 30 letras sem espaço (quebra), fechado com 4
// ("4 escolhidas") e ABERTO com 30 opções de 30 letras. Mede: sem rolagem lateral, texto e campos
// dentro do formulário, gatilho e Pronto ≥ 44px, linhas ≥ 44px sem sobrepor, o menu aberto EMPURRA
// o que vem depois (nada por cima), folga do anel de foco ≥ 4px contra a janela E contra todo
// ancestral com overflow, e o Pronto fora da barra fixa depois de focado.
// Não grava nada: as seleções de teste vão só na resposta de GET /selections (injetada) e todo
// pedido que não é GET é abortado.
// Uso (raiz do repo): node --env-file=backend/.env tests/layout/selecao-menu-layout.mjs
import { API, APP, CHROME, out } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  if (!ok) console.log(`FALHOU ${name}${detail ? ` (${detail})` : ''}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const WIDTHS = [320, 360, 375, 414, 640, 768, 1280]
const get = async (path) => (await apiFetch(`${API}${path}`)).json()
const [selections, tags, tasks, executions] = await Promise.all(['/selections', '/tags', '/tasks', '/executions'].map(get))
const desenho = tags.find((t) => t.name === 'Desenho' && t.parentId === null)
const task = tasks.find((t) => t.title === 'Desenhar')
const record = executions.find((e) => e.taskId === task.id && e.rootTagId === desenho.id && e.completedAt && e.description)
const L = 'x'.repeat(30)
const make = (name, names) => ({
  id: crypto.randomUUID(), tagId: desenho.id, name, multiple: true, active: true,
  options: names.map((n, i) => ({ id: crypto.randomUUID(), name: n, position: i + 1, active: true })),
})
const body = JSON.stringify([
  ...selections,
  make('Quatro', ['q1', 'q2', 'q3', 'q4', 'q5']),
  make('Nomes', [`${L}1`, `${L}2`, `${L}3`, `${L}4`]),
  make('y'.repeat(30), Array.from({ length: 30 }, (_, i) => `${L.slice(0, 28)}${String(i).padStart(2, '0')}`)),
])
const LONG_NAME = 'y'.repeat(30)

const browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
const writes = []
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (!['GET', 'OPTIONS', 'HEAD'].includes(req.method())) { writes.push(`${req.method()} ${req.url()}`); return req.abort() }
    if (req.url() === `${API}/selections`) return req.respond({ status: 200, contentType: 'application/json', body })
    return req.continue()
  })
  const clean = async (path) => {
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => sessionStorage.clear())
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
  }
  const pencil = async () => {
    const done = await page.evaluate((description) => {
      const a = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === description))
      const b = a?.querySelector('button[aria-label^="Editar registro"]')
      b?.click()
      return Boolean(b)
    }, record.description)
    if (!done) throw new Error('lápis do registro de teste não achado')
    await page.waitForSelector('form[id^="editar-"]')
    await page.waitForNetworkIdle()
  }
  const places = {
    registrar: () => clean(`/executar?tarefa=${task.id}`),
    historico: async () => { await clean('/historico'); await pencil() },
    lista: async () => {
      await clean('/')
      await page.evaluate((t) => document.querySelector(`button[aria-label="Mais ações de ${t}"]`).click(), task.title)
      await pause(150)
      await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Ver histórico').click())
      await pause(300)
      await pencil()
    },
  }
  // Mexe no menu pelo nome da seleção: abrir, marcar opções (pelo texto), fechar pelo Pronto
  const drive = async (name, steps) => {
    // Um passo por vez: o React só desenha o painel depois do clique
    for (const step of steps) {
      await page.evaluate((name, step) => {
        const form = document.querySelector('form[id^="editar-"]') ?? document.querySelector('main form')
        const menu = [...form.querySelectorAll('[data-selection-menu]')].find((m) => m.firstElementChild?.textContent === name)
        const trigger = menu.querySelector('button[aria-expanded]')
        if (step === 'open' && trigger.getAttribute('aria-expanded') !== 'true') trigger.click()
        if (step === 'close') [...menu.querySelectorAll('fieldset button')].find((b) => b.textContent.trim() === 'Pronto').click()
        if (step.startsWith('box:')) [...menu.querySelectorAll('fieldset label')].find((l) => l.textContent === step.slice(4)).querySelector('input').click()
      }, name, step)
      await pause(60)
    }
  }
  const STATES = {
    'fechado vazio': async () => {},
    'fechado com 1 escolhida de nome longo': async () => { await drive('Nomes', ['open', `box:${L}2`, 'close']) },
    'fechado com 4 escolhidas': async () => { await drive('Quatro', ['open', 'box:q1', 'box:q2', 'box:q3', 'box:q5', 'close']) },
    'aberto com 30 opções': async () => { await drive(LONG_NAME, ['open']) },
  }
  const measure = (openName) => page.evaluate((openName) => {
    const doc = document.documentElement
    const vw = doc.clientWidth
    const form = document.querySelector('form[id^="editar-"]') ?? document.querySelector('main form')
    const box = form.getBoundingClientRect()
    const menus = [...form.querySelectorAll('[data-selection-menu]')]
    const scrollers = [...document.querySelectorAll('body *')].filter((x) => ['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(x).overflowX) && x !== doc && x !== document.body)
    const ring = (el) => {
      const r = el.getBoundingClientRect()
      let m = Math.min(r.left, vw - r.right)
      for (const p of scrollers) if (p.contains(el) && p !== el) { const c = p.getBoundingClientRect(); m = Math.min(m, r.left - c.left, c.right - r.right) }
      return Math.round(m * 10) / 10
    }
    const text = (el) => { const range = document.createRange(); range.selectNodeContents(el); return [...range.getClientRects()] }
    const triggers = menus.map((m) => m.querySelector('button[aria-expanded]'))
    // Só o texto que se vê: a lista completa e a legenda (sr-only) ficam fora do fluxo, a 1px
    const visible = menus.flatMap((m) => [
      m.firstElementChild,
      m.querySelector('button[aria-expanded] > span'),
      ...m.querySelectorAll('fieldset label > span'),
      ...m.querySelectorAll('fieldset button'),
    ])
    const opened = menus.find((m) => m.firstElementChild?.textContent === openName)
    const rows = opened?.querySelector('fieldset') ? [...opened.querySelectorAll('fieldset label')] : []
    const pronto = opened ? [...opened.querySelectorAll('fieldset button')].find((b) => b.textContent.trim() === 'Pronto') : null
    let pushed = true
    let hidden = false
    let prontoRing = 99
    if (pronto) {
      const next = opened.nextElementSibling
      if (next) pushed = next.getBoundingClientRect().top >= opened.getBoundingClientRect().bottom - 0.5
      pronto.focus()
      const pr = pronto.getBoundingClientRect()
      hidden = [...document.querySelectorAll('body *')].some((f) => {
        if (getComputedStyle(f).position !== 'fixed') return false
        const r = f.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && pr.left < r.right && pr.right > r.left && pr.top < r.bottom && pr.bottom > r.top
      })
      prontoRing = ring(pronto)
    }
    return {
      menus: menus.length,
      scroll: doc.scrollWidth - vw,
      textOut: Math.max(0, ...visible.flatMap((el) => text(el)).map((r) => Math.max(r.right - box.right, box.left - r.left))),
      boxOut: Math.max(0, ...triggers.map((t) => t.getBoundingClientRect().right - box.right), ...rows.map((r) => r.getBoundingClientRect().right - box.right)),
      triggerLow: Math.min(...triggers.map((t) => t.getBoundingClientRect().height)),
      triggerRing: Math.min(...triggers.map(ring)),
      rows: rows.length,
      rowLow: rows.length ? Math.min(...rows.map((r) => r.getBoundingClientRect().height)) : 44,
      overlap: rows.some((r, i) => i > 0 && r.getBoundingClientRect().top < rows[i - 1].getBoundingClientRect().bottom - 0.5),
      prontoHeight: pronto ? pronto.getBoundingClientRect().height : 44,
      prontoOut: pronto ? pronto.getBoundingClientRect().right - box.right : 0,
      pushed, hidden, prontoRing,
    }
  }, openName)

  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 800 })
    for (const [place, enter] of Object.entries(places)) {
      for (const [state, setup] of Object.entries(STATES)) {
        await enter()
        await page.evaluate(() => document.querySelector('[data-selection-menu]')?.scrollIntoView({ block: 'center' }))
        const tag = `${place}, ${state}, ${width}px`
        const found = await page.evaluate(() => document.querySelectorAll('form [data-selection-menu]').length)
        check(`${tag}: os 3 menus existem`, found === 3, `${found}`)
        if (found !== 3) continue
        await setup()
        await pause(120)
        const isOpen = state.startsWith('aberto')
        const m = await measure(isOpen ? LONG_NAME : '')
        check(`${tag}: sem rolagem lateral`, m.scroll <= 0, `${m.scroll}px`)
        check(`${tag}: texto dentro do formulário`, m.textOut <= 0.5, `${m.textOut}px`)
        check(`${tag}: gatilho e linhas dentro do formulário`, m.boxOut <= 0.5, `${m.boxOut}px`)
        check(`${tag}: gatilho ≥ 44px`, m.triggerLow >= 44, `${m.triggerLow}px`)
        check(`${tag}: folga do foco do gatilho ≥ 4px`, m.triggerRing >= 4, `${m.triggerRing}px`)
        if (isOpen) {
          check(`${tag}: 30 opções visíveis`, m.rows === 30, `${m.rows}`)
          check(`${tag}: linha da caixa ≥ 44px`, m.rowLow >= 44, `${m.rowLow}px`)
          check(`${tag}: linhas sem sobrepor`, !m.overlap)
          check(`${tag}: Pronto ≥ 44px e dentro do formulário`, m.prontoHeight >= 44 && m.prontoOut <= 0.5, `${m.prontoHeight}px, ${m.prontoOut}px fora`)
          check(`${tag}: o menu aberto empurra o que vem depois (nada por cima)`, m.pushed)
          check(`${tag}: folga do foco do Pronto ≥ 4px`, m.prontoRing >= 4, `${m.prontoRing}px`)
          check(`${tag}: Pronto focado fora das barras fixas`, !m.hidden)
        }
        if (width === 320 && place === 'lista' && (isOpen || state.includes('nome longo'))) {
          await page.screenshot({ path: out(`menu-selecao-${state.replaceAll(' ', '-')}-320.png`) })
        }
      }
    }
  }
  check('nenhum pedido de escrita foi liberado', true, `${writes.length} abortado(s)`)
  // Cada texto e cada estado é uma checagem: um estado que sumisse não falharia sozinho
  check(`checagens feitas: ${results.length}, esperado ao menos 652`, results.length >= 652, String(results.length))
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false, String(err.stack).split(String.fromCharCode(10)).slice(0, 4).join(' | '))
} finally {
  await browser.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
