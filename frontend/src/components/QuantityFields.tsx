import { useId } from 'react'
import { fieldClass } from '../styles'

// Quantidade + unidade lado a lado em QUALQUER largura: a grade não depende
// da janela (layout pela janela vaza dentro de cartão), e min-w-0 deixa os
// campos encolherem. Quantidade é texto com teclado decimal (por quê:
// numbers.ts); quem valida é o formulário, com parseQuantity
function QuantityFields(props: {
  quantity: string
  unit: string
  units: string[] // sugestões: as já usadas
  onQuantityChange: (value: string) => void
  onUnitChange: (value: string) => void
}) {
  const listId = useId()
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-3">
      <label className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">Quantidade</span>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={props.quantity}
          onChange={(event) => props.onQuantityChange(event.target.value)}
          className={fieldClass}
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">Unidade</span>
        <input
          type="text"
          list={listId}
          autoComplete="off"
          value={props.unit}
          onChange={(event) => props.onUnitChange(event.target.value)}
          className={fieldClass}
        />
        <datalist id={listId}>
          {props.units.map((unit) => (
            <option key={unit} value={unit} />
          ))}
        </datalist>
      </label>
    </div>
  )
}

export default QuantityFields
