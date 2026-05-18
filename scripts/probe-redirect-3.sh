#!/usr/bin/env bash
set +e
print_section() { echo ""; echo "===== $1 ====="; }

print_section "01_maybe_redirect_public_entry"
grep -n -A 50 "def maybe_redirect_public_entry" /seatpool/app/services/unified_activation_service.py | head -80

print_section "02_should_forward_public_api"
grep -n -A 20 "def should_forward_public_api" /seatpool/app/services/unified_activation_service.py | head -40

print_section "03_user_index_template_exists"
ls -la /seatpool/app/templates/user/ 2>/dev/null | head -20

print_section "04_current_base_url_values"
export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"
psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -t -A -F'|' -c "
SELECT key, value FROM site_configs WHERE key IN ('card_activation_base_url')
"
unset PGPASSWORD

print_section "99_done"
date -u +%FT%TZ
