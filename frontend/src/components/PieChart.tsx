// Pizza em SVG à mão (sem biblioteca, como o resto: "sem ORM"). As cores
// vêm por token (var(--categoria-N)), então acompanham o tema sem JS. O
// número exato está na tabela, que é a legenda: o gráfico é complemento
export type Slice = { value: number; color: string; label?: string }

const SIZE = { width: 280, height: 196 }
const CENTER = { x: 140, y: 98 }
const RADIUS = 72
// O % fica FORA da fatia, em tinta: as cores do meio da paleta não chegam a
// 4,5:1 de contraste com texto nenhum (medido)
const LABEL_RADIUS = RADIUS + 18

function point(angle: number, radius: number) {
  // 0 = topo, sentido horário
  return {
    x: CENTER.x + radius * Math.sin(angle),
    y: CENTER.y - radius * Math.cos(angle),
  }
}

function arcPath(from: number, to: number) {
  // Fatia única (100%): um arco não fecha a volta inteira (começo = fim),
  // então vai em duas metades
  if (to - from >= 2 * Math.PI - 1e-9) {
    const top = point(0, RADIUS)
    const bottom = point(Math.PI, RADIUS)
    return `M ${top.x} ${top.y} A ${RADIUS} ${RADIUS} 0 1 1 ${bottom.x} ${bottom.y} A ${RADIUS} ${RADIUS} 0 1 1 ${top.x} ${top.y} Z`
  }
  const a = point(from, RADIUS)
  const b = point(to, RADIUS)
  const large = to - from > Math.PI ? 1 : 0
  return `M ${CENTER.x} ${CENTER.y} L ${a.x} ${a.y} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${b.x} ${b.y} Z`
}

function PieChart(props: { slices: Slice[]; label: string }) {
  const total = props.slices.reduce((sum, s) => sum + s.value, 0)
  if (total <= 0) return null
  // Cada fatia começa onde a anterior terminou
  const drawn = props.slices.reduce<(Slice & { from: number; to: number })[]>(
    (acc, slice) => {
      const from = acc.at(-1)?.to ?? 0
      return [
        ...acc,
        { ...slice, from, to: from + (slice.value / total) * 2 * Math.PI },
      ]
    },
    [],
  )
  return (
    <svg
      role="img"
      aria-label={props.label}
      viewBox={`0 0 ${SIZE.width} ${SIZE.height}`}
      className="mx-auto w-full max-w-[20rem]"
    >
      {drawn.map((s, i) => (
        // Fio da cor do fundo entre as fatias: vizinhas não se fundem
        <path
          key={i}
          d={arcPath(s.from, s.to)}
          style={{ fill: s.color }}
          className="stroke-papel"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      ))}
      {drawn.map((s, i) => {
        if (!s.label) return null
        const mid = (s.from + s.to) / 2
        const p = point(mid, LABEL_RADIUS)
        // À direita do centro, o texto começa no ponto; à esquerda, termina
        const anchor =
          Math.abs(Math.sin(mid)) < 0.2
            ? 'middle'
            : Math.sin(mid) > 0
              ? 'start'
              : 'end'
        return (
          <text
            key={`t${i}`}
            x={p.x}
            y={p.y}
            textAnchor={anchor}
            dominantBaseline="middle"
            className="fill-tinta font-dados text-[12px] font-semibold"
          >
            {s.label}
          </text>
        )
      })}
    </svg>
  )
}

export default PieChart
