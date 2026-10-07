import type { Tag } from '../types'
import { request } from './client'

// Já vem na ordem da árvore (raiz → filhos → netos), feita no SQL
export function listTags(): Promise<Tag[]> {
  return request<Tag[]>('/tags')
}

// Nível e raiz quem calcula é o servidor, a partir do pai
export function createTag(name: string, parentId: string | null): Promise<Tag> {
  return request<Tag>('/tags', {
    method: 'POST',
    body: JSON.stringify({ name, parentId }),
  })
}

// Arquivar desce em cascata: archivedDescendants diz quais foram junto
type UpdatedTag = Tag & { archivedDescendants: string[] }

function updateTag(
  id: string,
  changes: { name?: string; active?: boolean },
): Promise<UpdatedTag> {
  return request<UpdatedTag>(`/tags/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
}

export function renameTag(id: string, name: string) {
  return updateTag(id, { name })
}

export function archiveTag(id: string) {
  return updateTag(id, { active: false })
}

export function reactivateTag(id: string) {
  return updateTag(id, { active: true })
}

export function deleteTag(id: string): Promise<void> {
  return request<void>(`/tags/${id}`, { method: 'DELETE' })
}
