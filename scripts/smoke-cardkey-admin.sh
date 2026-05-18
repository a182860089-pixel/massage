#!/usr/bin/env bash
# 端到端冒烟：用真实激活码走 web 激活 + 插件 activate / status
set +e

export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"

echo "===== 1) 找一个 unused 的激活码（用来跑 web 激活流程） ====="
NEW_CARD=$(psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -A -F'|' -t -c "
SELECT key FROM card_keys WHERE status='unused' ORDER BY created_at DESC LIMIT 1
" 2>/dev/null | head -n 1)

if [ -z "$NEW_CARD" ]; then
  echo "  没有 unused 激活码，跳过 web 激活流程"
else
  echo "  card=${NEW_CARD:0:4}***"
  EMAIL="smoketest+$(date +%s)@example.com"
  echo ""
  echo "  [POST /api/activation/redeem]"
  curl -s --max-time 8 -H 'Content-Type: application/json' \
    -d "{\"card_key\":\"$NEW_CARD\",\"email\":\"$EMAIL\"}" \
    http://127.0.0.1:8810/api/activation/redeem
  echo ""
  echo ""
  echo "  [幂等：再激活一次同邮箱]"
  curl -s --max-time 8 -H 'Content-Type: application/json' \
    -d "{\"card_key\":\"$NEW_CARD\",\"email\":\"$EMAIL\"}" \
    http://127.0.0.1:8810/api/activation/redeem
  echo ""
  echo ""
  echo "  [冲突：用不同邮箱再激活]"
  curl -s --max-time 8 -H 'Content-Type: application/json' \
    -d "{\"card_key\":\"$NEW_CARD\",\"email\":\"other@example.com\"}" \
    http://127.0.0.1:8810/api/activation/redeem
  echo ""
  echo ""
fi

echo "===== 2) 用现有真实卡密 + 邮箱跑插件接口 ====="
ROW=$(psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -A -F '|' -t -c "
SELECT ck.key, m.email
FROM card_keys ck
JOIN members m ON ck.member_id = m.id
WHERE ck.status='active' AND ck.expires_at > now() AT TIME ZONE 'Asia/Shanghai'
LIMIT 1
" 2>/dev/null | head -n 1)

unset PGPASSWORD

if [ -z "$ROW" ]; then
  echo "  没有现成 active 卡，跳过"
else
  CARD=$(echo "$ROW" | awk -F'|' '{print $1}')
  EMAIL=$(echo "$ROW" | awk -F'|' '{print $2}')
  CLIENT="smoke-client-$(date +%s)"
  echo "  card=${CARD:0:4}*** email=${EMAIL:0:2}***@${EMAIL##*@} client=${CLIENT:0:14}***"
  echo ""
  echo "  [POST /api/plugin/card-keys/activate]"
  curl -s --max-time 8 -H 'Content-Type: application/json' \
    -d "{\"card_key\":\"$CARD\",\"email\":\"$EMAIL\",\"client_id\":\"$CLIENT\"}" \
    http://127.0.0.1:8810/api/plugin/card-keys/activate | head -c 400
  echo ""
  echo ""
  echo "  [POST /api/plugin/card-keys/status]"
  curl -s --max-time 8 -H 'Content-Type: application/json' \
    -d "{\"card_key\":\"$CARD\",\"email\":\"$EMAIL\",\"client_id\":\"$CLIENT\"}" \
    http://127.0.0.1:8810/api/plugin/card-keys/status | head -c 400
  echo ""
fi

echo ""
echo "===== 3) 验证 /admin/login 页面渲染 ====="
curl -s --max-time 5 http://127.0.0.1:8810/admin/login | grep -E "cardkey-admin|管理员登录|form" | head -5

echo ""
echo "===== done ====="
