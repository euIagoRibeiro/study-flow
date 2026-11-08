// Tela de entrada (commit B): janela real com a barra de rolagem, 320 a 1280.
// Estados: entrada (sem sessão), senha errada, 429 do login, "Acordando o
// servidor…", servidor fora do ar e o diálogo por cima do app (Painel com os
// pedidos respondidos 401 na página), com e sem erro. Nada vaza da tela, os
// textos ficam dentro, campo e botão com largura útil, folga do foco ≥ 4px, o
// cartão do diálogo inteiro na largura. Contraste no pixel, nos dois temas.
// Respostas trocadas só na página; o único pedido que chega ao servidor sem
// sessão é o /session (nada gravado). Uso (raiz do repo):
//   node --env-file=backend/.env tests/layout/entrada.mjs
import pngjs from 'pngjs'
import puppeteer from 'puppeteer-core'
import { APP, CHROME, out } from '../config.mjs'
import { launch } from '../sessao.mjs'

const { PNG } = pngjs
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const WIDTHS = [320, 360, 375, 414, 640, 768, 1280]
const json = (status, error, headers = {}) => ({ status, contentType: 'application/json', headers, body: JSON.stringify({ error }) })
const luminance = ([r, g, b]) => {
  const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

let plain
let withCookie
try {
  plain = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  withCookie = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const setup = async (browser) => {
    const page = await browser.newPage()
    page.setDefaultTimeout(10000)
    page.fake = null
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const hit = page.fake?.(req)
      if (hit === 'abort') return void req.abort()
      if (hit?.delay) return void setTimeout(() => req.continue().catch(() => {}), hit.delay)
      if (hit) return void req.respond(hit)
      req.continue()
    })
    return page
  }
  const p1 = await setup(plain)
  const p2 = await setup(withCookie)
  const isLogin = (req) => req.method() === 'POST' && req.url().endsWith('/api/login')
  const submit = async (page) => {
    await page.type('input[type="password"]', 'qualquer-senha')
    await page.keyboard.press('Enter')
  }
  // Estado: [navegador, preparar, texto que tem que aparecer, seletor da área medida]
  const STATES = {
    entrada: [p1, async (p) => { p.fake = null; await p.goto(`${APP}/`, { waitUntil: 'networkidle0' }) }, 'Senha', 'main'],
    'senha errada': [p1, async (p) => {
      p.fake = (req) => (isLogin(req) ? json(401, 'Senha incorreta.') : null)
      await p.goto(`${APP}/`, { waitUntil: 'networkidle0' })
      await submit(p)
    }, 'Senha incorreta.', 'main'],
    '429': [p1, async (p) => {
      p.fake = (req) => (isLogin(req) ? json(429, 'Muitos pedidos. Espere um pouco.', { 'Retry-After': '30' }) : null)
      await p.goto(`${APP}/`, { waitUntil: 'networkidle0' })
      await submit(p)
    }, 'Tente de novo em', 'main'],
    acordando: [p1, async (p) => {
      p.fake = (req) => (req.url().endsWith('/api/session') ? { delay: 8000 } : null)
      await p.goto(`${APP}/`, { waitUntil: 'domcontentloaded' })
      await p.waitForFunction(() => document.body.textContent.includes('Acordando o servidor'), { timeout: 6000 })
    }, 'Acordando o servidor…', 'main'],
    'fora do ar': [p1, async (p) => {
      p.fake = (req) => (req.url().endsWith('/api/session') ? 'abort' : null)
      await p.goto(`${APP}/`, { waitUntil: 'networkidle0' })
    }, 'Não foi possível falar com o servidor.', 'main'],
    diálogo: [p2, async (p) => {
      p.fake = null
      await p.goto(`${APP}/`, { waitUntil: 'networkidle0' })
      p.fake = (req) => (req.url().includes('/api/dashboard/') ? json(401, 'Sessão necessária.') : null)
      await p.evaluate(() => document.querySelector('nav a[href="/painel"]').click())
      await p.waitForSelector('[role="dialog"]')
    }, 'Sua sessão terminou', '[role="dialog"]'],
    'diálogo com erro': [p2, async (p) => {
      p.fake = null
      await p.goto(`${APP}/`, { waitUntil: 'networkidle0' })
      p.fake = (req) => (req.url().includes('/api/dashboard/') ? json(401, 'Sessão necessária.') : isLogin(req) ? json(401, 'Senha incorreta.') : null)
      await p.evaluate(() => document.querySelector('nav a[href="/painel"]').click())
      await p.waitForSelector('[role="dialog"]')
      await submit(p)
    }, 'Senha incorreta.', '[role="dialog"]'],
  }
  const measure = (page, scope) => page.evaluate((scope) => {
    const useful = document.documentElement.clientWidth
    const area = document.querySelector(scope)
    const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT)
    const texts = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || n.parentElement.closest('.sr-only')) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      texts.push(...range.getClientRects())
    }
    const focusables = [...area.querySelectorAll('input:not([tabindex="-1"]), button')].map((e) => e.getBoundingClientRect())
    // Sem cartão (acordando): o próprio main
    const card = (scope === 'main' ? (area.querySelector('.rounded-\\[14px\\], [role="alert"]') ?? area) : area).getBoundingClientRect()
    return {
      scroll: document.documentElement.scrollWidth - useful,
      texts: texts.length,
      textOut: Math.max(0, ...texts.map((t) => Math.max(t.right - useful, -t.left))),
      focusMargin: Math.min(...focusables.map((r) => Math.min(r.left, useful - r.right))),
      narrowest: Math.min(...focusables.map((r) => r.width)),
      focusables: focusables.length,
      cardOut: card ? Math.max(0, card.right - useful, -card.left) : null,
    }
  }, scope)

  for (const [name, [page, prepare, text, scope]] of Object.entries(STATES)) {
    for (const width of WIDTHS) {
      await page.setViewport({ width, height: 800 })
      await prepare(page)
      await pause(150)
      const shown = await page.evaluate((t) => document.body.textContent.includes(t), text)
      const m = await measure(page, scope)
      const tag = `${name} ${width}px`
      check(`${tag}: "${text}" na tela, com ${m.texts} textos medidos`, shown && m.texts >= 2, `${shown} ${m.texts}`)
      check(`${tag}: sem rolagem lateral`, m.scroll <= 0, `${m.scroll}px`)
      check(`${tag}: textos dentro da tela`, m.textOut <= 0.5, `${m.textOut}px`)
      check(`${tag}: cartão dentro da largura`, m.cardOut !== null && m.cardOut <= 0.5, `${m.cardOut}`)
      // Enquanto acorda não há o que focar; nos outros, folga de todo focável
      check(`${tag}: folga do foco ≥ 4px`, name === 'acordando' ? m.focusables === 0 : m.focusables > 0 && m.focusMargin >= 4, `${m.focusables} focáveis, ${m.focusMargin}px`)
      if (name !== 'acordando' && name !== 'fora do ar') check(`${tag}: campo e botão com ≥ 200px`, m.narrowest >= 200, `${m.narrowest}px`)
      if (width === 320) await page.screenshot({ path: out(`entrada-${name.replace(/ /g, '-')}-320.png`) })
    }
  }

  // Contraste no pixel: fundo = a cor mais frequente da área (CLAUDE.md), texto
  // contado (não leu vazio)
  const contrast = async (page, selector) => {
    const box = await page.$eval(selector, (el) => { const r = el.getBoundingClientRect(); return { left: Math.floor(r.left), top: Math.floor(r.top), right: Math.ceil(r.right), bottom: Math.ceil(r.bottom) } })
    const png = PNG.sync.read(await page.screenshot({ captureBeyondViewport: false }))
    const pixel = (x, y) => { const i = (png.width * y + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]] }
    const counts = new Map()
    for (let x = box.left; x < box.right; x++) for (let y = box.top; y < box.bottom; y++) {
      const key = pixel(x, y).join()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const background = [...counts].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number)
    let best = 0
    let ink = 0
    for (let x = box.left; x < box.right; x++) for (let y = box.top; y < box.bottom; y++) {
      const v = ratio(pixel(x, y), background)
      best = Math.max(best, v)
      if (v >= 3) ink++
    }
    return { best, ink }
  }
  const mark = (page, finder) => page.evaluate((finder) => {
    document.querySelectorAll('[data-c]').forEach((e) => e.removeAttribute('data-c'))
    const el = [...document.querySelectorAll('p, span, h2')].find((e) => e.textContent.trim().startsWith(finder) && !e.closest('.sr-only'))
    el?.setAttribute('data-c', '1')
    return !!el
  }, finder)
  for (const scheme of ['light', 'dark']) {
    for (const page of [p1, p2]) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    const cases = [
      ['senha errada', 'Senha incorreta.'],
      ['senha errada', 'Senha'],
      ['429', 'Muitos pedidos.'],
      ['acordando', 'Ele dorme quando'],
      ['diálogo', 'Entre de novo para continuar.'],
      ['diálogo', 'Sua sessão terminou'],
    ]
    for (const [state, finder] of cases) {
      const [page, prepare] = STATES[state]
      await page.setViewport({ width: 390, height: 800 })
      await prepare(page)
      await pause(200)
      const found = await mark(page, finder)
      const c = found ? await contrast(page, '[data-c]') : { best: 0, ink: 0 }
      check(`contraste ${scheme}, ${state}, "${finder}": ≥ 4,5, lido no texto`, found && c.best >= 4.5 && c.ink > 20, `${found} ${c.best.toFixed(2)} com ${c.ink} pixels`)
      console.log(`contraste ${scheme}, ${state}, "${finder}": ${c.best.toFixed(2)}`)
    }
  }
  // Total fixo: estados × larguras × 5 (+1 com campo e botão) + 12 de contraste
  const expected = 7 * 7 * 5 + 5 * 7 + 12
  check(`checagens feitas = ${expected}`, results.length === expected, String(results.length))
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await plain?.close()
  await withCookie?.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length && ok > 0 ? 0 : 1
}
