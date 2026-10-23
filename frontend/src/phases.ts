import { leafTags, type TagIndex } from './tags'
import type { CompletedExecution, Phase, TaskExecution } from './types'

// Na ordem do trabalho (a mesma do enum no banco)
export const phases: Phase[] = [
  'requisitos',
  'prototipo',
  'validacao',
  'implementacao',
]

export const phaseLabels: Record<Phase, string> = {
  requisitos: 'Requisitos',
  prototipo: 'Protótipo',
  validacao: 'Validação',
  implementacao: 'Implementação',
}

// Campo de fase: contexto que usa fase e um projeto escolhido. Só o
// contexto não basta (a fase é de um projeto)
export function phaseApplies(path: string[], byId: TagIndex): boolean {
  return path.length >= 2 && byId.get(path[0])?.tracksPhase === true
}

// Pré-seleção: a fase do último registro concluído com o mesmo caminho
// (mesma tag mais específica), de qualquer tarefa; registros sem fase não
// contam. Projeto arquivado: sem pré-seleção
export function lastPhase(
  executions: TaskExecution[],
  path: string[],
  byId: TagIndex,
): Phase | null {
  if (!phaseApplies(path, byId)) return null
  const projectId = path[path.length - 1]
  if (!byId.get(projectId)?.active) return null
  const last = executions
    .filter(
      (execution): execution is CompletedExecution =>
        execution.completedAt !== null &&
        execution.phase !== null &&
        leafTags(execution, byId).some((leaf) => leaf.id === projectId),
    )
    .reduce<CompletedExecution | null>(
      (latest, execution) =>
        latest === null || execution.completedAt > latest.completedAt
          ? execution
          : latest,
      null,
    )
  return last?.phase ?? null
}
