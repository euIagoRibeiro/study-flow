// Os campos do Registrar que o "Iniciar cronômetro" NÃO leva (só valem no Registrar). Módulo SEM imports: o
// teste de unidade (tests/unidade/manual-campos.mjs) o importa direto, sem navegador nem build.
export const MANUAL_FIELDS = {
  when: 'Quando',
  estimate: 'Duração estimada',
  measure: 'Medida',
} as const

// "Quando", "Quando e Duração estimada", "Quando, Duração estimada e Medida"
export function joinFields(fields: string[]): string {
  if (fields.length <= 1) return fields.join('')
  return `${fields.slice(0, -1).join(', ')} e ${fields[fields.length - 1]}`
}
