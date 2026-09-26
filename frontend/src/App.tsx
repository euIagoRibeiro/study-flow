import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router'
import { ApiError } from './api/client'
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

// 409: o banco recusou por conflito com um estado que essa página não
// conhece (ex.: algo iniciado em outro aparelho depois que ela carregou)
function isConflict(error: unknown) {
  return error instanceof ApiError && error.status === 409
}

function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  // Mudar esse número faz o useEffect rodar de novo (botão "Tentar de novo")
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [executions, setExecutions] = useState<TaskExecution[]>([])
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([])

  useEffect(() => {
    let ignore = false
    // As três saem juntas; se qualquer uma falhar, o carregamento todo falha
    Promise.all([
      tasksApi.listTasks(),
      executionsApi.listExecutions(),
      timeEntriesApi.listTimeEntries(),
    ])
      .then(([taskList, executionList, timeEntryList]) => {
        if (ignore) return
        setTasks(taskList)
        setExecutions(executionList)
        setTimeEntries(timeEntryList)
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

  function replaceTimeEntry(updated: TimeEntry) {
    setTimeEntries((current) =>
      current.map((entry) => (entry.id === updated.id ? updated : entry)),
    )
  }

  function replaceExecution(updated: TaskExecution) {
    setExecutions((current) =>
      current.map((execution) =>
        execution.id === updated.id ? updated : execution,
      ),
    )
  }

  // Erro sobe pro ExecutionForm, que mostra a mensagem
  async function addExecution(taskId: string, description: string) {
    const execution = await executionsApi.createExecution(taskId, description)
    setExecutions((current) => [...current, execution])
  }

  // Erro sobe pro ExecutionEditForm, que mostra a mensagem
  async function editExecution(
    id: string,
    changes: { description: string; completedAt: string },
  ) {
    replaceExecution(await executionsApi.editExecution(id, changes))
  }

  // Devolve o id da execução criada, ou null se recusar (nenhum caso deveria
  // acontecer se a UI usar "Retomar" no lugar certo, mas a função não confia
  // só nisso — protege as duas invariantes sozinha)
  async function startTimer(taskId: string): Promise<string | null> {
    const anyRunning = timeEntries.some((entry) => entry.endedAt === null)
    // Resposta instantânea; quem garante de verdade é o índice do banco (409)
    if (anyRunning) return null // só um cronômetro por vez

    const alreadyOpenForTask = executions.some(
      (execution) =>
        execution.taskId === taskId && execution.completedAt === null,
    )
    if (alreadyOpenForTask) return null // já tem execução aberta — usar resumeTimer

    let execution: TaskExecution
    try {
      execution = await executionsApi.startExecution(taskId)
    } catch (error) {
      console.error(error)
      setSaveError(
        isConflict(error)
          ? 'Essa tarefa já está em andamento em outro lugar. Recarregue a página.'
          : 'Não foi possível iniciar o cronômetro. Tente de novo.',
      )
      return null
    }
    // A execução já existe no servidor: entra no estado mesmo se a sessão
    // falhar abaixo (fica aberta como "Pausado", com "Retomar" disponível)
    setExecutions((current) => [...current, execution])
    try {
      const entry = await timeEntriesApi.startTimeEntry(execution.id)
      setTimeEntries((current) => [...current, entry])
    } catch (error) {
      console.error(error)
      setSaveError(
        isConflict(error)
          ? 'Já existe um cronômetro rodando (talvez em outro aparelho). A execução ficou aberta como pausada. Recarregue a página.'
          : 'O cronômetro não iniciou. A execução ficou aberta como pausada: use "Retomar".',
      )
    }
    return execution.id
  }

  async function stopTimer(timeEntryId: string) {
    const entry = timeEntries.find((e) => e.id === timeEntryId)
    if (!entry) return
    try {
      replaceTimeEntry(await timeEntriesApi.stopTimeEntry(entry))
    } catch (error) {
      console.error(error)
      setSaveError('Não foi possível pausar. O cronômetro continua rodando.')
    }
  }

  // Cria um novo time_entry pra mesma execução — nunca reabre um já
  // finalizado (voltar endedAt pra null seria dado estranho)
  async function resumeTimer(taskExecutionId: string): Promise<string | null> {
    const anyRunning = timeEntries.some((entry) => entry.endedAt === null)
    if (anyRunning) return null // mesma invariante global do startTimer

    try {
      const entry = await timeEntriesApi.startTimeEntry(taskExecutionId)
      setTimeEntries((current) => [...current, entry])
      return entry.id
    } catch (error) {
      console.error(error)
      setSaveError(
        isConflict(error)
          ? 'Já existe um cronômetro rodando (talvez em outro aparelho). Recarregue a página.'
          : 'Não foi possível retomar. Tente de novo.',
      )
      return null
    }
  }

  // Servidor primeiro: se falhar, o erro sobe pro TimerPanel e o cronômetro
  // continua rodando. O servidor fecha a sessão rodando com o mesmo
  // completedAt, na mesma transação — aqui só espelha, sem new Date()
  async function finishExecution(executionId: string, description: string) {
    const execution = await executionsApi.finishExecution(
      executionId,
      description,
    )
    setTimeEntries((current) =>
      current.map((entry) =>
        entry.taskExecutionId === executionId && entry.endedAt === null
          ? { ...entry, endedAt: execution.completedAt }
          : entry,
      ),
    )
    replaceExecution(execution)
  }

  // "Desfazer" é um botão solto, sem formulário: o erro vai pro Layout
  async function undoFinishExecution(
    executionId: string,
    previousDescription: string | null,
    resumeEntryId: string | null,
  ) {
    try {
      replaceExecution(
        await executionsApi.reopenExecution(executionId, previousDescription),
      )
    } catch (error) {
      console.error(error)
      setSaveError('Não foi possível desfazer. A execução continua finalizada.')
      return
    }
    // Depois da execução, nunca antes: o servidor só reabre sessão de
    // execução aberta
    const entry = timeEntries.find((e) => e.id === resumeEntryId)
    if (!entry) return
    try {
      replaceTimeEntry(await timeEntriesApi.reopenTimeEntry(entry))
    } catch (error) {
      console.error(error)
      setSaveError(
        'A execução foi reaberta, mas o cronômetro ficou pausado: use "Retomar".',
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
