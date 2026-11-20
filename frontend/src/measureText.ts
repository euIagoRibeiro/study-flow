// Texto das medidas nas linhas do Painel. Módulo SEM imports: o teste de unidade
// (tests/unidade/medidas-texto.mjs) o importa direto, sem navegador nem build.

// Sigla = palavra de 2 ou mais letras toda em maiúsculas (ENEM, USP): fica como está.
// O resto vai pra minúsculas. Uma letra maiúscula sozinha ("A") não é sigla.
// Consequência: "ERROS" digitado todo em maiúsculas também é lido como sigla
export function lowerLabel(text: string): string {
  return text.replace(/\p{L}+/gu, (word) =>
    [...word].length >= 2 && word === word.toLocaleUpperCase('pt-BR')
      ? word
      : word.toLocaleLowerCase('pt-BR'),
  )
}

type MeasureText = {
  name: string
  singular: string
  total: number
  kinds: { name: string | null; quantity: number }[]
}

// `kindItems`: cada "rótulo: número" (a tela os desenha como unidades que não quebram no meio);
// `kinds`: os mesmos itens juntos por " · "
export type MeasureLine = {
  total: string
  kinds?: string
  kindItems?: string[]
}

// Uma linha por medida: o total com a unidade ("120 questões", no singular com 1) e, só se há
// tipos, "acertos: 100 · erros: 20 · sem tipo: 5" na ordem recebida. `formatNumber` entra por
// parâmetro (o módulo não importa nada)
export function measureLines(
  items: MeasureText[],
  formatNumber: (value: number) => string,
): MeasureLine[] {
  return items.map((item) => {
    const unit = lowerLabel(item.total === 1 ? item.singular : item.name)
    const line: MeasureLine = { total: `${formatNumber(item.total)} ${unit}` }
    if (item.kinds.length > 0) {
      const items = item.kinds.map(
        (kind) =>
          `${kind.name === null ? 'sem tipo' : lowerLabel(kind.name)}: ${formatNumber(kind.quantity)}`,
      )
      line.kinds = items.join(' · ')
      line.kindItems = items
    }
    return line
  })
}
