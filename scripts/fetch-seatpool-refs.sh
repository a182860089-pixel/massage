#!/usr/bin/env bash
# 把后续做减法用得到的 seatpool 文件打包到 /tmp/seatpool-refs.tar.gz
set -euo pipefail

OUT=/tmp/seatpool-refs-build
rm -rf "$OUT"
mkdir -p "$OUT/app/admin" "$OUT/app/api" "$OUT/app/models" "$OUT/app/services" "$OUT/app/templates" "$OUT/app/static"

cp_if() { [ -f "$1" ] && cp "$1" "$2" || echo "[skip] $1"; }
cp_dir_if() { [ -d "$1" ] && cp -r "$1" "$2" || echo "[skip dir] $1"; }

# admin 路由与服务（参考）
cp_if /seatpool/app/admin/__init__.py "$OUT/app/admin/__init__.py"
cp_if /seatpool/app/admin/views.py    "$OUT/app/admin/views.py"

# API
cp_if /seatpool/app/api/__init__.py        "$OUT/app/api/__init__.py"
cp_if /seatpool/app/api/admin_card_keys.py "$OUT/app/api/admin_card_keys.py"
cp_if /seatpool/app/api/card_keys.py       "$OUT/app/api/card_keys.py"
cp_if /seatpool/app/api/members.py         "$OUT/app/api/members.py"

# 还缺的关键 model
cp_if /seatpool/app/models/admin_user.py "$OUT/app/models/admin_user.py"

# 模板和 static
cp_dir_if /seatpool/app/templates "$OUT/app/templates_full"
cp_dir_if /seatpool/app/static    "$OUT/app/static_full"

echo "[size]"
du -sh "$OUT" || true
du -sh "$OUT/app/templates_full" || true
du -sh "$OUT/app/static_full" || true

PACK=/tmp/seatpool-refs.tar.gz
cd "$OUT"
tar -czf "$PACK" .
ls -la "$PACK"
echo "[done]"
