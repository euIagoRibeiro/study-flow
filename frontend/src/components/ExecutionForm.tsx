import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { ApiError } from '../api/client'
import { fromDatetimeLocalValue, toDatetimeLocalValue } from '../dates'
import {
  clearDraft,
  isChoices,
  isPhase,
  isText,
  isTexts,
  readDraft,
  useDraftSync,
} from '../formDrafts'
import type { MeasureTexts } from '../measures'
import {
  FORM_FIELD_ORDER,
  type FormField,
  type SelectionChoiceMap,
} from '../selections'
import { fieldClass, secondaryButtonClass } from '../styles'
import { phaseApplies } from '../phases'
import { indexTags, pathToChoice, type TagIndex } from '../tags'
import { isChoosablePath } from '../timerMemory'
import type {
  Measure,
  MeasureValue,
  Phase,
  Selection,
  StartDraft,
  Tag,
  TagChoice,
  Task,
  Work,
  WorkLink,
} from '../types'
import { MINUTES_ERROR, parseMinutes } from '../numbers'
import { useMeasure } from '../useMeasure'
import { useSelectionChoices } from '../useSelectionChoices'
import {
  defaultPath,
  LINK_ERROR,
  LINK_PATTERN,
  recordError,
  workMeasureNote,
} from '../works'
import DraftNotice from './DraftNotice'
import EstimateField from './EstimateField'
import FormError from './FormError'
import MeasureFields from './MeasureFields'
import PhaseField from './PhaseField'
import SelectionChoices from './SelectionChoices'
import TagFields from './TagFields'
import WorkField from './WorkField'

type FormProps = {
  draftKey: string // rascunho na tela (N3): por tarefa
  tags: Tag[]
  measures: Measure[]
  selections: Selection[]
  works: Work[]
  taskId: string // a tarefa da página (a obra não a troca)
  tasks: Task[]
  initialPath: string[] // pré-seleção: o contexto do último registro
  suggestPhase: (path: string[]) => Phase | null
  onSubmit: (
    description: string,
    completedAt: string,
    tags: TagChoice,
    estimatedMinutes: number | null,
    measureValues: MeasureValue[],
    selectionOptionIds: string[],
    link: WorkLink,
  ) => Promise<unknown>
  // A cada mudança no caminho, na fase, na descrição, nas seleções, na obra
  // ou no link: o "Iniciar cronômetro" (fora do formulário) leva o que
  // estiver aqui; null = nada (o rascunho foi descartado)
  onDraftChange?: (draft: StartDraft | null) => void
}

// O que fica guardado do Registrar: o "Quando" só se foi mexido (sem mexer,
// vale a hora do clique), os valores da medida sem os campos vazios, e das
// seleções só o que foi tocado (sugestão não é rascunho)
type RegistrarDraft = {
  description: string
  when: string | null
  minutes: string
  path: string[]
  phase: Phase | null
  measureTexts: MeasureTexts
  choices?: SelectionChoiceMap // ausente em rascunho de antes do S5a
  workId?: string | null // ausentes em rascunho de antes do O4a
  link?: string
}

