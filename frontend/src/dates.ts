// Compara ano/mês/dia no horário local. Cortar a string ISO erraria o dia
// perto da meia-noite, porque a ISO vem em UTC e o dia do usuário é o local.
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
