// Unidade: contas do calendário do Histórico (frontend/src/calendar.ts, módulo sem imports e sem Date). O teste confere
// tudo contra Date.UTC em TODOS os dias de 1900 a 2200, e à mão nos casos de borda. Sem banco, API, seed nem navegador.
// Uso (raiz de tests/): node unidade/calendario.mjs
import {
  canShiftMonth,
  clampMonth,
  countByDay,
  dayAriaLabel,
  dayKey,
  daysInMonth,
  isDayKey,
  isLeapYear,
  monthBounds,
  monthGrid,
  monthOf,
  monthTitle,
  moveDay,
  moveFromKey,
  moveMonthKeepingDay,
  parseDayKey,
  shiftMonth,
  weekEnd,
  weekStart,
  weekdayIndex,
} from '../../frontend/src/calendar.ts'
import { formatDayLabel } from '../../frontend/src/dates.ts'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const same = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `obtido ${JSON.stringify(got)}, esperado ${JSON.stringify(want)}`)

const throws = (fn) => { try { fn(); return false } catch { return true } }
const p2 = (n) => String(n).padStart(2, '0')
const keyOf = (ms) => {
  const d = new Date(ms)
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
}
const monthKeyOf = (ms) => keyOf(ms).slice(0, 7)
const utc = (y, m, d) => Date.UTC(y, m - 1, d)
const DAY = 86400000

// ---- oráculo: Date.UTC, todos os dias de 1900-01-01 a 2200-12-31
const FIRST = utc(1900, 1, 1)
const LAST = utc(2200, 12, 31)
const bad = { weekday: [], isDay: [], moveDay: [], keepDay: [], parse: [], aria: [], week: [] }
let days = 0
// formatDayLabel de um "agora" em outro ano devolve "sex, 19 set 2026" (sem Hoje/Ontem)
const farNow = new Date(1800, 0, 1)
for (let ms = FIRST; ms <= LAST; ms += DAY) {
  days++
  const key = keyOf(ms)
  const date = new Date(ms)
  if (weekdayIndex(key) !== (date.getUTCDay() + 6) % 7) bad.weekday.push(key)
  if (!isDayKey(key)) bad.isDay.push(key)
  const back = (date.getUTCDay() + 6) % 7
  if (weekStart(key) !== keyOf(ms - back * DAY) || weekEnd(key) !== keyOf(ms + (6 - back) * DAY)) bad.week.push(key)
  if (moveFromKey(key, 'Home') !== keyOf(ms - back * DAY) || moveFromKey(key, 'End') !== keyOf(ms + (6 - back) * DAY)) bad.week.push(`tecla ${key}`)
  const parsed = parseDayKey(key)
  if (!parsed || dayKey(parsed.year, parsed.month, parsed.day) !== key) bad.parse.push(key)
  for (const delta of [-1, 1, -7, 7, -31, 45]) {
    if (moveDay(key, delta) !== keyOf(ms + delta * DAY)) bad.moveDay.push(`${key} ${delta}`)
  }
  for (const delta of [-1, 1, -12, 13]) {
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1))
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
    const want = `${keyOf(target.getTime()).slice(0, 8)}${p2(Math.min(date.getUTCDate(), last))}`
    if (moveMonthKeepingDay(key, delta) !== want) bad.keepDay.push(`${key} ${delta}`)
  }
  const local = new Date(parsed.year, parsed.month - 1, parsed.day, 12)
  const label = dayAriaLabel(key, 0).split(', ').slice(0, 2).join(', ')
  if (`${label} ${parsed.year}` !== formatDayLabel(local.toISOString(), farNow)) bad.aria.push(key)
}
check('todos os dias de 1900 a 2200 percorridos', days === 109938, `${days}`)
same('weekdayIndex = Date.UTC em todos os dias (segunda = 0)', bad.weekday.slice(0, 3), [])
same('isDayKey aceita todos os dias reais e parseDayKey/dayKey fazem a volta', [bad.isDay.length, bad.parse.length], [0, 0])
same('moveDay (±1, ±7, -31, +45) = Date.UTC em todos os dias', bad.moveDay.slice(0, 3), [])
same('weekStart/weekEnd (e as teclas Home/End) = Date.UTC em todos os dias: segunda a domingo', bad.week.slice(0, 3), [])
same('moveMonthKeepingDay (±1, -12, +13) = Date.UTC com o dia ajustado, em todos os dias', bad.keepDay.slice(0, 3), [])
same('dayAriaLabel: nomes de dia e mês = formatDayLabel de dates.ts, em todos os dias', bad.aria.slice(0, 3), [])

