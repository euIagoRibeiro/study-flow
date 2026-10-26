import { useRef, useState } from 'react'
import { getTimeByTags } from '../api/dashboard'
import { formatDuration } from '../dates'
import {
  MAX_CHOSEN,
  categoryAt,
  comparisonFor,
  formatDiff,
  nestedPairs,
  type Period,
} from '../painel'
import {
  fieldClass,
  focusRing,
  pickerButtonClass,
  secondaryButtonClass,
} from '../styles'
import { compareNames, indexTags, tagLineage, tagPath } from '../tags'
import type { Tag } from '../types'
import { useFetched } from '../useFetched'
import { plain } from '../workouts'
import TimeTable from './TimeTable'

const MAX_RESULTS = 8

// Chip da tag escolhida: o caminho quebra linha; o "×" é um botão próprio
const chosenChipClass =
  'inline-flex max-w-full items-center gap-1.5 rounded-xl bg-tinta/[0.07] pl-2.5 font-dados text-xs/[1.35] font-medium text-tinta'
const removeButtonClass = `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-base text-tinta-suave hover:bg-tinta/[0.07] hover:text-tinta ${focusRing}`

type Times = {
  items: { tagId: string; seconds: number }[]
  unionSeconds: number
}

// Barras horizontais em HTML (não SVG): o caminho completo precisa quebrar
// linha, e texto de SVG não quebra (sairia cortado pelo viewBox). Não fingem
// somar 100% (tags aninhadas se sobrepõem). Cor pela ORDEM DA ESCOLHA, que
// não muda ao trocar o período; o rótulo e o valor ficam fora da cor
function TagBars(props: {
  bars: { key: string; name: string; seconds: number; color: string }[]
}) {
  const max = Math.max(...props.bars.map((b) => b.seconds), 1)
  return (
    <div
      role="img"
      aria-label="Barras do tempo por tag escolhida (os números estão na tabela abaixo)"
      className="flex flex-col gap-2.5"
    >
      {props.bars.map((bar) => (
        <div key={bar.key} className="flex flex-col gap-1">
          <span className="font-dados text-meta break-words">{bar.name}</span>
          <div className="flex items-center gap-2">
            <div className="h-3 min-w-0 flex-1">
              <div
                className="h-3 rounded-sm"
                style={{
                  width: `${(bar.seconds / max) * 100}%`,
                  backgroundColor: bar.color,
                }}
              />
            </div>
            <span className="w-14 shrink-0 text-right font-dados text-meta tabular-nums">
              {formatDuration(bar.seconds * 1000)}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// Comparar tags (Painel v2): até 5 caminhos de qualquer nível, escolhidos
// pela busca, lado a lado. Seção à parte: a visão por contexto continua
// intacta (exata por construção). A escolha mora na URL (?tags=)
function TagCompare(props: {
  tags: Tag[]
  period: Period
  zone: string
  chosen: string[]
  onChange: (tags: string[]) => void
}) {
  const byId = indexTags(props.tags)
  const chosen = props.chosen.map((id) => byId.get(id)).filter((t) => !!t)
  const [query, setQuery] = useState('')
  const [attempt, setAttempt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const { period, zone } = props

  const key =
    chosen.length > 0
      ? `${period.start.toISOString()}|${period.end.toISOString()}|${zone}|${props.chosen.join(',')}|${attempt}`
      : null
  // O anterior vem na mesma busca, como no resto do Painel
  const times = useFetched<{ current: Times; previous: Times }>(
    key,
    async () => {
      const { previous: prev, until } = comparisonFor(period, new Date())
      const [current, previous] = await Promise.all([
        getTimeByTags(period.start, period.end, zone, props.chosen),
        until > prev.start
          ? getTimeByTags(prev.start, until, zone, props.chosen)
          : { items: [], unionSeconds: 0 },
      ])
      return { current, previous }
    },
  )

  const full = chosen.length >= MAX_CHOSEN
  const term = plain(query)
  const matches =
    term === '' || full
      ? []
      : props.tags
          .filter((t) => !props.chosen.includes(t.id))
          .map((t) => ({ tag: t, path: tagPath(t, byId) }))
          .filter((option) => plain(option.path).includes(term))
          .sort((a, b) => compareNames(a.path, b.path))

  function choose(id: string) {
    props.onChange([...props.chosen, id])
    setQuery('')
    input.current?.focus()
  }
  function remove(id: string) {
    props.onChange(props.chosen.filter((c) => c !== id))
    input.current?.focus()
  }

  const data = times?.data
  const secondsOf = (t: Times, id: string) =>
    t.items.find((item) => item.tagId === id)?.seconds ?? 0
  const nested = nestedPairs(chosen, (t) => tagLineage(t, byId))
  const union =
    data && formatDiff(data.current.unionSeconds, data.previous.unionSeconds)

  return (
    <section aria-label="Comparar tags" className="flex flex-col gap-3">
      <h2 className="font-titulo text-base font-semibold">Comparar tags</h2>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">Buscar tag</span>
        <input
          ref={input}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={60}
          className={fieldClass}
        />
      </label>
      {full && term !== '' && (
        <p className="px-0.5 text-sm text-tinta-suave">
          Já são {MAX_CHOSEN} tags, o máximo. Tire uma pra escolher outra.
        </p>
      )}
      {matches.length > 0 && (
        <ul aria-label="Tags encontradas" className="flex flex-col gap-2">
          {matches.slice(0, MAX_RESULTS).map((option) => (
            <li key={option.tag.id}>
              <button
                type="button"
                onClick={() => choose(option.tag.id)}
                className={`${pickerButtonClass} break-words`}
              >
                {option.path}
                {!option.tag.active && (
                  <span className="text-tinta-suave"> (arquivada)</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {matches.length > MAX_RESULTS && (
        <p className="px-0.5 text-sm text-tinta-suave">
          E mais {matches.length - MAX_RESULTS}: continue digitando pra achar.
        </p>
      )}
      {!full && term !== '' && matches.length === 0 && (
        <p className="px-0.5 text-sm text-tinta-suave">
          Nenhuma tag com "{query.trim()}".
        </p>
      )}

      {chosen.length === 0 ? (
        <p className="text-sm text-tinta-suave">
          Escolha até {MAX_CHOSEN} tags pra ver o tempo lado a lado (de
          contextos diferentes também).
        </p>
      ) : (
        <>
          <ul aria-label="Tags escolhidas" className="flex flex-wrap gap-2">
            {chosen.map((tag, i) => (
              <li key={tag.id} className={chosenChipClass}>
                <span
                  aria-hidden="true"
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${categoryAt(i).dot}`}
                />
                <span className="min-w-0 py-1 break-words">
                  {tagPath(tag, byId)}
                </span>
                <button
                  type="button"
                  onClick={() => remove(tag.id)}
                  aria-label={`Tirar ${tagPath(tag, byId)}`}
                  title="Tirar"
                  className={removeButtonClass}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
          {nested.map(([outer, inner]) => (
            <p
              key={`${outer.id}|${inner.id}`}
              className="font-texto text-meta text-tinta-suave"
            >
              {tagPath(outer, byId)} inclui {tagPath(inner, byId)}: não somam.
            </p>
          ))}

          {times === null ? (
            <p className="text-sm text-tinta-suave">Carregando…</p>
          ) : !data ? (
            <div
              role="alert"
              className="flex flex-col items-start gap-3 rounded-xl border border-alerta/40 bg-alerta/[0.08] px-4 py-4"
            >
              <p className="font-semibold text-alerta">
                Não foi possível carregar a comparação.
              </p>
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className={secondaryButtonClass}
              >
                Tentar de novo
              </button>
            </div>
          ) : (
            <>
              {data.current.unionSeconds > 0 && (
                <TagBars
                  bars={chosen.map((tag, i) => ({
                    key: tag.id,
                    name: tagPath(tag, byId),
                    seconds: secondsOf(data.current, tag.id),
                    color: categoryAt(i).color,
                  }))}
                />
              )}
              <TimeTable
                caption="Tempo dedicado por tag escolhida"
                head="Tag"
                compare
                // % sobre o tempo de todas juntas (aninhadas passariam de 100%)
                percentOf={data.current.unionSeconds}
                rows={chosen.map((tag, i) => ({
                  key: tag.id,
                  name: tagPath(tag, byId),
                  seconds: secondsOf(data.current, tag.id),
                  previous: secondsOf(data.previous, tag.id),
                  dot: categoryAt(i).dot,
                }))}
              />
              {chosen.length > 1 && union && (
                <p className="text-sm">
                  <span className="text-tinta-suave">
                    Juntas (cada sessão conta uma vez):
                  </span>{' '}
                  <span className="font-dados tabular-nums">
                    {formatDuration(data.current.unionSeconds * 1000)} · vs.
                    anterior:{' '}
                    {union.percent
                      ? `${union.text} ${union.percent}`
                      : union.text}
                  </span>
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

export default TagCompare
