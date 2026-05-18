#!/usr/bin/env bash
# 真正的修复脚本：清掉 .env 中指向已下线 luming.cv 的两个配置 + 重启 seatpool-web
set -euo pipefail

ENV_FILE=/seatpool/.env
BACKUP=/seatpool/.env.bak.fix-redirect-$(date -u +%Y%m%d-%H%M%S)

echo "===== Step 1: 备份 .env -> $BACKUP ====="
cp -p "$ENV_FILE" "$BACKUP"
ls -la "$BACKUP"
echo ""

echo "===== Step 2: 恢复 card_activation_base_url 到原值 ====="
export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"
psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -c "
UPDATE site_configs SET value='https://seat.luming.cv/team', updated_at=NOW()
WHERE key='card_activation_base_url' RETURNING key, value;
"
unset PGPASSWORD
echo ""

echo "===== Step 3: 改 .env (UNIFIED_ACTIVATION_GATEWAY_BASE_URL + PLUGIN_REMOTE_ENABLED) ====="
sed -i 's|^UNIFIED_ACTIVATION_GATEWAY_BASE_URL=.*$|UNIFIED_ACTIVATION_GATEWAY_BASE_URL=|' "$ENV_FILE"
sed -i 's|^PLUGIN_REMOTE_ENABLED=true$|PLUGIN_REMOTE_ENABLED=false|' "$ENV_FILE"
echo "[diff vs backup]"; diff "$BACKUP" "$ENV_FILE" || true
echo ""

echo "===== Step 4: 重启 seatpool-web (会有 ~1s 短暂中断) ====="
systemctl restart seatpool-web.service
sleep 2
systemctl status seatpool-web.service --no-pager 2>&1 | head -20
echo ""

echo "===== Step 5: 验证 / ====="
curl -skI --max-time 10 --resolve seat.20050225.xyz:443:127.0.0.1 https://seat.20050225.xyz/ | head -8
echo ""

echo "===== Step 6: 验证 /team ====="
curl -skI --max-time 10 --resolve seat.20050225.xyz:443:127.0.0.1 https://seat.20050225.xyz/team | head -8
echo ""

echo "===== Step 7: 验证 / body head (1200 bytes) ====="
curl -sk --max-time 10 --resolve seat.20050225.xyz:443:127.0.0.1 https://seat.20050225.xyz/ | head -c 1200
echo ""
echo ""

echo "===== Step 8: 插件 API 仍正常 ====="
curl -sk -o - -w '\n[HTTP %{http_code}]\n' --max-time 5 --resolve seat.20050225.xyz:443:127.0.0.1 https://seat.20050225.xyz/api/plugin/card-keys/client-config | head -c 300
echo ""

echo ""
echo "===== Step 9: 不存在的卡密 status 错误码（应是 card_not_found 而非 远程校验暂不可用） ====="
curl -sk --max-time 5 --resolve seat.20050225.xyz:443:127.0.0.1 \
  -H 'Content-Type: application/json' \
  -d '{"card_key":"_PROBE_NEVER_EXIST_","email":"a@b.com","client_id":"dev"}' \
  https://seat.20050225.xyz/api/plugin/card-keys/status

echo ""
echo ""
echo "===== Done ====="
echo "回滚步骤：cp $BACKUP $ENV_FILE && systemctl restart seatpool-web.service"
