import { useEffect, useState } from 'react'
import { compareNames, indexTags, tagPath } from '../tags'
import { chipClass, focusRing } from '../styles'
import type {
  Measure,
  Tag,
  Task,
  Work,
  WorkActions,
  WorkFields,
  WorkStatus,
} from '../types'
import {
  filterLabel,
  progressLine,
  registros,
  statusAction,
  statusLabel,
  WORK_STATUSES,
  workMarks,
} from '../works'
import ActionMenu, { type MenuAction } from './ActionMenu'
import FilterChips from './FilterChips'
import { PencilIcon, PhasesIcon, PlayIcon, PlusIcon, TrashIcon } from './icons'
import WorkForm from './WorkForm'

type Filter = WorkStatus | 'todas'

// Obras, entre as seleções gerais e os exercícios. O filtro começa em "Em
// andamento" e vai pro status da obra criada ou editada (inclusive pelo
// atalho do menu): a obra nunca some da vista no toque que mexeu nela
function WorkCatalog(props: {
  works: Work[]
  tags: Tag[]
  tasks: Task[]
  measures: Measure[]
  actions: WorkActions
}) {
  const [filter, setFilter] = useState<Filter>('em_andamento')
  const [form, setForm] = useState<{ id: string | null } | null>(null)

  // Ao entrar na tela: os registros feitos no Executar mudam o progresso
  useEffect(() => {
    props.actions.refresh()
    // só ao montar: `actions` é um objeto novo a cada renderização do App
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const byId = indexTags(props.tags)
  const measureById = new Map(props.measures.map((m) => [m.id, m]))
  const counts = new Map<Filter, number>([['todas', props.works.length]])
  for (const work of props.works) {
    counts.set(work.status, (counts.get(work.status) ?? 0) + 1)
  }
  const shown = props.works
    .filter((work) => filter === 'todas' || work.status === filter)
    .sort(
      (a, b) =>
        WORK_STATUSES.indexOf(a.status) - WORK_STATUSES.indexOf(b.status) ||
        compareNames(a.title, b.title),
    )

  function saved(work: Work) {
    setForm(null)
    setFilter(work.status)
  }

  function actionsFor(work: Work): MenuAction[] {
    return [
      {
        label: 'Editar',
        icon: <PencilIcon />,
        onSelect: () => setForm({ id: work.id }),
      },
      ...WORK_STATUSES.filter((status) => status !== work.status).map(
        (status): MenuAction => ({
          label: statusAction[status],
          icon: status === 'em_andamento' ? <PlayIcon /> : <PhasesIcon />,
          onSelect: async () => {
            const updated = await props.actions.setStatus(work.id, status)
            if (updated) setFilter(updated.status)
          },
        }),
      ),
      {
        label: 'Apagar',
        icon: <TrashIcon />,
        onSelect: () => {
          if (window.confirm(`Apagar "${work.title}"? Não dá pra desfazer.`)) {
            props.actions.remove(work.id)
          }
        },
        disabled: work.records > 0,
        hint:
          work.records > 0
            ? `Tem ${registros(work.records)}. Mude o status em vez de apagar.`
            : undefined,
      },
    ]
  }

  const formProps = {
    tags: props.tags,
    tasks: props.tasks,
    measures: props.measures,
    onSaved: saved,
    onClose: () => setForm(null),
  }

  function renderRow(work: Work) {
    const tag = byId.get(work.defaultTagId)
    return (
      <li key={work.id}>
        {form?.id === work.id ? (
          <WorkForm
            work={work}
            onSubmit={(changes) => props.actions.update(work.id, changes)}
            {...formProps}
          />
        ) : (
          <div className="flex min-h-11 items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1 py-2">
              <span className="min-w-0 text-conteudo break-words">
                {work.title}
              </span>
              {tag && (
                <span className="font-dados text-meta [overflow-wrap:anywhere] text-tinta-suave">
                  {tagPath(tag, byId)}
                </span>
              )}
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={chipClass}>{statusLabel[work.status]}</span>
                <span className="font-dados text-meta [overflow-wrap:anywhere] text-tinta-suave tabular-nums">
                  {progressLine(
                    work,
                    work.measureId
                      ? measureById.get(work.measureId)
                      : undefined,
                  )}
                </span>
              </span>
              {workMarks(work, props.tags, props.measures).map((mark) => (
                <span
                  key={mark}
                  className="font-texto text-meta [overflow-wrap:anywhere] text-tinta-suave"
                >
                  {mark}
                </span>
              ))}
            </div>
            <ActionMenu
              label={`Mais ações da obra ${work.title}`}
              actions={actionsFor(work)}
              placement=""
            />
          </div>
        )}
      </li>
    )
  }

  return (
    <section
      aria-label="Obras"
      data-works-block=""
      className="flex flex-col gap-2"
    >
      <h3 className="mt-2 font-titulo text-base font-bold">Obras</h3>
      <p className="px-0.5 font-texto text-meta text-tinta-suave">
        O que você acompanha em vários registros: um mangá, um curso, um
        desafio.
      </p>
      {props.works.length > 0 && (
        <FilterChips
          label="Filtrar obras por status"
          options={[
            ...WORK_STATUSES.map((status) => ({
              value: status as Filter,
              label: filterLabel[status],
              count: counts.get(status) ?? 0,
            })),
            { value: 'todas', label: 'Todas', count: props.works.length },
          ]}
          value={filter}
          onChange={setFilter}
        />
      )}
      {props.works.length === 0 ? (
        <p className="py-6 text-center text-sm text-tinta-suave">
          Nenhuma obra ainda. Uma obra junta os registros do que você acompanha.
        </p>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-tinta-suave">
          Nenhuma obra{' '}
          {filter === 'todas' ? '' : statusLabel[filter].toLowerCase()}.
        </p>
      ) : (
        <ul className="flex flex-col rounded-[14px] border border-linha bg-superficie py-1.5 pl-3.5">
          {shown.map(renderRow)}
        </ul>
      )}
      {form?.id === null ? (
        <div className="rounded-[14px] border border-linha bg-superficie py-1.5 pl-3.5">
          <WorkForm
            // Sem obra, o formulário manda todos os campos
            onSubmit={(fields) => props.actions.create(fields as WorkFields)}
            {...formProps}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setForm({ id: null })}
          className={`flex h-13 w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-tinta-suave/55 font-semibold text-tinta-suave hover:bg-tinta/[0.07] hover:text-tinta ${focusRing}`}
        >
          <PlusIcon />
          Nova obra
        </button>
      )}
    </section>
  )
}

export default WorkCatalog
