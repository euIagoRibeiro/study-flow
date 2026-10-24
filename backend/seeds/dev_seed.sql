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
  ('5eed0000-0000-4000-8000-000000000010', 'Matemática por diversão',   'none',  true, now() - interval '51 days'),
  -- As duas abaixo trabalham no MESMO projeto (bloco da fase, no fim)
  ('5eed0000-0000-4000-8000-000000000011', 'Projeto ai-boundaries', 'none',  true, now() - interval '50 days'),
  ('5eed0000-0000-4000-8000-000000000012', 'Programar',             'daily', true, now() - interval '65 days');

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
  ('5eed0000-0000-4000-8000-000000000906', '5eed0000-0000-4000-8000-000000000009', 'Revisão de equações',           'Estudar para o vestibular', 'daily', (SELECT t FROM ancora) - interval '6 days',  '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000000907', '5eed0000-0000-4000-8000-000000000009', 'Lista de exercícios',           'Estudar para o vestibular', 'daily', (SELECT t FROM ancora) - interval '9 days',  '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000001001', '5eed0000-0000-4000-8000-000000000010', 'Álgebra linear por curiosidade', 'Matemática por diversão',  'none',  (SELECT t FROM ancora) - interval '12 days', '5eed0000-0000-4000-9000-000000000200');

UPDATE task_executions SET root_tag_id = '5eed0000-0000-4000-9000-000000000300'
WHERE id IN ('5eed0000-0000-4000-8000-000000000601', '5eed0000-0000-4000-8000-000000000602');

-- Gravado como a API grava: o FECHAMENTO (nível 3 traz o nível 2 pai).
-- 901 Álgebra · 902 Frações · 903 Física · 904 só a raiz (sem matéria) ·
-- 905 Pesquisa · 906 Álgebra · 907 Matemática sem tema ·
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

-- Fase de trabalho: "Código" é o único contexto com fases. Projeto = a tag
-- mais específica do caminho (nível 3, ou nível 2 no StudyFlow).
-- projeto-antigo arquivado: mantém o histórico, sai da pré-seleção.
INSERT INTO tags (id, name, level, parent_id, root_id, active, tracks_phase) VALUES
  ('5eed0000-0000-4000-9000-000000000400', 'Código', 1, NULL, NULL, true, true);

INSERT INTO tags (id, name, level, parent_id, root_id, active) VALUES
  ('5eed0000-0000-4000-9000-000000000410', 'Pessoal',   2, '5eed0000-0000-4000-9000-000000000400', '5eed0000-0000-4000-9000-000000000400', true),
  ('5eed0000-0000-4000-9000-000000000420', 'Empresa',   2, '5eed0000-0000-4000-9000-000000000400', '5eed0000-0000-4000-9000-000000000400', true),
  ('5eed0000-0000-4000-9000-000000000430', 'StudyFlow', 2, '5eed0000-0000-4000-9000-000000000400', '5eed0000-0000-4000-9000-000000000400', true);

INSERT INTO tags (id, name, level, parent_id, root_id, active) VALUES
  ('5eed0000-0000-4000-9000-000000000411', 'ai-boundaries',        3, '5eed0000-0000-4000-9000-000000000410', '5eed0000-0000-4000-9000-000000000400', true),
  ('5eed0000-0000-4000-9000-000000000421', 'equipamentos-medicos', 3, '5eed0000-0000-4000-9000-000000000420', '5eed0000-0000-4000-9000-000000000400', true),
  ('5eed0000-0000-4000-9000-000000000422', 'projeto-antigo',       3, '5eed0000-0000-4000-9000-000000000420', '5eed0000-0000-4000-9000-000000000400', false);

-- ai-boundaries: requisitos → protótipo → requisitos (voltou) → protótipo →
-- validação. A última execução dele (1201) é da tarefa "Programar", não da
-- "Projeto ai-boundaries": pré-seleção pela tarefa daria protótipo, errado.
-- 1203 sem fase e sem cronômetro: a fatia "(sem fase)" dentro de Código.
-- Totais: ai-boundaries 135/270/50 min (req/prot/val); Código 675 min.
INSERT INTO task_executions
  (id, task_id, description, task_title_at_time, task_frequency_at_time, completed_at, root_tag_id, phase)
