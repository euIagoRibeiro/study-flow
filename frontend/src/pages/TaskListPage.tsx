import { useState } from 'react'
import TaskForm from '../components/TaskForm'
import Tasks from '../components/Tasks'
import type { NewTask, Task, TaskExecution } from '../types'

function TaskListPage(props: {
  tasks: Task[]
  executions: TaskExecution[]
  onCreate: (task: NewTask) => string
  onEdit: (taskId: string, changes: NewTask) => void
  onArchive: (taskId: string) => void
  onEditExecution: (
    executionId: string,
    changes: { description: string; completedAt: string },
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
        onEdit={props.onEdit}
        onArchive={props.onArchive}
        onEditExecution={props.onEditExecution}
      />
    </>
  )
}

export default TaskListPage
