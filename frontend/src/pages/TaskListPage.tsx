import TaskForm from '../components/TaskForm'
import Tasks from '../components/Tasks'
import type { NewTask, Task, TaskExecution } from '../types'

function TaskListPage(props: {
  tasks: Task[]
  executions: TaskExecution[]
  onCreate: (task: NewTask) => string
  onEdit: (taskId: string, changes: NewTask) => void
  onArchive: (taskId: string) => void
}) {
  return (
    <>
      <TaskForm onSubmit={props.onCreate} />
      <Tasks
        tasks={props.tasks.filter((task) => task.active)}
        executions={props.executions}
        onEdit={props.onEdit}
        onArchive={props.onArchive}
      />
    </>
  )
}

export default TaskListPage
