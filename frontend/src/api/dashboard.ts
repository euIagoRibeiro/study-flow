import type { TimeByContext } from '../types'
import { request } from './client'

// O período vai como instantes (a tela calcula as bordas no fuso dela) e o
// fuso do aparelho, que a API valida
export function getTimeByContext(
  de: Date,
  ate: Date,
  fuso: string,
): Promise<TimeByContext> {
  const query = new URLSearchParams({
    de: de.toISOString(),
    ate: ate.toISOString(),
    fuso,
  })
  return request<TimeByContext>(`/dashboard/tempo-por-contexto?${query}`)
}
