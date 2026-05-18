#!/usr/bin/env bash
# 拿一张真实卡密 + 它绑定的 member email，并发打两端做等价性对比
# 注意：脚本绝不打印 card_key / email 原文，只打印掩码后的前缀
set -euo pipefail

export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"

# 取一张 active、未禁用、未过期、有 member、有 plugin 绑定的卡（最理想 case）
ROW=$(psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -A -F '|' -t -c "
SELECT ck.key, m.email, pb.client_id
FROM card_keys ck
JOIN members m ON ck.member_id = m.id
JOIN plugin_card_bindings pb ON pb.card_key_id = ck.id AND pb.status = 'active'
WHERE ck.status = 'active'
  AND ck.expires_at > now() AT TIME ZONE 'Asia/Shanghai'
LIMIT 1;
" 2>/dev/null | head -n 1)

unset PGPASSWORD

if [ -z "$ROW" ]; then
  echo "[skip] 没有找到符合条件的真实卡密样本，跳过等价性对比"
  exit 0
fi

CARD=$(echo "$ROW" | awk -F'|' '{print $1}')
EMAIL=$(echo "$ROW" | awk -F'|' '{print $2}')
CLIENT=$(echo "$ROW" | awk -F'|' '{print $3}')

# 掩码打印
MASK_CARD="${CARD:0:4}***"
MASK_EMAIL="${EMAIL:0:2}***@${EMAIL##*@}"
MASK_CLIENT="${CLIENT:0:6}***"

echo "Sample: card=$MASK_CARD email=$MASK_EMAIL client=$MASK_CLIENT"
echo ""

PAYLOAD=$(cat <<EOF
{"card_key":"${CARD}","email":"${EMAIL}","client_id":"${CLIENT}"}
EOF
)

ORIG_RESP=$(curl -sk --max-time 10 \
  --resolve seat.20050225.xyz:443:127.0.0.1 \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD" \
  https://seat.20050225.xyz/api/plugin/card-keys/status)

NEW_RESP=$(curl -s --max-time 10 \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD" \
  http://127.0.0.1:8801/api/plugin/card-keys/status)

echo "=== 原服务 (8000 via nginx) status ==="
echo "$ORIG_RESP" | python3 -c "import sys,json; o=json.loads(sys.stdin.read()); o['data'].pop('expires_at', None); print(json.dumps({'success':o['success'],'message':o['message'],'data':o['data']}, ensure_ascii=False, indent=2, sort_keys=True))"

echo ""
echo "=== 精简版 (8801 直连) status ==="
echo "$NEW_RESP" | python3 -c "import sys,json; o=json.loads(sys.stdin.read()); o['data'].pop('expires_at', None); print(json.dumps({'success':o['success'],'message':o['message'],'data':o['data']}, ensure_ascii=False, indent=2, sort_keys=True))"

echo ""
echo "=== diff 摘要 ==="
python3 <<PY
import json
orig = json.loads('''$ORIG_RESP''')
new = json.loads('''$NEW_RESP''')
keys = sorted(set(orig['data'].keys()) | set(new['data'].keys()))
diffs = []
for k in keys:
    if k in {'expires_at'}:
        continue
    a = orig['data'].get(k)
    b = new['data'].get(k)
    if a != b:
        diffs.append((k, a, b))
print(f"success orig={orig.get('success')} new={new.get('success')} same={orig.get('success')==new.get('success')}")
print(f"message orig={orig.get('message')!r} new={new.get('message')!r} same={orig.get('message')==new.get('message')}")
if diffs:
    print("data diffs:")
    for k, a, b in diffs:
        print(f"  {k}: orig={a!r} new={b!r}")
else:
    print("data: identical (excl. expires_at)")
PY
