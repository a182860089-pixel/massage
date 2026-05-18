#!/usr/bin/env bash
# 切流量前快照：监听端口、nginx 配置、服务状态
set +e

echo "===== ss -ltnp (listen ports) ====="
ss -ltnp 2>/dev/null | grep -E ':80\b|:443\b|:8000\b|:8801\b|:8810\b'
echo ""

echo "===== /etc/nginx/sites-enabled ====="
ls -la /etc/nginx/sites-enabled/
echo ""

echo "===== seat.20050225.xyz 配置 ====="
for f in /etc/nginx/sites-enabled/*seat* /etc/nginx/sites-enabled/seat.20050225.xyz*; do
  [ -e "$f" ] || continue
  echo "--- $f ---"
  cat "$f"
  echo "--- end $f ---"
done
echo ""

echo "===== 是否还有 default_server ====="
grep -RIn 'default_server' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ /etc/nginx/nginx.conf 2>/dev/null
echo ""

echo "===== cardkey-admin (8810) 健康 ====="
curl -s -o /dev/null -w '/healthz HTTP %{http_code}\n' --max-time 3 http://127.0.0.1:8810/healthz
curl -s -o /dev/null -w '/ HTTP %{http_code}\n' --max-time 3 http://127.0.0.1:8810/
curl -s -o /dev/null -w '/admin/login HTTP %{http_code}\n' --max-time 3 http://127.0.0.1:8810/admin/login
curl -s -o /dev/null -w '/api/plugin/card-keys/client-config HTTP %{http_code}\n' --max-time 3 http://127.0.0.1:8810/api/plugin/card-keys/client-config

echo ""
echo "===== seatpool-web (8000) 健康 ====="
curl -s -o /dev/null -w '/ HTTP %{http_code}\n' --max-time 3 http://127.0.0.1:8000/

echo ""
echo "===== cardkey-only (8801) 健康（仅做参考） ====="
curl -s -o /dev/null -w '/healthz HTTP %{http_code}\n' --max-time 3 http://127.0.0.1:8801/healthz

echo ""
echo "===== seat.20050225.xyz 当前实际响应 ====="
curl -s -o /dev/null -w 'https / HTTP %{http_code}\n' --max-time 5 https://seat.20050225.xyz/
curl -s -o /dev/null -w 'https /admin/login HTTP %{http_code}\n' --max-time 5 https://seat.20050225.xyz/admin/login
curl -s -o /dev/null -w 'https /api/plugin/card-keys/client-config HTTP %{http_code}\n' --max-time 5 https://seat.20050225.xyz/api/plugin/card-keys/client-config

echo ""
echo "===== cardkey-admin 进程 ====="
ps -fp "$(cat /opt/cardkey-admin/server.pid 2>/dev/null)" 2>/dev/null || echo "no pid file or process gone"
echo ""
echo "===== seatpool-web 进程 ====="
pgrep -af 'gunicorn' | head -10
echo ""
echo "===== done ====="
