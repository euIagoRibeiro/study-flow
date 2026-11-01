import { fieldClass } from '../styles'
import type { Selection } from '../types'

// Um grupo de seleções do formulário. Quem decide quais aparecem, e onde, é o
// formulário; o valor vem do useSelectionChoices. Sempre empilhado: mora
// dentro de cartões estreitos
function SelectionChoices(props: {
  selections: Selection[]
  valueOf: (selection: Selection) => string[]
  onChange: (selectionId: string, optionIds: string[]) => void
}) {
  if (props.selections.length === 0) return null
  return (
    <div data-selection-block className="flex flex-col gap-3">
      {props.selections.map((selection) => {
        const value = props.valueOf(selection)
        const options = selection.options
          .filter((option) => option.active)
          .sort((a, b) => a.position - b.position)
        return selection.multiple ? (
          // min-w-0: fieldset tem largura mínima = conteúdo (ver MeasureForm)
          <fieldset key={selection.id} className="flex min-w-0 flex-col">
            <legend className="mb-1.5 text-sm text-tinta-suave">
              {selection.name}
            </legend>
            {options.map((option) => (
              <label
                key={option.id}
                className="flex min-h-11 items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={value.includes(option.id)}
                  onChange={(event) =>
                    props.onChange(
                      selection.id,
                      event.target.checked
                        ? [...value, option.id]
                        : value.filter((id) => id !== option.id),
                    )
                  }
                  className="h-4 w-4 shrink-0"
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {option.name}
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <label key={selection.id} className="flex flex-col gap-1.5">
            <span className="text-sm text-tinta-suave">{selection.name}</span>
            <select
              value={value[0] ?? ''}
              onChange={(event) =>
                props.onChange(
                  selection.id,
                  event.target.value ? [event.target.value] : [],
                )
              }
              className={fieldClass}
            >
              <option value="">Nenhuma</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        )
      })}
    </div>
  )
}

export default SelectionChoices
