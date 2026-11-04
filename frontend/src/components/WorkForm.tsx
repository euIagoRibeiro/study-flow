import { useState, type FormEvent } from 'react'
import { parseMeasureValue, quantityInputValue } from '../numbers'
import { fieldClass, primaryButtonClass, secondaryButtonClass } from '../styles'
import { compareNames } from '../tags'
import type { Measure, Tag, Task, Work, WorkFields, WorkStatus } from '../types'
import {
  defaultPath,
  LINK_ERROR,
  LINK_PATTERN,
  measureMismatch,
  mismatchText,
  pathMeasure,
  statusLabel,
  TITLE_ERROR,
  totalError,
  WORK_STATUSES,
  workError,
} from '../works'
import FormError from './FormError'
import TagFields from './TagFields'

// Criar ou editar uma obra, no lugar da linha (sempre empilhado: mora dentro
// do cartão). Sem rascunho, como os outros formulários da tela de tags. O
// estado é só daqui: a lista de obras recarregando por baixo não mexe no que
// foi digitado
function WorkForm(props: {
  work?: Work
  tags: Tag[]
  tasks: Task[]
  measures: Measure[]
  onSubmit: (fields: Partial<WorkFields>) => Promise<Work>
  onSaved: (work: Work) => void
  onClose: () => void
}) {
  const { work } = props
  // Arquivadas do caminho gravado continuam escolhíveis (como no registro)
  const keep = work ? defaultPath(work, props.tags) : []
  const samePath = (path: string[]) => path.join() === keep.join()
  // Obra que soma uma medida que não é mais a do caminho: a gravada continua
  // como opção (a obra guarda a medida até a pessoa decidir)
  const old =
    work && measureMismatch(work) === 'trocada'
      ? (props.measures.find((m) => m.id === work.measureId) ?? null)
      : null
  // Opções do campo Medida, nesta ordem: a antiga (só no caminho gravado), a
  // mais próxima do caminho (a mesma conta da marca da lista) e "Nenhuma"
  const optionsOf = (path: string[]) => {
    const nearest = pathMeasure(path, props.measures, work)
    return [
      ...(old && samePath(path) ? [old] : []),
      ...(nearest && nearest.id !== old?.id ? [nearest] : []),
    ]
  }

  const [title, setTitle] = useState(work?.title ?? '')
  const [path, setPath] = useState<string[]>(keep)
  const [taskId, setTaskId] = useState(work?.defaultTaskId ?? '')
  const [measureId, setMeasureId] = useState(work?.measureId ?? null)
  const [totalText, setTotalText] = useState(() =>
    quantityInputValue(work?.total ?? null),
  )
  const [link, setLink] = useState(work?.url ?? '')
  const [status, setStatus] = useState<WorkStatus>(
    work?.status ?? 'em_andamento',
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const choices = optionsOf(path)
  const measure = choices.find((m) => m.id === measureId) ?? null
  const phrase =
    work && samePath(path)
      ? mismatchText(work, props.tags, props.measures, true)
      : null

  // Trocar de medida apaga o total; voltar pra gravada devolve o gravado
  function chooseMeasure(id: string | null, path: string[]) {
    setMeasureId(id)
    setTotalText(
      work && id !== null && id === work.measureId && samePath(path)
        ? quantityInputValue(work.total)
        : '',
    )
  }

  // A medida acompanha o caminho (a mais próxima do novo); o total só fica se
  // a medida for a mesma
  function changePath(next: string[]) {
    const before = measure?.id ?? null
    const after = pathMeasure(next, props.measures, work)?.id ?? null
    setPath(next)
    if (after !== before) chooseMeasure(after, next)
  }

  const tasks = props.tasks
    .filter((task) => task.active || task.id === work?.defaultTaskId)
    .sort((a, b) => compareNames(a.title, b.title))

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (title.trim() === '') return setError(TITLE_ERROR)
    if (path.length === 0) return setError('Escolha o caminho padrão.')
    if (taskId === '') return setError('Escolha a tarefa.')
    let total: number | null = null
    if (measure && totalText.trim() !== '') {
      const parsed = parseMeasureValue(totalText, measure.allowsDecimal)
      if (parsed === null || parsed === '') {
        return setError(totalError(measure.allowsDecimal))
      }
      total = parsed
    }
    const url = link.trim() === '' ? null : link.trim()
    if (url !== null && !LINK_PATTERN.test(url)) return setError(LINK_ERROR)

    const fields: WorkFields = {
      title: title.trim(),
      status,
      defaultTagId: path[path.length - 1],
      defaultTaskId: taskId,
      measureId: measure?.id ?? null,
      total,
      url,
    }
    // Editando: só o que mudou; o vazio vai como null (limpa no servidor)
    const changes = work
      ? (Object.fromEntries(
          Object.entries(fields).filter(
            ([key, value]) => work[key as keyof WorkFields] !== value,
          ),
        ) as Partial<WorkFields>)
      : fields
    if (work && Object.keys(changes).length === 0) return props.onClose()

    setBusy(true)
    setError('')
    try {
      props.onSaved(await props.onSubmit(changes))
    } catch (err) {
      setError(workError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={work ? `Obra ${work.title}` : 'Nova obra'}
      className="flex flex-col gap-3 py-2 pr-2"
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">Título</span>
        <input
          type="text"
          value={title}
          maxLength={100}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
          className={fieldClass}
        />
      </label>
      <TagFields
        tags={props.tags}
        value={path}
        onChange={changePath}
        keep={keep}
        title="Caminho padrão"
        rootNone="Escolha o contexto"
        manageLink={false}
      />
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">Tarefa</span>
        <select
          value={taskId}
          onChange={(event) => setTaskId(event.target.value)}
          className={fieldClass}
        >
          <option value="">Escolha a tarefa</option>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.active ? task.title : `${task.title} (arquivada)`}
            </option>
          ))}
        </select>
      </label>
      {choices.length > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-tinta-suave">Medida do progresso</span>
          <select
            value={measure?.id ?? ''}
            onChange={(event) =>
              chooseMeasure(event.target.value || null, path)
            }
            className={fieldClass}
          >
            {choices.map((m) => (
              <option key={m.id} value={m.id}>
                {m === old ? `${m.name} (medida antiga)` : m.name}
              </option>
            ))}
            <option value="">Nenhuma</option>
          </select>
        </label>
      )}
      {phrase && choices.length > 0 && (
        <p className="font-texto text-meta [overflow-wrap:anywhere] text-tinta-suave">
          {phrase}
        </p>
      )}
      {measure && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm [overflow-wrap:anywhere] text-tinta-suave">
            Total de {measure.name} (opcional)
          </span>
          <input
            type="text"
            inputMode={measure.allowsDecimal ? 'decimal' : 'numeric'}
            value={totalText}
            onChange={(event) => setTotalText(event.target.value)}
            className={fieldClass}
          />
        </label>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">Link (opcional)</span>
        <input
          type="text"
          inputMode="url"
          value={link}
          maxLength={2000}
          onChange={(event) => setLink(event.target.value)}
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">Status</span>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as WorkStatus)}
          className={fieldClass}
        >
          {WORK_STATUSES.map((value) => (
            <option key={value} value={value}>
              {statusLabel[value]}
            </option>
          ))}
        </select>
      </label>
      {error && <FormError>{error}</FormError>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={props.onClose}
          className={`flex-1 ${secondaryButtonClass}`}
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={busy}
          className={`flex-1 ${primaryButtonClass}`}
        >
          {work ? 'Salvar' : 'Criar'}
        </button>
      </div>
    </form>
  )
}

export default WorkForm