VALUES
  ('5eed0000-0000-4000-8000-000000001101', '5eed0000-0000-4000-8000-000000000011', 'Levantar casos de uso',          'Projeto ai-boundaries', 'none',  (SELECT t FROM ancora) - interval '40 days', '5eed0000-0000-4000-9000-000000000400', 'requisitos'),
  ('5eed0000-0000-4000-8000-000000001102', '5eed0000-0000-4000-8000-000000000011', 'Limites do que o modelo decide', 'Projeto ai-boundaries', 'none',  (SELECT t FROM ancora) - interval '35 days', '5eed0000-0000-4000-9000-000000000400', 'requisitos'),
  ('5eed0000-0000-4000-8000-000000001103', '5eed0000-0000-4000-8000-000000000011', 'Primeiro protótipo de regras',   'Projeto ai-boundaries', 'none',  (SELECT t FROM ancora) - interval '28 days', '5eed0000-0000-4000-9000-000000000400', 'prototipo'),
  ('5eed0000-0000-4000-8000-000000001104', '5eed0000-0000-4000-8000-000000000011', 'Protótipo com interface',        'Projeto ai-boundaries', 'none',  (SELECT t FROM ancora) - interval '21 days', '5eed0000-0000-4000-9000-000000000400', 'prototipo'),
  ('5eed0000-0000-4000-8000-000000001105', '5eed0000-0000-4000-8000-000000000011', 'Voltamos aos requisitos',        'Projeto ai-boundaries', 'none',  (SELECT t FROM ancora) - interval '14 days', '5eed0000-0000-4000-9000-000000000400', 'requisitos'),
  ('5eed0000-0000-4000-8000-000000001106', '5eed0000-0000-4000-8000-000000000011', 'Novo protótipo',                 'Projeto ai-boundaries', 'none',  (SELECT t FROM ancora) - interval '7 days',  '5eed0000-0000-4000-9000-000000000400', 'prototipo'),
  ('5eed0000-0000-4000-8000-000000001201', '5eed0000-0000-4000-8000-000000000012', 'Testes com usuários',            'Programar',             'daily', (SELECT t FROM ancora) - interval '2 days',  '5eed0000-0000-4000-9000-000000000400', 'validacao'),
  ('5eed0000-0000-4000-8000-000000001202', '5eed0000-0000-4000-8000-000000000012', 'Integração com o sensor',        'Programar',             'daily', (SELECT t FROM ancora) - interval '3 days',  '5eed0000-0000-4000-9000-000000000400', 'implementacao'),
  ('5eed0000-0000-4000-8000-000000001203', '5eed0000-0000-4000-8000-000000000012', 'Reunião de alinhamento',         'Programar',             'daily', (SELECT t FROM ancora) - interval '10 days', '5eed0000-0000-4000-9000-000000000400', NULL),
  ('5eed0000-0000-4000-8000-000000001204', '5eed0000-0000-4000-8000-000000000012', 'Desenho da fase de trabalho',    'Programar',             'daily', (SELECT t FROM ancora) - interval '1 day',   '5eed0000-0000-4000-9000-000000000400', 'requisitos'),
  ('5eed0000-0000-4000-8000-000000001205', '5eed0000-0000-4000-8000-000000000012', 'Entrega final',                  'Programar',             'daily', (SELECT t FROM ancora) - interval '60 days', '5eed0000-0000-4000-9000-000000000400', 'implementacao');

-- Fechamento: o projeto de nível 3 leva o nível 2 pai; StudyFlow vai sozinho
INSERT INTO task_execution_tags (task_execution_id, tag_id, tag_parent_id, root_tag_id)
SELECT e.id, t.id, t.parent_id, '5eed0000-0000-4000-9000-000000000400'
FROM (VALUES
  ('5eed0000-0000-4000-8000-000000001101'::uuid, '5eed0000-0000-4000-9000-000000000411'::uuid),
  ('5eed0000-0000-4000-8000-000000001102', '5eed0000-0000-4000-9000-000000000411'),
  ('5eed0000-0000-4000-8000-000000001103', '5eed0000-0000-4000-9000-000000000411'),
  ('5eed0000-0000-4000-8000-000000001104', '5eed0000-0000-4000-9000-000000000411'),
  ('5eed0000-0000-4000-8000-000000001105', '5eed0000-0000-4000-9000-000000000411'),
  ('5eed0000-0000-4000-8000-000000001106', '5eed0000-0000-4000-9000-000000000411'),
  ('5eed0000-0000-4000-8000-000000001201', '5eed0000-0000-4000-9000-000000000411'),
  ('5eed0000-0000-4000-8000-000000001202', '5eed0000-0000-4000-9000-000000000421'),
  ('5eed0000-0000-4000-8000-000000001203', '5eed0000-0000-4000-9000-000000000421'),
  ('5eed0000-0000-4000-8000-000000001204', '5eed0000-0000-4000-9000-000000000430'),
  ('5eed0000-0000-4000-8000-000000001205', '5eed0000-0000-4000-9000-000000000422')
) AS e (id, leaf_id)
JOIN tags leaf ON leaf.id = e.leaf_id
JOIN tags t ON t.id = leaf.id OR (leaf.level = 3 AND t.id = leaf.parent_id);

