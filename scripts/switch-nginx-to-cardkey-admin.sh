#!/usr/bin/env bash
# 把 seat.20050225.xyz 反代切到 cardkey-admin (8810)；
# 同时新增一个 IP 直连 server（任意未匹配 host），保留原 seatpool-web (8000) + noVNC + task-preview。
# 失败立即原文件回滚，并 reload。
set +e

CONF=/etc/nginx/sites-available/seatpool
TS=$(date +%Y%m%d_%H%M%S)
BACKUP="${CONF}.bak_${TS}"

if [ ! -f "$CONF" ]; then
  echo "FATAL: $CONF not found"; exit 1
fi

echo "===== 1) 备份当前配置 ====="
cp -a "$CONF" "$BACKUP" && echo "BACKUP -> $BACKUP"
echo ""

echo "===== 2) 写入新配置 ====="
cat > "$CONF" <<'NGINX_EOF'
# ---------------------------------------------------------------------------
# seat.20050225.xyz -> cardkey-admin (127.0.0.1:8810)
# 插件使用此域名激活，统一指向卡密管理后台 + 用户激活页 + 4 个插件接口
# ---------------------------------------------------------------------------
server {
    server_name seat.20050225.xyz;

    client_max_body_size 16m;

    location / {
        proxy_pass http://127.0.0.1:8810;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/seat.20050225.xyz/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/seat.20050225.xyz/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}

server {
    if ($host = seat.20050225.xyz) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    listen 80;
    server_name seat.20050225.xyz;
    return 404; # managed by Certbot
}

# ---------------------------------------------------------------------------
# 任意未匹配 host（含直接 IP 访问 http://154.12.94.197/）-> 原 seatpool-web
# 兼容 /novnc/ 与 /admin/task-preview/ws（原 seatpool 的任务预览）
# ---------------------------------------------------------------------------
server {
    listen 80 default_server;
    server_name _;

    client_max_body_size 64m;

    location /novnc/ {
        alias /usr/share/novnc/;
        autoindex off;
        add_header Cache-Control "no-store";
    }

    location /admin/task-preview/ws {
        proxy_pass http://127.0.0.1:6080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_buffering off;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 900;
    }
}
NGINX_EOF
echo "WROTE $CONF"
echo ""

echo "===== 3) nginx -t ====="
nginx -t
RC=$?
if [ $RC -ne 0 ]; then
  echo "!!!!! nginx -t FAILED, ROLLBACK !!!!!"
  cp -a "$BACKUP" "$CONF"
  nginx -t && systemctl reload nginx
  exit 9
fi
echo ""

echo "===== 4) reload nginx ====="
systemctl reload nginx
RC=$?
if [ $RC -ne 0 ]; then
  echo "!!!!! reload FAILED, ROLLBACK !!!!!"
  cp -a "$BACKUP" "$CONF"
  nginx -t && systemctl reload nginx
  exit 9
fi
echo "reload OK"
echo ""

echo "===== 5) 端到端冒烟（https://seat.20050225.xyz 现在应指向 cardkey-admin） ====="
curl -s -o /dev/null -w 'https://seat.20050225.xyz/                                  HTTP %{http_code}\n' --max-time 8 https://seat.20050225.xyz/
curl -s -o /dev/null -w 'https://seat.20050225.xyz/admin/login                       HTTP %{http_code}\n' --max-time 8 https://seat.20050225.xyz/admin/login
curl -s -o /dev/null -w 'https://seat.20050225.xyz/api/plugin/card-keys/client-config HTTP %{http_code}\n' --max-time 8 https://seat.20050225.xyz/api/plugin/card-keys/client-config
curl -s -o /dev/null -w 'http://154.12.94.197/  (原 seatpool-web via IP)             HTTP %{http_code}\n' --max-time 8 http://154.12.94.197/
echo ""

echo "===== 6) 确认 seat.xx 现在落到 cardkey-admin（不是 seatpool） ====="
echo "  期望关键字（cardkey-admin 自有页面才有）"
curl -s --max-time 5 https://seat.20050225.xyz/admin/login | grep -Eo 'cardkey-admin|cardkey - admin|管理员登录' | head -3
echo ""

echo "DONE backup=$BACKUP"
