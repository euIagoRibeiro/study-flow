import { useRef, useState } from 'react'
import { ApiError } from './api/client'
import type { TagChoice, WorkoutExercise } from './types'

// Pra onde o treino vai: o caminho da tela agora. marked = o caminho usa treino
export type WorkoutTarget = {
  pathKey: string
  tags: TagChoice
  marked: boolean
}

// tags null = o caminho já está gravado (só o treino)
export type WorkoutSaver = (
  workout: WorkoutExercise[],
  tags: TagChoice | null,
) => Promise<unknown>

type Job = {
  key: string
  pathKey: string
  tags: TagChoice
  workout: WorkoutExercise[]
}

// Exercício sem série não vai pro servidor (seria 400): fica só na tela
function toSend(draft: WorkoutExercise[]) {
  return draft.filter((item) => item.sets.length > 0)
}

// Treino ao vivo: a tela é o rascunho, o servidor recebe sempre o estado
// inteiro. Uma gravação por vez: o que muda enquanto uma está a caminho fica
// pendente, e as pendentes saem num envio só, com o estado mais novo. Sem
// isso, uma resposta atrasada gravaria um estado velho por cima do novo
export function useWorkoutSync(
  initial: WorkoutExercise[],
  savedPathKey: string,
  save: WorkoutSaver,
) {
  const [draft, setDraft] = useState(initial)
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [error, setError] = useState('')
  const [savedExercises, setSavedExercises] = useState(toSend(initial).length)
  // O que o servidor tem (ou vai ter, quando a fila esvaziar)
  const latest = useRef({
    key: savedPathKey + JSON.stringify(toSend(initial)),
    empty: toSend(initial).length === 0,
  })
  const savedPath = useRef(savedPathKey)
  const pending = useRef<Job | null>(null)
  const running = useRef(false)

  async function run() {
    if (running.current) return
    running.current = true
    setStatus('saving')
    while (pending.current) {
      const job = pending.current
      pending.current = null
      try {
        await save(
          job.workout,
          job.pathKey === savedPath.current ? null : job.tags,
        )
        savedPath.current = job.pathKey
        setSavedExercises(job.workout.length)
      } catch (err) {
        // Uma mais nova pode ter chegado durante a falha: ela ganha
        pending.current ??= job
        running.current = false
        setStatus('error')
        setError(
          err instanceof ApiError && err.status === 400
            ? err.message
            : 'Não foi possível salvar o treino.',
        )
        return
      }
    }
    running.current = false
    setStatus('saved')
    setError('')
  }

  function schedule(next: WorkoutExercise[], target: WorkoutTarget) {
    // Caminho sem treino: nada vai (a tela avisa; o Finalizar decide)
    if (!target.marked) return
    const workout = toSend(next)
    const key = target.pathKey + JSON.stringify(workout)
    if (key === latest.current.key) return
    // Nada gravado e nada a gravar: só o caminho mudou, e caminho sem treino
    // não precisa ir (vai junto com o 1º exercício)
    if (workout.length === 0 && latest.current.empty) return
    latest.current = { key, empty: workout.length === 0 }
    pending.current = {
      key,
      pathKey: target.pathKey,
      tags: target.tags,
      workout,
    }
    void run()
  }

  return {
    draft,
    status,
    error,
    savedExercises,
    update(next: WorkoutExercise[], target: WorkoutTarget) {
      setDraft(next)
      schedule(next, target)
    },
    // Caminho trocado: entre caminhos com treino, o treino vai junto (o
    // servidor recalcula a marcadora)
    retarget(target: WorkoutTarget) {
      schedule(draft, target)
    },
    retry() {
      void run()
    },
  }
}
