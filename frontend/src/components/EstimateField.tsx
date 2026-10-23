import { fieldClass } from '../styles'

// Minutos inteiros: "1:15" seria ambíguo (nas notas, "49:25" é min:seg).
// Texto com teclado numérico (por quê: numbers.ts); quem valida é o
// formulário, com parseMinutes. O texto fica com quem usa (pode ser '')
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
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className={fieldClass}
      />
    </label>
  )
}

export default EstimateField
