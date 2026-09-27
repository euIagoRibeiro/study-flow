import { useState } from 'react'
import ExecutionHistory from '../components/ExecutionHistory'
import { matchesPeriod, type PeriodFilter } from '../dates'
import { frequencyLabels } from '../frequency'
import type {
  CompletedExecution,
  Frequency,
  TaskExecution,
  TimeEntry,
} from '../types'

// Tudo primeiro: é o padrão, e numa faixa que rola de lado não pode ficar escondido no fim
const periodLabels: Record<PeriodFilter, string> = {
  all: 'Tudo',
  today: 'Hoje',
  '7d': '7 dias',
  month: 'Este mês',
  year: 'Este ano',
}

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta'

function periodChipClass(active: boolean) {
  const base = `h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium ${focusRing}`
  return active
    ? `${base} border-tinta bg-tinta text-papel`
    : `${base} border-tinta-suave/40 text-tinta-suave hover:text-tinta`
}

function isCompleted(
  execution: TaskExecution,
): execution is CompletedExecution {
  return execution.completedAt !== null
}

function HistoricoPage(props: {
  executions: TaskExecution[]
  timeEntries: TimeEntry[]
  onEditExecution: (
    executionId: string,
    changes: { description: string; completedAt: string },
  ) => Promise<void>
  onEditTimeEntry: (
    entryId: string,
    changes: { startedAt: string; endedAt: string },
  ) => Promise<void>
}) {
  const [period, setPeriod] = useState<PeriodFilter>('all')
  const [frequency, setFrequency] = useState<Frequency | 'all'>('all')

  const filtered = props.executions.filter(isCompleted).filter(
    (execution) =>
      matchesPeriod(execution.completedAt, period) &&
      // Filtra pelo snapshot (taskFrequencyAtTime), nunca pela frequência
      // atual da tarefa — mesmo princípio do resto do app
      (frequency === 'all' || execution.taskFrequencyAtTime === frequency),
  )

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* -mx-4/px-4: os chips rolam até a borda da tela, sem cortar no gutter */}
        <div
          role="group"
          aria-label="Período"
          className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-1 sm:px-0 sm:pb-0"
        >
          {Object.entries(periodLabels).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={period === value}
              onClick={() => setPeriod(value as PeriodFilter)}
              className={periodChipClass(period === value)}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          aria-label="Frequência"
          value={frequency}
          onChange={(event) =>
            setFrequency(event.target.value as Frequency | 'all')
          }
          className={`h-9 self-start rounded-full border border-tinta-suave/40 bg-papel px-3 text-sm text-tinta-suave ${focusRing}`}
        >
          <option value="all">Toda frequência</option>
          {Object.entries(frequencyLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-tinta-suave">
          Nenhuma execução encontrada com esses filtros.
        </p>
      ) : (
        <ExecutionHistory
          executions={filtered}
          timeEntries={props.timeEntries}
          onEdit={props.onEditExecution}
          onEditTimeEntry={props.onEditTimeEntry}
        />
      )}
    </div>
  )
}

export default HistoricoPage
