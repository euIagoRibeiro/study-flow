// Tempo corrigido no Finalizar: o "Durou" e o aviso de sessão longa no painel do
// cronômetro (a sessão rodando do seed), janela real com a barra de rolagem, 320
// a 1280, com o início dela trocado na resposta da API (25 min ou 6h atrás: o
// seed a ancora no reseed). Estados: curto (recolhido: o "+ Durou…" com alvo de 44px), aberto
// ("Termina às"), longo (aviso e campo à vista) e erro (zero no longo e Finalizar: a frase da tela). Nada é
// gravado: a bateria confere que nenhum pedido de escrita saiu. Uma checagem por
// texto medido e a contagem mínima, fixa.
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME, out } from '../config.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const WIDTHS = [320, 360, 375, 414, 640, 768, 1280]
const entries = await (await fetch(`${API}/time-entries`)).json()
const executions = await (await fetch(`${API}/executions`)).json()
const running = entries.find((e) => e.endedAt === null && e.taskExecutionId.startsWith('5eed'))
const taskId = executions.find((e) => e.id === running?.taskExecutionId)?.taskId

let browser
try {
  if (!running || !taskId) throw new Error('sessão rodando do seed não achada')
  browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  let longStart = null
  const writes = []
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.method() !== 'GET' && req.method() !== 'OPTIONS') writes.push(`${req.method()} ${req.url()}`)
    if (longStart && req.method() === 'GET' && req.url() === `${API}/time-entries`) {
      const body = JSON.stringify(entries.map((e) => (e.id === running.id ? { ...e, startedAt: longStart } : e)))
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body })
    }
    req.continue()
  })
  const open = async (long) => {
    // O seed ancora a sessão no reseed: o início vai trocado nos dois estados
    longStart = new Date(Date.now() - (long ? 6 * 3600e3 : 25 * 60e3)).toISOString()
    await page.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => sessionStorage.clear())
    await page.goto(`${APP}/executar?tarefa=${taskId}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('main form[id^="finalizar-"] [data-duration-field]')
  }
  const type = async (text) => {
    if (!(await page.$('main form [data-duration-field] input'))) {
      await page.evaluate(() => document.querySelector('main form [data-duration-field] button').click())
      await pause(150)
    }
    const input = await page.$('main form [data-duration-field] input')
    await input.evaluate((el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, text)
    await pause(200)
  }
  const states = {
    curto: async () => { await open(false) },
    aberto: async () => { await open(false); await type('20') },
    longo: async () => { await open(true); await type('90') },
    erro: async () => {
      await open(true)
      await type('0')
      await page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Finalizar').click())
      await pause(300)
    },
  }
  for (const [state, enter] of Object.entries(states)) {
    for (const width of WIDTHS) {
      await page.setViewport({ width, height: 800 })
      await enter()
      const m = await page.evaluate(() => {
        const useful = document.documentElement.clientWidth
        const form = document.querySelector('main form[id^="finalizar-"]')
        const block = form.querySelector('[data-duration-field]')
        const warning = document.querySelector('main [data-long-warning]')
        const card = warning?.parentElement ?? null
        const box = form.getBoundingClientRect()
        const out = []
        const measure = (root, limit, what) => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
          let n = 0
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent.trim() || node.parentElement.closest('button')) continue
            const range = document.createRange()
            range.selectNodeContents(node)
            const leak = [...range.getClientRects()].find((r) => r.right > limit.right + 0.5 || r.left < limit.left - 0.5)
            n++
            out.push({ ok: !leak, what: `${what} vaza: "${node.textContent.slice(0, 25)}"${leak ? ` ${leak.left.toFixed(1)}..${leak.right.toFixed(1)} em ${limit.left.toFixed(1)}..${limit.right.toFixed(1)}` : ''}` })
          }
          return n
        }
        const texts = measure(block, box, 'texto do "Durou"') + (warning ? measure(warning, card.getBoundingClientRect(), 'aviso') : 0)
        const controls = [...block.querySelectorAll('input, button')]
        const button = block.querySelector('button')
        const alert = document.querySelector('main [role="alert"]')
        return {
          out,
          texts,
          open: block.querySelector('input') !== null,
          end: block.querySelector('p')?.textContent ?? null,
          warning: warning !== null,
          alert: alert?.textContent.trim() ?? null,
          alertOut: alert ? Math.max(0, alert.getBoundingClientRect().right - useful, -alert.getBoundingClientRect().left) : 0,
          buttonHeight: button ? button.getBoundingClientRect().height : null,
          scroll: document.documentElement.scrollWidth - useful,
          controlOut: Math.max(0, ...controls.map((c) => { const r = c.getBoundingClientRect(); return Math.max(r.right - box.right, box.left - r.left) })),
          margin: Math.min(...controls.map((c) => { const r = c.getBoundingClientRect(); return Math.min(r.left, useful - r.right) })),
        }
      })
      const tag = `${state} ${width}`
      for (const r of m.out) check(`${tag}: ${r.what}`, r.ok, r.what)
      if (state === 'curto') check(`${tag}: recolhido, "+ Durou…" com ≥ 44px de altura`, !m.open && m.buttonHeight >= 44, `${m.open} ${m.buttonHeight}px`)
      else check(`${tag}: campo aberto`, m.open)
      if (state === 'aberto' || state === 'longo') check(`${tag}: "Termina às" presente`, /^Termina às \d\d:\d\d /.test(m.end ?? ''), m.end)
      check(`${tag}: aviso ${state === 'longo' || state === 'erro' ? 'presente' : 'ausente'}`, m.warning === (state === 'longo' || state === 'erro'), String(m.warning))
      if (state === 'erro') check(`${tag}: a frase do erro, dentro da tela`, m.alert === 'Durou: minutos inteiros, de 1 a 1440.' && m.alertOut <= 0.5, `${m.alert} ${m.alertOut}`)
      // rótulo + "Termina às" (aberto); + aviso (longo); erro: rótulo + aviso (o "0"
      // não tem fim, e a frase do erro é medida à parte)
      const minTexts = { curto: 0, aberto: 2, longo: 3, erro: 2 }[state]
      check(`${tag}: textos medidos: ${m.texts}, esperado ao menos ${minTexts}`, m.texts >= minTexts, String(m.texts))
      check(`${tag}: sem rolagem lateral`, m.scroll <= 0, `${m.scroll}px`)
      check(`${tag}: campo dentro do formulário`, m.controlOut <= 0.5, `${m.controlOut}px`)
      check(`${tag}: folga do foco ≥ 4px`, m.margin >= 4, `${m.margin}px`)
      if (width === 320) {
        await page.evaluate(() => document.querySelector('main').scrollIntoView({ block: 'start' }))
        await page.screenshot({ path: out(`tempo-${state}-320.png`) })
        await page.evaluate(() => document.querySelector('main form [data-duration-field]').scrollIntoView({ block: 'center' }))
        await page.screenshot({ path: out(`tempo-${state}-320-campo.png`) })
      }
    }
  }
  check('nenhum pedido de escrita saiu', writes.length === 0, writes.join(' | '))
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser?.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length && ok > 0 ? 0 : 1
}
