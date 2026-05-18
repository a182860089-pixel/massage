#!/usr/bin/env bash
# Remote read-only survey for cardkey project (round 1).
set +e

print_section() {
  echo ""
  echo "===== $1 ====="
}

print_section "00_card_keys_live_probe"
echo "[GET https://seat.20050225.xyz/api/plugin/card-keys/client-config]"
curl -sk -o /tmp/cardcfg.json -w 'HTTP %{http_code}  size=%{size_download}B  type=%{content_type}\n' \
  --max-time 10 --resolve seat.20050225.xyz:443:127.0.0.1 \
  https://seat.20050225.xyz/api/plugin/card-keys/client-config
echo "[body head]"; head -c 600 /tmp/cardcfg.json; echo ""

echo "[POST card-keys/status with dummy data]"
curl -sk -o /tmp/cardstatus.json -w 'HTTP %{http_code}  size=%{size_download}B\n' \
  --max-time 10 --resolve seat.20050225.xyz:443:127.0.0.1 \
  -H 'Content-Type: application/json' \
  -d '{"card_key":"TEST","email":"a@b.com","client_id":"probe"}' \
  https://seat.20050225.xyz/api/plugin/card-keys/status
echo "[body head]"; head -c 600 /tmp/cardstatus.json; echo ""

print_section "01_system_info"
uname -a
cat /etc/os-release 2>/dev/null
uptime

print_section "02_listening_ports"
ss -tlnp 2>/dev/null | head -200

print_section "03_running_services_filtered"
systemctl list-units --type=service --state=running --no-pager 2>/dev/null | head -120

print_section "04_processes_servers"
ps -eo pid,user,etime,cmd --sort=etime 2>/dev/null | grep -E "node|python|php|go|java|gunicorn|uwsgi|caddy|nginx|apache" | grep -v grep | head -80

print_section "05_nginx_seat_block"
if command -v nginx >/dev/null 2>&1; then
  nginx -T 2>/dev/null | awk '
    BEGIN { in_block=0; brace=0; buf="" }
    /server[[:space:]]*\{/ { in_block=1; brace=1; buf=$0"\n"; next }
    in_block {
      buf = buf $0 "\n"
      n = gsub(/\{/, "{")
      m = gsub(/\}/, "}")
      brace += n - m
      if (brace == 0) {
        if (buf ~ /seat\.20050225|card-keys/) print buf "--- end ---"
        in_block=0; buf=""
      }
    }
  '
fi

print_section "06_all_nginx_server_names"
nginx -T 2>/dev/null | grep -E "^\s*server_name" | sort -u

print_section "07_project_candidates_scan"
for base in /root /home /opt /srv /var/www /app /data; do
  if [ -d "$base" ]; then
    echo "[scan] $base (top dirs)"
    ls -1 "$base" 2>/dev/null | head -30
    echo ""
  fi
done

print_section "08_grep_card_keys_routes"
for base in /root /home /opt /srv /var/www /app /data; do
  if [ -d "$base" ]; then
    grep -rIl --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=vendor --exclude-dir=__pycache__ --exclude-dir=.venv -e "/api/plugin/card-keys" "$base" 2>/dev/null | head -30
  fi
done

print_section "09_grep_pluginActivateCardKey"
for base in /root /home /opt /srv /var/www /app /data; do
  if [ -d "$base" ]; then
    grep -rIl --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=vendor --exclude-dir=__pycache__ --exclude-dir=.venv -e "card-keys/activate" -e "card-keys/status" -e "card-keys/rebind" -e "card-keys/client-config" "$base" 2>/dev/null | head -30
  fi
done

print_section "10_pkg_signatures"
for base in /root /home /opt /srv /var/www /app /data; do
  if [ -d "$base" ]; then
    find "$base" -maxdepth 5 -type f \( -name "package.json" -o -name "go.mod" -o -name "requirements.txt" -o -name "pyproject.toml" -o -name "composer.json" -o -name "pom.xml" -o -name "main.go" -o -name "main.py" -o -name "app.py" -o -name "server.js" -o -name "index.js" \) 2>/dev/null \
      -not -path '*node_modules*' -not -path '*.venv*' -not -path '*vendor*' | head -50
  fi
done

print_section "11_databases"
echo "[mysql]"; command -v mysql; mysql --version 2>/dev/null
test -d /var/lib/mysql && ls /var/lib/mysql 2>/dev/null | head -30
echo "[postgres]"; command -v psql; psql --version 2>/dev/null
test -d /var/lib/postgresql && ls /var/lib/postgresql 2>/dev/null | head -10
echo "[redis]"; command -v redis-cli; redis-cli --version 2>/dev/null
echo "[sqlite]"; command -v sqlite3

print_section "12_disk"
df -h | head -10

print_section "99_done"
date -u +%FT%TZ
