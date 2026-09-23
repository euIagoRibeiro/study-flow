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
