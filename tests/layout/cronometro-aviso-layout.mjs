// Layout do aviso do "Iniciar cronômetro" (commit 2c): o bloco "Isto não vai para o cronômetro" no lugar do
// botão Iniciar, em 8 larguras (320 a 1280), claro e escuro, janela real. Confere: sem rolagem lateral, o
// bloco e os botões dentro da coluna, botões empilhados na largura inteira, alvos de toque de 44px, UM só
// botão principal (amarelo) na tela, anel de foco com folga, ordem do Tab (título, Registrar, Iniciar mesmo
// assim, Voltar), texto sem estourar e fonte mínima. Commit 2d: também os botões principais EM VOO (o "Registrar" do
// aviso e o "Iniciar cronômetro", com aria-disabled): largura, alvo de 44px, sem disabled e contraste do texto. Tarefa de teste própria, apagada no fim. Prints em
// tests/out/aviso-<tema>-<largura>.png (320 e 1280). Uso (raiz do repo):
//   node --env-file=backend/.env tests/layout/cronometro-aviso-layout.mjs
import pg from 'pg'
import { APP, CHROME, out } from '../config.mjs'
import { launch } from '../sessao.mjs'
import { pauseRunning, resumeRunning } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a tarefa de teste usa o banco)')
  process.exit(2)
}
let ok = 0, bad = 0
const check = (cond, msg) => { cond ? ok++ : bad++; if (!cond) console.log('FALHOU', msg) }
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const TITLE = 'Teste 2c aviso layout'
await pool.query('DELETE FROM tasks WHERE title = $1 AND id NOT IN (SELECT task_id FROM task_executions)', [TITLE])
const taskId = (await pool.query("INSERT INTO tasks (title, frequency) VALUES ($1, 'none') RETURNING id", [TITLE])).rows[0].id
// A sessão rodando do seed esconderia o botão Iniciar: pausada aqui e devolvida (a linha exata) no fim
const seedSession = await pauseRunning(pool)
// Contraste do botão em voo: o opacity-60 vale para o botão inteiro (texto e fundo clareiam juntos sobre o que está atrás)
const busyMetrics = (label) => page_.evaluate((label) => {
  const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === label)
  if (!b) return null
  const rgb = (css) => {
    const c = document.createElement('canvas'); c.width = c.height = 1
    const x = c.getContext('2d', { willReadFrequently: true })
    x.fillStyle = '#000'; x.fillStyle = css; x.fillRect(0, 0, 1, 1)
    return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3)
  }
  let a = b.parentElement, under = null
  while (a) {
    const bg = getComputedStyle(a).backgroundColor
    if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') { under = rgb(bg); break }
    a = a.parentElement
  }
  under ??= rgb('#ffffff')
  const st = getComputedStyle(b), o = parseFloat(st.opacity)
  const mix = (c) => c.map((v, i) => o * v + (1 - o) * under[i])
  const lum = (c) => { const [r, g, bl] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl }
  const fg = mix(rgb(st.color)), bg = mix(rgb(st.backgroundColor))
  const [hi, lo] = [lum(fg), lum(bg)].sort((p, q) => q - p)
  const r = b.getBoundingClientRect(), box = (b.closest('[role="alert"]') ?? b.closest('main')).getBoundingClientRect()
  return { aria: b.getAttribute('aria-disabled'), disabledAttr: b.hasAttribute('disabled'), opacity: o, ratio: (hi + 0.05) / (lo + 0.05), height: Math.round(r.height), full: r.width >= box.width - 40, cursor: st.cursor }
}, label)
const widths = [320, 360, 375, 414, 640, 768, 1024, 1280]
let browser, page_
try {
  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page_ = page
  page.setDefaultTimeout(10000)
  // O pedido de registro fica parado e depois falha (500): o botão fica em voo e NADA é gravado
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url() === `${APP}/api/executions`) {
      return setTimeout(() => req.respond({ status: 500, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"falha"}' }), 900)
    }
    req.continue()
  })
  const url = `${APP}/executar?tarefa=${taskId}`
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    for (const width of widths) {
      await page.setViewport({ width, height: 900 })
      await page.goto(url, { waitUntil: 'networkidle0' })
      await page.evaluate(() => sessionStorage.clear())
      await page.goto(url, { waitUntil: 'networkidle0' })
      await page.waitForSelector('main form[id^="registrar-"]')
      // a estimativa preenchida (o estado, não o rascunho) e o toque no Iniciar
      await page.evaluate(() => {
        const label = [...document.querySelectorAll('label')].find((x) => x.querySelector('span')?.textContent.trim().startsWith('Duração estimada'))
        const el = label.querySelector('input')
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, '30')
        el.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await pause(100)
      await page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Iniciar cronômetro').click())
      await page.waitForFunction(() => [...document.querySelectorAll('h3')].some((h) => h.textContent.trim() === 'Isto não vai para o cronômetro'))
      await pause(250)
      const tag = `${scheme} ${width}px`
      const m = await page.evaluate(() => {
        const de = document.documentElement
        const main = document.querySelector('main').getBoundingClientRect()
        const h = [...document.querySelectorAll('h3')].find((x) => x.textContent.trim() === 'Isto não vai para o cronômetro')
        const box = h.closest('[role="alert"]')
        const r = box.getBoundingClientRect()
        const buttons = [...box.querySelectorAll('button')]
        const primary = [...document.querySelectorAll('main button')].filter((b) => b.className.includes('bg-marca-texto'))
        const gap = (el) => {
          const b = el.getBoundingClientRect()
          let a = el.parentElement, min = Math.min(de.clientWidth - b.right, b.left)
          while (a && a !== document.body) {
            const st = getComputedStyle(a)
            if (st.overflowX !== 'visible' || st.overflowY !== 'visible') {
              const c = a.getBoundingClientRect()
              min = Math.min(min, b.left - c.left, c.right - b.right, b.top - c.top, c.bottom - b.bottom)
            }
            a = a.parentElement
          }
          return min
        }
        const inner = r.width - ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, k) => sum + parseFloat(getComputedStyle(box)[k]), 0)
        const texts = [...box.querySelectorAll('h3, p, button')]
        return {
          scroll: de.scrollWidth - de.clientWidth,
          boxOut: Math.max(0, r.right - main.right, main.left - r.left),
          labels: buttons.map((b) => b.textContent.trim()),
          heights: buttons.map((b) => Math.round(b.getBoundingClientRect().height)),
          fullWidth: buttons.map((b) => b.getBoundingClientRect().width >= inner - 1),
          primaryCount: primary.length,
          primaryText: primary.map((b) => b.textContent.trim()).join('|'),
          gaps: [h, ...buttons].map(gap),
          overflowing: texts.filter((t) => t.scrollWidth > t.clientWidth + 1).map((t) => t.textContent.trim().slice(0, 20)),
          minFont: Math.min(...texts.map((t) => parseFloat(getComputedStyle(t).fontSize))),
          focusedTitle: document.activeElement === h,
        }
      })
      check(m.scroll <= 0, `${tag}: rolagem lateral ${m.scroll}px`)
      check(m.boxOut <= 0.5, `${tag}: o aviso passa da coluna em ${m.boxOut}px`)
      check(m.labels.join('|') === 'Registrar|Iniciar mesmo assim|Voltar', `${tag}: botões ${m.labels}`)
      check(m.heights.every((h) => h >= 44), `${tag}: alvo de toque menor que 44px ${m.heights}`)
      check(m.fullWidth.every(Boolean), `${tag}: botão que não ocupa a largura do aviso ${m.fullWidth}`)
      check(m.primaryCount === 1 && m.primaryText === 'Registrar', `${tag}: botões principais ${m.primaryCount} (${m.primaryText})`)
      check(m.gaps.every((g) => g >= 4), `${tag}: foco com folga < 4px ${m.gaps.map((g) => Math.round(g))}`)
      check(m.overflowing.length === 0, `${tag}: texto estourando ${m.overflowing}`)
      check(m.minFont >= 13, `${tag}: fonte de ${m.minFont}px`)
      check(m.focusedTitle, `${tag}: o foco não está no título`)
      if (width === 320 || width === 1280) {
        await page.evaluate(() => [...document.querySelectorAll('h3')].find((x) => x.textContent.trim() === 'Isto não vai para o cronômetro').scrollIntoView({ block: 'center' }))
        await pause(150)
        await page.screenshot({ path: out(`aviso-${scheme}-${width}.png`) })
      }
      // ordem do Tab: título -> Registrar -> Iniciar mesmo assim -> Voltar
      const seen = []
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Tab')
        seen.push(await page.evaluate(() => document.activeElement?.textContent.trim() ?? ''))
      }
      check(seen.join('|') === 'Registrar|Iniciar mesmo assim|Voltar', `${tag}: ordem do Tab ${seen}`)
      // "Registrar" do aviso em voo
      await page.evaluate(() => [...document.querySelectorAll('[role="alert"] button')].find((b) => b.textContent.trim() === 'Registrar').click())
      await pause(250)
      const busy = await busyMetrics('Registrar')
      check(busy !== null && busy.aria === 'true' && !busy.disabledAttr, `${tag}: Registrar do aviso em voo sem aria-disabled/com disabled ${JSON.stringify(busy)}`)
      check(busy !== null && busy.height >= 44 && busy.full, `${tag}: Registrar em voo mudou de tamanho ${JSON.stringify(busy)}`)
      check(busy !== null && busy.ratio >= 4.5, `${tag}: contraste do Registrar em voo ${busy?.ratio?.toFixed(2)}`)
      check(busy !== null && busy.opacity < 1 && busy.cursor === 'wait', `${tag}: Registrar em voo sem o sinal visual (opacidade ${busy?.opacity}, cursor ${busy?.cursor})`)
      await pause(900)
      // "Iniciar cronômetro" em voo (sem campos perdidos: parte de página limpa)
      await page.goto(url, { waitUntil: 'networkidle0' })
      await page.evaluate(() => sessionStorage.clear())
      await page.goto(url, { waitUntil: 'networkidle0' })
      await page.waitForSelector('main form[id^="registrar-"]')
      await page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Iniciar cronômetro').click())
      await pause(250)
      const busyStart = await busyMetrics('Iniciar cronômetro')
      check(busyStart !== null && busyStart.aria === 'true' && !busyStart.disabledAttr, `${tag}: Iniciar em voo sem aria-disabled/com disabled ${JSON.stringify(busyStart)}`)
      check(busyStart !== null && busyStart.height >= 44 && busyStart.full, `${tag}: Iniciar em voo mudou de tamanho ${JSON.stringify(busyStart)}`)
      check(busyStart !== null && busyStart.ratio >= 4.5, `${tag}: contraste do Iniciar em voo ${busyStart?.ratio?.toFixed(2)}`)
      check(busyStart !== null && busyStart.opacity < 1 && busyStart.cursor === 'wait', `${tag}: Iniciar em voo sem o sinal visual (opacidade ${busyStart?.opacity}, cursor ${busyStart?.cursor})`)
      await pause(900)
    }
  }
} catch (err) {
  check(false, `erro: ${err.message}`)
} finally {
  await browser?.close().catch(() => {})
  await pool.query('DELETE FROM tasks WHERE id = $1', [taskId])
  await resumeRunning(pool, seedSession)
  const running = (await pool.query('SELECT count(*)::int AS n FROM time_entries WHERE ended_at IS NULL')).rows[0].n
  check(running === seedSession.length, `sessão rodando do seed: ${running} de ${seedSession.length}`)
  const left = (await pool.query('SELECT count(*)::int AS n FROM tasks WHERE title = $1', [TITLE])).rows[0].n
  check(left === 0, `tarefa de teste sobrando: ${left}`)
  await pool.end()
  console.log(`${ok} de ${ok + bad}`)
  process.exitCode = bad === 0 && ok > 0 ? 0 : 1
}
