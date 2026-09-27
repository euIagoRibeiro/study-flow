import { useState } from 'react'
import ExecutionHistory from '../components/ExecutionHistory'
import FilterChips, { type ChipOption } from '../components/FilterChips'
import { ChevronDownIcon } from '../components/icons'
import { matchesPeriod, type PeriodFilter } from '../dates'
import { frequencyLabels } from '../frequency'
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

  const filtering = frequency !== 'all'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5 border-b border-linha pb-3.5">
        <FilterChips
          label="Período"
          options={periodOptions}
          value={period}
          onChange={setPeriod}
        />
        <div className="flex h-9 items-center gap-2 font-dados text-meta text-tinta-suave">
          <span>Frequência</span>
          {/* O que se vê é o texto; o <select> fica invisível por cima, pra
              largura seguir o valor escolhido (o nativo mede pela opção
              mais longa) sem perder o seletor nativo do celular */}
          <span
            className={`relative inline-flex h-7 items-center gap-1 border-b-2 px-0.5 font-interface text-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-tinta ${
              filtering
                ? 'border-tinta font-semibold text-tinta'
                : 'border-transparent font-medium hover:text-tinta'
            }`}
          >
            {frequency === 'all' ? 'Todas' : frequencyLabels[frequency]}
            <ChevronDownIcon className="h-3.5 w-3.5" />
            <select
              aria-label="Frequência"
              value={frequency}
              onChange={(event) =>
                setFrequency(event.target.value as Frequency | 'all')
              }
              // 16px: abaixo disso o Safari do iPhone dá zoom ao tocar.
              // Toque de 44px sobre um texto de 28px (absolute conta a
              // partir de dentro da borda: 26 + 8 + 10). Cores explícitas
              // mesmo invisível: a lista de opções que abre usa as do
              // <select>, e o reset do Tailwind deixa o fundo transparente
              className="absolute inset-x-0 -top-2 -bottom-2.5 cursor-pointer bg-superficie text-base font-normal text-tinta opacity-0"
            >
              <option value="all">Todas</option>
              {Object.entries(frequencyLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </span>
        </div>
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