const badMonths = []
const badGrid = []
for (let year = 1900; year <= 2200; year++) {
  for (let month = 1; month <= 12; month++) {
    const ym = `${year}-${p2(month)}`
    for (const delta of [-25, -13, -1, 1, 12, 25]) {
      if (shiftMonth(ym, delta) !== monthKeyOf(Date.UTC(year, month - 1 + delta, 1))) badMonths.push(`${ym} ${delta}`)
    }
    if (daysInMonth(year, month) !== new Date(Date.UTC(year, month, 0)).getUTCDate()) badMonths.push(`dias ${ym}`)
    const grid = monthGrid(ym)
    const first = utc(year, month, 1)
    const offset = (new Date(first).getUTCDay() + 6) % 7
    const okGrid =
      grid.length === 42 &&
      grid.every((cell, i) => {
        const ms = first - offset * DAY + i * DAY
        return cell.key === keyOf(ms) && cell.day === new Date(ms).getUTCDate() && cell.inMonth === (monthKeyOf(ms) === ym)
      })
    if (!okGrid) badGrid.push(ym)
  }
}
same('shiftMonth (-25, -13, -1, +1, +12, +25) e daysInMonth = Date.UTC em todos os meses', badMonths.slice(0, 3), [])
same('monthGrid = Date.UTC: 42 células, semana na segunda, dia e inMonth certos, em todos os meses', badGrid.slice(0, 3), [])

// ---- à mão
same('bissexto: 2000 sim', isLeapYear(2000), true)
same('bissexto: 1900 não', isLeapYear(1900), false)
same('bissexto: 2100 não', isLeapYear(2100), false)
same('bissexto: 2024 sim, 2026 não', [isLeapYear(2024), isLeapYear(2026)], [true, false])
same('fevereiro: 28 e 29 dias', [daysInMonth(2026, 2), daysInMonth(2028, 2)], [28, 29])
same('meses de 30 e de 31 dias', [daysInMonth(2026, 4), daysInMonth(2026, 11), daysInMonth(2026, 1), daysInMonth(2026, 12)], [30, 30, 31, 31])
same('29/02 só em bissexto', [isDayKey('2028-02-29'), isDayKey('2026-02-29'), isDayKey('2100-02-29'), isDayKey('2000-02-29')], [true, false, false, true])
same('chaves inválidas recusadas', ['2026-02-30', '2026-13-01', '2026-00-10', '2026-11-00', '2026-11-31', '2026-1-1', '26-11-01', '2026-11-1a', '', 'hoje', '2026-11-01T00:00', ' 2026-11-01', '0000-01-01'].map(isDayKey), Array(13).fill(false))
same('datas reais aceitas', ['2026-11-30', '2026-12-31', '0001-01-01', '9999-12-31'].map(isDayKey), [true, true, true, true])
same('monthOf', monthOf('2026-11-19'), '2026-11')
same('weekdayIndex à mão: 2026-11-20 é sexta (4), 2026-11-23 é segunda (0), 2026-11-22 é domingo (6)', [weekdayIndex('2026-11-20'), weekdayIndex('2026-11-23'), weekdayIndex('2026-11-22')], [4, 0, 6])
same('virada de ano: 2026-12-31 + 1 = 2027-01-01 e volta', [moveDay('2026-12-31', 1), moveDay('2027-01-01', -1)], ['2027-01-01', '2026-12-31'])
same('virada de ano no mês: 2026-12 + 1 = 2027-01; 2027-01 - 1 = 2026-12', [shiftMonth('2026-12', 1), shiftMonth('2027-01', -1)], ['2027-01', '2026-12'])
same('shiftMonth 0 e vários anos', [shiftMonth('2026-05', 0), shiftMonth('2026-05', 24), shiftMonth('2026-05', -17)], ['2026-05', '2028-05', '2024-12'])
same('29/02/2028 + 1 dia e + 366 dias', [moveDay('2028-02-28', 1), moveDay('2027-03-01', 366)], ['2028-02-29', '2028-03-01'])
same('31/01 + 1 mês = 28/02 (ano comum)', moveMonthKeepingDay('2026-01-31', 1), '2026-02-28')
same('31/01 + 1 mês = 29/02 (bissexto)', moveMonthKeepingDay('2028-01-31', 1), '2028-02-29')
same('29/02 + 12 meses = 28/02 do ano seguinte; + 48 = 29/02', [moveMonthKeepingDay('2028-02-29', 12), moveMonthKeepingDay('2028-02-29', 48)], ['2029-02-28', '2032-02-29'])
same('31/03 - 1 mês = 28/02; 30/12 + 2 = 28/02 atravessando o ano', [moveMonthKeepingDay('2026-03-31', -1), moveMonthKeepingDay('2026-12-30', 2)], ['2026-02-28', '2027-02-28'])
same('mês de destino do mesmo tamanho mantém o dia', moveMonthKeepingDay('2026-03-15', 1), '2026-04-15')
same('31/10 + 1 = 30/11; 31/12 + 1 = 31/01 do ano seguinte', [moveMonthKeepingDay('2026-10-31', 1), moveMonthKeepingDay('2026-12-31', 1)], ['2026-11-30', '2027-01-31'])

