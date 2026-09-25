import type { NewTask, Task } from '../types'
import { request } from './client'

export function listTasks(): Promise<Task[]> {
  return request<Task[]>('/tasks')
}

export function createTask(newTask: NewTask): Task {
  return { id: crypto.randomUUID(), ...newTask, active: true }
}

export function editTask(task: Task, changes: NewTask): Task {
  return { ...task, ...changes }
}

export function archiveTask(task: Task): Task {
  return { ...task, active: false }
}

export function reactivateTask(task: Task): Task {
  return { ...task, active: true }
}
