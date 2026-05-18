#!/usr/bin/env bash
# 解包到 /opt/cardkey-only，创建 venv 装依赖，写入 .env，独立 8801 端口启动
# 不动 nginx，不动 seatpool-web
set -euo pipefail

TARGET_DIR=/opt/cardkey-only
mkdir -p "$TARGET_DIR"

# 解包
tar -xzf /tmp/cardkey-server.tar.gz -C "$TARGET_DIR"

cd "$TARGET_DIR"

# 写 .env（DSN 复用 seatpool_prod，已知凭据）
: "${POSTGRES_PASSWORD:?env POSTGRES_PASSWORD required (export POSTGRES_PASSWORD=...)}"
cat > "$TARGET_DIR/.env" <<ENV_EOF
DATABASE_URL=postgresql+psycopg://seatpool_prod:${POSTGRES_PASSWORD}@127.0.0.1:5432/seatpool_prod
SQLALCHEMY_ECHO=false
LOG_LEVEL=INFO
PLUGIN_RATE_LIMIT_WINDOW_SECONDS=60
PLUGIN_RATE_LIMIT_MAX_REQUESTS=20
ENV_EOF
chmod 600 "$TARGET_DIR/.env"

# venv 装依赖
if [ ! -d "$TARGET_DIR/.venv" ]; then
  python3 -m venv "$TARGET_DIR/.venv"
fi
"$TARGET_DIR/.venv/bin/pip" install --upgrade pip --quiet
"$TARGET_DIR/.venv/bin/pip" install -r "$TARGET_DIR/requirements.txt" --quiet

# 杀掉占用 8801 的旧实例（如果有）
pkill -f 'gunicorn.*8801' 2>/dev/null || true
sleep 1

# 启动到独立端口（前台跑 5 秒做冒烟，然后由调用方判断是否后续 systemd 化）
cd "$TARGET_DIR"
set -a
. "$TARGET_DIR/.env"
set +a

# 后台启动（nohup 模式，PID 记到文件）
nohup "$TARGET_DIR/.venv/bin/python" -m gunicorn \
  -w 1 -k gthread --threads 4 --timeout 60 --graceful-timeout 30 \
  --chdir "$TARGET_DIR" \
  -b 127.0.0.1:8801 'app:create_app()' \
  > "$TARGET_DIR/server.log" 2>&1 &
PID=$!
echo "$PID" > "$TARGET_DIR/server.pid"
sleep 3

# 健康检查
echo "----- HEALTH CHECK -----"
echo "[GET /healthz]"
curl -s -o - -w '\n[HTTP %{http_code}]\n' --max-time 5 http://127.0.0.1:8801/healthz
echo ""

echo "[GET /api/plugin/card-keys/client-config]"
curl -s -o - -w '\n[HTTP %{http_code}]\n' --max-time 5 http://127.0.0.1:8801/api/plugin/card-keys/client-config | head -c 600
echo ""

echo "[POST /api/plugin/card-keys/status with dummy]"
curl -s -o - -w '\n[HTTP %{http_code}]\n' --max-time 5 \
  -H 'Content-Type: application/json' \
  -d '{"card_key":"_PROBE_NEVER_EXIST_","email":"a@b.com","client_id":"dev"}' \
  http://127.0.0.1:8801/api/plugin/card-keys/status
echo ""

echo "[POST /api/plugin/card-keys/activate with invalid email]"
curl -s -o - -w '\n[HTTP %{http_code}]\n' --max-time 5 \
  -H 'Content-Type: application/json' \
  -d '{"card_key":"X","email":"not-an-email","client_id":"dev"}' \
  http://127.0.0.1:8801/api/plugin/card-keys/activate
echo ""

echo "----- TAIL LOG -----"
tail -n 40 "$TARGET_DIR/server.log" || true
echo ""

echo "DEPLOY_DONE pid=$PID port=8801 dir=$TARGET_DIR"
