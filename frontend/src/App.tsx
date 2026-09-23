import { useState } from 'react'
import { Route, Routes } from 'react-router'
import ExecutePage from './pages/ExecutePage'
import Layout from './pages/Layout'
import TaskListPage from './pages/TaskListPage'
import type { NewTask, Task, TaskExecution } from './types'

function App() {
  const [tasks, setTasks] = useState<Task[]>([
    { id: '1', title: 'estudar react', frequency: 'daily', active: true },
    { id: '2', title: 'estudar js', frequency: 'weekly', active: true },
    { id: '3', title: 'estudar sql', frequency: 'none', active: true },
  ])

  const [executions, setExecutions] = useState<TaskExecution[]>([])

  // Devolve o id: a ExecutePage usa isso pra ir direto ao passo de registrar
  function addTask(newTask: NewTask): string {
    const task: Task = {
      id: crypto.randomUUID(),
      ...newTask,
      active: true,
    }
    setTasks([...tasks, task])
    return task.id
  }

  function addExecution(taskId: string, description: string) {
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return // tarefa não existe — não deveria acontecer

    const trimmedDescription = description.trim()
    const execution: TaskExecution = {
      id: crypto.randomUUID(),
      taskId,
      description: trimmedDescription === '' ? null : trimmedDescription,
      completedAt: new Date().toISOString(),
      // Snapshot: copiado agora, não referenciado — edições futuras da tarefa não afetam
      taskTitleAtTime: task.title,
      taskFrequencyAtTime: task.frequency,
    }
    setExecutions([...executions, execution])
  }

  function editExecution(
    id: string,
    changes: { description: string; completedAt: string },
  ) {
    setExecutions(
      executions.map((execution) =>
        execution.id === id
          ? {
              ...execution,
              description:
                changes.description === '' ? null : changes.description,
              completedAt: changes.completedAt,
            }
          : execution,
      ),
    )
  }

  function editTask(id: string, changes: NewTask) {
    setTasks(
      tasks.map((task) => (task.id === id ? { ...task, ...changes } : task)),
    )
  }

  function archiveTask(id: string) {
    setTasks(
      tasks.map((task) => (task.id === id ? { ...task, active: false } : task)),
    )
  }

  function reactivateTask(id: string) {
    setTasks(
      tasks.map((task) => (task.id === id ? { ...task, active: true } : task)),
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
      </Route>
    </Routes>
  )
}

export default App