// grade à mão
const nov = monthGrid('2026-11')
same('novembro de 2026: começa no domingo 01, então a 1ª linha tem 6 dias de outubro', [nov[0].key, nov[0].inMonth, nov[6].key, nov[6].inMonth], ['2026-10-26', false, '2026-11-01', true])
same('novembro de 2026: termina em 2026-12-06 (42 células)', [nov.length, nov[41].key, nov[41].inMonth], [42, '2026-12-06', false])
const jun = monthGrid('2026-06')
same('junho de 2026 começa numa segunda: sem dia de maio antes do dia 1', [jun[0].key, jun[0].inMonth], ['2026-06-01', true])
const jan = monthGrid('2027-01')
same('janeiro de 2027: a grade começa em dezembro de 2026 (virada de ano)', [jan[0].key, jan[0].inMonth, jan.filter((c) => c.inMonth).length], ['2026-12-28', false, 31])
same('fevereiro bissexto tem 29 células do mês; comum, 28', [monthGrid('2028-02').filter((c) => c.inMonth).length, monthGrid('2026-02').filter((c) => c.inMonth).length], [29, 28])
same('a grade nunca repete dia e é contígua', monthGrid('2026-11').every((c, i, all) => i === 0 || moveDay(all[i - 1].key, 1) === c.key), true)

// contagem e limites
same('countByDay conta por dia e ignora o que não é dia', [...countByDay(['2026-11-19', '2026-11-19', '2026-11-20', 'lixo', '2026-02-30'])], [['2026-11-19', 2], ['2026-11-20', 1]])
same('countByDay vazio', [...countByDay([])], [])
same('limites: sem registro, só o mês atual', monthBounds([], '2026-11'), { min: '2026-11', max: '2026-11' })
same('limites: do mês do 1º registro ao mês atual', monthBounds(['2026-09-30', '2026-03-01', '2026-10-05'], '2026-11'), { min: '2026-03', max: '2026-11' })
same('limites: registro no futuro ainda é alcançável', monthBounds(['2026-09-30', '2027-02-10'], '2026-11'), { min: '2026-09', max: '2027-02' })
same('limites: todos no mesmo mês atual', monthBounds(['2026-11-02', '2026-11-19'], '2026-11'), { min: '2026-11', max: '2026-11' })
same('limites: ignora chave inválida', monthBounds(['lixo', '2026-05-01'], '2026-11'), { min: '2026-05', max: '2026-11' })
same('limites: não altera a lista recebida', (() => { const keys = ['2026-10-01', '2026-01-01']; monthBounds(keys, '2026-11'); return keys })(), ['2026-10-01', '2026-01-01'])
const bounds = { min: '2026-03', max: '2026-11' }
same('clampMonth: dentro, abaixo e acima', [clampMonth('2026-05', bounds), clampMonth('2025-12', bounds), clampMonth('2027-01', bounds)], ['2026-05', '2026-03', '2026-11'])
same('canShiftMonth: o limite é inclusivo nos dois lados', [canShiftMonth('2026-04', -1, bounds), canShiftMonth('2026-03', -1, bounds), canShiftMonth('2026-10', 1, bounds), canShiftMonth('2026-11', 1, bounds)], [true, false, true, false])

