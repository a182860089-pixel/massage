#!/usr/bin/env bash
# 把端到端测试期间被改的 plugin_card_binding 还回原始 client_id
set +e
export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"
export PAGER=cat
PSQL="psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -P pager=off"

echo "===== 1) 查最近的 rebind 日志（找出测试用的 OLD/NEW client_id） ====="
$PSQL -c "
SELECT id, card_key_id, email, old_client_id, new_client_id, created_at
FROM plugin_card_rebind_logs
WHERE created_at > now() AT TIME ZONE 'Asia/Shanghai' - interval '30 minutes'
ORDER BY id DESC
LIMIT 20;
"

echo ""
echo "===== 2) 拿这次测试涉及的卡 + 当前 binding ====="
$PSQL -c "
WITH recent AS (
  SELECT DISTINCT card_key_id
  FROM plugin_card_rebind_logs
  WHERE new_client_id LIKE 'e2e-new-%' OR new_client_id LIKE 'e2e-old-%'
)
SELECT b.card_key_id, b.email, b.client_id AS current_client, b.rebind_count, b.last_seen_at
FROM plugin_card_bindings b
JOIN recent r ON r.card_key_id = b.card_key_id
ORDER BY b.card_key_id;
"

echo ""
echo "===== 3) 对每张被测试涉及到的卡，按 rebind_logs 顺序找出测试前最后的「非 e2e-」client_id 并还原 ====="
$PSQL -c "
WITH touched_cards AS (
  SELECT DISTINCT card_key_id
  FROM plugin_card_rebind_logs
  WHERE new_client_id LIKE 'e2e-%'
),
candidates AS (
  SELECT
    l.card_key_id,
    l.old_client_id,
    l.created_at,
    ROW_NUMBER() OVER (PARTITION BY l.card_key_id ORDER BY l.created_at ASC) AS rn
  FROM plugin_card_rebind_logs l
  JOIN touched_cards t ON t.card_key_id = l.card_key_id
  WHERE l.old_client_id NOT LIKE 'e2e-%'
)
SELECT card_key_id, old_client_id AS restore_to_client, created_at
FROM candidates
WHERE rn = 1;
"

echo ""
echo "===== 4) 真还原 ====="
$PSQL -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

WITH touched_cards AS (
  SELECT DISTINCT card_key_id
  FROM plugin_card_rebind_logs
  WHERE new_client_id LIKE 'e2e-%'
),
candidates AS (
  SELECT
    l.card_key_id,
    l.old_client_id,
    l.created_at,
    ROW_NUMBER() OVER (PARTITION BY l.card_key_id ORDER BY l.created_at ASC) AS rn
  FROM plugin_card_rebind_logs l
  JOIN touched_cards t ON t.card_key_id = l.card_key_id
  WHERE l.old_client_id NOT LIKE 'e2e-%'
),
target AS (
  SELECT card_key_id, old_client_id
  FROM candidates WHERE rn = 1
)
UPDATE plugin_card_bindings b
SET client_id = t.old_client_id,
    -- rebind_count 退回去（减掉本次测试 +1）
    rebind_count = GREATEST(0, (b.rebind_count - 1))
FROM target t
WHERE b.card_key_id = t.card_key_id
  AND b.client_id LIKE 'e2e-%';

-- 删除测试期间产生的 rebind_logs（避免污染审计记录）
DELETE FROM plugin_card_rebind_logs
WHERE new_client_id LIKE 'e2e-%'
   OR old_client_id LIKE 'e2e-%';

COMMIT;
SQL

echo ""
echo "===== 5) 验证：当前 binding 不再有 e2e- 残留 ====="
$PSQL -c "
SELECT card_key_id, email, client_id, rebind_count, last_seen_at
FROM plugin_card_bindings
WHERE client_id LIKE 'e2e-%';
"

$PSQL -c "
SELECT COUNT(*) AS leftover_e2e_logs
FROM plugin_card_rebind_logs
WHERE new_client_id LIKE 'e2e-%' OR old_client_id LIKE 'e2e-%';
"

unset PGPASSWORD
echo "DONE"
