import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router'
import * as executionsApi from './api/executions'
import * as tasksApi from './api/tasks'
import * as timeEntriesApi from './api/timeEntries'
import ExecutePage from './pages/ExecutePage'
import HistoricoPage from './pages/HistoricoPage'
import Layout from './pages/Layout'
import TaskListPage from './pages/TaskListPage'
import type { NewTask, Task, TaskExecution, TimeEntry } from './types'

function App() {
  const [tasks, setTasks] = useState<Task[]>(() => tasksApi.listTasks())
  const [executions, setExecutions] = useState<TaskExecution[]>(() =>
    executionsApi.listExecutions(),
  )
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>(() =>
    timeEntriesApi.listTimeEntries(),
  )

  // Devolve o id: a ExecutePage usa isso pra ir direto ao passo de registrar
  function addTask(newTask: NewTask): string {
    const task = tasksApi.createTask(newTask)
    setTasks([...tasks, task])
    return task.id
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

  function editTask(id: string, changes: NewTask) {
    setTasks(
      tasks.map((task) =>
        task.id === id ? tasksApi.editTask(task, changes) : task,
      ),
    )
  }

  function archiveTask(id: string) {
    setTasks(
      tasks.map((task) => (task.id === id ? tasksApi.archiveTask(task) : task)),
    )
  }

  function reactivateTask(id: string) {
    setTasks(
      tasks.map((task) =>
        task.id === id ? tasksApi.reactivateTask(task) : task,
      ),
    )
  }

  // TEMP — Fase 2 etapa 2: sem UI ainda, isso só existe pra poder testar
  // pelo console. Sai quando a etapa 3 ligar essas funções na ExecutePage.
  // Fica num useEffect (não solto no corpo do componente) porque mutar
  // window durante o render é efeito colateral, não é permitido ali.
  useEffect(() => {
    ;(
      window as unknown as {
        __fase2: {
          tasks: Task[]
          executions: TaskExecution[]
          timeEntries: TimeEntry[]
          startTimer: typeof startTimer
          stopTimer: typeof stopTimer
          resumeTimer: typeof resumeTimer
          finishExecution: typeof finishExecution
        }
      }
    ).__fase2 = {
      tasks,
      executions,
      timeEntries,
      startTimer,
      stopTimer,
      resumeTimer,
      finishExecution,
    }
  })

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route
          index
          element={
            <TaskListPage
              tasks={tasks}
              executions={executions}
              onCreate={addTask}
              onEdit={editTask}
              onArchive={archiveTask}
              onReactivate={reactivateTask}
              onEditExecution={editExecution}
            />
          }
        />
        <Route
          path="/executar"
          element={
            <ExecutePage
              tasks={tasks}
              onCreate={addTask}
              onExecute={addExecution}
            />
          }
        />
        <Route
          path="/historico"
          element={
            <HistoricoPage
              executions={executions}
              onEditExecution={editExecution}
            />
          }
        />
      </Route>
    </Routes>
  )
}

export default App
