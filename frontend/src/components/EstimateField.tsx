import { fieldClass } from '../styles'

// Minutos inteiros: "1:15" seria ambíguo (nas notas, "49:25" é min:seg).
// Vazio = sem estimativa. O texto fica com quem usa (pode ser '')
function EstimateField(props: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-tinta-suave">
        Duração estimada (min, opcional)
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={1440}
        step={1}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className={fieldClass}
      />
    </label>
  )
}

export default EstimateField
