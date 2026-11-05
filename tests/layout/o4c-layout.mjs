// O4c: campos Obra e Link no lápis, no Histórico e no cartão da Lista (o mais
// estreito), janela real com a barra de rolagem, 320 a 1280. Registro do seed
// com obra (o mais recente de Desenhar, lido pela API: o texto não fica aqui).
// Estados: seed (a obra do registro, Link fechado: o "+ Link" com alvo de toque
// de 44px e folga do foco) e "longa" (Link aberto): lista de obras injetada
// (títulos de 100 letras, sem espaço, em todos os status) e a obra escolhida com
// as 3 marcas, a linha da tarefa padrão (tarefa de 100 letras) e a nota da
// medida, com uma medida de 30 letras injetada no caminho; link de 2000
// caracteres. "longa-tipos": o mesmo, com a medida de 30 letras COM tipos (o
// rótulo vira a legenda do fieldset). Nada é gravado (o Salvar não é tocado): a bateria confere que
// nenhum pedido de escrita saiu. Uma checagem por texto medido (o total não
// cresce quando falha) e a contagem mínima de textos, fixa.
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME, out } from '../config.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const WIDTHS = [320, 360, 375, 414, 640, 768, 1280]
const FORM = 'form[id^="editar-"]'
const [works, tags, tasks, measures, executions] = await Promise.all(['works', 'tags', 'tasks', 'measures', 'executions'].map(async (p) => (await fetch(`${API}/${p}`)).json()))
const desenho = tags.find((t) => t.name === 'Desenho' && t.parentId === null)
const inktober = tags.find((t) => t.name === 'Inktober' && t.parentId === desenho.id)
const task = tasks.find((t) => t.title === 'Desenhar')
const record = executions
  .filter((e) => e.taskId === task.id && e.completedAt && e.workId && e.description)
  .sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1))[0]
const capitulos = measures.find((m) => m.name === 'capítulos')
const longMeasure = { id: crypto.randomUUID(), tagId: inktober.id, name: 'm'.repeat(30), singular: 'm'.repeat(30), allowsDecimal: false, active: true, kinds: [] }
const STATUSES = ['em_andamento', 'pausado', 'concluido', 'abandonado']
const fake = (i, extra = {}) => ({
  id: crypto.randomUUID(), title: `${String(i).padStart(2, '0')}${'o'.repeat(98)}`, status: STATUSES[i % 4],
  defaultTagId: inktober.id, defaultTaskId: task.id, measureId: null, total: null, url: null,
  defaultTagActive: true, defaultTaskActive: true, measureCurrent: true, records: 0, seconds: 0, progress: null, ...extra,
})
// A escolhida: soma "capítulos" (real) num caminho cuja medida é a injetada;
// caminho e tarefa arquivados de mentira (as 3 marcas); a tarefa padrão é outra,
// de nome longo sem espaço (a linha da tarefa)
const longTask = { id: crypto.randomUUID(), title: 't'.repeat(100), frequency: 'none', active: false }
const stale = fake(99, { status: 'em_andamento', measureId: capitulos.id, measureCurrent: false, defaultTagActive: false, defaultTaskActive: false, defaultTaskId: longTask.id })
const injectedWorks = JSON.stringify([...works, ...Array.from({ length: 20 }, (_, i) => fake(i)), stale])
const injectedMeasures = JSON.stringify([...measures, longMeasure])
// A mesma medida com tipos: o rótulo vira a legenda do fieldset
const injectedKinds = JSON.stringify([...measures, { ...longMeasure, kinds: [{ id: crypto.randomUUID(), name: 'leitura', active: true }, { id: crypto.randomUUID(), name: 'questões', active: true }] }])
let measuresBody = injectedMeasures
const injectedTasks = JSON.stringify([...tasks, longTask])
const LINK = `https://exemplo.com/${'a'.repeat(1980)}`

