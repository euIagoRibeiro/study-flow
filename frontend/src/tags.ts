import type {
  CompletedExecution,
  Phase,
  Tag,
  TagChoice,
  TaskExecution,
} from './types'

export type TagIndex = Map<string, Tag>

export function indexTags(tags: Tag[]): TagIndex {
  return new Map(tags.map((tag) => [tag.id, tag]))
}

// sort() sem isso compara código Unicode e põe "Álgebra" depois de "Frações".
// numeric: números pelo valor ("Unidade 2" antes de "Unidade 10")
export function compareNames(a: string, b: string) {
  return a.localeCompare(b, 'pt-BR', { numeric: true })
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

// Caminho escolhido nos campos (até 3 ids, da raiz pra baixo) → o que vai
// pro servidor: a raiz e só a tag mais específica, com a fase
export function pathToChoice(path: string[], phase: Phase | null): TagChoice {
  return {
    rootTagId: path[0] ?? null,
    tagIds: path.length > 1 ? [path[path.length - 1]] : [],
    phase,
  }
}

// Como os campos começam pra um registro que já tem tags. Registro antigo
// com mais de uma folha (de antes da regra de um caminho): os campos param
// no trecho em comum, e legacyCount diz quantas folhas não cabem num campo
export type TagSelection = { path: string[]; legacyCount: number }

export function executionSelection(
  execution: Pick<TaskExecution, 'rootTagId' | 'tagIds'>,
  byId: TagIndex,
): TagSelection {
  const lineages = leafTags(execution, byId).map((leaf) =>
    tagLineage(leaf, byId).map((tag) => tag.id),
  )
  if (lineages.length <= 1) return { path: lineages[0] ?? [], legacyCount: 0 }
  const common = lineages[0].filter((id, level) =>
    lineages.every((lineage) => lineage[level] === id),
  )
  return { path: common, legacyCount: lineages.length }
}

// Pré-seleção: o contexto do registro concluído mais recente dessa tarefa
// que tinha tag (registros sem tag no meio não contam), só se ainda ativo
export function lastRootPath(
  executions: TaskExecution[],
  taskId: string,
  byId: TagIndex,
): string[] {
  const last = executions
    .filter(
      (execution): execution is CompletedExecution =>
        execution.taskId === taskId &&
        execution.completedAt !== null &&
        execution.rootTagId !== null,
    )
    .reduce<CompletedExecution | null>(
      (latest, execution) =>
        latest === null || execution.completedAt > latest.completedAt
          ? execution
          : latest,
      null,
    )
  const root = last?.rootTagId ? byId.get(last.rootTagId) : undefined
  return root?.active ? [root.id] : []
}
