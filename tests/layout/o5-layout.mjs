// O5: "Obras em andamento" e "Recentes" na lista do Executar, janela real com a
// barra de rolagem, 320 a 1280. Estados: seed; longo (respostas injetadas: nomes
// de tag com 30 letras e títulos de tarefa com 100, sem espaço; 10 obras em
// andamento com títulos de 100 letras, duas na tarefa que está rodando: a do
// registro, com a nota "A tarefa já está aberta", e outra com "<tarefa> está
// aberta com <obra>."; os títulos de tarefa longos passam também
// pelas listas de tarefas, "Em andamento" e "Escolha uma tarefa"); vazio (sem obras nem registros: as duas
// seções não aparecem). Nada é gravado. Checagens fixas por estado e largura
// (o total não depende do que acontece).
import { API, APP, CHROME, out } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const WIDTHS = [320, 360, 375, 414, 640, 768, 1280]
const [works, tags, tasks, executions, entries] = await Promise.all(['works', 'tags', 'tasks', 'executions', 'time-entries'].map(async (p) => (await apiFetch(`${API}/${p}`)).json()))
const running = entries.find((e) => e.endedAt === null)
const runningTask = executions.find((e) => e.id === running?.taskExecutionId)?.taskId
const longTags = tags.map((t, i) => ({ ...t, name: `${String(i).padStart(2, '0')}${'g'.repeat(28)}` }))
const longTasks = tasks.map((t, i) => ({ ...t, title: `${String(i).padStart(2, '0')}${'t'.repeat(98)}` }))
const leaf = tags.find((t) => t.parentId !== null && t.active && tags.find((p) => p.id === t.parentId)?.parentId)
const fake = (i) => ({
  id: crypto.randomUUID(), title: `${String(i).padStart(2, '0')}${'o'.repeat(98)}`, status: 'em_andamento',
  defaultTagId: leaf.id, defaultTaskId: i < 2 ? runningTask : tasks.find((t) => t.active).id, measureId: null, total: null, url: null,
  defaultTagActive: true, defaultTaskActive: true, measureCurrent: true, records: 1234, seconds: 360000, progress: null,
})
const fakes = Array.from({ length: 10 }, (_, i) => fake(i))
const longWorks = [...works, ...fakes]
// O registro rodando fica com a 1ª obra longa (o chip e "A tarefa já está
// aberta."); a 2ª, na mesma tarefa, ganha "<tarefa de 100> está aberta com <obra de 100>."
const longExecutions = executions.map((e) => (e.id === running?.taskExecutionId ? { ...e, workId: fakes[0].id } : e))
const inProgress = (list) => list.filter((w) => w.status === 'em_andamento').length
const STATES = {
  seed: { bodies: {}, works: inProgress(works), recents: 8 },
  longo: { bodies: { tags: longTags, tasks: longTasks, works: longWorks, executions: longExecutions }, works: inProgress(longWorks), recents: 8 },
  vazio: { bodies: { works: [], executions: [], 'time-entries': [] }, works: 0, recents: 0 },
}

