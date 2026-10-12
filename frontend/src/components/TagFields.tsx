import { Link } from 'react-router'
import { useId } from 'react'
import { fieldClass, focusRing } from '../styles'
import { compareNames, indexTags } from '../tags'
import type { Tag } from '../types'

// Um caminho só por registro: um campo por nível (contexto › subtag ›
// subtag). O 2º e o 3º só aparecem quando há o que escolher; trocar um
// campo limpa os de baixo. Controlado: quem guarda o caminho é o formulário
function TagFields(props: {
  tags: Tag[]
  value: string[]
  onChange: (path: string[]) => void
  // Arquivadas que já estavam no registro: continuam escolhíveis aqui
  keep?: string[]
}) {
  const titleId = useId()
  const byId = indexTags(props.tags)
  const available = (tag: Tag) => tag.active || props.keep?.includes(tag.id)
  const childrenOf = (parentId: string | null) =>
    props.tags
      .filter((tag) => tag.parentId === parentId && available(tag))
      .sort((a, b) => compareNames(a.name, b.name))

  const roots = childrenOf(null)
  // Nenhuma tag pra escolher: o formulário fica como era antes das tags
  if (roots.length === 0) return null

  const chosen = props.value.map((id) => byId.get(id))
  const [root, middle] = chosen
  const levels = [
    { label: 'Contexto', none: 'Sem tag', options: roots },
    root && {
      label: `Em ${root.name}`,
      none: 'Nenhuma',
      options: childrenOf(root.id),
    },
    root &&
      middle && {
        label: `Em ${root.name} › ${middle.name}`,
        none: 'Nenhuma',
        options: childrenOf(middle.id),
      },
  ]

  function choose(level: number, id: string) {
    const next = props.value.slice(0, level)
    if (id) next.push(id)
    props.onChange(next)
  }

  return (
    <div role="group" aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span id={titleId} className="text-sm text-tinta-suave">
          Tags (opcional)
        </span>
        <Link
          to="/tags"
          className={`text-meta text-tinta-suave underline decoration-dotted underline-offset-2 hover:text-tinta ${focusRing}`}
        >
          gerenciar tags
        </Link>
      </div>
      {levels.map(
        (level, index) =>
          level &&
          level.options.length > 0 && (
            <label key={level.label} className="flex flex-col gap-1.5">
              <span className="text-sm text-tinta-suave">{level.label}</span>
              <select
                value={props.value[index] ?? ''}
                onChange={(event) => choose(index, event.target.value)}
                className={fieldClass}
              >
                <option value="">{level.none}</option>
                {level.options.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.active ? tag.name : `${tag.name} (arquivada)`}
                  </option>
                ))}
              </select>
            </label>
          ),
      )}
    </div>
  )
}

export default TagFields
