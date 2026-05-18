#!/usr/bin/env bash
# 全链路端到端测试：
#   1) 管理员登录
#   2) 通过后台生成 4 张激活码（30 天 / 1 天 / 1 小时折算 1 天 / 永久 3650 天）
#   3) 用户用网页激活其中一张
#   4) 管理员后台查看：列表、详情、用户、激活记录
#   5) 插件接口 4 个：client-config / activate / status / rebind
#   6) 过期/禁用卡密的拒绝测试（手动造过期卡 + 禁用一张正常卡，验证插件拒绝）
#   7) 测试结束清理痕迹（删测试卡、删测试用户、删测试激活/换绑日志）

set +e
export PAGER=cat
export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"
PSQL="psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -P pager=off -A -F'|' -t"
PSQL_FMT="psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -P pager=off"

DOMAIN="https://seat.20050225.xyz"
RUN_ID="e2e$(date +%s)"
TEST_EMAIL="${RUN_ID}@e2e.test"
CLIENT_OLD="cli-old-${RUN_ID}"
CLIENT_NEW="cli-new-${RUN_ID}"
COOKIES=$(mktemp)

PASS=0; FAIL=0
SUMMARY=$(mktemp)

ok()   { echo "  [PASS] $*"; PASS=$((PASS+1)); echo "PASS|$*" >> "$SUMMARY"; }
nok()  { echo "  [FAIL] $*"; FAIL=$((FAIL+1)); echo "FAIL|$*" >> "$SUMMARY"; }
note() { echo "  -- $*"; }

echo "========================================================================"
echo "  全链路端到端测试   run_id=$RUN_ID   $(date '+%F %T %Z')"
echo "========================================================================"
echo ""

# -------------------------------------------------------------------------
# Step 1: 管理员登录
# -------------------------------------------------------------------------
echo "[1] 管理员登录"
echo "------------------------------------------------------------------------"
curl -s -c "$COOKIES" -b "$COOKIES" -o /dev/null --max-time 8 "$DOMAIN/admin/login"
HTTP=$(curl -s -c "$COOKIES" -b "$COOKIES" -L --max-time 8 \
  -o /tmp/r_after_login.html -w '%{http_code}' \
  -d "username=admin" -d "password=<ADMIN_PASSWORD>" \
  "$DOMAIN/admin/login")
if [ "$HTTP" = "200" ]; then ok "POST /admin/login 200"; else nok "POST /admin/login 期望 200，实际 $HTTP"; fi
# 验证登录态是不是真的进了 dashboard
DASH_HTTP=$(curl -s -b "$COOKIES" -o /tmp/r_dash.html -w '%{http_code}' --max-time 8 "$DOMAIN/admin/")
if [ "$DASH_HTTP" = "200" ] && grep -q '仪表盘' /tmp/r_dash.html; then
    ok "GET /admin/ 已登录态 200 且含「仪表盘」"
else
    nok "GET /admin/ 登录态校验失败 (HTTP=$DASH_HTTP)"
fi

echo ""

# -------------------------------------------------------------------------
# Step 2: 通过后台生成 4 张激活码（不同时长）
# -------------------------------------------------------------------------
echo "[2] 后台生成 4 张测试激活码"
echo "------------------------------------------------------------------------"

# 生成 30 天 1 张 unlimited
HTTP=$(curl -s -b "$COOKIES" -o /tmp/g30.html -w '%{http_code}' -L --max-time 10 \
  -d "count=1" -d "validity_days=30" -d "card_type=unlimited" \
  "$DOMAIN/admin/cards/generate")
if [ "$HTTP" = "200" ]; then ok "生成 30 天卡 HTTP 200"; else nok "生成 30 天卡 HTTP=$HTTP"; fi

# 1 天 1 张 daypass
HTTP=$(curl -s -b "$COOKIES" -o /tmp/g1.html -w '%{http_code}' -L --max-time 10 \
  -d "count=1" -d "validity_days=1" -d "card_type=daypass" \
  "$DOMAIN/admin/cards/generate")
