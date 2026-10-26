// Período do Painel: dia, semana (segunda a domingo), mês ou ano, no fuso do
// aparelho.
// A API só recebe instantes (de, ate) + o fuso: quem sabe o que é "semana" é
// a tela. Datas aqui são sempre Date LOCAIS à meia-noite

export type PeriodKind = 'dia' | 'semana' | 'mes' | 'ano'
const KINDS: PeriodKind[] = ['dia', 'semana', 'mes', 'ano']
export type Period = { kind: PeriodKind; start: Date; end: Date } // [start, end)

// O fuso do aparelho, o mesmo que as datas locais usam
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function startOf(kind: PeriodKind, day: Date): Date {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  if (kind === 'dia') return d
  if (kind === 'mes') return new Date(d.getFullYear(), d.getMonth(), 1)
  if (kind === 'ano') return new Date(d.getFullYear(), 0, 1)
  // getDay: 0 = domingo; a semana começa na segunda (ISO)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

// new Date(ano, mês, dia + n) e não + n × 24h: o dia local pode ter 23 ou
// 25 horas em fuso com horário de verão
function endOf(kind: PeriodKind, start: Date): Date {
  return shiftStart(kind, start, 1)
}

// O começo do período n tipos depois (ou antes, com n negativo)
function shiftStart(kind: PeriodKind, start: Date, n: number): Date {
  const [y, m, d] = [start.getFullYear(), start.getMonth(), start.getDate()]
  if (kind === 'dia') return new Date(y, m, d + n)
  if (kind === 'semana') return new Date(y, m, d + 7 * n)
  if (kind === 'mes') return new Date(y, m + n, 1)
  return new Date(y + n, 0, 1)
}

export function periodAt(kind: PeriodKind, day: Date): Period {
  const start = startOf(kind, day)
  return { kind, start, end: endOf(kind, start) }
}

// Da URL (?periodo=dia|semana|mes|ano&inicio=AAAA-MM-DD). Inválido ou ausente: a
// semana de hoje. Um início no meio do período cai no começo dele
export function periodFromParams(params: URLSearchParams, today: Date): Period {
  const raw = params.get('periodo')
  const kind = KINDS.find((k) => k === raw) ?? null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(params.get('inicio') ?? '')
  if (!kind || !match) return periodAt('semana', today)
  const month = Number(match[2]) - 1
  const day = new Date(Number(match[1]), month, Number(match[3]))
  // 2025-02-31 viraria 3 de março em silêncio: inválido
  if (day.getMonth() !== month) return periodAt('semana', today)
  return periodAt(kind, day)
}

export function toParams(period: Period): Record<string, string> {
  const s = period.start
  const ymd = `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`
  return { periodo: period.kind, inicio: ymd }
}

// Anterior/próximo: −1/+1 dia, semana, mês ou ano
export function shift(period: Period, direction: 1 | -1): Period {
  return periodAt(period.kind, shiftStart(period.kind, period.start, direction))
}

export function contains(period: Period, moment: Date): boolean {
  return moment >= period.start && moment < period.end
}

// "seg., 26 de out.", "19 – 25 de out.", "29 de set. – 5 de out.", "outubro
// de 2026", "2026"; o ano só aparece no dia e na semana quando não é o de hoje
export function periodLabel(period: Period, today: Date): string {
  if (period.kind === 'ano') return String(period.start.getFullYear())
  if (period.kind === 'dia') {
    return period.start.toLocaleDateString('pt-BR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(period.start.getFullYear() === today.getFullYear()
        ? {}
        : { year: 'numeric' as const }),
    })
  }
  if (period.kind === 'mes') {
    return period.start.toLocaleDateString('pt-BR', {
      month: 'long',
      year: 'numeric',
    })
  }
  const last = new Date(period.end)
  last.setDate(last.getDate() - 1)
  const year =
    last.getFullYear() === today.getFullYear()
      ? {}
      : { year: 'numeric' as const }
  const sameMonth = last.getMonth() === period.start.getMonth()
  const first = sameMonth
    ? String(period.start.getDate())
    : period.start.toLocaleDateString('pt-BR', {
        day: 'numeric',
        month: 'short',
      })
  return `${first} – ${last.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', ...year })}`
}

// ---- Gráficos

// Cor de categoria pela ORDEM (a da tabela, do maior pro menor): a bolinha
// da linha e a fatia sempre batem. Classes por extenso, pro Tailwind achar
const COLORS = [
  { color: 'var(--categoria-1)', dot: 'bg-categoria-1' },
  { color: 'var(--categoria-2)', dot: 'bg-categoria-2' },
  { color: 'var(--categoria-3)', dot: 'bg-categoria-3' },
  { color: 'var(--categoria-4)', dot: 'bg-categoria-4' },
  { color: 'var(--categoria-5)', dot: 'bg-categoria-5' },
]
const OTHERS = { color: 'var(--categoria-outros)', dot: 'bg-categoria-outros' }

// Da 6ª em diante, "outros" (cinza): uma fatia só, somada
export function categoryAt(index: number) {
  return COLORS[index] ?? OTHERS
}

export function percent(part: number, total: number): string {
  const value = (part / total) * 100
  return value > 0 && value < 1 ? '<1%' : `${Math.round(value)}%`
}

// Fatias da pizza: as 5 maiores com cor; o resto vira "outros". O % só nas
// fatias grandes (≥ 10%): nas pequenas não cabe, e a tabela tem todos
export function toSlices(items: { seconds: number }[]) {
  const total = items.reduce((sum, item) => sum + item.seconds, 0)
  const shown = items.slice(0, COLORS.length).map((item, i) => ({
    value: item.seconds,
    color: COLORS[i].color,
  }))
  const rest = items
    .slice(COLORS.length)
    .reduce((sum, item) => sum + item.seconds, 0)
  const slices =
    rest > 0 ? [...shown, { value: rest, color: OTHERS.color }] : shown
  return slices.map((slice) => ({
    ...slice,
    label: slice.value / total >= 0.1 ? percent(slice.value, total) : undefined,
  }))
}

const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
const MONTHS = [
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

// Rótulo de cada barra: o dia da semana (na semana), "dd/mm" do início da
// semana (no mês) ou o mês (no ano). start = 'AAAA-MM-DD' da API
export function barLabel(kind: PeriodKind, start: string, index: number) {
  if (kind === 'semana') return WEEKDAYS[index]
  if (kind === 'ano') return MONTHS[Number(start.slice(5, 7)) - 1]
  return `${start.slice(8)}/${start.slice(5, 7)}`
}

// Nome do mês por extenso (tabela do ano), da faixa 'AAAA-MM-DD' da API
export function monthName(start: string): string {
  return new Date(
    Number(start.slice(0, 4)),
    Number(start.slice(5, 7)) - 1,
    1,
  ).toLocaleDateString('pt-BR', { month: 'long' })
}

// As faixas das barras: dia na semana, semana no mês, mês no ano; o dia não
// tem barras
export const barsBy = {
  dia: null,
  semana: 'dia',
  mes: 'semana',
  ano: 'mes',
} as const

// "neste dia", "nesta semana"…: o fim das frases de período vazio
export const periodNoun = {
  dia: 'neste dia',
  semana: 'nesta semana',
  mes: 'neste mês',
  ano: 'neste ano',
} as const