let browser
try {
  if (!record) throw new Error('registro de Desenhar com obra e descrição não achado no seed')
  browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  let injected = false
  const writes = []
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.method() !== 'GET' && req.method() !== 'OPTIONS') writes.push(`${req.method()} ${req.url()}`)
    const body = !injected || req.method() !== 'GET' ? null
      : req.url() === `${API}/works` ? injectedWorks
        : req.url() === `${API}/measures` ? measuresBody
          : req.url() === `${API}/tasks` ? injectedTasks : null
    if (body) req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body })
    else req.continue()
  })
  const pencil = async () => {
    const done = await page.evaluate((d) => {
      const b = [...document.querySelectorAll('article')].find((x) => [...x.querySelectorAll(':scope > p')].some((p) => p.textContent.trim() === d))?.querySelector('button[aria-label^="Editar registro"]')
      b?.click()
      return Boolean(b)
    }, record.description)
    if (!done) throw new Error('lápis do registro não achado')
    await page.waitForSelector(`${FORM} [data-work-field]`)
  }
  const places = {
    historico: async () => {
      await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
      await page.evaluate(() => sessionStorage.clear())
      await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
      await pencil()
    },
    lista: async () => {
      await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
      await page.evaluate(() => sessionStorage.clear())
      await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
      await page.evaluate((t) => document.querySelector(`button[aria-label="Mais ações de ${t}"]`).click(), task.title)
      await pause(150)
      await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim() === 'Ver histórico').click())
      await pause(300)
      await pencil()
    },
  }
  const states = {
    seed: async (enter) => { injected = false; await enter() },
    longa: async (enter, body = injectedMeasures) => {
      injected = true
      measuresBody = body
      await enter()
      await page.evaluate((FORM, id) => {
        const s = [...document.querySelectorAll(`${FORM} label`)].find((l) => l.querySelector('span')?.textContent === 'Obra').querySelector('select')
        s.value = id
        s.dispatchEvent(new Event('change', { bubbles: true }))
      }, FORM, stale.id)
      await pause(300)
      await page.evaluate((FORM) => document.querySelector(`${FORM} [data-link-field] button`).click(), FORM)
      await pause(150)
      const input = await page.$(`${FORM} [data-link-field] input`)
      await input.evaluate((el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }, LINK)
      await page.waitForNetworkIdle()
    },
    'longa-tipos': async (enter) => {
      await states.longa(enter, injectedKinds)
    },
  }
  for (const [place, enter] of Object.entries(places)) for (const [state, into] of Object.entries(states)) {
    for (const width of WIDTHS) {
      await page.setViewport({ width, height: 800 })
      await into(enter)
      const m = await page.evaluate((FORM) => {
        const useful = document.documentElement.clientWidth
        const form = document.querySelector(FORM)
        const box = form.getBoundingClientRect()
        const card = form.closest('article').getBoundingClientRect()
        const out = []
        const walker = document.createTreeWalker(form, NodeFilter.SHOW_TEXT)
        let texts = 0
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent.trim() || node.parentElement.closest('select, button')) continue
          const range = document.createRange()
          range.selectNodeContents(node)
          const leak = [...range.getClientRects()].find((r) => r.right > box.right + 0.5 || r.left < box.left - 0.5)
          texts++
          out.push({ ok: !leak, what: `texto vaza: "${node.textContent.slice(0, 25)}"${leak ? ` ${leak.left.toFixed(1)}..${leak.right.toFixed(1)} em ${box.left.toFixed(1)}..${box.right.toFixed(1)}` : ''}` })
        }
        const notes = form.querySelectorAll('[data-work-field] p, p[data-work-field]').length
        const controls = [...form.querySelectorAll('[data-work-field] select, [data-link-field] input, [data-link-field] button')]
        const linkButton = form.querySelector('[data-link-field] button')
        const legend = [...form.querySelectorAll('fieldset > legend')].some((l) => l.textContent.startsWith('M'.concat('m'.repeat(29))))
        return {
          out,
          texts,
          notes,
          fields: form.querySelectorAll('[data-work-field] select').length + form.querySelectorAll('[data-link-field] input, [data-link-field] button').length,
          linkOpen: form.querySelector('[data-link-field] input') !== null,
          legend,
          buttonHeight: linkButton ? linkButton.getBoundingClientRect().height : null,
          scroll: document.documentElement.scrollWidth - useful,
          formOut: Math.max(0, box.right - card.right, card.left - box.left),
          controlOut: Math.max(0, ...controls.map((c) => { const r = c.getBoundingClientRect(); return Math.max(r.right - box.right, box.left - r.left) })),
          margin: Math.min(...controls.map((c) => { const r = c.getBoundingClientRect(); return Math.min(r.left, useful - r.right) })),
        }
      }, FORM)
      const tag = `${place} ${state} ${width}`
      for (const r of m.out) check(`${tag}: ${r.what}`, r.ok, r.what)
      // Fixas: os dois campos, as notas esperadas e o mínimo de textos (rótulos Obra e Link + notas)
      check(`${tag}: campos Obra e Link presentes`, m.fields === 2, String(m.fields))
      if (state === 'seed') check(`${tag}: Link fechado, "+ Link" com ≥ 44px de altura`, !m.linkOpen && m.buttonHeight >= 44, `${m.linkOpen} ${m.buttonHeight}px`)
      else check(`${tag}: Link aberto`, m.linkOpen)
      check(`${tag}: notas esperadas (${state === 'seed' ? 0 : 5})`, m.notes === (state === 'seed' ? 0 : 5), String(m.notes))
      if (state === 'longa-tipos') check(`${tag}: medida com tipos, legenda de 30 letras presente`, m.legend, String(m.legend))
      check(`${tag}: textos medidos: ${m.texts}, esperado ao menos ${m.notes + 2}`, m.texts > 0 && m.texts >= m.notes + 2, String(m.texts))
      check(`${tag}: sem rolagem lateral`, m.scroll <= 0, `${m.scroll}px`)
      check(`${tag}: formulário dentro do cartão`, m.formOut <= 0.5, `${m.formOut}px`)
      check(`${tag}: campos dentro do formulário`, m.controlOut <= 0.5, `${m.controlOut}px`)
      check(`${tag}: folga do foco ≥ 4px`, m.margin >= 4, `${m.margin}px`)
      if (width === 320) {
        await page.evaluate((FORM) => document.querySelector(`${FORM} [data-work-field]`).scrollIntoView({ block: 'start' }), FORM)
        await page.screenshot({ path: out(`o4c-${place}-${state}-320.png`) })
        await page.evaluate((FORM) => document.querySelector(`${FORM} [data-link-field]`).scrollIntoView({ block: 'end' }), FORM)
        await page.screenshot({ path: out(`o4c-${place}-${state}-320-fim.png`) })
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
