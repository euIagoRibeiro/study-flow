-- RLS e papéis (hospedagem, 2026-11-08). No Supabase, o postgres não é
-- superusuário e as tabelas de public ficam expostas aos papéis da Data API
-- (anon, authenticated, service_role). Daqui em diante:
--   studyflow_api: o papel da API; lê e escreve, sem criar, alterar nem apagar tabela
--   studyflow_backup: o do pg_dump (--enable-row-security); só lê
-- Os dois nascem NOLOGIN: LOGIN e senha ficam fora do repositório (psql \password).
-- Sem BYPASSRLS: cada tabela tem RLS ligado e uma política por papel.
-- TODA TABELA NOVA precisa, na mesma migration, de ENABLE ROW LEVEL SECURITY e das
-- duas políticas (api_todas, backup_leitura): os privilégios padrão abaixo dão o
-- GRANT, mas sem política o RLS não deixa ver nem gravar nada. tests/banco/papeis-cases.sql
-- falha com tabela de public sem as duas.
-- No banco local nada muda para o app: o dono (studyflow) é superusuário.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studyflow_api') THEN
    CREATE ROLE studyflow_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studyflow_backup') THEN
    CREATE ROLE studyflow_backup NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO studyflow_api, studyflow_backup;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO studyflow_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO studyflow_api;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO studyflow_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO studyflow_backup;

-- Tabelas e sequências futuras: os privilégios padrão valem só para o papel que
-- as cria, então FOR ROLE o dono que roda as migrations (studyflow aqui,
-- postgres no Supabase)
DO $$
BEGIN
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO studyflow_api', current_user);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO studyflow_api', current_user);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
    GRANT SELECT ON TABLES TO studyflow_backup', current_user);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
    GRANT SELECT ON SEQUENCES TO studyflow_backup', current_user);
END $$;

-- Os papéis da Data API do Supabase não tocam em nada (no banco local não existem)
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I', current_user, r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', current_user, r);
    END IF;
  END LOOP;
END $$;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_todas ON tasks FOR ALL TO studyflow_api USING (true) WITH CHECK (true);
CREATE POLICY backup_leitura ON tasks FOR SELECT TO studyflow_backup USING (true);

ALTER TABLE task_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_todas ON task_executions FOR ALL TO studyflow_api USING (true) WITH CHECK (true);
CREATE POLICY backup_leitura ON task_executions FOR SELECT TO studyflow_backup USING (true);

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_todas ON time_entries FOR ALL TO studyflow_api USING (true) WITH CHECK (true);
CREATE POLICY backup_leitura ON time_entries FOR SELECT TO studyflow_backup USING (true);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_todas ON tags FOR ALL TO studyflow_api USING (true) WITH CHECK (true);
CREATE POLICY backup_leitura ON tags FOR SELECT TO studyflow_backup USING (true);

ALTER TABLE task_execution_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_todas ON task_execution_tags FOR ALL TO studyflow_api USING (true) WITH CHECK (true);
CREATE POLICY backup_leitura ON task_execution_tags FOR SELECT TO studyflow_backup USING (true);

ALTER TABLE measures ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_todas ON measures FOR ALL TO studyflow_api USING (true) WITH CHECK (true);
CREATE POLICY backup_leitura ON measures FOR SELECT TO studyflow_backup USING (true);

ALTER TABLE measure_kinds ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_todas ON measure_kinds FOR ALL TO studyflow_api USING (true) WITH CHECK (true);
CREATE POLICY backup_leitura ON measure_kinds FOR SELECT TO studyflow_backup USING (true);

ALTER TABLE execution_measures ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_todas ON execution_measures FOR ALL TO studyflow_api USING (true) WITH CHECK (true);
CREATE POLICY backup_leitura ON execution_measures FOR SELECT TO studyflow_backup USING (true);

ALTER TABLE execution_measure_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_todas ON execution_measure_values FOR ALL TO studyflow_api USING (true) WITH CHECK (true);
CREATE POLICY backup_leitura ON execution_measure_values FOR SELECT TO studyflow_backup USING (true);

ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_todas ON exercises FOR ALL TO studyflow_api USING (true) WITH CHECK (true);
CREATE POLICY backup_leitura ON exercises FOR SELECT TO studyflow_backup USING (true);

ALTER TABLE execution_workouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_todas ON execution_workouts FOR ALL TO studyflow_api USING (true) WITH CHECK (true);
CREATE POLICY backup_leitura ON execution_workouts FOR SELECT TO studyflow_backup USING (true);

ALTER TABLE execution_exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_todas ON execution_exercises FOR ALL TO studyflow_api USING (true) WITH CHECK (true);
CREATE POLICY backup_leitura ON execution_exercises FOR SELECT TO studyflow_backup USING (true);

ALTER TABLE exercise_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_todas ON exercise_sets FOR ALL TO studyflow_api USING (true) WITH CHECK (true);
CREATE POLICY backup_leitura ON exercise_sets FOR SELECT TO studyflow_backup USING (true);

ALTER TABLE selections ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_todas ON selections FOR ALL TO studyflow_api USING (true) WITH CHECK (true);
CREATE POLICY backup_leitura ON selections FOR SELECT TO studyflow_backup USING (true);

ALTER TABLE selection_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_todas ON selection_options FOR ALL TO studyflow_api USING (true) WITH CHECK (true);
CREATE POLICY backup_leitura ON selection_options FOR SELECT TO studyflow_backup USING (true);

ALTER TABLE execution_selections ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_todas ON execution_selections FOR ALL TO studyflow_api USING (true) WITH CHECK (true);
CREATE POLICY backup_leitura ON execution_selections FOR SELECT TO studyflow_backup USING (true);

ALTER TABLE works ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_todas ON works FOR ALL TO studyflow_api USING (true) WITH CHECK (true);
CREATE POLICY backup_leitura ON works FOR SELECT TO studyflow_backup USING (true);
