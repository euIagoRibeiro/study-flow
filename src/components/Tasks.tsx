
import Task from './Task'

function Tasks() {

    const tasks = [
        { title: "estudar react", completed: true},
        { title: "estudar js", completed: true},
        { title: "estudar sql", completed: false },
    ]

    return (
        <div>
            {tasks.map((task, index) => (
                <Task key={index} title={task.title} completed={task.completed}/>
            ))}
        </div>
    )
    
}

export default Tasks;