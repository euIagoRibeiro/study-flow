// Números digitados vêm de campo de TEXTO, não type="number": com o
// navegador em inglês, o campo numérico transforma "4,5" em 45 sem avisar
// (testado em 2026-10-23). Quem converte e valida é aqui

export const MINUTES_ERROR = 'Duração: minutos inteiros, de 1 a 1440'

// Duração estimada: '' = sem estimativa; null = inválido (MINUTES_ERROR)
export function parseMinutes(text: string): number | '' | null {
  const value = text.trim()
  if (value === '') return ''
  if (!/^\d+$/.test(value)) return null
  const minutes = Number(value)
  return minutes >= 1 && minutes <= 1440 ? minutes : null
}

export type QuantityValue = { quantity: number; quantityUnit: string }

// Quantidade + unidade digitadas. Número vazio = sem quantidade (a unidade
// sugerida sozinha não conta). Aceita "5,5" e "5.5"; recusa "1.234,5"
// (milhar ambíguo) e mais de 2 casas, em vez de adivinhar
export function parseQuantity(
  quantityText: string,
  unitText: string,
  unitIsSuggestion: boolean,
): { value: QuantityValue | null } | { error: string } {
  const text = quantityText.trim()
  const unit = unitText.trim()
  if (text === '') {
    return unit === '' || unitIsSuggestion
      ? { value: null }
      : { error: 'Preencha a quantidade ou apague a unidade' }
  }
  if (!/^\d{1,8}([.,]\d{1,2})?$/.test(text)) {
    return {
      error: 'Quantidade: número com até 2 casas e um só separador (ex.: 5,5)',
    }
  }
  const quantity = Number(text.replace(',', '.'))
  if (quantity <= 0) return { error: 'Quantidade: maior que zero' }
  if (unit === '') return { error: 'Preencha a unidade' }
  if (unit.length > 30) return { error: 'Unidade: no máximo 30 caracteres' }
  return { value: { quantity, quantityUnit: unit } }
}

// Na tela: "5,2", "12", "1.234,5" (português, sem ",00")
export function formatQuantity(quantity: number): string {
  return quantity.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

// No campo (pra editar): vírgula decimal, sem separador de milhar, que o
// parseQuantity recusaria
export function quantityInputValue(quantity: number | null): string {
  return quantity === null ? '' : String(quantity).replace('.', ',')
}
