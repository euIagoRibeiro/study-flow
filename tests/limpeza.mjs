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

// A sessão rodando do seed, pausada pra bateria abrir a dela ("uma rodando no app")
export async function pauseRunning(pool) {
  const { rows } = await pool.query(
    `SELECT id, updated_at::text FROM time_entries WHERE ended_at IS NULL`,
  )
  await pool.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL')
  return rows
}

// Devolve a linha exata: com o trigger ligado, updated_at viraria a hora da
// restauração. Texto, não Date: o Date do JS corta os microssegundos
export async function resumeRunning(pool, rows) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('ALTER TABLE time_entries DISABLE TRIGGER time_entries_set_updated_at')
    for (const row of rows) {
      await client.query('UPDATE time_entries SET ended_at = NULL, updated_at = $2 WHERE id = $1', [row.id, row.updated_at])
    }
    await client.query('ALTER TABLE time_entries ENABLE TRIGGER time_entries_set_updated_at')
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
