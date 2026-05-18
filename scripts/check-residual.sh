#!/usr/bin/env bash
set +e
export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"
PSQL="psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -P pager=off"

echo "===== 残留 activation_records ====="
$PSQL -c "
SELECT id, email, card_key, source, status, reason_code, message, created_at
FROM activation_records
WHERE email LIKE '%@e2e.test'
   OR email LIKE 'smoketest+%' OR email LIKE 'smoketest-%'
   OR email LIKE 'codex-plugin-test-%'
   OR email LIKE 'e2e%@%'
   OR email LIKE 'wrong-%@%' OR email LIKE 'wrong+%@%'
   OR email LIKE 'other-%@%' OR email = 'other@example.com'
   OR email = 'a@b.com'
ORDER BY created_at DESC;
"

echo ""
echo "===== activation_records 总数 + 任何 @example.com 域名的残留 ====="
$PSQL -c "
SELECT count(*) AS total FROM activation_records;
SELECT id, email, card_key, source, status, reason_code, created_at
FROM activation_records
WHERE email LIKE '%@example.com' OR email LIKE '%@e2e.test'
ORDER BY id DESC LIMIT 20;
"
unset PGPASSWORD
