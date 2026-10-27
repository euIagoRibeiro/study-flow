// N1 (2026-10-26): "voltar" claro entre telas. P1: a tarefa do Executar na
// URL (?tarefa=), então o voltar do navegador/Android volta da tarefa pra
// lista de tarefas. P2: "← Tarefas" no lugar do "trocar tarefa" (um voltar de
// verdade se a tarefa foi aberta pela lista; senão troca sem empilhar, nada
// de pingue-pongue); "← Voltar" na tela de tags (volta pra onde estava; sem
// histórico no app, vai pra Lista). P4: "StudyFlow" no topo leva à Lista.
// Só navega: nada é gravado.
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME } from '../config.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

// Uma tarefa do seed sem registro aberto (abre o formulário, não o painel)
const tasks = await (await fetch(`${API}/tasks`)).json()
const TASK = tasks.find((t) => t.title === 'Exercício físico')
if (!TASK) throw new Error('o seed não tem "Exercício físico" (reseed?)')

const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 390, height: 900 })
  const where = () => page.evaluate(() => ({
    url: location.pathname + location.search,
    // a tarefa aberta: o h2 com o nome dela; a lista de tarefas: o título dela
    task: [...document.querySelectorAll('main h2')].find((h) => h.textContent.trim() === 'Exercício físico')?.textContent.trim() ?? null,
    picker: [...document.querySelectorAll('main h2')].some((h) => h.textContent.trim() === 'Escolha uma tarefa'),
    back: [...document.querySelectorAll('main button, main a')].find((b) => /^←/.test(b.textContent.trim()) || b.getAttribute('aria-label')?.startsWith('Voltar'))?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    trocar: [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'trocar tarefa'),
  }))
  const go = async (url) => { await page.goto(`${APP}${url}`, { waitUntil: 'networkidle0' }); await pause(150) }
  const tap = async (fn, ...args) => { await page.evaluate(fn, ...args); await pause(300) }
  const back = async () => { await page.goBack(); await pause(300) }
  const pickTask = () => tap(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.includes('Exercício físico')).click())
  const tapBack = () => tap(() => [...document.querySelectorAll('main button, main a')].find((b) => /^←/.test(b.textContent.trim())).click())
  const tab = (label) => tap((l) => [...document.querySelectorAll('nav[aria-label="Principal"] a')].find((a) => a.textContent.trim() === l).click(), label)

  // ---- P4: StudyFlow leva à Lista
  await go('/historico')
  const title = await page.evaluate(() => { const a = document.querySelector('header h1 a'); return a && { href: a.getAttribute('href'), text: a.textContent.trim() } })
  check('"StudyFlow" no topo é um link pra Lista (dentro do h1)', title?.href === '/' && title.text === 'StudyFlow', JSON.stringify(title))
  if (title) {
    await tap(() => document.querySelector('header h1 a').click())
    check('tocar em StudyFlow vai pra Lista', (await where()).url === '/', (await where()).url)
  }

  // ---- P1 + P2: tarefa aberta pela lista do Executar
  await go('/historico')
  await tab('Executar')
  await pickTask()
  let w = await where()
  check('escolher a tarefa põe ?tarefa= na URL', w.url === `/executar?tarefa=${TASK.id}` && w.task === 'Exercício físico', JSON.stringify(w))
  check('"← Tarefas" à vista, e o "trocar tarefa" saiu', w.back === '← Tarefas' && !w.trocar, JSON.stringify(w))
  await back()
  w = await where()
  check('voltar do navegador (Android): da tarefa pra lista de tarefas, sem sair do Executar', w.url === '/executar' && w.picker, JSON.stringify(w))
  await page.goForward(); await pause(300)
  check('avançar: volta pra tarefa', (await where()).task === 'Exercício físico', JSON.stringify(await where()))
  await tapBack()
  w = await where()
  check('"← Tarefas" (aberta pela lista): volta pra lista de tarefas', w.url === '/executar' && w.picker, JSON.stringify(w))
  await back()
  w = await where()
  check('"← Tarefas" foi um voltar de verdade: o próximo voltar sai do Executar (pro Histórico), sem pingue-pongue', w.url === '/historico', JSON.stringify(w))

  // ---- tarefa aberta direto (pelo "Executar" do cartão da Lista)
  await go('/')
  await tap((id) => document.querySelector(`a[href="/executar?tarefa=${id}"]`).click(), TASK.id)
  w = await where()
  check('Lista → "Executar" do cartão abre a tarefa com ?tarefa=', w.url === `/executar?tarefa=${TASK.id}` && w.back === '← Tarefas', JSON.stringify(w))
  await tapBack()
  w = await where()
  check('"← Tarefas" (aberta direto): mostra a lista de tarefas', w.url === '/executar' && w.picker, JSON.stringify(w))
  await back()
  w = await where()
  check('...sem empilhar: o voltar seguinte volta pra Lista, não pra tarefa', w.url === '/', JSON.stringify(w))

  // ---- tela de tags: "← Voltar" pra onde estava
  await go(`/executar?tarefa=${TASK.id}`)
  await tap(() => [...document.querySelectorAll('main a')].find((a) => a.textContent.trim() === 'gerenciar tags').click())
  w = await where()
  check('"gerenciar tags" abre as tags com "← Voltar"', w.url === '/tags' && w.back === '← Voltar', JSON.stringify(w))
  await tapBack()
  w = await where()
  check('"← Voltar" das tags: de volta à tarefa onde estava (a tarefa na URL)', w.url === `/executar?tarefa=${TASK.id}` && w.task === 'Exercício físico', JSON.stringify(w))
  await go('/tags')
  await tapBack()
  w = await where()
  check('tags abertas direto (sem histórico no app): "← Voltar" vai pra Lista', w.url === '/', JSON.stringify(w))
  await go('/painel')
  await tap(() => document.querySelector('header a[href="/tags"]').click())
  await tapBack()
  check('ícone de tags no topo → "← Voltar" volta pro Painel', (await where()).url === '/painel', JSON.stringify(await where()))
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
