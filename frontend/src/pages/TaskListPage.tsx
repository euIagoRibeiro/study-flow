import { useState } from 'react'
import TaskForm from '../components/TaskForm'
import Tasks from '../components/Tasks'
import { PlusIcon } from '../components/icons'
import { cardClass, focusRing } from '../styles'
import type { NewTask, Task, TaskExecution, TimeEntry } from '../types'

function TaskListPage(props: {
  tasks: Task[]
  executions: TaskExecution[]
  timeEntries: TimeEntry[]
  onCreate: (task: NewTask) => Promise<string>
  onEdit: (taskId: string, changes: NewTask) => Promise<void>
  onArchive: (taskId: string) => void
  onReactivate: (taskId: string) => void
  onEditExecution: (
    executionId: string,
    changes: { description: string; completedAt: string },
  ) => Promise<void>
  onEditTimeEntry: (
    entryId: string,
    changes: { startedAt: string; endedAt: string },
  ) => Promise<void>
}) {
  const [showArchived, setShowArchived] = useState(false)
  // Criar é raro, ver a lista é o uso de todo dia: o formulário fica recolhido
  const [creating, setCreating] = useState(false)

  const visibleTasks = props.tasks
    .filter((task) => showArchived || task.active)
    // ativas primeiro, sem mudar a ordem de criação dentro de cada grupo
    .sort((a, b) => Number(b.active) - Number(a.active))

  return (
    <div className="flex flex-col gap-4">
      {creating ? (
        <div className={cardClass}>
          <TaskForm
            autoFocus
            onSubmit={async (newTask) => {
              await props.onCreate(newTask)
              setCreating(false)
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className={`flex h-13 w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-tinta-suave/55 font-semibold text-tinta-suave hover:bg-tinta/[0.07] hover:text-tinta ${focusRing}`}
        >
          <PlusIcon />
          Nova tarefa
        </button>
      )}
      <label className="flex items-center gap-2 px-0.5 text-sm text-tinta-suave">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
        />
        Mostrar arquivadas
      </label>
      {visibleTasks.length === 0 ? (
        <p className="py-8 text-center text-sm text-tinta-suave">
          Nenhuma tarefa ainda. Crie a primeira em "Nova tarefa".
        </p>
      ) : (
        <Tasks
          tasks={visibleTasks}
          executions={props.executions}
          timeEntries={props.timeEntries}
          onEdit={props.onEdit}
          onArchive={props.onArchive}
          onReactivate={props.onReactivate}
          onEditExecution={props.onEditExecution}
          onEditTimeEntry={props.onEditTimeEntry}
        />
      )}
    </div>
  )
}

export default TaskListPage