let browser
try {
  if (!running || !runningTask || !leaf) throw new Error('seed sem sessão rodando ou sem tag de nível 3')
  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  let bodies = {}
  const writes = []
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (!['GET', 'OPTIONS'].includes(req.method())) writes.push(`${req.method()} ${req.url()}`)
    const key = req.method() === 'GET' && req.url().startsWith(`${API}/`) ? req.url().slice(API.length + 1) : null
    if (key && bodies[key]) {
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(bodies[key]) })
    }
    req.continue()
  })
  for (const [state, spec] of Object.entries(STATES)) {
    bodies = spec.bodies
    for (const width of WIDTHS) {
      await page.setViewport({ width, height: 800 })
      await page.goto(`${APP}/executar`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('main section h2')
      const m = await page.evaluate(() => {
        const useful = document.documentElement.clientWidth
        const sections = [...document.querySelectorAll('main section[data-shortcuts]')]
        const named = (h) => sections.find((s) => s.querySelector('h2')?.textContent.trim() === h)
        const items = sections.flatMap((s) => [...s.querySelectorAll(':scope > ul > li')])
        const boxes = items.map((li) => li.firstElementChild)
        let texts = 0
        let leak = null
        for (const box of boxes) {
          const r = box.getBoundingClientRect()
          const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT)
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent.trim()) continue
            texts++
            const range = document.createRange()
            range.selectNodeContents(node)
            const out = [...range.getClientRects()].find((x) => x.right > r.right + 0.5 || x.left < r.left - 0.5)
            if (out && !leak) leak = `"${node.textContent.slice(0, 20)}" ${out.left.toFixed(1)}..${out.right.toFixed(1)} em ${r.left.toFixed(1)}..${r.right.toFixed(1)}`
          }
        }
        const rects = boxes.map((b) => b.getBoundingClientRect())
        return {
          shortcutsOut: Math.max(0, ...sections.flatMap((s) => [...s.querySelectorAll('*')]).map((el) => el.getBoundingClientRect().right - useful)),
          works: named('Obras em andamento')?.querySelectorAll(':scope > ul > li').length ?? 0,
          recents: named('Recentes')?.querySelectorAll(':scope > ul > li').length ?? 0,
          openNotes: items.filter((li) => li.innerText.includes('A tarefa já está aberta.')).length,
          otherNotes: items.filter((li) => / está aberta com /.test(li.innerText)).length,
          texts,
          leak,
          scroll: document.documentElement.scrollWidth - useful,
          lowest: rects.length ? Math.min(...rects.map((r) => r.height)) : 44,
          margin: rects.length ? Math.min(...rects.map((r) => Math.min(r.left, useful - r.right))) : 4,
          overlap: rects.some((r, i) => i > 0 && r.top < rects[i - 1].bottom - 0.5 && r.left < rects[i - 1].right),
          order: [...document.querySelectorAll('main section h2')].map((h) => h.textContent.trim()),
        }
      })
      const tag = `${state} ${width}`
      check(`${tag}: ${spec.works} obras e ${spec.recents} recentes`, m.works === spec.works && m.recents === spec.recents, `${m.works} ${m.recents}`)
      // longo: a obra da tarefa que está rodando tem a nota (no seed, depende dos Recentes do dia)
      if (state === 'longo') check(`${tag}: nota "A tarefa já está aberta." medida`, m.openNotes >= 1, String(m.openNotes))
      else check(`${tag}: notas contadas (${m.openNotes})`, state !== 'vazio' || m.openNotes === 0, String(m.openNotes))
      // longo: a outra obra da tarefa aberta, com os dois nomes de 100 letras
      if (state === 'longo') check(`${tag}: nota "<tarefa> está aberta com <obra>." medida`, m.otherNotes >= 1, String(m.otherNotes))
      else check(`${tag}: notas de outra obra contadas (${m.otherNotes})`, state !== 'vazio' || m.otherNotes === 0, String(m.otherNotes))
      const minTexts = (spec.works * 3) + (spec.recents * 2)
      check(`${tag}: textos medidos ${m.texts} ≥ ${minTexts}`, m.texts >= minTexts, String(m.texts))
      check(`${tag}: texto dentro do item`, m.leak === null, m.leak)
      check(`${tag}: nada das seções novas passa da tela`, m.shortcutsOut <= 0.5, `${m.shortcutsOut.toFixed(1)}px`)
      check(`${tag}: sem rolagem lateral`, m.scroll <= 0, `${m.scroll}px`)
      check(`${tag}: itens com ≥ 44px de altura`, m.lowest >= 44, `${m.lowest}px`)
      check(`${tag}: folga do foco ≥ 4px`, m.margin >= 4, `${m.margin}px`)
      check(`${tag}: itens sem sobrepor`, !m.overlap)
      const expected = state === 'vazio' ? ['Escolha uma tarefa'] : ['Obras em andamento', 'Recentes', 'Escolha uma tarefa']
      check(`${tag}: seções na ordem`, JSON.stringify(m.order.filter((h) => expected.includes(h))) === JSON.stringify(expected), JSON.stringify(m.order))
      if (width === 320) {
        await page.screenshot({ path: out(`o5-${state}-320.png`) })
        await page.evaluate(() => document.querySelector('main section[data-shortcuts]')?.scrollIntoView({ block: 'start' }))
        await page.screenshot({ path: out(`o5-${state}-320-atalhos.png`) })
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
