import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { ApiError } from '../api/client'
import {
  chipClass,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../styles'
import { compareNames } from '../tags'
import type { Measure, MeasureActions, MeasureKind, Tag } from '../types'
import ActionMenu, { type MenuAction } from './ActionMenu'
import FormError from './FormError'
import {
  ArchiveIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  UnarchiveIcon,
} from './icons'

// Mensagem do servidor quando ele explica (400/409); senão, genérica
function message(err: unknown) {
  return err instanceof ApiError && (err.status === 400 || err.status === 409)
    ? err.message
    : 'Não foi possível salvar. Tente de novo.'
}

// Definir (criar com os tipos, num POST só) ou editar a medida de uma tag.
// Editando: nome/singular/decimal vão no Salvar; cada tipo tem ação
// imediata (como na tela de tags), sem lote salvo pela metade. Sempre
// empilhado: mora dentro do cartão da árvore
function MeasureForm(props: {
  tag: Tag
  measure: Measure | undefined
  note: string // a herança, em uma linha
  used: boolean // a medida já foi usada em algum registro
  usedKinds: Set<string>
  actions: MeasureActions
  onClose: () => void
}) {
  const { measure, actions } = props
  const [name, setName] = useState(measure?.name ?? '')
  const [singular, setSingular] = useState(measure?.singular ?? '')
  const [allowsDecimal, setAllowsDecimal] = useState(
    measure?.allowsDecimal ?? false,
  )
  // Criando: os tipos vão junto no POST
  const [draftKinds, setDraftKinds] = useState<string[]>([])
  const [newKind, setNewKind] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await action()
      return true
    } catch (err) {
      setError(message(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (name.trim() === '' || singular.trim() === '') {
      setError('Escreva o nome no plural e no singular.')
      return
    }
    const fields = {
      name: name.trim(),
      singular: singular.trim(),
      allowsDecimal,
    }
    const saved = measure
      ? await run(() => actions.update(measure.id, fields))
      : await run(() =>
          actions.create(
            props.tag.id,
            fields,
            draftKinds.map((kind) => kind.trim()).filter((kind) => kind !== ''),
          ),
        )
    if (saved) props.onClose()
  }

  // Enter num campo de tipo faz a ação dele, não o Salvar da medida
  function onEnter(action: () => void) {
    return (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      action()
    }
  }

  async function renameKind(kindId: string) {
    if (!measure || !renaming || renaming.name.trim() === '') return
    if (
      await run(() =>
        actions.updateKind(measure.id, kindId, { name: renaming.name.trim() }),
      )
    ) {
      setRenaming(null)
    }
  }

  async function addKind() {
    if (!measure || newKind.trim() === '') return
    if (await run(() => actions.createKind(measure.id, newKind.trim()))) {
      setNewKind('')
    }
  }

  function kindActions(kind: MeasureKind): MenuAction[] {
    if (!measure) return []
    const used = props.usedKinds.has(kind.id)
    return [
      {
        label: 'Renomear',
        icon: <PencilIcon />,
        onSelect: () => setRenaming({ id: kind.id, name: kind.name }),
      },
      kind.active
        ? {
            label: 'Arquivar',
            icon: <ArchiveIcon />,
            onSelect: () =>
              run(() =>
                actions.updateKind(measure.id, kind.id, { active: false }),
              ),
          }
        : {
            label: 'Reativar',
            icon: <UnarchiveIcon />,
            onSelect: () =>
              run(() =>
                actions.updateKind(measure.id, kind.id, { active: true }),
              ),
          },
      {
        label: 'Apagar',
        icon: <TrashIcon />,
        onSelect: () => run(() => actions.removeKind(measure.id, kind.id)),
        disabled: used,
        hint: used
          ? 'Em uso em registros. Arquive em vez de apagar.'
          : undefined,
      },
    ]
  }

  const kinds = [...(measure?.kinds ?? [])].sort((a, b) =>
    compareNames(a.name, b.name),
  )

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={`Medida de ${props.tag.name}`}
      className="flex flex-col gap-3 py-2 pr-2"
    >
      <p className="font-texto text-meta text-tinta-suave">{props.note}</p>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">O que se mede (plural)</span>
        <input
          type="text"
          value={name}
          maxLength={30}
          placeholder="exercícios"
          onChange={(event) => setName(event.target.value)}
          autoFocus
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">No singular</span>
        <input
          type="text"
          value={singular}
          maxLength={30}
          placeholder="exercício"
          onChange={(event) => setSingular(event.target.value)}
          className={fieldClass}
        />
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allowsDecimal}
          onChange={(event) => setAllowsDecimal(event.target.checked)}
          className="h-4 w-4"
        />
        Aceita decimal (ex.: 5,5 km)
      </label>

      {/* min-w-0: fieldset tem largura mínima = conteúdo por padrão do
          navegador, e vazava do cartão em 320–375px (medido) */}
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1.5 text-sm text-tinta-suave">
          Tipos (opcional)
        </legend>
        {measure
          ? kinds.map((kind) =>
              renaming?.id === kind.id ? (
                <div key={kind.id} className="flex gap-2">
                  <input
                    type="text"
                    aria-label={`Novo nome de ${kind.name}`}
                    value={renaming.name}
                    maxLength={30}
                    onChange={(event) =>
                      setRenaming({ id: kind.id, name: event.target.value })
                    }
                    onKeyDown={onEnter(() => renameKind(kind.id))}
                    autoFocus
                    className={`min-w-0 flex-1 ${fieldClass}`}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => renameKind(kind.id)}
                    className={secondaryButtonClass}
                  >
                    OK
                  </button>
                </div>
              ) : (
                <div
                  key={kind.id}
                  className="flex min-h-11 items-center gap-2 pl-1"
                >
                  <span
                    className={`min-w-0 flex-1 break-words text-sm ${kind.active ? '' : 'text-tinta-suave'}`}
                  >
                    {kind.name}
                  </span>
                  {!kind.active && <span className={chipClass}>Arquivado</span>}
                  <ActionMenu
                    label={`Mais ações do tipo ${kind.name}`}
                    actions={kindActions(kind)}
                    placement=""
                  />
                </div>
              ),
            )
          : draftKinds.map((kind, index) => (
              <div key={index} className="flex gap-2">
                <input
                  type="text"
                  aria-label={`Tipo ${index + 1}`}
                  value={kind}
                  maxLength={30}
                  onChange={(event) =>
                    setDraftKinds((current) =>
                      current.map((k, i) =>
                        i === index ? event.target.value : k,
                      ),
                    )
                  }
                  className={`min-w-0 flex-1 ${fieldClass}`}
                />
                <button
                  type="button"
                  aria-label={`Tirar o tipo ${index + 1}`}
                  onClick={() =>
                    setDraftKinds((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                  className={secondaryButtonClass}
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
        {measure ? (
          <div className="flex gap-2">
            <input
              type="text"
              aria-label="Tipo novo"
              placeholder="tipo novo"
              value={newKind}
              maxLength={30}
              onChange={(event) => setNewKind(event.target.value)}
              onKeyDown={onEnter(addKind)}
              className={`min-w-0 flex-1 ${fieldClass}`}
            />
            <button
              type="button"
              disabled={busy}
              onClick={addKind}
              className={secondaryButtonClass}
            >
              <PlusIcon />
              Adicionar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDraftKinds((current) => [...current, ''])}
            className={`self-start ${secondaryButtonClass}`}
          >
            <PlusIcon />
            Tipo
          </button>
        )}
      </fieldset>

      {error && <FormError>{error}</FormError>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={props.onClose}
          className={`flex-1 ${secondaryButtonClass}`}
        >
          {measure ? 'Fechar' : 'Cancelar'}
        </button>
        <button
          type="submit"
          disabled={busy}
          className={`flex-1 ${primaryButtonClass}`}
        >
          Salvar
        </button>
      </div>

      {measure && (
        <div className="flex flex-col gap-2 border-t border-dashed border-linha pt-3">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(() => actions.update(measure.id, { active: !measure.active }))
            }
            className={secondaryButtonClass}
          >
            {measure.active ? 'Arquivar medida' : 'Reativar medida'}
          </button>
          {props.used ? (
            <p className="font-texto text-meta text-tinta-suave">
              Em uso em registros: arquive em vez de apagar.
            </p>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (
                  window.confirm(
                    `Apagar a medida "${measure.name}" de ${props.tag.name}? Não dá pra desfazer.`,
                  ) &&
                  (await run(() => actions.remove(measure.id)))
                ) {
                  props.onClose()
                }
              }}
              className={secondaryButtonClass}
            >
              <TrashIcon />
              Apagar medida
            </button>
          )}
        </div>
      )}
    </form>
  )
}

export default MeasureForm
