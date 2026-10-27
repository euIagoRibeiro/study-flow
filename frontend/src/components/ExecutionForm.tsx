import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { fromDatetimeLocalValue, toDatetimeLocalValue } from '../dates'
import {
  clearDraft,
  isPhase,
  isText,
  isTexts,
  readDraft,
  useDraftSync,
} from '../formDrafts'
import type { MeasureTexts } from '../measures'
import { fieldClass, secondaryButtonClass } from '../styles'
import { phaseApplies } from '../phases'
import { indexTags, pathToChoice, type TagIndex } from '../tags'
import { isChoosablePath } from '../timerMemory'
import type {
  Measure,
  MeasureValue,
  Phase,
  StartDraft,
  Tag,
  TagChoice,
} from '../types'
import { MINUTES_ERROR, parseMinutes } from '../numbers'
import { useMeasure } from '../useMeasure'
import DraftNotice from './DraftNotice'
import EstimateField from './EstimateField'
import FormError from './FormError'
import MeasureFields from './MeasureFields'
import PhaseField from './PhaseField'
import TagFields from './TagFields'

type FormProps = {
  draftKey: string // rascunho na tela (N3): por tarefa
  tags: Tag[]
  measures: Measure[]
  initialPath: string[] // pré-seleção: o contexto do último registro
  suggestPhase: (path: string[]) => Phase | null
  onSubmit: (
    description: string,
    completedAt: string,
    tags: TagChoice,
    estimatedMinutes: number | null,
    measureValues: MeasureValue[],
  ) => Promise<unknown>
  // A cada mudança no caminho, na fase ou na descrição: o "Iniciar
  // cronômetro" (fora do formulário) leva o que estiver aqui; null = nada
  // (o rascunho foi descartado)
  onDraftChange?: (draft: StartDraft | null) => void
}

// O que fica guardado do Registrar: o "Quando" só se foi mexido (sem mexer,
// vale a hora do clique), os valores da medida sem os campos vazios
type RegistrarDraft = {
  description: string
  when: string | null
  minutes: string
  path: string[]
  phase: Phase | null
  measureTexts: MeasureTexts
}

function readRegistrarDraft(key: string, byId: TagIndex) {
  const d = readDraft(key)
  if (
    !d ||
    !isText(d.description) ||
    !(d.when === null || isText(d.when)) ||
    !isText(d.minutes) ||
    !Array.isArray(d.path) ||
    !d.path.every(isText) ||
    !isChoosablePath(d.path, byId) ||
    !isPhase(d.phase) ||
    !isTexts(d.measureTexts)
  ) {
    return null
  }
  return d as RegistrarDraft
}

const filledTexts = (texts: MeasureTexts) =>
  Object.fromEntries(
    Object.entries(texts).filter(([, text]) => text.trim() !== ''),
  )

// Registrar sem cronômetro: botão secundário — na mesma tela, o amarelo é
// do "Iniciar cronômetro" (um botão principal por estado). O "descartar" do
// rascunho remonta o formulário intocado
function ExecutionForm(props: FormProps) {
  const [generation, setGeneration] = useState(0)
  return (
    <RegistrarForm
      key={generation}
      {...props}
      onDiscard={() => {
        clearDraft(props.draftKey)
        props.onDraftChange?.(null)
        setGeneration((n) => n + 1)
      }}
    />
  )
}

