-- Dados fictícios pro banco LOCAL, pra ver todas as funcionalidades com
-- volume realista. Nunca rodar em produção.
--
-- Ids fixos começando com 5eed: é o que permite o dev_unseed.sql remover
-- só esses dados, sem tocar nos seus.
-- Datas relativas (à âncora abaixo, ou a now() nas execuções em
-- andamento): "feita hoje", "últimos 7 dias" e o cronômetro rodando fazem
-- sentido em qualquer dia e em qualquer horário que o seed rodar.
-- Em transação: rodar duas vezes falha no primeiro INSERT (id repetido) e
-- desfaz tudo, sem duplicar nada.

BEGIN;

-- Âncora dos registros concluídos: um horário dentro do dia LOCAL de hoje
-- (entre 6h e 12h, e não depois de agora quando dá). Com now() puro, rodar o
-- seed de madrugada jogava os registros "de hoje" pra ontem.
-- As execuções em andamento continuam relativas a now(): o cronômetro
-- fictício precisa mostrar "rodando há 25min".
CREATE TEMP TABLE ancora ON COMMIT DROP AS
SELECT GREATEST(LEAST(now(), dia + interval '12 hours'), dia + interval '6 hours') AS t
FROM (
  SELECT date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' AS dia
) hoje;

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
  ('5eed0000-0000-4000-8000-000000000008', 'Ideias de projeto',      'none',    true,  now() - interval '53 days'),
  -- As duas abaixo existem pra ter execuções com tags (bloco no fim)
  ('5eed0000-0000-4000-8000-000000000009', 'Estudar para o vestibular', 'daily', true, now() - interval '52 days'),
  ('5eed0000-0000-4000-8000-000000000010', 'Matemática por diversão',   'none',  true, now() - interval '51 days');

-- Execuções. completed_at NULL = em andamento (2: uma rodando, uma pausada)
INSERT INTO task_executions
  (id, task_id, description, task_title_at_time, task_frequency_at_time, completed_at)
