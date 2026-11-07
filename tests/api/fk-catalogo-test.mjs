// Catálogo de FKs × rotas de apagar. Uso (raiz do repo):
//   node --env-file=backend/.env <este arquivo>
// Qual FK recusa primeiro depende de como o banco foi construído (a FK antiga
// dispara no original, outra depois de pg_dump/restore), e a que não está traduzida
// vira 500 só no banco restaurado. Aqui toda FK que aponta pra tabela com rota de
// apagar tem que estar na lista, com o trecho do código que a traduz. FK nova sem
// entrada falha; tradução apagada do código também falha.
// Depois, a prova forçada do `measure_kinds_measure` (tipo criado no meio do apagar).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { API, TESTS } from '../config.mjs'
import { apiFetch } from '../sessao.mjs'
const { Pool } = pg
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (a limpeza usa o banco)')
  process.exit(2)
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-fk'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}

// Por tabela com rota de apagar: FK → o trecho que a traduz no arquivo da rota.
// null = a rota apaga as filhas antes e a concorrência faz fila; o motivo vem em SEM_TRADUCAO
const ROUTES = {
  tags: ['tags.js', {
    task_executions_root_tag_is_root: 'task_executions_root_tag_is_root',
    task_executions_phase_root_tracks: 'task_executions_phase_root_tracks',
    task_execution_tags_tag_in_root: 'task_execution_tags_',
    task_execution_tags_tag_parent: 'task_execution_tags_',
    execution_measures_tag_in_root: 'execution_measures_',
    execution_selections_tag_in_root: 'execution_selections_',
    execution_workouts_tag_in_root: 'execution_workouts_',
    execution_workouts_tag_marked: 'execution_workouts_',
    measures_tag: 'measures_tag',
    selections_tag: 'selections_tag',
    works_default_tag: 'works_default_tag',
    tags_parent_one_level_up: "startsWith('tags_')",
    tags_same_root_as_parent: "startsWith('tags_')",
  }],
  measures: ['measures.js', {
    execution_measures_measure_tag: 'execution_measures_measure_tag',
    works_measure: 'works_measure',
    measure_kinds_measure: 'measure_kinds_measure',
  }],
  measure_kinds: ['measures.js', {
    execution_measure_values_kind_of_measure: 'execution_measure_values_kind_of_measure',
  }],
  selections: ['selections.js', {
    execution_selections_global: 'execution_selections_',
    execution_selections_multiple: 'execution_selections_',
    execution_selections_selection_tag: 'execution_selections_',
    selection_options_selection: null,
  }],
  selection_options: ['selections.js', {
    execution_selections_option_in_selection: 'execution_selections_option_in_selection',
  }],
  exercises: ['exercises.js', {
    execution_exercises_exercise: 'execution_exercises_exercise',
  }],
  works: ['works.js', {
    task_executions_work: 'task_executions_work',
  }],
}
const SEM_TRADUCAO = {
  selection_options_selection: 'POST /selection-options trava a seleção antes de inserir: faz fila com o DELETE',
}
// LISTA ABERTA: sem rota de apagar hoje. Quando o "Descartar registro" chegar, a
// tabela entra em ROUTES com as FKs que ele puder encontrar
const SEM_ROTA = ['task_executions', 'tasks', 'execution_exercises', 'execution_measures', 'execution_workouts', 'task_execution_tags']

