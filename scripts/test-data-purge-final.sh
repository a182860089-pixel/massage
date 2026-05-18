#!/usr/bin/env bash
set +e
export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"
PSQL="psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -P pager=off"

echo "===== 直接按 email 模式补删 activation_records 残留 ====="
$PSQL -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM activation_records
WHERE email LIKE '%@e2e.test'
   OR email LIKE 'smoketest+%' OR email LIKE 'smoketest-%'
   OR email LIKE 'codex-plugin-test-%'
   OR email LIKE 'e2e%@%'
   OR email LIKE 'wrong-%@%' OR email LIKE 'wrong+%@%'
   OR email LIKE 'other-%@%' OR email = 'other@example.com'
   OR email = 'a@b.com';
COMMIT;
SQL

echo ""
echo "===== 校验：所有测试痕迹应该为 0 ====="
$PSQL -c "
SELECT 'members'        AS table_name, count(*) FROM members
  WHERE email LIKE '%@e2e.test' OR email LIKE 'smoketest+%' OR email LIKE 'codex-plugin-test-%' OR email LIKE 'e2e%@%' OR email LIKE 'wrong-%@%' OR email LIKE 'other-%@%' OR email = 'a@b.com'
UNION ALL SELECT 'activation_records', count(*) FROM activation_records
  WHERE email LIKE '%@e2e.test' OR email LIKE 'smoketest+%' OR email LIKE 'codex-plugin-test-%' OR email LIKE 'e2e%@%' OR email LIKE 'wrong-%@%' OR email LIKE 'other-%@%' OR email = 'a@b.com'
UNION ALL SELECT 'plugin_card_bindings', count(*) FROM plugin_card_bindings
  WHERE email LIKE '%@e2e.test' OR email LIKE 'smoketest+%' OR email LIKE 'codex-plugin-test-%' OR email LIKE 'e2e%@%' OR client_id LIKE 'e2e-%' OR client_id LIKE 'cli-%' OR client_id LIKE 'smoke-%' OR client_id LIKE 'codex-test-client-%'
UNION ALL SELECT 'plugin_card_rebind_logs', count(*) FROM plugin_card_rebind_logs
  WHERE email LIKE '%@e2e.test' OR email LIKE 'smoketest+%' OR email LIKE 'codex-plugin-test-%' OR new_client_id LIKE 'e2e-%' OR old_client_id LIKE 'e2e-%' OR new_client_id LIKE 'cli-%' OR old_client_id LIKE 'cli-%'
UNION ALL SELECT 'card_keys(testbound)', count(*) FROM card_keys ck JOIN members m ON ck.member_id=m.id
  WHERE m.email LIKE '%@e2e.test' OR m.email LIKE 'smoketest%' OR m.email LIKE 'codex-plugin-test-%';
"

echo ""
echo "===== 现网真实 members 数（应仍为 2107） ====="
$PSQL -c "
SELECT count(*) AS prod_members FROM members
WHERE NOT (
    email LIKE '%@e2e.test' OR email LIKE 'smoketest+%' OR email LIKE 'codex-plugin-test-%'
    OR email LIKE 'e2e%@%' OR email LIKE 'wrong-%@%' OR email LIKE 'other-%@%' OR email = 'a@b.com'
);"

echo ""
echo "===== activation_records 总条数 ====="
$PSQL -c "SELECT count(*) FROM activation_records;"

unset PGPASSWORD
echo "DONE"
