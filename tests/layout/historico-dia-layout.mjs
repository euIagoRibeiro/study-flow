// Layout do filtro por dia do Histórico (commit C2): a linha "Dia: …" com o botão "Limpar", e a mensagem de dia vazio, em 8
// larguras (320 a 1280), claro e escuro, janela real (com a barra de rolagem). Confere: sem rolagem lateral da página nem
// da faixa de chips, a linha dentro da coluna, "Limpar" com alvo de 44 px (altura e largura), anel de foco com folga e
// dentro da janela, a ordem do Tab (chips, Limpar, Frequência), fonte mínima e contraste do texto (4,5:1) da linha e do
// botão. Usa os dados do seed (dia mais cheio e um dia sem registro, de 2000). Prints em tests/out/dia-<tema>-<largura>.png
// (320 e 1280). Nada é gravado. Uso: node --env-file=backend/.env tests/layout/historico-dia-layout.mjs
import { API, APP, CHROME, out } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'

let ok = 0
let bad = 0
const check = (cond, msg) => { cond ? ok++ : bad++; if (!cond) console.log('FALHOU', msg) }
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const TZ = 'America/Sao_Paulo'
const keyOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso))

const executions = (await (await apiFetch(`${API}/executions`)).json()).filter((e) => e.completedAt !== null)
const byDay = new Map()
for (const e of executions) byDay.set(keyOf(e.completedAt), (byDay.get(keyOf(e.completedAt)) ?? 0) + 1)
const busyDay = [...byDay].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0]?.[0]
if (!busyDay) throw new Error('o seed não tem registro concluído')

const widths = [320, 360, 375, 414, 640, 768, 1024, 1280]
const measure = (page) => page.evaluate(() => {
  const rgb = (css) => {
    const c = document.createElement('canvas'); c.width = c.height = 1
    const x = c.getContext('2d', { willReadFrequently: true })
    x.fillStyle = '#000'; x.fillStyle = css; x.fillRect(0, 0, 1, 1)
    return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3)
  }
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const backdrop = (el) => {
    for (let a = el; a; a = a.parentElement) {
      const bg = getComputedStyle(a).backgroundColor
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return rgb(bg)
    }
    return rgb(getComputedStyle(document.body).backgroundColor)
  }
  const contrast = (el) => {
    const [hi, lo] = [lum(rgb(getComputedStyle(el).color)), lum(backdrop(el))].sort((p, q) => q - p)
    return (hi + 0.05) / (lo + 0.05)
  }
  const label = [...document.querySelectorAll('main span')].find((s) => s.textContent.startsWith('Dia:'))
  const clear = document.querySelector('button[aria-label="Limpar filtro do dia"]')
  const message = [...document.querySelectorAll('main p')].find((p) => /^Nenhum/.test(p.textContent.trim()))
  const column = document.querySelector('main').getBoundingClientRect()
  const row = label?.parentElement.getBoundingClientRect()
  const c = clear?.getBoundingClientRect()
  const value = label?.querySelector('span')
  const chipScroller = document.querySelector('[role="group"][aria-label="Período"]')
  return {
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    chipsOverflowBar: chipScroller ? chipScroller.offsetHeight - chipScroller.clientHeight : 0,
    hasRow: !!label,
    rowInside: row ? row.left >= column.left - 1 && row.right <= column.right + 1 : null,
    clear: c ? { h: Math.round(c.height), w: Math.round(c.width), inside: c.left >= column.left - 1 && c.right <= column.right + 1 } : null,
    fonts: [label, value, clear, message].filter(Boolean).map((el) => parseFloat(getComputedStyle(el).fontSize)),
    contrast: { label: label ? contrast(label) : null, value: value ? contrast(value) : null, clear: clear ? contrast(clear) : null, message: message ? contrast(message) : null },
    messageInside: message ? message.getBoundingClientRect().right <= column.right + 1 && message.getBoundingClientRect().left >= column.left - 1 : null,
    messageText: message?.textContent.trim() ?? null,
  }
})

let browser
try {
  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.emulateTimezone(TZ)
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    for (const width of widths) {
      const tag = `${scheme} ${width}`
      await page.setViewport({ width, height: 900 })
      for (const [dia, empty] of [[busyDay, false], ['2000-01-01', true]]) {
        await page.goto(`${APP}/historico?dia=${dia}`, { waitUntil: 'networkidle0' })
        await page.waitForSelector('button[aria-label="Limpar filtro do dia"]')
        await pause(200)
        const m = await measure(page)
        const t = `${tag} ${empty ? '(dia vazio, com o ano)' : '(dia cheio)'}`
        check(m.pageOverflow <= 0, `${t}: rolagem lateral da página ${m.pageOverflow}px`)
        check(m.chipsOverflowBar === 0, `${t}: barra na faixa de chips ${m.chipsOverflowBar}px`)
        check(m.hasRow && m.rowInside === true, `${t}: a linha do dia dentro da coluna`)
        check(m.clear !== null && m.clear.h >= 44 && m.clear.w >= 44 && m.clear.inside, `${t}: alvo do Limpar ${JSON.stringify(m.clear)}`)
        check(m.fonts.length === (empty ? 4 : 3) && m.fonts.every((f) => f >= 12), `${t}: fonte mínima ${m.fonts.join(',')}`)
        for (const [name, ratio] of Object.entries(m.contrast)) {
          if (ratio !== null) check(ratio >= 4.5, `${t}: contraste de ${name} ${ratio.toFixed(2)}`)
        }
        if (empty) check(m.messageInside === true && m.messageText === 'Nenhum registro em sáb, 1 jan 2000.', `${t}: mensagem do dia vazio ${m.messageText}`)

        // Tab: o foco passa pelo Limpar antes da Frequência e o anel fica dentro da janela
        await page.evaluate(() => document.activeElement?.blur())
        await page.evaluate(() => document.querySelector('[role="group"][aria-label="Período"] button:last-child')?.focus())
        const order = []
        for (let i = 0; i < 4; i++) {
          await page.keyboard.press('Tab')
          order.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim()))
          const ring = await page.evaluate(() => {
            const el = document.activeElement
            if (el?.getAttribute('aria-label') !== 'Limpar filtro do dia') return null
            const r = el.getBoundingClientRect()
            const o = parseFloat(getComputedStyle(el).outlineWidth) + parseFloat(getComputedStyle(el).outlineOffset)
            return { left: r.left - o, right: r.right + o, top: r.top - o, vw: document.documentElement.clientWidth, style: getComputedStyle(el).outlineStyle }
          })
          if (ring) check(ring.left >= 0 && ring.right <= ring.vw && ring.style !== 'none', `${t}: anel de foco do Limpar ${JSON.stringify(ring)}`)
        }
        const iClear = order.indexOf('Limpar filtro do dia')
        const iFreq = order.indexOf('Frequência')
        check(iClear >= 0 && iFreq > iClear, `${t}: ordem do Tab ${order.join(' > ')}`)
        if (!empty && (width === 320 || width === 1280)) await page.screenshot({ path: out(`dia-${scheme}-${width}.png`) })
      }
    }
  }
} finally {
  await browser?.close().catch(() => {})
}
console.log(`\n${ok} de ${ok + bad}`)
process.exitCode = bad === 0 && ok > 0 ? 0 : 1
