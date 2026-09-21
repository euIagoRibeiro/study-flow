import { useState } from 'react'
import TaskForm from './components/TaskForm'
import Tasks from './components/Tasks'
import ThemeToggle from './components/ThemeToggle'
import type { NewTask, Task } from './types'

function App() {
  const [tasks, setTasks] = useState<Task[]>([
    { id: '1', title: 'estudar react', frequency: 'daily', active: true },
    { id: '2', title: 'estudar js', frequency: 'weekly', active: true },
    { id: '3', title: 'estudar sql', frequency: 'none', active: true },
  ])

  function addTask(newTask: NewTask) {
    const task: Task = {
      id: crypto.randomUUID(),
      ...newTask,
      active: true,
    }
    setTasks([...tasks, task])
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-6">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">StudyFlow</h1>
        <ThemeToggle />
      </header>
      <TaskForm onAdd={addTask} />
      <Tasks tasks={tasks} />
    </main>
  )
}

export default App
