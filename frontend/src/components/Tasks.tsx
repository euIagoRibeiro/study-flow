import type { Task as TaskModel, TaskExecution } from '../types'
import Task from './Task'

function Tasks(props: {
  tasks: TaskModel[]
  executions: TaskExecution[]
  onExecute: (taskId: string, description: string) => void
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
          onExecute={props.onExecute}
        />
      ))}
    </ul>
  )
}

export default Tasks
