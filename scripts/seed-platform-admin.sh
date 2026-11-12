#!/usr/bin/env bash
# Inserts the first platform admin into an empty database (after platform's migration has created the table).
#   ADMIN_DATABASE_URL='postgresql://...' ADMIN_EMAIL=admin@omniretail.vn ADMIN_PASSWORD='12+chars!Aa1' \
#     scripts/seed-platform-admin.sh
# Password policy: letters, digits and !#$%&*@^, 12+ characters. Idempotent: does nothing if the email exists.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ADMIN_DATABASE_URL:?}" "${ADMIN_EMAIL:?}" "${ADMIN_PASSWORD:?}"
[[ ${#ADMIN_PASSWORD} -ge 12 ]] || { echo "password needs 12+ characters" >&2; exit 1; }
HASH=$(PW="$ADMIN_PASSWORD" node -e "require('argon2').hash(process.env.PW,{type:require('argon2').argon2id}).then(console.log)")
SQL="INSERT INTO public.platform_admin (email, name, role, status, password, created_by, updated_by)
SELECT :'email', 'Platform Admin', 'super_admin', 'active', :'hash', 'manual', 'manual'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_admin WHERE email = :'email' AND deleted_at IS NULL);"
if command -v psql >/dev/null; then P=(psql); else P=(docker --context kiri run --rm -i --network host postgres:16-alpine psql); fi
echo "$SQL" | "${P[@]}" "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -v "email=$ADMIN_EMAIL" -v "hash=$HASH" -f -
