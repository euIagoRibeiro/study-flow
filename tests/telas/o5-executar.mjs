// O5: "Obras em andamento" e "Recentes" na lista do Executar. Obras: só em
// andamento, pela data do último registro concluído (todos os registros
// carregados: um de 2 anos atrás conta), sem registro no fim por título; tarefa
// padrão arquivada sem toque, com o motivo; tarefa já aberta: só a obra do
// registro aberto tem o chip, as outras da tarefa dizem com qual obra (ou "sem
// obra", ou "outra obra") ela está aberta, e o toque abre o painel sem aplicar. Recentes: 8 pares tarefa + caminho, sem
// repetir, sem registro de obra em andamento, sem tarefa ou tag arquivada. O
// toque abre a tarefa com a obra (o caminho dela) ou o caminho; a URL volta a
// ?tarefa=; nada é gravado antes do Iniciar/Registrar; rascunho fica por baixo;
// recarregar não aplica de novo; parâmetro inválido abre a tarefa normal, sem
// erro. Toques: Soul Eater-like, da Lista ao cronômetro rodando. Dados próprios
// (prefixo teste-o5), apagados no fim; pausa a sessão do seed e devolve. Uso:
//   node --env-file=backend/.env tests/telas/o5-executar.mjs
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'
import { deleteExecutions, deleteNewWorks, pauseRunning, resumeRunning, worksSnapshot } from '../limpeza.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-o5'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(method, path, body) {
  const res = await apiFetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString()

const worksBefore = await worksSnapshot(pool)
const seedSession = await pauseRunning(pool)
const made = { tags: [], tasks: [] }
let browser
try {
  // ---------- dados
  const R = await api('POST', '/tags', { name: `${P} raiz`, parentId: null })
  const S = await api('POST', '/tags', { name: `${P} sub`, parentId: R.id })
  const X = await api('POST', '/tags', { name: `${P} arquivada`, parentId: R.id })
  // Só no registro da obra em andamento: se ele entrasse nos Recentes, seria um
  // par novo (com o caminho do 1º recente, a entrada passaria despercebida)
  const S2 = await api('POST', '/tags', { name: `${P} sub da obra`, parentId: R.id })
  made.tags.push(S.id, X.id, S2.id, R.id)
  const T1 = await api('POST', '/tasks', { title: `${P} tarefa` })
  const T2 = await api('POST', '/tasks', { title: `${P} arquivada` })
  const T3 = await api('POST', '/tasks', { title: `${P} aberta` })
  made.tasks.push(T1.id, T2.id, T3.id)
  const work = (title, extra) => api('POST', '/works', { title: `${P} obra ${title}`, defaultTagId: S.id, defaultTaskId: T1.id, ...extra })
  const W1 = await work('recente')
  // "velha": pelo título, ficaria por último entre as sem registro; o registro
  // de 2 anos é o que a põe antes delas
  const W2 = await work('velha')
  const W3 = await work('sem registro')
  const W4 = await work('pausada', { status: 'pausado' })
  const W5 = await work('tarefa arquivada', { defaultTaskId: T2.id })
  const W6 = await work('de tarefa aberta', { defaultTaskId: T3.id })
  const W7 = await work('caminho arquivado', { defaultTagId: X.id })
  const rec = (minutes, extra) => api('POST', '/executions', { taskId: T1.id, description: `${P} reg`, completedAt: ago(minutes), ...extra })
  const sub = { rootTagId: R.id, tagIds: [S.id] }
  await rec(1, { rootTagId: R.id, tagIds: [S2.id], workId: W1.id }) // obra em andamento: fora dos Recentes
  await rec(2, { taskId: T2.id }) // tarefa arquivada depois: fora
  await rec(3, { rootTagId: R.id, tagIds: [X.id] }) // tag arquivada depois: fora
  await rec(4, sub) // 1º recente
  await rec(5, sub) // repetido: fora
  await rec(6, { rootTagId: R.id, tagIds: [] }) // 2º
  await rec(7, {}) // 3º, sem contexto
  await rec(8, { ...sub, workId: W4.id }) // obra pausada, mesmo par do 1º: fora
  await rec(2 * 365 * 24 * 60, { rootTagId: R.id, tagIds: [], workId: W2.id }) // 2 anos atrás
  await api('PATCH', `/tags/${X.id}`, { active: false })
  await api('PATCH', `/tasks/${T2.id}`, { active: false })
  const rowsOf = async (taskId, open) => (await pool.query(
    `SELECT e.id, e.work_id, e.root_tag_id, e.completed_at,
       (SELECT string_agg(tag_id::text, ',') FROM task_execution_tags t WHERE t.task_execution_id = e.id) AS tags,
       (SELECT count(*)::int FROM time_entries te WHERE te.task_execution_id = e.id AND te.ended_at IS NULL) AS running
     FROM task_executions e WHERE e.task_id = $1 AND (e.completed_at IS NULL) = $2 ORDER BY e.created_at`, [taskId, open])).rows
  const dropOpen = async (taskId) => {
    await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL AND task_execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)', [taskId])
    await deleteExecutions(pool, (await rowsOf(taskId, true)).map((r) => r.id))
  }

  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setViewport({ width: 390, height: 900 })
  const writes = []
  page.on('request', (req) => {
    if (!['GET', 'OPTIONS'].includes(req.method())) writes.push(`${req.method()} ${req.url().replace(API, '')}`)
  })
  const picker = async () => {
    await page.goto(`${APP}/executar`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => sessionStorage.clear())
    await page.goto(`${APP}/executar`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('main section h2')
  }
  const sections = () => page.evaluate(() => [...document.querySelectorAll('main section')].map((s) => ({
    h: s.querySelector('h2')?.textContent.trim(),
    items: [...s.querySelectorAll(':scope > ul > li')].map((li) => ({ text: li.innerText.replace(/\n/g, ' | '), button: li.querySelector('button') !== null })),
  })))
  const section = async (h) => (await sections()).find((s) => s.h === h)
  const tapItem = async (h, title) => {
    await page.evaluate((h, title) => {
      const s = [...document.querySelectorAll('main section')].find((x) => x.querySelector('h2')?.textContent.trim() === h)
      ;[...s.querySelectorAll(':scope > ul > li button')].find((b) => b.querySelector('span')?.textContent.trim() === title).click()
    }, h, title)
    // Sem travar: se a URL não voltar a ?tarefa=, a checagem da URL é que acusa
    await page.waitForFunction(() => !location.search.includes('obra=') && !location.search.includes('caminho=') && location.search.includes('tarefa='), { timeout: 3000 }).catch(() => {})
    await pause(300)
  }
  const form = () => page.evaluate(() => ({
    url: location.pathname + location.search,
    task: document.querySelector('main h2')?.textContent.trim() ?? null,
    finalizar: [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Finalizar'),
    description: [...document.querySelectorAll('main form label')].find((l) => l.querySelector('span')?.textContent === 'O que foi feito (opcional)')?.querySelector('input')?.value ?? null,
    selects: Object.fromEntries([...document.querySelectorAll('main form label')].filter((l) => l.querySelector(':scope > select')).map((l) => [l.querySelector('span')?.textContent, l.querySelector('select').value])),
    alert: document.querySelector('[role="alert"]')?.textContent.trim() ?? null,
  }))
  const nameOf = (w) => w.title

  // ---------- 1. seções: ordem, quais obras, ordem das obras, conteúdo
  await picker()
  const all = await sections()
  const heads = all.map((s) => s.h)
  check('seções na ordem: Em andamento, Obras em andamento, Recentes, Escolha uma tarefa',
    JSON.stringify(heads.filter((h) => ['Em andamento', 'Obras em andamento', 'Recentes', 'Escolha uma tarefa'].includes(h))) === JSON.stringify(['Em andamento', 'Obras em andamento', 'Recentes', 'Escolha uma tarefa']), JSON.stringify(heads))
  const works = (await section('Obras em andamento'))?.items ?? []
  const titles = works.map((i) => i.text.split(' | ')[0])
  const seedInProgress = (await api('GET', '/works')).filter((w) => w.status === 'em_andamento').length
  check(`só as obras em andamento (${seedInProgress})`, works.length === seedInProgress && !titles.includes(nameOf(W4)), JSON.stringify(titles))
  const at = (w) => titles.indexOf(nameOf(w))
  check('ordem: a de registro mais recente primeiro', at(W1) === 0, JSON.stringify(titles))
  check('ordem: o registro de 2 anos atrás conta (antes das sem registro)', at(W2) > 0 && at(W2) < at(W7) && at(W2) < at(W6) && at(W2) < at(W3), JSON.stringify(titles))
  // por título: "caminho arquivado", "de tarefa aberta", "sem registro", "tarefa arquivada"
  const n = titles.length
  check('ordem: sem registro no fim, por título', [W7, W6, W3, W5].map(at).join() === [n - 4, n - 3, n - 2, n - 1].join(), JSON.stringify(titles))
  const w1 = works[at(W1)]
  check('item da obra: título, tarefa · caminho, progresso', w1?.button && w1.text.startsWith(`${nameOf(W1)} | ${P} tarefa · ${P} raiz › ${P} sub | 1 registro`), w1?.text)
  const w5 = works[at(W5)]
  check('tarefa padrão arquivada: sem toque, com o motivo', w5 && !w5.button && w5.text.endsWith('A tarefa padrão desta obra está arquivada.'), JSON.stringify(w5))

  // ---------- 2. Recentes
  const recents = (await section('Recentes'))?.items ?? []
  check('Recentes: 8 itens', recents.length === 8, String(recents.length))
  check('Recentes: os 3 primeiros = tarefa + caminho, sem repetir, sem obra em andamento, sem arquivados',
    JSON.stringify(recents.slice(0, 3).map((i) => i.text)) === JSON.stringify([`${P} tarefa | ${P} raiz › ${P} sub`, `${P} tarefa | ${P} raiz`, `${P} tarefa | sem contexto`]),
    JSON.stringify(recents.slice(0, 4).map((i) => i.text)))
  check('Recentes: nenhum item da tarefa arquivada nem da tag arquivada', !recents.some((i) => i.text.includes(`${P} arquivada`)), JSON.stringify(recents.map((i) => i.text)))
  check('Recentes: o registro da obra em andamento não entra', !recents.some((i) => i.text.includes(`${P} sub da obra`)), JSON.stringify(recents.map((i) => i.text)))

  // ---------- 3. toque na obra: tarefa padrão, obra, caminho dela; URL limpa; nada gravado
  writes.length = 0
  await tapItem('Obras em andamento', nameOf(W1))
  let f = await form()
  check('obra: abre a tarefa padrão, URL só com ?tarefa=', f.url === `/executar?tarefa=${T1.id}` && f.task === `${P} tarefa`, JSON.stringify(f))
  check('obra: Obra e caminho preenchidos', f.selects.Obra === W1.id && f.selects.Contexto === R.id && f.selects[`Em ${P} raiz`] === S.id, JSON.stringify(f.selects))
  check('obra: nada gravado ao abrir', writes.length === 0, writes.join(' | '))
  const DRAFT = `studyflow:rascunho:registrar:${T1.id}`
  const draft = () => page.evaluate((k) => sessionStorage.getItem(k), DRAFT)
  check('aberto pelo atalho, sem tocar: não é rascunho', (await draft()) === null, await draft())
  await page.goBack()
  await pause(300)
  check('voltar do navegador: de volta à lista do Executar', await page.evaluate(() => location.pathname + location.search) === '/executar')

  // ---------- 4. Iniciar leva a obra e o caminho
  await tapItem('Obras em andamento', nameOf(W1))
  await page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Iniciar cronômetro').click())
  await page.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Pausar'))
  await pause(300)
  let open = await rowsOf(T1.id, true)
  check('Iniciar: registro aberto com a obra, o caminho e a sessão rodando', open.length === 1 && open[0].work_id === W1.id && open[0].root_tag_id === R.id && open[0].tags?.includes(S.id) && open[0].running === 1, JSON.stringify(open))
  await dropOpen(T1.id)

  // ---------- 4b. tocar num campo depois do atalho: vira rascunho, com a obra; volta como "Rascunho recuperado"
  await picker()
  await tapItem('Obras em andamento', nameOf(W1))
  const descInput = await page.evaluateHandle(() => [...document.querySelectorAll('main form label')].find((l) => l.querySelector('span')?.textContent === 'O que foi feito (opcional)').querySelector('input'))
  await descInput.type('toque o5')
  await pause(400)
  const saved = JSON.parse((await draft()) ?? 'null')
  check('depois de tocar num campo: vira rascunho, com a obra e o caminho do atalho', saved?.description === 'toque o5' && saved.workId === W1.id && saved.path?.at(-1) === S.id, JSON.stringify(saved))
  await page.reload({ waitUntil: 'networkidle0' })
  await pause(300)
  f = await form()
  const notice = await page.evaluate(() => document.querySelector('main')?.innerText.includes('Rascunho recuperado'))
  check('recarregar: "Rascunho recuperado" com a obra', notice && f.selects.Obra === W1.id && f.description === 'toque o5', JSON.stringify({ notice, f }))

  // ---------- 4c. "← Tarefas" depois do atalho: um voltar de verdade (o endereço limpo guardou o estado)
  await page.evaluate(() => sessionStorage.clear())
  await page.goto(`${APP}/historico`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => [...document.querySelectorAll('nav a')].find((a) => a.textContent.trim() === 'Executar').click())
  await page.waitForSelector('main section h2')
  await pause(300)
  await tapItem('Obras em andamento', nameOf(W1))
  await page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === '← Tarefas').click())
  await pause(400)
  const afterBack = await page.evaluate(() => location.pathname + location.search)
  await page.goBack()
  await pause(400)
  const afterHistory = await page.evaluate(() => location.pathname)
  check('"← Tarefas" depois do atalho: volta à lista, e o voltar seguinte sai do Executar', afterBack === '/executar' && afterHistory === '/historico', `${afterBack} → ${afterHistory}`)

  // ---------- 5. toque no recente: caminho, sem obra; Registrar grava; "sem contexto" vence a pré-seleção
  await picker()
  writes.length = 0
  await page.evaluate((t) => {
    const s = [...document.querySelectorAll('main section')].find((x) => x.querySelector('h2')?.textContent.trim() === 'Recentes')
    s.querySelector(':scope > ul > li button').click()
  })
  await page.waitForFunction(() => !location.search.includes('caminho='))
  await pause(300)
  f = await form()
  check('recente: caminho da tarefa + sub, sem obra, nada gravado', f.selects.Obra === '' && f.selects.Contexto === R.id && f.selects[`Em ${P} raiz`] === S.id && writes.length === 0, JSON.stringify({ s: f.selects, writes }))
  const doneBefore = (await rowsOf(T1.id, false)).length
  await page.evaluate(() => [...document.querySelectorAll('main form button')].find((b) => b.textContent.trim() === 'Registrar').click())
  await page.waitForFunction(() => location.pathname === '/')
  const done = await rowsOf(T1.id, false)
  const newest = done.at(-1)
  check('Registrar pelo recente: grava o caminho, sem obra', done.length === doneBefore + 1 && newest.work_id === null && newest.tags?.includes(S.id), JSON.stringify(newest))
  await deleteExecutions(pool, [newest.id])
  await picker()
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('main section')].find((x) => x.querySelector('h2')?.textContent.trim() === 'Recentes')
    ;[...s.querySelectorAll(':scope > ul > li button')].find((b) => b.innerText.includes('sem contexto')).click()
  })
  await page.waitForFunction(() => !location.search.includes('caminho='))
  await pause(300)
  f = await form()
  check('recente "sem contexto": Contexto vazio (vence a pré-seleção da tarefa)', f.selects.Contexto === '', JSON.stringify(f.selects))

  // ---------- 6. rascunho por baixo; recarregar não aplica de novo
  await picker()
  await page.goto(`${APP}/executar?tarefa=${T1.id}`, { waitUntil: 'networkidle0' })
  const plain = (await form()).selects
  const desc = await page.evaluateHandle(() => [...document.querySelectorAll('main form label')].find((l) => l.querySelector('span')?.textContent === 'O que foi feito (opcional)').querySelector('input'))
  await desc.type('rascunho o5')
  await pause(300)
  await page.goto(`${APP}/executar`, { waitUntil: 'networkidle0' })
  await tapItem('Obras em andamento', nameOf(W1))
  f = await form()
  check('rascunho: a descrição fica; a obra sobrescreve o caminho', f.description === 'rascunho o5' && f.selects.Obra === W1.id && f.selects[`Em ${P} raiz`] === S.id, JSON.stringify(f))
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('main form label')].find((l) => l.querySelector('span')?.textContent === 'Obra').querySelector('select')
    s.value = ''
    s.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await pause(400)
  await page.reload({ waitUntil: 'networkidle0' })
  await pause(300)
  f = await form()
  check('recarregar depois do atalho: não aplica de novo (vale o que estava na tela)', f.selects.Obra === '' && f.description === 'rascunho o5', JSON.stringify(f))

  // ---------- 7. parâmetros inválidos: abre a tarefa normal, sem erro
  const gone = await work('apagada')
  await api('DELETE', `/works/${gone.id}`)
  const bad = [
    ['obra inexistente', `obra=${crypto.randomUUID()}`],
    ['obra apagada', `obra=${gone.id}`],
    ['obra malformada', 'obra=abc'],
    ['caminho inexistente', `caminho=${crypto.randomUUID()}`],
    ['caminho malformado', 'caminho=xyz'],
    ['caminho com tag arquivada', `caminho=${X.id}`],
  ]
  for (const [name, param] of bad) {
    await picker()
    writes.length = 0
    await page.goto(`${APP}/executar?tarefa=${T1.id}&${param}`, { waitUntil: 'networkidle0' })
    await pause(300)
    f = await form()
    check(`inválido (${name}): tarefa normal, URL limpa, sem erro, nada gravado`,
      f.url === `/executar?tarefa=${T1.id}` && JSON.stringify(f.selects) === JSON.stringify(plain) && f.alert === null && writes.length === 0, JSON.stringify({ f, plain, writes }))
    // Os campos escondem obra desconhecida e tag arquivada: o que vale é o que o
    // Iniciar grava. Tarefa normal, sem mexer: o registro nasce vazio (B1)
    await page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Iniciar cronômetro').click())
    await page.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Pausar'), { timeout: 4000 }).catch(() => {})
    const started = await rowsOf(T1.id, true)
    check(`inválido (${name}): o Iniciar grava como a tarefa normal (sem obra, sem a tag arquivada)`,
      started.length === 1 && started[0].work_id === null && started[0].root_tag_id === null &&!(started[0].tags ?? '').includes(X.id), JSON.stringify(started))
    await dropOpen(T1.id)
  }

  // ---------- 8. caminho padrão arquivado: aplica a obra, sem preencher o caminho
  await picker()
  await tapItem('Obras em andamento', nameOf(W7))
  f = await form()
  check('caminho padrão arquivado: obra aplicada, caminho da tarefa (não o arquivado)', f.selects.Obra === W7.id && f.selects[`Em ${P} raiz`] !== X.id && f.selects.Contexto === plain.Contexto, JSON.stringify(f.selects))
  // O campo esconde a tag arquivada: o que vale é o que o Iniciar grava
  await page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Iniciar cronômetro').click())
  await page.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Pausar'), { timeout: 4000 }).catch(() => {})
  open = await rowsOf(T1.id, true)
  check('caminho padrão arquivado: o Iniciar grava a obra, sem a tag arquivada', open.length === 1 && open[0].work_id === W7.id && !(open[0].tags ?? '').includes(X.id), JSON.stringify(open))
  await dropOpen(T1.id)

  // ---------- 9. tarefa padrão já aberta: só a obra do registro aberto tem o chip;
  // as outras da mesma tarefa dizem com qual obra ela está aberta (um registro
  // aberto por tarefa); o toque abre o painel desse registro, sem aplicar
  // W8: a "obra B" da tarefa T3 (W6 é a "A"). Criadas aqui: na seção 1 mudariam
  // a ordem das sem registro. W9 concluída: fora da lista, com o nome na tela
  const W8 = await work('outra da tarefa aberta', { defaultTaskId: T3.id })
  const W9 = await work('concluída', { status: 'concluido' })
  const workItem = async (w) => (await section('Obras em andamento')).items.find((i) => i.text.startsWith(nameOf(w)))
  const noChip = (item) => !/\| (Rodando|Pausado) \|/.test(item?.text ?? '|Rodando|') && !item?.text.includes('A tarefa já está aberta.')
  const tapWork = async (w) => {
    await page.evaluate((title) => {
      const s = [...document.querySelectorAll('main section')].find((x) => x.querySelector('h2')?.textContent.trim() === 'Obras em andamento')
      ;[...s.querySelectorAll(':scope > ul > li button')].find((b) => b.querySelector('span')?.textContent.trim() === title).click()
    }, nameOf(w))
    await page.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Finalizar'))
    await pause(300)
  }
  const memoryText = () => page.evaluate(() => Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k)).join(' '))
  const openNote = (text) => `| ${P} aberta está aberta ${text}`
  const T3open = await api('POST', '/executions', { taskId: T3.id, description: null, completedAt: null, rootTagId: R.id, tagIds: [], workId: W6.id })
  for (const state of ['Pausado', 'Rodando']) {
    if (state === 'Rodando') await api('POST', '/time-entries', { taskExecutionId: T3open.id, startedAt: ago(5) })
    await picker()
    const a = await workItem(W6)
    const b = await workItem(W8)
    check(`tarefa aberta com a obra A (${state}): o item da A diz`, a?.text.endsWith(`${state} | A tarefa já está aberta.`), a?.text)
    check(`tarefa aberta com a obra A (${state}): a B diz com qual obra, sem chip`,
      b?.text.endsWith(openNote(`com ${nameOf(W6)}.`)) && noChip(b), b?.text)
    writes.length = 0
    await tapWork(W8)
    f = await form()
    const memory = await memoryText()
    check(`tarefa aberta com a obra A (${state}): tocar na B abre o painel da A, sem aplicar, nada gravado`,
      f.url === `/executar?tarefa=${T3.id}` && f.selects.Obra === W6.id && !memory.includes(W8.id) && writes.length === 0, JSON.stringify({ f, writes }))
  }
  await dropOpen(T3.id)

  // Registro aberto sem obra: todas as obras da tarefa dizem "sem obra"
  await api('POST', '/executions', { taskId: T3.id, description: null, completedAt: null, rootTagId: R.id, tagIds: [] })
  await picker()
  for (const w of [W6, W8]) {
    const item = await workItem(w)
    check(`registro aberto sem obra: ${nameOf(w)} diz "sem obra", sem chip`, item?.text.endsWith(openNote('sem obra.')) && noChip(item), item?.text)
  }
  writes.length = 0
  await tapWork(W8)
  f = await form()
  check('registro aberto sem obra: o toque abre o painel com "Nenhuma obra", nada gravado',
    f.url === `/executar?tarefa=${T3.id}` && f.selects.Obra === '' && writes.length === 0, JSON.stringify({ f, writes }))
  await dropOpen(T3.id)

  // Obra do registro aberto fora das em andamento (concluída): o nome dela
  await api('POST', '/executions', { taskId: T3.id, description: null, completedAt: null, rootTagId: R.id, tagIds: [], workId: W9.id })
  await picker()
  for (const w of [W6, W8]) {
    const item = await workItem(w)
    check(`registro aberto com obra concluída: ${nameOf(w)} diz o nome dela, sem chip`, item?.text.endsWith(openNote(`com ${nameOf(W9)}.`)) && noChip(item), item?.text)
  }
  await dropOpen(T3.id)
  await page.close()

  // Obra do registro aberto que a tela não tem (id inexistente, só na resposta
  // injetada de GET /executions; o banco não aceitaria): "outra obra"
  const ghost = '00000000-0000-4000-8000-00000000f05e'
  const T3ghost = await api('POST', '/executions', { taskId: T3.id, description: null, completedAt: null, rootTagId: R.id, tagIds: [] })
  const injected = await browser.newPage()
  injected.setDefaultTimeout(10000)
  await injected.setViewport({ width: 390, height: 900 })
  await injected.setRequestInterception(true)
  injected.on('request', async (req) => {
    if (req.method() === 'GET' && new URL(req.url()).pathname === '/api/executions') {
      const list = await (await apiFetch(`${API}/executions`)).json()
      const body = list.map((e) => (e.id === T3ghost.id ? { ...e, workId: ghost } : e))
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    }
    req.continue()
  })
  await injected.goto(`${APP}/executar`, { waitUntil: 'networkidle0' })
  await injected.waitForSelector('main section h2')
  const ghostItems = await injected.evaluate((titles) => {
    const s = [...document.querySelectorAll('main section')].find((x) => x.querySelector('h2')?.textContent.trim() === 'Obras em andamento')
    return titles.map((t) => [...s.querySelectorAll(':scope > ul > li')].map((li) => li.innerText.replace(/\n/g, ' | ')).find((x) => x.startsWith(t)))
  }, [nameOf(W6), nameOf(W8)])
  for (const [i, w] of [W6, W8].entries()) {
    const item = { text: ghostItems[i] }
    check(`registro aberto com obra que a tela não tem: ${nameOf(w)} diz "outra obra", sem chip`, item.text?.endsWith(openNote('com outra obra.')) && noChip(item), item.text)
  }
  await injected.close()
  await dropOpen(T3.id)

  // ---------- 10. toques: da Lista ao cronômetro rodando pela obra
  const touch = await browser.newPage()
  await touch.setViewport({ width: 375, height: 800, hasTouch: true, isMobile: true })
  await touch.evaluateOnNewDocument(() => {
    window.__taps = 0
    addEventListener('pointerdown', () => { window.__taps++ }, true)
  })
  await touch.goto(`${APP}/`, { waitUntil: 'networkidle0' })
  await touch.evaluate(() => sessionStorage.clear())
  await touch.goto(`${APP}/`, { waitUntil: 'networkidle0' })
  const tapEl = async (handle) => {
    await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await handle.tap()
    await pause(400)
  }
  await tapEl(await touch.evaluateHandle(() => [...document.querySelectorAll('nav a')].find((a) => a.textContent.trim() === 'Executar')))
  await touch.waitForSelector('main section h2')
  await tapEl(await touch.evaluateHandle((title) => {
    const s = [...document.querySelectorAll('main section')].find((x) => x.querySelector('h2')?.textContent.trim() === 'Obras em andamento')
    return [...s.querySelectorAll(':scope > ul > li button')].find((b) => b.querySelector('span')?.textContent.trim() === title)
  }, nameOf(W1)))
  await tapEl(await touch.evaluateHandle(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Iniciar cronômetro')))
  await touch.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Pausar'))
  const taps = await touch.evaluate(() => window.__taps)
  open = await rowsOf(T1.id, true)
  console.log(`TOQUES da Lista ao cronômetro rodando pela obra: ${taps}; previsto 3`)
  check('toques: 3, com o cronômetro rodando na obra', taps === 3 && open.length === 1 && open[0].work_id === W1.id && open[0].running === 1, `${taps} ${JSON.stringify(open)}`)
  await dropOpen(T1.id)
  await touch.close()
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await browser?.close().catch(() => {})
  if (made.tasks.length) {
    await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL AND task_execution_id IN (SELECT id FROM task_executions WHERE task_id = ANY($1::uuid[]))', [made.tasks])
    await deleteExecutions(pool, (await pool.query('SELECT id FROM task_executions WHERE task_id = ANY($1::uuid[])', [made.tasks])).rows.map((r) => r.id))
  }
  const delta = await deleteNewWorks(pool, worksBefore)
  for (const id of made.tags) await pool.query('DELETE FROM tags WHERE id = $1', [id])
  if (made.tasks.length) await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [made.tasks])
  await resumeRunning(pool, seedSession)
  const left = await pool.query(`SELECT (SELECT count(*) FROM tags WHERE name LIKE '${P}%')::int + (SELECT count(*) FROM tasks WHERE title LIKE '${P}%')::int AS n`)
  const running = await pool.query('SELECT count(*)::int AS n FROM time_entries WHERE ended_at IS NULL')
  check('obras: diferença de contagem 0 depois da limpeza', delta === 0, String(delta))
  check('tags e tarefas de teste apagadas', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  check('sessão do seed devolvida (uma rodando)', running.rows[0].n === seedSession.length, `${running.rows[0].n} x ${seedSession.length}`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
