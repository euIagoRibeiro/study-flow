import { useState } from 'react'
import { suggestSelections } from './api/selections'
import {
  generalSelections,
  keepActiveChoices,
  pathSelections,
  type SelectionChoiceMap,
} from './selections'
import type { Selection } from './types'
import { useFetched } from './useFetched'

// Estado das escolhas de seleção num formulário. `touched` é o que foi mexido
// ("Nenhuma" = lista vazia, tocada) e nunca é sobrescrito pela sugestão, que
// vive à parte e vale só pro caminho do pedido. Escolha fora do caminho fica
// guardada e não é enviada: voltar o caminho desfaz
export function useSelectionChoices(
  path: string[],
  selections: Selection[],
  // Rascunho recuperado (N3)
  restored?: SelectionChoiceMap,
) {
  const [touched, setTouched] = useState<SelectionChoiceMap>(() =>
    keepActiveChoices(restored ?? {}, selections),
  )
  const [rootTagId, ...subtags] = path
  const fetched = useFetched(path.length > 0 ? path.join('/') : null, () =>
    suggestSelections(rootTagId, subtags.at(-1)),
  )
  const suggested = fetched?.data?.items ?? []

  const onPath = pathSelections(path, selections)
  const general = generalSelections(selections)
  const valueOf = (selection: Selection) =>
    touched[selection.id] ??
    suggested.find((item) => item.selectionId === selection.id)?.optionIds ??
    []

  return {
    onPath,
    general,
    touched,
    valueOf,
    optionIds: [...onPath, ...general].flatMap(valueOf),
    change(selectionId: string, optionIds: string[]) {
      setTouched((current) => ({ ...current, [selectionId]: optionIds }))
    },
  }
}
