// Calendário do Histórico: contas de dia e mês em texto ("2026-11-19", "2026-11"), sem Date (nenhum fuso
// nem horário de verão entra). Módulo SEM imports: tests/unidade/calendario.mjs o importa direto.
export type DayKey = string
export type MonthKey = string
export type MonthBounds = { min: MonthKey; max: MonthKey }
export type ArrowKey =
  'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'PageUp' | 'PageDown'

const pad = (n: number, size = 2) => String(n).padStart(size, '0')

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

export function dayKey(year: number, month: number, day: number): DayKey {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

export function parseDayKey(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ]
  if (year < 1 || month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

export function isDayKey(value: string): boolean {
  return parseDayKey(value) !== null
}

export function monthOf(key: DayKey): MonthKey {
  return key.slice(0, 7)
}

export function parseMonthKey(
  value: string,
): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) return null
  const [year, month] = [Number(match[1]), Number(match[2])]
  return year >= 1 && month >= 1 && month <= 12 ? { year, month } : null
}

// Dias desde 1970-01-01 (calendário gregoriano), e a volta
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy =
    Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

function civilFromDays(count: number): DayKey {
  const z = count + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) /
      365,
  )
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp < 10 ? mp + 3 : mp - 9
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0)
  return dayKey(year, month, day)
}

function toDays(key: DayKey): number {
  const d = parseDayKey(key)
  if (!d) throw new Error(`dia inválido: ${key}`)
  return daysFromCivil(d.year, d.month, d.day)
}

// 0 = segunda ... 6 = domingo
export function weekdayIndex(key: DayKey): number {
  return (((toDays(key) + 3) % 7) + 7) % 7
}

export function moveDay(key: DayKey, delta: number): DayKey {
  return civilFromDays(toDays(key) + delta)
}

export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const m = parseMonthKey(month)
  if (!m) throw new Error(`mês inválido: ${month}`)
  const index = m.year * 12 + (m.month - 1) + delta
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`
}

// Mesmo dia do mês de destino; se ele é mais curto, o último dia dele (31/01 + 1 = 28/02, ou 29)
export function moveMonthKeepingDay(key: DayKey, delta: number): DayKey {
  const d = parseDayKey(key)
  if (!d) throw new Error(`dia inválido: ${key}`)
  const target = parseMonthKey(shiftMonth(monthOf(key), delta))!
  return dayKey(
    target.year,
    target.month,
    Math.min(d.day, daysInMonth(target.year, target.month)),
  )
}

export type Cell = { key: DayKey; day: number; inMonth: boolean }

// 6 semanas × 7 dias, a semana começa na segunda
export function monthGrid(month: MonthKey): Cell[] {
  const m = parseMonthKey(month)
  if (!m) throw new Error(`mês inválido: ${month}`)
  const first = dayKey(m.year, m.month, 1)
  const start = toDays(first) - weekdayIndex(first)
  const cells: Cell[] = []
  for (let i = 0; i < 42; i++) {
    const key = civilFromDays(start + i)
    cells.push({
      key,
      day: Number(key.slice(8)),
      inMonth: monthOf(key) === month,
    })
  }
  return cells
}

// Quantos registros há em cada dia (chaves que não são dia são ignoradas)
export function countByDay(keys: DayKey[]): Map<DayKey, number> {
  const counts = new Map<DayKey, number>()
  for (const key of keys) {
    if (isDayKey(key)) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

// Do mês do primeiro registro até o maior entre o mês atual e o do último registro
// (registro no futuro continua alcançável). Sem registro: só o mês atual
export function monthBounds(
  keys: DayKey[],
  currentMonth: MonthKey,
): MonthBounds {
  const valid = keys.filter(isDayKey).sort()
  if (valid.length === 0) return { min: currentMonth, max: currentMonth }
  const last = monthOf(valid[valid.length - 1])
  return {
    min: monthOf(valid[0]),
    max: last > currentMonth ? last : currentMonth,
  }
}

export function clampMonth(month: MonthKey, bounds: MonthBounds): MonthKey {
  if (month < bounds.min) return bounds.min
  if (month > bounds.max) return bounds.max
  return month
}

export function canShiftMonth(
  month: MonthKey,
  delta: number,
  bounds: MonthBounds,
): boolean {
  const target = shiftMonth(month, delta)
  return target >= bounds.min && target <= bounds.max
}

// Setas andam por TODOS os dias (os vazios também); PageUp/PageDown, um mês
export function moveFromKey(key: DayKey, arrow: ArrowKey): DayKey {
  switch (arrow) {
    case 'ArrowLeft':
      return moveDay(key, -1)
    case 'ArrowRight':
      return moveDay(key, 1)
    case 'ArrowUp':
      return moveDay(key, -7)
    case 'ArrowDown':
      return moveDay(key, 7)
    case 'PageUp':
      return moveMonthKeepingDay(key, -1)
    case 'PageDown':
      return moveMonthKeepingDay(key, 1)
  }
}

// Os mesmos nomes de dates.ts (módulo sem imports: a lista é repetida; a unidade confere as duas)
const WEEKDAY_NAMES = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MONTH_NAMES = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
]

// "sex, 19 set, 3 registros" / "sex, 19 set, 1 registro" / "sex, 19 set, sem registro"
export function dayAriaLabel(key: DayKey, count: number): string {
  const d = parseDayKey(key)
  if (!d) throw new Error(`dia inválido: ${key}`)
  const weekday = WEEKDAY_NAMES[(weekdayIndex(key) + 1) % 7]
  const records =
    count <= 0
      ? 'sem registro'
      : `${count} ${count === 1 ? 'registro' : 'registros'}`
  return `${weekday}, ${d.day} ${MONTH_NAMES[d.month - 1]}, ${records}`
}