if [ "$HTTP" = "200" ]; then ok "生成 1 天卡 HTTP 200"; else nok "生成 1 天卡 HTTP=$HTTP"; fi

# 7 天 1 张 limited
HTTP=$(curl -s -b "$COOKIES" -o /tmp/g7.html -w '%{http_code}' -L --max-time 10 \
  -d "count=1" -d "validity_days=7" -d "card_type=limited" \
  "$DOMAIN/admin/cards/generate")
if [ "$HTTP" = "200" ]; then ok "生成 7 天卡 HTTP 200"; else nok "生成 7 天卡 HTTP=$HTTP"; fi

# 3650 天（永久）1 张 unlimited
HTTP=$(curl -s -b "$COOKIES" -o /tmp/g3650.html -w '%{http_code}' -L --max-time 10 \
  -d "count=1" -d "validity_days=3650" -d "card_type=unlimited" \
  "$DOMAIN/admin/cards/generate")
if [ "$HTTP" = "200" ]; then ok "生成 3650 天卡 HTTP 200"; else nok "生成 3650 天卡 HTTP=$HTTP"; fi

# 从 DB 找到刚才生成的最近 4 张 unused 卡（按 created_at desc）
echo ""
note "从 DB 拉刚生成的最近 4 张未激活卡"
ROWS=$($PSQL -c "SELECT id||'|'||key||'|'||card_type||'|'||validity_days
                 FROM card_keys
                 WHERE status='unused' AND member_id IS NULL
                 ORDER BY created_at DESC LIMIT 4;")
echo "$ROWS"

CARD30_ID=$(echo "$ROWS" | awk -F'|' 'NR>=1 && $4==30  { print $1; exit }')
CARD30=$(   echo "$ROWS" | awk -F'|' 'NR>=1 && $4==30  { print $2; exit }')
CARD1_ID=$( echo "$ROWS" | awk -F'|' 'NR>=1 && $4==1   { print $1; exit }')
CARD1=$(    echo "$ROWS" | awk -F'|' 'NR>=1 && $4==1   { print $2; exit }')
CARD7_ID=$( echo "$ROWS" | awk -F'|' 'NR>=1 && $4==7   { print $1; exit }')
CARD7=$(    echo "$ROWS" | awk -F'|' 'NR>=1 && $4==7   { print $2; exit }')
CARD3650_ID=$(echo "$ROWS" | awk -F'|' 'NR>=1 && $4==3650 { print $1; exit }')
CARD3650=$( echo "$ROWS" | awk -F'|' 'NR>=1 && $4==3650 { print $2; exit }')
note "CARD30=$CARD30  CARD1=$CARD1  CARD7=$CARD7  CARD3650=$CARD3650"

[ -n "$CARD30" ] && ok "拿到 30 天卡 key" || nok "拿不到 30 天卡"
[ -n "$CARD1" ]  && ok "拿到 1 天卡 key"  || nok "拿不到 1 天卡"
[ -n "$CARD7" ]  && ok "拿到 7 天卡 key"  || nok "拿不到 7 天卡"
[ -n "$CARD3650" ] && ok "拿到 3650 天卡 key" || nok "拿不到 3650 天卡"

# -------------------------------------------------------------------------
# Step 3: 用户用网页激活其中一张（用 30 天卡）
# -------------------------------------------------------------------------
echo ""
echo "[3] 用户用网页激活 30 天卡"
echo "------------------------------------------------------------------------"

RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD30\",\"email\":\"$TEST_EMAIL\"}" \
  "$DOMAIN/api/activation/redeem")
echo "  redeem 响应：$(echo "$RESP" | head -c 320)"
if echo "$RESP" | grep -Eq '"success"[[:space:]]*:[[:space:]]*true' && echo "$RESP" | grep -q 'ok_new'; then
    ok "首次激活返回 success + ok_new"
