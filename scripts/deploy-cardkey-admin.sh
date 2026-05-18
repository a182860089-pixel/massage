#!/usr/bin/env bash
# 在远程部署 cardkey-admin 到 /opt/cardkey-admin（监听 127.0.0.1:8810）
# 不动 nginx，不动 seatpool-web，不动 cardkey-only
set -euo pipefail

TARGET=/opt/cardkey-admin
mkdir -p "$TARGET"
tar -xzf /tmp/cardkey-admin.tar.gz -C "$TARGET"

# .env（复用 seatpool_prod 库；SECRET_KEY 自动生成）
if [ ! -f "$TARGET/.env" ]; then
  SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
  : "${POSTGRES_PASSWORD:?env POSTGRES_PASSWORD required (export POSTGRES_PASSWORD=...)}"
  cat > "$TARGET/.env" <<ENV
DATABASE_URL=postgresql+psycopg://seatpool_prod:${POSTGRES_PASSWORD}@127.0.0.1:5432/seatpool_prod
SECRET_KEY=$SECRET
LOG_LEVEL=INFO
PLUGIN_RATE_LIMIT_WINDOW_SECONDS=60
PLUGIN_RATE_LIMIT_MAX_REQUESTS=20
ACTIVATION_RATE_LIMIT_WINDOW_SECONDS=60
ACTIVATION_RATE_LIMIT_MAX_REQUESTS=10
ENV
  chmod 600 "$TARGET/.env"
fi

# venv 装依赖
if [ ! -d "$TARGET/.venv" ]; then
  python3 -m venv "$TARGET/.venv"
fi
"$TARGET/.venv/bin/pip" install --upgrade pip --quiet
"$TARGET/.venv/bin/pip" install -r "$TARGET/requirements.txt" --quiet

# 杀掉旧实例
pkill -f 'gunicorn.*8810' 2>/dev/null || true
sleep 1

# 半建表清理：上一次启动如果在 CREATE INDEX 中段失败，会留下不完整状态
# activation_records 是 cardkey-admin 自管的新表，重建无副作用（不动其他表）
export PGPASSWORD="${PGPASSWORD:?env PGPASSWORD required (export PGPASSWORD=...)}"
psql -h 127.0.0.1 -U seatpool_prod -d seatpool_prod -v ON_ERROR_STOP=0 -c '
DROP TABLE IF EXISTS activation_records CASCADE;
' 2>&1 | tail -3
unset PGPASSWORD

# 后台拉起
cd "$TARGET"
set -a
. "$TARGET/.env"
set +a
nohup "$TARGET/.venv/bin/python" -m gunicorn \
  -w 1 -k gthread --threads 4 --timeout 60 --graceful-timeout 30 \
  --chdir "$TARGET" \
  -b 127.0.0.1:8810 'app:create_app()' \
  > "$TARGET/server.log" 2>&1 &
PID=$!
echo "$PID" > "$TARGET/server.pid"
sleep 3

# 健康检查
echo ""
echo "===== smoke ====="
echo "[GET /healthz]"
curl -s -o - -w '\n[HTTP %{http_code}]\n' --max-time 5 http://127.0.0.1:8810/healthz
echo ""
echo "[GET / (activation page) HEAD]"
curl -sI --max-time 5 http://127.0.0.1:8810/ | head -5
echo ""
echo "[GET /admin/login HEAD]"
curl -sI --max-time 5 http://127.0.0.1:8810/admin/login | head -5
echo ""
echo "[GET /api/plugin/card-keys/client-config]"
curl -s --max-time 5 http://127.0.0.1:8810/api/plugin/card-keys/client-config | head -c 240
echo ""
echo ""
echo "[POST /api/activation/redeem with empty body]"
curl -s --max-time 5 -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8810/api/activation/redeem
echo ""
echo "[POST /api/activation/redeem with fake card]"
curl -s --max-time 5 -H 'Content-Type: application/json' \
  -d '{"card_key":"_PROBE_NOPE_","email":"smoke@example.com"}' \
  http://127.0.0.1:8810/api/activation/redeem
echo ""
echo ""

# 创建初始管理员
echo "===== create admin ====="
cd "$TARGET"
FLASK_APP=app "$TARGET/.venv/bin/flask" create-admin admin <ADMIN_PASSWORD> 2>&1 | tail -5
echo ""

echo "===== tail log ====="
tail -n 20 "$TARGET/server.log"
echo ""
echo "DEPLOY_DONE pid=$PID port=8810 dir=$TARGET"
