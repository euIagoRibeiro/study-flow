import { frequencyLabels } from '../frequency'
import type { Frequency } from '../types'
import { ChevronDownIcon } from './icons'

export type FrequencyFilter = Frequency | 'all'

// Filtro compacto "Frequência: Todas ▾" (Histórico e Lista)
function FrequencySelect(props: {
  value: FrequencyFilter
  onChange: (value: FrequencyFilter) => void
}) {
  const filtering = props.value !== 'all'
  return (
    <div className="flex h-9 items-center gap-2 font-dados text-meta text-tinta-suave">
      <span>Frequência</span>
      {/* O que se vê é o texto; o <select> fica invisível por cima, pra
          largura seguir o valor escolhido (o nativo mede pela opção
          mais longa) sem perder o seletor nativo do celular */}
      <span
        className={`relative inline-flex h-7 items-center gap-1 border-b-2 px-0.5 font-interface text-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-tinta ${
          filtering
            ? 'border-tinta font-semibold text-tinta'
            : 'border-transparent font-medium hover:text-tinta'
        }`}
      >
        {props.value === 'all' ? 'Todas' : frequencyLabels[props.value]}
        <ChevronDownIcon className="h-3.5 w-3.5" />
        <select
          aria-label="Frequência"
          value={props.value}
          onChange={(event) =>
            props.onChange(event.target.value as FrequencyFilter)
          }
          // 16px: abaixo disso o Safari do iPhone dá zoom ao tocar.
          // Toque de 44px sobre um texto de 28px (absolute conta a
          // partir de dentro da borda: 26 + 8 + 10). Cores explícitas
          // mesmo invisível: a lista de opções que abre usa as do
          // <select>, e o reset do Tailwind deixa o fundo transparente
          className="absolute inset-x-0 -top-2 -bottom-2.5 cursor-pointer bg-superficie text-base font-normal text-tinta opacity-0"
        >
          <option value="all">Todas</option>
          {Object.entries(frequencyLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </span>
    </div>
  )
}

export default FrequencySelect