else
    nok "首次激活未返回预期 success/ok_new"
fi
if echo "$RESP" | grep -Eq '"remaining_days"[[:space:]]*:[[:space:]]*30'; then
    ok "remaining_days=30"
else
    nok "remaining_days 不为 30，实际响应见上"
fi

# 幂等：同卡同邮箱再来一次
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD30\",\"email\":\"$TEST_EMAIL\"}" \
  "$DOMAIN/api/activation/redeem")
if echo "$RESP" | grep -q 'ok_idempotent'; then ok "幂等激活 reason_code=ok_idempotent"; else nok "幂等激活未命中 ok_idempotent"; fi

# 冲突：同卡换邮箱
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD30\",\"email\":\"other-$RUN_ID@e2e.test\"}" \
  "$DOMAIN/api/activation/redeem")
if echo "$RESP" | grep -q 'card_bound_other_email'; then ok "同卡换邮箱 -> card_bound_other_email"; else nok "同卡换邮箱拒绝失败"; fi

# 不存在的卡
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"NOTEXIST_$RUN_ID\",\"email\":\"$TEST_EMAIL\"}" \
  "$DOMAIN/api/activation/redeem")
if echo "$RESP" | grep -q 'card_not_found'; then ok "不存在的卡 -> card_not_found"; else nok "不存在的卡未返回 card_not_found"; fi

# 非法邮箱
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD30\",\"email\":\"bad-email\"}" \
  "$DOMAIN/api/activation/redeem")
if echo "$RESP" | grep -q 'bad_email'; then ok "非法邮箱 -> bad_email"; else nok "非法邮箱未返回 bad_email"; fi

# -------------------------------------------------------------------------
# Step 4: 后台查看（激活码列表 + 详情/用户列表 + 用户详情 + 激活记录）
# -------------------------------------------------------------------------
echo ""
echo "[4] 后台查看激活码 / 用户 / 用户详情 / 激活记录"
echo "------------------------------------------------------------------------"

# 4.1 激活码列表能看到刚激活的 30 天卡（已激活状态 + 30 天 + 邮箱）
HTTP=$(curl -s -b "$COOKIES" -o /tmp/r_cards.html -w '%{http_code}' --max-time 8 "$DOMAIN/admin/cards?q=$CARD30")
if [ "$HTTP" = "200" ] && grep -q "$CARD30" /tmp/r_cards.html && grep -q "$TEST_EMAIL" /tmp/r_cards.html; then
    ok "后台激活码列表能查到刚激活的 30 天卡 + 邮箱"
else
    nok "后台激活码列表查不到 30 天卡（HTTP=$HTTP）"
fi
if grep -q '已激活' /tmp/r_cards.html; then ok "30 天卡显示「已激活」"; else nok "30 天卡未显示「已激活」"; fi

# 4.2 用户列表能查到刚注册的邮箱
HTTP=$(curl -s -b "$COOKIES" -o /tmp/r_users.html -w '%{http_code}' --max-time 8 "$DOMAIN/admin/users?q=$TEST_EMAIL")
if [ "$HTTP" = "200" ] && grep -q "$TEST_EMAIL" /tmp/r_users.html; then
    ok "后台用户列表能查到 $TEST_EMAIL"
else
    nok "后台用户列表查不到 $TEST_EMAIL"
fi

# 4.3 拿到 member_id 后访问用户详情
MEMBER_ID=$($PSQL -c "SELECT id FROM members WHERE email='$TEST_EMAIL';" | head -1 | tr -d ' ')
note "member_id=$MEMBER_ID"
if [ -n "$MEMBER_ID" ]; then
    HTTP=$(curl -s -b "$COOKIES" -o /tmp/r_user_detail.html -w '%{http_code}' --max-time 8 "$DOMAIN/admin/users/$MEMBER_ID")
    if [ "$HTTP" = "200" ] && grep -q "$CARD30" /tmp/r_user_detail.html && grep -q "$TEST_EMAIL" /tmp/r_user_detail.html; then
        ok "用户详情页能看到 30 天卡 + 邮箱"
    else
        nok "用户详情页校验失败（HTTP=$HTTP）"
    fi
