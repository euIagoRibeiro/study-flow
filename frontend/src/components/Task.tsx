function Task(props: { title: string; completed?: boolean }) {
  return (
    <p>
      Tarefa: {props.title} | {props.completed ? 'ok' : 'não'}
    </p>
  )
}

export default Task
