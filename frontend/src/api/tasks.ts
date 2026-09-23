import type { NewTask, Task } from '../types'

export function listTasks(): Task[] {
  return [
    { id: '1', title: 'estudar react', frequency: 'daily', active: true },
    { id: '2', title: 'estudar js', frequency: 'weekly', active: true },
    { id: '3', title: 'estudar sql', frequency: 'none', active: true },
  ]
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
