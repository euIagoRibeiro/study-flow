import { useState } from 'react'
import type { NewTask, Task as TaskModel, TaskExecution } from '../types'
import Task, { type OpenForm } from './Task'

function Tasks(props: {
  tasks: TaskModel[]
  executions: TaskExecution[]
  onEdit: (taskId: string, changes: NewTask) => void
  onArchive: (taskId: string) => void
}) {
  // Qual tarefa (e qual formulário dela) está aberta — um valor só pra lista
  // inteira, não um por linha, senão cada Task decide sozinha e duas linhas
  // podem ficar abertas ao mesmo tempo
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
        />
      ))}
    </ul>
  )
}

export default Tasks