INSERT INTO time_entries (task_execution_id, started_at, ended_at) VALUES
  ('5eed0000-0000-4000-8000-000000001101', (SELECT t FROM ancora) - interval '40 days 1 hour',             (SELECT t FROM ancora) - interval '40 days'),
  ('5eed0000-0000-4000-8000-000000001102', (SELECT t FROM ancora) - interval '35 days 45 minutes',         (SELECT t FROM ancora) - interval '35 days'),
  ('5eed0000-0000-4000-8000-000000001103', (SELECT t FROM ancora) - interval '28 days 1 hour 30 minutes',  (SELECT t FROM ancora) - interval '28 days'),
  -- 2 sessões com pausa (60 + 60 min)
  ('5eed0000-0000-4000-8000-000000001104', (SELECT t FROM ancora) - interval '21 days 2 hours 10 minutes', (SELECT t FROM ancora) - interval '21 days 1 hour 10 minutes'),
  ('5eed0000-0000-4000-8000-000000001104', (SELECT t FROM ancora) - interval '21 days 1 hour',             (SELECT t FROM ancora) - interval '21 days'),
  ('5eed0000-0000-4000-8000-000000001105', (SELECT t FROM ancora) - interval '14 days 30 minutes',         (SELECT t FROM ancora) - interval '14 days'),
  ('5eed0000-0000-4000-8000-000000001106', (SELECT t FROM ancora) - interval '7 days 1 hour',              (SELECT t FROM ancora) - interval '7 days'),
  ('5eed0000-0000-4000-8000-000000001201', (SELECT t FROM ancora) - interval '2 days 50 minutes',          (SELECT t FROM ancora) - interval '2 days'),
  ('5eed0000-0000-4000-8000-000000001202', (SELECT t FROM ancora) - interval '3 days 1 hour 20 minutes',   (SELECT t FROM ancora) - interval '3 days'),
  ('5eed0000-0000-4000-8000-000000001204', (SELECT t FROM ancora) - interval '1 day 40 minutes',           (SELECT t FROM ancora) - interval '1 day'),
  ('5eed0000-0000-4000-8000-000000001205', (SELECT t FROM ancora) - interval '60 days 1 hour 40 minutes',  (SELECT t FROM ancora) - interval '60 days');

-- Duração estimada (sessão marcada, como a API grava: termina no "Quando",
-- começa X min antes). 1301 e 1302 na mesma noite, SOBREPOSTOS de
-- propósito (1302 cabe dentro do 1301): tempo dedicado 130 min, relógio
-- 90 min. 1303: cronômetro 50 min + 20 estimados (esqueceu de ligar no
-- começo) = 70 min. Estimadas no total: 150 min.
-- 22:00 de ontem, hora local (fixo: a âncora varia entre 6h e 12h, e
-- "âncora - 1 dia + 12h" caía à meia-noite de HOJE quando ela era 12h)
CREATE TEMP TABLE noite ON COMMIT DROP AS
SELECT (date_trunc('day', (SELECT t FROM ancora) AT TIME ZONE 'America/Sao_Paulo')
        AT TIME ZONE 'America/Sao_Paulo') - interval '2 hours' AS t;

INSERT INTO task_executions
  (id, task_id, description, task_title_at_time, task_frequency_at_time, completed_at)
