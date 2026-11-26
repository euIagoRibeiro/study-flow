#!/usr/bin/env bash
# Ensaio de uma migration sobre a RESTAURAÇÃO do backup mais recente, num Postgres 17 descartável (nunca no Supabase).
# Num postgres:17.11 com o age. Ambiente:
#   BACKUP_DIR    pasta dos studyflow-*.dump.age (pega o mais recente pelo nome, que leva a data UTC); ou
#   BACKUP_FILE   um arquivo específico (vale mais que BACKUP_DIR)
#   AGE_IDENTITY  o arquivo da chave PRIVADA age
#   RESTORE_URL   o servidor descartável (banco de manutenção; o ensaio cria um banco novo e o apaga no fim)
#   MIGRATION_FILE  a migration (padrão: a 0016)
#   CASES_FILE    opcional: casos de banco que rodam em BEGIN ... ROLLBACK depois da migration
#   ENSAIO_ACEITA_ANTIGO=1  aceita backup com mais de 48 h;  KEEP_DB=1  não apaga o banco do ensaio
# Confere, cada checagem com o próprio rótulo (todas rodam, e o fim lista as reprovadas):
#   coluna note, 3 CHECKs pelo nome, 0 notas, privilégio do studyflow_backup, leitura do studyflow_api sob RLS,
#   privilégio de gravar do studyflow_api, RLS e políticas iguais, contagem e md5 por tabela iguais antes e depois
#   (o md5 ignora a coluna note, então uma coluna a mais em QUALQUER outra tabela também reprova)
# Nada aqui imprime dado do banco: só nomes de tabela, contagens, e linhas "ERROR:" (nunca DETAIL nem CONTEXT)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source "$here/restauro-comum.sh"

need AGE_IDENTITY RESTORE_URL
[ -s "$AGE_IDENTITY" ] || fail "AGE_IDENTITY não aponta pra um arquivo"
MIGRATION_FILE=${MIGRATION_FILE:-/migrations/0016_add_note_to_time_entries.sql}
[ -s "$MIGRATION_FILE" ] || fail "MIGRATION_FILE não aponta pra um arquivo"
EXPECT_RLS=${EXPECT_RLS:-17 17 34}
MAX_AGE_HOURS=48

# 1. O backup: o mais recente da pasta, e recente de verdade
if [ -n "${BACKUP_FILE:-}" ]; then
  backup=$BACKUP_FILE
else
  need BACKUP_DIR
  backup=$(ls "$BACKUP_DIR"/studyflow-*.dump.age 2>/dev/null | sort | tail -n 1 || true)
  [ -n "$backup" ] || fail "nenhum studyflow-*.dump.age em BACKUP_DIR"
fi
[ -s "$backup" ] || fail "o backup não existe"
base=$(basename "$backup")
[[ "$base" =~ ^studyflow-([0-9]{8})-([0-9]{6})\.dump\.age$ ]] || fail "o nome do backup não tem a data UTC (studyflow-AAAAMMDD-HHMMSS.dump.age)"
d=${BASH_REMATCH[1]}
t=${BASH_REMATCH[2]}
made=$(date -u -d "${d:0:4}-${d:4:2}-${d:6:2} ${t:0:2}:${t:2:2}:${t:4:2}" +%s) || fail "data do backup ilegível"
age_h=$((($(date -u +%s) - made) / 3600))
echo "backup: $base (feito há ${age_h} h)"
if [ "$age_h" -gt "$MAX_AGE_HOURS" ] && [ "${ENSAIO_ACEITA_ANTIGO:-}" != 1 ]; then
  fail "o backup tem mais de $MAX_AGE_HOURS h: faça um novo (ou ENSAIO_ACEITA_ANTIGO=1)"
fi

