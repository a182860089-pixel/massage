#!/usr/bin/env bash
# 第二轮：聚焦 /seatpool Flask 应用与 PostgreSQL DB
set +e

print_section() {
  echo ""
  echo "===== $1 ====="
}

print_section "00_seatpool_top"
ls -la /seatpool 2>/dev/null | head -60
echo ""
echo "[disk]"; du -sh /seatpool 2>/dev/null

print_section "01_seatpool_app_tree"
find /seatpool/app -maxdepth 4 -type f \( -name "*.py" -o -name "*.cfg" -o -name "*.ini" -o -name "*.toml" -o -name "*.yaml" -o -name "*.yml" \) 2>/dev/null | head -200

print_section "02_seatpool_blueprints_routes"
grep -RIn --include="*.py" -E "add_url_rule|@app\\.route|Blueprint\\(|/api/plugin/card-keys|card-keys/(activate|status|rebind|client-config)" /seatpool/app 2>/dev/null | head -120

print_section "03_seatpool_card_keys_files"
grep -rIl --include="*.py" -e "/api/plugin/card-keys" -e "plugin/card-keys" /seatpool 2>/dev/null

print_section "04_seatpool_card_key_models"
grep -RIn --include="*.py" -E "class CardKey|tablename.*card_key|card_keys|CardKeyType|CardKeyStatus" /seatpool/app/models 2>/dev/null | head -80
echo "---"
ls /seatpool/app/models 2>/dev/null

print_section "05_seatpool_card_key_service_head"
ls /seatpool/app/services 2>/dev/null | head -40
echo ""
test -f /seatpool/app/services/card_key_service.py && head -120 /seatpool/app/services/card_key_service.py | sed 's/^/  /'

print_section "06_seatpool_plugin_views"
grep -RIln --include="*.py" -E "plugin|client_config|client-config" /seatpool/app 2>/dev/null | head -40

print_section "07_seatpool_main_app"
head -120 /seatpool/app/__init__.py 2>/dev/null

print_section "08_seatpool_requirements_or_pyproject"
test -f /seatpool/requirements.txt && cat /seatpool/requirements.txt
test -f /seatpool/pyproject.toml && cat /seatpool/pyproject.toml
ls /seatpool/venv 2>/dev/null | head -10

print_section "09_seatpool_config_env_files"
find /seatpool -maxdepth 3 -type f \( -name "*.env*" -o -name "config*.py" -o -name "settings*.py" -o -name "*.cfg" -o -name "*.ini" -o -name "*.toml" \) 2>/dev/null | grep -v venv | head -40
echo ""
test -f /seatpool/.env && grep -v "PASSWORD\|SECRET\|TOKEN\|KEY=" /seatpool/.env | head -40

print_section "10_postgres_databases"
sudo -u postgres psql -lqt 2>/dev/null | head -20 || true
echo ""
echo "[plugin card-keys table preview via app DB]"
sudo -u postgres psql -d seatpool -t -c "\\dt" 2>/dev/null | head -40 || true
sudo -u postgres psql -d seatpool -t -c "SELECT table_name FROM information_schema.tables WHERE table_name ILIKE '%card%' OR table_name ILIKE '%plugin%' OR table_name ILIKE '%activation%' OR table_name ILIKE '%client%' ORDER BY table_name;" 2>/dev/null

print_section "11_grep_internal_remote_verify"
grep -RIn --include="*.py" -E "远程校验|远程校验服务|verify_remote|remote_verify|remote_check|external_verify|upstream_verify" /seatpool/app 2>/dev/null | head -40

print_section "12_docker_containers"
docker ps 2>/dev/null | head -20

print_section "13_systemd_seatpool_web_unit"
systemctl cat seatpool-web.service 2>/dev/null

print_section "99_done"
date -u +%FT%TZ