// teclado
same('ArrowLeft/Right: ±1 dia, passando de mês', [moveFromKey('2026-11-01', 'ArrowLeft'), moveFromKey('2026-11-30', 'ArrowRight')], ['2026-10-31', '2026-12-01'])
same('ArrowUp/Down: ±7 dias, passando de mês e de ano', [moveFromKey('2026-11-03', 'ArrowUp'), moveFromKey('2026-12-28', 'ArrowDown')], ['2026-10-27', '2027-01-04'])
same('as setas andam por TODOS os dias: a sequência de 1 dia nunca pula', Array.from({ length: 10 }).reduce((acc) => [...acc, moveFromKey(acc.at(-1), 'ArrowRight')], ['2026-02-25']), ['2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07'])
same('PageUp/PageDown: um mês, com o dia ajustado', [moveFromKey('2026-03-31', 'PageUp'), moveFromKey('2026-01-31', 'PageDown')], ['2026-02-28', '2026-02-28'])

// semana à mão (segunda a domingo)
same('sexta 2026-11-20: semana de 16 a 22', [weekStart('2026-11-20'), weekEnd('2026-11-20')], ['2026-11-16', '2026-11-22'])
same('segunda é o início dela mesma e domingo é o fim dele mesmo', [weekStart('2026-11-16'), weekEnd('2026-11-22'), weekEnd('2026-11-16'), weekStart('2026-11-22')], ['2026-11-16', '2026-11-22', '2026-11-22', '2026-11-16'])
same('semana que atravessa o ano: 2027-01-01 = de 28/12 a 03/01', [weekStart('2027-01-01'), weekEnd('2027-01-01')], ['2026-12-28', '2027-01-03'])
same('semana de 29/02/2028 (terça): de 28/02 a 05/03', [weekStart('2028-02-29'), weekEnd('2028-02-29')], ['2028-02-28', '2028-03-05'])
same('Home e End: a semana do dia', [moveFromKey('2026-11-20', 'Home'), moveFromKey('2026-11-20', 'End')], ['2026-11-16', '2026-11-22'])

// rótulo
same('rótulo: vários registros', dayAriaLabel('2026-11-20', 3), 'sex, 20 nov, 3 registros')
same('rótulo: um registro (singular)', dayAriaLabel('2026-11-20', 1), 'sex, 20 nov, 1 registro')
same('rótulo: nenhum registro', dayAriaLabel('2026-11-22', 0), 'dom, 22 nov, sem registro')
same('rótulo: domingo e sábado', [dayAriaLabel('2026-11-21', 2), dayAriaLabel('2026-11-22', 2)], ['sáb, 21 nov, 2 registros', 'dom, 22 nov, 2 registros'])
same('rótulo: 29/02 de ano bissexto', dayAriaLabel('2028-02-29', 1), 'ter, 29 fev, 1 registro')

// título do mês (cabeçalho do calendário)
same('monthTitle: os 12 meses por extenso, com o ano', Array.from({ length: 12 }, (_, i) => monthTitle(`2026-${String(i + 1).padStart(2, '0')}`)).join('|'), 'janeiro de 2026|fevereiro de 2026|março de 2026|abril de 2026|maio de 2026|junho de 2026|julho de 2026|agosto de 2026|setembro de 2026|outubro de 2026|novembro de 2026|dezembro de 2026')
same('monthTitle: ano de 4 dígitos e mês inválido lança erro', [monthTitle('1999-12'), throws(() => monthTitle('2026-13'))], ['dezembro de 1999', true])

// erros claros em vez de data inventada
same('dia ou mês inválido lança erro (nunca inventa uma data)', [throws(() => moveDay('2026-02-30', 1)), throws(() => shiftMonth('2026-13', 1)), throws(() => monthGrid('lixo')), throws(() => dayAriaLabel('x', 1)), throws(() => moveMonthKeepingDay('x', 1)), throws(() => weekdayIndex('2026-02-30'))], Array(6).fill(true))

const ok = results.filter(Boolean).length
console.log(`\n${ok} de ${results.length}`)
process.exitCode = ok === results.length ? 0 : 1