tmp=$(mktemp -d)
db=
admin_url=$RESTORE_URL
cleanup() {
  if [ -n "$db" ] && [[ "$db" == studyflow_restauro_* ]]; then
    if [ "${KEEP_DB:-}" = 1 ]; then
      echo "KEEP_DB=1: o banco $db ficou"
    else
      psql "$admin_url" -X -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null 2>&1 && echo "banco do ensaio descartado: $db"
    fi
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT

problems=()
problem() {
  problems+=("$*")
  echo "REPROVADO: $*" >&2
}

# Só as linhas ERROR: de um arquivo de erros (o DETAIL e o CONTEXT podem trazer uma linha de dado)
only_errors() { grep -E 'ERROR:' "$1" | grep -vE '^(DETAIL|CONTEXT|HINT)' || true; }

# 2. Restauração
db=$(prepare_target "$RESTORE_URL")
target=$(db_url "$RESTORE_URL" "$db")
age -d -i "$AGE_IDENTITY" "$backup" |
  pg_restore --exit-on-error --single-transaction -d "$target" 2>"$tmp/restore.err" || {
  only_errors "$tmp/restore.err" >&2
  explain_restore_failure "$tmp/restore.err"
  fail "a restauração falhou (a chave abre este arquivo?)"
}
echo "backup restaurado em $db"

q() { psql "$target" -X -q -A -t -v ON_ERROR_STOP=1 "$@"; }

# Mesmas somas do restauro-comum, mas sobre o jsonb SEM a chave note: a migration acrescenta só essa coluna
note_sums() {
  psql "$target" -X -q -A -t -F ' ' -v ON_ERROR_STOP=1 <<'SQL'
SET TIME ZONE 'UTC'; SET datestyle = ISO; SET extra_float_digits = 3;
SELECT format('SELECT %L, count(*), md5(coalesce(string_agg((to_jsonb(t) - %L)::text, %L ORDER BY (to_jsonb(t) - %L)::text COLLATE "C"), %L)) FROM public.%I t', c.relname, 'note', E'\n', 'note', '', c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname \gexec
SQL
}

# "C tabela" = a contagem difere; "M tabela" = a contagem é igual e o md5 difere (uma checagem não cobre a outra)
diff_sums() {
  awk 'NR == FNR { c[$1] = $2; m[$1] = $3; next }
    { seen[$1] = 1; if (!($1 in c) || c[$1] != $2) print "C " $1; else if (m[$1] != $3) print "M " $1 }
    END { for (t in c) if (!(t in seen)) print "C " t }' "$1" "$2" | sort -u
}

rls_counts() { check_restored "$target" | sed 's/.*= //'; }

# 3. Antes
has_note=$(q -c "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'time_entries' AND column_name = 'note'")
[ "$has_note" = 0 ] || fail "o backup já tem a coluna note: a migration já foi aplicada no banco de origem"
rls_before=$(rls_counts)
[ "$rls_before" = "$EXPECT_RLS" ] || fail "antes: tabelas, com RLS, políticas = $rls_before (esperado $EXPECT_RLS)"
note_sums >"$tmp/antes.txt"
echo "antes: $(wc -l <"$tmp/antes.txt") tabelas, $(awk '{s += $2} END {print s + 0}' "$tmp/antes.txt") linhas, RLS e políticas = $rls_before"
sessions_before=$(awk '$1 == "time_entries" { print $2 }' "$tmp/antes.txt")

# 4. A migration, como o roteiro: uma transação, para no primeiro erro
if ! psql "$target" -X -q -1 -v ON_ERROR_STOP=1 -f "$MIGRATION_FILE" >/dev/null 2>"$tmp/mig.err"; then
  only_errors "$tmp/mig.err" >&2
  left=$(q -c "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'time_entries' AND column_name = 'note'")
  [ "$left" = 0 ] || problem "migration não atômica: a coluna note ficou depois do erro"
  [ "${#problems[@]}" -eq 0 ] || fail "A migration falhou e deixou rastro"
  fail "A migration falhou: nada foi aplicado (a transação do -1 desfez tudo)"
fi
echo "migration aplicada: $(basename "$MIGRATION_FILE")"

# 5. Depois, uma checagem por rótulo
col=$(q -c "SELECT data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '-') FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'time_entries' AND column_name = 'note'")
[ "$col" = 'text YES -' ] || problem "tipo da coluna note: '${col:-ausente}' (esperado: text YES -)"

checks=$(q -c "SELECT coalesce(string_agg(conname, ',' ORDER BY conname), '') FROM pg_constraint WHERE conrelid = 'public.time_entries'::regclass AND convalidated AND conname IN ('time_entries_note_not_blank', 'time_entries_note_length', 'time_entries_note_not_estimated')")
[ "$checks" = 'time_entries_note_length,time_entries_note_not_blank,time_entries_note_not_estimated' ] ||
  problem "CHECKs pelo nome: '${checks:-nenhuma}' (esperadas as 3, validadas)"

notes=$(q -c "SELECT count(note) FROM public.time_entries" 2>/dev/null || echo ERRO)
[ "$notes" = 0 ] || problem "notas: $notes (esperado 0 notas)"

backup_read=$(q -c "SELECT has_column_privilege('studyflow_backup', 'public.time_entries', 'note', 'SELECT')")
[ "$backup_read" = t ] || problem "privilégio do studyflow_backup para ler note: $backup_read"

api_write=$(q -c "SELECT has_column_privilege('studyflow_api', 'public.time_entries', 'note', 'UPDATE')")
[ "$api_write" = t ] || problem "privilégio do studyflow_api para gravar note: $api_write"

# Como o backend novo lê: o papel da API, sob RLS, vê todas as sessões e lê a coluna
api_read=$(q -c "SET ROLE studyflow_api; SELECT count(*) || ' ' || count(note) FROM public.time_entries" 2>/dev/null | tail -n 1 || true)
# (só o 1º número conta aqui: quantas notas há é a checagem "notas", e uma não pode reprovar a outra)
[ "${api_read%% *}" = "$sessions_before" ] || problem "leitura de note pelo studyflow_api sob RLS: '${api_read:-erro}' (esperado $sessions_before sessões visíveis)"

rls_after=$(rls_counts)
[ "$rls_after" = "$rls_before" ] || problem "RLS e políticas depois da migration: $rls_after (antes $rls_before)"

note_sums >"$tmp/depois.txt"
diff_sums "$tmp/antes.txt" "$tmp/depois.txt" >"$tmp/dif.txt"
counts_bad=$(awk '$1 == "C" { print $2 }' "$tmp/dif.txt" | paste -sd, -)
md5_bad=$(awk '$1 == "M" { print $2 }' "$tmp/dif.txt" | paste -sd, -)
[ -z "$counts_bad" ] || problem "contagem de linhas mudou: $counts_bad"
[ -z "$md5_bad" ] || problem "conteúdo (md5, sem a coluna note) mudou: $md5_bad"

# 6. Casos de banco: BEGIN ... ROLLBACK, saída só ERROR: e o "N de N"; depois, as somas de novo (rollback de verdade)
if [ -n "${CASES_FILE:-}" ]; then
  [ -s "$CASES_FILE" ] || fail "CASES_FILE não aponta pra um arquivo"
  {
    echo 'BEGIN;'
    cat "$CASES_FILE"
    echo 'ROLLBACK;'
  } | psql "$target" -X -q -A -t -v ON_ERROR_STOP=1 >"$tmp/cases.out" 2>"$tmp/cases.err" || {
    only_errors "$tmp/cases.err" >&2
    problem "casos de banco: o psql parou com erro"
  }
  total=$(grep -E '^[0-9]+ de [0-9]+$' "$tmp/cases.out" | tail -n 1 || true)
  failed=$(grep -c '^FALHOU' "$tmp/cases.out" || true)
  echo "casos de banco: ${total:-sem linha N de N} (falharam: $failed)"
  if [[ "$total" =~ ^([0-9]+)\ de\ ([0-9]+)$ ]] && [ "${BASH_REMATCH[1]}" = "${BASH_REMATCH[2]}" ] && [ "${BASH_REMATCH[2]}" -gt 0 ]; then
    :
  else
    problem "casos de banco: ${total:-sem a linha N de N}"
  fi
  note_sums >"$tmp/depois-casos.txt"
  cmp -s "$tmp/depois.txt" "$tmp/depois-casos.txt" || problem "os casos de banco deixaram resíduo (as somas mudaram depois do ROLLBACK)"
fi

if [ "${#problems[@]}" -gt 0 ]; then
  echo "ERRO: ensaio reprovado em ${#problems[@]} checagem(ns):" >&2
  printf '  - %s\n' "${problems[@]}" >&2
  exit 1
fi
echo "OK: ensaio da migração: $(wc -l <"$tmp/antes.txt") tabelas, $(awk '{s += $2} END {print s + 0}' "$tmp/antes.txt") linhas, contagem e md5 iguais antes e depois, nota em 0 linhas, RLS e políticas = $rls_after"
