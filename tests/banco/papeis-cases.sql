-- Papéis e RLS (migration 0015, 2026-11-08). Roda como o dono (studyflow,
-- superusuário aqui) e troca de papel com SET LOCAL ROLE dentro de cada caso:
-- studyflow_api e studyflow_backup não têm BYPASSRLS, então o que eles veem
-- vem das políticas, como no Supabase. Transação desfeita: nada sobra
-- (inclusive os papéis e a tabela criados aqui).
SET client_min_messages = warning;
CREATE TEMP TABLE resultado (caso text, ok boolean, detalhe text) ON COMMIT DROP;

-- Roda sql como papel e devolve "ok N" (linhas) ou "erro: <mensagem>". O erro
-- desfaz o bloco, e o SET LOCAL ROLE junto
CREATE FUNCTION pg_temp.como(papel text, sql text) RETURNS text AS $$
DECLARE n bigint;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', papel);
  EXECUTE sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  RETURN 'ok ' || n;
EXCEPTION WHEN OTHERS THEN
  RETURN 'erro: ' || SQLERRM;
END $$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.espera(caso text, papel text, sql text, padrao text) RETURNS void AS $$
DECLARE r text := pg_temp.como(papel, sql);
BEGIN
  INSERT INTO resultado VALUES (caso, r ~ padrao, r);
END $$ LANGUAGE plpgsql;

-- ---- catálogo: toda tabela de public com RLS e as duas políticas. A contagem
-- muda de propósito com tabela nova (que precisa entrar com as políticas).
-- Sem exceções: as migrations são aplicadas à mão, não há tabela de controle
INSERT INTO resultado
SELECT 'A1. public tem 17 tabelas', count(*) = 17, count(*) || ' tabelas'
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

INSERT INTO resultado
SELECT 'A2. toda tabela de public com RLS ligado', count(*) > 0 AND bool_and(c.relrowsecurity),
  coalesce('sem RLS: ' || string_agg(c.relname, ', ' ORDER BY c.relname) FILTER (WHERE NOT c.relrowsecurity), count(*) || ' com RLS')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

-- api_todas: FOR ALL, só para studyflow_api, USING e WITH CHECK true
INSERT INTO resultado
SELECT 'A3. toda tabela de public com a política api_todas', count(*) > 0 AND bool_and(p.ok),
  coalesce('sem: ' || string_agg(c.relname, ', ' ORDER BY c.relname) FILTER (WHERE NOT p.ok), count(*) || ' com a política')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL (SELECT EXISTS (
  SELECT 1 FROM pg_policy po WHERE po.polrelid = c.oid AND po.polname = 'api_todas' AND po.polcmd = '*'
    AND po.polpermissive AND po.polroles = ARRAY['studyflow_api'::regrole::oid]
    AND pg_get_expr(po.polqual, po.polrelid) = 'true' AND pg_get_expr(po.polwithcheck, po.polrelid) = 'true'
) AS ok) p
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

-- backup_leitura: só SELECT, só para studyflow_backup
INSERT INTO resultado
SELECT 'A4. toda tabela de public com a política backup_leitura', count(*) > 0 AND bool_and(p.ok),
  coalesce('sem: ' || string_agg(c.relname, ', ' ORDER BY c.relname) FILTER (WHERE NOT p.ok), count(*) || ' com a política')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL (SELECT EXISTS (
  SELECT 1 FROM pg_policy po WHERE po.polrelid = c.oid AND po.polname = 'backup_leitura' AND po.polcmd = 'r'
    AND po.polroles = ARRAY['studyflow_backup'::regrole::oid]
    AND pg_get_expr(po.polqual, po.polrelid) = 'true'
) AS ok) p
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

INSERT INTO resultado
SELECT 'A5. nenhuma outra política em public', count(*) = 0, coalesce(string_agg(po.polname, ', '), 'nenhuma')
FROM pg_policy po JOIN pg_class c ON c.oid = po.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND po.polname NOT IN ('api_todas', 'backup_leitura');

INSERT INTO resultado
SELECT 'A6. os dois papéis sem superusuário, BYPASSRLS, CREATEROLE nem CREATEDB',
  count(*) = 2 AND bool_and(NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)),
  count(*) || ' papéis'
FROM pg_roles WHERE rolname IN ('studyflow_api', 'studyflow_backup');

INSERT INTO resultado
SELECT 'A7. nenhum dos dois cria objeto no schema public',
  NOT has_schema_privilege('studyflow_api', 'public', 'CREATE') AND NOT has_schema_privilege('studyflow_backup', 'public', 'CREATE'),
  'CREATE em public'
;

-- ---- studyflow_api
SELECT pg_temp.espera('B1. api lê tags (seed)', 'studyflow_api', 'SELECT * FROM tags', '^ok [1-9]');
SELECT pg_temp.espera('B2. api inclui uma tag', 'studyflow_api',
  $q$INSERT INTO tags (id, name, level) VALUES ('00000000-0000-4000-8a00-000000000001', 'papeis-teste', 1)$q$, '^ok 1$');
SELECT pg_temp.espera('B3. api altera a tag', 'studyflow_api',
  $q$UPDATE tags SET name = 'papeis-teste 2' WHERE id = '00000000-0000-4000-8a00-000000000001'$q$, '^ok 1$');
