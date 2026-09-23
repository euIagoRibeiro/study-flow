import { useState } from 'react'
import { useNavigate } from 'react-router'
import ExecutionForm from '../components/ExecutionForm'
import TaskForm from '../components/TaskForm'
import TimerPanel from '../components/TimerPanel'
import { frequencyLabels } from '../frequency'
import {
  pickerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../styles'
import type { NewTask, Task, TaskExecution, TimeEntry } from '../types'

function ExecutePage(props: {
  tasks: Task[]
  executions: TaskExecution[]
  timeEntries: TimeEntry[]
  onCreate: (task: NewTask) => string
  onExecute: (taskId: string, description: string) => void
  onStartTimer: (taskId: string) => string | null
  onStopTimer: (timeEntryId: string) => void
  onResumeTimer: (executionId: string) => string | null
  onFinishExecution: (executionId: string, description: string) => void
}) {
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

  function handleFinish(executionId: string, description: string) {
    props.onFinishExecution(executionId, description)
    navigate('/')
  }

  if (selectedTask === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="mb-2 text-base font-semibold">Escolha uma tarefa</h2>
          <ul className="flex flex-col gap-2">
            {activeTasks.map((task) => {
              const isOpen = props.executions.some(
                (execution) =>
                  execution.taskId === task.id &&
                  execution.completedAt === null,
              )
              return (
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
                    {isOpen && (
                      <span className="ml-2 text-sm text-tinta-suave">
                        (em andamento)
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 text-base font-semibold">ou crie uma nova</h2>
          <TaskForm onSubmit={handleCreate} />
        </div>
      </div>
    )
  }

  const openExecution = props.executions.find(
    (execution) =>
      execution.taskId === selectedTask.id && execution.completedAt === null,
  )
  const runningEntry = openExecution
    ? props.timeEntries.find(
        (entry) =>
          entry.taskExecutionId === openExecution.id && entry.endedAt === null,
      )
    : undefined
  // Rodando em OUTRA tarefa, não nessa — "Registrar" continua liberado (é
  // instantâneo, nunca fica aberto, então não conflita com essa invariante)
  const runningElsewhere =
    !runningEntry && props.timeEntries.some((entry) => entry.endedAt === null)

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

      {openExecution ? (
        <TimerPanel
          execution={openExecution}
          runningEntry={runningEntry}
          onStop={props.onStopTimer}
          onResume={props.onResumeTimer}
          onFinish={handleFinish}
        />
      ) : (
        <>
          {runningElsewhere ? (
            <p className="text-sm text-tinta-suave">
              Você já tem um cronômetro rodando em outra tarefa. Finalize ou
              pause antes.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => props.onStartTimer(selectedTask.id)}
              className={primaryButtonClass}
            >
              Iniciar cronômetro
            </button>
          )}
          <p className="text-sm text-tinta-suave">
            ou registre direto, sem cronômetro
          </p>
          <ExecutionForm onSubmit={handleExecute} />
        </>
      )}

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
