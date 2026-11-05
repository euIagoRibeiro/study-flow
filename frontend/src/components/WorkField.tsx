import { fieldClass } from '../styles'
import type { Measure, Tag, Task, Work } from '../types'
import {
  defaultTaskLine,
  workGroups,
  workMarks,
  workOptionLabel,
} from '../works'

// Campo Obra dos formulários de registro: lista nativa, em andamento primeiro,
// as outras num grupo à parte. Embaixo, as mesmas marcas da tela de tags e a
// tarefa padrão, se não é a da página. Sem nenhuma obra cadastrada, não aparece
function WorkField(props: {
  works: Work[]
  value: string | null
  onChange: (workId: string | null) => void
  tags: Tag[]
  measures: Measure[]
  taskId: string // a tarefa da página
  tasks: Task[]
  // Lápis: o rótulo da obra gravada enquanto ela não está na lista carregada
  // (sem ele, o campo mostraria "Nenhuma obra" com outro valor)
  missing?: string
}) {
  const chosen = props.works.find((work) => work.id === props.value)
  const missing = props.missing !== undefined && props.value !== null && !chosen
  if (props.works.length === 0 && !missing) return null
  const { inProgress, others } = workGroups(props.works)
  const taskLine = chosen
    ? defaultTaskLine(chosen, props.taskId, props.tasks)
    : null
  const marks = chosen
    ? [
        ...workMarks(chosen, props.tags, props.measures),
        ...(taskLine ? [taskLine] : []),
      ]
    : []
  return (
    <div data-work-field="" className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">Obra</span>
        <select
          value={missing ? (props.value ?? '') : (chosen?.id ?? '')}
          onChange={(event) => props.onChange(event.target.value || null)}
          className={fieldClass}
        >
          {missing && (
            <option value={props.value ?? ''}>{props.missing}</option>
          )}
          <option value="">Nenhuma obra</option>
          {inProgress.length > 0 && (
            <optgroup label="Em andamento">
              {inProgress.map((work) => (
                <option key={work.id} value={work.id}>
                  {workOptionLabel(work)}
                </option>
              ))}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label="Outras">
              {others.map((work) => (
                <option key={work.id} value={work.id}>
                  {workOptionLabel(work)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      {marks.map((mark) => (
        <p
          key={mark}
          className="font-texto text-meta [overflow-wrap:anywhere] text-tinta-suave"
        >
          {mark}
        </p>
      ))}
    </div>
  )
}

export default WorkField
