import { useState } from 'react'
import TaskForm from '../components/TaskForm'
import Tasks from '../components/Tasks'
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
  ) => void
}) {
  const [showArchived, setShowArchived] = useState(false)

  const visibleTasks = props.tasks
    .filter((task) => showArchived || task.active)
    // ativas primeiro, sem mudar a ordem de criação dentro de cada grupo
    .sort((a, b) => Number(b.active) - Number(a.active))

  return (
    <>
      <TaskForm onSubmit={props.onCreate} />
      <label className="mt-4 flex items-center gap-2 text-sm text-tinta-suave">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
        />
        Mostrar arquivadas
      </label>
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
    </>
  )
}

export default TaskListPage
