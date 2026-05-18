#!/usr/bin/env bash
# 把本地 templates/ 解到 /opt/cardkey-admin/app/templates/，然后 HUP gunicorn 平滑重载（不掉连接）。
set +e

TARGET=/opt/cardkey-admin
echo "===== 1) 备份现有 templates ====="
TS=$(date +%Y%m%d_%H%M%S)
tar -czf "$TARGET/templates_backup_$TS.tgz" -C "$TARGET/app" templates 2>/dev/null && echo "BACKUP -> $TARGET/templates_backup_$TS.tgz"

echo ""
echo "===== 2) 解压新模板（直接覆盖到 app/，让 templates/ 落到正确位置） ====="
# /tmp/templates.tgz 内部根是 templates/，所以解到 app/ 让它成为 app/templates/
rm -rf "$TARGET/app/templates"
tar -xzf /tmp/templates.tgz -C "$TARGET/app"

echo "  解压后内容："
find "$TARGET/app/templates" -type f | sort

echo ""
echo "===== 3) 平滑重载 gunicorn (HUP) ====="
PID=$(cat "$TARGET/server.pid" 2>/dev/null)
if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill -HUP "$PID"
    echo "  发送 SIGHUP 给 PID=$PID"
    sleep 2
    # gunicorn HUP 会保持 master PID 不变，worker 全部重启
    echo "  当前进程："
    ps -fp "$PID" 2>/dev/null
    pgrep -af "gunicorn.*8810" | head -3
else
    echo "  !! server.pid 不存在或进程已退出，改用 pkill+重启"
    pkill -f 'gunicorn.*8810' 2>/dev/null
    sleep 1
    cd "$TARGET"
    set -a; . "$TARGET/.env"; set +a
    nohup "$TARGET/.venv/bin/python" -m gunicorn \
      -w 1 -k gthread --threads 4 --timeout 60 --graceful-timeout 30 \
      --chdir "$TARGET" \
      -b 127.0.0.1:8810 'app:create_app()' \
      > "$TARGET/server.log" 2>&1 &
    NEW_PID=$!
    echo "$NEW_PID" > "$TARGET/server.pid"
    echo "  新 PID=$NEW_PID"
    sleep 3
fi

echo ""
echo "===== 4) 健康检查 ====="
curl -s -o /dev/null -w '127.0.0.1:8810/healthz                          HTTP %{http_code}\n' --max-time 5 http://127.0.0.1:8810/healthz
curl -s -o /dev/null -w '127.0.0.1:8810/                                 HTTP %{http_code}\n' --max-time 5 http://127.0.0.1:8810/
curl -s -o /dev/null -w '127.0.0.1:8810/admin/login                      HTTP %{http_code}\n' --max-time 5 http://127.0.0.1:8810/admin/login
curl -s -o /dev/null -w 'https://seat.20050225.xyz/                      HTTP %{http_code}\n' --max-time 8 https://seat.20050225.xyz/
curl -s -o /dev/null -w 'https://seat.20050225.xyz/admin/login           HTTP %{http_code}\n' --max-time 8 https://seat.20050225.xyz/admin/login

echo ""
echo "===== 5) 检查页面里关键字（确认新模板生效） ====="
echo "  激活页期望含「激活你的卡密」「管理员登录」"
curl -s --max-time 5 https://seat.20050225.xyz/ | grep -oE '激活你的卡密|管理员登录|cardkey · activation' | sort -u
echo ""
echo "  /admin/login 期望含「cardkey-admin · 激活码管理后台」"
curl -s --max-time 5 https://seat.20050225.xyz/admin/login | grep -oE 'cardkey-admin · 激活码管理后台|返回激活页' | sort -u

echo ""
echo "===== 6) tail log ====="
tail -n 15 "$TARGET/server.log"

echo ""
echo "DONE"
