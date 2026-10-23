import { fieldClass } from '../styles'
import { phaseLabels, phases } from '../phases'
import type { Phase } from '../types'

// Mesmo campo dos níveis de tag, logo abaixo deles. Quem decide se aparece
// (phaseApplies) e o que vem pré-selecionado é o formulário
function PhaseField(props: {
  value: Phase | null
  onChange: (phase: Phase | null) => void
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-tinta-suave">Fase</span>
      <select
        value={props.value ?? ''}
        onChange={(event) =>
          props.onChange((event.target.value || null) as Phase | null)
        }
        className={fieldClass}
      >
        <option value="">Sem fase</option>
        {phases.map((phase) => (
          <option key={phase} value={phase}>
            {phaseLabels[phase]}
          </option>
        ))}
      </select>
    </label>
  )
}

export default PhaseField
