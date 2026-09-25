import type { Task, TaskExecution } from '../types'
import { request } from './client'

export function listExecutions(): Promise<TaskExecution[]> {
  return request<TaskExecution[]>('/executions')
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

export function startExecution(task: Task): TaskExecution {
  return {
    id: crypto.randomUUID(),
    taskId: task.id,
    description: null,
    completedAt: null, // ainda rodando
    taskTitleAtTime: task.title,
    taskFrequencyAtTime: task.frequency,
  }
}

export function finishExecution(
  execution: TaskExecution,
  description: string,
): TaskExecution {
  const trimmedDescription = description.trim()
  return {
    ...execution,
    description: trimmedDescription === '' ? null : trimmedDescription,
    completedAt: new Date().toISOString(),
  }
}

export function reopenExecution(
  execution: TaskExecution,
  previousDescription: string | null,
): TaskExecution {
  return { ...execution, completedAt: null, description: previousDescription }
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