else
    nok "拿不到 member_id"
fi

# 4.4 激活记录有这次激活
HTTP=$(curl -s -b "$COOKIES" -o /tmp/r_acts.html -w '%{http_code}' --max-time 8 "$DOMAIN/admin/activations?q=$TEST_EMAIL")
if [ "$HTTP" = "200" ] && grep -q "$TEST_EMAIL" /tmp/r_acts.html; then
    ok "激活记录页能查到 $TEST_EMAIL"
else
    nok "激活记录页查不到 $TEST_EMAIL"
fi

# -------------------------------------------------------------------------
# Step 5: 插件 4 接口（用 30 天卡 + 测试邮箱）
# -------------------------------------------------------------------------
echo ""
echo "[5] 插件 4 接口（30 天卡）"
echo "------------------------------------------------------------------------"

# 5.1 client-config
RESP=$(curl -s --max-time 8 "$DOMAIN/api/plugin/card-keys/client-config")
if echo "$RESP" | grep -q 'plugin_announcement_md' && echo "$RESP" | grep -q 'updated_at'; then
    ok "GET /client-config 返回 plugin_announcement_md + updated_at"
else
    nok "/client-config 字段不齐"
fi

# 5.2 activate -> 首次：成功
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD30\",\"email\":\"$TEST_EMAIL\",\"client_id\":\"$CLIENT_OLD\"}" \
  "$DOMAIN/api/plugin/card-keys/activate")
echo "  activate 响应：$(echo "$RESP" | head -c 320)"
if echo "$RESP" | grep -Eq '"success"[[:space:]]*:[[:space:]]*true'; then
    ok "POST /activate 用 CLIENT_OLD 首次绑定 success:true"
else
    nok "/activate 首次绑定未 success:true"
fi

# 5.3 status -> 同 client_id：success:true
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD30\",\"email\":\"$TEST_EMAIL\",\"client_id\":\"$CLIENT_OLD\"}" \
  "$DOMAIN/api/plugin/card-keys/status")
if echo "$RESP" | grep -Eq '"success"[[:space:]]*:[[:space:]]*true'; then
    ok "POST /status 同 client_id 校验通过"
else
    nok "/status 同 client_id 校验未通过"
fi

# 5.4 status -> 换 client_id：device_mismatch
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD30\",\"email\":\"$TEST_EMAIL\",\"client_id\":\"$CLIENT_NEW\"}" \
  "$DOMAIN/api/plugin/card-keys/status")
if echo "$RESP" | grep -q 'device_mismatch'; then
    ok "POST /status 换 client_id -> device_mismatch"
else
    nok "/status 换 client_id 未返回 device_mismatch"
fi

# 5.5 rebind -> 换 client_id：success
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD30\",\"email\":\"$TEST_EMAIL\",\"client_id\":\"$CLIENT_NEW\"}" \
  "$DOMAIN/api/plugin/card-keys/rebind")
echo "  rebind 响应：$(echo "$RESP" | head -c 320)"
if echo "$RESP" | grep -Eq '"success"[[:space:]]*:[[:space:]]*true'; then
    ok "POST /rebind 换绑到 CLIENT_NEW success:true"
else
    nok "/rebind 换绑未 success:true"
fi

# 5.6 rebind 之后 status with CLIENT_NEW: success
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD30\",\"email\":\"$TEST_EMAIL\",\"client_id\":\"$CLIENT_NEW\"}" \
  "$DOMAIN/api/plugin/card-keys/status")
