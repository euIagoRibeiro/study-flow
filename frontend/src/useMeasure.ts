import { useState } from 'react'
import {
  applicableMeasure,
  describeValues,
  textsToValues,
  valuesToTexts,
  type MeasureTexts,
} from './measures'
import type { ExecutionMeasure, Measure, MeasureValue } from './types'

// Estado da medida num formulário (Registrar, Finalizar, editar). Hook
// próprio = função que usa useState por dentro e devolve o estado pronto;
// os três formulários usam a mesma lógica sem repetir
export function useMeasure(
  path: string[],
  measures: Measure[],
  recorded: ExecutionMeasure | null, // o que o registro já tem
) {
  const [originalPath] = useState(path)
  const measureFor = (p: string[]) =>
    applicableMeasure(p, measures, recorded?.measureId)
  const restores = (p: string[]) =>
    recorded !== null && measureFor(p)?.id === recorded.measureId
  const [texts, setTexts] = useState<MeasureTexts>(() =>
    recorded && restores(path) ? valuesToTexts(recorded.values) : {},
  )
  const [touched, setTouched] = useState(false)

  const measure = measureFor(path)
  const pathChanged = path.join('/') !== originalPath.join('/')
  const filled = Object.values(texts).some((text) => text.trim() !== '')
  const hasRecorded = recorded !== null && recorded.values.length > 0
  const recordedIsCurrent =
    recorded !== null && measure?.id === recorded.measureId
  // Medida anterior: o caminho não mudou, mas a medida que vale hoje é
  // outra (a subtag ganhou medida própria depois). Só leitura
  const oldValues =
    hasRecorded && !pathChanged && !recordedIsCurrent
      ? describeValues(recorded, measures)
      : undefined
  // Vai sumir ao salvar: o caminho levou pra outra medida, ou preencher a
  // atual substitui a anterior
  const warning =
    hasRecorded && !recordedIsCurrent && (pathChanged || filled)
      ? pathChanged
        ? `Mudar o caminho vai remover a medida registrada: ${describeValues(recorded, measures)}.`
        : `Preencher a medida atual vai remover a anterior: ${describeValues(recorded, measures)}.`
      : undefined

  return {
    measure,
    texts,
    oldValues,
    warning,
    keptKindIds: new Set(
      recordedIsCurrent
        ? recorded.values.flatMap((v) => (v.kindId ? [v.kindId] : []))
        : [],
    ),
    change(key: string, text: string) {
      setTexts((current) => ({ ...current, [key]: text }))
      setTouched(true)
    },
    // Caminho novo, campos da medida nova; de volta à medida do registro,
    // os valores dele voltam (e o aviso some)
    changePath(next: string[]) {
      setTexts(recorded && restores(next) ? valuesToTexts(recorded.values) : {})
    },
    // values undefined = não mandar (o servidor mantém o que está gravado).
    // force: o caminho gravado mudou no meio (treino ao vivo) e o servidor
    // pode ter tirado a medida; manda o que está na tela
    toSend(
      force = false,
    ): { values: MeasureValue[] | undefined } | { error: string } {
      if (!force && !pathChanged && !touched) return { values: undefined }
      if (oldValues !== undefined && !filled) return { values: undefined }
      return textsToValues(texts, measure)
    },
  }
}
