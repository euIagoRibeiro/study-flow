import { useEffect, useState } from 'react'
import ActionMenu, { type MenuAction } from '../components/ActionMenu'
import {
  ArchiveIcon,
  ChevronDownIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  UnarchiveIcon,
} from '../components/icons'
import TagForm from '../components/TagForm'
import { cardClass, chipClass, focusRing } from '../styles'
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

// Peso por nível: a hierarquia aparece pela posição (recuo + linha-guia)
// e pela fonte, sem rótulo "nível 2"
const nameClass = {
  1: 'font-titulo text-base font-semibold',
  2: 'text-conteudo font-medium',
  3: 'text-sm',
}

// Mesma superfície do cardClass, com menos respiro: as linhas já têm 44px
const tagCardClass =
  'rounded-[14px] border border-linha bg-superficie py-1.5 pl-3.5'

function registros(count: number) {
  return count === 1 ? '1 registro' : `${count} registros`
}

type FormState =
  | { kind: 'root' }
  | { kind: 'child'; parentId: string }
  | { kind: 'rename'; tagId: string }
  | null

function TagsPage(props: {
  tags: Tag[]
  executions: TaskExecution[]
  onCreate: (name: string, parentId: string | null) => Promise<void>
  onRename: (id: string, name: string) => Promise<void>
  onArchive: (id: string) => void
  onReactivate: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [showArchived, setShowArchived] = useState(false)
  const [open, setOpen] = useState(() => readOpen(props.tags))
  // Um formulário por vez (criar raiz, criar subtag ou renomear)
  const [form, setForm] = useState<FormState>(null)

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

  const byId = new Map(props.tags.map((tag) => [tag.id, tag]))
  const path = (tag: Tag): string => {
    const parent = tag.parentId ? byId.get(tag.parentId) : undefined
    return parent ? `${path(parent)} › ${tag.name}` : tag.name
  }

  // Exibido: registros concluídos que passam pela tag (tagIds já é o
  // fechamento, então "Matemática" conta também Álgebra/Frações).
  // Pra liberar "Apagar": qualquer execução, aberta ou não — o banco
  // recusa as duas
  const counts = new Map<string, number>()
  const used = new Map<string, number>()
  for (const execution of props.executions) {
    const ids = execution.rootTagId
      ? [execution.rootTagId, ...execution.tagIds]
      : execution.tagIds
    for (const id of ids) {
      used.set(id, (used.get(id) ?? 0) + 1)
      if (execution.completedAt !== null) {
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }
    }
  }

  // Arquivar desce em cascata (T2): esconder a arquivada já esconde a
  // subárvore dela
  const visible = props.tags.filter((tag) => showArchived || tag.active)
  const byName = (a: Tag, b: Tag) => a.name.localeCompare(b.name, 'pt-BR')
  const childrenOf = (parentId: string | null) =>
    visible.filter((tag) => tag.parentId === parentId).sort(byName)
  const roots = childrenOf(null)
  const activeRoots = props.tags.filter(
    (tag) => tag.parentId === null && tag.active,
  ).length

  const allChildrenOf = (id: string) =>
    props.tags.filter((tag) => tag.parentId === id)
  // Recursiva: o TypeScript precisa do tipo de retorno escrito
  const activeDescendants = (id: string): Tag[] =>
    allChildrenOf(id).flatMap((child) =>
      child.active ? [child, ...activeDescendants(child.id)] : [],
    )

  function handleArchive(tag: Tag) {
    const n = activeDescendants(tag.id).length
    const cascade =
      n === 0
        ? ''
        : n === 1
          ? '1 subtag dentro dela também será arquivada. '
          : `As ${n} subtags dentro dela também serão arquivadas. `
    const confirmed = window.confirm(
      `Arquivar "${tag.name}"? ${cascade}Os registros continuam no histórico com essas tags, e dá pra reativar depois ligando "Mostrar arquivadas".`,
    )
    if (confirmed) props.onArchive(tag.id)
  }

  function handleDelete(tag: Tag) {
    if (window.confirm(`Apagar "${tag.name}"? Não dá pra desfazer.`)) {
      props.onDelete(tag.id)
    }
  }

  function actionsFor(tag: Tag): MenuAction[] {
    const actions: MenuAction[] = [
      {
        label: 'Renomear',
        icon: <PencilIcon />,
        onSelect: () => setForm({ kind: 'rename', tagId: tag.id }),
      },
    ]
    if (tag.active && tag.level < 3) {
      actions.push({
        label: 'Nova subtag',
        icon: <PlusIcon />,
        onSelect: () => {
          // Abre a tag, pra o formulário (e a subtag nova) aparecer
          setOpen((current) => new Set(current).add(tag.id))
          setForm({ kind: 'child', parentId: tag.id })
        },
      })
    }
    if (tag.active) {
      actions.push({
        label: 'Arquivar',
        icon: <ArchiveIcon />,
        onSelect: () => handleArchive(tag),
      })
    } else {
      const parent = tag.parentId ? byId.get(tag.parentId) : undefined
      const blocked = parent !== undefined && !parent.active
      actions.push({
        label: 'Reativar',
        icon: <UnarchiveIcon />,
        onSelect: () => props.onReactivate(tag.id),
        disabled: blocked,
        hint: blocked ? `Reative ${parent.name} primeiro.` : undefined,
      })
    }
    const hasChildren = allChildrenOf(tag.id).length > 0
    const uses = used.get(tag.id) ?? 0
    const deleteHint =
      hasChildren && uses > 0
        ? `Tem subtags e ${registros(uses)}. Arquive em vez de apagar.`
        : hasChildren
          ? 'Tem subtags: apague ou arquive as subtags antes.'
          : uses > 0
            ? `Em uso em ${registros(uses)}. Arquive em vez de apagar.`
            : undefined
    actions.push({
      label: 'Apagar',
      icon: <TrashIcon />,
      onSelect: () => handleDelete(tag),
      disabled: deleteHint !== undefined,
      hint: deleteHint,
    })
    return actions
  }

  function renderTag(tag: Tag) {
    const children = childrenOf(tag.id)
    const isOpen = open.has(tag.id)
    const listId = `subtags-${tag.id}`
    const nameStyle = `${nameClass[tag.level]} ${tag.active ? '' : 'text-tinta-suave'}`
    const addingHere = form?.kind === 'child' && form.parentId === tag.id
    const closeForm = () => setForm(null)
    return (
      <li key={tag.id}>
        {form?.kind === 'rename' && form.tagId === tag.id ? (
          <TagForm
            label="Nome"
            submitLabel="Salvar"
            initialName={tag.name}
            onSubmit={async (name) => {
              await props.onRename(tag.id, name)
              closeForm()
            }}
            onCancel={closeForm}
          />
        ) : (
          <div className="flex min-h-11 items-center gap-2">
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
            <ActionMenu
              label={`Mais ações de ${path(tag)}`}
              actions={actionsFor(tag)}
              placement=""
            />
          </div>
        )}
        {/* Fechada: nem renderiza, então o Tab não para em nada escondido */}
        {((children.length > 0 && isOpen) || addingHere) && (
          <ul id={listId} className="ml-1.5 border-l border-linha pl-3">
            {isOpen && children.map(renderTag)}
            {addingHere && (
              <li>
                <TagForm
                  label={`Nova subtag em ${tag.name}`}
                  submitLabel="Adicionar"
                  onSubmit={async (name) => {
                    await props.onCreate(name, tag.id)
                    closeForm()
                  }}
                  onCancel={closeForm}
                />
              </li>
            )}
          </ul>
        )}
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-titulo text-lg font-bold">Tags</h2>
      {form?.kind === 'root' ? (
        <div className={cardClass}>
          <TagForm
            label="Nova tag"
            submitLabel="Adicionar"
            onSubmit={async (name) => {
              await props.onCreate(name, null)
              setForm(null)
            }}
            onCancel={() => setForm(null)}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setForm({ kind: 'root' })}
            className={`flex h-13 w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-tinta-suave/55 font-semibold text-tinta-suave hover:bg-tinta/[0.07] hover:text-tinta ${focusRing}`}
          >
            <PlusIcon />
            Nova tag
          </button>
          {activeRoots >= 3 && (
            <p className="px-0.5 font-texto text-meta text-tinta-suave">
              Você já tem {activeRoots} contextos. A ideia é ter poucos; antes
              de criar outro, veja se ele cabe dentro de um que já existe.
            </p>
          )}
        </div>
      )}
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
            // Raiz arquivada sem opacity no cartão: o nome já vem em
            // tinta-suave + chip; apagar duas vezes derrubava o contraste
            // (medido 3.6:1). Assim o menu também não herda opacidade
            <li key={root.id} className={tagCardClass}>
              <ul>{renderTag(root)}</ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default TagsPage
