import type { Phase, TimeByContext } from '../types'
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

function query(de: Date, ate: Date, fuso: string, extra = {}) {
  return new URLSearchParams({
    de: de.toISOString(),
    ate: ate.toISOString(),
    fuso,
    ...extra,
  })
}

// Subtags (nível 2) de um contexto; tagId null = "(sem subtag)"
export function getTimeBySubtag(
  de: Date,
  ate: Date,
  fuso: string,
  contexto: string,
): Promise<{ items: { tagId: string | null; seconds: number }[] }> {
  return request(
    `/dashboard/tempo-por-subtag?${query(de, ate, fuso, { contexto })}`,
  )
}

// Fases de um contexto que usa fases; phase null = "(sem fase)"
export function getTimeByPhase(
  de: Date,
  ate: Date,
  fuso: string,
  contexto: string,
): Promise<{ items: { phase: Phase | null; seconds: number }[] }> {
  return request(
    `/dashboard/tempo-por-fase?${query(de, ate, fuso, { contexto })}`,
  )
}

// Faixas de 1 dia (semana) ou 1 semana (mês), no fuso
export function getTimeByPeriod(
  de: Date,
  ate: Date,
  fuso: string,
  por: 'dia' | 'semana',
): Promise<{ items: { start: string; seconds: number }[] }> {
  return request(
    `/dashboard/tempo-por-periodo?${query(de, ate, fuso, { por })}`,
  )
}
