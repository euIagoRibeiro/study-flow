import { ApiError } from './api/client'
import { compareNames } from './tags'
import type { Selection, Tag } from './types'

export const MAX_ACTIVE_OPTIONS = 30
export const TOO_MANY_OPTIONS = `Esta seleção já tem ${MAX_ACTIVE_OPTIONS} opções ativas, o limite. Arquive ou apague uma antes de incluir outra.`
export const LAST_ACTIVE_OPTION =
  'A seleção precisa de pelo menos uma opção ativa. Para parar de usá-la, arquive a seleção.'

// A ordem dos campos nos formulários de registro: mudar é mexer só aqui
export const FORM_FIELD_ORDER = [
  'tags',
  'fase',
  'selecoes-caminho',
  'selecoes-gerais',
  'medida',
] as const

export type FormField = (typeof FORM_FIELD_ORDER)[number]

// Escolhas por seleção; lista vazia = "Nenhuma" escolhida de propósito
export type SelectionChoiceMap = Record<string, string[]>

// `keep`: as que o registro já tem valem mesmo arquivadas
const canChoose = (selection: Selection, keep: string[]) =>
  keep.includes(selection.id) ||
  (selection.active && selection.options.some((option) => option.active))

// As declaradas no caminho, da raiz para a folha: a herança soma
export function pathSelections(
  path: string[],
  selections: Selection[],
  keep: string[] = [],
) {
  return path.flatMap((tagId) =>
    selections
      .filter(
        (selection) => selection.tagId === tagId && canChoose(selection, keep),
      )
      .sort((a, b) => compareNames(a.name, b.name)),
  )
}

export function generalSelections(
  selections: Selection[],
  keep: string[] = [],
) {
  return selections
    .filter(
      (selection) => selection.tagId === null && canChoose(selection, keep),
    )
    .sort((a, b) => compareNames(a.name, b.name))
}

// O que volta de um rascunho: opção que saiu não conta (as de `keep`, que o
// registro já tem, contam mesmo arquivadas), e a seleção que perdeu a escolha
// toda deixa de estar tocada (a sugestão volta a valer). "Nenhuma" continua
// tocada
export function keepActiveChoices(
  choices: SelectionChoiceMap,
  selections: Selection[],
  keep: string[] = [],
): SelectionChoiceMap {
  return Object.fromEntries(
    Object.entries(choices).flatMap(([selectionId, optionIds]) => {
      const selection = selections.find((s) => s.id === selectionId)
      if (!selection) return []
      const kept = optionIds.filter((id) =>
        selection.options.some(
          (option) => option.id === id && (option.active || keep.includes(id)),
        ),
      )
      return optionIds.length > 0 && kept.length === 0
        ? []
        : [[selectionId, kept]]
    }),
  )
}

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

// Mensagem do servidor quando ele explica (400/409); senão, genérica
export function selectionError(err: unknown) {
  return err instanceof ApiError && (err.status === 400 || err.status === 409)
    ? err.message
    : 'Não foi possível salvar. Tente de novo.'
}

// A opção repetida como foi escrita, com a mesma comparação do banco
export function findRepeated(names: string[]): string | undefined {
  const seen = new Set<string>()
  for (const name of names) {
    const key = name.trim().toLowerCase()
    if (seen.has(key)) return name.trim()
    seen.add(key)
  }
  return undefined
}

// A herança em uma linha. "Soma com": as declaradas no caminho até aqui;
// ownId tira a própria, ao editar
export function selectionNote(
  tag: Tag | null,
  selections: Selection[],
  byId: Map<string, Tag>,
  ownId?: string,
): string {
  const others = selections
    .filter((selection) => selection.active && selection.id !== ownId)
    .sort((a, b) => compareNames(a.name, b.name))
  const general = others
    .filter((selection) => selection.tagId === null)
    .map((selection) => `${selection.name} (geral)`)
  const alsoHere = general.length
    ? ` Também valem aqui: ${general.join(', ')}.`
    : ''
  if (!tag) return `Vale em todos os registros, com ou sem tag.${alsoHere}`

  const path = new Set<string>()
  for (
    let current: Tag | undefined = tag;
    current;
    current = current.parentId ? byId.get(current.parentId) : undefined
  ) {
    path.add(current.id)
  }
  const sums = others.flatMap((selection) =>
    selection.tagId && path.has(selection.tagId)
      ? [`${selection.name} (${byId.get(selection.tagId)?.name})`]
      : [],
  )
  const scope = tag.level < 3 ? `${tag.name} e as subtags` : tag.name
  const sumsWith = sums.length ? ` Soma com: ${sums.join(', ')}.` : ''
  return `Vale para ${scope}.${sumsWith}${alsoHere}`
}