if echo "$RESP" | grep -Eq '"success"[[:space:]]*:[[:space:]]*true'; then
    ok "rebind 后 status 用 CLIENT_NEW 校验通过"
else
    nok "rebind 后 status 校验失败"
fi

# 5.7 status 用错邮箱 -> card_bound_other_email
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD30\",\"email\":\"wrong-$RUN_ID@e2e.test\",\"client_id\":\"$CLIENT_NEW\"}" \
  "$DOMAIN/api/plugin/card-keys/status")
if echo "$RESP" | grep -q 'card_bound_other_email'; then
    ok "status 用错邮箱 -> card_bound_other_email"
else
    nok "status 错邮箱未返回 card_bound_other_email"
fi

# -------------------------------------------------------------------------
# Step 6: 过期 / 禁用 / 未激活 卡密的插件拒绝测试
# -------------------------------------------------------------------------
echo ""
echo "[6] 过期 / 禁用 / 未激活卡密的插件拒绝测试"
echo "------------------------------------------------------------------------"

# 6.1 把 CARD7 强制设为「已激活但过期」状态 -> /status 应该返回 card_expired
note "把 CARD7=$CARD7 标记为 active 但 expires_at = 昨天，模拟「插件激活后到期」"
$PSQL_FMT -c "
UPDATE card_keys
SET status='active', member_id=$MEMBER_ID, bound_at=now()-interval '5 days',
    first_activated_at=now()-interval '5 days',
    expires_at=now()-interval '1 hour'
WHERE id=$CARD7_ID;"

RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD7\",\"email\":\"$TEST_EMAIL\",\"client_id\":\"$CLIENT_NEW\"}" \
  "$DOMAIN/api/plugin/card-keys/status")
echo "  CARD7(过期) status：$(echo "$RESP" | head -c 200)"
if echo "$RESP" | grep -q 'card_expired'; then
    ok "/status 命中过期卡 -> card_expired"
else
    nok "/status 过期卡未返回 card_expired"
fi

# 6.2 activate 过期卡 -> card_expired
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD7\",\"email\":\"$TEST_EMAIL\",\"client_id\":\"$CLIENT_NEW\"}" \
  "$DOMAIN/api/plugin/card-keys/activate")
if echo "$RESP" | grep -q 'card_expired'; then
    ok "/activate 过期卡 -> card_expired"
else
    nok "/activate 过期卡未返回 card_expired"
fi

# 6.3 redeem 过期卡 -> card_expired
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD7\",\"email\":\"$TEST_EMAIL\"}" \
  "$DOMAIN/api/activation/redeem")
if echo "$RESP" | grep -q 'card_expired'; then
    ok "/api/activation/redeem 过期卡 -> card_expired"
else
    nok "redeem 过期卡未返回 card_expired"
fi

# 6.4 通过后台「禁用」CARD1，然后插件 /status 应该拒绝
note "通过后台禁用 CARD1=$CARD1"
HTTP=$(curl -s -b "$COOKIES" -o /dev/null -w '%{http_code}' --max-time 8 \
  -X POST "$DOMAIN/admin/cards/$CARD1_ID/toggle")
# admin.cards_toggle 返回 302 重定向到 referrer/cards，业务即成功
if [ "$HTTP" = "302" ] || [ "$HTTP" = "200" ]; then ok "后台禁用 CARD1 HTTP $HTTP（重定向 = 成功）"; else nok "后台禁用 CARD1 HTTP=$HTTP"; fi

# 现在 CARD1 是 unused + disabled 状态。给它一个 member 让 status 接口能跑到禁用判断
$PSQL_FMT -c "
UPDATE card_keys
SET member_id=$MEMBER_ID, bound_at=now(), first_activated_at=now(),
    expires_at=now()+interval '1 day'
WHERE id=$CARD1_ID;"

RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD1\",\"email\":\"$TEST_EMAIL\",\"client_id\":\"$CLIENT_NEW\"}" \
  "$DOMAIN/api/plugin/card-keys/status")
