#!/usr/bin/env bash
set +e

echo "[1] root / (应是 200, body 是 user/index.html)"
curl -sk -o /tmp/resp.html -w 'HTTP %{http_code}  size=%{size_download}B  type=%{content_type}\n' \
  --max-time 8 --resolve seat.20050225.xyz:443:127.0.0.1 https://seat.20050225.xyz/
echo "[body 前 300]"
head -c 300 /tmp/resp.html
echo ""
echo ""

echo "[2] /team"
curl -sk -o /tmp/resp.html -w 'HTTP %{http_code}  size=%{size_download}B  type=%{content_type}\n' \
  --max-time 8 --resolve seat.20050225.xyz:443:127.0.0.1 https://seat.20050225.xyz/team
head -c 300 /tmp/resp.html
echo ""
echo ""

echo "[3] /api/plugin/card-keys/client-config"
curl -sk -o /tmp/resp.json -w 'HTTP %{http_code}  size=%{size_download}B\n' \
  --max-time 8 --resolve seat.20050225.xyz:443:127.0.0.1 https://seat.20050225.xyz/api/plugin/card-keys/client-config
head -c 200 /tmp/resp.json
echo ""
echo ""

echo "[4] /api/plugin/card-keys/status 用不存在的卡密 (期望 reason_code:card_not_found)"
curl -sk -o /tmp/resp.json -w 'HTTP %{http_code}\n' --max-time 8 \
  --resolve seat.20050225.xyz:443:127.0.0.1 \
  -H 'Content-Type: application/json' \
  -d '{"card_key":"_PROBE_NEVER_EXIST_","email":"test@example.com","client_id":"smoke-client"}' \
  https://seat.20050225.xyz/api/plugin/card-keys/status
cat /tmp/resp.json
echo ""
echo ""

echo "[5] 真实卡密 status 仍正常工作（不打印明文）"
export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"
ROW=$(psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -A -F '|' -t -c "
SELECT ck.key, m.email, pb.client_id
FROM card_keys ck
JOIN members m ON ck.member_id = m.id
JOIN plugin_card_bindings pb ON pb.card_key_id = ck.id AND pb.status='active'
WHERE ck.status='active' AND ck.expires_at > now() AT TIME ZONE 'Asia/Shanghai'
LIMIT 1
" 2>/dev/null | head -n 1)
unset PGPASSWORD
if [ -z "$ROW" ]; then
  echo "  跳过（没有可用真实样本）"
else
  CARD=$(echo "$ROW" | awk -F'|' '{print $1}')
  EMAIL=$(echo "$ROW" | awk -F'|' '{print $2}')
  CLIENT=$(echo "$ROW" | awk -F'|' '{print $3}')
  echo "  sample card=${CARD:0:4}*** email=${EMAIL:0:2}***@${EMAIL##*@}"
  PAYLOAD=$(cat <<JSON
{"card_key":"$CARD","email":"$EMAIL","client_id":"$CLIENT"}
JSON
)
  curl -sk -o - -w '\n  HTTP %{http_code}\n' --max-time 8 \
    --resolve seat.20050225.xyz:443:127.0.0.1 \
    -H 'Content-Type: application/json' \
    -d "$PAYLOAD" \
    https://seat.20050225.xyz/api/plugin/card-keys/status | \
    python3 -c "import sys,json; o=json.loads(sys.stdin.readline()); print(f'  success={o[\"success\"]}  message={o[\"message\"]!r}  authorized={o[\"data\"][\"authorized\"]}  card_type={o[\"data\"][\"card_type\"]}')"
fi

echo ""
echo "[done]"
