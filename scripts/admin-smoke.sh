#!/usr/bin/env bash
# End-to-end smoke test of the platform-admin backend, through the gateway only: dashboard, audit log, announcements,
# support sessions (read-only token) and the integration views. The data comes from scripts/fixtures/admin-test-data.json
# and is created through the APIs (stable stores "smoke-a/b/c", so repeated runs reuse them). The only thing that must
# exist beforehand is a platform admin (super_admin).
#
#   Local stack:  docker compose up -d --build, then (once) create the admin:
#                 docker compose exec -e PLATFORM_ADMIN_BOOTSTRAP_PASSWORD='Admin12345!xy' platform \
#                   pnpm exec ts-node -r tsconfig-paths/register apps/platform/src/scripts/create-platform-admin.ts \
#                   --email admin@omniretail.vn --name "Platform Admin"
#                 ADMIN_EMAIL=admin@omniretail.vn ADMIN_PASSWORD='Admin12345!xy' scripts/admin-smoke.sh
#   Deployed:     API=https://api.sapo.makeasy.id.vn ALLOW_LIVE=1 ADMIN_EMAIL=... ADMIN_PASSWORD=... scripts/admin-smoke.sh
#
# Safety on a deployed environment (ALLOW_LIVE=1 is required): announcements go only to the smoke stores (audience
# `tenants`, never `all` or a plan), no store owner is registered (no emails are queued; OWNER_FLOW=1 forces it), and
# platform settings are untouched (TOUCH_SETTINGS=1 changes the support email and restores it). Needs bash, curl, jq.
# Every step is asserted: the script exits non-zero on the first failure.
set -euo pipefail
trap 'echo "FAILED at line $LINENO: $BASH_COMMAND" >&2' ERR

