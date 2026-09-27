import { useState } from 'react'
import ExecutionHistory from '../components/ExecutionHistory'
import FilterChips, { type ChipOption } from '../components/FilterChips'
import { matchesPeriod, type PeriodFilter } from '../dates'
import { frequencyLabels } from '../frequency'
import { focusRing } from '../styles'
import type {
  CompletedExecution,
  Frequency,
  TaskExecution,
  TimeEntry,
} from '../types'

// Tudo primeiro: é o padrão, e numa faixa que rola de lado não pode ficar escondido no fim
const periodOptions: ChipOption<PeriodFilter>[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: 'month', label: 'Este mês' },
  { value: 'year', label: 'Este ano' },
]

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
      <div className="flex flex-col gap-3">
        <FilterChips
          label="Período"
          options={periodOptions}
          value={period}
          onChange={setPeriod}
        />
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
