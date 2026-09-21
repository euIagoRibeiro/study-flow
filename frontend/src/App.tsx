import { useState } from 'react'
import TaskForm from './components/TaskForm'
import Tasks from './components/Tasks'
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
    <div>
      <TaskForm onAdd={addTask} />
      <Tasks tasks={tasks} />
    </div>
  )
}

export default App
