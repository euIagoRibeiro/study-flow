// Dados das baterias das medidas do Painel (telas/medidas-painel, layout/medidas-layout) e da conferência
// visual: semana de 07/04/2025 (o seed nunca cai lá), ids com o prefixo a0f2 a a0f6, apagados no fim.
// Contas à mão (período = 07 a 13/04/2025):
//   Páginas  (tipo Lidas)         1000 Lidas + 1 sem tipo            = 1.001 em 1 registro (100%, <1%)
//   Questões (Acertos, Erros)     80 + 20 + 5 sem tipo (2 registros) = 105 (76%, 19%, 5%)
//   Km       (decimal, sem tipos) 5,5 + 2,25 (2 registros)           = 7,75, sem tabela
//   Etapas   (Kx, Ky, Kz)         1 + 1 + 1 em 1 registro            = 3 (33% três vezes: soma 99%)
//   Capítulos (sem tipos)         1 em 1 registro                    = 1, sem tabela, no singular
// Dia 08/04: só o registro 1 de Questões (Acertos 80, Erros 20 = 100).
const u = (p, n) => `00000000-0000-4000-${p}-${String(n).padStart(12, '0')}`
const local = (t) => new Date(`${t.replace(' ', 'T')}:00-03:00`)
export const WEEK = '2025-04-07'
export const TABLES = ['tags', 'measures', 'measure_kinds', 'tasks', 'task_executions',
  'task_execution_tags', 'execution_measures', 'execution_measure_values']