VALUES
  ('5eed0000-0000-4000-8000-000000001301', '5eed0000-0000-4000-8000-000000000002', 'Gameplay em inglês (listening)',  'Revisar inglês',         'daily',  (SELECT t FROM noite)),
  ('5eed0000-0000-4000-8000-000000001302', '5eed0000-0000-4000-8000-000000000006', 'Alongamento vendo série',         'Exercício físico',       'none',   (SELECT t FROM noite) - interval '30 minutes'),
  ('5eed0000-0000-4000-8000-000000001303', '5eed0000-0000-4000-8000-000000000003', 'Window functions',                'Estudar SQL e Postgres', 'weekly', (SELECT t FROM ancora) - interval '4 days');

INSERT INTO time_entries (task_execution_id, started_at, ended_at, estimated) VALUES
  ('5eed0000-0000-4000-8000-000000001301', (SELECT t FROM noite) - interval '90 minutes', (SELECT t FROM noite), true),
  ('5eed0000-0000-4000-8000-000000001302', (SELECT t FROM noite) - interval '70 minutes', (SELECT t FROM noite) - interval '30 minutes', true),
  ('5eed0000-0000-4000-8000-000000001303', (SELECT t FROM ancora) - interval '4 days 20 minutes', (SELECT t FROM ancora) - interval '4 days', true),
  ('5eed0000-0000-4000-8000-000000001303', (SELECT t FROM ancora) - interval '4 days 1 hour 30 minutes', (SELECT t FROM ancora) - interval '4 days 40 minutes', false);

-- Medidas por contexto (etapa M). A tag declara o que se mede; descendentes
-- herdam; subtag substitui (Vestibular "questões" → Matemática "exercícios",
-- dado só de seed, pra testar a herança). Linguagens é raiz nova.
-- Totais: Código 9 exercícios (3 refatoração, 2 leitura, 4 questões),
-- Linguagens 3 de escuta, Matemática 12, Vestibular 6 questões, Corrida 5,2 km
-- (7 registros, 8 valores). Natação: metros, decimal, sem tipos, sem uso
-- (a tag continua arquivada). Ids: medidas 5eed…a000, tipos 5eed…a100
INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
  ('5eed0000-0000-4000-9000-000000000500', 'Linguagens', 1, NULL, NULL);
INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
  ('5eed0000-0000-4000-9000-000000000510', 'Inglês',  2, '5eed0000-0000-4000-9000-000000000500', '5eed0000-0000-4000-9000-000000000500'),
  ('5eed0000-0000-4000-9000-000000000520', 'Japonês', 2, '5eed0000-0000-4000-9000-000000000500', '5eed0000-0000-4000-9000-000000000500');

INSERT INTO measures (id, tag_id, name, singular, allows_decimal) VALUES
  ('5eed0000-0000-4000-a000-000000000001', '5eed0000-0000-4000-9000-000000000400', 'exercícios', 'exercício', false), -- Código
  ('5eed0000-0000-4000-a000-000000000002', '5eed0000-0000-4000-9000-000000000500', 'exercícios', 'exercício', false), -- Linguagens
  ('5eed0000-0000-4000-a000-000000000003', '5eed0000-0000-4000-9000-000000000100', 'questões',   'questão',   false), -- Vestibular
  ('5eed0000-0000-4000-a000-000000000004', '5eed0000-0000-4000-9000-000000000110', 'exercícios', 'exercício', false), -- Vestibular › Matemática
  ('5eed0000-0000-4000-a000-000000000005', '5eed0000-0000-4000-9000-000000000330', 'km',         'km',        true),  -- Exercícios › Corrida
  ('5eed0000-0000-4000-a000-000000000006', '5eed0000-0000-4000-9000-000000000340', 'metros',     'metro',     true);  -- Exercícios › Natação (arquivada, sem uso)

INSERT INTO measure_kinds (id, measure_id, name) VALUES
  ('5eed0000-0000-4000-a100-000000000011', '5eed0000-0000-4000-a000-000000000001', 'refatoração'),
  ('5eed0000-0000-4000-a100-000000000012', '5eed0000-0000-4000-a000-000000000001', 'leitura'),
  ('5eed0000-0000-4000-a100-000000000013', '5eed0000-0000-4000-a000-000000000001', 'questões'),
  ('5eed0000-0000-4000-a100-000000000021', '5eed0000-0000-4000-a000-000000000002', 'escuta'),
  ('5eed0000-0000-4000-a100-000000000022', '5eed0000-0000-4000-a000-000000000002', 'leitura'),
  ('5eed0000-0000-4000-a100-000000000023', '5eed0000-0000-4000-a000-000000000002', 'escrita'),
  ('5eed0000-0000-4000-a100-000000000024', '5eed0000-0000-4000-a000-000000000002', 'fala');