SELECT pg_temp.espera('B4. api trava a tag como o applyTags (FOR KEY SHARE)', 'studyflow_api',
  $q$SELECT id FROM tags WHERE id = '00000000-0000-4000-8a00-000000000001' FOR KEY SHARE$q$, '^ok 1$');
SELECT pg_temp.espera('B5. api apaga a tag', 'studyflow_api',
  $q$DELETE FROM tags WHERE id = '00000000-0000-4000-8a00-000000000001'$q$, '^ok 1$');
SELECT pg_temp.espera('B6. api faz o LOCK TABLE selections das rotas de seleção', 'studyflow_api',
  'LOCK TABLE selections IN SHARE ROW EXCLUSIVE MODE', '^ok');
SELECT pg_temp.espera('B7. api lê pg_timezone_names (o fuso do Painel)', 'studyflow_api',
  $q$SELECT 1 FROM pg_timezone_names WHERE name = 'America/Sao_Paulo'$q$, '^ok 1$');
SELECT pg_temp.espera('B8. api: CREATE TABLE recusado', 'studyflow_api',
  'CREATE TABLE public.papeis_intrusa (id int)', 'permission denied');
SELECT pg_temp.espera('B9. api: ALTER TABLE recusado', 'studyflow_api',
  'ALTER TABLE tags ADD COLUMN intrusa int', 'must be owner');
SELECT pg_temp.espera('B10. api: DROP TABLE recusado', 'studyflow_api', 'DROP TABLE works', 'must be owner');
SELECT pg_temp.espera('B11. api: TRUNCATE recusado', 'studyflow_api', 'TRUNCATE works', 'permission denied');

-- ---- studyflow_backup
SELECT pg_temp.espera('C1. backup lê registros (seed)', 'studyflow_backup', 'SELECT * FROM task_executions', '^ok [1-9]');
SELECT pg_temp.espera('C2. backup: INSERT recusado', 'studyflow_backup',
  $q$INSERT INTO tags (id, name, level) VALUES ('00000000-0000-4000-8a00-000000000002', 'papeis-teste', 1)$q$, 'permission denied');
SELECT pg_temp.espera('C3. backup: UPDATE recusado', 'studyflow_backup', $q$UPDATE tags SET name = name$q$, 'permission denied');
SELECT pg_temp.espera('C4. backup: DELETE recusado', 'studyflow_backup', 'DELETE FROM works', 'permission denied');
SELECT pg_temp.espera('C5. backup: LOCK de escrita recusado', 'studyflow_backup',
  'LOCK TABLE selections IN SHARE ROW EXCLUSIVE MODE', 'permission denied');

-- ---- tabela futura, criada pelo dono (como uma migration nova), com sequência
CREATE TABLE public.papeis_futura (id bigserial PRIMARY KEY, nome text NOT NULL);
ALTER TABLE public.papeis_futura ENABLE ROW LEVEL SECURITY;
INSERT INTO public.papeis_futura (nome) VALUES ('do dono');
-- Sem política: os privilégios padrão dão o GRANT (sem "permission denied"), e o
-- RLS não deixa ver nem gravar nada
SELECT pg_temp.espera('D1. futura sem política: api lê 0 linhas, sem erro de permissão', 'studyflow_api',
  'SELECT * FROM papeis_futura', '^ok 0$');
SELECT pg_temp.espera('D2. futura sem política: INSERT da api recusado pelo RLS', 'studyflow_api',
  $q$INSERT INTO papeis_futura (nome) VALUES ('da api')$q$, 'row-level security');
CREATE POLICY api_todas ON public.papeis_futura FOR ALL TO studyflow_api USING (true) WITH CHECK (true);
SELECT pg_temp.espera('D3. futura com a política: api lê a linha do dono', 'studyflow_api',
  'SELECT * FROM papeis_futura', '^ok 1$');
-- O id vem do nextval da sequência: sem USAGE nela, "permission denied for sequence"
SELECT pg_temp.espera('D4. futura com a política: INSERT da api usa a sequência', 'studyflow_api',
  $q$INSERT INTO papeis_futura (nome) VALUES ('da api')$q$, '^ok 1$');
SELECT pg_temp.espera('D5. futura com a política: api altera e apaga', 'studyflow_api',
  'WITH u AS (UPDATE papeis_futura SET nome = nome RETURNING 1) DELETE FROM papeis_futura', '^ok 2$');
SELECT pg_temp.espera('D6. futura: backup lê sem erro de permissão (privilégio padrão), 0 linhas sem política', 'studyflow_backup',
  'SELECT * FROM papeis_futura', '^ok 0$');

-- ---- um papel como os da Data API (anon), com GRANT e sem política: nada
CREATE ROLE papeis_anon NOLOGIN;
GRANT USAGE ON SCHEMA public TO papeis_anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO papeis_anon;
SELECT pg_temp.espera('E1. papel com GRANT e sem política não lê tags', 'papeis_anon', 'SELECT * FROM tags', '^ok 0$');
SELECT pg_temp.espera('E2. papel com GRANT e sem política não lê registros', 'papeis_anon', 'SELECT * FROM task_executions', '^ok 0$');

SELECT CASE WHEN ok THEN 'OK     ' ELSE 'FALHOU ' END AS status, caso, detalhe FROM resultado ORDER BY caso;
SELECT count(*) FILTER (WHERE ok) || ' de ' || count(*) AS total FROM resultado;