API="${API:-http://localhost:${GATEWAY_HOST_PORT:-8080}}"
ADMIN_EMAIL="${ADMIN_EMAIL:?set ADMIN_EMAIL (a platform admin)}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?set ADMIN_PASSWORD}"
here="$(cd "$(dirname "$0")" && pwd)"
fixtures="${FIXTURES:-$here/fixtures/admin-test-data.json}"
local_run=false
[[ "$API" == http://localhost* || "$API" == http://127.0.0.1* ]] && local_run=true
if ! $local_run && [[ "${ALLOW_LIVE:-}" != "1" ]]; then
  echo "FAIL: $API is not local; set ALLOW_LIVE=1 to run against a deployed environment" >&2; exit 1
fi
OWNER_FLOW="${OWNER_FLOW:-$($local_run && echo 1 || echo 0)}"
TOUCH_SETTINGS="${TOUCH_SETTINGS:-$($local_run && echo 1 || echo 0)}"

platform="$API/platform/api/v1"
insight="$API/insight/api/v1"
integration="$API/integration/api/v1"
steps=0

command -v jq >/dev/null 2>&1 || { echo "FAIL: jq is required" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "FAIL: curl is required" >&2; exit 1; }
[[ -r "$fixtures" ]] || { echo "FAIL: cannot read $fixtures" >&2; exit 1; }

fail() { echo "FAIL: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
ok() { steps=$((steps + 1)); echo "   ok: $*"; }
new_uuid() {
  if [[ -r /proc/sys/kernel/random/uuid ]]; then cat /proc/sys/kernel/random/uuid
  elif command -v uuidgen >/dev/null 2>&1; then uuidgen | tr 'A-Z' 'a-z'
  else od -An -N16 -tx1 /dev/urandom | tr -d ' \n' | sed -E 's/(.{8})(.{4}).(.{3}).(.{3})(.{12})/\1-\2-4\3-8\4-\5/'
  fi
}
fx() { jq -r "$1" "$fixtures"; }
day() { date -u -d "$1" +%F; } # day "+5 days"

# http <method> <url> <token> [json] [extra header] -> "<body>\n<status>"
http() {
  local args=(-s --max-time 30 -w "\n%{http_code}" -X "$1")
  [[ -z "${3:-}" ]] || args+=(-H "Authorization: Bearer $3")
  [[ -z "${4:-}" ]] || args+=(-H "Content-Type: application/json" -d "$4")
  [[ -z "${5:-}" ]] || args+=(-H "$5")
  curl "${args[@]}" "$2"
}
status_of() { tail -n1; }
body_of() { sed '$d'; }
expect_status() { # expected description response
  local code
  code=$(printf '%s' "$3" | status_of)
  [[ "$code" == "$1" ]] || fail "$2: expected $1, got $code: $(printf '%s' "$3" | body_of | head -c 400)"
  ok "$2 -> $1"
}
jv() { printf '%s' "$1" | body_of | jq -r "$2"; }
expect_eq() { # response filter expected description
  local got
  got=$(jv "$1" "$2")
  [[ "$got" == "$3" ]] || fail "$4: expected $2 = $3, got $got in: $(printf '%s' "$1" | body_of | head -c 500)"
  ok "$4 ($2 = $3)"
}
expect_true() { # response filter description
  [[ "$(jv "$1" "$2")" == "true" ]] || fail "$3: '$2' is not true in: $(printf '%s' "$1" | body_of | head -c 500)"
  ok "$3"
}
# events are eventually consistent: retry a check for up to 40 s. check_is <url> <token> <jq boolean filter>
wait_for() { local what="$1"; shift; for _ in $(seq 1 40); do if "$@" >/dev/null 2>&1; then ok "$what"; return 0; fi; sleep 1; done; fail "timed out waiting for: $what"; }
get_is() { [[ "$(http GET "$1" "$2" | body_of | jq -r "$3" 2>/dev/null)" == "true" ]]; }
claims() { local p; p=$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+'); while (( ${#p} % 4 )); do p+='='; done; printf '%s' "$p" | base64 -d 2>/dev/null; }

# ---------------------------------------------------------------------------------------------
step "0. Reachability and the admin sign-in ($API)"
curl -sf --max-time 20 "$API/platform/health" >/dev/null || fail "the gateway does not answer at $API"
ok "gateway reachable"
login=$(http POST "$platform/admin/auth/login" "" "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p}')")
expect_status 200 "admin sign-in" "$login"
admin=$(jv "$login" .accessToken)
[[ -n "$admin" && "$admin" != null ]] || fail "no admin token"
me=$(http GET "$platform/admin/me" "$admin")
expect_status 200 "GET /admin/me" "$me"
admin_role=$(jv "$me" .role)
ok "signed in as $ADMIN_EMAIL ($admin_role)"

# ---------------------------------------------------------------------------------------------
step "1. Every admin route refuses a request with no token (401)"
from=$(day "-$(fx .ranges.dashboardDays) days"); to=$(day "today")
admin_gets=(
  "$insight/admin/overview?from=$from&to=$to"
  "$insight/admin/transactions/daily?from=$from&to=$to"
  "$insight/admin/watchlist"
  "$insight/admin/announcements"
  "$insight/admin/audit-logs"
  "$insight/admin/audit-logs/actions"
  "$integration/admin/connections"
  "$integration/admin/sync-history"
  "$integration/admin/webhook-events"
  "$platform/admin/support-sessions"
)
for u in "${admin_gets[@]}"; do expect_status 401 "GET ${u#"$API"} without a token" "$(http GET "$u" "")"; done
expect_status 401 "POST support-sessions without a token" "$(http POST "$platform/admin/support-sessions" "" '{}')"

# ---------------------------------------------------------------------------------------------
step "2. The smoke stores and their plans (created through the admin API; reused when they exist)"
plans=$(http GET "$platform/admin/plans" "$admin")
expect_status 200 "GET /admin/plans" "$plans"
ids=(); keys=()
n=$(fx '.stores|length')
for i in $(seq 0 $((n - 1))); do
  key=$(fx ".stores[$i].key"); sub=$(fx ".stores[$i].subdomain")
  body=$(jq -c --argjson i "$i" '.stores[$i] | {name,subdomain,email,phone,address,owner,planCode:.plan.code}' "$fixtures")
  res=$(http POST "$platform/admin/tenants" "$admin" "$body")
  code=$(printf '%s' "$res" | status_of)
  if [[ "$code" == 201 ]]; then ok "created store $sub"
  elif [[ "$(jv "$res" .errorCode)" == "T001" || "$code" == 400 ]]; then ok "store $sub already exists"
  else fail "create store $sub: $code $(printf '%s' "$res" | body_of | head -c 300)"; fi
  found=$(http GET "$platform/admin/tenants?q=$sub&limit=50" "$admin")
  id=$(jv "$found" ".data[]? | select(.subdomain == \"$sub\") | .id" | head -n1)
  [[ -n "$id" && "$id" != null ]] || fail "store $sub not found in /admin/tenants"
  ids+=("$id"); keys+=("$key")
done
tid() { local k="$1"; for i in "${!keys[@]}"; do [[ "${keys[$i]}" == "$k" ]] && { echo "${ids[$i]}"; return; }; done; }
store_a=$(tid a); store_b=$(tid b); store_c=$(tid c)
for i in $(seq 0 $((n - 1))); do
  pcode=$(fx ".stores[$i].plan.code"); days=$(fx ".stores[$i].plan.expiresInDays // empty")
  [[ "$pcode" != "free" && -n "$days" ]] || continue
  id=$(tid "$(fx ".stores[$i].key")")
  res=$(http POST "$platform/admin/subscriptions/change-plan" "$admin" \
    "$(jq -nc --arg t "$id" --arg p "$pcode" --arg f "$(day today)" --arg e "$(day "+$days days")" '{tenantId:$t,planCode:$p,effectiveFrom:$f,expiresAt:$e,note:"admin-smoke.sh"}')")
  code=$(printf '%s' "$res" | status_of)
  if [[ "$code" == 200 || "$code" == 201 ]]; then ok "store $(fx ".stores[$i].subdomain") is on $pcode until $(day "+$days days")"
  elif [[ "$(jv "$res" .errorCode)" == "S011" ]]; then ok "store $(fx ".stores[$i].subdomain") already on $pcode for that period"
  else fail "change plan: $code $(printf '%s' "$res" | body_of | head -c 300)"; fi
done

# ---------------------------------------------------------------------------------------------
step "3. Dashboard"
ov=$(http GET "$insight/admin/overview?from=$from&to=$to" "$admin")
expect_status 200 "GET /admin/overview" "$ov"
expect_true "$ov" '(.tenants|type=="object") and (.subscriptions|type=="object") and (.transactions|type=="object")' "overview has tenants, subscriptions and transactions"
wait_for "overview counts the smoke stores (events reach insight)" get_is "$insight/admin/overview?from=$from&to=$to" "$admin" '.tenants.total >= 3'
wait_for "an expiring subscription is counted (store A, 5 days left)" get_is "$insight/admin/overview?from=$from&to=$to" "$admin" '.subscriptions.expiringSoon >= 1'
daily=$(http GET "$insight/admin/transactions/daily?from=$from&to=$to" "$admin")
expect_status 200 "GET /admin/transactions/daily" "$daily"
expect_eq "$daily" '.data|length' "$(( $(fx .ranges.dashboardDays) + 1 ))" "one row per day, zero days included"
expect_status 422 "from after to is refused" "$(http GET "$insight/admin/transactions/daily?from=$to&to=$from" "$admin")"
expect_status 422 "a range over 92 days is refused" "$(http GET "$insight/admin/transactions/daily?from=$(day "-$(fx .ranges.tooLongDays) days")&to=$to" "$admin")"
wait_for "the watchlist shows store A as expiring" get_is "$insight/admin/watchlist?limit=20" "$admin" "[.data[]? | select(.kind==\"subscription_expiring\" and .tenantId==\"$store_a\")] | length >= 1"

# ---------------------------------------------------------------------------------------------
step "4. Support session on store A: a read-only token that dies when the session ends"
reason=$(fx .supportSession.reason)
key1=$(new_uuid)
start=$(http POST "$platform/admin/support-sessions" "$admin" "$(jq -nc --arg t "$store_a" --arg r "$reason" '{tenantId:$t,reason:$r}')" "Idempotency-Key: $key1")
code=$(printf '%s' "$start" | status_of)
if [[ "$code" == 400 && "$(jv "$start" .errorCode)" == "SS01" ]]; then
  # a session from an earlier run is still open: end it and start again
  open=$(http GET "$platform/admin/support-sessions?tenantId=$store_a&status=active" "$admin")
  for sid in $(jv "$open" '.data[]?.id'); do http POST "$platform/admin/support-sessions/$sid/end" "$admin" >/dev/null; done
  start=$(http POST "$platform/admin/support-sessions" "$admin" "$(jq -nc --arg t "$store_a" --arg r "$reason" '{tenantId:$t,reason:$r}')" "Idempotency-Key: $key1")
fi
expect_status 201 "start a support session" "$start"
session=$(jv "$start" .id); support=$(jv "$start" .accessToken)
[[ "$support" != null && -n "$support" ]] || fail "no support token"
expect_eq "$start" .accessMode read_only "the session is read-only"
expect_eq "$start" .status active "the session is active"
claims_c=$(claims "$support")
[[ "$(printf '%s' "$claims_c" | jq -r '.read_only')" == "true" && "$(printf '%s' "$claims_c" | jq -r '.act.ssn')" == "$session" ]] || fail "token claims: $claims_c"
ok "token carries read_only and act.ssn"
[[ "$(printf '%s' "$claims_c" | jq -r '(.perms|index("*")) // "none"')" == "none" ]] || fail "support token must never carry the * permission"
ok "token has no wildcard permission"
replay=$(http POST "$platform/admin/support-sessions" "$admin" "$(jq -nc --arg t "$store_a" --arg r "$reason" '{tenantId:$t,reason:$r}')" "Idempotency-Key: $key1")
expect_eq "$replay" .id "$session" "the same Idempotency-Key returns the same session"
second=$(http POST "$platform/admin/support-sessions" "$admin" "$(jq -nc --arg t "$store_a" --arg r "$reason" '{tenantId:$t,reason:$r}')" "Idempotency-Key: $(new_uuid)")
expect_status 400 "a second open session for the same admin and store" "$second"
expect_eq "$second" .errorCode SS01 "refused with SS01"
list_s=$(http GET "$platform/admin/support-sessions?tenantId=$store_a" "$admin")
expect_status 200 "list support sessions" "$list_s"
expect_true "$list_s" "[.data[]? | select(.id==\"$session\")] | length == 1" "the session is in the list"
expect_true "$list_s" '[.. | .accessToken? // empty] | length == 0' "the list never returns an access token"
expect_status 200 "the support token can read the store (GET /branches)" "$(http GET "$platform/branches" "$support")"
w=$(http POST "$platform/branches" "$support" '{"name":"Nope","code":"NOPE"}')
expect_status 403 "the support token cannot write (POST /branches)" "$w"
expect_eq "$w" .errorCode AUTH_READ_ONLY "refused with AUTH_READ_ONLY"
expect_status 403 "the support token is refused on an admin route (/admin/me)" "$(http GET "$platform/admin/me" "$support")"
expect_status 403 "the support token is refused on an insight admin route" "$(http GET "$insight/admin/overview?from=$from&to=$to" "$support")"
if [[ "$(fx '.stores|length')" -ge 3 ]]; then
  http POST "$platform/admin/tenants/$store_c/suspend" "$admin" '{"reason":"admin-smoke.sh"}' >/dev/null
  sus=$(http POST "$platform/admin/support-sessions" "$admin" "$(jq -nc --arg t "$store_c" --arg r "$reason" '{tenantId:$t,reason:$r}')" "Idempotency-Key: $(new_uuid)")
  expect_eq "$sus" .errorCode SS02 "a suspended store cannot be opened (SS02)"
  expect_status 200 "reactivate store C" "$(http POST "$platform/admin/tenants/$store_c/reactivate" "$admin" '{"note":"admin-smoke.sh"}')"
fi
# keep the support token for the bell check below; end the session at the end of step 5

# ---------------------------------------------------------------------------------------------
step "5. Announcements (only to the smoke stores)"
a_title=$(fx .announcements.toStores.title)
aud=$(jq -nc --arg a "$store_a" --arg b "$store_b" '{type:"tenants",tenantIds:[$a,$b]}')
created=$(http POST "$insight/admin/announcements" "$admin" "$(jq -nc --argjson au "$aud" --argjson f "$(jq -c .announcements.toStores "$fixtures")" '$f + {audience:$au}')")
expect_status 201 "create a draft" "$created"
ann=$(jv "$created" .id)
expect_eq "$created" .status draft "it is a draft"
expect_status 200 "edit the draft" "$(http PATCH "$insight/admin/announcements/$ann" "$admin" "{\"title\":\"$a_title (edited)\"}")"
prev=$(http POST "$insight/admin/announcements/audience-preview" "$admin" "{\"audience\":$aud}")
expect_status 200 "audience preview" "$prev"
wait_for "the preview counts both smoke stores" bash -c "[[ \"\$(curl -s -X POST -H 'Authorization: Bearer $admin' -H 'Content-Type: application/json' -d '{\"audience\":$aud}' '$insight/admin/announcements/audience-preview' | jq -r .tenantCount)\" == 2 ]]"
expect_status 200 "preview of a plan audience (count only, nothing is sent)" "$(http POST "$insight/admin/announcements/audience-preview" "$admin" '{"audience":{"type":"plan","planCodes":["pro"]}}')"
lst=$(http GET "$insight/admin/announcements" "$admin")
expect_status 200 "list announcements" "$lst"
expect_true "$lst" '.counts | has("all")' "the list has counts for the tabs"
sent=$(http POST "$insight/admin/announcements/$ann/send" "$admin" '{}')
expect_status 200 "send now" "$sent"
expect_eq "$sent" .status sent "status is sent"
expect_eq "$(http PATCH "$insight/admin/announcements/$ann" "$admin" '{"title":"late"}')" .errorCode N001 "editing a sent announcement is refused (N001)"
expect_eq "$(http POST "$insight/admin/announcements/$ann/send" "$admin" '{}')" .errorCode N001 "sending twice is refused (N001)"
wait_for "store A's bell shows it (read with the support token)" get_is "$insight/notifications" "$support" "[.data[]? | tostring | select(contains(\"$a_title\"))] | length >= 1"
sch=$(http POST "$insight/admin/announcements" "$admin" "$(jq -nc --argjson au "$aud" --argjson f "$(jq -c .announcements.scheduled "$fixtures")" '$f + {audience:$au}')")
sch_id=$(jv "$sch" .id)
future=$(date -u -d "+2 days" +%FT%T.000Z); past=$(date -u -d "-1 hour" +%FT%T.000Z)
expect_status 422 "a schedule in the past is refused" "$(http POST "$insight/admin/announcements/$sch_id/send" "$admin" "{\"scheduledAt\":\"$past\"}")"
expect_eq "$(http POST "$insight/admin/announcements/$sch_id/send" "$admin" "{\"scheduledAt\":\"$future\"}")" .status scheduled "schedule it for later"
expect_eq "$(http PATCH "$insight/admin/announcements/$sch_id" "$admin" '{"title":"x"}')" .errorCode N003 "a scheduled one cannot be edited (N003)"
expect_eq "$(http POST "$insight/admin/announcements/$sch_id/cancel" "$admin" '{}')" .status draft "cancel puts it back to draft"
expect_status 204 "delete the draft" "$(http DELETE "$insight/admin/announcements/$sch_id" "$admin")"
nobody=$(http POST "$insight/admin/announcements" "$admin" "$(jq -nc --arg u "$(fx .announcements.unknownAudienceTenantId)" --argjson f "$(jq -c .announcements.scheduled "$fixtures")" '$f + {audience:{type:"tenants",tenantIds:[$u]}}')")
nb=$(jv "$nobody" .id)
expect_eq "$(http POST "$insight/admin/announcements/$nb/send" "$admin" '{}')" .errorCode N002 "an audience with no store is refused (N002)"
http DELETE "$insight/admin/announcements/$nb" "$admin" >/dev/null

# end the support session now
ended=$(http POST "$platform/admin/support-sessions/$session/end" "$admin" '{}')
expect_status 200 "end the support session" "$ended"
expect_eq "$ended" .status ended "status is ended"
expect_status 401 "the support token is dead after the end" "$(http GET "$platform/branches" "$support")"
expect_eq "$(http POST "$platform/admin/support-sessions/$session/end" "$admin" '{}')" .errorCode SS03 "ending twice is refused (SS03)"

# ---------------------------------------------------------------------------------------------
step "6. Audit log: the admin writes above are recorded"
al="$insight/admin/audit-logs"
wait_for "subscription.plan_changed for store A" get_is "$al?tenantId=$store_a&limit=100" "$admin" '[.data[]? | select(.action=="subscription.plan_changed")] | length >= 1'
wait_for "support_session.started for store A" get_is "$al?tenantId=$store_a&limit=100" "$admin" '[.data[]? | select(.action=="support_session.started")] | length >= 1'
wait_for "support_session.ended for store A" get_is "$al?tenantId=$store_a&limit=100" "$admin" '[.data[]? | select(.action=="support_session.ended")] | length >= 1'
wait_for "the actor is the admin, with a name" get_is "$al?tenantId=$store_a&limit=100" "$admin" '[.data[]? | select(.action=="support_session.started" and .actor.type=="platform_admin" and (.actor.name|type=="string"))] | length >= 1'
wait_for "tenant.status_changed (store C suspended and reactivated)" get_is "$al?tenantId=$store_c&limit=100" "$admin" '[.data[]? | select(.action=="tenant.status_changed")] | length >= 1'
acts=$(http GET "$al/actions" "$admin")
expect_status 200 "GET /audit-logs/actions" "$acts"
filtered=$(http GET "$al?action=support_session.started&result=success&limit=5" "$admin")
expect_true "$filtered" '[.data[]? | select(.action != "support_session.started")] | length == 0' "the action filter filters"
expect_status 422 "an unknown result filter is refused" "$(http GET "$al?result=maybe" "$admin")"
if [[ "$TOUCH_SETTINGS" == "1" ]]; then
  cur=$(http GET "$platform/admin/settings" "$admin"); old_mail=$(jv "$cur" .general.supportEmail)
  expect_status 200 "change the support email" "$(http PATCH "$platform/admin/settings" "$admin" "{\"general\":{\"supportEmail\":\"$(fx .settings.supportEmailForTest)\"}}")"
  expect_status 200 "restore the support email" "$(http PATCH "$platform/admin/settings" "$admin" "{\"general\":{\"supportEmail\":\"$old_mail\"}}")"
  wait_for "a platform-scope row (settings.changed, no store)" get_is "$al?scope=platform&limit=50" "$admin" '[.data[]? | select(.action=="settings.changed" and .scope.type=="platform" and .scope.tenantId==null)] | length >= 1'
else
  echo "   skip: settings are not touched on a deployed environment (TOUCH_SETTINGS=1 to include it)"
fi

# ---------------------------------------------------------------------------------------------
step "7. Integration views (the smoke stores have no marketplace connection, so lists may be empty)"
conn=$(http GET "$integration/admin/connections" "$admin")
expect_status 200 "GET /admin/connections" "$conn"
expect_true "$conn" '(.data|type=="array") and (.pagination|type=="object") and (.counts|type=="object")' "list shape: data, pagination, counts"
expect_true "$conn" '[.. | strings | select(test("access_token|refresh_token|webhook_secret|encrypted"))] | length == 0' "no secret-looking field in the list"
expect_status 200 "GET /admin/sync-history" "$(http GET "$integration/admin/sync-history" "$admin")"
expect_status 200 "GET /admin/webhook-events" "$(http GET "$integration/admin/webhook-events" "$admin")"
ghost=$(new_uuid)
expect_status 404 "an unknown connection is 404" "$(http GET "$integration/admin/connections/$ghost" "$admin")"
expect_status 404 "check on an unknown connection is 404" "$(http POST "$integration/admin/connections/$ghost/check" "$admin" '{}')"
dis=$(http POST "$integration/admin/connections/$ghost/disconnect" "$admin" '{"reason":"smoke"}')
expect_status 404 "disconnect of an unknown connection is 404" "$dis"
first=$(jv "$conn" '.data[0].id // empty')
if [[ -n "$first" ]]; then
  det=$(http GET "$integration/admin/connections/$first" "$admin")
  expect_status 200 "connection detail ($first)" "$det"
  expect_true "$det" '[.. | strings | select(test("access_token|refresh_token|webhook_secret"))] | length == 0' "no secret-looking field in the detail"
else
  echo "   skip: no connection exists yet, so detail, check and disconnect are only checked for 404"
fi

# ---------------------------------------------------------------------------------------------
step "8. A store owner's token is refused on every admin route (local runs; OWNER_FLOW=1 elsewhere)"
if [[ "$OWNER_FLOW" == "1" ]]; then
  run="$(date +%s)"; owner="smoke-owner-$run@example.com"; pw="Passw0rd!"
  curl -s -o /dev/null -H "Content-Type: application/json" -d "{\"email\":\"$owner\",\"password\":\"$pw\",\"name\":\"smoke\"}" "$platform/auth/email/register"
  ot=$(curl -s -H "Content-Type: application/json" -d "{\"email\":\"$owner\",\"password\":\"$pw\"}" "$platform/auth/email/login" | jq -r .accessToken)
  cr=$(http POST "$platform/tenants" "$ot" "{\"name\":\"Smoke Own $run\",\"subdomain\":\"smoke-own-$run\"}")
  expect_status 201 "an owner creates a store" "$cr"
  store_token=$(jv "$cr" .auth.accessToken)
  for u in "${admin_gets[@]}"; do expect_status 403 "owner token on GET ${u#"$API"}" "$(http GET "$u" "$store_token")"; done
  expect_status 403 "owner token on POST /admin/support-sessions" "$(http POST "$platform/admin/support-sessions" "$store_token" "{\"tenantId\":\"$store_a\",\"reason\":\"x\"}")"
  expect_status 403 "owner token on POST /admin/announcements" "$(http POST "$insight/admin/announcements" "$store_token" '{}')"
  expect_status 403 "admin token on a store route (GET /branches)" "$(http GET "$platform/branches" "$admin")"
else
  echo "   skip: no owner is registered on a deployed environment (it would queue emails); the support token was refused on the admin routes in step 4"
fi

echo
echo "Admin smoke test passed: $steps checks ($API)."
