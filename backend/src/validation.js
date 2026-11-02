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

// URL opcional: vazio vira null, esquema em minúsculas e só http/https (vira
// link clicável, e javascript: não pode entrar). Regra igual à do banco
export function urlField(field) {
  return z
    .string(`${field} precisa ser texto`)
    .trim()
    .max(2000, `${field} pode ter no máximo 2000 caracteres`)
    .transform((text) =>
      text === '' ? null : text.replace(/^[a-z]+:/i, (s) => s.toLowerCase()),
    )
    .refine(
      (url) => url === null || /^https?:\/\/\S+$/.test(url),
      `${field} precisa ser um endereço http ou https`,
    )
    .nullable()
}

// Só ISO completo com Z ou fuso; gravado sempre normalizado em UTC
export function isoDateTime(message) {
  return z.iso
    .datetime({ offset: true, error: message })
    .transform((iso) => new Date(iso).toISOString())
}
