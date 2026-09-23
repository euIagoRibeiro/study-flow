import { useState } from 'react'
import { frequencyLabels } from '../frequency'
import { inlineButtonClass } from '../styles'
import type { CompletedExecution } from '../types'
import ExecutionEditForm from './ExecutionEditForm'

function ExecutionHistory(props: {
  executions: CompletedExecution[]
  onEdit: (
    executionId: string,
    changes: { description: string; completedAt: string },
  ) => void
}) {
  // Qual execução da lista está em edição — separado do openForm do Task,
  // que só decide o que abre na linha (aqui é um nível dentro do histórico)
  const [editingId, setEditingId] = useState<string | null>(null)

  // completedAt pode mudar (etapa 3) sem mudar a posição no array, então
  // reordena de verdade em vez de confiar na ordem de criação
  const sorted = [...props.executions].sort((a, b) =>
    a.completedAt < b.completedAt ? 1 : -1,
  )

  return (
    <ul className="mt-3 flex flex-col gap-3 border-t border-linha pt-3">
      {sorted.map((execution) => (
        <li key={execution.id}>
          <p className="text-sm text-tinta-suave">
            {new Date(execution.completedAt).toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {' · '}
            {execution.taskTitleAtTime}
            {execution.taskFrequencyAtTime !== 'none' &&
              ` · ${frequencyLabels[execution.taskFrequencyAtTime]}`}
          </p>
          <p className="text-sm text-tinta-suave break-words">
            {execution.description ?? 'Sem descrição'}
            {' · '}
            <button
              type="button"
              onClick={() =>
                setEditingId(editingId === execution.id ? null : execution.id)
              }
              aria-expanded={editingId === execution.id}
              aria-label={`${editingId === execution.id ? 'Cancelar edição do' : 'Editar'} registro de ${new Date(execution.completedAt).toLocaleDateString('pt-BR')}`}
              className={inlineButtonClass}
            >
              {editingId === execution.id ? 'cancelar' : 'editar'}
            </button>
          </p>
          {editingId === execution.id && (
            <ExecutionEditForm
              execution={execution}
              onSubmit={(changes) => {
                props.onEdit(execution.id, changes)
                setEditingId(null)
              }}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

export default ExecutionHistory
