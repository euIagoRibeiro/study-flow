export type Frequency = 'none' | 'daily' | 'weekly' | 'monthly'

export type Task = {
  id: string
  title: string
  frequency: Frequency
  active: boolean
}

// O que o usuário preenche ao criar; o resto (id, active) é definido pelo App
export type NewTask = Pick<Task, 'title' | 'frequency'>

export type TaskExecution = {
  id: string
  taskId: string
  description: string | null
  completedAt: string | null
}
