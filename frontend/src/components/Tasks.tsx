import type { Task as TaskModel } from '../types'
import Task from './Task'

function Tasks(props: { tasks: TaskModel[] }) {
  return (
    <div>
      {props.tasks.map((task) => (
        <Task key={task.id} task={task} />
      ))}
    </div>
  )
}

export default Tasks
