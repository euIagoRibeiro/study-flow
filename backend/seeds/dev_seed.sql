-- Dados fictícios pro banco LOCAL, pra ver todas as funcionalidades com
-- volume realista. Nunca rodar em produção.
--
-- Ids fixos começando com 5eed: é o que permite o dev_unseed.sql remover
-- só esses dados, sem tocar nos seus.
-- Datas relativas a now() (constante dentro da transação): "feita hoje",
-- "últimos 7 dias" e o cronômetro rodando fazem sentido em qualquer dia.
-- Em transação: rodar duas vezes falha no primeiro INSERT (id repetido) e
-- desfaz tudo, sem duplicar nada.

BEGIN;

-- Tarefas: todas as frequências, uma renomeada (snapshot antigo diferente),
-- uma arquivada com histórico, uma sem nenhuma execução
INSERT INTO tasks (id, title, frequency, active, created_at) VALUES
  ('5eed0000-0000-4000-8000-000000000001', 'Estudar React',          'daily',   true,  now() - interval '60 days'),
  ('5eed0000-0000-4000-8000-000000000002', 'Revisar inglês',         'daily',   true,  now() - interval '59 days'),
  ('5eed0000-0000-4000-8000-000000000003', 'Estudar SQL e Postgres', 'weekly',  true,  now() - interval '58 days'),
  ('5eed0000-0000-4000-8000-000000000004', 'Ler livro técnico',      'weekly',  true,  now() - interval '57 days'),
  ('5eed0000-0000-4000-8000-000000000005', 'Organizar finanças',     'monthly', true,  now() - interval '56 days'),
  ('5eed0000-0000-4000-8000-000000000006', 'Exercício físico',       'none',    true,  now() - interval '55 days'),
  ('5eed0000-0000-4000-8000-000000000007', 'Curso de Docker',        'weekly',  false, now() - interval '54 days'),
  ('5eed0000-0000-4000-8000-000000000008', 'Ideias de projeto',      'none',    true,  now() - interval '53 days');

-- Execuções. completed_at NULL = em andamento (2: uma rodando, uma pausada)
INSERT INTO task_executions
  (id, task_id, description, task_title_at_time, task_frequency_at_time, completed_at)
VALUES
  -- Estudar React: feita hoje (grifo), ontem, sem descrição, antigas
  ('5eed0000-0000-4000-8000-000000000101', '5eed0000-0000-4000-8000-000000000001', 'Hooks: useEffect e função de limpeza', 'Estudar React', 'daily', now() - interval '2 hours'),
  ('5eed0000-0000-4000-8000-000000000102', '5eed0000-0000-4000-8000-000000000001', 'Componentes controlados',              'Estudar React', 'daily', now() - interval '1 day'),
  ('5eed0000-0000-4000-8000-000000000103', '5eed0000-0000-4000-8000-000000000001', NULL,                                   'Estudar React', 'daily', now() - interval '3 days'),
  ('5eed0000-0000-4000-8000-000000000104', '5eed0000-0000-4000-8000-000000000001', 'React Router: rotas aninhadas',        'Estudar React', 'daily', now() - interval '10 days'),
  ('5eed0000-0000-4000-8000-000000000105', '5eed0000-0000-4000-8000-000000000001', 'JSX e props',                          'Estudar React', 'daily', now() - interval '40 days'),

  -- Revisar inglês: uma EM ANDAMENTO com cronômetro rodando
  ('5eed0000-0000-4000-8000-000000000201', '5eed0000-0000-4000-8000-000000000002', NULL,                        'Revisar inglês', 'daily', NULL),
  ('5eed0000-0000-4000-8000-000000000202', '5eed0000-0000-4000-8000-000000000002', 'Podcast de 20 minutos',     'Revisar inglês', 'daily', now() - interval '1 day'),
  ('5eed0000-0000-4000-8000-000000000203', '5eed0000-0000-4000-8000-000000000002', NULL,                        'Revisar inglês', 'daily', now() - interval '2 days'),

  -- Estudar SQL e Postgres: as 2 antigas são de quando se chamava
  -- "Estudar SQL", sem frequência (o histórico mostra o nome antigo)
  ('5eed0000-0000-4000-8000-000000000301', '5eed0000-0000-4000-8000-000000000003', 'SELECT e JOIN',               'Estudar SQL',            'none',   now() - interval '45 days'),
  ('5eed0000-0000-4000-8000-000000000302', '5eed0000-0000-4000-8000-000000000003', 'GROUP BY e agregações',       'Estudar SQL',            'none',   now() - interval '35 days'),
  ('5eed0000-0000-4000-8000-000000000303', '5eed0000-0000-4000-8000-000000000003', 'Transações: BEGIN e ROLLBACK', 'Estudar SQL e Postgres', 'weekly', now() - interval '13 days'),
  ('5eed0000-0000-4000-8000-000000000304', '5eed0000-0000-4000-8000-000000000003', 'Índices parciais',            'Estudar SQL e Postgres', 'weekly', now() - interval '6 days'),

  -- Ler livro técnico: uma EM ANDAMENTO pausada (sessão encerrada, nenhuma rodando)
  ('5eed0000-0000-4000-8000-000000000401', '5eed0000-0000-4000-8000-000000000004', NULL,                   'Ler livro técnico', 'weekly', NULL),
  ('5eed0000-0000-4000-8000-000000000402', '5eed0000-0000-4000-8000-000000000004', 'Capítulo 3: testes',  'Ler livro técnico', 'weekly', now() - interval '8 days'),

  -- Organizar finanças: uma neste mês, outra no mês passado (filtros de período)
  ('5eed0000-0000-4000-8000-000000000501', '5eed0000-0000-4000-8000-000000000005', 'Planilha do mês',          'Organizar finanças', 'monthly', now() - interval '20 days'),
  ('5eed0000-0000-4000-8000-000000000502', '5eed0000-0000-4000-8000-000000000005', 'Planilha do mês anterior', 'Organizar finanças', 'monthly', now() - interval '50 days'),

  -- Exercício físico (avulsa): hoje sem cronômetro, outra com
  ('5eed0000-0000-4000-8000-000000000601', '5eed0000-0000-4000-8000-000000000006', 'Corrida de 5 km', 'Exercício físico', 'none', now() - interval '5 hours'),
  ('5eed0000-0000-4000-8000-000000000602', '5eed0000-0000-4000-8000-000000000006', 'Academia',        'Exercício físico', 'none', now() - interval '4 days'),

  -- Curso de Docker (arquivada): o histórico continua visível
  ('5eed0000-0000-4000-8000-000000000701', '5eed0000-0000-4000-8000-000000000007', 'Imagens e volumes', 'Curso de Docker', 'weekly', now() - interval '37 days'),
  ('5eed0000-0000-4000-8000-000000000702', '5eed0000-0000-4000-8000-000000000007', 'Docker Compose',    'Curso de Docker', 'weekly', now() - interval '30 days');