echo "  CARD1(禁用) status：$(echo "$RESP" | head -c 200)"
if echo "$RESP" | grep -q 'card_disabled'; then
    ok "/status 禁用卡 -> card_disabled"
else
    nok "/status 禁用卡未返回 card_disabled"
fi

# 6.5 redeem 禁用卡 -> card_disabled
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD1\",\"email\":\"$TEST_EMAIL\"}" \
  "$DOMAIN/api/activation/redeem")
if echo "$RESP" | grep -q 'card_disabled'; then
    ok "/redeem 禁用卡 -> card_disabled"
else
    nok "/redeem 禁用卡未返回 card_disabled"
fi

# 6.6 未激活的 CARD3650 走 plugin /status：因为没绑 client_id 应该返回 card_not_activated
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD3650\",\"email\":\"$TEST_EMAIL\",\"client_id\":\"$CLIENT_NEW\"}" \
  "$DOMAIN/api/plugin/card-keys/status")
if echo "$RESP" | grep -q 'card_not_activated'; then
    ok "/status 未激活卡 -> card_not_activated"
else
    nok "/status 未激活卡未返回 card_not_activated（响应=$(echo $RESP | head -c 120)）"
fi

# 6.7 后台「延长」操作：把过期的 CARD7 延长 10 天，验证 status 由 card_expired 变 success
note "通过后台调整 CARD7 有效期 +10 天，期望 /status 变成 success"
HTTP=$(curl -s -b "$COOKIES" -o /dev/null -w '%{http_code}' --max-time 8 \
  -d "extend_days=10" -X POST "$DOMAIN/admin/cards/$CARD7_ID/extend")
if [ "$HTTP" = "302" ] || [ "$HTTP" = "200" ]; then ok "后台延长 CARD7 +10 天 HTTP $HTTP（重定向 = 成功）"; else nok "后台延长 CARD7 HTTP=$HTTP"; fi

# 重新激活 binding：直接走 activate 重建 plugin_card_binding
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD7\",\"email\":\"$TEST_EMAIL\",\"client_id\":\"$CLIENT_NEW\"}" \
  "$DOMAIN/api/plugin/card-keys/activate")
echo "  延长后 activate CARD7：$(echo "$RESP" | head -c 200)"
if echo "$RESP" | grep -Eq '"success"[[:space:]]*:[[:space:]]*true'; then
    ok "延长 +10 天后 CARD7 activate success:true（过期判断已失效）"
else
    # 也接受 device_mismatch 这种业务上正常的失败（说明走到了正常逻辑，而不是 card_expired）
    if echo "$RESP" | grep -q 'device_mismatch'; then
        ok "延长 +10 天后 CARD7 已不再返回 card_expired（device_mismatch 说明业务路径正常）"
    else
        nok "延长 +10 天后 CARD7 仍未成功，响应=$(echo $RESP | head -c 200)"
    fi
fi

# -------------------------------------------------------------------------
# Step 7: 后台「调整有效期」自定义负值 → 测试缩短能力
# -------------------------------------------------------------------------
echo ""
echo "[7] 后台「调整有效期」自定义负值"
echo "------------------------------------------------------------------------"

# 把 CARD30 缩短 -50 天（直接让它变过期）
HTTP=$(curl -s -b "$COOKIES" -o /dev/null -w '%{http_code}' --max-time 8 \
  -d "extend_days=-50" -X POST "$DOMAIN/admin/cards/$CARD30_ID/extend")
if [ "$HTTP" = "302" ] || [ "$HTTP" = "200" ]; then ok "后台调整 CARD30 -50 天 HTTP $HTTP（重定向 = 成功）"; else nok "调整 CARD30 -50 HTTP=$HTTP"; fi

# 这时 plugin /status 应该 card_expired
RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD30\",\"email\":\"$TEST_EMAIL\",\"client_id\":\"$CLIENT_NEW\"}" \
  "$DOMAIN/api/plugin/card-keys/status")
