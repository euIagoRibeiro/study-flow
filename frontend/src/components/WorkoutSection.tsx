import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { compareNames } from '../tags'
import {
  cardClass,
  fieldClass,
  pickerButtonClass,
  secondaryButtonClass,
  textButtonClass,
} from '../styles'
import type { Exercise, WorkoutExercise, WorkoutSet } from '../types'
import { countSets, formatSet, matchesFilter, parseSet } from '../workouts'
import ActionMenu from './ActionMenu'
import FormError from './FormError'
import { PlusIcon, TrashIcon } from './icons'

// Reps e kg lado a lado, numa grade que não depende da janela (cabe em 320)
function SetFields(props: {
  reps: string
  kg: string
  onReps: (text: string) => void
  onKg: (text: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">Reps</span>
        <input
          type="text"
          inputMode="numeric"
          value={props.reps}
          onChange={(event) => props.onReps(event.target.value)}
          className={`min-w-0 ${fieldClass}`}
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">Kg</span>
        <input
          type="text"
          inputMode="decimal"
          value={props.kg}
          onChange={(event) => props.onKg(event.target.value)}
          placeholder="corpo"
          className={`min-w-0 ${fieldClass}`}
        />
      </label>
    </div>
  )
}

function kgText(set: WorkoutSet) {
  return set.weightKg === null ? '' : String(set.weightKg).replace('.', ',')
}

// Treino do registro aberto. Fica FORA do <form> do Finalizar: Enter num
// campo daqui adiciona a série, nunca finaliza o treino
function WorkoutSection(props: {
  draft: WorkoutExercise[]
  exercises: Exercise[]
  recentIds: string[]
  markerName: string
  status: 'saved' | 'saving' | 'error'
  error: string
  savedExercises: number
  onChange: (next: WorkoutExercise[]) => void
  onRetry: () => void
  // Devolve o criado, ou o existente se o nome já existia (409)
  onCreateExercise: (name: string) => Promise<Exercise>
}) {
  const { draft, onChange } = props
  const [currentId, setCurrentId] = useState<string | null>(
    draft.at(-1)?.exerciseId ?? null,
  )
  const [picking, setPicking] = useState(false)
  const [filter, setFilter] = useState('')
  // Criar na hora: o nome esperando confirmação, e o erro dela
  const [confirming, setConfirming] = useState<string | null>(null)
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)
  const [reps, setReps] = useState('')
  const [kg, setKg] = useState('')
  const [fieldError, setFieldError] = useState('')
  // Série sendo corrigida (posição no exercício atual)
  const [editing, setEditing] = useState<{
    index: number
    reps: string
    kg: string
    error: string
  } | null>(null)

  const byId = new Map(props.exercises.map((x) => [x.id, x]))
  const nameOf = (id: string) => byId.get(id)?.name ?? 'Exercício'
  const current = draft.find((item) => item.exerciseId === currentId)

  function replaceSets(exerciseId: string, sets: WorkoutSet[]) {
    onChange(
      draft.map((item) =>
        item.exerciseId === exerciseId ? { ...item, sets } : item,
      ),
    )
  }

  function choose(exerciseId: string) {
    onChange([...draft, { exerciseId, sets: [] }])
    setCurrentId(exerciseId)
    setPicking(false)
    setFilter('')
    setConfirming(null)
    setCreateError('')
    setReps('')
    setKg('')
    setFieldError('')
    setEditing(null)
  }

  function open(exerciseId: string) {
    setCurrentId(exerciseId)
    setEditing(null)
    setFieldError('')
  }

  function remove(item: WorkoutExercise) {
    const name = nameOf(item.exerciseId)
    if (
      item.sets.length > 0 &&
      !window.confirm(
        `Tirar "${name}" do treino? ${item.sets.length === 1 ? 'A série sai junto' : `As ${item.sets.length} séries saem junto`}.`,
      )
    ) {
      return
    }
    const next = draft.filter((x) => x.exerciseId !== item.exerciseId)
    onChange(next)
    if (item.exerciseId === currentId)
      setCurrentId(next.at(-1)?.exerciseId ?? null)
  }

  function addSet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!current) return
    const set = parseSet(reps, kg)
    if ('error' in set) {
      setFieldError(set.error)
      return
    }
    replaceSets(current.exerciseId, [...current.sets, set])
    setReps('')
    setKg('')
    setFieldError('')
  }

  function repeatSet() {
    const last = current?.sets.at(-1)
    if (!current || !last) return
    replaceSets(current.exerciseId, [...current.sets, last])
  }

  function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!current || !editing) return
    const set = parseSet(editing.reps, editing.kg)
    if ('error' in set) {
      setEditing({ ...editing, error: set.error })
      return
    }
    replaceSets(
      current.exerciseId,
      current.sets.map((s, i) => (i === editing.index ? set : s)),
    )
    setEditing(null)
  }

  function deleteSet() {
    if (!current || !editing) return
    replaceSets(
      current.exerciseId,
      current.sets.filter((_, i) => i !== editing.index),
    )
    setEditing(null)
  }

  // Escolha: recentes neste contexto primeiro, depois os outros por nome.
  // Arquivados e os que já estão na sessão ficam fora
  const inSession = new Set(draft.map((item) => item.exerciseId))
  const available = props.exercises.filter(
    (x) => x.active && !inSession.has(x.id) && matchesFilter(x, filter),
  )
  const recent = props.recentIds
    .map((id) => available.find((x) => x.id === id))
    .filter((x) => x !== undefined)
  const others = available
    .filter((x) => !props.recentIds.includes(x.id))
    .sort((a, b) => compareNames(a.name, b.name))
  // Nome igual ao de um do catálogo, como o servidor compara (sem
  // maiúscula, sem espaço nas pontas): não oferece criar
  const sameName = (name: string) =>
    name.trim().toLowerCase() === filter.trim().toLowerCase()
  const exact = props.exercises.find((x) => sameName(x.name))
  const blocked = (exercise: Exercise) =>
    !exercise.active
      ? `${exercise.name} está arquivado. Reative na tela de tags.`
      : inSession.has(exercise.id)
        ? 'Já está no treino.'
        : null

  async function create() {
    if (confirming === null) return
    setCreating(true)
    let exercise: Exercise
    try {
      exercise = await props.onCreateExercise(confirming)
    } catch (err) {
      setCreateError(
        err instanceof ApiError && err.status === 400
          ? err.message
          : 'Não foi possível criar o exercício. Tente de novo.',
      )
      return
    } finally {
      setCreating(false)
    }
    // O nome já existia (catálogo da tela desatualizado): vale o existente
    const reason = blocked(exercise)
    if (reason) {
      setCreateError(reason)
      return
    }
    choose(exercise.id)
  }

  const statusText =
    props.status === 'saving'
      ? 'Salvando…'
      : props.status === 'error'
        ? 'Não salvo'
        : props.savedExercises > 0
          ? 'Salvo'
          : ''

  function renderOption(exercise: Exercise) {
    return (
      <li key={exercise.id}>
        <button
          type="button"
          onClick={() => choose(exercise.id)}
          className={pickerButtonClass}
        >
          {exercise.name}
        </button>
      </li>
    )
  }

  return (
    <section aria-label="Treino" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-titulo text-base font-bold">Treino</h3>
        <p
          role="status"
          className={`font-dados text-meta ${props.status === 'error' ? 'text-alerta' : 'text-tinta-suave'}`}
        >
          {statusText}
        </p>
      </div>
      {props.status === 'error' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FormError>{props.error}</FormError>
          <button
            type="button"
            onClick={props.onRetry}
            className={secondaryButtonClass}
          >
            Tentar de novo
          </button>
        </div>
      )}

      {draft.length > 0 && (
        <ol aria-label="Exercícios do treino" className="flex flex-col gap-2">
          {draft.map((item) => {
            const name = nameOf(item.exerciseId)
            const menu = (
              <ActionMenu
                label={`Mais ações do exercício ${name}`}
                actions={[
                  {
                    label: 'Tirar do treino',
                    icon: <TrashIcon />,
                    onSelect: () => remove(item),
                  },
                ]}
                placement=""
              />
            )
            if (item.exerciseId !== currentId) {
              return (
                <li
                  key={item.exerciseId}
                  aria-label={name}
                  className="flex items-center gap-1 rounded-[14px] border border-linha bg-superficie pl-1"
                >
                  <button
                    type="button"
                    onClick={() => open(item.exerciseId)}
                    className={`flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left ${textButtonClass}`}
                  >
                    <span className="text-conteudo break-words">{name}</span>
                    <span className="font-dados text-meta text-tinta-suave">
                      {countSets(item.sets.length)}
                    </span>
                  </button>
                  {menu}
                </li>
              )
            }
            return (
              <li
                key={item.exerciseId}
                aria-label={name}
                className={`${cardClass} flex flex-col gap-3 pr-2`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="min-w-0 pt-2.5 font-titulo font-semibold break-words">
                    {name}
                  </h4>
                  {menu}
                </div>
                <ol aria-label={`Séries de ${name}`} className="flex flex-col">
                  {item.sets.map((set, index) => (
                    <li key={index}>
                      {editing?.index === index ? (
                        <form
                          onSubmit={saveEdit}
                          className="flex flex-col gap-2 py-2"
                        >
                          <SetFields
                            reps={editing.reps}
                            kg={editing.kg}
                            onReps={(text) =>
                              setEditing({ ...editing, reps: text })
                            }
                            onKg={(text) =>
                              setEditing({ ...editing, kg: text })
                            }
                          />
                          {editing.error && (
                            <FormError>{editing.error}</FormError>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="submit"
                              className={secondaryButtonClass}
                            >
                              Salvar
                            </button>
                            <button
                              type="button"
                              onClick={deleteSet}
                              className={secondaryButtonClass}
                            >
                              Apagar
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(null)}
                              className={secondaryButtonClass}
                            >
                              Cancelar
                            </button>
                          </div>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setEditing({
                              index,
                              reps: String(set.reps),
                              kg: kgText(set),
                              error: '',
                            })
                          }
                          className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-1 text-left font-dados tabular-nums hover:bg-tinta/[0.04] ${textButtonClass}`}
                        >
                          <span className="w-5 text-right text-meta text-tinta-suave">
                            {index + 1}
                          </span>
                          {formatSet(set)}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
                <form onSubmit={addSet} className="flex flex-col gap-2">
                  <SetFields
                    reps={reps}
                    kg={kg}
                    onReps={setReps}
                    onKg={setKg}
                  />
                  {fieldError && <FormError>{fieldError}</FormError>}
                  <div className="grid grid-cols-2 gap-2">
                    <button type="submit" className={secondaryButtonClass}>
                      Adicionar série
                    </button>
                    <button
                      type="button"
                      onClick={repeatSet}
                      disabled={item.sets.length === 0}
                      className={`${secondaryButtonClass} disabled:cursor-not-allowed`}
                    >
                      + série igual
                    </button>
                  </div>
                </form>
              </li>
            )
          })}
        </ol>
      )}

      <button
        type="button"
        onClick={() => {
          setPicking((open) => !open)
          setFilter('')
          setConfirming(null)
          setCreateError('')
        }}
        aria-expanded={picking}
        className={`w-full ${secondaryButtonClass}`}
      >
        <PlusIcon />
        Exercício
      </button>
      {picking && confirming !== null && (
        <div className="flex flex-col gap-3 rounded-[14px] border border-linha bg-superficie px-4 py-3.5">
          <p className="text-sm break-words">
            Criar o exercício "{confirming}"? O equipamento faz parte do nome
            (com barra, com halteres).
          </p>
          {createError && <FormError>{createError}</FormError>}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={create}
              disabled={creating}
              className={secondaryButtonClass}
            >
              Criar
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(null)
                setCreateError('')
              }}
              className={secondaryButtonClass}
            >
              Voltar
            </button>
          </div>
        </div>
      )}
      {picking && confirming === null && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-tinta-suave">Buscar exercício</span>
            <input
              type="text"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              maxLength={60}
              className={fieldClass}
            />
          </label>
          <div
            role="group"
            aria-label="Escolher exercício"
            className="flex flex-col gap-2"
          >
            {recent.length > 0 && (
              <>
                <p className="px-0.5 font-dados text-meta text-tinta-suave">
                  Recentes em {props.markerName}
                </p>
                <ul className="flex flex-col gap-2">
                  {recent.map(renderOption)}
                </ul>
              </>
            )}
            {others.length > 0 && (
              <>
                {recent.length > 0 && (
                  <p className="px-0.5 font-dados text-meta text-tinta-suave">
                    Outros
                  </p>
                )}
                <ul className="flex flex-col gap-2">
                  {others.map(renderOption)}
                </ul>
              </>
            )}
            {exact && blocked(exact) && (
              <p className="px-0.5 text-sm text-tinta-suave">
                {blocked(exact)}
              </p>
            )}
            {!exact && filter.trim() !== '' && (
              <button
                type="button"
                onClick={() => setConfirming(filter.trim())}
                className={`${pickerButtonClass} break-words`}
              >
                Criar "{filter.trim()}"
              </button>
            )}
            {filter.trim() === '' && available.length === 0 && (
              <p className="px-0.5 text-sm text-tinta-suave">
                Digite o nome para criar um exercício.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

export default WorkoutSection
