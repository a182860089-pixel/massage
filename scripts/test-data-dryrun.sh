#!/usr/bin/env bash
# DRY-RUN：调研要清理的测试数据范围，列出来不动数据库
set +e
export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"
PSQL="psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -P pager=off"

echo "========================================================================"
echo "  DRY-RUN：列出可能是测试数据的记录（不删任何东西）"
echo "========================================================================"
echo ""

echo "===== members：邮箱含明显测试痕迹 ====="
$PSQL -c "
SELECT id, email, first_joined_at, created_at
FROM members
WHERE email LIKE '%@e2e.test'
   OR email LIKE 'smoketest+%'
   OR email LIKE 'smoketest-%'
   OR email LIKE 'codex-plugin-test-%'
   OR email LIKE '%@example.com'
   OR email LIKE 'e2e%@%'
   OR email LIKE 'wrong-%@%'
   OR email LIKE 'wrong+%@%'
   OR email LIKE 'other-%@%'
   OR email LIKE 'other@example.com'
   OR email LIKE 'a@b.com'
ORDER BY created_at DESC;
"

echo ""
echo "===== card_keys：绑定到上述测试邮箱的卡 ====="
$PSQL -c "
SELECT ck.id, ck.key, ck.card_type, ck.status, ck.validity_days, ck.expires_at,
       m.email
FROM card_keys ck
LEFT JOIN members m ON ck.member_id = m.id
WHERE m.email LIKE '%@e2e.test'
   OR m.email LIKE 'smoketest+%' OR m.email LIKE 'smoketest-%'
   OR m.email LIKE 'codex-plugin-test-%'
   OR m.email LIKE '%@example.com'
   OR m.email LIKE 'e2e%@%'
   OR m.email LIKE 'wrong-%@%' OR m.email LIKE 'wrong+%@%'
   OR m.email LIKE 'other-%@%' OR m.email = 'other@example.com'
   OR m.email = 'a@b.com'
ORDER BY ck.created_at DESC;
"

echo ""
echo "===== activation_records：测试邮箱的激活记录 ====="
$PSQL -c "
SELECT count(*) AS records,
       count(DISTINCT email) AS distinct_emails
FROM activation_records
WHERE email LIKE '%@e2e.test'
   OR email LIKE 'smoketest+%' OR email LIKE 'smoketest-%'
   OR email LIKE 'codex-plugin-test-%'
   OR email LIKE '%@example.com'
   OR email LIKE 'e2e%@%'
   OR email LIKE 'wrong-%@%' OR email LIKE 'wrong+%@%'
   OR email LIKE 'other-%@%' OR email = 'other@example.com'
   OR email = 'a@b.com'
   OR card_key LIKE '_PROBE_%'
   OR card_key LIKE '_E2E_%'
   OR card_key LIKE 'NOTEXIST_%'
   OR card_key LIKE '_PROBE_NEVER_EXIST_';
"

echo ""
echo "===== plugin_card_bindings：测试邮箱 / 测试 client_id 的设备绑定 ====="
$PSQL -c "
SELECT count(*) AS bindings
FROM plugin_card_bindings
WHERE email LIKE '%@e2e.test'
   OR email LIKE 'smoketest+%' OR email LIKE 'smoketest-%'
   OR email LIKE 'codex-plugin-test-%'
   OR email LIKE '%@example.com'
   OR email LIKE 'e2e%@%'
   OR client_id LIKE 'e2e-%'
   OR client_id LIKE 'cli-old-%' OR client_id LIKE 'cli-new-%'
   OR client_id LIKE 'smoke-%' OR client_id LIKE 'probe-%'
   OR client_id LIKE 'codex-test-client-%'
   OR client_id LIKE '8cf2d4a9-%';
"

echo ""
echo "===== plugin_card_rebind_logs：测试 client_id ====="
$PSQL -c "
SELECT count(*) AS rebind_logs
FROM plugin_card_rebind_logs
WHERE email LIKE '%@e2e.test'
   OR email LIKE 'smoketest+%' OR email LIKE 'smoketest-%'
   OR email LIKE 'codex-plugin-test-%'
   OR email LIKE '%@example.com'
   OR email LIKE 'e2e%@%'
   OR new_client_id LIKE 'e2e-%' OR old_client_id LIKE 'e2e-%'
   OR new_client_id LIKE 'cli-old-%' OR old_client_id LIKE 'cli-old-%'
   OR new_client_id LIKE 'cli-new-%' OR old_client_id LIKE 'cli-new-%'
   OR new_client_id LIKE 'smoke-%' OR old_client_id LIKE 'smoke-%';
"

echo ""
echo "===== 顺便：现网真实数据是否会被误伤 ====="
$PSQL -c "
SELECT count(*) AS prod_members
FROM members
WHERE email NOT LIKE '%@e2e.test'
  AND email NOT LIKE 'smoketest+%' AND email NOT LIKE 'smoketest-%'
  AND email NOT LIKE 'codex-plugin-test-%'
  AND email NOT LIKE '%@example.com'
  AND email NOT LIKE 'e2e%@%'
  AND email NOT LIKE 'wrong-%@%' AND email NOT LIKE 'wrong+%@%'
  AND email NOT LIKE 'other-%@%' AND email <> 'other@example.com'
  AND email <> 'a@b.com';"

echo ""
echo "===== 看一下 @example.com 是否包含真实用户（codex-plugin-test- 也算测试） ====="
$PSQL -c "
SELECT id, email, created_at
FROM members
WHERE email LIKE '%@example.com'
ORDER BY created_at;
"

unset PGPASSWORD
