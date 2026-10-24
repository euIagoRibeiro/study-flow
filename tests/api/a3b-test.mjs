// Bateria da A3b (API do treino). Uso (raiz do repo):
//   node --env-file=backend/.env <este arquivo>
// Cria a própria árvore (prefixo teste-a3b), exercícios e tarefa; apaga
// tudo no finally (pg), esperando a API antes de cada pedido.
import { join } from 'node:path'

import pg from 'pg'
import { API } from '../config.mjs'
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const P = 'teste-a3b'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? ` (${detail})` : ''}`)
}
async function waitForApi() {
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(`${API}/tasks`)).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('API não respondeu em 30s')
}
async function api(method, path, body) {
  await waitForApi()
  const res = await fetch(API + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = { error: text.slice(0, 80) } }
  return { status: res.status, body: parsed }
}
const detail = (r) => `status ${r.status}${r.body?.error ? `: ${r.body.error}` : ''}`
const tag = async (name, parentId = null) => (await api('POST', '/tags', { name, parentId })).body
// Treino resumido: "nome:reps×kg,reps×kg|nome:..."
let names = new Map()
const brief = (w) => w === null || w === undefined ? String(w)
  : w.map((x) => `${names.get(x.exerciseId) ?? '?'}:${x.sets.map((s) => `${s.reps}×${s.weightKg ?? '-'}`).join(',')}`).join('|')

let taskId = null
try {
  // Árvore: E › A (treino) › AP; E › C (treino); E › R (sem); M (raiz com
  // treino); X (vai ser arquivada)
  const E = await tag(`${P} exer`)
  const A = await tag('academia', E.id)
  const AP = await tag('peito', A.id)
  const AQ = await tag('costas', A.id)
  const C = await tag('casa', E.id)
  const R = await tag('corrida', E.id)
  const M = await tag(`${P} raiz`)
  const L = await tag('academia folha', E.id)
  const X = await tag(`${P} arq`)
  await api('PATCH', `/tags/${X.id}`, { active: false })
  taskId = (await api('POST', '/tasks', { title: `${P} tarefa` })).body.id

  // --- tracksWorkout nas tags
  let r = await api('PATCH', `/tags/${A.id}`, { tracksWorkout: true })
  check('marcar treino em nível 2 (academia)', r.status === 200 && r.body.tracksWorkout === true, detail(r))
  await api('PATCH', `/tags/${C.id}`, { tracksWorkout: true })
  await api('PATCH', `/tags/${M.id}`, { tracksWorkout: true })
  await api('PATCH', `/tags/${L.id}`, { tracksWorkout: true })
  r = await api('PATCH', `/tags/${AQ.id}`, { tracksWorkout: true })
  check('marcar treino em nível 3 (costas, dentro de academia marcada)', r.status === 200, detail(r))
  r = await api('PATCH', `/tags/${X.id}`, { tracksWorkout: true })
  check('marcar treino em tag arquivada: 400', r.status === 400, detail(r))
  r = await api('GET', '/tags')
  check('GET /tags traz tracksWorkout', r.body.find((t) => t.id === A.id)?.tracksWorkout === true &&
    r.body.find((t) => t.id === R.id)?.tracksWorkout === false)

  // --- Catálogo
  r = await api('POST', '/exercises', { name: `  ${P} Puxada alta com barra ` })
  const X1 = r.body
  check('criar exercício (nome aparado)', r.status === 201 && X1?.name === `${P} Puxada alta com barra` && X1.active === true, detail(r))
  const X2 = (await api('POST', '/exercises', { name: `${P} Rosca martelo unilateral` })).body
  const X3 = (await api('POST', '/exercises', { name: `${P} Agachamento` })).body
  const X4 = (await api('POST', '/exercises', { name: `${P} Nunca usado` })).body
  const X5 = (await api('POST', '/exercises', { name: `${P} Vai arquivar` })).body
  names = new Map([[X1?.id, 'puxada'], [X2?.id, 'rosca'], [X3?.id, 'agach'], [X5?.id, 'arquivar']])
  r = await api('POST', '/exercises', { name: `${P} PUXADA alta com barra` })
  check('nome repetido sem diferenciar maiúscula: 409 com o existente', r.status === 409 && r.body?.exercise?.id === X1?.id, detail(r))
  r = await api('POST', '/exercises', { name: '   ' })
  check('nome em branco: 400', r.status === 400, detail(r))
  r = await api('POST', '/exercises', { name: 'x'.repeat(61) })
  check('nome com 61 caracteres: 400', r.status === 400, detail(r))
  r = await api('PATCH', `/exercises/${X3?.id}`, { name: `${P} Agachamento livre` })
  check('renomear', r.status === 200 && r.body.name === `${P} Agachamento livre`, detail(r))
  r = await api('PATCH', `/exercises/${X3?.id}`, { name: `${P} puxada alta com barra` })
  check('renomear pra nome existente: 409', r.status === 409, detail(r))
  r = await api('GET', '/exercises')
  check('GET /exercises', r.status === 200 && Array.isArray(r.body) && r.body.some((x) => x.id === X1?.id), detail(r))

  // --- Registros
  const exec = async (rootTagId, tagIds, completedAt = new Date().toISOString()) =>
    (await api('POST', '/executions', { taskId, description: `${P} reg`, completedAt, rootTagId, tagIds })).body
  const eA = await exec(E.id, [A.id])
  const eAP = await exec(E.id, [AP.id])
  const eC = await exec(E.id, [C.id])
  const eR = await exec(E.id, [R.id])
  const eM = await exec(M.id, [])
  const eNone = await exec(null, [])
  const eL = await exec(E.id, [L.id])
  const eAQ = await exec(E.id, [AQ.id])
  check('registro novo vem com workout null', eA?.workout === null, JSON.stringify(eA?.workout))
  const W = (path, workout) => api('PUT', `/executions/${path}/workout`, { workout })
  const notes = [
    { exerciseId: X1?.id, sets: [{ reps: 12, weightKg: 25 }, { reps: 8, weightKg: 35 }, { reps: 8, weightKg: 50 }] },
    { exerciseId: X2?.id, sets: [{ reps: 8, weightKg: 8 }, { reps: 8, weightKg: 8 }] },
  ]

  // --- PUT /executions/:id/workout
  r = await W(eA?.id, notes)
  check('treino em academia (sessão das notas)', r.status === 200 && brief(r.body.workout) === 'puxada:12×25,8×35,8×50|rosca:8×8,8×8', `${detail(r)} ${brief(r.body?.workout)}`)
  check('resposta traz timeEntries', Array.isArray(r.body?.timeEntries))
  r = await api('GET', '/executions')
  check('GET /executions traz o treino, em ordem', brief(r.body.find((e) => e.id === eA?.id)?.workout) === 'puxada:12×25,8×35,8×50|rosca:8×8,8×8')
  r = await W(eAP?.id, [{ exerciseId: X3?.id, sets: [{ reps: 15, weightKg: null }] }])
  check('herança: academia › peito; peso do corpo (null)', r.status === 200 && brief(r.body.workout) === 'agach:15×-', detail(r))
  r = await W(eAQ?.id, [{ exerciseId: X1?.id, sets: [{ reps: 6, weightKg: 40 }] }])
  const marker = (await pool.query('SELECT tag_id FROM execution_workouts WHERE task_execution_id = $1', [eAQ?.id])).rows[0]?.tag_id
  check('duas marcadas no caminho (academia › costas): a marcadora é a mais funda', r.status === 200 && marker === AQ.id, `${detail(r)} ${marker === A.id ? 'academia' : marker}`)
  r = await W(eC?.id, [{ exerciseId: X3?.id, sets: [{ reps: 10, weightKg: null }] }])
  check('casa; o mesmo exercício em outro registro', r.status === 200, detail(r))
  r = await W(eM?.id, [{ exerciseId: X1?.id, sets: [{ reps: 5, weightKg: 22.5 }] }])
  check('marcadora é a própria raiz; peso 22,5', r.status === 200 && brief(r.body.workout) === 'puxada:5×22.5', detail(r))
  r = await W(eR?.id, notes)
  check('corrida (sem marca): 400', r.status === 400, detail(r))
  r = await W(eNone?.id, notes)
  check('registro sem tag: 400', r.status === 400, detail(r))
  r = await W('00000000-0000-4000-8000-000000000000', notes)
  check('registro que não existe: 404', r.status === 404, detail(r))

  // --- Validações
  const bad = [
    ['exercício repetido na sessão', [notes[0], { exerciseId: X1?.id, sets: [{ reps: 1, weightKg: null }] }]],
    ['exercício sem série', [{ exerciseId: X1?.id, sets: [] }]],
    ['exercício que não existe', [{ exerciseId: '00000000-0000-4000-8000-000000000000', sets: [{ reps: 1, weightKg: null }] }]],
    ['0 repetições', [{ exerciseId: X1?.id, sets: [{ reps: 0, weightKg: 10 }] }]],
    ['repetições fracionadas', [{ exerciseId: X1?.id, sets: [{ reps: 8.5, weightKg: 10 }] }]],
    ['1001 repetições', [{ exerciseId: X1?.id, sets: [{ reps: 1001, weightKg: 10 }] }]],
    ['peso 0', [{ exerciseId: X1?.id, sets: [{ reps: 8, weightKg: 0 }] }]],
    ['peso negativo', [{ exerciseId: X1?.id, sets: [{ reps: 8, weightKg: -5 }] }]],
    ['peso com 3 casas (22,555)', [{ exerciseId: X1?.id, sets: [{ reps: 8, weightKg: 22.555 }] }]],
    ['peso acima de 9999,99', [{ exerciseId: X1?.id, sets: [{ reps: 8, weightKg: 10000 }] }]],
    ['51 séries', [{ exerciseId: X1?.id, sets: Array.from({ length: 51 }, () => ({ reps: 1, weightKg: null })) }]],
    ['workout que não é lista', 'x'],
  ]
  for (const [name, workout] of bad) {
    r = await W(eA?.id, workout)
    check(`${name}: 400`, r.status === 400, detail(r))
  }
  r = await api('PUT', `/executions/${eA?.id}/workout`, {})
  check('sem workout no corpo: 400', r.status === 400, detail(r))
  r = await W(eA?.id, Array.from({ length: 31 }, () => ({ exerciseId: X1?.id, sets: [{ reps: 1, weightKg: null }] })))
  check('31 exercícios: 400', r.status === 400, detail(r))
  check('nada mudou depois das recusas', brief((await api('GET', '/executions')).body.find((e) => e.id === eA?.id)?.workout) === 'puxada:12×25,8×35,8×50|rosca:8×8,8×8')

  // --- Arquivado: mantido se já estava, recusado se novo
  r = await W(eAP?.id, [{ exerciseId: X3?.id, sets: [{ reps: 15, weightKg: null }] }, { exerciseId: X5?.id, sets: [{ reps: 3, weightKg: 4 }] }])
  check('pôr o exercício que vai ser arquivado', r.status === 200, detail(r))
  r = await api('PATCH', `/exercises/${X5?.id}`, { active: false })
  check('arquivar exercício', r.status === 200 && r.body.active === false, detail(r))
  r = await W(eAP?.id, [{ exerciseId: X5?.id, sets: [{ reps: 4, weightKg: 4 }] }, { exerciseId: X3?.id, sets: [{ reps: 15, weightKg: null }] }])
  check('arquivado que já estava: mantido (e a ordem troca)', r.status === 200 && brief(r.body.workout) === 'arquivar:4×4|agach:15×-', `${detail(r)} ${brief(r.body?.workout)}`)
  r = await W(eC?.id, [{ exerciseId: X5?.id, sets: [{ reps: 1, weightKg: null }] }])
  check('arquivado novo no registro: 400', r.status === 400, detail(r))

  // --- Catálogo: apagar
  r = await api('DELETE', `/exercises/${X1?.id}`)
  check('apagar exercício usado: 409', r.status === 409, detail(r))
  r = await api('DELETE', `/exercises/${X4?.id}`)
  check('apagar exercício nunca usado: 204', r.status === 204, detail(r))

  // --- Registro aberto
  const open = (await api('POST', '/executions', { taskId, description: null, completedAt: null })).body
  r = await api('PUT', `/executions/${open?.id}`, { description: null, completedAt: null, rootTagId: E.id, tagIds: [A.id], phase: null })
  check('caminho salvo na hora no registro aberto (PUT existente)', r.status === 200 && r.body.completedAt === null, detail(r))
  r = await W(open?.id, [{ exerciseId: X1?.id, sets: [{ reps: 10, weightKg: 30 }] }])
  check('treino ao vivo no registro aberto', r.status === 200 && r.body.completedAt === null && brief(r.body.workout) === 'puxada:10×30', detail(r))
  r = await W(open?.id, [{ exerciseId: X1?.id, sets: [{ reps: 10, weightKg: 30 }, { reps: 10, weightKg: 30 }] }])
  check('"+ série igual" (lista inteira de novo)', r.status === 200 && brief(r.body.workout) === 'puxada:10×30,10×30', detail(r))
  r = await api('PUT', `/executions/${open?.id}`, { description: 'feito', completedAt: new Date().toISOString(), rootTagId: E.id, tagIds: [A.id], phase: null })
  check('finalizar sem workout mantém o treino', r.status === 200 && brief(r.body.workout) === 'puxada:10×30,10×30', `${detail(r)} ${brief(r.body?.workout)}`)

  // --- Dois pedidos ao mesmo tempo: um vence inteiro, sem 500
  const one = [{ exerciseId: X1?.id, sets: [{ reps: 1, weightKg: 1 }] }]
  const two = [{ exerciseId: X2?.id, sets: [{ reps: 2, weightKg: 2 }, { reps: 2, weightKg: 2 }] }]
  const [ra, rb] = await Promise.all([W(open?.id, one), W(open?.id, two)])
  const final = brief((await api('GET', '/executions')).body.find((e) => e.id === open?.id)?.workout)
  check('dois PUT simultâneos: os dois 200, o final é um deles inteiro', ra.status === 200 && rb.status === 200 &&
    ['puxada:1×1', 'rosca:2×2,2×2'].includes(final), `${ra.status} ${rb.status} ${final}`)

  // --- PUT geral: aceita workout; sem workout mantém; caminho tira o treino
  const now = new Date().toISOString()
  r = await api('PUT', `/executions/${eC?.id}`, { description: 'editado', completedAt: now })
  check('PUT geral sem workout (sem tags) mantém', r.status === 200 && brief(r.body.workout) === 'agach:10×-', `${detail(r)} ${brief(r.body?.workout)}`)
  r = await api('PUT', `/executions/${eC?.id}`, { description: 'editado', completedAt: now, rootTagId: E.id, tagIds: [C.id],
    workout: [{ exerciseId: X3?.id, sets: [{ reps: 12, weightKg: null }] }] })
  check('PUT geral com workout substitui', r.status === 200 && brief(r.body.workout) === 'agach:12×-', `${detail(r)} ${brief(r.body?.workout)}`)
  r = await api('PUT', `/executions/${eC?.id}`, { description: 'editado', completedAt: now, rootTagId: E.id, tagIds: [R.id] })
  check('trocar a subtag pra corrida (marcadora sai do caminho): treino removido', r.status === 200 && r.body.workout === null, `${detail(r)} ${brief(r.body?.workout)}`)
  r = await api('PUT', `/executions/${eM?.id}`, { description: 'editado', completedAt: now, rootTagId: E.id, tagIds: [A.id] })
  check('trocar a raiz (M → E): treino da raiz antiga removido', r.status === 200 && r.body.workout === null, `${detail(r)} ${brief(r.body?.workout)}`)
  r = await api('PUT', `/executions/${eAP?.id}`, { description: 'editado', completedAt: now, rootTagId: E.id, tagIds: [A.id] })
  check('de academia › peito pra academia: a marcadora continua, treino mantido', r.status === 200 && brief(r.body.workout) === 'arquivar:4×4|agach:15×-', `${detail(r)} ${brief(r.body?.workout)}`)
  r = await api('PUT', `/executions/${eA?.id}`, { description: 'editado', completedAt: now, workout: [] })
  check('workout [] remove', r.status === 200 && r.body.workout === null, detail(r))
  r = await api('PUT', `/executions/${eR?.id}`, { description: 'editado', completedAt: now, workout: notes })
  check('PUT geral com workout em corrida: 400', r.status === 400, detail(r))

  // --- Tags: desmarcar e apagar marcadora usada
  r = await api('PATCH', `/tags/${A.id}`, { tracksWorkout: false })
  check('desmarcar treino de tag usada: 409', r.status === 409, detail(r))
  r = await W(eL?.id, [{ exerciseId: X2?.id, sets: [{ reps: 6, weightKg: 6 }] }])
  check('treino na marcadora-folha', r.status === 200, detail(r))
  r = await api('DELETE', `/tags/${L.id}`)
  check('apagar tag marcadora usada (folha): 409 "em uso", não 500', r.status === 409 && /em uso/.test(r.body?.error ?? ''), detail(r))
  r = await api('PATCH', `/tags/${M.id}`, { tracksWorkout: false })
  check('desmarcar tag sem treino em uso', r.status === 200 && r.body.tracksWorkout === false, detail(r))
} catch (err) {
  check('rodou sem erro', false, err.stack?.split('\n').slice(0, 2).join(' '))
} finally {
  await waitForApi()
  const execs = `SELECT id FROM task_executions WHERE task_id IN (SELECT id FROM tasks WHERE title LIKE '${P}%')`
  await pool.query(`DELETE FROM exercise_sets WHERE execution_exercise_id IN (SELECT id FROM execution_exercises WHERE task_execution_id IN (${execs}))`)
  await pool.query(`DELETE FROM execution_exercises WHERE task_execution_id IN (${execs})`)
  await pool.query(`DELETE FROM execution_workouts WHERE task_execution_id IN (${execs})`).catch(() => {})
  await pool.query(`DELETE FROM time_entries WHERE task_execution_id IN (${execs})`)
  await pool.query(`DELETE FROM task_execution_tags WHERE task_execution_id IN (${execs})`)
  await pool.query(`DELETE FROM task_executions WHERE task_id IN (SELECT id FROM tasks WHERE title LIKE '${P}%')`)
  await pool.query(`DELETE FROM tasks WHERE title LIKE '${P}%'`)
  await pool.query(`DELETE FROM exercises WHERE name LIKE '${P}%'`)
  const roots = `SELECT id FROM tags WHERE parent_id IS NULL AND name LIKE '${P}%'`
  await pool.query(`DELETE FROM tags WHERE level = 3 AND root_id IN (${roots})`)
  await pool.query(`DELETE FROM tags WHERE level = 2 AND root_id IN (${roots})`)
  await pool.query(`DELETE FROM tags WHERE parent_id IS NULL AND name LIKE '${P}%'`)
  const left = await pool.query(
    `SELECT (SELECT count(*) FROM tags WHERE name LIKE '${P}%')::int + (SELECT count(*) FROM tasks WHERE title LIKE '${P}%')::int +
            (SELECT count(*) FROM exercises WHERE name LIKE '${P}%')::int + (SELECT count(*) FROM execution_workouts WHERE task_execution_id IN (${execs}))::int AS n`)
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
