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
  // Snapshot da tarefa no momento em que a execução foi criada — nunca
  // reescrito depois. O histórico mostra esses campos, nunca os da tarefa
  // atual: editar o molde não pode reescrever como o passado aparece.
  taskTitleAtTime: string
  taskFrequencyAtTime: Frequency
}

// Execução que já foi concluída: completedAt deixa de aceitar null
export type CompletedExecution = TaskExecution & { completedAt: string }
