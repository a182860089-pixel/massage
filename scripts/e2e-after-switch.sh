#!/usr/bin/env bash
# 切流量后端到端测试：通过 https://seat.20050225.xyz 直接打 4 个插件接口 + 后台 4 页 + 登录
# 同时验证 http://154.12.94.197 仍能访问原 seatpool-web
set +e

DOMAIN="https://seat.20050225.xyz"
IP_BASE="http://154.12.94.197"

# 与 cardkey-admin 的 _common 共享同一个 IP 速率限流窗口，错开测试避免命中限流
SLEEP_BETWEEN=0.4

echo "========================================================================"
echo "  端到端测试   seat.20050225.xyz -> cardkey-admin (127.0.0.1:8810)"
echo "  日期       $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "========================================================================"
echo ""

PASS=0
FAIL=0
RESULTS_FILE=$(mktemp)

check() {
  local label="$1"; shift
  local expect="$1"; shift
  local actual="$1"; shift
  local extra="${1:-}"
  if [[ "$actual" == "$expect" ]]; then
    echo "  [PASS] $label  (HTTP $actual)  $extra"
    PASS=$((PASS+1))
    echo "PASS|$label|HTTP $actual|$extra" >> "$RESULTS_FILE"
  else
    echo "  [FAIL] $label  期望 $expect 实际 $actual  $extra"
    FAIL=$((FAIL+1))
    echo "FAIL|$label|期望 $expect 实际 $actual|$extra" >> "$RESULTS_FILE"
  fi
}

contains() {
  local label="$1"; shift
  local needle="$1"; shift
  local body="$1"
  if echo "$body" | grep -q -F -- "$needle"; then
    echo "  [PASS] $label  (含「$needle」)"
    PASS=$((PASS+1))
    echo "PASS|$label|含「$needle」|" >> "$RESULTS_FILE"
  else
    echo "  [FAIL] $label  期望含「$needle」 实际:"
    echo "$body" | head -c 240 | sed 's/^/        | /'
    FAIL=$((FAIL+1))
    echo "FAIL|$label|期望含「$needle」|" >> "$RESULTS_FILE"
  fi
}

# 匹配 Flask jsonify 输出 ("success":true 无空格) 与 indent 输出 ("success": true 有空格) 两种
contains_success_true() {
  local label="$1"; shift
  local body="$1"
  if echo "$body" | grep -Eq '"success"[[:space:]]*:[[:space:]]*true'; then
    echo "  [PASS] $label  (含 success:true)"
    PASS=$((PASS+1))
    echo "PASS|$label|含 success:true|" >> "$RESULTS_FILE"
  else
    echo "  [FAIL] $label  期望 success:true，实际:"
    echo "$body" | head -c 240 | sed 's/^/        | /'
    FAIL=$((FAIL+1))
    echo "FAIL|$label|期望 success:true|" >> "$RESULTS_FILE"
  fi
}

echo "[A] 后台 4 个页面 + 登录页（未登录全部应跳 /admin/login，HTTP 302 或 200）"
echo "------------------------------------------------------------------------"
# /admin/login: 直接 200
code=$(curl -s -o /tmp/r_login.html -w '%{http_code}' --max-time 8 "$DOMAIN/admin/login")
check "GET $DOMAIN/admin/login" "200" "$code"
contains "  /admin/login 页面内容含 cardkey-admin" "cardkey-admin" "$(cat /tmp/r_login.html)"
contains "  /admin/login 页面含「管理员登录」" "管理员登录" "$(cat /tmp/r_login.html)"

# /admin/ -> 未登录应 302（重定向到 login）
sleep $SLEEP_BETWEEN
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$DOMAIN/admin/")
check "GET $DOMAIN/admin/        (未登录跳 login)" "302" "$code"

sleep $SLEEP_BETWEEN
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$DOMAIN/admin/cards")
check "GET $DOMAIN/admin/cards   (未登录跳 login)" "302" "$code"

sleep $SLEEP_BETWEEN
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$DOMAIN/admin/users")
check "GET $DOMAIN/admin/users   (未登录跳 login)" "302" "$code"

sleep $SLEEP_BETWEEN
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$DOMAIN/admin/activations")
check "GET $DOMAIN/admin/activations (未登录跳 login)" "302" "$code"

