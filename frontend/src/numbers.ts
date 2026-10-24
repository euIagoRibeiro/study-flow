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

// Valor de medida: '' = campo vazio (sem valor); null = inválido. Decimal
// aceita "5,5" e "5.5" com até 2 casas, e recusa "1.234,5" (milhar
// ambíguo) em vez de adivinhar
export function parseMeasureValue(
  text: string,
  allowsDecimal: boolean,
): number | '' | null {
  const value = text.trim()
  if (value === '') return ''
  const pattern = allowsDecimal ? /^\d{1,8}([.,]\d{1,2})?$/ : /^\d{1,8}$/
  if (!pattern.test(value)) return null
  const number = Number(value.replace(',', '.'))
  return number > 0 ? number : null
}

export function measureValueError(allowsDecimal: boolean): string {
  return allowsDecimal
    ? 'Medida: número maior que zero, com até 2 casas (ex.: 5,5)'
    : 'Medida: número inteiro maior que zero'
}

// Na tela: "5,2", "12", "1.234,5" (português, sem ",00")
export function formatQuantity(quantity: number): string {
  return quantity.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

// No campo (pra editar): vírgula decimal, sem separador de milhar, que a
// conversão recusaria
export function quantityInputValue(quantity: number | null): string {
  return quantity === null ? '' : String(quantity).replace('.', ',')
}
