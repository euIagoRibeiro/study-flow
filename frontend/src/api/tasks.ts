import type { NewTask, Task } from '../types'
import { request } from './client'

export function listTasks(): Promise<Task[]> {
  return request<Task[]>('/tasks')
}

export function createTask(newTask: NewTask): Promise<Task> {
  return request<Task>('/tasks', {
    method: 'POST',
    body: JSON.stringify(newTask),
  })
}

function updateTask(
  id: string,
  changes: Partial<NewTask> & { active?: boolean },
): Promise<Task> {
  return request<Task>(`/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
}

export function editTask(id: string, changes: NewTask): Promise<Task> {
  return updateTask(id, changes)
}

export function archiveTask(id: string): Promise<Task> {
  return updateTask(id, { active: false })
}

export function reactivateTask(id: string): Promise<Task> {
  return updateTask(id, { active: true })
}
