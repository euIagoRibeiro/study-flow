import type { Phase } from './types'

// Na ordem do trabalho (a mesma do enum no banco)
export const phases: Phase[] = [
  'requisitos',
  'prototipo',
  'validacao',
  'implementacao',
]

export const phaseLabels: Record<Phase, string> = {
  requisitos: 'Requisitos',
  prototipo: 'Protótipo',
  validacao: 'Validação',
  implementacao: 'Implementação',
}
