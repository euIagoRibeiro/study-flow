import type { NewTask, Task as TaskModel, TaskExecution } from '../types'
import Task from './Task'

function Tasks(props: {
  tasks: TaskModel[]
  executions: TaskExecution[]
  onEdit: (taskId: string, changes: NewTask) => void
  onArchive: (taskId: string) => void
}) {
  return (
    <ul className="mt-8 border-t border-linha">
      {props.tasks.map((task) => (
        <Task
          key={task.id}
          task={task}
          executions={props.executions.filter(
            (execution) => execution.taskId === task.id,
          )}
          onEdit={props.onEdit}
          onArchive={props.onArchive}
        />
      ))}
    </ul>
  )
}

export default Tasks
