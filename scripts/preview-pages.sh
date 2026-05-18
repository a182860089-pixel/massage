#!/usr/bin/env bash
# 验证关键页面渲染内容（不依赖浏览器，看关键文案是否在 HTML 里）
set +e

DOMAIN="https://seat.20050225.xyz"

check_keys() {
    local url="$1"; shift
    local label="$1"; shift
    echo "----- $label  ($url) -----"
    BODY=$(curl -s --max-time 8 "$url")
    HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$url")
    echo "  HTTP $HTTP"
    for key in "$@"; do
        if echo "$BODY" | grep -F -q -- "$key"; then
            echo "  ✓ 含「$key」"
        else
            echo "  ✗ 缺「$key」"
        fi
    done
    echo ""
}

check_keys "$DOMAIN/" "用户激活页" \
    "激活你的卡密" "立即激活" "管理员登录" "cardkey · activation" "© cardkey · 简单、安全、本地权威"

check_keys "$DOMAIN/admin/login" "管理员登录页" \
    "管理员登录" "cardkey-admin · 激活码管理后台" "返回激活页" "请输入用户名" "请输入密码"

# 登录拿 cookie，再看后台
COOKIES=$(mktemp)
curl -s -c "$COOKIES" -b "$COOKIES" -o /dev/null --max-time 8 "$DOMAIN/admin/login"
curl -s -c "$COOKIES" -b "$COOKIES" -L --max-time 8 \
  -o /dev/null -d "username=admin" -d "password=<ADMIN_PASSWORD>" "$DOMAIN/admin/login"

echo "===== 后台已登录态截图 ====="
echo ""

check_keys() {
    local url="$1"; shift
    local label="$1"; shift
    echo "----- $label  ($url) -----"
    BODY=$(curl -s -b "$COOKIES" --max-time 8 "$url")
    HTTP=$(curl -s -b "$COOKIES" -o /dev/null -w '%{http_code}' --max-time 8 "$url")
    echo "  HTTP $HTTP"
    for key in "$@"; do
        if echo "$BODY" | grep -F -q -- "$key"; then
            echo "  ✓ 含「$key」"
        else
            echo "  ✗ 缺「$key」"
        fi
    done
    echo ""
}

check_keys "$DOMAIN/admin/" "仪表盘" \
    "仪表盘" "概览" "最近 10 条激活记录" "总激活码" "已激活" "未激活"

check_keys "$DOMAIN/admin/cards" "激活码列表" \
    "批量生成激活码" "自定义有效期" "永久" "365 天" "标准卡" "日抛卡"

check_keys "$DOMAIN/admin/users" "用户列表" \
    "按邮箱搜索" "绑定激活码数" "首次加入"

check_keys "$DOMAIN/admin/activations" "激活记录" \
    "按邮箱或激活码搜索" "全部状态" "全部来源"

rm -f "$COOKIES"
echo "DONE"
