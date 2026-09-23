import { useState } from 'react'
import { Route, Routes } from 'react-router'
import * as executionsApi from './api/executions'
import * as tasksApi from './api/tasks'
import ExecutePage from './pages/ExecutePage'
import HistoricoPage from './pages/HistoricoPage'
import Layout from './pages/Layout'
import TaskListPage from './pages/TaskListPage'
import type { NewTask, Task, TaskExecution } from './types'

function App() {
  const [tasks, setTasks] = useState<Task[]>(() => tasksApi.listTasks())
  const [executions, setExecutions] = useState<TaskExecution[]>(() =>
    executionsApi.listExecutions(),
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
