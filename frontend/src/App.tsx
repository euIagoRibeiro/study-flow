import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router'
import * as executionsApi from './api/executions'
import * as tasksApi from './api/tasks'
import * as timeEntriesApi from './api/timeEntries'
import ExecutePage from './pages/ExecutePage'
import HistoricoPage from './pages/HistoricoPage'
import Layout from './pages/Layout'
import TaskListPage from './pages/TaskListPage'
import type {
  LoadStatus,
  NewTask,
  Task,
  TaskExecution,
  TimeEntry,
} from './types'

function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  // Mudar esse número faz o useEffect rodar de novo (botão "Tentar de novo")
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [executions, setExecutions] = useState<TaskExecution[]>(() =>
    executionsApi.listExecutions(),
  )
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>(() =>
    timeEntriesApi.listTimeEntries(),
  )

  useEffect(() => {
    let ignore = false
    tasksApi
      .listTasks()
      .then((list) => {
        if (ignore) return
        setTasks(list)
        setStatus('ready')
      })
      .catch((error) => {
        if (ignore) return
        console.error(error)
        setStatus('error')
      })
    return () => {
      ignore = true
    }
  }, [loadAttempt])

  function retryLoad() {
    setStatus('loading')
    setLoadAttempt((attempt) => attempt + 1)
  }

  // Devolve o id: a ExecutePage usa isso pra ir direto ao passo de registrar.
  // Se o servidor recusar, o erro sobe pro TaskForm, que mostra a mensagem.
  async function addTask(newTask: NewTask): Promise<string> {
    const task = await tasksApi.createTask(newTask)
    setTasks((current) => [...current, task])
    return task.id
  }

  function replaceTask(updated: Task) {
    setTasks((current) =>
      current.map((task) => (task.id === updated.id ? updated : task)),
    )
  }

  function addExecution(taskId: string, description: string) {
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return // tarefa não existe — não deveria acontecer

    const execution = executionsApi.createExecution(task, description)
    setExecutions([...executions, execution])
  }

  function editExecution(
    id: string,
    changes: { description: string; completedAt: string },
  ) {
    setExecutions(
      executions.map((execution) =>
        execution.id === id
          ? executionsApi.editExecution(execution, changes)
          : execution,
      ),
    )
  }

  // Devolve o id da execução criada, ou null se recusar (nenhum caso deveria
  // acontecer se a UI usar "Retomar" no lugar certo, mas a função não confia
  // só nisso — protege as duas invariantes sozinha)
  function startTimer(taskId: string): string | null {
    const anyRunning = timeEntries.some((entry) => entry.endedAt === null)
    if (anyRunning) return null // só um cronômetro por vez (pendência do CLAUDE.md)

    const alreadyOpenForTask = executions.some(
      (execution) =>
        execution.taskId === taskId && execution.completedAt === null,
    )
    if (alreadyOpenForTask) return null // já tem execução aberta — usar resumeTimer

    const task = tasks.find((t) => t.id === taskId)
    if (!task) return null

    const execution = executionsApi.startExecution(task)
    const entry = timeEntriesApi.startTimeEntry(execution.id)
    setExecutions([...executions, execution])
    setTimeEntries([...timeEntries, entry])
    return execution.id
  }

  function stopTimer(timeEntryId: string) {
    setTimeEntries(
      timeEntries.map((entry) =>
        entry.id === timeEntryId ? timeEntriesApi.stopTimeEntry(entry) : entry,
      ),
    )
  }

  // Cria um novo time_entry pra mesma execução — nunca reabre um já
  // finalizado (voltar endedAt pra null seria dado estranho)
  function resumeTimer(taskExecutionId: string): string | null {
    const anyRunning = timeEntries.some((entry) => entry.endedAt === null)
    if (anyRunning) return null // mesma invariante global do startTimer

    const entry = timeEntriesApi.startTimeEntry(taskExecutionId)
    setTimeEntries([...timeEntries, entry])
    return entry.id
  }

  function finishExecution(executionId: string, description: string) {
    setTimeEntries(
      timeEntries.map((entry) =>
        entry.taskExecutionId === executionId && entry.endedAt === null
          ? timeEntriesApi.stopTimeEntry(entry)
          : entry,
      ),
    )
    setExecutions(
      executions.map((execution) =>
        execution.id === executionId
          ? executionsApi.finishExecution(execution, description)
          : execution,
      ),
    )
  }

  function undoFinishExecution(
    executionId: string,
    previousDescription: string | null,
    resumeEntryId: string | null,
  ) {
    setExecutions(
      executions.map((execution) =>
        execution.id === executionId
          ? executionsApi.reopenExecution(execution, previousDescription)
          : execution,
      ),
    )
    if (resumeEntryId) {
      setTimeEntries(
        timeEntries.map((entry) =>
          entry.id === resumeEntryId
            ? timeEntriesApi.resumeTimeEntry(entry)
            : entry,
        ),
      )
    }
  }

  function editTimeEntry(
    id: string,
    changes: { startedAt: string; endedAt: string },
  ) {
    setTimeEntries(
      timeEntries.map((entry) =>
        entry.id === id ? timeEntriesApi.editTimeEntry(entry, changes) : entry,
      ),
    )
  }

  // Mesmo caminho do addTask: o erro sobe pro TaskForm de edição
  async function editTask(id: string, changes: NewTask) {
    replaceTask(await tasksApi.editTask(id, changes))
  }

  // Arquivar/Reativar são botões, sem formulário pra mostrar erro — o aviso
  // fica no Layout
  async function archiveTask(id: string) {
    try {
      replaceTask(await tasksApi.archiveTask(id))
    } catch (error) {
      console.error(error)
      setSaveError('Não foi possível arquivar a tarefa. Tente de novo.')
    }
  }

  async function reactivateTask(id: string) {
    try {
      replaceTask(await tasksApi.reactivateTask(id))
    } catch (error) {
      console.error(error)
      setSaveError('Não foi possível reativar a tarefa. Tente de novo.')
    }
  }

  return (
    <Routes>
      <Route
        element={
          <Layout
            status={status}
            onRetry={retryLoad}
            saveError={saveError}
            onDismissSaveError={() => setSaveError(null)}
          />
        }
      >
        <Route
          index
          element={
            <TaskListPage
              tasks={tasks}
              executions={executions}
              timeEntries={timeEntries}
              onCreate={addTask}
              onEdit={editTask}
              onArchive={archiveTask}
              onReactivate={reactivateTask}
              onEditExecution={editExecution}
              onEditTimeEntry={editTimeEntry}
            />
          }
        />
        <Route
          path="/executar"
          element={
            <ExecutePage
              tasks={tasks}
              executions={executions}
              timeEntries={timeEntries}
              onCreate={addTask}
              onExecute={addExecution}
              onStartTimer={startTimer}
              onStopTimer={stopTimer}
              onResumeTimer={resumeTimer}
              onFinishExecution={finishExecution}
              onUndoFinishExecution={undoFinishExecution}
            />
          }
        />
        <Route
          path="/historico"
          element={
            <HistoricoPage
              executions={executions}
              timeEntries={timeEntries}
              onEditExecution={editExecution}
              onEditTimeEntry={editTimeEntry}
            />
          }
        />
      </Route>
    </Routes>
  )
}

export default App
