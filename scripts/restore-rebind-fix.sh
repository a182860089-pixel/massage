#!/usr/bin/env bash
# 精确恢复：把 card_key_id=42264 的 binding 改回测试紧邻前的 client_id 8cf2d4a9-...
set +e
export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"
PSQL="psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -P pager=off"

echo "===== 当前 binding 状态 ====="
$PSQL -c "
SELECT card_key_id, email, client_id, rebind_count, last_seen_at
FROM plugin_card_bindings
WHERE card_key_id = 42264;
"

echo ""
echo "===== 精确还原到 8cf2d4a9-5d4b-4daf-b6ff-ca81f97d2036 ====="
$PSQL -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
UPDATE plugin_card_bindings
SET client_id = '8cf2d4a9-5d4b-4daf-b6ff-ca81f97d2036'
WHERE card_key_id = 42264
  AND client_id = 'codex-test-client-487ed7f3ffdf07ea';
COMMIT;
SQL

echo ""
echo "===== 还原后 binding 状态 ====="
$PSQL -c "
SELECT card_key_id, email, client_id, rebind_count, last_seen_at
FROM plugin_card_bindings
WHERE card_key_id = 42264;
"

unset PGPASSWORD
echo "DONE"
