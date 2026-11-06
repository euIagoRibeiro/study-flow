// O4b: campos Obra e Link no painel do cronômetro, rodando e pausado (as duas
// sessões abertas do seed), janela real com a barra de rolagem, 320 a 1280.
// Estados: seed (nenhuma obra, Link fechado: o "+ Link" com alvo de toque de 44px
// e folga do foco) e "longa" (Link aberto): lista de obras injetada (títulos de
// 100 letras, sem espaço, em todos os status) e a obra escolhida com as 3 marcas,
// a linha da tarefa padrão (tarefa de 100 letras) e a nota da medida, com uma
// medida de 30 letras injetada no caminho dela; link de 2000 caracteres. Nada é
// gravado (o Finalizar não é tocado, e o caminho escolhido não tem treino): a
// bateria confere que nenhum pedido de escrita saiu. Uma checagem por texto
// medido (o total não cresce quando falha) e a contagem mínima de textos, fixa.
// A sessão rodando do seed vai com o início 25 min atrás na resposta da API (o
// seed a ancora no reseed; com 2h, o "Durou" abriria e o total mudaria).
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME, out } from '../config.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const WIDTHS = [320, 360, 375, 414, 640, 768, 1280]
const [works, tags, tasks, measures] = await Promise.all(['works', 'tags', 'tasks', 'measures'].map(async (p) => (await fetch(`${API}/${p}`)).json()))
const desenho = tags.find((t) => t.name === 'Desenho' && t.parentId === null)
const inktober = tags.find((t) => t.name === 'Inktober' && t.parentId === desenho.id)
const task = tasks.find((t) => t.title === 'Desenhar')
const PANELS = [['rodando', '5eed0000-0000-4000-8000-000000000002'], ['pausado', '5eed0000-0000-4000-8000-000000000004']]
const capitulos = measures.find((m) => m.name === 'capítulos')
const longMeasure = { id: crypto.randomUUID(), tagId: inktober.id, name: 'm'.repeat(30), singular: 'm'.repeat(30), allowsDecimal: false, active: true, kinds: [] }
const STATUSES = ['em_andamento', 'pausado', 'concluido', 'abandonado']
const fake = (i, extra = {}) => ({
  id: crypto.randomUUID(), title: `${String(i).padStart(2, '0')}${'o'.repeat(98)}`, status: STATUSES[i % 4],
  defaultTagId: inktober.id, defaultTaskId: task.id, measureId: null, total: null, url: null,
  defaultTagActive: true, defaultTaskActive: true, measureCurrent: true, records: 0, seconds: 0, progress: null, ...extra,
})
// A escolhida: soma "capítulos" (real) num caminho cuja medida é a injetada;
// caminho e tarefa arquivados de mentira (as 3 marcas). Caminho "arquivado" na
// resposta, mas a tag existe ativa na tela: a obra preenche Desenho › Inktober.
// A tarefa padrão é outra, de nome longo sem espaço (a linha da tarefa)
const longTask = { id: crypto.randomUUID(), title: 't'.repeat(100), frequency: 'none', active: false }
const stale = fake(99, { status: 'em_andamento', measureId: capitulos.id, measureCurrent: false, defaultTagActive: false, defaultTaskActive: false, defaultTaskId: longTask.id })
const injectedWorks = JSON.stringify([...works, ...Array.from({ length: 20 }, (_, i) => fake(i)), stale])
const injectedMeasures = JSON.stringify([...measures, longMeasure])
const injectedTasks = JSON.stringify([...tasks, longTask])
const LINK = `https://exemplo.com/${'a'.repeat(1980)}`
const entries = await (await fetch(`${API}/time-entries`)).json()
const running = entries.find((e) => e.endedAt === null && e.taskExecutionId.startsWith('5eed'))

