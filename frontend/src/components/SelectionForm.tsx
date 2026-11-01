import { useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  findRepeated,
  LAST_ACTIVE_OPTION,
  MAX_ACTIVE_OPTIONS,
  selectionError,
  TOO_MANY_OPTIONS,
} from '../selections'
import {
  chipClass,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../styles'
import type {
  Selection,
  SelectionActions,
  SelectionOption,
  Tag,
} from '../types'
import ActionMenu, { type MenuAction } from './ActionMenu'
import FormError from './FormError'
import {
  ArchiveIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  UnarchiveIcon,
} from './icons'

function registros(count: number) {
  return count === 1 ? '1 registro' : `${count} registros`
}

// Criar (seleção e opções num POST só) ou editar. Editando, são dois blocos:
// nome e "várias" vão no Salvar; cada opção tem ação imediata, e a lista vem
// das props, então mexer numa opção não toca no nome digitado. Sempre
// empilhado: mora dentro do cartão da árvore
function SelectionForm(props: {
  tag: Tag | null
  selection?: Selection
  note: string
  optionUses: Map<string, number>
  actions: SelectionActions
  initialError?: string
  onClose: () => void
}) {
  const { selection, actions } = props
  const [name, setName] = useState(selection?.name ?? '')
  const [multiple, setMultiple] = useState(selection?.multiple ?? false)
  const [draftOptions, setDraftOptions] = useState([''])
  const [newOption, setNewOption] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  )
  const [saveError, setSaveError] = useState(props.initialError ?? '')
  const [optionError, setOptionError] = useState('')
  const [busy, setBusy] = useState(false)

  const options = [...(selection?.options ?? [])].sort(
    (a, b) => a.position - b.position,
  )
  const activeCount = options.filter((option) => option.active).length
  const full = activeCount >= MAX_ACTIVE_OPTIONS
  const changes = selection && {
    ...(name.trim() !== selection.name ? { name: name.trim() } : {}),
    ...(multiple !== selection.multiple ? { multiple } : {}),
  }
  const unsaved = changes !== undefined && Object.keys(changes).length > 0

  async function run(
    action: () => Promise<unknown>,
    showError: (text: string) => void,
  ) {
    setBusy(true)
    setSaveError('')
    setOptionError('')
    try {
      await action()
      return true
    } catch (err) {
      showError(selectionError(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (name.trim() === '') {
      setSaveError('Escreva o nome da seleção.')
      return
    }
    if (selection) {
      if (!unsaved) return props.onClose()
      const saved = await run(
        () => actions.update(selection.id, changes),
        setSaveError,
      )
      if (saved) props.onClose()
      return
    }
    const filled = draftOptions
      .map((option) => option.trim())
      .filter((option) => option !== '')
    if (filled.length === 0) {
      setSaveError('Escreva pelo menos uma opção.')
      return
    }
    const repeated = findRepeated(filled)
    if (repeated) {
      setSaveError(`Opção repetida: ${repeated}.`)
      return
    }
    const created = await run(
      () =>
        actions.create(
          props.tag?.id ?? null,
          { name: name.trim(), multiple },
          filled,
        ),
      setSaveError,
    )
    if (created) props.onClose()
  }

  // Enter num campo de opção faz a ação dele, não o Salvar da seleção
  function onEnter(action: () => void) {
    return (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      action()
    }
  }

  function addDraft() {
    if (draftOptions.length < MAX_ACTIVE_OPTIONS) {
      setDraftOptions((current) => [...current, ''])
    }
  }

  async function addOption() {
    if (!selection || newOption.trim() === '') return
    const added = await run(
      () => actions.createOption(selection.id, newOption.trim()),
      setOptionError,
    )
    if (added) setNewOption('')
  }

  async function renameOption(optionId: string) {
    if (!selection || !renaming) return
    if (renaming.name.trim() === '') {
      setOptionError('Escreva o nome da opção.')
      return
    }
    const renamed = await run(
      () =>
        actions.updateOption(selection.id, optionId, {
          name: renaming.name.trim(),
        }),
      setOptionError,
    )
    if (renamed) setRenaming(null)
  }

  function optionActions(option: SelectionOption): MenuAction[] {
    if (!selection) return []
    const uses = props.optionUses.get(option.id) ?? 0
    const last = option.active && activeCount === 1
    return [
      {
        label: 'Renomear',
        icon: <PencilIcon />,
        onSelect: () => setRenaming({ id: option.id, name: option.name }),
      },
      option.active
        ? {
            label: 'Arquivar',
            icon: <ArchiveIcon />,
            onSelect: () =>
              run(
                () =>
                  actions.updateOption(selection.id, option.id, {
                    active: false,
                  }),
                setOptionError,
              ),
            disabled: last,
            hint: last ? LAST_ACTIVE_OPTION : undefined,
          }
        : {
            label: 'Reativar',
            icon: <UnarchiveIcon />,
            onSelect: () =>
              run(
                () =>
                  actions.updateOption(selection.id, option.id, {
                    active: true,
                  }),
                setOptionError,
              ),
            disabled: full,
            hint: full ? TOO_MANY_OPTIONS : undefined,
          },
      {
        label: 'Apagar',
        icon: <TrashIcon />,
        onSelect: () =>
          run(
            () => actions.removeOption(selection.id, option.id),
            setOptionError,
          ),
        disabled: uses > 0 || last,
        hint:
          uses > 0
            ? `Em uso em ${registros(uses)}. Arquive em vez de apagar.`
            : last
              ? LAST_ACTIVE_OPTION
              : undefined,
      },
    ]
  }

  const label = selection
    ? `Seleção ${selection.name}`
    : props.tag
      ? `Nova seleção em ${props.tag.name}`
      : 'Nova seleção geral'

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={label}
      className="flex flex-col gap-3 py-2 pr-2"
    >
      <p className="font-texto text-meta text-tinta-suave">{props.note}</p>
      {selection && (
        <p className="text-sm font-semibold">Grava ao tocar em Salvar</p>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">Nome da seleção</span>
        <input
          type="text"
          value={name}
          maxLength={30}
          placeholder="Meio"
          onChange={(event) => setName(event.target.value)}
          autoFocus
          className={fieldClass}
        />
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={multiple}
          onChange={(event) => setMultiple(event.target.checked)}
          className="h-4 w-4"
        />
        Permite escolher várias
      </label>

      {!selection && (
        // min-w-0: fieldset tem largura mínima = conteúdo (ver MeasureForm)
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1.5 text-sm text-tinta-suave">Opções</legend>
          {draftOptions.map((option, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="text"
                aria-label={`Opção ${index + 1}`}
                value={option}
                maxLength={30}
                onChange={(event) =>
                  setDraftOptions((current) =>
                    current.map((o, i) =>
                      i === index ? event.target.value : o,
                    ),
                  )
                }
                onKeyDown={onEnter(addDraft)}
                // Só o campo recém-acrescentado monta depois da abertura
                autoFocus={index > 0}
                className={`min-w-0 flex-1 ${fieldClass}`}
              />
              {draftOptions.length > 1 && (
                <button
                  type="button"
                  aria-label={`Tirar a opção ${index + 1}`}
                  onClick={() =>
                    setDraftOptions((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                  className={secondaryButtonClass}
                >
                  <TrashIcon />
                </button>
              )}
            </div>
          ))}
          {draftOptions.length < MAX_ACTIVE_OPTIONS ? (
            <button
              type="button"
              onClick={addDraft}
              className={`self-start ${secondaryButtonClass}`}
            >
              <PlusIcon />
              Opção
            </button>
          ) : (
            <p className="font-texto text-meta text-tinta-suave">
              {MAX_ACTIVE_OPTIONS} opções, o limite.
            </p>
          )}
        </fieldset>
      )}

      {saveError && <FormError>{saveError}</FormError>}
      {unsaved && <p className="text-sm text-tinta-suave">Não salvo</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={props.onClose}
          className={`flex-1 ${secondaryButtonClass}`}
        >
          {selection ? 'Fechar' : 'Cancelar'}
        </button>
        <button
          type="submit"
          disabled={busy}
          className={`flex-1 ${primaryButtonClass}`}
        >
          {selection ? 'Salvar' : 'Criar'}
        </button>
      </div>

      {selection && (
        <fieldset className="flex min-w-0 flex-col gap-2 border-t border-dashed border-linha pt-3">
          <legend className="sr-only">Opções</legend>
          <p className="text-sm font-semibold">Cada mudança grava na hora</p>
          {options.map((option) =>
            renaming?.id === option.id ? (
              <div key={option.id} className="flex gap-2">
                <input
                  type="text"
                  aria-label={`Novo nome de ${option.name}`}
                  value={renaming.name}
                  maxLength={30}
                  onChange={(event) =>
                    setRenaming({ id: option.id, name: event.target.value })
                  }
                  onKeyDown={onEnter(() => renameOption(option.id))}
                  autoFocus
                  className={`min-w-0 flex-1 ${fieldClass}`}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => renameOption(option.id)}
                  className={secondaryButtonClass}
                >
                  OK
                </button>
              </div>
            ) : (
              <div
                key={option.id}
                className="flex min-h-11 items-center gap-2 pl-1"
              >
                <span
                  className={`min-w-0 flex-1 break-words text-sm ${option.active ? '' : 'text-tinta-suave'}`}
                >
                  {option.name}
                </span>
                {!option.active && <span className={chipClass}>Arquivada</span>}
                <ActionMenu
                  label={`Mais ações da opção ${option.name}`}
                  actions={optionActions(option)}
                  placement=""
                />
              </div>
            ),
          )}
          {full ? (
            <p className="font-texto text-meta text-tinta-suave">
              {TOO_MANY_OPTIONS}
            </p>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                aria-label="Opção nova"
                placeholder="opção nova"
                value={newOption}
                maxLength={30}
                onChange={(event) => setNewOption(event.target.value)}
                onKeyDown={onEnter(addOption)}
                className={`min-w-0 flex-1 ${fieldClass}`}
              />
              <button
                type="button"
                disabled={busy}
                onClick={addOption}
                className={secondaryButtonClass}
              >
                <PlusIcon />
                Adicionar
              </button>
            </div>
          )}
          {optionError && <FormError>{optionError}</FormError>}
        </fieldset>
      )}
    </form>
  )
}

export default SelectionForm
