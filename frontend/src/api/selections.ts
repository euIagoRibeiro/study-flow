import type { Selection } from '../types'
import { request } from './client'

// Todas, inclusive as arquivadas: a tela decide o que mostrar
export function listSelections(): Promise<Selection[]> {
  return request<Selection[]>('/selections')
}
