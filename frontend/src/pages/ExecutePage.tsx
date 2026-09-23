import { useState } from 'react'
import { useNavigate } from 'react-router'
import ExecutionForm from '../components/ExecutionForm'
import TaskForm from '../components/TaskForm'
import { frequencyLabels } from '../frequency'
import { pickerButtonClass, secondaryButtonClass } from '../styles'
import type { NewTask, Task } from '../types'

function ExecutePage(props: {
  tasks: Task[]
  onCreate: (task: NewTask) => string
  onExecute: (taskId: string, description: string) => void
}) {
  // null = ainda escolhendo a tarefa; com valor = pronta pra registrar
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const navigate = useNavigate()

  const activeTasks = props.tasks.filter((task) => task.active)
  const selectedTask = activeTasks.find((task) => task.id === selectedTaskId)

  function handleCreate(newTask: NewTask) {
    const id = props.onCreate(newTask)
    setSelectedTaskId(id)
  }

  function handleExecute(description: string) {
    if (selectedTask === undefined) return
    props.onExecute(selectedTask.id, description)
    navigate('/')
  }

  if (selectedTask === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="mb-2 text-base font-semibold">Escolha uma tarefa</h2>
          <ul className="flex flex-col gap-2">
            {activeTasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => setSelectedTaskId(task.id)}
                  className={pickerButtonClass}
                >
                  {task.title}
                  {task.frequency !== 'none' && (
                    <span className="ml-2 text-sm text-tinta-suave">
                      {frequencyLabels[task.frequency]}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 text-base font-semibold">ou crie uma nova</h2>
          <TaskForm onSubmit={handleCreate} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">
          Executar: {selectedTask.title}
        </h2>
        {selectedTask.frequency !== 'none' && (
          <p className="text-sm text-tinta-suave">
            {frequencyLabels[selectedTask.frequency]}
          </p>
        )}
      </div>
      <ExecutionForm onSubmit={handleExecute} />
      <button
        type="button"
        onClick={() => setSelectedTaskId(null)}
        className={`${secondaryButtonClass} self-start`}
      >
        Trocar tarefa
      </button>
    </div>
  )
}

export default ExecutePage