VALUES
  -- Estudar React: feita hoje (grifo), ontem, sem descrição, antigas
  ('5eed0000-0000-4000-8000-000000000101', '5eed0000-0000-4000-8000-000000000001', 'Hooks: useEffect e função de limpeza', 'Estudar React', 'daily', (SELECT t FROM ancora) - interval '2 hours'),
  ('5eed0000-0000-4000-8000-000000000102', '5eed0000-0000-4000-8000-000000000001', 'Componentes controlados',              'Estudar React', 'daily', (SELECT t FROM ancora) - interval '1 day'),
  ('5eed0000-0000-4000-8000-000000000103', '5eed0000-0000-4000-8000-000000000001', NULL,                                   'Estudar React', 'daily', (SELECT t FROM ancora) - interval '3 days'),
  ('5eed0000-0000-4000-8000-000000000104', '5eed0000-0000-4000-8000-000000000001', 'React Router: rotas aninhadas',        'Estudar React', 'daily', (SELECT t FROM ancora) - interval '10 days'),
  ('5eed0000-0000-4000-8000-000000000105', '5eed0000-0000-4000-8000-000000000001', 'JSX e props',                          'Estudar React', 'daily', (SELECT t FROM ancora) - interval '40 days'),

  -- Revisar inglês: uma EM ANDAMENTO com cronômetro rodando
  ('5eed0000-0000-4000-8000-000000000201', '5eed0000-0000-4000-8000-000000000002', NULL,                        'Revisar inglês', 'daily', NULL),
  ('5eed0000-0000-4000-8000-000000000202', '5eed0000-0000-4000-8000-000000000002', 'Podcast de 20 minutos',     'Revisar inglês', 'daily', (SELECT t FROM ancora) - interval '1 day'),
  ('5eed0000-0000-4000-8000-000000000203', '5eed0000-0000-4000-8000-000000000002', NULL,                        'Revisar inglês', 'daily', (SELECT t FROM ancora) - interval '2 days'),

  -- Estudar SQL e Postgres: as 2 antigas são de quando se chamava
  -- "Estudar SQL", sem frequência (o histórico mostra o nome antigo)
  ('5eed0000-0000-4000-8000-000000000301', '5eed0000-0000-4000-8000-000000000003', 'SELECT e JOIN',               'Estudar SQL',            'none',   (SELECT t FROM ancora) - interval '45 days'),
  ('5eed0000-0000-4000-8000-000000000302', '5eed0000-0000-4000-8000-000000000003', 'GROUP BY e agregações',       'Estudar SQL',            'none',   (SELECT t FROM ancora) - interval '35 days'),
  ('5eed0000-0000-4000-8000-000000000303', '5eed0000-0000-4000-8000-000000000003', 'Transações: BEGIN e ROLLBACK', 'Estudar SQL e Postgres', 'weekly', (SELECT t FROM ancora) - interval '13 days'),
  ('5eed0000-0000-4000-8000-000000000304', '5eed0000-0000-4000-8000-000000000003', 'Índices parciais',            'Estudar SQL e Postgres', 'weekly', (SELECT t FROM ancora) - interval '6 days'),

  -- Ler livro técnico: uma EM ANDAMENTO pausada (sessão encerrada, nenhuma rodando)
  ('5eed0000-0000-4000-8000-000000000401', '5eed0000-0000-4000-8000-000000000004', NULL,                   'Ler livro técnico', 'weekly', NULL),
  ('5eed0000-0000-4000-8000-000000000402', '5eed0000-0000-4000-8000-000000000004', 'Capítulo 3: testes',  'Ler livro técnico', 'weekly', (SELECT t FROM ancora) - interval '8 days'),

  -- Organizar finanças: uma neste mês, outra no mês passado (filtros de período)
  ('5eed0000-0000-4000-8000-000000000501', '5eed0000-0000-4000-8000-000000000005', 'Planilha do mês',          'Organizar finanças', 'monthly', (SELECT t FROM ancora) - interval '20 days'),
  ('5eed0000-0000-4000-8000-000000000502', '5eed0000-0000-4000-8000-000000000005', 'Planilha do mês anterior', 'Organizar finanças', 'monthly', (SELECT t FROM ancora) - interval '50 days'),

  -- Exercício físico (avulsa): hoje sem cronômetro, outra com
  ('5eed0000-0000-4000-8000-000000000601', '5eed0000-0000-4000-8000-000000000006', 'Corrida de 5 km', 'Exercício físico', 'none', (SELECT t FROM ancora) - interval '5 hours'),
  ('5eed0000-0000-4000-8000-000000000602', '5eed0000-0000-4000-8000-000000000006', 'Academia',        'Exercício físico', 'none', (SELECT t FROM ancora) - interval '4 days'),

  -- Curso de Docker (arquivada): o histórico continua visível
  ('5eed0000-0000-4000-8000-000000000701', '5eed0000-0000-4000-8000-000000000007', 'Imagens e volumes', 'Curso de Docker', 'weekly', (SELECT t FROM ancora) - interval '37 days'),
  ('5eed0000-0000-4000-8000-000000000702', '5eed0000-0000-4000-8000-000000000007', 'Docker Compose',    'Curso de Docker', 'weekly', (SELECT t FROM ancora) - interval '30 days');

