// S4: layout das seleções na tela de tags, janela real com a barra de rolagem,
// 320 a 1280: seed + pior caso injetado (30 opções de 30 letras sem espaço).
import { API, APP, CHROME, out } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? ` (${detail})` : ''}`)
}
const WIDTHS = [320, 360, 375, 414, 640, 768, 1280]
const selections = await (await apiFetch(`${API}/selections`)).json()
const tags = await (await apiFetch(`${API}/tags`)).json()
const option = (i) => ({ id: crypto.randomUUID(), name: `${'x'.repeat(29)}${i % 10}`, position: i + 1, active: true })
const long = (tagId) => ({ id: crypto.randomUUID(), tagId, name: 'y'.repeat(30), multiple: true, active: true,
  options: Array.from({ length: 30 }, (_, i) => option(i)) })
const byName = (name) => tags.find((t) => t.name === name)
// Nível 3 é a linha mais estreita da árvore
const worst = [...selections, long(byName('Desenho').id), long(byName('Perspectiva').id), long(null)]
const opened = [byName('Desenho').id, byName('Fundamentos').id]

let browser
try {
  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.evaluateOnNewDocument((ids) => localStorage.setItem('studyflow:tags-abertas', JSON.stringify(ids)), opened)
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.method() === 'GET' && req.url() === `${API}/selections`) {
      req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(worst) })
    } else req.continue()
  })
  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 800 })
    await page.goto(`${APP}/tags`, { waitUntil: 'networkidle0' })
    const m = await page.evaluate(() => {
      const useful = document.documentElement.clientWidth
      const rows = [...document.querySelectorAll('p')].filter((p) => p.textContent.startsWith('Seleção:'))
      const general = [...document.querySelectorAll('section[aria-label="Seleções gerais"] li p')]
      const all = [...rows, ...general]
      // Pelo texto (Range), não pela caixa: o bloco não cresce quando o texto estoura
      const rects = (el) => {
        const range = document.createRange()
        range.selectNodeContents(el)
        return [...range.getClientRects()]
      }
      const contentRight = (el) => el.getBoundingClientRect().right - parseFloat(getComputedStyle(el).paddingRight)
      const longGeneral = general.find((el) => el.textContent.startsWith('yyy'))
      const wide = Math.max(...rects(longGeneral).map((r) => r.width))
      return {
        useful,
        scroll: document.documentElement.scrollWidth - useful,
        count: all.length,
        leaks: all.filter((el) => Math.max(...rects(el).map((r) => r.right)) > contentRight(el) + 0.5).length,
        longLines: new Set(rects(longGeneral).map((r) => Math.round(r.top))).size,
        wide: Math.round(wide),
        room: Math.round(contentRight(longGeneral) - longGeneral.getBoundingClientRect().left),
        // Pares em sequência na mesma tag: a de baixo começa depois da de cima
        overlaps: rows.filter((el, i) => {
          const next = rows[i + 1]
          return next && next.closest('li') === el.closest('li') &&
            next.getBoundingClientRect().top < el.getBoundingClientRect().bottom
        }).length,
        // ⋯ da seleção: alvo de 44px, dentro do cartão, sem encostar no texto
        menus: [...document.querySelectorAll('[aria-label^="Mais ações da seleção "]')].map((b) => {
          const r = b.getBoundingClientRect()
          const text = b.parentElement.previousElementSibling
          return { w: r.width, h: r.height, right: r.right, gap: r.left - text.getBoundingClientRect().right, card: b.closest('ul').getBoundingClientRect().right }
        }),
      }
    })
    check(`${width}: sem rolagem lateral`, m.scroll <= 0, `${m.scroll}`)
    check(`${width}: achou todas as linhas`, m.count === selections.filter((s) => s.active).length + 3, `${m.count}`)
    check(`${width}: nenhum texto passa da área da linha`, m.leaks === 0, `${m.leaks}`)
    if (width === 320) {
      check('320: a geral de 30 opções quebra em várias linhas', m.longLines >= 10,
        `${m.longLines} linhas, a maior com ${m.wide}px em ${m.room}px`)
    }
    check(`${width}: linhas sem cobrir umas às outras`, m.overlaps === 0, `${m.overlaps}`)
    check(`${width}: um ⋯ por seleção, 44px, dentro do cartão, a 8px do texto`,
      m.menus.length === m.count && m.menus.every((b) => b.w >= 44 && b.h >= 44 && b.right <= b.card && b.gap >= 7.5),
      `${m.menus.length}; menor folga ${Math.min(...m.menus.map((b) => b.gap)).toFixed(1)}`)
    if (width === 320 || width === 375) await page.screenshot({ path: out(`s4a-${width}.png`) })
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Nova tag').click())
    await page.waitForSelector('form input')
    const f = await page.evaluate(() => {
      const form = document.querySelector('form')
      const hint = form.querySelector('p')
      return { scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        hint: Boolean(hint), inside: hint && hint.getBoundingClientRect().right <= form.getBoundingClientRect().right }
    })
    check(`${width}: formulário "Nova tag" com o aviso dentro`, f.hint && f.inside && f.scroll <= 0, JSON.stringify(f))
    if (width === 320) await page.screenshot({ path: out('s4a-nova-tag-320.png') })

    // S4b: formulários abertos, na raiz, no neto e na geral, com o pior caso
    const clickLabel = async (label, index = 0) => {
      await page.evaluate((l, i) => {
        const el = document.querySelectorAll(`[aria-label="${l}"]`)[i]
        el.scrollIntoView({ block: 'center' })
        el.click()
      }, label, index)
      await page.waitForFunction(() => document.querySelector('[role="menu"]') !== null)
    }
    const clickItem = (text) => page.evaluate((t) =>
      [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.trim().startsWith(t)).click(), text)
    const formState = (selector) => page.evaluate((s) => {
      const useful = document.documentElement.clientWidth
      const form = document.querySelector(s)
      const box = form.getBoundingClientRect()
      const inputs = [...form.querySelectorAll('input[type="text"]')]
      // sr-only tem 1px, fora do fluxo: mediria o recorte, não o texto
      const texts = [...form.querySelectorAll('p, span, legend, button')].filter((el) => el.textContent.trim() && !el.matches('.sr-only'))
      const leak = texts.filter((el) => {
        const range = document.createRange()
        range.selectNodeContents(el)
        return [...range.getClientRects()].some((r) => r.right > box.right + 0.5 || r.left < box.left - 0.5)
      })
      return {
        scroll: document.documentElement.scrollWidth - useful,
        leak: leak.map((el) => el.textContent.slice(0, 20)),
        inputs: inputs.length,
        minInput: Math.round(Math.min(...inputs.map((i) => i.getBoundingClientRect().width))),
        targets: [...form.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height < 40).length,
        outside: inputs.filter((i) => i.getBoundingClientRect().right > box.right + 0.5).length,
      }
    }, selector)
    // Tudo dentro do form, foco sem cortar (4px do anel)
    const focusRoom = (selector) => page.evaluate(async (s) => {
      const form = document.querySelector(s)
      const parent = form.parentElement.closest('li, div') ?? form
      const card = parent.getBoundingClientRect()
      let min = Infinity
      for (const el of form.querySelectorAll('input, button')) {
        min = Math.min(min, card.right - el.getBoundingClientRect().right)
      }
      return Math.round(min * 10) / 10
    }, selector)
    const judge = async (name, selector) => {
      const s = await formState(selector)
      check(`${width}: ${name}: sem rolagem, nada vaza, campos ≥ 100px, botões ≥ 40px`,
        s.scroll <= 0 && s.leak.length === 0 && s.outside === 0 && s.minInput >= 100 && s.targets === 0 && s.inputs > 0, JSON.stringify(s))
      check(`${width}: ${name}: folga pro anel de foco`, (await focusRoom(selector)) >= 4, `${await focusRoom(selector)}`)
    }
    await page.reload({ waitUntil: 'networkidle0' })

    // Criar na raiz
    await clickLabel('Mais ações de Desenho')
    await clickItem('Nova seleção')
    const fresh = 'form[aria-label="Nova seleção em Desenho"]'
    await page.waitForSelector(fresh)
    await page.evaluate((s) => {
      const plus = [...document.querySelector(s).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Opção')
      plus.click(); plus.click()
    }, fresh)
    await page.waitForSelector(`${fresh} input[aria-label="Opção 3"]`)
    await judge('criar na raiz', fresh)
    if (width === 320) await page.screenshot({ path: out('s4b-criar-320.png') })
    await page.reload({ waitUntil: 'networkidle0' })

    // Criar e editar no neto, a linha mais estreita
    await clickLabel('Mais ações de Desenho › Fundamentos › Perspectiva')
    await clickItem('Nova seleção')
    const leafNew = 'form[aria-label="Nova seleção em Perspectiva"]'
    await page.waitForSelector(leafNew)
    await judge('criar no neto', leafNew)
    await page.reload({ waitUntil: 'networkidle0' })
    await clickLabel(`Mais ações da seleção ${'y'.repeat(30)}`, 1)
    await clickItem('Editar')
    const longForm = `form[aria-label="Seleção ${'y'.repeat(30)}"]`
    await page.waitForSelector(longForm)
    await judge('editar no neto, 30 opções', longForm)
    if (width === 320) await page.screenshot({ path: out('s4b-editar-320.png') })
    await page.reload({ waitUntil: 'networkidle0' })

    // Geral
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Nova seleção geral').click())
    const generalNew = 'form[aria-label="Nova seleção geral"]'
    await page.waitForSelector(generalNew)
    await judge('criar geral', generalNew)
    await page.reload({ waitUntil: 'networkidle0' })
    await clickLabel(`Mais ações da seleção ${'y'.repeat(30)}`, 2)
    await clickItem('Editar')
    await page.waitForSelector(longForm)
    await judge('editar geral, 30 opções', longForm)
    if (width === 375) {
      await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'start' }), longForm)
      await page.screenshot({ path: out('s4b-editar-geral-375.png') })
    }
  }
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser?.close().catch(() => {})
}
console.log(`\n${results.filter(Boolean).length} de ${results.length}`)
process.exitCode = results.every(Boolean) ? 0 : 1
