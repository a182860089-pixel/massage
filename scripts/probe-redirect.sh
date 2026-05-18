#!/usr/bin/env bash
set +e

print_section() { echo ""; echo "===== $1 ====="; }

print_section "01_luming_dns"
echo "[dig +short]"; dig +short seat.luming.cv
echo "[host]"; host seat.luming.cv 2>&1 | head -5
echo "[nslookup]"; nslookup seat.luming.cv 2>&1 | head -10

print_section "02_luming_https"
echo "[curl direct]"
curl -skI --max-time 8 https://seat.luming.cv/team 2>&1 | head -10
echo ""
echo "[curl with --resolve to dummy]"
curl -skI --max-time 8 --resolve seat.luming.cv:443:154.12.94.197 https://seat.luming.cv/team 2>&1 | head -10

print_section "03_seatpool_team_route"
grep -n -B 1 -A 12 '"/team"' /seatpool/app/__init__.py | head -50

print_section "04_seatpool_root_route"
grep -n -B 1 -A 12 "@app.route('/')" /seatpool/app/__init__.py | head -50

print_section "05_seatpool_proxy_alias_handler"
grep -n -B 2 -A 25 "_proxy_alias" /seatpool/app/__init__.py | head -100

print_section "06_plugin_remote_env"
grep -E '^PLUGIN_REMOTE|^SEATPOOL_HOMEPAGE|^HOMEPAGE_REDIRECT|REDIRECT' /seatpool/.env | head -20

print_section "07_all_routes_emitted"
/seatpool/venv/bin/python - <<'PY' 2>&1 | head -200
import os, sys
sys.path.insert(0, '/seatpool')
os.environ.setdefault('SEATPOOL_PROCESS_ROLE','web')
from app import create_app
app = create_app()
for rule in sorted(app.url_map.iter_rules(), key=lambda r: r.rule):
    if rule.endpoint.startswith('static'): continue
    print(f"{','.join(sorted(rule.methods - {'HEAD','OPTIONS'})):8} {rule.rule:60} -> {rule.endpoint}")
PY

print_section "08_done"
date -u +%FT%TZ
