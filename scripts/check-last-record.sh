#!/usr/bin/env bash
set +e
export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"
PSQL="psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -P pager=off"

echo "===== 剩下的 activation_records 是什么 ====="
$PSQL -c "
SELECT id, email, card_key, source, status, reason_code, message, ip_addr, created_at
FROM activation_records
ORDER BY id;
"
unset PGPASSWORD