-- Inglês ganha tag: o gameplay (1301) e o podcast (202) passam a Linguagens › Inglês
UPDATE task_executions SET root_tag_id = '5eed0000-0000-4000-9000-000000000500'
WHERE id IN ('5eed0000-0000-4000-8000-000000001301', '5eed0000-0000-4000-8000-000000000202');
INSERT INTO task_execution_tags (task_execution_id, tag_id, tag_parent_id, root_tag_id) VALUES
  ('5eed0000-0000-4000-8000-000000001301', '5eed0000-0000-4000-9000-000000000510', '5eed0000-0000-4000-9000-000000000500', '5eed0000-0000-4000-9000-000000000500'),
  ('5eed0000-0000-4000-8000-000000000202', '5eed0000-0000-4000-9000-000000000510', '5eed0000-0000-4000-9000-000000000500', '5eed0000-0000-4000-9000-000000000500');

-- Qual medida cada registro usa: a declarada pela tag mais próxima do caminho
-- (como a API resolve). tag_id = a declarante; root_tag_id = a raiz do registro
INSERT INTO execution_measures (task_execution_id, measure_id, tag_id, root_tag_id) VALUES
  ('5eed0000-0000-4000-8000-000000001106', '5eed0000-0000-4000-a000-000000000001', '5eed0000-0000-4000-9000-000000000400', '5eed0000-0000-4000-9000-000000000400'),
  ('5eed0000-0000-4000-8000-000000001202', '5eed0000-0000-4000-a000-000000000001', '5eed0000-0000-4000-9000-000000000400', '5eed0000-0000-4000-9000-000000000400'),
  ('5eed0000-0000-4000-8000-000000000902', '5eed0000-0000-4000-a000-000000000004', '5eed0000-0000-4000-9000-000000000110', '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000000903', '5eed0000-0000-4000-a000-000000000003', '5eed0000-0000-4000-9000-000000000100', '5eed0000-0000-4000-9000-000000000100'),
  ('5eed0000-0000-4000-8000-000000000601', '5eed0000-0000-4000-a000-000000000005', '5eed0000-0000-4000-9000-000000000330', '5eed0000-0000-4000-9000-000000000300'),
  ('5eed0000-0000-4000-8000-000000001301', '5eed0000-0000-4000-a000-000000000002', '5eed0000-0000-4000-9000-000000000500', '5eed0000-0000-4000-9000-000000000500'),
  ('5eed0000-0000-4000-8000-000000000202', '5eed0000-0000-4000-a000-000000000002', '5eed0000-0000-4000-9000-000000000500', '5eed0000-0000-4000-9000-000000000500');

INSERT INTO execution_measure_values (task_execution_id, measure_id, kind_id, quantity) VALUES
  ('5eed0000-0000-4000-8000-000000001106', '5eed0000-0000-4000-a000-000000000001', '5eed0000-0000-4000-a100-000000000011', 3),
  ('5eed0000-0000-4000-8000-000000001106', '5eed0000-0000-4000-a000-000000000001', '5eed0000-0000-4000-a100-000000000012', 2),
  ('5eed0000-0000-4000-8000-000000001202', '5eed0000-0000-4000-a000-000000000001', '5eed0000-0000-4000-a100-000000000013', 4),
  ('5eed0000-0000-4000-8000-000000000902', '5eed0000-0000-4000-a000-000000000004', NULL, 12),
  ('5eed0000-0000-4000-8000-000000000903', '5eed0000-0000-4000-a000-000000000003', NULL, 6),
  ('5eed0000-0000-4000-8000-000000000601', '5eed0000-0000-4000-a000-000000000005', NULL, 5.2),
  ('5eed0000-0000-4000-8000-000000001301', '5eed0000-0000-4000-a000-000000000002', '5eed0000-0000-4000-a100-000000000021', 1),
  ('5eed0000-0000-4000-8000-000000000202', '5eed0000-0000-4000-a000-000000000002', '5eed0000-0000-4000-a100-000000000021', 2);

COMMIT;
