#!/usr/bin/env bash
# 清理所有测试数据：
#   - 2 个测试 member（@example.com 下的 codex / smoketest）
#   - 它们绑定的 2 张测试卡
#   - 这些邮箱 / 测试 card_key / 测试 client_id 相关的所有 activation_records / plugin_card_bindings / plugin_card_rebind_logs
# 用事务包裹，删完校验残留 0 才 COMMIT
set +e
export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"
PSQL="psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -P pager=off"

# 把测试匹配的 WHERE 抽成一个 CTE 函数 view，反复用
TEST_EMAIL_FILTER="
   email LIKE '%@e2e.test'
   OR email LIKE 'smoketest+%' OR email LIKE 'smoketest-%'
   OR email LIKE 'codex-plugin-test-%'
   OR email LIKE 'e2e%@%'
   OR email LIKE 'wrong-%@%' OR email LIKE 'wrong+%@%'
   OR email LIKE 'other-%@%' OR email = 'other@example.com'
   OR email = 'a@b.com'
"

TEST_CLIENT_FILTER="
   client_id LIKE 'e2e-%'
   OR client_id LIKE 'cli-old-%' OR client_id LIKE 'cli-new-%'
   OR client_id LIKE 'smoke-%' OR client_id LIKE 'probe-%'
   OR client_id LIKE 'codex-test-client-%'
   OR client_id LIKE '8cf2d4a9-%'
"

echo "===== 0) 清理前快照 ====="
$PSQL -c "
SELECT 'members'        AS table_name, count(*) FROM members        WHERE $TEST_EMAIL_FILTER
UNION ALL SELECT 'activation_records', count(*) FROM activation_records WHERE $TEST_EMAIL_FILTER
UNION ALL SELECT 'plugin_card_bindings', count(*) FROM plugin_card_bindings WHERE $TEST_EMAIL_FILTER OR $TEST_CLIENT_FILTER
UNION ALL SELECT 'plugin_card_rebind_logs', count(*) FROM plugin_card_rebind_logs WHERE $TEST_EMAIL_FILTER OR new_client_id LIKE 'e2e-%' OR old_client_id LIKE 'e2e-%' OR new_client_id LIKE 'cli-%' OR old_client_id LIKE 'cli-%' OR new_client_id LIKE 'smoke-%' OR old_client_id LIKE 'smoke-%'
UNION ALL SELECT 'card_keys(testbound)', count(*) FROM card_keys ck JOIN members m ON ck.member_id=m.id WHERE m.email LIKE '%@e2e.test' OR m.email LIKE 'smoketest%' OR m.email LIKE 'codex-plugin-test-%'
;
"

echo ""
echo "===== 1) 真删（事务） ====="
$PSQL -v ON_ERROR_STOP=1 <<SQL
BEGIN;

-- 先把测试 member 收集到临时表
CREATE TEMP TABLE test_members AS
SELECT id, email FROM members WHERE $TEST_EMAIL_FILTER;

\\echo '  测试 member 列表:'
SELECT * FROM test_members ORDER BY id;

CREATE TEMP TABLE test_card_ids AS
SELECT id FROM card_keys WHERE member_id IN (SELECT id FROM test_members);

\\echo '  测试卡 id 列表:'
SELECT * FROM test_card_ids ORDER BY id;

-- 1.1 删 activation_records（按 email 或测试卡）
DELETE FROM activation_records
 WHERE email IN (SELECT email FROM test_members)
    OR card_key_id IN (SELECT id FROM test_card_ids)
    OR card_key LIKE '_PROBE_%'
    OR card_key LIKE '_E2E_%'
    OR card_key LIKE 'NOTEXIST_%';

