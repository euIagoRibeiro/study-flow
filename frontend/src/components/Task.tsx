import { frequencyLabels } from '../frequency'
import type { Task as TaskModel } from '../types'

function Task(props: { task: TaskModel }) {
  const { title, frequency } = props.task

  return (
    <li className="flex flex-col border-b border-linha py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <p className="font-semibold break-words">{title}</p>
      {frequency !== 'none' && (
        <p className="text-sm text-tinta-suave">{frequencyLabels[frequency]}</p>
      )}
    </li>
  )
}

export default Task
