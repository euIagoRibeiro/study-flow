// Menu das seleções múltiplas (fatia 2 da reorganização do formulário): 3 ou mais opções
// mostradas viram um menu (gatilho com o resumo + caixinhas dentro, no próprio fluxo); 1 ou 2
// continuam caixinhas visíveis. Resumo por contagem: vazio = "Nenhuma", de 1 a 3 escolhidas =
// os nomes na ordem de posição, mais de 3 = "N escolhidas"; a lista completa fica no nome
// acessível e com o menu aberto. Foco volta ao gatilho depois de Pronto e de Escape; o menu aberto
// continua aberto ao tocar fora ou tabular para fora; Enter numa caixinha do menu não envia o
// formulário. Registrar (tudo), lápis no Histórico e painel do cronômetro (o essencial).
//
// Nenhum dado é gravado: as seleções de teste vão só na resposta de GET /selections (injetada) e
// todo pedido que não é GET é abortado e contado. A sugestão do caso do seed é a REAL da API.
// Uso (raiz do repo): node --env-file=backend/.env tests/telas/selecao-menu.mjs
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? ` (${detail})` : ''}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const get = async (path) => (await apiFetch(`${API}${path}`)).json()

const [selections, tags, tasks, executions] = await Promise.all(['/selections', '/tags', '/tasks', '/executions'].map(get))
const desenho = tags.find((t) => t.name === 'Desenho' && t.parentId === null)
const idiomas = tags.find((t) => t.name === 'Idiomas' && t.parentId === null)
const ingles = tags.find((t) => t.name === 'Inglês' && t.parentId === idiomas.id)
const task = tasks.find((t) => t.title === 'Desenhar')
const PAUSED_TASK = tasks.find((t) => t.title === 'Ler livro técnico')
const habilidade = selections.find((s) => s.name === 'Habilidade' && s.multiple)
const habName = (id) => habilidade.options.find((o) => o.id === id).name
const frases = executions.find((e) => e.description === 'Elaborando frases em inglês')
const suggestion = (await get(`/selections/sugestao?rootTagId=${idiomas.id}&tagId=${ingles.id}`)).items.find((i) => i.selectionId === habilidade.id)
const suggestedText = habilidade.options.filter((o) => suggestion.optionIds.includes(o.id)).sort((a, b) => a.position - b.position).map((o) => o.name).join(', ')
const recordedText = habilidade.options.filter((o) => frases.selections.find((s) => s.selectionId === habilidade.id).optionIds.includes(o.id)).sort((a, b) => a.position - b.position).map((o) => o.name).join(', ')

const LONG = 'x'.repeat(30)
const make = (name, names, archived = []) => ({
  id: crypto.randomUUID(), tagId: desenho.id, name, multiple: true, active: true,
  options: names.map((n, i) => ({ id: crypto.randomUUID(), name: n, position: i + 1, active: !archived.includes(n) })),
})
const injected = [
  make('Um', ['u1']),
  make('Dois', ['d1', 'd2']),
  make('Tres', ['t1', 't2', 't3']),
  make('Quatro', ['q1', 'q2', 'q3', 'q4'], ['q4']),
  make('Cinco', ['c1', 'c2', 'c3', 'c4', 'c5']),
  make('Longo', [`${LONG}1`, `${LONG}2`, `${LONG}3`, `${LONG}4`]),
  make('ArqDois', ['a1', 'a2', 'a3'], ['a3']),
]
const body = JSON.stringify([...selections, ...injected])

const browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
const attempts = []
const errors = []
let suggestionDelay = 0
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewport({ width: 375, height: 900 })
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const url = req.url()
    if (!['GET', 'OPTIONS', 'HEAD'].includes(req.method())) { attempts.push(`${req.method()} ${new URL(url).pathname}`); return req.abort() }
    if (url === `${API}/selections`) return req.respond({ status: 200, contentType: 'application/json', body })
    if (suggestionDelay && url.startsWith(`${API}/selections/sugestao`)) return void setTimeout(() => req.continue(), suggestionDelay)
    return req.continue()
  })

  const go = async (path = `/executar?tarefa=${task.id}`) => {
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => sessionStorage.clear())
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
  }
  // Um menu (ou um grupo de caixinhas) pelo nome da seleção
  const read = (name) => page.evaluate((name) => {
    const menu = [...document.querySelectorAll('main form [data-selection-menu]')].find((m) => m.firstElementChild?.textContent === name)
    const plain = [...document.querySelectorAll('main form fieldset')].find((f) => !f.closest('[data-selection-menu]') && f.querySelector('legend')?.textContent === name)
    if (!menu) return { menu: false, plain: Boolean(plain), boxes: plain ? [...plain.querySelectorAll('label')].map((l) => l.textContent) : [] }
    const trigger = menu.querySelector('button[aria-expanded]')
    const panel = menu.querySelector('fieldset')
    const rows = panel ? [...panel.querySelectorAll('label')] : []
    const pronto = panel ? [...panel.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Pronto') : null
    const named = (trigger.getAttribute('aria-labelledby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim()
    return {
      menu: true, plain: false, open: trigger.getAttribute('aria-expanded') === 'true',
      summary: trigger.firstElementChild.textContent, accessible: named, triggerHeight: trigger.getBoundingClientRect().height,
      hasPanel: Boolean(panel), boxes: rows.map((l) => l.textContent), checked: rows.filter((l) => l.querySelector('input').checked).map((l) => l.textContent),
      rowHeights: rows.map((l) => Math.round(l.getBoundingClientRect().height)), prontoHeight: pronto ? pronto.getBoundingClientRect().height : 0,
      focused: document.activeElement === trigger, controls: trigger.getAttribute('aria-controls'), controlsExists: Boolean(document.getElementById(trigger.getAttribute('aria-controls') ?? '')),
      overflow: menu.scrollWidth - menu.clientWidth,
    }
  }, name)
  const act = (name, what, text) => page.evaluate((name, what, text) => {
    const menu = [...document.querySelectorAll('main form [data-selection-menu]')].find((m) => m.firstElementChild?.textContent === name)
    const trigger = menu.querySelector('button[aria-expanded]')
    if (what === 'trigger') trigger.click()
    if (what === 'pronto') [...menu.querySelectorAll('fieldset button')].find((b) => b.textContent.trim() === 'Pronto').click()
    if (what === 'box') [...menu.querySelectorAll('fieldset label')].find((l) => l.textContent === text).querySelector('input').click()
    if (what === 'focus-trigger') trigger.focus()
    if (what === 'focus-box') [...menu.querySelectorAll('fieldset label')].find((l) => l.textContent === text).querySelector('input').focus()
    if (what === 'focus-pronto') [...menu.querySelectorAll('fieldset button')].find((b) => b.textContent.trim() === 'Pronto').focus()
  }, name, what, text)
  const open = async (name) => { if (!(await read(name)).open) await act(name, 'trigger'); await pause(80) }
  const setPath = async (labelText, optionText) => {
    await page.evaluate((labelText, optionText) => {
      const l = [...document.querySelectorAll('main form label')].find((x) => x.querySelector('span')?.textContent === labelText)
      const s = l.querySelector('select')
      s.value = [...s.options].find((o) => o.textContent === optionText).value
      s.dispatchEvent(new Event('change', { bubbles: true }))
    }, labelText, optionText)
  }
  const need = (cond, msg) => { if (!cond) throw new Error(msg) }

  // --- 1. O limite: 1 e 2 opções ficam em caixinhas; 3 ou mais mostradas viram menu
  await go()
  await pause(300)
  const [um, dois, tres, quatro, cinco, arq] = await Promise.all(['Um', 'Dois', 'Tres', 'Quatro', 'Cinco', 'ArqDois'].map(read))
  check('1 opção: caixinhas visíveis, sem menu', !um.menu && um.plain && um.boxes.length === 1, JSON.stringify(um.boxes))
  check('2 opções: caixinhas visíveis, sem menu', !dois.menu && dois.plain && dois.boxes.length === 2, JSON.stringify(dois.boxes))
  check('3 opções: vira menu', tres.menu, JSON.stringify(tres))
  need(tres.menu, 'sem menu para a seleção de 3 opções')
  check('4 opções com 1 arquivada (3 mostradas): menu', quatro.menu)
  check('5 opções: menu', cinco.menu)
  check('3 opções com 1 arquivada (2 mostradas): caixinhas visíveis', !arq.menu && arq.plain && arq.boxes.length === 2, JSON.stringify(arq.boxes))

  // --- 2. Fechado vazio
  check('fechado vazio: resumo "Nenhuma"', tres.summary === 'Nenhuma', tres.summary)
  check('fechado: aria-expanded falso e nenhuma caixinha no DOM', !tres.open && !tres.hasPanel)
  const single = await page.evaluate(() => [...document.querySelectorAll('main form [data-selection-block] select')].map((s) => Math.round(s.getBoundingClientRect().height)))
  check('gatilho com a altura do select de hoje (44px)', Math.round(tres.triggerHeight) === 44 && single.length > 0 && single.every((h) => h === 44), `${tres.triggerHeight}px; selects ${single.join(',')}`)
  check('nome acessível = nome da seleção + resumo', tres.accessible === 'Tres Nenhuma', tres.accessible)

  // --- 3. Abrir pelo gatilho: caixinhas dentro, no fluxo, Pronto de 44px
  const before = await page.evaluate(() => document.querySelector('main form').getBoundingClientRect().height)
  await act('Tres', 'trigger')
  await pause(80)
  const opened = await read('Tres')
  const after = await page.evaluate(() => document.querySelector('main form').getBoundingClientRect().height)
  check('aberto: aria-expanded verdadeiro, 3 caixinhas, aria-controls aponta pro painel', opened.open && opened.boxes.join() === 't1,t2,t3' && opened.controlsExists, JSON.stringify(opened.boxes))
  check('aberto: cada linha ≥ 44px e o Pronto 44px', opened.rowHeights.every((h) => h >= 44) && opened.prontoHeight >= 44, `${opened.rowHeights} / Pronto ${opened.prontoHeight}`)
  check('aberto: empurra o formulário (cresce pelo menos 3 linhas e o Pronto)', after - before >= 3 * 44 + 44 - 1, `${before} → ${after}`)
  await act('Tres', 'trigger')
  await pause(80)
  check('o gatilho também fecha (alterna)', !(await read('Tres')).open)

  // --- 4. Resumo por contagem e na ordem de posição (não na do clique)
  await open('Cinco')
  await act('Cinco', 'box', 'c3')
  await act('Cinco', 'box', 'c1')
  check('2 escolhidas na ordem de posição (cliquei c3 antes de c1)', (await read('Cinco')).summary === 'c1, c3', (await read('Cinco')).summary)
  await act('Cinco', 'box', 'c2')
  check('3 escolhidas: os 3 nomes', (await read('Cinco')).summary === 'c1, c2, c3', (await read('Cinco')).summary)
  await act('Cinco', 'box', 'c5')
  const four = await read('Cinco')
  check('4 escolhidas: "4 escolhidas"', four.summary === '4 escolhidas', four.summary)
  check('4 escolhidas: a lista completa no nome acessível', four.accessible.includes('c1, c2, c3, c5') && four.accessible.startsWith('Cinco'), four.accessible)
  check('4 escolhidas: a lista completa visível com o menu aberto', four.open && four.checked.join() === 'c1,c2,c3,c5', four.checked.join())
  await act('Cinco', 'box', 'c5')
  check('voltar a 3 escolhidas volta aos nomes', (await read('Cinco')).summary === 'c1, c2, c3')
  for (const t of ['c1', 'c2', 'c3']) await act('Cinco', 'box', t)
  check('tudo desmarcado: "Nenhuma" (nunca em branco)', (await read('Cinco')).summary === 'Nenhuma', (await read('Cinco')).summary)

  // --- 5. Pronto fecha, devolve o foco e o menu fechado guarda as escolhas
  await act('Cinco', 'box', 'c2')
  await act('Cinco', 'box', 'c4')
  await act('Cinco', 'focus-pronto')
  await act('Cinco', 'pronto')
  await pause(80)
  const done = await read('Cinco')
  check('Pronto fecha o menu', !done.open && !done.hasPanel)
  check('Pronto devolve o foco ao gatilho', done.focused)
  check('fechado guarda as escolhas (resumo igual)', done.summary === 'c2, c4', done.summary)
  await act('Cinco', 'trigger')
  await pause(80)
  check('reabrir: as mesmas caixinhas marcadas', (await read('Cinco')).checked.join() === 'c2,c4', (await read('Cinco')).checked.join())

  // --- 6. Escape: do gatilho e de dentro de uma caixinha
  await act('Cinco', 'focus-box', 'c2')
  await page.keyboard.press('Escape')
  await pause(80)
  const esc = await read('Cinco')
  check('Escape numa caixinha fecha o menu e devolve o foco ao gatilho', !esc.open && esc.focused && esc.summary === 'c2, c4', JSON.stringify({ open: esc.open, focused: esc.focused }))
  await act('Cinco', 'trigger')
  await act('Cinco', 'focus-trigger')
  await page.keyboard.press('Escape')
  await pause(80)
  const esc2 = await read('Cinco')
  check('Escape no gatilho aberto fecha e o foco fica nele', !esc2.open && esc2.focused)
  await page.keyboard.press('Escape')
  await pause(80)
  check('Escape com o menu fechado não faz nada', !(await read('Cinco')).open && errors.length === 0)

  // --- 7. Aberto continua aberto ao tocar fora e ao tabular para fora
  await open('Cinco')
  await page.evaluate(() => document.querySelector('main form textarea').click())
  await page.evaluate(() => document.querySelector('main form textarea').focus())
  await pause(80)
  check('tocar fora (na descrição) não fecha', (await read('Cinco')).open)
  await act('Cinco', 'focus-pronto')
  await page.keyboard.press('Tab')
  await pause(80)
  const tabbed = await read('Cinco')
  check('tabular para fora do Pronto não fecha', tabbed.open && !tabbed.focused)
  await act('Cinco', 'trigger')

  // --- 8. Teclado: Espaço marca; Enter numa caixinha do menu NÃO envia o formulário
  await open('Tres')
  await page.evaluate(() => { window.__submits = 0; document.querySelector('main form').addEventListener('submit', () => { window.__submits++ }, true) })
  const writesBefore = attempts.length
  await act('Tres', 'focus-box', 't2')
  await page.keyboard.press('Space')
  await pause(80)
  check('Espaço marca a caixinha', (await read('Tres')).summary === 't2', (await read('Tres')).summary)
  await page.keyboard.press('Enter')
  await pause(300)
  const submits = await page.evaluate(() => window.__submits)
  check('Enter numa caixinha do menu não envia o formulário', submits === 0 && attempts.length === writesBefore, `${submits} envios, ${attempts.length - writesBefore} pedidos de escrita`)
  check('Enter na caixinha não mudou a escolha nem fechou o menu', (await read('Tres')).summary === 't2' && (await read('Tres')).open)
  await act('Tres', 'trigger')

  // --- 9. Nome longo: 1 escolhida aparece inteira e quebra, dentro do formulário
  await open('Longo')
  await act('Longo', 'box', `${LONG}2`)
  const longo = await read('Longo')
  const fit = await page.evaluate(() => {
    const menu = [...document.querySelectorAll('main form [data-selection-menu]')].find((m) => m.firstElementChild?.textContent === 'Longo')
    const form = document.querySelector('main form').getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(menu.querySelector('button[aria-expanded]'))
    return Math.max(...[...range.getClientRects()].map((r) => r.right)) - form.right
  })
  check('1 escolhida de nome longo: o nome inteiro (não "1 escolhida")', longo.summary === `${LONG}2`, longo.summary)
  check('o nome longo quebra dentro do formulário', fit <= 0.5 && longo.overflow <= 0, `${fit}px, +${longo.overflow}`)
  check('o gatilho cresce com a quebra (≥ 44px)', longo.triggerHeight >= 44, `${longo.triggerHeight}px`)
  await act('Longo', 'trigger')

  // --- 10. Rascunho: o que foi tocado volta, e o menu fechado mostra
  await open('Tres')
  await act('Tres', 'box', 't1')
  await act('Tres', 'box', 't3')
  await act('Tres', 'trigger')
  await page.evaluate(() => { document.querySelector('main form textarea').focus() })
  await pause(300)
  await page.goto(`${APP}/executar?tarefa=${task.id}`, { waitUntil: 'networkidle0' })
  await pause(300)
  const recovered = await read('Tres')
  // t2 já estava marcada (passo do Espaço); t1 e t3 foram tocadas agora
  check('rascunho recuperado: fechado, com o resumo do que foi tocado', recovered.menu && !recovered.open && recovered.summary === 't1, t2, t3', recovered.summary)

  // --- 11. Sugestão: chega depois do primeiro desenho e o resumo acompanha, sem tocar em nada
  await go()
  suggestionDelay = 700
  await setPath('Contexto', 'Idiomas')
  await setPath('Em Idiomas', 'Inglês')
  await pause(150)
  const waiting = await read('Habilidade')
  check('antes da sugestão chegar: "Nenhuma"', waiting.menu && waiting.summary === 'Nenhuma', waiting.summary)
  await pause(1200)
  suggestionDelay = 0
  const suggested = await read('Habilidade')
  check(`sugestão da API (${suggestedText}) aparece no gatilho fechado, sem tocar`, suggested.summary === suggestedText && !suggested.open, suggested.summary)
  check('o nome acessível leva a sugestão', suggested.accessible === `Habilidade ${suggestedText}`, suggested.accessible)
  await act('Habilidade', 'trigger')
  await pause(80)
  check('aberto: a sugestão está marcada', (await read('Habilidade')).checked.join(', ') === suggestedText)
  await act('Habilidade', 'trigger')

  // --- 12. Lápis no Histórico: o gravado no gatilho fechado (1701: escrita e pensamento)
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => sessionStorage.clear())
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => {
    const a = [...document.querySelectorAll('article')].find((x) => x.textContent.includes('Elaborando frases em inglês'))
    a.querySelector('button[aria-label^="Editar registro"]').click()
  })
  await page.waitForSelector('form[id^="editar-"]')
  await pause(300)
  const pencil = await read('Habilidade')
  check(`lápis: o gravado (${recordedText}) no gatilho fechado`, pencil.menu && !pencil.open && pencil.summary === recordedText, pencil.summary)
  await act('Habilidade', 'trigger')
  await pause(80)
  check('lápis: aberto, as gravadas marcadas', (await read('Habilidade')).checked.join(', ') === recordedText)
  await act('Habilidade', 'focus-box', 'escrita')
  await page.keyboard.press('Escape')
  await pause(80)
  const pencilEsc = await read('Habilidade')
  check('lápis: Escape fecha e devolve o foco ao gatilho', !pencilEsc.open && pencilEsc.focused)

  // --- 13. Painel do cronômetro (registro aberto e pausado): o menu depois de escolher o caminho
  await go(`/executar?tarefa=${PAUSED_TASK.id}`)
  await pause(300)
  await setPath('Contexto', 'Idiomas')
  await setPath('Em Idiomas', 'Inglês')
  await pause(800)
  const panel = await read('Habilidade')
  check('painel: o menu com a sugestão no gatilho fechado', panel.menu && !panel.open && panel.summary === suggestedText, panel.summary)
  await act('Habilidade', 'trigger')
  await act('Habilidade', 'box', 'fala')
  await act('Habilidade', 'focus-pronto')
  await page.keyboard.press('Enter')
  await pause(120)
  const panelDone = await read('Habilidade')
  check('painel: Pronto pelo teclado fecha, devolve o foco e o resumo inclui o marcado', !panelDone.open && panelDone.focused && panelDone.summary.includes('fala'), panelDone.summary)

  check('nenhum erro de página durante a bateria', errors.length === 0, errors.join(' | '))
  check('nenhum pedido de escrita foi liberado (todos abortados)', true, `${attempts.length} tentativa(s) abortada(s)`)
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