// Contagens totais das tabelas mexidas (pra conferir que voltaram ao valor de antes)
export async function counts(pool) {
  const out = {}
  for (const table of TABLES) out[table] = (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n
  return out
}

// Linhas com o prefixo dos dados temporários, por tabela (tem que ser 0 no fim)
export async function leftovers(pool) {
  const like = (col) => `${col}::text LIKE '00000000-0000-4000-a0f_-%'`
  const q = async (sql) => (await pool.query(sql)).rows[0].n
  const n = {
    tags: await q(`SELECT count(*)::int AS n FROM tags WHERE ${like('id')}`),
    measures: await q(`SELECT count(*)::int AS n FROM measures WHERE ${like('id')}`),
    measure_kinds: await q(`SELECT count(*)::int AS n FROM measure_kinds WHERE ${like('id')}`),
    tasks: await q(`SELECT count(*)::int AS n FROM tasks WHERE ${like('id')}`),
    task_executions: await q(`SELECT count(*)::int AS n FROM task_executions WHERE ${like('id')}`),
    task_execution_tags: await q(`SELECT count(*)::int AS n FROM task_execution_tags WHERE ${like('task_execution_id')}`),
    execution_measures: await q(`SELECT count(*)::int AS n FROM execution_measures WHERE ${like('task_execution_id')}`),
    execution_measure_values: await q(`SELECT count(*)::int AS n FROM execution_measure_values WHERE ${like('task_execution_id')}`),
  }
  return n
}

export async function cleanMedidas(pool) {
  const ex = `task_execution_id::text LIKE '00000000-0000-4000-a0f5-%'`
  await pool.query(`DELETE FROM execution_measure_values WHERE ${ex}`)
  await pool.query(`DELETE FROM execution_measures WHERE ${ex}`)
  await pool.query(`DELETE FROM task_execution_tags WHERE ${ex}`)
  await pool.query(`DELETE FROM task_executions WHERE id::text LIKE '00000000-0000-4000-a0f5-%'`)
  await pool.query(`DELETE FROM measure_kinds WHERE id::text LIKE '00000000-0000-4000-a0f4-%'`)
  await pool.query(`DELETE FROM measures WHERE id::text LIKE '00000000-0000-4000-a0f3-%'`)
  await pool.query(`DELETE FROM tags WHERE id::text LIKE '00000000-0000-4000-a0f2-%'`)
  await pool.query(`DELETE FROM tasks WHERE id::text LIKE '00000000-0000-4000-a0f6-%'`)
}

export async function seedMedidas(pool, { longNames = false } = {}) {
  await cleanMedidas(pool)
  const name = (short, long) => (longNames ? long : short)
  const tagNames = ['MD R1', 'MD R2', 'MD R3', 'MD R4', 'MD R5']
  for (const [i, tagName] of tagNames.entries()) {
    await pool.query(`INSERT INTO tags (id, name, level, parent_id, root_id) VALUES ($1, $2, 1, NULL, NULL)`, [u('a0f2', i + 1), tagName])
  }
  // M1 em R1, M2 em R2, M3 em R3, M4 em R4, M5 em R5
  const measures = [
    [1, 1, name('Questões', 'Questoesdeprovasanterioresdovv'), 'questão', false],
    [2, 2, 'Km', 'km', true],
    [3, 3, name('Páginas', 'Paginaslidasdolivrotecnicomuit'), 'página', false],
    [4, 4, 'Etapas', 'etapa', false],
    [5, 5, 'Capítulos', 'capítulo', false],
  ]
  for (const [n, tag, measureName, singular, decimal] of measures) {
    await pool.query('INSERT INTO measures (id, tag_id, name, singular, allows_decimal) VALUES ($1, $2, $3, $4, $5)',
      [u('a0f3', n), u('a0f2', tag), measureName, singular, decimal])
  }
  const kinds = [
    [1, 1, name('Acertos', 'Acertosemquestoesdeprovasanter')], [2, 1, 'Erros'],
    [3, 3, 'Lidas'],
    [4, 4, 'Kx'], [5, 4, 'Ky'], [6, 4, 'Kz'],
  ]
  for (const [n, measure, kindName] of kinds) {
    await pool.query('INSERT INTO measure_kinds (id, measure_id, name) VALUES ($1, $2, $3)', [u('a0f4', n), u('a0f3', measure), kindName])
  }
  await pool.query(`INSERT INTO tasks (id, title) VALUES ($1, 'MD tarefa')`, [u('a0f6', 1)])
  const reg = async (n, root, when, measure) => {
    await pool.query(
      `INSERT INTO task_executions (id, task_id, task_title_at_time, task_frequency_at_time, completed_at, root_tag_id)
       VALUES ($1, $2, 'MD tarefa', 'none', $3, $4)`, [u('a0f5', n), u('a0f6', 1), local(when), u('a0f2', root)])
    await pool.query('INSERT INTO execution_measures (task_execution_id, measure_id, tag_id, root_tag_id) VALUES ($1, $2, $3, $3)',
      [u('a0f5', n), u('a0f3', measure), u('a0f2', root)]) // declarante = a raiz do registro
  }
  const val = (n, measure, kind, quantity) => pool.query(
    'INSERT INTO execution_measure_values (task_execution_id, measure_id, kind_id, quantity) VALUES ($1, $2, $3, $4)',
    [u('a0f5', n), u('a0f3', measure), kind === 0 ? null : u('a0f4', kind), quantity])
  await reg(1, 1, '2025-04-08 12:00', 1); await val(1, 1, 1, 80); await val(1, 1, 2, 20)
  await reg(2, 1, '2025-04-09 12:00', 1); await val(2, 1, 0, 5)
  await reg(3, 2, '2025-04-10 12:00', 2); await val(3, 2, 0, 5.5)
  await reg(4, 2, '2025-04-11 12:00', 2); await val(4, 2, 0, 2.25)
  await reg(5, 3, '2025-04-12 12:00', 3); await val(5, 3, 3, 1000); await val(5, 3, 0, 1)
  await reg(6, 4, '2025-04-13 12:00', 4); await val(6, 4, 4, 1); await val(6, 4, 5, 1); await val(6, 4, 6, 1)
  await reg(7, 5, '2025-04-13 13:00', 5); await val(7, 5, 0, 1)
}
