# Funções do backup e da restauração (ops/backup.sh e ops/restaurar.sh). Nada
# aqui imprime URL nem senha: as mensagens citam só nomes de variável e de tabela.

fail() {
  echo "ERRO: $*" >&2
  exit 1
}

need() {
  for name in "$@"; do
    [ -n "${!name:-}" ] || fail "$name ausente"
  done
}

# A URL não pode trazer parâmetro de SSL: o SSL vem do script (verify-full com a
# CA), e um sslmode na URL mudaria a verificação
check_url() {
  local url=$1 query key
  [[ "$url" =~ ^postgres(ql)?:// ]] || fail "a URL precisa começar com postgres:// ou postgresql://"
  [[ "$url" == *\?* ]] || return 0
  query=${url#*\?}
  IFS='&' read -ra pairs <<< "$query"
  for pair in "${pairs[@]}"; do
    key=${pair%%=*}
    key=${key,,}
    case "$key" in
      ssl | sslmode | sslrootcert | sslcert | sslkey | sslnegotiation | uselibpqcompat)
        fail "a URL tem o parâmetro $key: tire-o (o SSL vem do script, com verify-full)" ;;
    esac
  done
}

# Mesmo formato de texto nas duas pontas da comparação
SESSION_SETUP="SET TIME ZONE 'UTC'; SET datestyle = ISO; SET extra_float_digits = 3;"

# Uma linha por tabela de public: nome, linhas, md5 das linhas em ordem fixa
SUMS_SQL="SELECT format('SELECT %L, count(*), md5(coalesce(string_agg(t::text, %L ORDER BY t::text COLLATE \"C\"), %L)) FROM public.%I t', c.relname, E'\\n', '', c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname \\gexec"

# Banco NOVO no servidor de restauração (nunca apaga um que existe), sem o schema
# public (o dump traz o dele) e com os papéis das políticas e dos GRANT do dump,
# sem login. Imprime o nome do banco criado
prepare_target() {
  local admin=$1 db
  db="studyflow_restauro_$(date -u +%Y%m%d_%H%M%S)"
  psql "$admin" -X -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE $db TEMPLATE template0" >/dev/null ||
    fail "não consegui criar o banco de restauração"
  psql "$admin" -X -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL' || fail "não consegui criar os papéis studyflow_api e studyflow_backup"
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studyflow_api') THEN
    CREATE ROLE studyflow_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studyflow_backup') THEN
    CREATE ROLE studyflow_backup NOLOGIN;
  END IF;
END $$;
SQL
  psql "$(db_url "$admin" "$db")" -X -q -v ON_ERROR_STOP=1 -c "DROP SCHEMA public" >/dev/null ||
    fail "não consegui preparar o banco de restauração"
  echo "$db"
}

# A mesma URL apontando pra outro banco
db_url() {
  local url=$1 db=$2 base query=''
  if [[ "$url" == *\?* ]]; then
    base=${url%%\?*}
    query="?${url#*\?}"
  else
    base=$url
  fi
  echo "${base%/*}/$db$query"
}

# Somas de um banco restaurado (quem restaura é o dono: vê todas as linhas)
restored_sums() {
  psql "$1" -X -q -A -t -F ' ' -v ON_ERROR_STOP=1 <<SQL
$SESSION_SETUP
$SUMS_SQL
SQL
}

# Conferência do restaurado: tabelas com RLS e as políticas do dump
check_restored() {
  local url=$1 got
  got=$(psql "$url" -X -q -A -t -F ' ' -v ON_ERROR_STOP=1 -c "
    SELECT count(*), count(*) FILTER (WHERE c.relrowsecurity),
      (SELECT count(*) FROM pg_policy p JOIN pg_class pc ON pc.oid = p.polrelid
        JOIN pg_namespace pn ON pn.oid = pc.relnamespace WHERE pn.nspname = 'public')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')")
  echo "restaurado: tabelas, com RLS, políticas = $got"
}
