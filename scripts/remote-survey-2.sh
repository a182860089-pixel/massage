#!/usr/bin/env bash
# 第二轮探查：定位 seat.20050225.xyz 的承接服务

print_section() { echo ""; echo "===== $1 ====="; }

print_section "01_dns_resolution"
echo "[host seat.20050225.xyz]"; host seat.20050225.xyz 2>&1 | head -10
echo "[dig +short]"; dig +short seat.20050225.xyz 2>&1 | head -10
echo "[my-ip]"; curl -s --max-time 5 https://ifconfig.io 2>/dev/null || true
echo ""

print_section "02_curl_to_self"
echo "[GET /api/plugin/card-keys/client-config via 127.0.0.1:80 Host=seat.20050225.xyz]"
curl -s -o - -w '\n[HTTP %{http_code}] %{size_download}B  cl=%{content_type}\n' \
  --max-time 10 -H 'Host: seat.20050225.xyz' \
  http://127.0.0.1/api/plugin/card-keys/client-config 2>&1 | head -30
echo ""
echo "[same via :443 with -k Host=seat.20050225.xyz]"
curl -sk -o - -w '\n[HTTP %{http_code}] %{size_download}B  cl=%{content_type}\n' \
  --max-time 10 -H 'Host: seat.20050225.xyz' --resolve seat.20050225.xyz:443:127.0.0.1 \
  https://seat.20050225.xyz/api/plugin/card-keys/client-config 2>&1 | head -30

print_section "03_nginx_all_server_names"
nginx -T 2>/dev/null | grep -E "server_name\s+" | sort -u

print_section "04_nginx_default_server_root"
nginx -T 2>/dev/null | awk '
  /server\s*\{/ {block=""; collecting=1}
  collecting {block = block "\n" $0}
  /\}/ {if (collecting) {if (block ~ /default_server|server_name\s+_|listen\s+80;/) print block "\n--- end block ---"; collecting=0; block=""}}
' | head -200

print_section "05_chatgpt_team_helper_tree"
ls -la /opt/easy-team/repo/chatgpt-team-helper 2>/dev/null
echo "---"
find /opt/easy-team/repo/chatgpt-team-helper -maxdepth 4 -type f \( -name "*.go" -o -name "*.js" -o -name "*.ts" -o -name "*.py" -o -name "*.json" -o -name "*.md" \) 2>/dev/null | head -80

print_section "06_plus_service_routes"
echo "[grep handler/route/card_key in dujiao-next-server]"
grep -RIn --include="*.go" -E "card.?key|/api/plugin|/card-keys|activate|rebind|client-config" /opt/easy-team/repo/dujiao-next-server 2>/dev/null | head -120

print_section "07_dujiao_next_server_layout"
ls /opt/easy-team/repo/dujiao-next-server 2>/dev/null
echo "---"
find /opt/easy-team/repo/dujiao-next-server -maxdepth 3 -type d 2>/dev/null
echo "---"
find /opt/easy-team/repo/dujiao-next-server -maxdepth 4 -type f -name "*.go" 2>/dev/null | head -100

print_section "08_dujiao_next_server_go_mod"
cat /opt/easy-team/repo/dujiao-next-server/go.mod 2>/dev/null | head -60

print_section "09_seatpool_backup_card_key_service_head"
head -200 /root/seatpool_backup_20260319_033007/card_key_service.py 2>/dev/null

print_section "10_listening_18100"
echo "[curl to 127.0.0.1:18100 root]"
curl -s -o - -w '\n[HTTP %{http_code}]\n' --max-time 5 http://127.0.0.1:18100/ 2>&1 | head -20
echo ""
echo "[curl /api/plugin/card-keys/client-config to 18100]"
curl -s -o - -w '\n[HTTP %{http_code}]\n' --max-time 5 http://127.0.0.1:18100/api/plugin/card-keys/client-config 2>&1 | head -20
echo ""
echo "[curl /api/plugin/card-keys/client-config to 8080]"
curl -s -o - -w '\n[HTTP %{http_code}]\n' --max-time 5 http://127.0.0.1:8080/api/plugin/card-keys/client-config 2>&1 | head -20
echo ""
echo "[curl /api/plugin/card-keys/client-config to 18080]"
curl -s -o - -w '\n[HTTP %{http_code}]\n' --max-time 5 http://127.0.0.1:18080/api/plugin/card-keys/client-config 2>&1 | head -20
echo ""
echo "[curl /api/plugin/card-keys/client-config to 8001]"
curl -s -o - -w '\n[HTTP %{http_code}]\n' --max-time 5 http://127.0.0.1:8001/api/plugin/card-keys/client-config 2>&1 | head -20

print_section "99_done"
echo "$(date -u +%FT%TZ)"
