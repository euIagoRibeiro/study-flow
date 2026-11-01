import type { ReactNode } from 'react'
import { describeSelection } from '../selections'
import { focusRing } from '../styles'
import type { Selection } from '../types'
import ActionMenu, { type MenuAction } from './ActionMenu'
import { PlusIcon } from './icons'

// Seleções globais, entre a árvore de tags e os exercícios. Sempre visível:
// é daqui que nasce a primeira global
function GeneralSelections(props: {
  selections: Selection[]
  actionsFor: (selection: Selection) => MenuAction[]
  // O formulário aberto no lugar da linha, se houver
  formFor: (selection: Selection) => ReactNode
  newForm: ReactNode
  onNew: () => void
}) {
  return (
    <section aria-label="Seleções gerais" className="flex flex-col gap-2">
      <h3 className="mt-2 font-titulo text-base font-bold">Seleções gerais</h3>
      <p className="px-0.5 font-texto text-meta text-tinta-suave">
        Valem em todos os registros, com ou sem tag.
      </p>
      {props.selections.length > 0 && (
        <ul className="flex flex-col rounded-[14px] border border-linha bg-superficie py-1.5 pl-3.5">
          {props.selections.map((selection) => (
            <li key={selection.id}>
              {props.formFor(selection) ?? (
                <div className="flex min-h-11 items-center gap-2">
                  <p
                    className={`min-w-0 flex-1 font-dados text-meta break-words ${selection.active ? '' : 'text-tinta-suave'}`}
                  >
                    {describeSelection(selection)}
                  </p>
                  <ActionMenu
                    label={`Mais ações da seleção ${selection.name}`}
                    actions={props.actionsFor(selection)}
                    placement=""
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {props.newForm ? (
        <div className="rounded-[14px] border border-linha bg-superficie py-1.5 pl-3.5">
          {props.newForm}
        </div>
      ) : (
        <button
          type="button"
          onClick={props.onNew}
          className={`flex h-13 w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-tinta-suave/55 font-semibold text-tinta-suave hover:bg-tinta/[0.07] hover:text-tinta ${focusRing}`}
        >
          <PlusIcon />
          Nova seleção geral
        </button>
      )}
    </section>
  )
}

export default GeneralSelections
