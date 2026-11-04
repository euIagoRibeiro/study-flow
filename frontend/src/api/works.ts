import type { Work, WorkFields } from '../types'
import { request } from './client'

// As respostas já trazem o progresso e as marcas (campos derivados)
export function listWorks(): Promise<Work[]> {
  return request<Work[]>('/works')
}

export function createWork(fields: WorkFields): Promise<Work> {
  return request<Work>('/works', {
    method: 'POST',
    body: JSON.stringify(fields),
  })
}

// Campo ausente mantém; null limpa (link, medida, total)
export function updateWork(
  id: string,
  changes: Partial<WorkFields>,
): Promise<Work> {
  return request<Work>(`/works/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
}

// Só sem registro; com registro, o caminho é mudar o status
export function deleteWork(id: string): Promise<void> {
  return request<void>(`/works/${id}`, { method: 'DELETE' })
}
