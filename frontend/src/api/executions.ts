import type { Task, TaskExecution } from '../types'

export function listExecutions(): TaskExecution[] {
  return []
}

export function createExecution(
  task: Task,
  description: string,
): TaskExecution {
  const trimmedDescription = description.trim()
  return {
    id: crypto.randomUUID(),
    taskId: task.id,
    description: trimmedDescription === '' ? null : trimmedDescription,
    completedAt: new Date().toISOString(),
    // Snapshot: copiado agora, não referenciado — edições futuras da tarefa não afetam
    taskTitleAtTime: task.title,
    taskFrequencyAtTime: task.frequency,
  }
}

export function editExecution(
  execution: TaskExecution,
  changes: { description: string; completedAt: string },
): TaskExecution {
  return {
    ...execution,
    description: changes.description === '' ? null : changes.description,
    completedAt: changes.completedAt,
  }
}