let browser
try {
  if (!running) throw new Error('sessão rodando do seed não achada')
  browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  let injected = false
  let runningStart = null
  const writes = []
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.method() !== 'GET' && req.method() !== 'OPTIONS') writes.push(`${req.method()} ${req.url()}`)
    const entriesBody = req.method() === 'GET' && req.url() === `${API}/time-entries`
      ? JSON.stringify(entries.map((e) => (e.id === running.id ? { ...e, startedAt: runningStart } : e))) : null
    const body = entriesBody ?? (!injected || req.method() !== 'GET' ? null
      : req.url() === `${API}/works` ? injectedWorks
        : req.url() === `${API}/measures` ? injectedMeasures
          : req.url() === `${API}/tasks` ? injectedTasks : null)
    if (body) req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body })
    else req.continue()
  })
  let panelTask = null
  const open = async () => {
    runningStart = new Date(Date.now() - 25 * 60e3).toISOString()
    await page.goto(`${APP}/executar?tarefa=${panelTask}`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => sessionStorage.clear())
    await page.goto(`${APP}/executar?tarefa=${panelTask}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('main form[id^="finalizar-"] [data-work-field]')
  }
  const states = {
    seed: async () => { injected = false; await open() },
    longa: async () => {
      injected = true
      await open()
      await page.evaluate((id) => {
        const s = [...document.querySelectorAll('main form label')].find((l) => l.querySelector('span')?.textContent === 'Obra').querySelector('select')
        s.value = id
        s.dispatchEvent(new Event('change', { bubbles: true }))
      }, stale.id)
      await new Promise((r) => setTimeout(r, 300))
      await page.evaluate(() => document.querySelector('main form [data-link-field] button').click())
      await new Promise((r) => setTimeout(r, 150))
      const input = await page.$('main form [data-link-field] input')
      await input.evaluate((el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }, LINK)
      await page.waitForNetworkIdle()
    },
  }
  for (const [panel, taskId] of PANELS) for (const [state, enter] of Object.entries(states)) {
    panelTask = taskId
    for (const width of WIDTHS) {
      await page.setViewport({ width, height: 800 })
      await enter()
      const m = await page.evaluate(() => {
        const useful = document.documentElement.clientWidth
        const form = document.querySelector('main form[id^="finalizar-"]')
        const box = form.getBoundingClientRect()
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
        return {
          out,
          texts,
          notes,
          longWarning: document.querySelector('main [data-long-warning]') !== null,
          fields: form.querySelectorAll('[data-work-field] select').length + form.querySelectorAll('[data-link-field] input, [data-link-field] button').length,
          linkOpen: form.querySelector('[data-link-field] input') !== null,
          buttonHeight: linkButton ? linkButton.getBoundingClientRect().height : null,
          scroll: document.documentElement.scrollWidth - useful,
          controlOut: Math.max(0, ...controls.map((c) => { const r = c.getBoundingClientRect(); return Math.max(r.right - box.right, box.left - r.left) })),
          margin: Math.min(...controls.map((c) => { const r = c.getBoundingClientRect(); return Math.min(r.left, useful - r.right) })),
        }
      })
      const tag = `${panel} ${state} ${width}`
      for (const r of m.out) check(`${tag}: ${r.what}`, r.ok, r.what)
      // Fixas: os dois campos, as notas esperadas e o mínimo de textos (rótulos Obra e Link + notas)
      check(`${tag}: campos Obra e Link presentes`, m.fields === 2, String(m.fields))
      check(`${tag}: sem aviso de sessão longa (o mesmo estado a qualquer hora)`, !m.longWarning)
      // Fechado no seed ("+ Link", alvo de toque de 44px como os outros botões); aberto no longo
      if (state === 'seed') check(`${tag}: Link fechado, "+ Link" com ≥ 44px de altura`, !m.linkOpen && m.buttonHeight >= 44, `${m.linkOpen} ${m.buttonHeight}px`)
      else check(`${tag}: Link aberto`, m.linkOpen)
      check(`${tag}: notas esperadas (${state === 'longa' ? 5 : 0})`, m.notes === (state === 'longa' ? 5 : 0), String(m.notes))
      check(`${tag}: textos medidos: ${m.texts}, esperado ao menos ${m.notes + 2}`, m.texts > 0 && m.texts >= m.notes + 2, String(m.texts))
      check(`${tag}: sem rolagem lateral`, m.scroll <= 0, `${m.scroll}px`)
      check(`${tag}: campos dentro do formulário`, m.controlOut <= 0.5, `${m.controlOut}px`)
      check(`${tag}: folga do foco ≥ 4px`, m.margin >= 4, `${m.margin}px`)
      if (width === 320) {
        await page.evaluate(() => document.querySelector('main form [data-work-field]').scrollIntoView({ block: 'start' }))
        await page.screenshot({ path: out(`o4b-${panel}-${state}-320.png`) })
        await page.evaluate(() => document.querySelector('main form [data-link-field]').scrollIntoView({ block: 'end' }))
        await page.screenshot({ path: out(`o4b-${panel}-${state}-320-fim.png`) })
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
