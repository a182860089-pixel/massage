#!/usr/bin/env bash
# 把卡密相关源码 + DB schema 打包到 /tmp，给主机下载用
set -e

OUT_DIR=/tmp/cardkey-source-$(date -u +%Y%m%d-%H%M%S)
mkdir -p "$OUT_DIR/app/api" "$OUT_DIR/app/models" "$OUT_DIR/app/services" "$OUT_DIR/app/utils"

copy_if_exists() {
  local src="$1"; local dst="$2"
  if [ -f "$src" ]; then cp "$src" "$dst"; fi
}

# --- 路由层 ---
copy_if_exists /seatpool/app/api/__init__.py            "$OUT_DIR/app/api/__init__.py"
copy_if_exists /seatpool/app/api/plugin_card_keys.py    "$OUT_DIR/app/api/plugin_card_keys.py"

# --- 模型层 ---
copy_if_exists /seatpool/app/models/__init__.py                "$OUT_DIR/app/models/__init__.py"
copy_if_exists /seatpool/app/models/card_key.py                "$OUT_DIR/app/models/card_key.py"
copy_if_exists /seatpool/app/models/plugin_card_binding.py     "$OUT_DIR/app/models/plugin_card_binding.py"
copy_if_exists /seatpool/app/models/plugin_card_rebind_log.py  "$OUT_DIR/app/models/plugin_card_rebind_log.py"
copy_if_exists /seatpool/app/models/card_key_binding_history.py "$OUT_DIR/app/models/card_key_binding_history.py"
copy_if_exists /seatpool/app/models/site_config.py             "$OUT_DIR/app/models/site_config.py"
copy_if_exists /seatpool/app/models/member.py                  "$OUT_DIR/app/models/member.py"
copy_if_exists /seatpool/app/models/unified_activation_record.py "$OUT_DIR/app/models/unified_activation_record.py"

# --- 服务层（只拿可能依赖的） ---
copy_if_exists /seatpool/app/services/__init__.py                "$OUT_DIR/app/services/__init__.py"
copy_if_exists /seatpool/app/services/card_key_service.py        "$OUT_DIR/app/services/card_key_service.py"
copy_if_exists /seatpool/app/services/unified_activation_service.py "$OUT_DIR/app/services/unified_activation_service.py"

# --- 工具 ---
copy_if_exists /seatpool/app/utils/__init__.py    "$OUT_DIR/app/utils/__init__.py"
copy_if_exists /seatpool/app/utils/timezone.py    "$OUT_DIR/app/utils/timezone.py"
copy_if_exists /seatpool/app/utils/crypto.py      "$OUT_DIR/app/utils/crypto.py"
copy_if_exists /seatpool/app/utils/rate_limit.py  "$OUT_DIR/app/utils/rate_limit.py"
copy_if_exists /seatpool/app/utils/sql_expressions.py "$OUT_DIR/app/utils/sql_expressions.py"

# --- 顶层 ---
copy_if_exists /seatpool/app/__init__.py "$OUT_DIR/app/init_top.py"
copy_if_exists /seatpool/app/security.py "$OUT_DIR/app/security.py"
copy_if_exists /seatpool/config.py       "$OUT_DIR/config.py"
copy_if_exists /seatpool/requirements.txt "$OUT_DIR/requirements.txt"
copy_if_exists /seatpool/.env.example     "$OUT_DIR/env.example.txt"

# --- nginx server block ---
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
' > "$OUT_DIR/nginx-seat.conf"

# --- systemd unit ---
systemctl cat seatpool-web.service > "$OUT_DIR/seatpool-web.service.txt"

# --- DB schema：只导 schema，再 dump 极少量样本 ---
export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"
pg_dump --schema-only --no-owner --no-privileges \
  -h 127.0.0.1 -U seatpool_prod -d seatpool_prod \
  -t card_keys -t plugin_card_bindings -t plugin_card_rebind_logs \
  -t card_key_binding_histories -t site_configs \
  > "$OUT_DIR/schema-relevant.sql" 2>"$OUT_DIR/schema-error.log"

# 行数样本，验证表是否被实际使用
psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -t -A -F'|' -c "
SELECT 'card_keys', count(*) FROM card_keys
UNION ALL SELECT 'plugin_card_bindings', count(*) FROM plugin_card_bindings
UNION ALL SELECT 'plugin_card_rebind_logs', count(*) FROM plugin_card_rebind_logs
UNION ALL SELECT 'card_key_binding_histories', count(*) FROM card_key_binding_histories
UNION ALL SELECT 'site_configs', count(*) FROM site_configs
" > "$OUT_DIR/table-counts.txt" 2>>"$OUT_DIR/schema-error.log"

# 看 site_configs 与插件相关的配置 KEY 列表
psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -t -A -F'|' -c "
SELECT key, left(value, 60) FROM site_configs WHERE key ILIKE '%plugin%' OR key ILIKE '%client%' OR key ILIKE '%upgrade%' OR key ILIKE '%announc%' ORDER BY key
" > "$OUT_DIR/site-configs-plugin.txt" 2>>"$OUT_DIR/schema-error.log"

unset PGPASSWORD

cd /tmp
TAR_NAME="cardkey-source-$(date -u +%Y%m%d-%H%M%S).tar.gz"
tar -czf "/tmp/$TAR_NAME" -C "$OUT_DIR" .
echo "PACK_PATH=/tmp/$TAR_NAME"
ls -la "/tmp/$TAR_NAME"

# 输出文件清单到 stdout
echo "----- FILES IN ARCHIVE -----"
tar -tzf "/tmp/$TAR_NAME" | sort
