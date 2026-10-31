import type { Selection } from './types'

// "Meio (digital, tradicional) · várias · arquivada": só as opções ativas
export function describeSelection(selection: Selection): string {
  const options = selection.options
    .filter((option) => option.active)
    .map((option) => option.name)
    .join(', ')
  return [
    options ? `${selection.name} (${options})` : selection.name,
    ...(selection.multiple ? ['várias'] : []),
    ...(selection.active ? [] : ['arquivada']),
  ].join(' · ')
}
