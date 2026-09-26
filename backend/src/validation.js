import { z } from 'zod'

// Devolve { data } com o corpo já limpo, ou { error } com a mensagem do
// primeiro problema encontrado
export function validate(schema, body) {
  const result = schema.safeParse(body ?? {})
  if (!result.success) return { error: result.error.issues[0].message }
  return { data: result.data }
}

export function isUuid(value) {
  return z.uuid().safeParse(value).success
}

// Só ISO completo com Z ou fuso; gravado sempre normalizado em UTC
export function isoDateTime(message) {
  return z.iso
    .datetime({ offset: true, error: message })
    .transform((iso) => new Date(iso).toISOString())
}
