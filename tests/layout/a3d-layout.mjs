import puppeteer from 'puppeteer-core'
import { APP, CHROME, OUT } from '../config.mjs'
const b = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
let ok = 0, bad = 0
const check = (cond, msg) => { cond ? ok++ : bad++; if (!cond) console.log('FALHA', msg) }
try {
  const p = await b.newPage()
  for (const w of [320, 360, 375, 414, 768, 1024, 1280]) {
    await p.setViewport({ width: w, height: 800 })
    await p.goto(`${APP}/tags`, { waitUntil: 'networkidle0' })
    await p.evaluate(() => {
      const t = document.querySelector('button[aria-label="Subtags de Exercícios"]')
      if (t.getAttribute('aria-expanded') !== 'true') t.click()
    })
    await new Promise((r) => setTimeout(r, 150))
    // abre os arquivados
    await p.evaluate(() => document.querySelector('section[aria-label="Exercícios"] button[aria-expanded]:not([aria-haspopup])').click())
    await new Promise((r) => setTimeout(r, 150))
    const r = await p.evaluate(() => {
      const de = document.documentElement
      const sec = document.querySelector('section[aria-label="Exercícios"]')
      const card = sec.querySelector('ul').parentElement.getBoundingClientRect()
      const rows = [...sec.querySelectorAll('li')].map((li) => {
        const name = li.querySelector('span').getBoundingClientRect()
        const count = li.querySelector('span.tabular-nums').getBoundingClientRect()
        const line2 = li.querySelector('span.tabular-nums').parentElement.getBoundingClientRect()
        const menu = li.querySelector('button[aria-haspopup]').getBoundingClientRect()
        const row = li.getBoundingClientRect()
        const lines = Math.round(name.height / parseFloat(getComputedStyle(li.querySelector('span')).lineHeight))
        return { n: li.querySelector('span').textContent.trim(), below: count.top >= name.bottom - 0.5,
          countLeft: Math.abs(line2.left - name.left) < 1, archived: li.textContent.includes('Arquivado'), menuIn: menu.right <= card.right + 0.5 && menu.left >= name.right - 0.5,
          menuCenter: Math.abs((menu.top + menu.bottom) / 2 - (row.top + row.bottom) / 2), lines, h: row.height }
      })
      const treino = [...document.querySelectorAll('span')].filter((s) => s.textContent === 'Treino' && !s.children.length).map((s) => s.getBoundingClientRect().right <= de.clientWidth)
      return { útil: de.clientWidth, scroll: de.scrollWidth, cardRight: card.right, rows, treino }
    })
    const tag = `${w}px`
    check(r.scroll <= r.útil, `${tag} rolagem lateral ${r.scroll} > ${r.útil}`)
    check(r.cardRight <= r.útil, `${tag} cartão passa da borda`)
    check(r.rows.length === 7, `${tag} esperadas 7 linhas, achou ${r.rows.length}`)
    check(r.rows.every((x) => x.below && x.countLeft), `${tag} contagem fora do lugar: ${r.rows.filter((x) => !x.below || !x.countLeft).map((x) => x.n)}`)
    check(r.rows.every((x) => x.menuIn), `${tag} ⋯ fora do cartão ou sobre o nome`)
    check(r.rows.every((x) => x.menuCenter < 1), `${tag} ⋯ fora do centro da linha`)
    for (const arch of [false, true]) {
      const one = r.rows.filter((x) => x.lines === 1 && x.archived === arch).map((x) => x.h)
      check(one.length > 0 && Math.max(...one) - Math.min(...one) < 0.5, `${tag} linhas de 1 linha (arquivado=${arch}) com alturas diferentes: ${one}`)
    }
    check(r.treino.length === 2 && r.treino.every(Boolean), `${tag} chips Treino: ${JSON.stringify(r.treino)}`)
    console.log(`${tag} (útil ${r.útil}): linhas ${r.rows.length}, nome em 2+ linhas: ${r.rows.filter((x) => x.lines > 1).map((x) => x.n).join(', ') || 'nenhum'}; alturas ${[...new Set(r.rows.map((x) => x.h))].join('/')}`)

    // foco por teclado no ⋯ do último exercício: folga até o ancestral que corta
    const gap = await p.evaluate(() => {
      const btns = [...document.querySelectorAll('section[aria-label="Exercícios"] button[aria-haspopup]')]
      const btn = btns[btns.length - 1]
      btn.focus()
      const r = btn.getBoundingClientRect()
      let el = btn.parentElement, min = Infinity
      while (el && el !== document.body) {
        const s = getComputedStyle(el)
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
          const a = el.getBoundingClientRect()
          min = Math.min(min, r.left - a.left, a.right - r.right, r.top - a.top, a.bottom - r.bottom)
        }
        el = el.parentElement
      }
      return Math.min(min, document.documentElement.clientWidth - r.right)
    })
    check(gap >= 4, `${tag} anel de foco cortado (folga ${gap})`)

    if (w === 320 || w === 375) {
      await p.evaluate(() => document.querySelector('section[aria-label="Exercícios"]').scrollIntoView({ block: 'center' }))
      await p.screenshot({ path: `${OUT}/catalogo-${w}.png` })
    }

    // formulário de renomear aberto (sem salvar)
    await p.evaluate(() => document.querySelector('button[aria-label="Mais ações do exercício Rosca martelo unilateral com halteres"]').click())
    await p.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent === 'Renomear').click())
    await new Promise((r) => setTimeout(r, 150))
    const f = await p.evaluate(() => {
      const de = document.documentElement
      const form = document.querySelector('section[aria-label="Exercícios"] form')
      if (!form) return null
      const els = [...form.querySelectorAll('input, button')].map((e) => e.getBoundingClientRect().right)
      return { scroll: de.scrollWidth, útil: de.clientWidth, maxRight: Math.max(...els) }
    })
    check(f && f.scroll <= f.útil && f.maxRight <= f.útil, `${tag} formulário de renomear vaza: ${JSON.stringify(f)}`)
    if (w === 320) {
      await p.evaluate(() => document.querySelector('section[aria-label="Exercícios"] form').scrollIntoView({ block: 'center' }))
      await p.screenshot({ path: `${OUT}/renomear-320.png` })
    }
  }
} finally {
  await b.close()
}
console.log(`${ok} de ${ok + bad}`)
process.exitCode = bad === 0 && ok > 0 ? 0 : 1
