import { useState } from 'react'
import TaskForm from './components/TaskForm'
import Tasks from './components/Tasks'
import ThemeToggle from './components/ThemeToggle'
import type { NewTask, Task, TaskExecution } from './types'

function App() {
  const [tasks, setTasks] = useState<Task[]>([
    { id: '1', title: 'estudar react', frequency: 'daily', active: true },
    { id: '2', title: 'estudar js', frequency: 'weekly', active: true },
    { id: '3', title: 'estudar sql', frequency: 'none', active: true },
  ])

  const [executions, setExecutions] = useState<TaskExecution[]>([])

  function addTask(newTask: NewTask) {
    const task: Task = {
      id: crypto.randomUUID(),
      ...newTask,
      active: true,
    }
    setTasks([...tasks, task])
  }

  function addExecution(taskId: string, description: string) {
    const trimmedDescription = description.trim()
    const execution: TaskExecution = {
      id: crypto.randomUUID(),
      taskId,
      description: trimmedDescription === '' ? null : trimmedDescription,
      completedAt: new Date().toISOString(),
    }
    setExecutions([...executions, execution])
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

  return (
    <main className="mx-auto max-w-xl px-4 py-6">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">StudyFlow</h1>
        <ThemeToggle />
      </header>
      <TaskForm onSubmit={addTask} />
      <Tasks
        tasks={tasks.filter((task) => task.active)}
        executions={executions}
        onExecute={addExecution}
        onEdit={editTask}
        onArchive={archiveTask}
      />
    </main>
  )
}

export default App
