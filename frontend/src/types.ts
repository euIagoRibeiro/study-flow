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
  // Raiz das tags da execução (null = sem tag) e o conjunto gravado: o
  // fechamento do que foi escolhido (nível 3 vem com o nível 2 pai). A tela
  // mostra só as folhas
  rootTagId: string | null
  tagIds: string[]
  // Só sob contexto com fases (tracksPhase); null = sem fase
  phase: Phase | null
}

// Fase de trabalho: ordem do enum do banco
export type Phase = 'requisitos' | 'prototipo' | 'validacao' | 'implementacao'

// Execução que já foi concluída: completedAt deixa de aceitar null
export type CompletedExecution = TaskExecution & { completedAt: string }

export type TimeEntry = {
  id: string
  taskExecutionId: string
  startedAt: string
  endedAt: string | null // null enquanto está rodando
  // Duração estimada (sem cronômetro): termina no "Quando" do registro e
  // só se edita por ele. Nunca está rodando
  estimated: boolean
}

// Resposta de gravar uma execução: ela e as sessões dela já como ficaram
// (a estimativa pode ter mudado ou se movido junto com o "Quando")
export type SavedExecution = TaskExecution & { timeEntries: TimeEntry[] }

// Até 3 níveis: raiz (contexto) › filho › neto. Nível e raiz quem calcula
// é o servidor, a partir do pai
export type Tag = {
  id: string
  name: string
  parentId: string | null
  level: 1 | 2 | 3
  active: boolean
  tracksPhase: boolean // só contexto (nível 1) pode ser true
}

// O que a tela manda pro servidor: a raiz e, no máximo, a tag mais
// específica escolhida (um caminho só por registro). O servidor completa
// o caminho (fechamento). A fase vai sempre junto com as tags (null se o
// campo estiver escondido): com a mesma raiz, o servidor manteria a antiga
export type TagChoice = {
  rootTagId: string | null
  tagIds: string[]
  phase: Phase | null
}

// Editar um registro: tags ausentes = o servidor não mexe nelas (registro
// antigo com mais de uma folha, salvo sem tocar nas tags)
export type ExecutionChanges = {
  description: string
  completedAt: string
  // Ausente: mantém (e acompanha o "Quando"). null remove
  estimatedMinutes?: number | null
} & Partial<TagChoice>

export type LoadStatus = 'loading' | 'error' | 'ready'
