// Apaga registros de teste com tudo o que depende deles, na ordem das FKs. Toda
// tabela nova que aponte pro registro entra aqui, num lugar só
const CHILDREN = [
  'execution_selections',
  'execution_exercises',
  'execution_workouts',
  'execution_measure_values',
  'execution_measures',
  'task_execution_tags',
  'time_entries',
]

export async function deleteExecutions(pool, ids) {
  await pool.query(
    `DELETE FROM exercise_sets WHERE execution_exercise_id IN
       (SELECT id FROM execution_exercises WHERE task_execution_id = ANY($1::uuid[]))`,
    [ids],
  )
  for (const table of CHILDREN) {
    await pool.query(`DELETE FROM ${table} WHERE task_execution_id = ANY($1::uuid[])`, [ids])
  }
  await pool.query('DELETE FROM task_executions WHERE id = ANY($1::uuid[])', [ids])
}
