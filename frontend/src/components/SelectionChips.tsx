import { selectionChips } from '../selections'
import { tagChipClass } from '../styles'
import type { TagIndex } from '../tags'
import type { ExecutionSelection, Selection } from '../types'

// As escolhas de um registro: um chip por seleção, com todas as opções. Lista
// própria, fora da de tags: a seleção global vale em registro sem tag
function SelectionChips(props: {
  recorded: ExecutionSelection[]
  selections: Selection[]
  tagsById: TagIndex
}) {
  const chips = selectionChips(props.recorded, props.selections, props.tagsById)
  if (chips.length === 0) return null
  return (
    <ul
      data-selection-chips
      aria-label="Seleções"
      className="flex flex-wrap gap-1.5 py-0.5"
    >
      {chips.map((chip) => (
        <li key={chip.id} className={tagChipClass}>
          <span className="wrap-anywhere">{`${chip.name}: `}</span>
          <span className="font-semibold wrap-anywhere text-tinta">
            {chip.options.join(', ')}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default SelectionChips
