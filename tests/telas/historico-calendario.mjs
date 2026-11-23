// Histórico: calendário (commit C3). Botão "Calendário" inline (fora da faixa de chips), grade com UMA célula tabulável
// (roving tabindex), rótulo do dia com a contagem, dias sem registro com aria-disabled (o foco passa por eles), setas por
// TODOS os dias, PageUp/PageDown por mês, Home/End pela semana (segunda a domingo), limites de mês entre o primeiro registro e
// o mês atual, Escape, escolher um dia (push no ?dia=; o dia já ativo só fecha), marcadores só pela Frequência. Sem pausa fixa:
// foco, mês e URL por waitForFunction; a checagem de "nada mudou" espera dois quadros de animação (o React já confirmou).
// Dados: reais (contagens por Intl) e injetados (meses M-2..M, hoje = M). Nada é gravado.
// Uso: node --env-file=backend/.env tests/telas/historico-calendario.mjs
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}

// ---- contas de data feitas aqui (Intl e Date.UTC), nunca com o código do app
const TZ = 'America/Sao_Paulo'
const keyOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso))
const todayKey = keyOf(new Date().toISOString())
const [TY, TM] = todayKey.split('-').map(Number)
const p2 = (n) => String(n).padStart(2, '0')
const monthKey = (k) => new Date(Date.UTC(TY, TM - 1 + k, 1)).toISOString().slice(0, 7)
const daysIn = (k) => new Date(Date.UTC(TY, TM + k, 0)).getUTCDate()
const dayK = (k, d) => `${monthKey(k)}-${p2(d)}`
const addDays = (key, n) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
const weekday = (key) => { const [y, m, d] = key.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 } // segunda = 0
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const FULL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const labelOf = (key, count) => {
  const [y, m, d] = key.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${WD[dow]}, ${d} ${MO[m - 1]}, ${count === 0 ? 'sem registro' : `${count} ${count === 1 ? 'registro' : 'registros'}`}`
}
const titleOf = (k) => `${FULL[Number(monthKey(k).slice(5)) - 1]} de ${monthKey(k).slice(0, 4)}`

const apiExecutions = (await (await apiFetch(`${API}/executions`)).json())
const template = apiExecutions.find((e) => e.completedAt !== null)
if (!template) throw new Error('seed sem registro concluído (o molde das respostas)')
const real = apiExecutions.filter((e) => e.completedAt !== null)

// ---- dados injetados: meses M-2 (daily), M-1 (weekly), M (monthly); M-1 com os 6 últimos dias, para a 1ª linha de M ter dias de M-1
let seq = 0
const fake = (key, frequency, hour = '12:00:00') => ({
  ...template, id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, taskTitleAtTime: `cal ${key}`,
  taskFrequencyAtTime: frequency, description: null, completedAt: new Date(`${key}T${hour}-03:00`).toISOString(),
  rootTagId: null, tagIds: [], phase: null, measure: null, workout: null, selections: [], workId: null, linkUrl: null,
})
const injected = []
for (const d of [1, 15, daysIn(-2)]) injected.push(fake(dayK(-2, d), 'daily'))
for (const d of [1, 15, ...Array.from({ length: 6 }, (_, i) => daysIn(-1) - i)]) injected.push(fake(dayK(-1, d), 'weekly'))
for (const d of [1, 15, daysIn(0)]) injected.push(fake(dayK(0, d), 'monthly'))
injected.push(fake(dayK(0, 15), 'monthly', '13:00:00')) // 2 registros no dia 15 de M
const countInjected = (key, frequency = 'all') => injected.filter((e) => keyOf(e.completedAt) === key && (frequency === 'all' || e.taskFrequencyAtTime === frequency)).length

let browser
try {
  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.emulateTimezone(TZ)
  await page.setViewport({ width: 390, height: 1000 })
  const writes = []
  let body = null // null: respostas reais
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { writes.push(`${req.method()} ${req.url()}`); return req.abort() }
    if (body !== null && new URL(req.url()).pathname === '/api/executions') return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    req.continue()
  })

  // A espera que estoura não derruba o processo: a checagem seguinte falha com o nome dela
  const until = (fn, ...args) => page.waitForFunction(fn, { timeout: 5000 }, ...args).catch(() => false)
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const open = async (query = '') => {
    await page.goto(`${APP}/historico${query}`, { waitUntil: 'networkidle0' })
    await until(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Calendário'))
  }
  const toggle = () => page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Calendário').click())
  const openCalendar = async (query = '') => { await open(query); await toggle(); await until(() => document.querySelector('[role="grid"]') && document.activeElement?.dataset?.day) }
  const state = () => page.evaluate(() => {
    const grid = document.querySelector('[role="grid"]')
    const btn = [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Calendário')
    const cells = grid ? [...grid.querySelectorAll('[data-day]')] : []
    const titleEl = grid ? document.getElementById(grid.getAttribute('aria-labelledby')) : null
    const nav = (label) => document.querySelector(`button[aria-label="${label}"]`)
    return {
      open: !!grid, expanded: btn?.getAttribute('aria-expanded'), controls: btn?.getAttribute('aria-controls'),
      inScroller: !!btn?.closest('[role="group"]'),
      title: titleEl?.textContent ?? null, cells: cells.length,
      tabbable: cells.filter((c) => c.tabIndex === 0).map((c) => c.dataset.day),
      onlyRoving: cells.every((c) => c.tabIndex === 0 || c.tabIndex === -1),
      focused: document.activeElement?.dataset?.day ?? null, focusOnButton: document.activeElement === btn,
      status: document.querySelector('[role="status"]')?.textContent ?? null,
      prev: nav('Mês anterior')?.getAttribute('aria-disabled') ?? null, next: nav('Próximo mês')?.getAttribute('aria-disabled') ?? null,
      where: location.pathname + location.search, histLen: history.length,
      info: Object.fromEntries(cells.map((c) => [c.dataset.day, { label: c.getAttribute('aria-label'), disabled: c.getAttribute('aria-disabled'), disabledAttr: c.hasAttribute('disabled'), selected: c.closest('[role="gridcell"]').getAttribute('aria-selected'), inMonth: !c.className.includes('text-tinta-suave') }])),
      emptyText: [...(grid?.parentElement?.querySelectorAll('p') ?? [])].map((p) => p.textContent.trim()).find((t) => /^Nenhum/.test(t)) ?? null,
    }
  })
  const focusIs = (key) => until((k) => document.activeElement?.dataset?.day === k, key)
  const titleIs = (t) => until((x) => { const g = document.querySelector('[role="grid"]'); return g && document.getElementById(g.getAttribute('aria-labelledby')).textContent === x }, t)
  const press = (key) => page.keyboard.press(key)
  const click = (selector) => page.evaluate((s) => document.querySelector(s).click(), selector)
  const clickDay = (key) => click(`[data-day="${key}"]`)
  const pickFrequency = async (value) => { await page.select('select[aria-label="Frequência"]', value) }
  const one = (s, k) => s.tabbable.length === 1 && s.onlyRoving && (k === undefined || s.tabbable[0] === k)

  // ---------- 1. o botão e o abrir/fechar (dados reais)
  await open()
  let s = await state()
  check('o botão "Calendário" existe, fora da faixa rolável dos chips, fechado', s.expanded === 'false' && !s.inScroller && !s.open, `${s.expanded} ${s.inScroller}`)
  await toggle()
  await until(() => document.querySelector('[role="grid"]'))
  s = await state()
  check('abrir: aria-expanded true, aria-controls aponta para o painel que contém a grade', s.expanded === 'true' && s.open && (await page.evaluate((id) => !!document.getElementById(id)?.querySelector('[role="grid"]'), s.controls)), `${s.expanded} ${s.controls}`)
  check('sem dia ativo, abre no mês atual e o foco vai a hoje (a única célula tabulável)', s.title === titleOf(0) && s.focused === todayKey && one(s, todayKey), `${s.title} ${s.focused} ${s.tabbable}`)
  check('a grade tem 42 células (6 semanas)', s.cells === 42, `${s.cells}`)
  await toggle()
  await until(() => !document.querySelector('[role="grid"]'))
  s = await state()
  check('o botão fecha o calendário (aria-expanded false)', s.expanded === 'false' && !s.open)

  // ---------- 2. marcadores e rótulos com os dados reais: contagem por Intl, só pela Frequência (não pelo Período)
  const realCount = (key, frequency = 'all') => real.filter((e) => keyOf(e.completedAt) === key && (frequency === 'all' || e.taskFrequencyAtTime === frequency)).length
  await openCalendar()
  s = await state()
  let bad = Object.entries(s.info).filter(([key, i]) => i.label !== labelOf(key, realCount(key)) || (i.disabled === 'true') !== (realCount(key) === 0) || i.disabledAttr)
  check('cada dia: rótulo com a contagem (Intl), aria-disabled só nos sem registro, e nunca o atributo disabled', bad.length === 0, bad.slice(0, 2).map(([k, i]) => `${k}:${i.label}/${i.disabled}`).join(' | '))
  await page.evaluate(() => [...document.querySelectorAll('[role="group"][aria-label="Período"] button')].find((b) => b.textContent.trim() === 'Hoje').click())
  await until(() => [...document.querySelectorAll('[role="group"][aria-label="Período"] button')].some((b) => b.textContent.trim() === 'Hoje' && b.getAttribute('aria-pressed') === 'true'))
  s = await state()
  bad = Object.entries(s.info).filter(([key, i]) => i.label !== labelOf(key, realCount(key)))
  check('os marcadores NÃO respeitam o Período (com "Hoje" marcado, os dias antigos seguem marcados)', bad.length === 0 && s.open, bad.slice(0, 2).map(([k, i]) => `${k}:${i.label}`).join(' | '))
  const dailyReal = realCount(todayKey, 'daily')
  const someDay = Object.keys(s.info).find((k) => realCount(k) > 0 && realCount(k, 'daily') !== realCount(k))
  await pickFrequency('daily')
  await until((k, expected) => document.querySelector(`[data-day="${k}"]`)?.getAttribute('aria-label').includes(expected), someDay ?? todayKey, labelOf(someDay ?? todayKey, someDay ? realCount(someDay, 'daily') : dailyReal))
  s = await state()
  bad = Object.entries(s.info).filter(([key, i]) => i.label !== labelOf(key, realCount(key, 'daily')))
  check('os marcadores respeitam a Frequência ("Diária"), com o calendário aberto', bad.length === 0, bad.slice(0, 2).map(([k, i]) => `${k}:${i.label}`).join(' | '))
  check('depois de trocar a Frequência, exatamente um elemento tabulável na grade', one(s), `${s.tabbable}`)

  // ---------- 3. mês aberto: dia ativo, e o foco ao abrir nele
  const oldDay = [...new Set(real.map((e) => keyOf(e.completedAt)))].filter((k) => k.slice(0, 7) !== todayKey.slice(0, 7)).sort().at(-1)
  if (oldDay) {
    await openCalendar(`?dia=${oldDay}`)
    s = await state()
    check(`com ?dia= de outro mês (${oldDay}) o calendário abre nesse mês, com o foco no dia ativo e aria-selected nele`,
      s.title === `${FULL[Number(oldDay.slice(5, 7)) - 1]} de ${oldDay.slice(0, 4)}` && s.focused === oldDay && one(s, oldDay) && s.info[oldDay]?.selected === 'true', `${s.title} ${s.focused} ${s.tabbable}`)
    check('só o dia ativo tem aria-selected', Object.values(s.info).filter((i) => i.selected === 'true').length === 1)
  } else check('há um registro de outro mês nos dados reais (para o mês do dia ativo)', false, 'seed sem dia fora do mês atual')

  // ---------- 4. dados injetados: teclado, limites, botões de mês, escolher dia, Escape
  body = injected
  await openCalendar(`?dia=${dayK(0, 1)}`)
  s = await state()
  const first0 = dayK(0, 1)
  check('injetado: abre em M com o foco no dia ativo (1º de M)', s.title === titleOf(0) && s.focused === first0 && one(s, first0), `${s.title} ${s.focused}`)
  check('em M (o mês máximo): o "Próximo mês" está aria-disabled e o "Mês anterior" não', s.next === 'true' && s.prev === null, `${s.prev} ${s.next}`)
  await press('ArrowLeft')
  await focusIs(addDays(first0, -1))
  s = await state()
  check('← do dia 1 de M: o último dia de M-1, e o mês visível acompanha (M-1)', s.title === titleOf(-1) && s.focused === addDays(first0, -1) && one(s, addDays(first0, -1)), `${s.title} ${s.focused}`)
  check('o aviso falado NÃO dispara pelo teclado (status vazio: o rótulo da célula já diz o mês)', s.status === '', `${s.status}`)
  await press('ArrowRight')
  await focusIs(first0)
  await press('ArrowDown')
  await focusIs(addDays(first0, 7))
  await press('ArrowUp')
  await focusIs(first0)
  s = await state()
  check('→, ↓ e ↑: 1 e 7 dias, de volta ao dia 1 de M', s.title === titleOf(0) && s.focused === first0 && one(s, first0))
  // as setas passam pelos dias SEM registro
  await press('ArrowRight')
  await focusIs(addDays(first0, 1))
  s = await state()
  check('a seta para o dia 2 (sem registro) foca nele: não pula os vazios, e ele é aria-disabled', s.focused === addDays(first0, 1) && s.info[addDays(first0, 1)].disabled === 'true' && one(s, addDays(first0, 1)))
  // Home/End a partir de uma quinta-feira (anda 3 dias: nunca é o próprio dia) e a partir do dia 2 (a semana pode ser de M-1)
  const thursday = addDays(first0, ((3 - weekday(first0) + 7) % 7) + 7) // da 2ª semana: longe do dia que tinha o foco
  await page.evaluate((k) => document.querySelector(`[data-day="${k}"]`).focus(), thursday)
  await focusIs(thursday)
  await press('Home')
  await focusIs(addDays(thursday, -3))
  s = await state()
  check('Home numa quinta-feira: a segunda-feira da semana (3 dias antes), e a célula tabulável acompanha', s.focused === addDays(thursday, -3) && one(s, addDays(thursday, -3)), `${s.focused}`)
  await press('End')
  await focusIs(addDays(thursday, 3))
  s = await state()
  check('End: o domingo da semana (6 dias depois da segunda)', s.focused === addDays(thursday, 3) && one(s, addDays(thursday, 3)), `${s.focused}`)
  await page.evaluate((k) => document.querySelector(`[data-day="${k}"]`).focus(), addDays(first0, 1))
  await press('Home')
  const monday = addDays(addDays(first0, 1), -weekday(addDays(first0, 1)))
  await focusIs(monday)
  s = await state()
  check('Home a partir do dia 2 (focado por fora da seta): a segunda-feira da semana, mês acompanhando', s.focused === monday && s.title === titleOf(monday.slice(0, 7) === monthKey(0) ? 0 : -1) && one(s, monday), `${s.focused} ${s.title}`)
  // PageUp/PageDown: mês anterior/seguinte, dia ajustado
  const last0 = dayK(0, daysIn(0))
  await openCalendar(`?dia=${last0}`)
  await press('PageUp')
  const pu = dayK(-1, Math.min(daysIn(0), daysIn(-1)))
  await focusIs(pu)
  s = await state()
  check('PageUp do último dia de M: o mesmo dia de M-1, ajustado se o mês é mais curto', s.focused === pu && s.title === titleOf(-1) && one(s, pu), `${s.focused} ${s.title}`)
  await press('PageDown')
  await focusIs(dayK(0, Math.min(Number(pu.slice(8)), daysIn(0))))
  s = await state()
  check('PageDown volta a M', s.title === titleOf(0) && s.status === '' && one(s))
  // limites: não passa do mês do último registro nem do primeiro
  await openCalendar(`?dia=${last0}`)
  await press('PageDown')
  await frames()
  s = await state()
  check('PageDown em M (o mês máximo): o foco e o mês não mudam', s.title === titleOf(0) && s.focused === last0, `${s.title} ${s.focused}`)
  await openCalendar(`?dia=${dayK(-2, 1)}`)
  await press('ArrowLeft')
  await frames()
  s = await state()
  check('← do 1º dia do primeiro mês com registro (M-2): não sai dos limites', s.title === titleOf(-2) && s.focused === dayK(-2, 1) && one(s, dayK(-2, 1)), `${s.title} ${s.focused}`)

  // botões de mês: mesmo dia ajustado; aviso falado; limites
  await openCalendar(`?dia=${dayK(-2, daysIn(-2))}`)
  s = await state()
  check('M-2: o "Mês anterior" está aria-disabled', s.prev === 'true' && s.next === null, `${s.prev} ${s.next}`)
  await click('button[aria-label="Mês anterior"]')
  await frames()
  s = await state()
  check('clicar no "Mês anterior" aria-disabled NÃO muda o mês, o foco da grade nem o aviso', s.title === titleOf(-2) && s.tabbable[0] === dayK(-2, daysIn(-2)) && s.status === '', `${s.title} ${s.tabbable} "${s.status}"`)
  await click('button[aria-label="Próximo mês"]')
  await titleIs(titleOf(-1))
  s = await state()
  const expectNext = dayK(-1, Math.min(daysIn(-2), daysIn(-1)))
  check('"Próximo mês": a célula tabulável é o mesmo dia do mês novo, ajustado (e só ela)', one(s, expectNext), `${s.tabbable} esperado ${expectNext}`)
  check('"Próximo mês": o aviso falado diz o mês novo (e o botão continua com o foco)', s.status === titleOf(-1), `"${s.status}"`)
  await click('button[aria-label="Próximo mês"]')
  await titleIs(titleOf(0))
  await click('button[aria-label="Próximo mês"]')
  await frames()
  s = await state()
  check('M é o máximo: o "Próximo mês" aria-disabled não avança (mês, célula tabulável e aviso iguais)', s.title === titleOf(0) && s.next === 'true' && s.status === titleOf(0) && one(s), `${s.title} ${s.next} "${s.status}"`)
  await click('button[aria-label="Mês anterior"]')
  await titleIs(titleOf(-1))
  s = await state()
  check('"Mês anterior" volta a M-1 e a grade tem exatamente um elemento tabulável', one(s) && s.status === titleOf(-1))

  // escolher um dia: push, fecha, foco no botão; o dia ativo só fecha; dia vazio não faz nada; dia de fora do mês
  await openCalendar()
  const histBefore = (await state()).histLen
  await clickDay(first0)
  await until((k) => location.search === `?dia=${k}`, first0)
  await until(() => !document.querySelector('[role="grid"]') && document.activeElement?.textContent.trim() === 'Calendário')
  s = await state()
  check('escolher um dia: ?dia= na URL, calendário fechado, foco no botão, e é uma entrada nova no histórico (push)', s.where === `/historico?dia=${first0}` && !s.open && s.focusOnButton && s.histLen === histBefore + 1, `${s.where} ${s.open} ${s.histLen}/${histBefore}`)
  await page.goBack()
  await until(() => location.search === '')
  s = await state()
  check('o Voltar do navegador abre a lista sem dia (o dia anterior)', s.where === '/historico', s.where)
  await openCalendar(`?dia=${first0}`)
  const lenActive = (await state()).histLen
  await clickDay(first0)
  await until(() => !document.querySelector('[role="grid"]') && document.activeElement?.textContent.trim() === 'Calendário')
  s = await state()
  check('escolher o dia que já está ativo: fecha, foco no botão e a URL NÃO muda (sem entrada nova no histórico)', s.where === `/historico?dia=${first0}` && s.focusOnButton && s.histLen === lenActive, `${s.where} ${s.histLen}/${lenActive}`)
  await openCalendar(`?dia=${first0}`)
  const empty0 = addDays(first0, 1)
  await clickDay(empty0)
  await frames()
  s = await state()
  check('tocar num dia sem registro (aria-disabled) não faz nada: a URL e o calendário ficam', s.open && s.where === `/historico?dia=${first0}`, `${s.where} ${s.open}`)
  // Enter num dia com registro escolhe; Espaço num vazio não
  await press('ArrowRight')
  await focusIs(empty0)
  await press('Space')
  await frames()
  s = await state()
  check('Espaço num dia sem registro: nada acontece (o foco fica nele)', s.open && s.focused === empty0 && s.where === `/historico?dia=${first0}`)
  const day15 = dayK(0, 15)
  await page.evaluate((k) => document.querySelector(`[data-day="${k}"]`).focus(), day15)
  await press('Enter')
  await until((k) => location.search === `?dia=${k}`, day15)
  s = await state()
  check('Enter num dia com 2 registros escolhe o dia: a lista mostra os 2 e o calendário fecha', (await page.evaluate(() => document.querySelectorAll('main article').length)) === 2 && !s.open, `${s.where}`)
  await openCalendar(`?dia=${dayK(-1, 15)}`)
  await click('button[aria-label="Próximo mês"]')
  await titleIs(titleOf(0))
  await click('button[aria-label="Mês anterior"]')
  await titleIs(titleOf(-1))
  const outsideKey = dayK(0, 1)
  s = await state()
  check('o mês M-1 mostra o 1º dia de M (dia de fora do mês) com registro e escolhível', s.info[outsideKey]?.disabled === null && s.info[outsideKey]?.label === labelOf(outsideKey, countInjected(outsideKey)), JSON.stringify(s.info[outsideKey]))
  await clickDay(outsideKey)
  await until((k) => location.search === `?dia=${k}`, outsideKey)
  await toggle()
  await until(() => document.querySelector('[role="grid"]'))
  s = await state()
  check('escolher um dia de fora do mês: reabrindo, o calendário está no mês dele', s.title === titleOf(0), s.title)

  // Escape e Tab
  await openCalendar(`?dia=${first0}`)
  await press('Tab')
  await frames()
  s = await state()
  check('Tab sai da grade sem fechar o calendário', s.open && s.focused === null)
  await page.evaluate(() => document.querySelector('[data-roving="true"]').focus())
  await press('Escape')
  await until(() => !document.querySelector('[role="grid"]') && document.activeElement?.textContent.trim() === 'Calendário')
  s = await state()
  check('Escape: fecha, devolve o foco ao botão e a URL não muda', !s.open && s.focusOnButton && s.expanded === 'false' && s.where === `/historico?dia=${first0}`, s.where)

  // ---------- 5. Frequência com o calendário aberto, mês vazio, e os estados de um único tabulável
  await openCalendar()
  s = await state()
  check('aberto em M (injetado): exatamente um elemento tabulável, hoje', one(s, todayKey), `${s.tabbable}`)
  await pickFrequency('daily')
  await until(() => [...document.querySelectorAll('[data-day]')].every((c) => c.getAttribute('aria-disabled') === 'true'))
  s = await state()
  check('Frequência "Diária": M não tem registro diário, então todo o mês está aria-disabled e ainda há exatamente UM tabulável', one(s) && Object.values(s.info).every((i) => i.disabled === 'true'), `${s.tabbable}`)
  check('o mês mostrado continua dentro dos limites e os botões de mês refletem os limites da Frequência', s.title === titleOf(0) && s.prev === null, `${s.title} ${s.prev}`)
  await click('button[aria-label="Mês anterior"]')
  await click('button[aria-label="Mês anterior"]')
  await titleIs(titleOf(-2))
  s = await state()
  check('em M-2 (diários): há dias com registro e um único tabulável', one(s) && Object.values(s.info).some((i) => i.disabled === null), `${s.tabbable}`)
  await pickFrequency('monthly')
  await until((t) => { const g = document.querySelector('[role="grid"]'); return g && document.getElementById(g.getAttribute('aria-labelledby')).textContent === t }, titleOf(0))
  s = await state()
  check('trocar a Frequência para "Mensal": o mês mostrado sai de M-2 (fora dos limites novos) para M, com um único tabulável', s.title === titleOf(0) && one(s) && s.prev === 'true', `${s.title} ${s.prev}`)
  check('"Mensal": a marcação mostra os registros de M', Object.entries(s.info).some(([k, i]) => k === first0 && i.disabled === null))

  // ---------- 6. todos os registros num mês futuro; sem registro algum; sem registro com a Frequência
  body = [fake(dayK(2, 10), 'daily'), fake(dayK(2, 20), 'daily')]
  await openCalendar()
  s = await state()
  check('todos os registros em M+2: o calendário abre em M+2 (o limite inferior), com o "Mês anterior" aria-disabled e um tabulável',
    s.title === titleOf(2) && s.prev === 'true' && s.next === 'true' && one(s, dayK(2, 1)), `${s.title} ${s.prev} ${s.next} ${s.tabbable}`)
  body = []
  await open()
  await toggle()
  await until(() => document.querySelector('[role="grid"]') && document.activeElement?.dataset?.day)
  s = await state()
  check('sem registro algum: a grade toda aria-disabled, os dois botões de mês aria-disabled, um único tabulável e o texto avisa',
    one(s) && Object.values(s.info).every((i) => i.disabled === 'true') && s.prev === 'true' && s.next === 'true' && s.emptyText === 'Nenhum registro ainda.', `${s.emptyText} ${s.tabbable}`)
  body = injected.filter((e) => e.taskFrequencyAtTime === 'daily')
  await openCalendar()
  await pickFrequency('monthly')
  await until(() => [...document.querySelectorAll('p')].some((p) => p.textContent.trim() === 'Nenhum registro com essa frequência.'))
  s = await state()
  check('sem registro com a Frequência escolhida: o texto diz "com essa frequência" e há um único tabulável', one(s) && s.emptyText === 'Nenhum registro com essa frequência.', `${s.emptyText} ${s.tabbable}`)

  check('nada foi gravado pela tela', writes.length === 0, writes.join(' | '))
} finally {
  await browser?.close().catch(() => {})
}

const ok = results.filter(Boolean).length
console.log(`\n${ok} de ${results.length}`)
process.exitCode = ok === results.length ? 0 : 1
