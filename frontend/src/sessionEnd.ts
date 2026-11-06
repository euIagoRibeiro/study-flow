import { parseMinutes } from './numbers'

// Sessão rodando há mais que isto: o painel avisa e o "Durou" já aparece aberto
// (não bloqueia nada). O limite mora só aqui
export const LONG_SESSION_MS = 2 * 60 * 60_000

// "Durou" da sessão rodando (esqueci o cronômetro): o fim passa a ser início +
// duração, e o "Quando" do registro é esse fim. Vazio = o Finalizar vale "agora"
export function sessionEnd(
  startedAt: string,
  text: string,
  now: number,
): { end: string | null } | { error: string } {
  const minutes = parseMinutes(text)
  if (minutes === '') return { end: null }
  if (minutes === null) {
    return { error: 'Durou: minutos inteiros, de 1 a 1440.' }
  }
  const start = new Date(startedAt).getTime()
  const elapsed = Math.floor((now - start) / 60_000)
  if (minutes > elapsed) {
    return {
      error: `Durou: no máximo ${elapsed} min (o tempo desta sessão até agora).`,
    }
  }
  return { end: new Date(start + minutes * 60_000).toISOString() }
}
