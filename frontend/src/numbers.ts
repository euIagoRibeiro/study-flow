// Números digitados vêm de campo de TEXTO, não type="number": com o
// navegador em inglês, o campo numérico transforma "4,5" em 45 sem avisar
// (testado em 2026-10-23). Quem converte e valida é aqui

export const MINUTES_ERROR = 'Duração: minutos inteiros, de 1 a 1440'

// Duração estimada: '' = sem estimativa; null = inválido (MINUTES_ERROR)
export function parseMinutes(text: string): number | '' | null {
  const value = text.trim()
  if (value === '') return ''
  if (!/^\d+$/.test(value)) return null
  const minutes = Number(value)
  return minutes >= 1 && minutes <= 1440 ? minutes : null
}