echo ""
echo "[A2] 用 admin/<ADMIN_PASSWORD> 登录，验证 4 个后台页面 200 + 内容关键字"
echo "------------------------------------------------------------------------"
COOKIE_JAR=$(mktemp)
# 先 GET 一次拿到 cookie（如果有 CSRF token 需要解析）
sleep $SLEEP_BETWEEN
curl -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -o /tmp/r_loginpage.html --max-time 8 "$DOMAIN/admin/login" > /dev/null

# 检测是否有 csrf_token 字段
CSRF=""
if grep -q 'name="csrf_token"' /tmp/r_loginpage.html; then
  CSRF=$(grep -oE 'name="csrf_token"[^>]*value="[^"]+"' /tmp/r_loginpage.html | head -1 | sed -E 's/.*value="([^"]+)".*/\1/')
fi
echo "  detected csrf_token: ${CSRF:-<none>}"

sleep $SLEEP_BETWEEN
if [ -n "$CSRF" ]; then
  curl -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -L --max-time 8 \
    -o /tmp/r_postlogin.html -w 'login POST HTTP %{http_code} -> %{url_effective}\n' \
    -d "username=admin" -d "password=<ADMIN_PASSWORD>" -d "csrf_token=$CSRF" \
    "$DOMAIN/admin/login"
else
  curl -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -L --max-time 8 \
    -o /tmp/r_postlogin.html -w 'login POST HTTP %{http_code} -> %{url_effective}\n' \
    -d "username=admin" -d "password=<ADMIN_PASSWORD>" \
    "$DOMAIN/admin/login"
fi

# 登录后访问 4 个页面
sleep $SLEEP_BETWEEN
code=$(curl -s -b "$COOKIE_JAR" -o /tmp/r_dash.html -w '%{http_code}' --max-time 8 "$DOMAIN/admin/")
check "GET $DOMAIN/admin/        (登录后)" "200" "$code"

sleep $SLEEP_BETWEEN
code=$(curl -s -b "$COOKIE_JAR" -o /tmp/r_cards.html -w '%{http_code}' --max-time 8 "$DOMAIN/admin/cards")
check "GET $DOMAIN/admin/cards   (登录后)" "200" "$code"

sleep $SLEEP_BETWEEN
code=$(curl -s -b "$COOKIE_JAR" -o /tmp/r_users.html -w '%{http_code}' --max-time 8 "$DOMAIN/admin/users")
check "GET $DOMAIN/admin/users   (登录后)" "200" "$code"

sleep $SLEEP_BETWEEN
code=$(curl -s -b "$COOKIE_JAR" -o /tmp/r_activations.html -w '%{http_code}' --max-time 8 "$DOMAIN/admin/activations")
check "GET $DOMAIN/admin/activations (登录后)" "200" "$code"

contains "  仪表盘含「仪表盘」或「dashboard」" "仪表盘" "$(cat /tmp/r_dash.html)"
contains "  激活码页含「激活码」" "激活码" "$(cat /tmp/r_cards.html)"
contains "  用户页含「用户」" "用户" "$(cat /tmp/r_users.html)"
contains "  激活记录页含「激活记录」" "激活记录" "$(cat /tmp/r_activations.html)"

echo ""
echo "[B] 用户激活页（公开页）"
echo "------------------------------------------------------------------------"
sleep $SLEEP_BETWEEN
code=$(curl -s -o /tmp/r_root.html -w '%{http_code}' --max-time 8 "$DOMAIN/")
check "GET $DOMAIN/                              (激活页)" "200" "$code"
contains "  激活页含表单字段「激活码」或「activation」" "激活码" "$(cat /tmp/r_root.html)"

echo ""
echo "[C] 4 个插件接口（通过 seat.20050225.xyz，模拟插件真实调用）"
echo "------------------------------------------------------------------------"

# C1) client-config
sleep $SLEEP_BETWEEN
RESP=$(curl -s --max-time 8 "$DOMAIN/api/plugin/card-keys/client-config")
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$DOMAIN/api/plugin/card-keys/client-config")
check "GET /api/plugin/card-keys/client-config" "200" "$code"
contains "  client-config 含 plugin_announcement_md" "plugin_announcement_md" "$RESP"
contains "  client-config 含 updated_at" "updated_at" "$RESP"

