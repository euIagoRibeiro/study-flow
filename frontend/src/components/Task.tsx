import type { Task as TaskModel } from '../types'

function Task(props: { task: TaskModel }) {
  return (
    <p>
      Tarefa: {props.task.title} | {props.task.frequency}
    </p>
  )
}

export default Task
