#!/usr/bin/env bash
set +e
DOMAIN="https://seat.20050225.xyz"
COOKIES=$(mktemp)
curl -s -c "$COOKIES" -b "$COOKIES" -o /dev/null --max-time 8 "$DOMAIN/admin/login"
curl -s -c "$COOKIES" -b "$COOKIES" -L --max-time 8 -o /dev/null \
  -d "username=admin" -d "password=<ADMIN_PASSWORD>" "$DOMAIN/admin/login"

check() {
    local url="$1"; shift
    local label="$1"; shift
    echo "----- $label  ($url) -----"
    BODY=$(curl -s -b "$COOKIES" --max-time 8 "$url")
    for key in "$@"; do
        if echo "$BODY" | grep -F -q -- "$key"; then echo "  ✓ 含「$key」"; else echo "  ✗ 缺「$key」"; fi
    done
    echo ""
}

check "$DOMAIN/admin/" "仪表盘最近 10 条激活记录" \
    '<span class="copy-key" data-copy=' 'class="copy-toast"' '已复制：'

check "$DOMAIN/admin/cards" "激活码列表" \
    '<span class="copy-key" data-copy=' \
    '.copy-key {' '.copy-key:hover'

check "$DOMAIN/admin/users" "用户列表（邮箱可复制）" \
    '<span class="copy-key" data-copy='

check "$DOMAIN/admin/activations" "激活记录（邮箱+激活码可复制）" \
    '<span class="copy-key" data-copy='

# 用户详情：找一个 member id
echo "----- 用户详情（任挑一个 member）-----"
MEMBER_ID=$(PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}" psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -P pager=off -A -F'|' -t -c "SELECT id FROM members ORDER BY id DESC LIMIT 1;")
echo "  member_id=$MEMBER_ID"
BODY=$(curl -s -b "$COOKIES" --max-time 8 "$DOMAIN/admin/users/$MEMBER_ID")
for key in '<span class="copy-key" data-copy=' '基础信息' '绑定的激活码'; do
    if echo "$BODY" | grep -F -q -- "$key"; then echo "  ✓ 含「$key」"; else echo "  ✗ 缺「$key」"; fi
done

# 顺便 grep 出实际的 copy-key 数量
echo ""
echo "===== 各页面 copy-key 节点统计 ====="
for path in "/admin/" "/admin/cards" "/admin/users" "/admin/activations" "/admin/users/$MEMBER_ID"; do
    COUNT=$(curl -s -b "$COOKIES" --max-time 8 "$DOMAIN$path" | grep -o 'class="copy-key"' | wc -l)
    echo "  $path → $COUNT 个 copy-key 节点"
done

rm -f "$COOKIES"
echo "DONE"
