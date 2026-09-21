export type Frequency = 'none' | 'daily' | 'weekly' | 'monthly'

export type Task = {
  id: string
  title: string
  categoryId: string | null
  defaultDescription: string | null
  frequency: Frequency
  active: boolean
}

export type TaskExecution = {
  id: string
  taskId: string
  description: string | null
  completedAt: string | null
}
