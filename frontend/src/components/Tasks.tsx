import { useState } from 'react'
import type { NewTask, Task as TaskModel, TaskExecution } from '../types'
import Task, { type OpenForm } from './Task'

function Tasks(props: {
  tasks: TaskModel[]
  executions: TaskExecution[]
  onEdit: (taskId: string, changes: NewTask) => void
  onArchive: (taskId: string) => void
  onReactivate: (taskId: string) => void
  onEditExecution: (
    executionId: string,
    changes: { description: string; completedAt: string },
  ) => void
}) {
  // Um valor só pra lista inteira, não por linha (senão duas linhas abrem juntas)
  const [openTask, setOpenTask] = useState<{
    taskId: string
    form: NonNullable<OpenForm>
  } | null>(null)

  function toggle(taskId: string, form: NonNullable<OpenForm>) {
    setOpenTask(
      openTask?.taskId === taskId && openTask.form === form
        ? null
        : { taskId, form },
    )
  }

  return (
    <ul className="mt-8 border-t border-linha">
      {props.tasks.map((task) => (
        <Task
          key={task.id}
          task={task}
          executions={props.executions.filter(
            (execution) => execution.taskId === task.id,
          )}
          openForm={openTask?.taskId === task.id ? openTask.form : null}
          onToggle={(form) => toggle(task.id, form)}
          onEdit={props.onEdit}
          onArchive={props.onArchive}
          onReactivate={props.onReactivate}
          onEditExecution={props.onEditExecution}
        />
      ))}
    </ul>
  )
}

export default Tasks
