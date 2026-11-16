import { useId, useRef, useState } from 'react'
import { optionLabel, selectionSummary, SUMMARY_MAX_NAMES } from '../selections'
import { fieldClass, secondaryButtonClass } from '../styles'
import type { SelectionOption } from '../types'
import { ChevronDownIcon } from './icons'

// Seleção múltipla como menu: o gatilho fechado mostra o resumo do que está marcado e as
// caixinhas abrem no próprio fluxo (empurram o formulário; nada flutua). Só guarda se está
// aberto: a escolha vem de quem usa (`value`, a mesma lista que vai no envio), então fechar
// nunca perde nada e o resumo acompanha a sugestão que chega depois. Fecha pelo gatilho, pelo
// "Pronto" e pelo Escape (o foco volta ao gatilho); tocar fora ou tabular pra fora não fecha
function SelectionMenu(props: {
  name: string
  options: SelectionOption[]
  value: string[]
  onChange: (optionIds: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const summary = selectionSummary(props.options, props.value)
  const full = summary.count > SUMMARY_MAX_NAMES
  const labelId = `${id}-nome`
  const summaryId = `${id}-resumo`
  const fullId = `${id}-lista`
  const panelId = `${id}-painel`

  function close() {
    setOpen(false)
    trigger.current?.focus()
  }

  return (
    <div
      data-selection-menu
      className="flex flex-col gap-1.5"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
      }}
    >
      <span
        id={labelId}
        className="text-sm text-tinta-suave [overflow-wrap:anywhere]"
      >
        {props.name}
      </span>
      {/* A altura mínima de 44px do select de hoje; cresce se os nomes quebram */}
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-labelledby={`${labelId} ${full ? fullId : summaryId}`}
        onClick={() => setOpen(!open)}
        className={`${fieldClass.replace('h-11', 'min-h-11 py-2')} flex w-full items-center justify-between gap-2 text-left`}
      >
        <span id={summaryId} className="min-w-0 [overflow-wrap:anywhere]">
          {summary.text}
        </span>
        <span aria-hidden="true" className="shrink-0 text-tinta-suave">
          <ChevronDownIcon className={`h-5 w-5 ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {/* Com "N escolhidas" no gatilho, a lista completa fica no nome acessível */}
      {full && (
        <span id={fullId} className="sr-only">
          {summary.list}
        </span>
      )}
      {open && (
        <fieldset
          id={panelId}
          className="flex flex-col"
          // Enter numa caixinha enviaria o formulário (medido); aqui não
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              event.target instanceof HTMLInputElement
            ) {
              event.preventDefault()
            }
          }}
        >
          <legend className="sr-only">{props.name}</legend>
          {props.options.map((option) => (
            <label
              key={option.id}
              className="flex min-h-11 items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={props.value.includes(option.id)}
                onChange={(event) =>
                  props.onChange(
                    event.target.checked
                      ? [...props.value, option.id]
                      : props.value.filter(
                          (optionId) => optionId !== option.id,
                        ),
                  )
                }
                className="h-4 w-4 shrink-0"
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {optionLabel(option)}
              </span>
            </label>
          ))}
          <button
            type="button"
            onClick={close}
            className={`mt-1 w-full ${secondaryButtonClass}`}
          >
            Pronto
          </button>
        </fieldset>
      )}
    </div>
  )
}

export default SelectionMenu
