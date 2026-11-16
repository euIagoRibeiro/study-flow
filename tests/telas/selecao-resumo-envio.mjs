// O resumo do menu de seleção múltipla é o que o formulário ENVIA: o texto do gatilho fechado
// (nomes na ordem de posição, ou "N escolhidas", ou "Nenhuma") tem que bater com os ids que vão
// no POST do Registrar, no PUT do Finalizar (painel) e no PUT do lápis. Cobre: sugestão sem tocar,
// escolha tocada, 4 ou mais escolhidas, "Nenhuma" tocada (com a sugestão presente), e o lápis
// (sem tocar a lista NÃO vai; tocada, vai e bate).
//
// Nenhum dado é gravado: todo pedido que não é GET é lido e ABORTADO. Usa o seed (Idiomas ›
// Inglês, Habilidade, o registro "Elaborando frases em inglês") e a sugestão REAL da API.
// Uso (raiz do repo): node --env-file=backend/.env tests/telas/selecao-resumo-envio.mjs
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
const idiomas = tags.find((t) => t.name === 'Idiomas' && t.parentId === null)
const ingles = tags.find((t) => t.name === 'Inglês' && t.parentId === idiomas.id)
const task = tasks.find((t) => t.title === 'Desenhar')
const pausedTask = tasks.find((t) => t.title === 'Ler livro técnico')
const habilidade = selections.find((s) => s.name === 'Habilidade' && s.multiple)
const frases = executions.find((e) => e.description === 'Elaborando frases em inglês')
const byPosition = (ids) => habilidade.options.filter((o) => ids.includes(o.id)).sort((a, b) => a.position - b.position).map((o) => o.name)
const sentNames = (body) => byPosition(body?.selectionOptionIds ?? [])

const browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
const sent = []
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 375, height: 900 })
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (['GET', 'OPTIONS', 'HEAD'].includes(req.method())) return req.continue()
    let body = null
    try { body = JSON.parse(req.postData() ?? 'null') } catch { /* corpo que não é JSON */ }
    sent.push({ method: req.method(), path: new URL(req.url()).pathname, body })
    return req.abort()
  })
  const go = async (path) => {
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => sessionStorage.clear())
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
  }
  const setPath = async () => {
    for (const [label, text] of [['Contexto', 'Idiomas'], ['Em Idiomas', 'Inglês']]) {
      await page.evaluate((label, text) => {
        const l = [...document.querySelectorAll('main form label')].find((x) => x.querySelector('span')?.textContent === label)
        const s = l.querySelector('select')
        s.value = [...s.options].find((o) => o.textContent === text).value
        s.dispatchEvent(new Event('change', { bubbles: true }))
      }, label, text)
      await pause(200)
    }
    await pause(1000) // a sugestão chega depois
  }
  const summary = () => page.evaluate(() => {
    const m = [...document.querySelectorAll('main form [data-selection-menu]')].find((x) => x.firstElementChild?.textContent === 'Habilidade')
    return m ? m.querySelector('button[aria-expanded]').firstElementChild.textContent : null
  })
  const checkedNames = () => page.evaluate(() => {
    const m = [...document.querySelectorAll('main form [data-selection-menu]')].find((x) => x.firstElementChild?.textContent === 'Habilidade')
    return [...m.querySelectorAll('fieldset label')].filter((l) => l.querySelector('input').checked).map((l) => l.textContent)
  })
  const toggle = async (...names) => {
    await page.evaluate(() => {
      const m = [...document.querySelectorAll('main form [data-selection-menu]')].find((x) => x.firstElementChild?.textContent === 'Habilidade')
      if (m.querySelector('button[aria-expanded]').getAttribute('aria-expanded') !== 'true') m.querySelector('button[aria-expanded]').click()
    })
    await pause(80)
    for (const name of names) {
      await page.evaluate((name) => {
        const m = [...document.querySelectorAll('main form [data-selection-menu]')].find((x) => x.firstElementChild?.textContent === 'Habilidade')
        ;[...m.querySelectorAll('fieldset label')].find((l) => l.textContent === name).querySelector('input').click()
      }, name)
    }
    await page.evaluate(() => {
      const m = [...document.querySelectorAll('main form [data-selection-menu]')].find((x) => x.firstElementChild?.textContent === 'Habilidade')
      ;[...m.querySelectorAll('fieldset button')].find((b) => b.textContent.trim() === 'Pronto').click()
    })
    await pause(80)
  }
  const openMenu = () => page.evaluate(() => {
    const m = [...document.querySelectorAll('main form [data-selection-menu]')].find((x) => x.firstElementChild?.textContent === 'Habilidade')
    const t = m.querySelector('button[aria-expanded]')
    if (t.getAttribute('aria-expanded') !== 'true') t.click()
  }).then(() => pause(80))
  const press = async (text, form = 'main form') => {
    sent.length = 0
    await page.evaluate((text, form) => [...document.querySelectorAll(`${form} button, button[form]`)].find((b) => b.textContent.trim() === text && !b.disabled).click(), text, form)
    await pause(600)
    return sent.at(-1)
  }
  // O que a tela mostra tem que sair igual no envio. "N escolhidas" confere a contagem e, com o
  // menu aberto, os nomes marcados; até 3, o texto é a lista
  const same = async (tag, request) => {
    const shown = await summary()
    const names = sentNames(request?.body)
    if (shown === 'Nenhuma') check(`${tag}: "Nenhuma" e nada de Habilidade no envio`, names.length === 0, JSON.stringify(names))
    else if (/^\d+ escolhidas$/.test(shown ?? '')) {
      check(`${tag}: "${shown}" = a contagem enviada`, Number(shown.split(' ')[0]) === names.length, `${names.length} enviadas`)
      await openMenu()
      const marked = await checkedNames()
      check(`${tag}: com o menu aberto, as marcadas = as enviadas`, marked.join() === names.join(), `${marked} / ${names}`)
      await toggle() // fecha (o toggle sem nomes abre se estiver fechado e fecha no Pronto)
    } else check(`${tag}: "${shown}" = o enviado (${names.join(', ')})`, shown === names.join(', '), `tela "${shown}", envio "${names.join(', ')}"`)
  }

  // --- Registrar (POST /executions)
  await go(`/executar?tarefa=${task.id}`)
  await setPath()
  check('Registrar: o menu da Habilidade existe no caminho Idiomas › Inglês', (await summary()) !== null)
  const suggestedNow = await summary()
  check('Registrar: a sugestão aparece sem tocar em nada (não é "Nenhuma")', suggestedNow !== 'Nenhuma' && suggestedNow !== null, String(suggestedNow))
  let req = await press('Registrar')
  check('Registrar: o pedido saiu (POST /executions)', req?.method === 'POST' && req.path.endsWith('/executions'), JSON.stringify(req?.path))
  await same('Registrar, sugestão sem tocar', req)

  await go(`/executar?tarefa=${task.id}`)
  await setPath()
  await toggle()
  check('Registrar: abrir e fechar sem mexer não muda a escolha', (await summary()) === suggestedNow, await summary())
  const wasSuggested = suggestedNow.split(', ')
  await toggle(...wasSuggested)
  await toggle('fala', 'leitura')
  check('Registrar, tocada: resumo na ordem de posição', (await summary()) === 'leitura, fala', await summary())
  req = await press('Registrar')
  await same('Registrar, tocada', req)

  await go(`/executar?tarefa=${task.id}`)
  await setPath()
  await toggle(...wasSuggested)
  await toggle('escuta', 'leitura', 'escrita', 'fala')
  req = await press('Registrar')
  check('Registrar, 4 escolhidas: "4 escolhidas"', (await summary()) === '4 escolhidas', await summary())
  await same('Registrar, 4 escolhidas', req)
  check('Registrar, 4 escolhidas: o envio tem as 4 pela ordem de posição', sentNames(req?.body).join() === 'escuta,leitura,escrita,fala', sentNames(req?.body).join())

  await go(`/executar?tarefa=${task.id}`)
  await setPath()
  await toggle(...wasSuggested)
  check('Registrar, "Nenhuma" tocada (com a sugestão presente): resumo "Nenhuma"', (await summary()) === 'Nenhuma', await summary())
  req = await press('Registrar')
  await same('Registrar, "Nenhuma" tocada', req)

  // --- Finalizar no painel (PUT /executions/:id); a escolha só existe na tela até o Finalizar
  await go(`/executar?tarefa=${pausedTask.id}`)
  await setPath()
  req = await press('Finalizar')
  check('Painel: o pedido do Finalizar saiu (PUT /executions/…)', req?.method === 'PUT' && /\/executions\/[0-9a-f-]{36}$/.test(req.path), `${req?.method} ${req?.path}`)
  await same('Painel, sugestão sem tocar', req)
  await go(`/executar?tarefa=${pausedTask.id}`)
  await setPath()
  await toggle('leitura')
  req = await press('Finalizar')
  await same('Painel, tocada (a sugestão + leitura)', req)

  // --- Lápis no Histórico (PUT /executions/:id): sem tocar a lista NÃO vai; tocada vai e bate
  const openPencil = async () => {
    await go('/historico')
    await page.evaluate(() => {
      const a = [...document.querySelectorAll('article')].find((x) => x.textContent.includes('Elaborando frases em inglês'))
      a.querySelector('button[aria-label^="Editar registro"]').click()
    })
    await page.waitForSelector('form[id^="editar-"]')
    await pause(300)
  }
  await openPencil()
  const recorded = byPosition(frases.selections.find((s) => s.selectionId === habilidade.id).optionIds).join(', ')
  check(`Lápis: o resumo é o gravado (${recorded})`, (await summary()) === recorded, await summary())
  req = await press('Salvar', 'form[id^="editar-"]')
  check('Lápis, sem tocar: o PUT saiu SEM a lista de seleções', req?.method === 'PUT' && req.body && !('selectionOptionIds' in req.body), JSON.stringify(req?.body && Object.keys(req.body)))
  await openPencil()
  await toggle('fala')
  check('Lápis, tocada: resumo com a nova', (await summary()) === 'escrita, fala, pensamento', await summary())
  req = await press('Salvar', 'form[id^="editar-"]')
  check('Lápis, tocada: o PUT leva a lista', Array.isArray(req?.body?.selectionOptionIds), JSON.stringify(req?.body && Object.keys(req.body)))
  await same('Lápis, tocada', req)
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
