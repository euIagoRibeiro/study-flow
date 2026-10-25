// Barras em SVG à mão: tempo de cada faixa do período (dia na semana,
// semana no mês). Uma cor só, neutra (tinta-suave, ≥ 6:1 com o fundo): a
// barra diz "quanto", não "o quê". O valor vai escrito em cima de cada barra
export type Bar = { value: number; valueLabel: string; label: string }

const WIDTH = 300
const HEIGHT = 150
const TOP = 18 // espaço do valor em cima da barra mais alta
const BOTTOM = 18 // espaço do rótulo embaixo

function BarChart(props: { bars: Bar[]; label: string }) {
  const max = Math.max(...props.bars.map((b) => b.value), 1)
  const slot = WIDTH / props.bars.length
  const barWidth = Math.min(slot * 0.62, 36)
  const area = HEIGHT - TOP - BOTTOM
  return (
    <svg
      role="img"
      aria-label={props.label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="mx-auto w-full max-w-[26rem]"
    >
      {/* Linha de base */}
      <line
        x1={0}
        x2={WIDTH}
        y1={HEIGHT - BOTTOM}
        y2={HEIGHT - BOTTOM}
        className="stroke-linha"
        strokeWidth={1}
      />
      {props.bars.map((bar, i) => {
        const h = (bar.value / max) * area
        const x = i * slot + (slot - barWidth) / 2
        const y = HEIGHT - BOTTOM - h
        const center = i * slot + slot / 2
        return (
          <g key={i}>
            {/* Uma barra por faixa, mesmo vazia (altura 0): o dia sem tempo
                continua no eixo */}
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={h}
              rx={2}
              className="fill-tinta-suave"
            />
            {bar.value > 0 && (
              <text
                x={center}
                y={y - 5}
                textAnchor="middle"
                className="fill-tinta font-dados text-[10px]"
              >
                {bar.valueLabel}
              </text>
            )}
            <text
              x={center}
              y={HEIGHT - 4}
              textAnchor="middle"
              className="fill-tinta-suave font-dados text-[10px]"
            >
              {bar.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export default BarChart
