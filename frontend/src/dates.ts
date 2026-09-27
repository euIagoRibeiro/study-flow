// Compara ano/mês/dia local — cortar a string ISO erraria o dia (UTC vs local)
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// completedAt é ISO/UTC; datetime-local trabalha em hora local, sem fuso

// ISO (UTC) -> valor de hora local pro input ("2026-09-23T11:30")
export function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// valor do input (sem fuso, o navegador assume hora local) -> ISO (UTC)
export function fromDatetimeLocalValue(value: string): string {
  return new Date(value).toISOString()
}

export type PeriodFilter = 'all' | 'today' | '7d' | 'month' | 'year'

// Compara por data local, mesmo princípio do isSameLocalDay
export function matchesPeriod(iso: string, period: PeriodFilter): boolean {
  if (period === 'all') return true

  const date = new Date(iso)
  const now = new Date()

  if (period === 'today') return isSameLocalDay(date, now)

  if (period === '7d') {
    const cutoff = new Date(now)
    cutoff.setHours(0, 0, 0, 0)
    cutoff.setDate(cutoff.getDate() - 6) // hoje + 6 dias atrás = 7 dias
    return date >= cutoff
  }

  if (period === 'month') {
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth()
    )
  }

  return date.getFullYear() === now.getFullYear() // 'year'
}

const pad = (n: number) => String(n).padStart(2, '0')

// Chave do dia LOCAL ("2026-09-26"), pra agrupar sem cair no dia UTC
export function localDayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const weekdays = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const months = [
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

// "Hoje", "Ontem", "sex, 19 set" — o ano só aparece se não for o atual
export function formatDayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso)
  if (isSameLocalDay(date, now)) return 'Hoje'
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (isSameLocalDay(date, yesterday)) return 'Ontem'
  const year =
    date.getFullYear() === now.getFullYear() ? '' : ` ${date.getFullYear()}`
  return `${weekdays[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]}${year}`
}

// "13:20", hora local
export function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// "01:05:09" — o formato do relógio, rodando ou parado
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(Math.max(0, ms) / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0
    ? `${hours}h${String(minutes).padStart(2, '0')}`
    : `${minutes}min`
}
