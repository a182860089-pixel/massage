#!/usr/bin/env bash
set +e
print_section() { echo ""; echo "===== $1 ====="; }

print_section "01_render_public_activation_body"
grep -n -A 80 "def _render_public_activation" /seatpool/app/__init__.py | head -120

print_section "02_search_redirect_calls"
grep -nE "redirect\\(|return redirect" /seatpool/app/__init__.py | head -40

print_section "03_search_homepage_or_landing"
grep -nE "homepage|landing|HOMEPAGE|LANDING|public_activation|activation_base_url" /seatpool/app/__init__.py | head -40

print_section "04_db_site_config_relevant"
export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"
psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -t -A -F'|' -c "
SELECT key, COALESCE(value,'') FROM site_configs
WHERE key ILIKE '%activation%' OR key ILIKE '%homepage%' OR key ILIKE '%redirect%'
   OR key ILIKE '%landing%' OR key ILIKE '%public_url%' OR key ILIKE '%luming%'
   OR value ILIKE '%luming%'
ORDER BY key
"
unset PGPASSWORD

print_section "05_done"
date -u +%FT%TZ