-- Sessões de cronômetro. Execuções sem nenhuma linha aqui = "Registrar"
-- direto, sem cronômetro. Várias linhas na mesma execução = pausas.
INSERT INTO time_entries (task_execution_id, started_at, ended_at) VALUES
  -- React hoje: 2 sessões com uma pausa no meio (30 + 30 min)
  ('5eed0000-0000-4000-8000-000000000101', now() - interval '3 hours 10 minutes', now() - interval '2 hours 40 minutes'),
  ('5eed0000-0000-4000-8000-000000000101', now() - interval '2 hours 30 minutes', now() - interval '2 hours'),
  -- React ontem: 45 min
  ('5eed0000-0000-4000-8000-000000000102', now() - interval '1 day 45 minutes', now() - interval '1 day'),
  -- Inglês em andamento: 1 sessão já pausada + a que está RODANDO (a única
  -- do app inteiro: o índice time_entries_one_running não deixa outra)
  ('5eed0000-0000-4000-8000-000000000201', now() - interval '1 hour 5 minutes', now() - interval '50 minutes'),
  ('5eed0000-0000-4000-8000-000000000201', now() - interval '25 minutes', NULL),
  -- Inglês ontem: 20 min
  ('5eed0000-0000-4000-8000-000000000202', now() - interval '1 day 20 minutes', now() - interval '1 day'),
  -- SQL: transações em 2 sessões (1h + 25 min), índices parciais 1h10
  ('5eed0000-0000-4000-8000-000000000303', now() - interval '13 days 2 hours', now() - interval '13 days 1 hour'),
  ('5eed0000-0000-4000-8000-000000000303', now() - interval '13 days 25 minutes', now() - interval '13 days'),
  ('5eed0000-0000-4000-8000-000000000304', now() - interval '6 days 1 hour 10 minutes', now() - interval '6 days'),
  -- Livro em andamento, pausado: 40 min lidos hoje cedo
  ('5eed0000-0000-4000-8000-000000000401', now() - interval '4 hours', now() - interval '3 hours 20 minutes'),
  -- Livro, capítulo 3: 40 min
  ('5eed0000-0000-4000-8000-000000000402', now() - interval '8 days 40 minutes', now() - interval '8 days'),
  -- Academia: 55 min
  ('5eed0000-0000-4000-8000-000000000602', now() - interval '4 days 55 minutes', now() - interval '4 days'),
  -- Docker Compose: 1h30
  ('5eed0000-0000-4000-8000-000000000702', now() - interval '30 days 1 hour 30 minutes', now() - interval '30 days');

COMMIT;
