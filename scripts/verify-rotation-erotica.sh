#!/usr/bin/env bash
# ============================================================================
# ROTATION EROTICA — GO/NO-GO VERIFICATION (zzybjoowhkwuomnpixuy)
# Run after every deploy touching RLS, functions, or the edge gateway.
# Usage:
#   export SUPABASE_URL=https://zzybjoowhkwuomnpixuy.supabase.co
#   export SUPABASE_ANON_KEY=...
#   export SUPABASE_SERVICE_ROLE_KEY=...
#   bash scripts/verify-rotation-erotica.sh
# ============================================================================
set -uo pipefail

SUPABASE_URL="${SUPABASE_URL:?Set SUPABASE_URL}"
ANON_KEY="${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY}"

PASS=0; FAIL=0
check() { # name expected_csv actual
  local name="$1" expected="$2" actual="$3"
  if [[ ",$expected," == *",$actual,"* ]]; then
    echo "✅ PASS: $name (HTTP $actual)"; PASS=$((PASS+1))
  else
    echo "❌ FAIL: $name — expected [$expected], got HTTP $actual"; FAIL=$((FAIL+1))
  fi
}

echo "🧪 ROTATION EROTICA — GO/NO-GO VERIFICATION"
echo "============================================"

# 1. transfer_rtv blocked for anon (fund-drain fix)
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SUPABASE_URL/rest/v1/rpc/transfer_rtv" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"p_sender_id":"00000000-0000-0000-0000-000000000001","p_receiver_id":"00000000-0000-0000-0000-000000000002","p_amount":1000,"p_type":"gift"}')
check "transfer_rtv blocked for anon" "400,401,403,404" "$CODE"

# 2. gift_transactions INSERT blocked (free-gift fix)
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SUPABASE_URL/rest/v1/gift_transactions" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H 'Content-Type: application/json' \
  -H 'Prefer: return=minimal' \
  -d '{"sender_id":"00000000-0000-0000-0000-000000000001","receiver_id":"00000000-0000-0000-0000-000000000002","rtv_amount":9999,"gift_type":"fabricated"}')
check "gift_transactions INSERT blocked" "400,401,403" "$CODE"

# 3. live_rooms protected-column write blocked (stream-credential fix)
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH \
  "$SUPABASE_URL/rest/v1/live_rooms?id=eq.00000000-0000-0000-0000-000000000001" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"stream_key":"spoofed","rtv_earned_session":999999}')
check "live_rooms protected columns blocked" "400,401,403" "$CODE"

# 4. service_role retains read access (worker flows intact)
CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  "$SUPABASE_URL/rest/v1/gifts?select=id&limit=1" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY")
check "service_role catalog read" "200" "$CODE"

# 5. telegram-auth-bridge reachable
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$SUPABASE_URL/functions/v1/telegram-auth-bridge")
check "telegram-auth-bridge reachable" "200,401,404" "$CODE"

echo "============================================"
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "🟢 GO — safe for production traffic" || { echo "🔴 NO-GO — do not route traffic"; exit 1; }

# Optional deep verification (requires psql + direct DB connection string):
#   SELECT proname, proacl::text FROM pg_proc
#   WHERE proname IN ('transfer_rtv','handle_new_user','prune_stale_stream_viewers','protect_live_rooms_stream_columns');
# Expected: only postgres/service_role entries in proacl for all four.
