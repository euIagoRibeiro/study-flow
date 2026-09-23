import { useState } from 'react'
import ExecutionHistory from '../components/ExecutionHistory'
import { matchesPeriod, type PeriodFilter } from '../dates'
import { frequencyLabels } from '../frequency'
import { fieldClass } from '../styles'
import type { CompletedExecution, Frequency, TaskExecution } from '../types'

const periodLabels: Record<PeriodFilter, string> = {
  all: 'Tudo',
  today: 'Hoje',
  '7d': 'Últimos 7 dias',
  month: 'Este mês',
  year: 'Este ano',
}

function isCompleted(
  execution: TaskExecution,
): execution is CompletedExecution {
  return execution.completedAt !== null
}

function HistoricoPage(props: {
  executions: TaskExecution[]
  onEditExecution: (
    executionId: string,
    changes: { description: string; completedAt: string },
  ) => void
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-col gap-1 sm:flex-1">
          <span className="text-sm text-tinta-suave">Período</span>
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as PeriodFilter)}
            className={fieldClass}
          >
            {Object.entries(periodLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 sm:flex-1">
          <span className="text-sm text-tinta-suave">Frequência</span>
          <select
            value={frequency}
            onChange={(event) =>
              setFrequency(event.target.value as Frequency | 'all')
            }
            className={fieldClass}
          >
            <option value="all">Todas</option>
            {Object.entries(frequencyLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-tinta-suave">
          Nenhuma execução encontrada com esses filtros.
        </p>
      ) : (
        <ExecutionHistory
          executions={filtered}
          onEdit={props.onEditExecution}
        />
      )}
    </div>
  )
}

export default HistoricoPage
