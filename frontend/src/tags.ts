import type { Tag, TaskExecution } from './types'

export type TagIndex = Map<string, Tag>

export function indexTags(tags: Tag[]): TagIndex {
  return new Map(tags.map((tag) => [tag.id, tag]))
}

// sort() sem isso compara código Unicode e põe "Álgebra" depois de "Frações"
export function compareNames(a: string, b: string) {
  return a.localeCompare(b, 'pt-BR')
}

// Da raiz até a tag: [Vestibular, Matemática, Álgebra]
export function tagLineage(tag: Tag, byId: TagIndex): Tag[] {
  const parent = tag.parentId ? byId.get(tag.parentId) : undefined
  return parent ? [...tagLineage(parent, byId), tag] : [tag]
}

export function tagPath(tag: Tag, byId: TagIndex): string {
  return tagLineage(tag, byId)
    .map((t) => t.name)
    .join(' › ')
}

// O que foi escolhido no registro: tagIds é o fechamento gravado (Álgebra
// vem com Matemática), então folha = tag que não é pai de outra do conjunto.
// Registro só com a raiz: a folha é a própria raiz
export function leafTags(
  execution: Pick<TaskExecution, 'rootTagId' | 'tagIds'>,
  byId: TagIndex,
): Tag[] {
  if (execution.tagIds.length === 0) {
    const root = execution.rootTagId ? byId.get(execution.rootTagId) : undefined
    return root ? [root] : []
  }
  const tags = execution.tagIds
    .map((id) => byId.get(id))
    .filter((tag) => tag !== undefined)
  const parents = new Set(tags.map((tag) => tag.parentId))
  return tags
    .filter((tag) => !parents.has(tag.id))
    .sort((a, b) => compareNames(tagPath(a, byId), tagPath(b, byId)))
}
