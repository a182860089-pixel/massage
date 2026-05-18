#!/usr/bin/env bash
# 把指向已下线 seat.luming.cv 的 card_activation_base_url 清空，
# 让 seat.20050225.xyz/ 与 /team 渲染本地 user/index.html。
# 改 DB 一行字段，热生效，不动文件、不重启服务。

set -euo pipefail

export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"

echo "===== Step 1: 备份当前值 ====="
psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -t -A -F'|' -c "
SELECT key, value FROM site_configs WHERE key='card_activation_base_url'
" | tee /tmp/card_activation_base_url.backup
echo ""

echo "===== Step 2: 改成空字符串 ====="
psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -c "
UPDATE site_configs SET value = '' , updated_at = NOW() WHERE key = 'card_activation_base_url' RETURNING key, value;
"
echo ""

unset PGPASSWORD

echo "===== Step 3: curl seat.20050225.xyz/ ====="
curl -skI --max-time 10 --resolve seat.20050225.xyz:443:127.0.0.1 https://seat.20050225.xyz/ | head -8
echo ""

echo "===== Step 4: curl seat.20050225.xyz/team ====="
curl -skI --max-time 10 --resolve seat.20050225.xyz:443:127.0.0.1 https://seat.20050225.xyz/team | head -8
echo ""

echo "===== Step 5: body head (first 800 bytes) ====="
curl -sk --max-time 10 --resolve seat.20050225.xyz:443:127.0.0.1 https://seat.20050225.xyz/ | head -c 800
echo ""
echo ""

echo "===== Step 6: 验证插件接口仍正常 ====="
curl -sk -o - -w '\n[HTTP %{http_code}]\n' --max-time 5 --resolve seat.20050225.xyz:443:127.0.0.1 https://seat.20050225.xyz/api/plugin/card-keys/client-config | head -c 200
echo ""

echo ""
echo "===== Done at $(date -u +%FT%TZ) ====="
echo "如需回滚： psql ... -c \"UPDATE site_configs SET value='https://seat.luming.cv/team' WHERE key='card_activation_base_url'\""
