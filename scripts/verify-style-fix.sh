#!/usr/bin/env bash
set +e
DOMAIN="https://seat.20050225.xyz"
COOKIES=$(mktemp)

# 登录拿 cookie
curl -s -c "$COOKIES" -b "$COOKIES" -o /dev/null --max-time 8 "$DOMAIN/admin/login"
curl -s -c "$COOKIES" -b "$COOKIES" -L --max-time 8 -o /dev/null \
  -d "username=admin" -d "password=<ADMIN_PASSWORD>" "$DOMAIN/admin/login"

echo "===== /admin/cards 必须含 admin sidebar 关键样式 ====="
BODY=$(curl -s -b "$COOKIES" --max-time 8 "$DOMAIN/admin/cards")
for key in \
  ".shell { display: grid; grid-template-columns: 248px 1fr" \
  ".sidebar {" \
  ".nav a {" \
  ".sidebar-footer" \
  ".gen-card {" \
  ".preset {" \
  ".preset.active"; do
    if echo "$BODY" | grep -F -q -- "$key"; then
        echo "  ✓ 含「$key」"
    else
        echo "  ✗ 缺「$key」"
    fi
done

echo ""
echo "===== /admin/login 必须用 flex 居中 ====="
BODY=$(curl -s --max-time 8 "$DOMAIN/admin/login")
if echo "$BODY" | grep -F -q -- "display: flex"; then echo "  ✓ 含 display: flex"; else echo "  ✗ 缺 display: flex"; fi
if echo "$BODY" | grep -F -q -- "justify-content: center"; then echo "  ✓ 含 justify-content: center"; else echo "  ✗ 缺 justify-content: center"; fi

echo ""
echo "===== 全站不应出现旧绿色 #10a37f / 蓝色 #3b82f6 ====="
for path in "/" "/admin/login" "/admin/cards" "/admin/" "/admin/users" "/admin/activations"; do
    BODY=$(curl -s -b "$COOKIES" --max-time 8 "$DOMAIN$path")
    HITS=$(echo "$BODY" | grep -oE '#10a37f|#0e8e6f|#d1fadf|#a7f3d0|#065f46|#10A37F|#3b82f6|#bfdbfe|#1e3a8a' | sort -u)
    if [ -z "$HITS" ]; then
        echo "  ✓ $path 不含旧绿/蓝色"
    else
        echo "  ✗ $path 仍含: $HITS"
    fi
done

echo ""
echo "===== /user/activation 不应出现旧绿色 ====="
BODY=$(curl -s --max-time 8 "$DOMAIN/")
HITS=$(echo "$BODY" | grep -oE '#10a37f|#0e8e6f|#d1fadf|#a7f3d0|#065f46|#10A37F|#3b82f6|#bfdbfe|#1e3a8a' | sort -u)
if [ -z "$HITS" ]; then
    echo "  ✓ 用户激活页不含旧绿/蓝色"
else
    echo "  ✗ 用户激活页仍含: $HITS"
fi

rm -f "$COOKIES"
echo "DONE"
