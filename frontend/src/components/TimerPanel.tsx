import { useState, type FormEvent } from 'react'
import { formatClock, formatDuration } from '../dates'
import {
  cardClass,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../styles'
import type { TaskExecution, TimeEntry } from '../types'
import ElapsedTime from './ElapsedTime'
import FormError from './FormError'

function TimerPanel(props: {
  execution: TaskExecution
  entries: TimeEntry[] // todas as sessões dessa execução
  runningEntry: TimeEntry | undefined // undefined = pausado
  onStop: (entryId: string) => Promise<unknown>
  onResume: (executionId: string) => Promise<unknown>
  onFinish: (executionId: string, description: string) => Promise<unknown>
}) {
  // Desestruturado: runningEntry como const local permite o TypeScript
  // estreitar o tipo dentro dos closures dos botões, sem precisar de "!"
  const { execution, entries, runningEntry, onStop, onResume, onFinish } = props
  const [description, setDescription] = useState(execution.description ?? '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Pausar/Retomar esperando o servidor: sem isso, clique duplo mandaria
  // duas requisições. Os erros deles o App já trata (aviso no Layout)
  const [busy, setBusy] = useState(false)

  // Tempo das sessões já encerradas — derivado, igual à soma do Histórico
  const closedMs = entries
    .filter((entry) => entry.endedAt !== null)
    .reduce(
      (sum, entry) =>
        sum +
        (new Date(entry.endedAt ?? entry.startedAt).getTime() -
          new Date(entry.startedAt).getTime()),
      0,
    )
  const sessions = entries.length

  async function runTimerAction(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  // Se falhar, o cronômetro continua rodando: nada parou ainda
  async function handleFinish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    try {
      await onFinish(execution.id, description)
    } catch {
      setError('Não foi possível finalizar. Tente de novo.')
      return
    } finally {
      setSubmitting(false)
    }
    setError('')
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className={`${cardClass} flex flex-col items-center gap-3 py-7 text-center`}
      >
        {runningEntry ? (
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-andamento">
            <span className="h-2 w-2 animate-pulsa rounded-full bg-current" />
            Rodando
          </p>
        ) : (
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-tinta-suave">
            <span className="h-2 w-2 rounded-full border-[1.5px] border-current" />
            Pausado
          </p>
        )}
        {/* Rodando: a sessão atual, andando. Pausado: o total até agora, parado */}
        <p className="font-dados text-[3.5rem] leading-none font-bold tracking-tight tabular-nums">
          {runningEntry ? (
            <ElapsedTime startedAt={runningEntry.startedAt} />
          ) : (
            formatClock(closedMs)
          )}
        </p>
        <p className="font-dados text-meta text-tinta-suave">
          {runningEntry
            ? closedMs > 0
              ? `Sessão ${sessions} · antes: ${formatDuration(closedMs)}`
              : 'Primeira sessão'
            : `${sessions} ${sessions === 1 ? 'sessão' : 'sessões'} até agora`}
        </p>
        <button
          type="button"
          onClick={() =>
            runTimerAction(() =>
              runningEntry ? onStop(runningEntry.id) : onResume(execution.id),
            )
          }
          disabled={busy}
          className={`w-full ${secondaryButtonClass}`}
        >
          {runningEntry ? 'Pausar' : 'Retomar'}
        </button>
      </div>
      <form onSubmit={handleFinish} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-tinta-suave">
            O que foi feito (opcional)
          </span>
          <input
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={fieldClass}
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className={`w-full ${primaryButtonClass}`}
        >
          Finalizar
        </button>
        {error && <FormError>{error}</FormError>}
      </form>
    </div>
  )
}

export default TimerPanel
