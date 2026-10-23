import { compareNames, leafTags, type TagIndex } from './tags'
import type { CompletedExecution, TaskExecution } from './types'

// Unidade pré-preenchida (nunca o número): a do último registro concluído
// com quantidade e o mesmo caminho (mesma tag mais específica, de qualquer
// tarefa); sem tag, a do último registro SEM tag da mesma tarefa. Registros
// sem quantidade não contam
export function suggestUnit(
  executions: TaskExecution[],
  path: string[],
  taskId: string,
  byId: TagIndex,
): string | null {
  const leafId = path[path.length - 1]
  const last = executions
    .filter(
      (execution): execution is CompletedExecution =>
        execution.completedAt !== null &&
        execution.quantityUnit !== null &&
        (leafId === undefined
          ? execution.taskId === taskId && execution.rootTagId === null
          : leafTags(execution, byId).some((leaf) => leaf.id === leafId)),
    )
    .reduce<CompletedExecution | null>(
      (latest, execution) =>
        latest === null || execution.completedAt > latest.completedAt
          ? execution
          : latest,
      null,
    )
  return last?.quantityUnit ?? null
}

// Sugestões do campo Unidade: as já usadas, sem repetir, em ordem do
// português. "exercício" e "exercícios" aparecem as duas (sem plural
// automático)
export function usedUnits(executions: TaskExecution[]): string[] {
  const units = new Set<string>()
  for (const execution of executions) {
    if (execution.quantityUnit) units.add(execution.quantityUnit)
  }
  return [...units].sort(compareNames)
}
