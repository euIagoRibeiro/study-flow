import { useState } from 'react'
import { suggestSelections } from './api/selections'
import {
  generalSelections,
  keepActiveChoices,
  pathSelections,
  type SelectionChoiceMap,
} from './selections'
import type { ExecutionSelection, Selection } from './types'
import { useFetched } from './useFetched'

// Estado das escolhas de seleção num formulário. Vale, nesta ordem: o que foi
// mexido (`touched`; "Nenhuma" = lista vazia, tocada), o que o registro tinha
// ao abrir e a sugestão, que vale só pro caminho do pedido. Escolha fora do
// caminho fica guardada e não é enviada: voltar o caminho desfaz
export function useSelectionChoices(
  path: string[],
  selections: Selection[],
  // Rascunho recuperado (N3)
  restored?: SelectionChoiceMap,
  recorded: ExecutionSelection[] = [],
) {
  // Como estava ao abrir: a gravação do caminho (treino ao vivo) pode tirar
  // escolhas do servidor, e voltar o caminho tem que trazê-las
  const [opened] = useState(recorded)
  const keptOptionIds = opened.flatMap((item) => item.optionIds)
  const keptSelectionIds = opened.map((item) => item.selectionId)
  const [touched, setTouched] = useState<SelectionChoiceMap>(() =>
    keepActiveChoices(restored ?? {}, selections, keptOptionIds),
  )
  const [rootTagId, ...subtags] = path
  const fetched = useFetched(path.length > 0 ? path.join('/') : null, () =>
    suggestSelections(rootTagId, subtags.at(-1)),
  )
  const suggested = fetched?.data?.items ?? []

  const onPath = pathSelections(path, selections, keptSelectionIds)
  const general = generalSelections(selections, keptSelectionIds)
  const valueOf = (selection: Selection) =>
    touched[selection.id] ??
    opened.find((item) => item.selectionId === selection.id)?.optionIds ??
    suggested.find((item) => item.selectionId === selection.id)?.optionIds ??
    []

  return {
    onPath,
    general,
    touched,
    keptOptionIds,
    valueOf,
    optionIds: [...onPath, ...general].flatMap(valueOf),
    change(selectionId: string, optionIds: string[]) {
      setTouched((current) => ({ ...current, [selectionId]: optionIds }))
    },
  }
}
