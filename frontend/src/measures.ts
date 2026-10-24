import {
  formatQuantity,
  measureValueError,
  parseMeasureValue,
  quantityInputValue,
} from './numbers'
import { compareNames } from './tags'
import type { ExecutionMeasure, Measure, MeasureValue } from './types'

// A mesma regra do servidor: vale a medida da tag mais funda do caminho
// que declara uma. Arquivada = caminho sem medida (não volta pro ancestral:
// a subtag substituiu de propósito), a não ser que o registro já a use
export function applicableMeasure(
  path: string[], // da raiz pra baixo
  measures: Measure[],
  keepMeasureId?: string,
): Measure | null {
  const byTag = new Map(measures.map((measure) => [measure.tagId, measure]))
  const declared = [...path]
    .reverse()
    .map((tagId) => byTag.get(tagId))
    .find((measure) => measure !== undefined)
  if (!declared) return null
  return declared.active || declared.id === keepMeasureId ? declared : null
}

// Os campos guardam texto; a chave é o tipo (ou '' na medida sem tipos)
export type MeasureTexts = Record<string, string>

export function valuesToTexts(values: MeasureValue[]): MeasureTexts {
  return Object.fromEntries(
    values.map((value) => [
      value.kindId ?? '',
      quantityInputValue(value.quantity),
    ]),
  )
}

// Campos → valores. Só os preenchidos; um inválido barra o envio
export function textsToValues(
  texts: MeasureTexts,
  measure: Measure | null,
): { values: MeasureValue[] } | { error: string } {
  if (!measure) return { values: [] }
  const values: MeasureValue[] = []
  for (const [key, text] of Object.entries(texts)) {
    const quantity = parseMeasureValue(text, measure.allowsDecimal)
    if (quantity === null)
      return { error: measureValueError(measure.allowsDecimal) }
    if (quantity === '') continue
    values.push({ kindId: key === '' ? null : key, quantity })
  }
  return { values }
}

// "3 refatoração", "12 exercícios", "1 exercício", "5,2 km"
export function describeValue(value: MeasureValue, measure: Measure): string {
  const kind = measure.kinds.find((k) => k.id === value.kindId)
  const label = kind
    ? kind.name
    : value.quantity === 1
      ? measure.singular
      : measure.name
  return `${formatQuantity(value.quantity)} ${label}`
}

// Tipos em ordem alfabética, como nos campos (compareNames): a ordem não
// depende da que a API mandou
export function sortValues(
  values: MeasureValue[],
  measure: Measure,
): MeasureValue[] {
  const name = (value: MeasureValue) =>
    measure.kinds.find((k) => k.id === value.kindId)?.name ?? ''
  return [...values].sort((a, b) => compareNames(name(a), name(b)))
}

export function describeValues(
  recorded: ExecutionMeasure,
  measures: Measure[],
): string {
  const measure = measures.find((m) => m.id === recorded.measureId)
  if (!measure) return ''
  return sortValues(recorded.values, measure)
    .map((v) => describeValue(v, measure))
    .join(', ')
}