# 取一对真实激活的卡密 + 邮箱
echo ""
echo "  -> 从 DB 取一对真实 active 卡密 + 邮箱用于 activate/status/rebind"
export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"
ROW=$(psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -A -F '|' -t -c "
SELECT ck.key, m.email
FROM card_keys ck
JOIN members m ON ck.member_id = m.id
WHERE ck.status='active' AND ck.expires_at > now() AT TIME ZONE 'Asia/Shanghai'
ORDER BY ck.created_at DESC
LIMIT 1
" 2>/dev/null | head -n 1)
unset PGPASSWORD

if [ -z "$ROW" ]; then
  echo "  !! 数据库里没有 active 卡，C2/C3/C4 跳过"
  CARD=""
  EMAIL=""
else
  CARD=$(echo "$ROW" | awk -F'|' '{print $1}')
  EMAIL=$(echo "$ROW" | awk -F'|' '{print $2}')
  echo "  card=${CARD:0:4}*** email=${EMAIL:0:2}***@${EMAIL##*@}"
fi

if [ -n "$CARD" ]; then
  CLIENT_OLD="e2e-old-$(date +%s)"
  CLIENT_NEW="e2e-new-$(date +%s)"

  # C2) activate：用新 client_id 第一次激活（如果该卡未绑过 client，会成功；已绑过会 device_mismatch）
  sleep $SLEEP_BETWEEN
  RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
    -d "{\"card_key\":\"$CARD\",\"email\":\"$EMAIL\",\"client_id\":\"$CLIENT_OLD\"}" \
    "$DOMAIN/api/plugin/card-keys/activate")
  code=$(curl -s -o /dev/null --max-time 8 -H 'Content-Type: application/json' \
    -d "{\"card_key\":\"$CARD\",\"email\":\"$EMAIL\",\"client_id\":\"$CLIENT_OLD\"}" \
    -w '%{http_code}' "$DOMAIN/api/plugin/card-keys/activate")
  check "POST /api/plugin/card-keys/activate" "200" "$code"
  if echo "$RESP" | grep -Eq '"success"[[:space:]]*:[[:space:]]*true'; then
    contains_success_true "  activate 成功（首次/幂等）" "$RESP"
  else
    contains "  activate 路径返回 device_mismatch（已绑其他设备，期望走 rebind）" "device_mismatch" "$RESP"
  fi
  echo "  raw: $(echo "$RESP" | head -c 320)"

  # C3) status：用 activate 时同一 client_id（应 success=true）
  sleep $SLEEP_BETWEEN
  RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
    -d "{\"card_key\":\"$CARD\",\"email\":\"$EMAIL\",\"client_id\":\"$CLIENT_OLD\"}" \
    "$DOMAIN/api/plugin/card-keys/status")
  code=$(curl -s -o /dev/null --max-time 8 -H 'Content-Type: application/json' \
    -d "{\"card_key\":\"$CARD\",\"email\":\"$EMAIL\",\"client_id\":\"$CLIENT_OLD\"}" \
    -w '%{http_code}' "$DOMAIN/api/plugin/card-keys/status")
  check "POST /api/plugin/card-keys/status" "200" "$code"
  if echo "$RESP" | grep -Eq '"success"[[:space:]]*:[[:space:]]*true'; then
    contains_success_true "  status 当前 client 校验通过" "$RESP"
  else
    contains "  status 路径返回 device_mismatch（该卡之前绑了别的 client）" "device_mismatch" "$RESP"
  fi
  echo "  raw: $(echo "$RESP" | head -c 320)"

  # C4) rebind：把绑定从 OLD 换到 NEW（应 success=true 或 device_mismatch->新设备）
  sleep $SLEEP_BETWEEN
  RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
    -d "{\"card_key\":\"$CARD\",\"email\":\"$EMAIL\",\"client_id\":\"$CLIENT_NEW\"}" \
    "$DOMAIN/api/plugin/card-keys/rebind")
  code=$(curl -s -o /dev/null --max-time 8 -H 'Content-Type: application/json' \
    -d "{\"card_key\":\"$CARD\",\"email\":\"$EMAIL\",\"client_id\":\"$CLIENT_NEW\"}" \
    -w '%{http_code}' "$DOMAIN/api/plugin/card-keys/rebind")
  check "POST /api/plugin/card-keys/rebind" "200" "$code"
  contains_success_true "  rebind 成功换绑到新 client_id" "$RESP"
  echo "  raw: $(echo "$RESP" | head -c 320)"

  # C5) rebind 后再 status（用 NEW），应 success=true
  sleep $SLEEP_BETWEEN
  RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
    -d "{\"card_key\":\"$CARD\",\"email\":\"$EMAIL\",\"client_id\":\"$CLIENT_NEW\"}" \
    "$DOMAIN/api/plugin/card-keys/status")
  contains_success_true "  rebind 之后 NEW client_id status 校验通过" "$RESP"
  echo "  raw: $(echo "$RESP" | head -c 320)"

  # C6) 反向断言：用错邮箱 → card_bound_other_email
  sleep $SLEEP_BETWEEN
  RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
    -d "{\"card_key\":\"$CARD\",\"email\":\"wrong+$(date +%s)@example.com\",\"client_id\":\"$CLIENT_NEW\"}" \
    "$DOMAIN/api/plugin/card-keys/status")
  contains "  错邮箱 -> card_bound_other_email" "card_bound_other_email" "$RESP"

  # C7) 反向断言：rebind 用错邮箱 → card_bound_other_email
  sleep $SLEEP_BETWEEN
  RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
    -d "{\"card_key\":\"$CARD\",\"email\":\"wrong+$(date +%s)@example.com\",\"client_id\":\"$CLIENT_NEW\"}" \
    "$DOMAIN/api/plugin/card-keys/rebind")
  contains "  rebind 用错邮箱 -> card_bound_other_email" "card_bound_other_email" "$RESP"
