import { useState } from 'react'
import Tasks from './components/Tasks'
import type { Task } from './types'

function App() {
  const [tasks] = useState<Task[]>([
    {
      id: '1',
      title: 'estudar react',
      categoryId: null,
      defaultDescription: null,
      frequency: 'daily',
      active: true,
    },
    {
      id: '2',
      title: 'estudar js',
      categoryId: null,
      defaultDescription: null,
      frequency: 'weekly',
      active: true,
    },
    {
      id: '3',
      title: 'estudar sql',
      categoryId: null,
      defaultDescription: null,
      frequency: 'none',
      active: true,
    },
  ])

  return <Tasks tasks={tasks} />
}

export default App
