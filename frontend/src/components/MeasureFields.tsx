import { fieldClass } from '../styles'
import { compareNames } from '../tags'
import type { MeasureTexts } from '../measures'
import type { Measure } from '../types'

// Os campos da medida do caminho: um por tipo (grade de 2 colunas, que não
// depende da janela: mora dentro de cartão) ou um só, sem tipos. Texto com
// teclado numérico/decimal (por quê: numbers.ts); quem valida é o
// formulário. Nada vem pré-preenchido além do que o próprio registro tem
function MeasureFields(props: {
  measure: Measure | null
  texts: MeasureTexts
  onChange: (key: string, text: string) => void
  // Tipos arquivados que o registro já tem: continuam aparecendo
  keptKindIds?: Set<string>
  // Registro com medida anterior (a subtag ganhou medida própria depois)
  oldValues?: string
}) {
  const { measure } = props
  const inputMode = measure?.allowsDecimal ? 'decimal' : 'numeric'
  const kinds = (measure?.kinds ?? [])
    .filter((kind) => kind.active || props.keptKindIds?.has(kind.id))
    .sort((a, b) => compareNames(a.name, b.name))
  const title = measure
    ? `${measure.name.charAt(0).toUpperCase()}${measure.name.slice(1)}`
    : ''

  return (
    <>
      {props.oldValues && (
        <p className="font-texto text-meta text-tinta-suave">
          Registrado com a medida anterior: {props.oldValues}.
        </p>
      )}
      {measure &&
        (kinds.length > 0 ? (
          // min-w-0: fieldset não encolhe sozinho (lição da M4)
          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="mb-1.5 text-sm text-tinta-suave">
              {title} (opcional)
            </legend>
            {/* Um embaixo do outro no celular (pedido do uso real: a grade
                2×2 quebrava os rótulos); no computador, a 2×2 de sempre. Pela
                janela, de propósito: no computador, até o cartão mais estreito
                (lápis no cartão da Lista) cabe a 2×2 (medido de 640 a 1280) */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {kinds.map((kind) => (
                <label key={kind.id} className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-sm break-words text-tinta-suave">
                    {kind.active ? kind.name : `${kind.name} (arquivado)`}
                  </span>
                  <input
                    type="text"
                    inputMode={inputMode}
                    autoComplete="off"
                    value={props.texts[kind.id] ?? ''}
                    onChange={(event) =>
                      props.onChange(kind.id, event.target.value)
                    }
                    className={`w-full min-w-0 ${fieldClass}`}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-tinta-suave">{title} (opcional)</span>
            <input
              type="text"
              inputMode={inputMode}
              autoComplete="off"
              value={props.texts[''] ?? ''}
              onChange={(event) => props.onChange('', event.target.value)}
              className={fieldClass}
            />
          </label>
        ))}
    </>
  )
}

// Antes de salvar: o que vai sumir. Não é erro (alerta só em erro): fundo
// neutro, como o aviso de Desfazer
export function MeasureWarning(props: { text: string | undefined }) {
  if (!props.text) return null
  return (
    <p
      role="status"
      className="rounded-xl bg-tinta/[0.07] px-3 py-2.5 font-texto text-sm"
    >
      {props.text}
    </p>
  )
}

export default MeasureFields