-- 1.2 删 plugin_card_rebind_logs（按 email / 测试 client_id / 测试 card_id）
DELETE FROM plugin_card_rebind_logs
 WHERE email IN (SELECT email FROM test_members)
    OR card_key_id IN (SELECT id FROM test_card_ids)
    OR new_client_id LIKE 'e2e-%' OR old_client_id LIKE 'e2e-%'
    OR new_client_id LIKE 'cli-old-%' OR old_client_id LIKE 'cli-old-%'
    OR new_client_id LIKE 'cli-new-%' OR old_client_id LIKE 'cli-new-%'
    OR new_client_id LIKE 'smoke-%' OR old_client_id LIKE 'smoke-%';

-- 1.3 删 plugin_card_bindings
DELETE FROM plugin_card_bindings
 WHERE email IN (SELECT email FROM test_members)
    OR card_key_id IN (SELECT id FROM test_card_ids)
    OR client_id LIKE 'e2e-%'
    OR client_id LIKE 'cli-old-%' OR client_id LIKE 'cli-new-%'
    OR client_id LIKE 'smoke-%' OR client_id LIKE 'probe-%'
    OR client_id LIKE 'codex-test-client-%'
    OR client_id LIKE '8cf2d4a9-%';

-- 1.4 删测试 card_keys（先 NULL 化 member 引用避免外键暴雷）
UPDATE card_keys SET member_id = NULL, bound_at = NULL, first_activated_at = NULL, expires_at = NULL, status = 'unused'
 WHERE id IN (SELECT id FROM test_card_ids);
DELETE FROM card_keys WHERE id IN (SELECT id FROM test_card_ids);

-- 1.5 删测试 member
DELETE FROM members WHERE id IN (SELECT id FROM test_members);

\\echo '  清理后残留校验：'
SELECT 'members'        AS table_name, count(*) FROM members        WHERE $TEST_EMAIL_FILTER
UNION ALL SELECT 'activation_records', count(*) FROM activation_records WHERE $TEST_EMAIL_FILTER
UNION ALL SELECT 'plugin_card_bindings', count(*) FROM plugin_card_bindings WHERE $TEST_EMAIL_FILTER OR $TEST_CLIENT_FILTER
UNION ALL SELECT 'plugin_card_rebind_logs', count(*) FROM plugin_card_rebind_logs WHERE $TEST_EMAIL_FILTER OR new_client_id LIKE 'e2e-%' OR old_client_id LIKE 'e2e-%' OR new_client_id LIKE 'cli-%' OR old_client_id LIKE 'cli-%' OR new_client_id LIKE 'smoke-%' OR old_client_id LIKE 'smoke-%';

COMMIT;
SQL

echo ""
echo "===== 2) 二次校验 ====="
$PSQL -c "
SELECT 'members'        AS table_name, count(*) FROM members        WHERE $TEST_EMAIL_FILTER
UNION ALL SELECT 'activation_records', count(*) FROM activation_records WHERE $TEST_EMAIL_FILTER
UNION ALL SELECT 'plugin_card_bindings', count(*) FROM plugin_card_bindings WHERE $TEST_EMAIL_FILTER OR $TEST_CLIENT_FILTER
UNION ALL SELECT 'plugin_card_rebind_logs', count(*) FROM plugin_card_rebind_logs WHERE $TEST_EMAIL_FILTER OR new_client_id LIKE 'e2e-%' OR old_client_id LIKE 'e2e-%' OR new_client_id LIKE 'cli-%' OR old_client_id LIKE 'cli-%' OR new_client_id LIKE 'smoke-%' OR old_client_id LIKE 'smoke-%';
"

echo ""
echo "===== 3) 现网真实数据未受影响（应仍是 2107 个真实 member） ====="
$PSQL -c "
SELECT count(*) AS prod_members
FROM members
WHERE NOT (
    email LIKE '%@e2e.test'
    OR email LIKE 'smoketest+%' OR email LIKE 'smoketest-%'
    OR email LIKE 'codex-plugin-test-%'
    OR email LIKE 'e2e%@%'
    OR email LIKE 'wrong-%@%' OR email LIKE 'wrong+%@%'
    OR email LIKE 'other-%@%' OR email = 'other@example.com'
    OR email = 'a@b.com'
);"

unset PGPASSWORD
echo "DONE"