function RegistrarForm(props: FormProps & { onDiscard: () => void }) {
  const byId = indexTags(props.tags)
  // O que ficou digitado antes (ir às tags e voltar, por exemplo)
  const [restored] = useState(() => readRegistrarDraft(props.draftKey, byId))
  const [description, setDescription] = useState(restored?.description ?? '')
  // "Quando" começa na hora em que o formulário abriu; sem mexer, grava a
  // hora do clique (preencher não deixa o registro no passado)
  const [openedAt] = useState(() =>
    toDatetimeLocalValue(new Date().toISOString()),
  )
  const [when, setWhen] = useState(restored?.when ?? openedAt)
  const [minutes, setMinutes] = useState(restored?.minutes ?? '')
  const [path, setPath] = useState(restored?.path ?? props.initialPath)
  const [phase, setPhase] = useState(() =>
    restored ? restored.phase : props.suggestPhase(props.initialPath),
  )
  // Registro novo: nada gravado, nada pré-preenchido (ou o rascunho)
  const measure = useMeasure(path, props.measures, null, restored?.measureTexts)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const showPhase = phaseApplies(path, byId)

  // Rascunho: a "foto" do formulário, guardada enquanto difere do intocado
  const [pristine] = useState<RegistrarDraft>(() => ({
    description: '',
    when: null,
    minutes: '',
    path: props.initialPath,
    phase: props.suggestPhase(props.initialPath),
    measureTexts: {},
  }))
  useDraftSync(
    props.draftKey,
    {
      description,
      when: when === openedAt ? null : when,
      minutes,
      path,
      phase,
      measureTexts: filledTexts(measure.texts),
    } satisfies RegistrarDraft,
    pristine,
  )
  // Rascunho recuperado também vale pro "Iniciar cronômetro" (B1): avisa a
  // página uma vez, ao montar
  useEffect(() => {
    if (restored) report(restored.path, restored.phase, restored.description)
    // só na montagem: depois, quem avisa são os próprios campos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Avisa com os valores NOVOS (o estado só muda na próxima renderização);
  // pelos eventos dos campos, sem useEffect. Sem mexer, nada é avisado: o
  // Iniciar continua como antes
  function report(nextPath: string[], nextPhase: Phase | null, text: string) {
    const applies = phaseApplies(nextPath, byId)
    props.onDraftChange?.({
      description: text,
      tags: pathToChoice(nextPath, applies ? nextPhase : null),
    })
  }

  // Caminho novo, pré-seleção nova (e os campos da medida do caminho)
  function changePath(next: string[]) {
    const nextPhase = props.suggestPhase(next)
    setPath(next)
    setPhase(nextPhase)
    measure.changePath(next)
    report(next, nextPhase, description)
  }

  function changePhase(next: Phase | null) {
    setPhase(next)
    report(path, next, description)
  }

  function changeDescription(text: string) {
    setDescription(text)
    report(path, phase, text)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const estimate = parseMinutes(minutes)
    if (estimate === null) {
      setError(MINUTES_ERROR)
      return
    }
    const sent = measure.toSend()
    if ('error' in sent) {
      setError(sent.error)
      return
    }
    setSubmitting(true)
    try {
      await props.onSubmit(
        description,
        when === openedAt
          ? new Date().toISOString()
          : fromDatetimeLocalValue(when),
        pathToChoice(path, showPhase ? phase : null),
        estimate === '' ? null : estimate,
        sent.values ?? [],
      )
      clearDraft(props.draftKey)
    } catch (err) {
      // 400: o servidor recusou com motivo (ex.: tag arquivada em outra aba)
      setError(
        err instanceof ApiError && err.status === 400
          ? err.message
          : 'Não foi possível registrar. Tente de novo.',
      )
      return
    } finally {
      setSubmitting(false)
    }
    setError('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {restored && <DraftNotice onDiscard={props.onDiscard} />}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">
          O que foi feito (opcional)
        </span>
        <input
          type="text"
          value={description}
          onChange={(event) => changeDescription(event.target.value)}
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">Quando</span>
        <input
          type="datetime-local"
          value={when}
          onChange={(event) => setWhen(event.target.value)}
          required
          className={fieldClass}
        />
      </label>
      <EstimateField value={minutes} onChange={setMinutes} />
      <TagFields tags={props.tags} value={path} onChange={changePath} />
      {showPhase && <PhaseField value={phase} onChange={changePhase} />}
      <MeasureFields
        measure={measure.measure}
        texts={measure.texts}
        onChange={measure.change}
      />
      <button
        type="submit"
        disabled={submitting}
        className={`w-full ${secondaryButtonClass}`}
      >
        Registrar
      </button>
      {error && <FormError>{error}</FormError>}
    </form>
  )
}

export default ExecutionForm
