import { useState } from 'react'
import { compareNames } from '../tags'
import { chipClass, textButtonClass } from '../styles'
import type { Exercise, ExerciseActions, TaskExecution } from '../types'
import ActionMenu, { type MenuAction } from './ActionMenu'
import {
  ArchiveIcon,
  ChevronDownIcon,
  PencilIcon,
  TrashIcon,
  UnarchiveIcon,
} from './icons'
import TagForm from './TagForm'

function registros(count: number) {
  return count === 1 ? '1 registro' : `${count} registros`
}

// Catálogo de exercícios, abaixo da árvore de tags. Criar é no treino (A3e);
// aqui só se corrige o nome e se arquiva. Arquivados ficam recolhidos no
// fim, com controle próprio (não são tags: nada a ver com "Mostrar arquivadas")
function ExerciseCatalog(props: {
  exercises: Exercise[]
  executions: TaskExecution[]
  actions: ExerciseActions
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const uses = new Map<string, number>()
  for (const execution of props.executions) {
    for (const item of execution.workout ?? []) {
      uses.set(item.exerciseId, (uses.get(item.exerciseId) ?? 0) + 1)
    }
  }
  const byName = (a: Exercise, b: Exercise) => compareNames(a.name, b.name)
  const active = props.exercises.filter((x) => x.active).sort(byName)
  const archived = props.exercises.filter((x) => !x.active).sort(byName)

  function actionsFor(exercise: Exercise): MenuAction[] {
    const count = uses.get(exercise.id) ?? 0
    return [
      {
        label: 'Renomear',
        icon: <PencilIcon />,
        onSelect: () => setRenamingId(exercise.id),
      },
      exercise.active
        ? {
            label: 'Arquivar',
            icon: <ArchiveIcon />,
            onSelect: () => props.actions.setActive(exercise.id, false),
          }
        : {
            label: 'Reativar',
            icon: <UnarchiveIcon />,
            onSelect: () => props.actions.setActive(exercise.id, true),
          },
      {
        label: 'Apagar',
        icon: <TrashIcon />,
        onSelect: () => {
          if (window.confirm(`Apagar "${exercise.name}"?`)) {
            props.actions.remove(exercise.id)
          }
        },
        disabled: count > 0,
        hint:
          count > 0
            ? `Em uso em ${registros(count)}. Arquive em vez de apagar.`
            : undefined,
      },
    ]
  }

  function renderRow(exercise: Exercise) {
    return (
      <li key={exercise.id}>
        {renamingId === exercise.id ? (
          <TagForm
            label="Nome"
            submitLabel="Salvar"
            initialName={exercise.name}
            maxLength={60}
            emptyError="Escreva um nome para o exercício."
            onSubmit={async (name) => {
              await props.actions.rename(exercise.id, name)
              setRenamingId(null)
            }}
            onCancel={() => setRenamingId(null)}
          />
        ) : (
          <div className="flex min-h-11 items-center gap-2">
            {/* Contagem sempre embaixo do nome: nome longo é a regra aqui */}
            <div className="flex min-w-0 flex-1 flex-col gap-1 py-2">
              <span
                className={`min-w-0 text-conteudo break-words ${exercise.active ? '' : 'text-tinta-suave'}`}
              >
                {exercise.name}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {!exercise.active && (
                  <span className={chipClass}>Arquivado</span>
                )}
                <span className="shrink-0 font-dados text-meta text-tinta-suave tabular-nums">
                  {registros(uses.get(exercise.id) ?? 0)}
                </span>
              </span>
            </div>
            <ActionMenu
              label={`Mais ações do exercício ${exercise.name}`}
              actions={actionsFor(exercise)}
              placement=""
            />
          </div>
        )}
      </li>
    )
  }

  return (
    <section aria-label="Exercícios" className="flex flex-col gap-2">
      <h3 className="mt-2 font-titulo text-base font-bold">Exercícios</h3>
      <p className="px-0.5 font-texto text-meta text-tinta-suave">
        Criados durante o treino. Aqui você corrige o nome e arquiva.
      </p>
      {props.exercises.length === 0 ? (
        <p className="py-6 text-center text-sm text-tinta-suave">
          Nenhum exercício ainda. Eles são criados durante o treino, nos
          contextos que usam treino.
        </p>
      ) : (
        <div className="rounded-[14px] border border-linha bg-superficie py-1.5 pl-3.5">
          <ul>{active.map(renderRow)}</ul>
          {archived.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowArchived((open) => !open)}
                aria-expanded={showArchived}
                className={`my-1 text-sm text-tinta-suave ${textButtonClass}`}
              >
                {archived.length === 1
                  ? '1 arquivado'
                  : `${archived.length} arquivados`}
                <ChevronDownIcon
                  className={`h-4 w-4 transition-transform ${showArchived ? 'rotate-180' : ''}`}
                />
              </button>
              {showArchived && <ul>{archived.map(renderRow)}</ul>}
            </>
          )}
        </div>
      )}
    </section>
  )
}

export default ExerciseCatalog
