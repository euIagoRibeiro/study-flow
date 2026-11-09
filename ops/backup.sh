#!/usr/bin/env bash
# Backup do banco: o GitHub Actions roda (.github/workflows/backup.yml), e o teste
# local roda o mesmo arquivo (tests/ferramentas/backup-local.mjs). Num postgres:17.11
# com o age. Ambiente:
#   BACKUP_DATABASE_URL  studyflow_backup pelo pooler, sem parâmetro de SSL (secret)
#   AGE_RECIPIENT        a chave pública age (a privada nunca chega aqui)
#   PGSSLROOTCERT        a CA do servidor (ops/supabase-ca.crt)
#   RESTORE_URL          um Postgres 17 descartável, pra restauração de teste
#   OUT                  pasta do arquivo cifrado
#   RESTORE_TAMPER_SQL   SÓ no teste local (o workflow nunca define): SQL rodado no
#                        banco restaurado antes da comparação, o controle negativo
#                        que prova que a comparação acusa uma linha alterada
# Passos: confere a URL e o papel; confere que toda tabela de public tem a
# política backup_leitura (sem ela, a tabela sairia VAZIA e sem erro); abre um
# snapshot; pg_dump nele, em pipe pro age E pra restauração de teste; compara
# contagem e md5 por tabela da origem (no MESMO snapshot) com o restaurado.
# O texto puro nunca vai pra disco. Nada imprime a URL nem a senha
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source "$here/restauro-comum.sh"

need BACKUP_DATABASE_URL AGE_RECIPIENT PGSSLROOTCERT RESTORE_URL OUT
check_url "$BACKUP_DATABASE_URL"
[ -s "$PGSSLROOTCERT" ] || fail "PGSSLROOTCERT não aponta pra um arquivo"
mkdir -p "$OUT"

# O certificado raiz vence: aviso com 60 dias de antecedência (o job continua)
echo "certificado raiz vence em: $(openssl x509 -in "$PGSSLROOTCERT" -noout -enddate | cut -d= -f2)"
if ! openssl x509 -in "$PGSSLROOTCERT" -noout -checkend $((60 * 86400)) >/dev/null; then
  echo "::warning::o certificado raiz (ops/supabase-ca.crt) vence em menos de 60 dias"
fi

# O SSL vem daqui, não da URL (que já foi conferida sem parâmetro de SSL)
sep='?'
[[ "$BACKUP_DATABASE_URL" == *\?* ]] && sep='&'
src="${BACKUP_DATABASE_URL}${sep}sslmode=verify-full&sslrootcert=${PGSSLROOTCERT}"

# Só o papel de backup: um secret com o postgres dumparia igual, mas com escrita
who=$(psql "$src" -X -q -A -t -v ON_ERROR_STOP=1 -c "SELECT current_user") ||
  fail "não conectou à origem (confira a CA e o secret)"
[ "$who" = studyflow_backup ] || fail "BACKUP_DATABASE_URL não é do papel studyflow_backup"

missing=$(psql "$src" -X -q -A -t -v ON_ERROR_STOP=1 -c "
  SELECT coalesce(string_agg(c.relname, ', ' ORDER BY c.relname), '')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND NOT EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = c.oid AND p.polname = 'backup_leitura' AND p.polcmd IN ('r', '*')
        AND p.polroles = ARRAY['studyflow_backup'::regrole::oid]
        AND pg_get_expr(p.polqual, p.polrelid) = 'true')")
[ -z "$missing" ] || fail "tabela sem a política backup_leitura (sairia vazia no dump): $missing"

# Snapshot exportado: o dump e as somas da origem leem o MESMO estado (uma
# gravação do app no meio não vira diferença falsa). A sessão fica aberta até o fim
coproc SNAP { psql "$src" -X -q -A -t -F ' ' -v ON_ERROR_STOP=1 2>&1; }
echo "$SESSION_SETUP BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY; SELECT pg_export_snapshot();" >&"${SNAP[1]}"
read -r -t 60 snapshot <&"${SNAP[0]}" || fail "o snapshot não respondeu"
[[ "$snapshot" =~ ^[0-9A-F]+-[0-9A-F]+-[0-9]+$ ]] || fail "snapshot inesperado"

name="studyflow-$(date -u +%Y%m%d-%H%M%S).dump.age"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkfifo "$tmp/cifrar"
age -r "$AGE_RECIPIENT" -o "$OUT/$name" <"$tmp/cifrar" &
age_pid=$!

db=$(prepare_target "$RESTORE_URL")
target=$(db_url "$RESTORE_URL" "$db")
pg_dump "$src" --snapshot="$snapshot" --enable-row-security --schema=public -Fc |
  tee "$tmp/cifrar" |
  pg_restore --exit-on-error --single-transaction -d "$target" ||
  fail "dump ou restauração de teste falhou"
wait "$age_pid" || fail "o age falhou"
[ "$(head -c 21 "$OUT/$name")" = "age-encryption.org/v1" ] || fail "o arquivo não saiu cifrado"

# Somas da origem dentro do snapshot
{
  echo "$SUMS_SQL"
  echo '\echo __FIM__'
} >&"${SNAP[1]}"
: >"$tmp/origem.txt"
while read -r -t 300 line <&"${SNAP[0]}"; do
  [ "$line" = __FIM__ ] && break
  echo "$line" >>"$tmp/origem.txt"
done
[ "${line:-}" = __FIM__ ] || fail "as somas da origem não terminaram"
echo 'COMMIT;' >&"${SNAP[1]}"
echo '\q' >&"${SNAP[1]}"
wait "$SNAP_PID" 2>/dev/null || true

if [ -n "${RESTORE_TAMPER_SQL:-}" ]; then
  echo "controle negativo: alterando o banco restaurado antes da comparação"
  psql "$target" -X -q -v ON_ERROR_STOP=1 -c "$RESTORE_TAMPER_SQL" >/dev/null || fail "o controle negativo falhou"
fi
restored_sums "$target" >"$tmp/restaurado.txt"
if ! cmp -s "$tmp/origem.txt" "$tmp/restaurado.txt"; then
  # Só os nomes das tabelas (nunca o conteúdo): as que diferem ou faltam de um lado
  differ=$(awk 'NR == FNR { a[$1] = $0; next } { seen[$1] = 1; if (a[$1] != $0) print $1 }
    END { for (t in a) if (!(t in seen)) print t }' "$tmp/origem.txt" "$tmp/restaurado.txt" | sort -u | paste -sd, -)
  fail "a restauração de teste não bate com a origem (contagem ou md5): ${differ:-?}"
fi
check_restored "$target"
tables=$(wc -l <"$tmp/origem.txt")
rows=$(awk '{s += $2} END {print s + 0}' "$tmp/origem.txt")
echo "OK: $tables tabelas, $rows linhas, iguais na restauração de teste; $name, $(wc -c <"$OUT/$name") bytes"