const hold = await pool.connect()
try {
  const { rows } = await pool.query(`
    SELECT confrelid::regclass::text AS alvo, conname FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace
    ORDER BY 1, 2`)
  check('o catálogo tem FKs', rows.length > 30, `${rows.length}`)

  // Toda rota DELETE do backend tem a tabela em ROUTES
  const deletes = readdirSync(join(TESTS, '..', 'backend', 'src', 'routes'))
    .flatMap((f) => [...readFileSync(join(TESTS, '..', 'backend', 'src', 'routes', f), 'utf8').matchAll(/(\w+)Router\.delete\(/g)].map((m) => m[1]))
    .sort()
  const expected = ['exercises', 'measureKinds', 'measures', 'selectionOptions', 'selections', 'tags', 'works']
  check('rotas DELETE do backend = as da lista', deletes.join() === expected.join(), deletes.join())

  for (const [table, [file, fks]] of Object.entries(ROUTES)) {
    const inCatalog = rows.filter((r) => r.alvo === table).map((r) => r.conname).sort()
    const listed = Object.keys(fks).sort()
    check(`${table}: lista igual ao catálogo (${inCatalog.length} FKs)`, inCatalog.join() === listed.join(),
      `só no banco: ${inCatalog.filter((x) => !listed.includes(x))}; só na lista: ${listed.filter((x) => !inCatalog.includes(x))}`)
    const code = readFileSync(join(TESTS, '..', 'backend', 'src', 'routes', file), 'utf8')
    for (const [fk, text] of Object.entries(fks)) {
      if (text === null) check(`${table}: ${fk} sem tradução, com motivo`, Boolean(SEM_TRADUCAO[fk]))
      else check(`${table}: ${fk} traduzida em ${file}`, code.includes(text), `não achei ${text}`)
    }
  }
  const others = [...new Set(rows.map((r) => r.alvo))].filter((t) => !ROUTES[t])
  check('toda tabela alvo de FK está em ROUTES ou na lista aberta', others.every((t) => SEM_ROTA.includes(t)), others.join())
  console.log(`      lista aberta, sem rota de apagar: ${SEM_ROTA.map((t) => `${t} (${rows.filter((r) => r.alvo === t).length})`).join(', ')}`)

  // Prova forçada: tipo criado no meio do DELETE da medida
  const blocked = async (mine) => {
    for (let i = 0; i < 300; i++) {
      const r = await pool.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> $1`, [mine])
      if (r.rows[0].n >= 1) return true
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    return false
  }
  const call = async (method, path, body) => {
    const res = await apiFetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }
  const mine = (await hold.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
  const tag = (await call('POST', '/tags', { name: `${P} tag` })).body
  const measure = (await call('POST', '/measures', { tagId: tag.id, name: 'x', singular: 'x', allowsDecimal: false, kinds: ['velho'] })).body
  const scenario = async (end) => {
    await hold.query('BEGIN')
    await hold.query(`INSERT INTO measure_kinds (measure_id, name) VALUES ($1, 'novo')`, [measure.id])
    const del = call('DELETE', `/measures/${measure.id}`)
    const stopped = await blocked(mine)
    await hold.query(end)
    return { stopped, d: await del }
  }
  let { stopped, d } = await scenario('COMMIT')
  check('tipo no meio: DELETE parado (pg_stat_activity)', stopped)
  check('tipo no meio: 409 amigável', d.status === 409 && /tipo/.test(d.body?.error ?? ''), `${d.status} ${JSON.stringify(d.body)}`)
  const kinds = (await pool.query('SELECT name FROM measure_kinds WHERE measure_id = $1 ORDER BY name', [measure.id])).rows.map((r) => r.name).join()
  check('tipo no meio: a medida fica inteira, com os dois tipos', kinds === 'novo,velho', kinds)
  await pool.query(`DELETE FROM measure_kinds WHERE measure_id = $1 AND name = 'novo'`, [measure.id])
  ;({ stopped, d } = await scenario('ROLLBACK'))
  check('tipo desfeito: DELETE parado', stopped)
  check('tipo desfeito: 204', d.status === 204, `${d.status} ${JSON.stringify(d.body)}`)
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  await hold.query('ROLLBACK').catch(() => {})
  hold.release()
  await pool.query(`DELETE FROM measure_kinds WHERE measure_id IN (SELECT m.id FROM measures m JOIN tags t ON t.id = m.tag_id WHERE t.name LIKE '${P}%')`)
  await pool.query(`DELETE FROM measures WHERE tag_id IN (SELECT id FROM tags WHERE name LIKE '${P}%')`)
  await pool.query(`DELETE FROM tags WHERE name LIKE '${P}%'`)
  const left = await pool.query(`SELECT count(*)::int AS n FROM tags WHERE name LIKE '${P}%'`)
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