if echo "$RESP" | grep -q 'card_expired'; then
    ok "缩短 -50 天后 /status -> card_expired"
else
    nok "缩短后未返回 card_expired，响应=$(echo $RESP | head -c 200)"
fi

# 再加回 +60 天，让它复活
HTTP=$(curl -s -b "$COOKIES" -o /dev/null -w '%{http_code}' --max-time 8 \
  -d "extend_days=60" -X POST "$DOMAIN/admin/cards/$CARD30_ID/extend")
if [ "$HTTP" = "302" ] || [ "$HTTP" = "200" ]; then ok "后台调整 CARD30 +60 天 HTTP $HTTP（重定向 = 成功）"; else nok "+60 天失败 HTTP=$HTTP"; fi

RESP=$(curl -s --max-time 8 -H 'Content-Type: application/json' \
  -d "{\"card_key\":\"$CARD30\",\"email\":\"$TEST_EMAIL\",\"client_id\":\"$CLIENT_NEW\"}" \
  "$DOMAIN/api/plugin/card-keys/status")
if echo "$RESP" | grep -Eq '"success"[[:space:]]*:[[:space:]]*true'; then
    ok "+60 天后 /status 恢复 success:true"
else
    nok "+60 天后 status 未恢复，响应=$(echo $RESP | head -c 200)"
fi

# -------------------------------------------------------------------------
# Step 8: 清理测试数据
# -------------------------------------------------------------------------
echo ""
echo "[8] 清理测试数据"
echo "------------------------------------------------------------------------"
$PSQL_FMT -v ON_ERROR_STOP=0 <<SQL
BEGIN;
DELETE FROM plugin_card_rebind_logs WHERE email='$TEST_EMAIL';
DELETE FROM plugin_card_bindings WHERE email='$TEST_EMAIL';
DELETE FROM activation_records WHERE email='$TEST_EMAIL';
UPDATE card_keys SET member_id=NULL, bound_at=NULL, first_activated_at=NULL, expires_at=NULL, status='unused'
  WHERE id IN ($CARD30_ID, $CARD1_ID, $CARD7_ID, $CARD3650_ID);
DELETE FROM card_keys WHERE id IN ($CARD30_ID, $CARD1_ID, $CARD7_ID, $CARD3650_ID);
DELETE FROM members WHERE email='$TEST_EMAIL';
COMMIT;
SQL
echo "  ✓ 清理完毕（删了 4 张测试卡 + 1 个测试用户 + 相关激活/绑定/换绑日志）"

# 验证清理
LEFT=$($PSQL -c "SELECT count(*) FROM card_keys WHERE id IN ($CARD30_ID,$CARD1_ID,$CARD7_ID,$CARD3650_ID);" | tr -d ' ')
[ "$LEFT" = "0" ] && ok "残留卡 0" || nok "残留卡 $LEFT 张"
LEFT=$($PSQL -c "SELECT count(*) FROM members WHERE email='$TEST_EMAIL';" | tr -d ' ')
[ "$LEFT" = "0" ] && ok "残留用户 0" || nok "残留用户 $LEFT 个"
LEFT=$($PSQL -c "SELECT count(*) FROM activation_records WHERE email='$TEST_EMAIL';" | tr -d ' ')
[ "$LEFT" = "0" ] && ok "残留激活记录 0" || nok "残留激活记录 $LEFT 条"

unset PGPASSWORD
rm -f "$COOKIES"

# -------------------------------------------------------------------------
echo ""
echo "========================================================================"
echo "  汇总   PASS=$PASS   FAIL=$FAIL"
echo "========================================================================"
echo ""
echo "[详细明细]"
cat "$SUMMARY" | column -t -s '|' | sed 's/^/  /'
rm -f "$SUMMARY"

[ "$FAIL" -eq 0 ]
