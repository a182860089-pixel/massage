#!/usr/bin/env bash
set +e
print_section() { echo ""; echo "===== $1 ====="; }

print_section "01_should_redirect_public_entry"
grep -n -A 30 "def should_redirect_public_entry" /seatpool/app/services/unified_activation_service.py | head -60

print_section "02_public_entry_url"
grep -n -A 20 "def public_entry_url" /seatpool/app/services/unified_activation_service.py | head -40

print_section "03_gateway_base_url"
grep -n -A 20 "def gateway_base_url" /seatpool/app/services/unified_activation_service.py | head -40

print_section "04_is_gateway_is_node"
grep -nE "def is_gateway|def is_node|def current_site_role|def site_role" /seatpool/app/services/unified_activation_service.py | head -20

print_section "05_site_role_resolver"
grep -n -A 20 "def current_site_role\\|def site_role\\|def current_site_key" /seatpool/app/services/unified_activation_service.py | head -80

print_section "06_relevant_db_keys"
export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"
psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -t -A -F'|' -c "
SELECT key, COALESCE(value,'') FROM site_configs
WHERE key ILIKE '%gateway%' OR key ILIKE '%site_role%' OR key ILIKE '%unified%' OR key ILIKE '%cross_site%' OR key ILIKE '%redirect%' OR key ILIKE '%node%' OR key ILIKE '%base_url%' OR key ILIKE '%public%'
ORDER BY key
"
unset PGPASSWORD

print_section "07_unified_activation_config_class"
grep -n "KEY_GATEWAY\\|KEY_SITE_ROLE\\|KEY_UNIFIED" /seatpool/app/services/unified_activation_service.py | head -20

print_section "08_search_redirect_strings"
grep -nE "should_redirect|gateway_base|site_role|is_node|is_gateway" /seatpool/app/services/unified_activation_service.py | head -40

print_section "99_done"
date -u +%FT%TZ
