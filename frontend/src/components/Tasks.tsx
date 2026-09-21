import type { Task as TaskModel } from '../types'
import Task from './Task'

function Tasks(props: { tasks: TaskModel[] }) {
  return (
    <ul className="mt-8 border-t border-linha">
      {props.tasks.map((task) => (
        <Task key={task.id} task={task} />
      ))}
    </ul>
  )
}

export default Tasks
