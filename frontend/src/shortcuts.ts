import {
  compareNames,
  executionSelection,
  tagLineage,
  type TagIndex,
} from './tags'
import { isChoosablePath } from './timerMemory'
import type { CompletedExecution, Task, TaskExecution, Work } from './types'
import { defaultPath } from './works'

// Atalhos da lista do Executar (O5): "Obras em andamento" e "Recentes". O toque
// abre a tarefa com a obra ou o caminho preenchidos; nada é gravado antes do
// Iniciar ou do Registrar
export const RECENT_LIMIT = 8

const completed = (executions: TaskExecution[]) =>
  executions.filter(
    (execution): execution is CompletedExecution =>
      execution.completedAt !== null,
  )

// Só "em andamento", pela data do registro concluído mais recente da obra (a
// tela carrega todos os registros: GET /executions não tem paginação); sem
// registro, no fim, por título
export function worksInProgress(
  works: Work[],
  executions: TaskExecution[],
): Work[] {
  const last = new Map<string, string>()
  for (const execution of completed(executions)) {
    if (execution.workId === null) continue
    const seen = last.get(execution.workId)
    if (seen === undefined || execution.completedAt > seen) {
      last.set(execution.workId, execution.completedAt)
    }
  }
  return works
    .filter((work) => work.status === 'em_andamento')
    .sort((a, b) => {
      const x = last.get(a.id)
      const y = last.get(b.id)
      if (x !== undefined && y !== undefined && x !== y) return x > y ? -1 : 1
      if (x !== undefined && y === undefined) return -1
      if (x === undefined && y !== undefined) return 1
      return compareNames(a.title, b.title)
    })
}

export type Recent = { taskId: string; path: string[] }

// Os últimos pares distintos de tarefa + caminho (a tag mais funda), dos
// registros concluídos. Fora: registro de obra em andamento (está na seção de
// cima), tarefa arquivada e caminho com tag arquivada (não dá pra escolher). A
// obra não entra na chave nem é preenchida
export function recentPaths(
  executions: TaskExecution[],
  tasks: Task[],
  works: Work[],
  byId: TagIndex,
): Recent[] {
  const inProgress = new Set(
    works.filter((w) => w.status === 'em_andamento').map((w) => w.id),
  )
  const active = new Set(tasks.filter((t) => t.active).map((t) => t.id))
  const seen = new Set<string>()
  const recents: Recent[] = []
  const ordered = completed(executions).sort((a, b) =>
    a.completedAt > b.completedAt ? -1 : a.completedAt < b.completedAt ? 1 : 0,
  )
  for (const execution of ordered) {
    if (recents.length === RECENT_LIMIT) break
    if (execution.workId !== null && inProgress.has(execution.workId)) continue
    if (!active.has(execution.taskId)) continue
    const { path } = executionSelection(execution, byId)
    if (!isChoosablePath(path, byId)) continue
    const key = `${execution.taskId}|${path.at(-1) ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    recents.push({ taskId: execution.taskId, path })
  }
  return recents
}

// O que vem na URL (?obra= ou ?caminho=), já conferido: obra que existe; caminho
// de tags ativas, da raiz pra baixo ("nenhum" = sem caminho). Inválido = null,
// e a tarefa abre normal, sem erro
export type Shortcut = { workId: string } | { path: string[] }

export const NO_PATH = 'nenhum'

export function readShortcut(
  params: URLSearchParams,
  works: Work[],
  byId: TagIndex,
): Shortcut | null {
  const workId = params.get('obra')
  if (workId !== null) {
    return works.some((w) => w.id === workId) ? { workId } : null
  }
  const leaf = params.get('caminho')
  if (leaf === null) return null
  if (leaf === NO_PATH) return { path: [] }
  const tag = byId.get(leaf)
  if (!tag) return null
  const path = tagLineage(tag, byId).map((t) => t.id)
  return isChoosablePath(path, byId) ? { path } : null
}

// O atalho aplicado sobre o começo do formulário, com a regra do toque: a obra
// sobrescreve o caminho (caminho padrão arquivado não preenche); o recente troca
// o caminho e mantém a obra que já estava
export function applyShortcut(
  start: { path: string[]; workId: string | null },
  shortcut: Shortcut,
  works: Work[],
  tags: Parameters<typeof defaultPath>[1],
  byId: TagIndex,
): { path: string[]; workId: string | null } {
  if ('path' in shortcut) return { path: shortcut.path, workId: start.workId }
  const work = works.find((w) => w.id === shortcut.workId)
  const next = work ? defaultPath(work, tags) : []
  return {
    path: next.length > 0 && isChoosablePath(next, byId) ? next : start.path,
    workId: shortcut.workId,
  }
}