-- Sessões de cronômetro. Execuções sem nenhuma linha aqui = "Registrar"
-- direto, sem cronômetro. Várias linhas na mesma execução = pausas.
INSERT INTO time_entries (task_execution_id, started_at, ended_at) VALUES
  -- React hoje: 2 sessões com uma pausa no meio (30 + 30 min)
  ('5eed0000-0000-4000-8000-000000000101', (SELECT t FROM ancora) - interval '3 hours 10 minutes', (SELECT t FROM ancora) - interval '2 hours 40 minutes'),
  ('5eed0000-0000-4000-8000-000000000101', (SELECT t FROM ancora) - interval '2 hours 30 minutes', (SELECT t FROM ancora) - interval '2 hours'),
  -- React ontem: 45 min
  ('5eed0000-0000-4000-8000-000000000102', (SELECT t FROM ancora) - interval '1 day 45 minutes', (SELECT t FROM ancora) - interval '1 day'),
  -- Inglês em andamento: 1 sessão já pausada + a que está RODANDO (a única
  -- do app inteiro: o índice time_entries_one_running não deixa outra)
  ('5eed0000-0000-4000-8000-000000000201', now() - interval '1 hour 5 minutes', now() - interval '50 minutes'),
  ('5eed0000-0000-4000-8000-000000000201', now() - interval '25 minutes', NULL),
  -- Inglês ontem: 20 min
  ('5eed0000-0000-4000-8000-000000000202', (SELECT t FROM ancora) - interval '1 day 20 minutes', (SELECT t FROM ancora) - interval '1 day'),
  -- SQL: transações em 2 sessões (1h + 25 min), índices parciais 1h10
  ('5eed0000-0000-4000-8000-000000000303', (SELECT t FROM ancora) - interval '13 days 2 hours', (SELECT t FROM ancora) - interval '13 days 1 hour'),
  ('5eed0000-0000-4000-8000-000000000303', (SELECT t FROM ancora) - interval '13 days 25 minutes', (SELECT t FROM ancora) - interval '13 days'),
  ('5eed0000-0000-4000-8000-000000000304', (SELECT t FROM ancora) - interval '6 days 1 hour 10 minutes', (SELECT t FROM ancora) - interval '6 days'),
  -- Livro em andamento, pausado: 40 min lidos hoje cedo
  ('5eed0000-0000-4000-8000-000000000401', now() - interval '4 hours', now() - interval '3 hours 20 minutes'),
  -- Livro, capítulo 3: 40 min
  ('5eed0000-0000-4000-8000-000000000402', (SELECT t FROM ancora) - interval '8 days 40 minutes', (SELECT t FROM ancora) - interval '8 days'),
  -- Academia: 55 min
  ('5eed0000-0000-4000-8000-000000000602', (SELECT t FROM ancora) - interval '4 days 55 minutes', (SELECT t FROM ancora) - interval '4 days'),
  -- Docker Compose: 1h30
  ('5eed0000-0000-4000-8000-000000000702', (SELECT t FROM ancora) - interval '30 days 1 hour 30 minutes', (SELECT t FROM ancora) - interval '30 days');

-- Tags (até 3 níveis). Bloco de ids próprio (4000-9000): centena = raiz,
-- dezena = filho, unidade = neto. "Matemática" aparece duas vezes de
-- propósito (dentro do Vestibular e solta): são tags diferentes. Pais antes
-- dos filhos, por causa das FKs.
INSERT INTO tags (id, name, level, parent_id, root_id, active) VALUES
  ('5eed0000-0000-4000-9000-000000000100', 'Vestibular', 1, NULL, NULL, true),
  ('5eed0000-0000-4000-9000-000000000200', 'Matemática', 1, NULL, NULL, true),
  ('5eed0000-0000-4000-9000-000000000300', 'Exercícios', 1, NULL, NULL, true);

