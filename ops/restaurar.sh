#!/usr/bin/env bash
# Restauração de um backup cifrado num Postgres 17 (a mensal do roteiro, e o teste
# local). Num postgres:17.11 com o age. Ambiente:
#   BACKUP_FILE   o arquivo .dump.age baixado do Actions
#   AGE_IDENTITY  o arquivo da chave PRIVADA age (fica na máquina do Iago)
#   RESTORE_URL   o servidor de restauração (banco de manutenção; cria um banco novo)
# Cria os papéis studyflow_api e studyflow_backup SEM login antes do pg_restore
# (as políticas e os GRANT do dump os citam) e nunca apaga um banco que existe.
# Imprime contagem e md5 por tabela e a conferência de RLS e políticas
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source "$here/restauro-comum.sh"

need BACKUP_FILE AGE_IDENTITY RESTORE_URL
[ -s "$BACKUP_FILE" ] || fail "BACKUP_FILE não aponta pra um arquivo"
[ -s "$AGE_IDENTITY" ] || fail "AGE_IDENTITY não aponta pra um arquivo"

db=$(prepare_target "$RESTORE_URL")
target=$(db_url "$RESTORE_URL" "$db")
age -d -i "$AGE_IDENTITY" "$BACKUP_FILE" |
  pg_restore --exit-on-error --single-transaction -d "$target" ||
  fail "a restauração falhou"
echo "banco restaurado: $db"
restored_sums "$target"
check_restored "$target"
