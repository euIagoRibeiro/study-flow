// Período do Painel: semana (segunda a domingo) ou mês, no fuso do aparelho.
// A API só recebe instantes (de, ate) + o fuso: quem sabe o que é "semana" é
// a tela. Datas aqui são sempre Date LOCAIS à meia-noite

export type PeriodKind = 'semana' | 'mes'
export type Period = { kind: PeriodKind; start: Date; end: Date } // [start, end)

// O fuso do aparelho, o mesmo que as datas locais usam
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function startOf(kind: PeriodKind, day: Date): Date {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  if (kind === 'mes') return new Date(d.getFullYear(), d.getMonth(), 1)
  // getDay: 0 = domingo; a semana começa na segunda (ISO)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

// new Date(ano, mês, dia + n) e não + n × 24h: o dia local pode ter 23 ou
// 25 horas em fuso com horário de verão
function endOf(kind: PeriodKind, start: Date): Date {
  return kind === 'mes'
    ? new Date(start.getFullYear(), start.getMonth() + 1, 1)
    : new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
}

export function periodAt(kind: PeriodKind, day: Date): Period {
  const start = startOf(kind, day)
  return { kind, start, end: endOf(kind, start) }
}

// Da URL (?periodo=semana|mes&inicio=AAAA-MM-DD). Inválido ou ausente: a
// semana de hoje. Um início no meio do período cai no começo dele
export function periodFromParams(params: URLSearchParams, today: Date): Period {
  const raw = params.get('periodo')
  const kind = raw === 'semana' || raw === 'mes' ? raw : null
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

// Anterior/próximo: −1/+1 semana ou mês
export function shift(period: Period, direction: 1 | -1): Period {
  const s = period.start
  const day =
    period.kind === 'mes'
      ? new Date(s.getFullYear(), s.getMonth() + direction, 1)
      : new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7 * direction)
  return periodAt(period.kind, day)
}

export function contains(period: Period, moment: Date): boolean {
  return moment >= period.start && moment < period.end
}

// "19 – 25 de out.", "29 de set. – 5 de out.", "outubro de 2026"; o ano só
// aparece na semana quando não é o de hoje
export function periodLabel(period: Period, today: Date): string {
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