INSERT INTO tags (id, name, level, parent_id, root_id, active) VALUES
  ('5eed0000-0000-4000-9000-000000000110', 'Matemática', 2, '5eed0000-0000-4000-9000-000000000100', '5eed0000-0000-4000-9000-000000000100', true),
  ('5eed0000-0000-4000-9000-000000000120', 'Física',     2, '5eed0000-0000-4000-9000-000000000100', '5eed0000-0000-4000-9000-000000000100', true),
  ('5eed0000-0000-4000-9000-000000000130', 'Pesquisa',   2, '5eed0000-0000-4000-9000-000000000100', '5eed0000-0000-4000-9000-000000000100', true),
  ('5eed0000-0000-4000-9000-000000000210', 'Álgebra',    2, '5eed0000-0000-4000-9000-000000000200', '5eed0000-0000-4000-9000-000000000200', true),
  ('5eed0000-0000-4000-9000-000000000310', 'Academia',   2, '5eed0000-0000-4000-9000-000000000300', '5eed0000-0000-4000-9000-000000000300', true),
  ('5eed0000-0000-4000-9000-000000000320', 'Casa',       2, '5eed0000-0000-4000-9000-000000000300', '5eed0000-0000-4000-9000-000000000300', true),
  ('5eed0000-0000-4000-9000-000000000330', 'Corrida',    2, '5eed0000-0000-4000-9000-000000000300', '5eed0000-0000-4000-9000-000000000300', true),
  ('5eed0000-0000-4000-9000-000000000340', 'Natação',    2, '5eed0000-0000-4000-9000-000000000300', '5eed0000-0000-4000-9000-000000000300', false);

INSERT INTO tags (id, name, level, parent_id, root_id, active) VALUES
  ('5eed0000-0000-4000-9000-000000000111', 'Álgebra', 3, '5eed0000-0000-4000-9000-000000000110', '5eed0000-0000-4000-9000-000000000100', true),
  ('5eed0000-0000-4000-9000-000000000112', 'Frações', 3, '5eed0000-0000-4000-9000-000000000110', '5eed0000-0000-4000-9000-000000000100', true);

-- Execuções com tags: aqui no fim porque a raiz (root_tag_id) tem que
-- apontar pra uma tag que já existe. Cada caso de marcação aparece uma
-- vez; as outras execuções do seed ficam sem tag, de propósito.
INSERT INTO task_executions
  (id, task_id, description, task_title_at_time, task_frequency_at_time, completed_at, root_tag_id)
VALUES
  ('5eed0000-0000-4000-8000-000000000901', '5eed0000-0000-4000-8000-000000000009', 'Equações do 2º grau',           'Estudar para o vestibular', 'daily', (SELECT t FROM ancora) - interval '1 hour',  '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000000902', '5eed0000-0000-4000-8000-000000000009', 'Exercícios de frações',         'Estudar para o vestibular', 'daily', (SELECT t FROM ancora) - interval '1 day',   '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000000903', '5eed0000-0000-4000-8000-000000000009', 'Cinemática',                    'Estudar para o vestibular', 'daily', (SELECT t FROM ancora) - interval '2 days',  '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000000904', '5eed0000-0000-4000-8000-000000000009', 'Organizei o cronograma',        'Estudar para o vestibular', 'daily', (SELECT t FROM ancora) - interval '3 days',  '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000000905', '5eed0000-0000-4000-8000-000000000009', 'Edital e peso das matérias',    'Estudar para o vestibular', 'daily', (SELECT t FROM ancora) - interval '5 days',  '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000000906', '5eed0000-0000-4000-8000-000000000009', 'Revisão geral de matemática',   'Estudar para o vestibular', 'daily', (SELECT t FROM ancora) - interval '6 days',  '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000000907', '5eed0000-0000-4000-8000-000000000009', 'Lista de exercícios',           'Estudar para o vestibular', 'daily', (SELECT t FROM ancora) - interval '9 days',  '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000001001', '5eed0000-0000-4000-8000-000000000010', 'Álgebra linear por curiosidade', 'Matemática por diversão',  'none',  (SELECT t FROM ancora) - interval '12 days', '5eed0000-0000-4000-9000-000000000200');

UPDATE task_executions SET root_tag_id = '5eed0000-0000-4000-9000-000000000300'
WHERE id IN ('5eed0000-0000-4000-8000-000000000601', '5eed0000-0000-4000-8000-000000000602');

