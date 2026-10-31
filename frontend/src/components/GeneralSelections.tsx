import { describeSelection } from '../selections'
import type { Selection } from '../types'

// Seleções globais, entre a árvore de tags e os exercícios
function GeneralSelections(props: { selections: Selection[] }) {
  return (
    <section aria-label="Seleções gerais" className="flex flex-col gap-2">
      <h3 className="mt-2 font-titulo text-base font-bold">Seleções gerais</h3>
      <p className="px-0.5 font-texto text-meta text-tinta-suave">
        Valem em todos os registros, com ou sem tag.
      </p>
      <ul className="flex flex-col gap-1 rounded-[14px] border border-linha bg-superficie px-3.5 py-3">
        {props.selections.map((selection) => (
          <li
            key={selection.id}
            className={`font-dados text-meta break-words ${selection.active ? '' : 'text-tinta-suave'}`}
          >
            {describeSelection(selection)}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default GeneralSelections
