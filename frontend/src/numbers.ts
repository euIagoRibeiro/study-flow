// Números digitados vêm de campo de TEXTO, não type="number": com o
// navegador em inglês, o campo numérico transforma "4,5" em 45 sem avisar
// (testado em 2026-10-23). Quem converte e valida é aqui

// Minutos inteiros, de 1 a 1440 (o "Durou" do Finalizar): '' = vazio; null = inválido
export function parseMinutes(text: string): number | '' | null {
  const value = text.trim()
  if (value === '') return ''
  if (!/^\d+$/.test(value)) return null
  const minutes = Number(value)
  return minutes >= 1 && minutes <= 1440 ? minutes : null
}

export const DURATION_ERROR =
  'Duração: minutos (90), min:s (1:22) ou h:mm:ss (1:07:10), até 24 horas'

const MAX_DURATION_SECONDS = 24 * 60 * 60

// Duração estimada em segundos: "90" = 90 min; "a:b" = min:s, nunca h:min;
// "h:mm:ss". '' = sem estimativa; null = inválido (DURATION_ERROR)
export function parseDuration(text: string): number | '' | null {
  const value = text.trim()
  if (value === '') return ''
  let seconds: number
  let match
  if (/^\d+$/.test(value)) {
    seconds = Number(value) * 60
  } else if ((match = /^(\d+):([0-5]\d)$/.exec(value))) {
    seconds = Number(match[1]) * 60 + Number(match[2])
  } else if ((match = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(value))) {
    seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  } else {
    return null
  }
  return seconds >= 1 && seconds <= MAX_DURATION_SECONDS ? seconds : null
}

// Segundos de volta pro campo: minuto inteiro como número ("20"), senão m:ss,
// e h:mm:ss a partir de 1 hora
export function durationText(seconds: number): string {
  if (seconds % 60 === 0) return String(seconds / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

// O que o campo entendeu, por extenso: "1 h 7 min 10 s"
export function durationWords(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h && `${h} h`, m && `${m} min`, s && `${s} s`]
    .filter(Boolean)
    .join(' ')
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
