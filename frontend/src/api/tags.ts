import type { Tag } from '../types'
import { request } from './client'

// Já vem na ordem da árvore (raiz → filhos → netos), feita no SQL
export function listTags(): Promise<Tag[]> {
  return request<Tag[]>('/tags')
}
