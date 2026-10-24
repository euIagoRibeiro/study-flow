// A3f: layout da edição com treino (1401) no Histórico e no cartão da Lista
// (três cartões aninhados), e da lista de exercícios aberta no Histórico.
// Só lê: nada é salvo. 4 estados × 2 lugares × 7 larguras, janela real.
import puppeteer from 'puppeteer-core'
import { APP, CHROME, OUT } from '../config.mjs'

let ok = 0, bad = 0
const check = (cond, msg) => { cond ? ok++ : bad++; if (!cond) console.log('FALHA', msg) }
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const minField = {}

const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  // O cartão do 1401: o artigo mais interno com a descrição (o 1º, mais recente)
  const markCard = () => page.evaluate(() => {
    document.querySelectorAll('[data-t]').forEach((x) => x.removeAttribute('data-t'))
    const own = [...document.querySelectorAll('article')].filter((a) =>
      [...a.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === 'Costas e bíceps'))
    own[0]?.setAttribute('data-t', 'card')
    return own.length
  })
  const C = '[data-t="card"]'
  const S = `${C} section[aria-label="Treino"]`
  const clickText = (scope, text, starts = false) => page.evaluate((s, t, starts) => {
    const b = [...document.querySelector(s).querySelectorAll('button')].find((x) => {
      const v = x.textContent.replace(/\s+/g, ' ').trim()
      return starts ? v.startsWith(t) : v === t
    })
    b.click()
  }, scope, text, starts)
  const places = {
    historico: async () => { await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' }) },
    lista: async () => {
      await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
      await page.evaluate(() => document.querySelector('button[aria-label="Mais ações de Exercício físico"]').click())
      await pause(100)
      await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Ver histórico').click())
      await pause(200)
    },
  }
  const openEdit = () => page.evaluate((C) => document.querySelector(`${C} button[aria-label^="Editar registro"]`).click(), C)
  const states = {
    lista: async () => { await clickText(C, '3 exercícios') },
    editar: async () => { await openEdit() },
    escolha: async () => { await openEdit(); await pause(150); await clickText(S, 'Exercício') },
    aviso: async () => {
      await openEdit()
      await pause(150)
      const v = await page.evaluate((C) => {
        const span = [...document.querySelector(C).querySelectorAll('label > span')].find((s) => s.textContent === 'Em Exercícios')
        const sel = span.parentElement.querySelector('select')
        sel.setAttribute('data-s', 'x')
        return [...sel.options].find((o) => o.textContent.trim() === 'Corrida').value
      }, C)
      await page.select('select[data-s="x"]', v)
    },
  }
  const expected = { lista: /12 × 25, 8 × 35, 8 × 50 kg/, editar: /Adicionar série/, escolha: /Buscar exercício/, aviso: /vai remover o treino \(3 exercícios, 9 séries\)/ }

  for (const width of [320, 360, 375, 414, 768, 1024, 1280]) {
    for (const [place, go] of Object.entries(places)) {
      for (const [state, enter] of Object.entries(states)) {
        await page.setViewport({ width, height: 900 })
        await go()
        const n = await markCard()
        const tag = `${width}px ${place} ${state}`
        if (!n) { check(false, `${tag}: cartão do 1401 não achado`); continue }
        await enter()
        await pause(250)
        const r = await page.evaluate((C) => {
          const de = document.documentElement
          const card = document.querySelector(C)
          const out = [...card.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > de.clientWidth + 0.5).map((el) => el.tagName + ':' + el.textContent.slice(0, 20))
          const gaps = [...card.querySelectorAll('button, input, select')].map((el) => {
            const r = el.getBoundingClientRect()
            let a = el.parentElement, min = Math.min(de.clientWidth - r.right, r.left)
            while (a && a !== document.body) {
              const st = getComputedStyle(a)
              if (st.overflowX !== 'visible' || st.overflowY !== 'visible') {
                const b = a.getBoundingClientRect()
                min = Math.min(min, r.left - b.left, b.right - r.right, r.top - b.top, b.bottom - r.bottom)
              }
              a = a.parentElement
            }
            return min
          })
          const touching = [...card.querySelectorAll('ol[aria-label="Exercícios do treino"] > li')].filter((li) => {
            const menu = li.querySelector('button[aria-haspopup]').getBoundingClientRect()
            const name = (li.querySelector('h4') ?? li.querySelector('button span')).getBoundingClientRect()
            return name.right > menu.left - 2
          }).length
          const inputs = [...card.querySelectorAll('section[aria-label="Treino"] input')].map((i) => Math.round(i.getBoundingClientRect().width))
          return { scroll: de.scrollWidth, util: de.clientWidth, out, minGap: Math.min(...gaps), touching, inputs, text: card.textContent.replace(/\s+/g, ' ') }
        }, C)
        check(r.scroll <= r.util, `${tag}: rolagem lateral ${r.scroll} > ${r.util}`)
        check(r.out.length === 0, `${tag}: fora da tela ${r.out.slice(0, 3)}`)
        check(r.minGap >= 4, `${tag}: foco com folga ${r.minGap}`)
        check(r.touching === 0, `${tag}: nome encostando no ⋯`)
        check(expected[state].test(r.text), `${tag}: estado não montado`)
        if (r.inputs.length) minField[`${place}`] = Math.min(minField[place] ?? 999, ...r.inputs)
        if (width === 320 && state !== 'lista') {
          await page.evaluate((C) => document.querySelector(`${C} section[aria-label="Treino"], ${C} form`)?.scrollIntoView({ block: 'start' }), C)
          await page.screenshot({ path: `${OUT}/a3f-${place}-${state}-320.png` })
        }
        if (width === 320 && state === 'lista') {
          await page.evaluate((C) => document.querySelector(`${C} ul[aria-label="Treino"]`).scrollIntoView({ block: 'center' }), C)
          await page.screenshot({ path: `${OUT}/a3f-${place}-lista-320.png` })
        }
      }
    }
  }
} catch (err) {
  check(false, `erro: ${err.message}`)
} finally {
  await browser.close()
  console.log('menor campo de reps/kg (px):', JSON.stringify(minField))
  console.log(`${ok} de ${ok + bad}`)
  process.exitCode = bad === 0 && ok > 0 ? 0 : 1
}