-- Gravado como a API grava: o FECHAMENTO (nível 3 traz o nível 2 pai).
-- 901 Álgebra · 902 Frações · 903 Física · 904 só a raiz (sem matéria) ·
-- 905 Pesquisa · 906 Álgebra + Frações · 907 Matemática sem tema ·
-- 1001 Matemática (solta) › Álgebra · 601 Corrida · 602 Academia
INSERT INTO task_execution_tags (task_execution_id, tag_id, tag_parent_id, root_tag_id) VALUES
  ('5eed0000-0000-4000-8000-000000000901', '5eed0000-0000-4000-9000-000000000110', '5eed0000-0000-4000-9000-000000000100', '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000000901', '5eed0000-0000-4000-9000-000000000111', '5eed0000-0000-4000-9000-000000000110', '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000000902', '5eed0000-0000-4000-9000-000000000110', '5eed0000-0000-4000-9000-000000000100', '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000000902', '5eed0000-0000-4000-9000-000000000112', '5eed0000-0000-4000-9000-000000000110', '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000000903', '5eed0000-0000-4000-9000-000000000120', '5eed0000-0000-4000-9000-000000000100', '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000000905', '5eed0000-0000-4000-9000-000000000130', '5eed0000-0000-4000-9000-000000000100', '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000000906', '5eed0000-0000-4000-9000-000000000110', '5eed0000-0000-4000-9000-000000000100', '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000000906', '5eed0000-0000-4000-9000-000000000111', '5eed0000-0000-4000-9000-000000000110', '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000000906', '5eed0000-0000-4000-9000-000000000112', '5eed0000-0000-4000-9000-000000000110', '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000000907', '5eed0000-0000-4000-9000-000000000110', '5eed0000-0000-4000-9000-000000000100', '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000001001', '5eed0000-0000-4000-9000-000000000210', '5eed0000-0000-4000-9000-000000000200', '5eed0000-0000-4000-9000-000000000200'),
  ('5eed0000-0000-4000-8000-000000000601', '5eed0000-0000-4000-9000-000000000330', '5eed0000-0000-4000-9000-000000000300', '5eed0000-0000-4000-9000-000000000300'),
  ('5eed0000-0000-4000-8000-000000000602', '5eed0000-0000-4000-9000-000000000310', '5eed0000-0000-4000-9000-000000000300', '5eed0000-0000-4000-9000-000000000300');

-- Sessões das execuções com tag (907 sem cronômetro: "Registrar" direto)
INSERT INTO time_entries (task_execution_id, started_at, ended_at) VALUES
  ('5eed0000-0000-4000-8000-000000000901', (SELECT t FROM ancora) - interval '1 hour 50 minutes', (SELECT t FROM ancora) - interval '1 hour'),
  ('5eed0000-0000-4000-8000-000000000902', (SELECT t FROM ancora) - interval '1 day 40 minutes', (SELECT t FROM ancora) - interval '1 day'),
  ('5eed0000-0000-4000-8000-000000000903', (SELECT t FROM ancora) - interval '2 days 1 hour', (SELECT t FROM ancora) - interval '2 days'),
  ('5eed0000-0000-4000-8000-000000000904', (SELECT t FROM ancora) - interval '3 days 20 minutes', (SELECT t FROM ancora) - interval '3 days'),
  ('5eed0000-0000-4000-8000-000000000905', (SELECT t FROM ancora) - interval '5 days 30 minutes', (SELECT t FROM ancora) - interval '5 days'),
  -- Revisão geral: 2 sessões (40 + 40 min)
  ('5eed0000-0000-4000-8000-000000000906', (SELECT t FROM ancora) - interval '6 days 1 hour 30 minutes', (SELECT t FROM ancora) - interval '6 days 50 minutes'),
  ('5eed0000-0000-4000-8000-000000000906', (SELECT t FROM ancora) - interval '6 days 40 minutes', (SELECT t FROM ancora) - interval '6 days'),
  ('5eed0000-0000-4000-8000-000000001001', (SELECT t FROM ancora) - interval '12 days 45 minutes', (SELECT t FROM ancora) - interval '12 days');

COMMIT;