// Os campos que o Iniciar leva, com o que acabou de mudar
type Reported = {
  path: string[]
  phase: Phase | null
  description: string
  workId: string | null
  link: string
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
    !isTexts(d.measureTexts) ||
    !(d.choices === undefined || isChoices(d.choices)) ||
    !(d.workId === undefined || d.workId === null || isText(d.workId)) ||
    !(d.link === undefined || isText(d.link))
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
  const choices = useSelectionChoices(path, props.selections, restored?.choices)
  // A obra do rascunho volta como estava, sem preencher o caminho de novo (o
  // caminho do rascunho é o que estava na tela). Obra que sumiu: nenhuma
  const [workId, setWorkId] = useState(restored?.workId ?? null)
  const work = props.works.find((w) => w.id === workId) ?? null
  const [link, setLink] = useState(restored?.link ?? '')
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
    choices: {},
    workId: null,
    link: '',
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
      choices: choices.touched,
      workId: work?.id ?? null,
      link,
    } satisfies RegistrarDraft,
    pristine,
  )
  // As escolhas mudam sem evento quando a sugestão chega; depois de mexido, o
  // "Iniciar cronômetro" leva o que está na tela. Vale também pro rascunho
  // recuperado (B1), que já começa mexido: avisa ao montar
  const reported = useRef(restored !== null)

  // Avisa com os valores NOVOS (o estado só muda na próxima renderização);
  // pelos eventos dos campos. Sem mexer, nada é avisado: o Iniciar continua
  // como antes
  function report(next: Partial<Reported> = {}) {
    reported.current = true
    const value: Reported = {
      path,
      phase,
      description,
      workId: work?.id ?? null,
      link,
      ...next,
    }
    const applies = phaseApplies(value.path, byId)
    props.onDraftChange?.({
      description: value.description,
      tags: pathToChoice(value.path, applies ? value.phase : null),
      selectionOptionIds: choices.optionIds,
      touchedChoices: choices.touched,
      workId: value.workId,
      linkUrl: value.link.trim() || null,
    })
  }
  const optionIds = choices.optionIds.join()
  useEffect(() => {
    if (reported.current) report()
    // os outros campos avisam pelos próprios eventos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionIds])

  // Caminho novo, pré-seleção nova (e os campos da medida do caminho)
  function changePath(next: string[], also: Partial<Reported> = {}) {
    const nextPhase = props.suggestPhase(next)
    setPath(next)
    setPhase(nextPhase)
    measure.changePath(next)
    report({ path: next, phase: nextPhase, ...also })
  }

  // A obra sobrescreve o caminho, mesmo mexido (o toque mais novo ganha). O
  // mesmo caminho não mexe em nada (a quantidade digitada fica); caminho
  // padrão arquivado não preenche
  function chooseWork(id: string | null) {
    setWorkId(id)
    const chosen = props.works.find((w) => w.id === id)
    const next = chosen ? defaultPath(chosen, props.tags) : []
    if (
      next.length > 0 &&
      next.join('/') !== path.join('/') &&
      isChoosablePath(next, byId)
    ) {
      changePath(next, { workId: id })
    } else {
      report({ workId: id })
    }
  }

  function changeLink(text: string) {
    setLink(text)
    report({ link: text })
  }

  function changePhase(next: Phase | null) {
    setPhase(next)
    report({ phase: next })
  }

  function changeDescription(text: string) {
    setDescription(text)
    report({ description: text })
  }

  function changeChoice(selectionId: string, optionIds: string[]) {
    choices.change(selectionId, optionIds)
    report()
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
    const url = link.trim()
    if (url !== '' && !LINK_PATTERN.test(url)) {
      setError(LINK_ERROR)
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
        choices.optionIds,
        { workId: work?.id ?? null, linkUrl: url || null },
      )
      clearDraft(props.draftKey)
    } catch (err) {
      // 400: o servidor recusou com motivo (ex.: tag arquivada em outra aba)
      setError(
        err instanceof ApiError && err.status === 400
          ? recordError(err.message)
          : 'Não foi possível registrar. Tente de novo.',
      )
      return
    } finally {
      setSubmitting(false)
    }
    setError('')
  }

  const measureNote = work
    ? workMeasureNote(work, measure.measure, props.measures)
    : null
  const blocks: Record<FormField, ReactNode> = {
    obra: (
      <WorkField
        works={props.works}
        value={work?.id ?? null}
        onChange={chooseWork}
        tags={props.tags}
        measures={props.measures}
        taskId={props.taskId}
        tasks={props.tasks}
      />
    ),
    tags: (
      <TagFields
        tags={props.tags}
        value={path}
        onChange={(next) => changePath(next)}
      />
    ),
    fase: showPhase && <PhaseField value={phase} onChange={changePhase} />,
    'selecoes-caminho': (
      <SelectionChoices
        selections={choices.onPath}
        valueOf={choices.valueOf}
        onChange={changeChoice}
      />
    ),
    'selecoes-gerais': (
      <SelectionChoices
        selections={choices.general}
        valueOf={choices.valueOf}
        onChange={changeChoice}
      />
    ),
    medida: (
      <>
        <MeasureFields
          measure={measure.measure}
          texts={measure.texts}
          onChange={measure.change}
        />
        {measureNote && (
          <p
            data-work-field=""
            className="font-texto text-meta [overflow-wrap:anywhere] text-tinta-suave"
          >
            {measureNote}
          </p>
        )}
      </>
    ),
    link: (
      <label data-link-field="" className="flex flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">Link (opcional)</span>
        <input
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={2000}
          value={link}
          onChange={(event) => changeLink(event.target.value)}
          className={fieldClass}
        />
      </label>
    ),
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
      {FORM_FIELD_ORDER.map((field) => (
        <Fragment key={field}>{blocks[field]}</Fragment>
      ))}
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