fi

echo ""
echo "[D] /api/activation/redeem（用户激活接口）边界"
echo "------------------------------------------------------------------------"
# D1) 空 body
sleep $SLEEP_BETWEEN
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' -d '{}' "$DOMAIN/api/activation/redeem")
contains "  空 body -> bad_request" "bad_request" "$RESP"

# D2) 非法邮箱
sleep $SLEEP_BETWEEN
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d '{"card_key":"X","email":"not-an-email"}' "$DOMAIN/api/activation/redeem")
contains "  非法邮箱 -> bad_email" "bad_email" "$RESP"

# D3) 不存在的卡
sleep $SLEEP_BETWEEN
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d '{"card_key":"_E2E_NEVER_EXIST_","email":"e2e@example.com"}' "$DOMAIN/api/activation/redeem")
contains "  不存在卡 -> card_not_found" "card_not_found" "$RESP"

echo ""
echo "[E] 原 seatpool-web 通过 IP 直连仍能用（不动 nginx 旧流量）"
echo "------------------------------------------------------------------------"
sleep $SLEEP_BETWEEN
code=$(curl -s -o /tmp/r_ip.html -w '%{http_code}' --max-time 8 "$IP_BASE/")
check "GET $IP_BASE/  (原 seatpool-web)" "200" "$code"
# 看下 body 是不是 seatpool 自家页面（不是 cardkey-admin）
if grep -q -F 'cardkey-admin' /tmp/r_ip.html; then
  echo "  [WARN] IP 直连页面里居然出现了 cardkey-admin 关键字，路由可能错位"
else
  echo "  [OK]   IP 直连页面不是 cardkey-admin（路由正确隔离）"
fi
# 检查 IP 直连下 /api/plugin/card-keys/client-config 也仍能用（seatpool-web 自己有这个接口）
sleep $SLEEP_BETWEEN
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$IP_BASE/api/plugin/card-keys/client-config")
echo "  GET $IP_BASE/api/plugin/card-keys/client-config -> HTTP $code (仅参考，旧服务自己有也行没有也行)"

echo ""
echo "========================================================================"
echo "  汇总   PASS=$PASS  FAIL=$FAIL"
echo "========================================================================"
echo ""
echo "[详细明细]"
cat "$RESULTS_FILE" | column -t -s '|' | sed 's/^/  /'

rm -f "$COOKIE_JAR" "$RESULTS_FILE"
[ "$FAIL" -eq 0 ]
