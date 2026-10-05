import { useEffect, useState } from 'react'
import { ChevronDownIcon } from '../components/icons'
import { chipClass, focusRing } from '../styles'
import type { Tag, TaskExecution } from '../types'

// Quais tags estão abertas: conveniência de quem olha a tela (só neste
// navegador), não dado do app — por isso localStorage, não o banco. Se o
// armazenamento estiver bloqueado, começa tudo fechado
const OPEN_KEY = 'studyflow:tags-abertas'

function readOpen(existing: Tag[]): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]')
    if (!Array.isArray(saved)) return new Set()
    // Tags apagadas desde a última visita saem da lista
    const ids = new Set(existing.map((tag) => tag.id))
    return new Set(saved.filter((id) => ids.has(id)))
  } catch {
    return new Set()
  }
}

// Mesma superfície do cardClass, com menos respiro: as linhas já têm 44px
const tagCardClass =
  'rounded-[14px] border border-linha bg-superficie py-1.5 pl-3.5'

// Peso por nível: a hierarquia aparece pela posição (recuo + linha-guia)
// e pela fonte, sem rótulo "nível 2"
const nameClass = {
  1: 'font-titulo text-base font-semibold',
  2: 'text-conteudo font-medium',
  3: 'text-sm',
}

function registros(count: number) {
  return count === 1 ? '1 registro' : `${count} registros`
}

function TagsPage(props: { tags: Tag[]; executions: TaskExecution[] }) {
  const [showArchived, setShowArchived] = useState(false)
  const [open, setOpen] = useState(() => readOpen(props.tags))

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...open]))
    } catch {
      // Sem armazenamento: só não lembra na próxima visita
    }
  }, [open])

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Registros = execuções concluídas que passam pela tag. tagIds já é o
  // fechamento, então "Matemática" conta também as de Álgebra/Frações
  const counts = new Map<string, number>()
  for (const execution of props.executions) {
    if (execution.completedAt === null) continue
    const ids = execution.rootTagId
      ? [execution.rootTagId, ...execution.tagIds]
      : execution.tagIds
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  // Arquivar desce em cascata (T2): esconder a arquivada já esconde a
  // subárvore dela
  const visible = props.tags.filter((tag) => showArchived || tag.active)
  const childrenOf = (parentId: string | null) =>
    visible.filter((tag) => tag.parentId === parentId)
  const roots = childrenOf(null)

  function renderTag(tag: Tag) {
    const children = childrenOf(tag.id)
    const isOpen = open.has(tag.id)
    const listId = `subtags-${tag.id}`
    const nameStyle = `${nameClass[tag.level]} ${tag.active ? '' : 'text-tinta-suave'}`
    return (
      <li key={tag.id}>
        <div className="flex min-h-11 items-center gap-2 pr-2">
          {children.length > 0 ? (
            // Nome + seta = um botão só (mesmo padrão do "2 sessões ⌄"):
            // alvo grande no celular, e o estado vai no aria-expanded
            <button
              type="button"
              onClick={() => toggle(tag.id)}
              aria-expanded={isOpen}
              aria-controls={listId}
              aria-label={`Subtags de ${tag.name}`}
              className={`flex min-h-11 min-w-0 items-center gap-1 rounded-md text-left break-words ${nameStyle} ${focusRing}`}
            >
              {tag.name}
              <ChevronDownIcon
                className={`h-4 w-4 shrink-0 text-tinta-suave transition-transform ${isOpen ? 'rotate-180' : ''}`}
              />
            </button>
          ) : (
            <span className={`min-w-0 break-words ${nameStyle}`}>
              {tag.name}
            </span>
          )}
          <span className="flex-1" />
          {!tag.active && <span className={chipClass}>Arquivada</span>}
          <span className="shrink-0 font-dados text-meta text-tinta-suave tabular-nums">
            {registros(counts.get(tag.id) ?? 0)}
          </span>
        </div>
        {/* Fechada: nem renderiza, então o Tab não para em nada escondido */}
        {children.length > 0 && isOpen && (
          <ul id={listId} className="ml-1.5 border-l border-linha pl-3">
            {children.map(renderTag)}
          </ul>
        )}
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-titulo text-lg font-bold">Tags</h2>
      {props.tags.length > 0 && (
        <label className="flex items-center gap-2 px-0.5 text-sm text-tinta-suave">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Mostrar arquivadas
        </label>
      )}
      {roots.length === 0 ? (
        <p className="py-8 text-center text-sm text-tinta-suave">
          Nenhuma tag ainda. Tags organizam o que você registra: um contexto
          (ex.: Vestibular), as matérias dele e, se precisar, os temas de cada
          matéria.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {roots.map((root) => (
            <li
              key={root.id}
              className={`${tagCardClass} ${root.active ? '' : 'opacity-75'}`}
            >
              <ul>{renderTag(root)}</ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default TagsPage
